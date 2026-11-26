# Batch 1: fast bootstraps for the 3 panels + fast owner-panel pause/resume (test2 only)

Status: **plan only, nothing deployed for batch 1** (2026-11-24 ~14:50 Cairo). Inventory: `INVENTORY.md`.
**Scope:** tenant `test2` only.
- Expanding to any other client needs **Ahmed's explicit go-ahead in the team group**.
- **بوابة الأدب 10 and every other live client are not touched**: they are not in `ALLOWLIST` / `WORKER_TENANTS`, so every request of theirs takes today's script path, byte for byte.

## 0. What we reuse (already live)
- Worker `adab-platform-gateway` + D1 `ff2a00a6…`:
  - `ALLOWLIST=test2`
  - `/app/platform` (fast suspend/resume, ~0.4 s vs ~8 s)
  - `tenant_ops`, cron pull every 5 min
  - `syncOp` push in `waitUntil`
  - `/admin/*` behind ADMIN_KEY
- Script `?b=worker` channel (WorkerSync.js, SYNC_SECRET + `WORKER_TENANTS`).
  - Batch 1 adds actions to this channel only.
  - No change to any existing script function.
- The page already renders `localStorage` bootstrap first, then refreshes.
  - So the user sees *something* instantly today, but the refresh, and every action after it, waits 3–8 s on the script.
  - Batch 1 makes the **refresh** and the **pause/resume** answers come from the Worker.

## 1. The authentication gap (must solve first)
The tenant panels (owner and student) are opened from **test2's own bots**, so their `initData` is signed with test2's bot token (`tokenFor_(role)`: admin or unified or student token). The Worker only has the platform token.
- **Do not copy bot tokens to the Worker.** Telegram's check only needs the *derived* key `secret = HMAC_SHA256(key="WebAppData", msg=token)`. That key can verify initData but **cannot call the Bot API**.
- New script action `?b=worker` `exportAppKeys` (WORKER_TENANTS only, SYNC_SECRET-auth): returns `{tid, role, keyHex}` for the roles the tenant uses (admin / student / unified).
- Worker stores it in D1 `app_keys(tenant_id, role, key_enc, fetched_ms)`, **AES-GCM-encrypted with a key derived from a Worker secret** (`SYNC_SECRET` via HKDF). It is refreshed by the cron pull, so a `/rotate` or token change heals within 5 min. Until then, verification fails → fallback to the script.
- Port: `verifyInitDataWithSecret(raw, secretBytes)`, the same algorithm as `verifyMiniAppInit_`, just starting from the derived key. Unit-tested against `node:crypto` vectors and against the live script (see test plan).

## 2. D1 additions (migration `0003_batch1.sql`, additive only)
| Table | Columns | Purpose |
|---|---|---|
| `app_keys` | tenant_id, role, key_enc, fetched_ms, PK(tenant_id, role) | initData verification per tenant bot (derived key only) |
| `app_snapshots` | tenant_id, panel ('platform'\|'owner'\|'admin'\|'student'), uid, payload_json, built_ms, source ('script'\|'worker'), version, PK(tenant_id, panel, uid) | last good bootstrap answer per user (stale-while-revalidate) |
| `programs` | tenant_id, pid, name, open, pulled_ms, PK(tenant_id, pid) | owner-panel program list |
| `activities` | tenant_id, pid, akey, title, level, points, bot, paused_from_ms, paused_until_ms, pulled_ms, dirty, pending_op, last_sync_ms, last_sync_error, PK(tenant_id, pid, akey) | mirror of the ACTIVITIES section of each program's «الإعدادات» |
| `tenant_admins` | tenant_id, uid, name, programs_csv ('' = all), pulled_ms, PK(tenant_id, uid) | who may pause which program (owner from `tenants.owner_id`) |
| `activity_ops` | op_id, tenant_id, pid, akey, action ('pause'\|'resume'), from_ms, until_ms, before_json, actor_uid, at_ms (strictly increasing per activity), server_ms, client_ms, synced_ms, sync_result | audit + ordering + timings |
`tenant_ops.source` already exists. `processed_updates` is unused here (mini-app calls are not Telegram updates).

## 3. Worker endpoints (all POST text/plain JSON, CORS for `https://adabway.github.io`, same `{ok, …, fast:true}` / `{ok:false, fallback:true, reason}` contract as `/app/platform`)
### 3a. Bootstraps (all 3 panels)
- `POST /app/platform` `action:'bootstrap'` (platform panel, owner only, platform token already in the Worker).
- `POST /app/tenant?t=test2&r=admin|student|unified` `action:'bootstrap'` (owner/admin panel and student panel).

Logic (same for all three):
1. Verify initData (platform token, or `app_keys` for the tenant role).
2. Authorize:
   - platform: `uid == owner_id`;
   - tenant: `t ∈ ALLOWLIST`, then admin/owner via `tenant_admins` / `owner_id`, else student.
3. If `app_snapshots[t, panel, uid]` exists → return it immediately with `{fast:true, builtAt, stale: age > 60 s}`, plus a **D1 overlay**:
   - platform: test2's `status` and `expiry` from `tenants`;
   - owner panel: each activity's `paused` / `pauseLabel` from `activities`.
   So a Worker-made change shows instantly even in an older snapshot.
4. In `ctx.waitUntil`: **revalidate** by forwarding *the same request body* (same initData) to the script's existing `?b=app…` endpoint. The script authenticates it itself, so no new script code is needed for this. Store the answer as the new snapshot if `ok`.
5. No snapshot yet (first open), or anything unexpected → `{fallback:true}`, and the page calls the script exactly as today. The Worker still warms the snapshot in the background from that same request (the page does not wait for it).

Privacy:
- Snapshots are per uid, and only served after verifying that uid's signature.
- Student snapshots contain only that student's own data (the script built them for that uid).
- Platform snapshot = owner only.
- TTL: rows older than 7 days are pruned by cron.

### 3b. Owner-panel pause / resume (activities)
`POST /app/tenant?t=test2&r=admin|unified` `action:'pause'|'resume'`, body as the page sends today: `{pid, activity, days}` or `{pid, activity, until:'inf'}`; resume = `{pid, activity}`.
- **Handled in the Worker:**
  - `days ∈ {1,3,7}` (يوم / 3 أيام / أسبوع; «إيقاف يوم» = `days:1`)
  - `until:'inf'` («حتى إشعار آخر» / «حتى أعيد تفعيلها»)
  - `resume` («▶️ تفعيل الآن»)
- **Fallback to the script:** explicit date / date ranges (`from`/`date`/`until=<date>`, needs `parsePauseInput`). Batch 2 can port that.
- Checks, mirroring `miniAppAdminNeed_` and `miniAppAdminPause_`:
  - session is admin/owner; `canAccess_(pid)` via `tenant_admins`;
  - pid exists in `programs`; activity exists in `activities`;
  - row not dirty, not pending another op, mirror pulled < 30 min ago.
- Compute exactly like the script:
  - pause: `from = now`, `until = now + days·86400000` or `''` (inf);
  - resume: both cleared;
  - "already available" → `{ok:true, message:'ℹ️ الفعالية متاحة أصلًا.'}` with no write.
  - Labels come from a port of `pauseLabel` / `fmtTime` (Africa/Cairo, `YYYY-MM-DD HH:MM`), giving the same message `✅ حُفظ: «ref» — ⏸ موقوفة حتى …`.
- Write: one D1 batch (update `activities` + insert `activity_ops`, pending_op = op_id), then reply `{ok:true, fast:true, opId, activity, label, message}`.
- Update this user's owner snapshot in place (activity label), so the next bootstrap is already right.

## 4. Sheet sync in the background (D1 → Sheet; the Sheet stays the source of truth)
- New script action `?b=worker` `syncActivityPause {tid, pid, ref, from, until, opId, atMs, actorUid}`. WORKER_TENANTS only. It runs **the same code path as `miniAppAdminPause_`'s write half**, under `tenantLock_()`:
  - `planPause` → `validatePlan` → `writePlan_` on «الإعدادات»;
  - `invalidateProgram_(pid)`, so the student bot sees the change at once;
  - `logChange_(actor, pid, 'الفعاليات المصاحبة', ref, 'إيقاف مؤقت', old, label)`, so the change log is identical to today.
- Ordering: the script keeps the last applied `atMs` per (pid, ref) in a property and skips older ops (`stale-skipped`), same pattern as `syncTenantStatus`.
- Answer returns the activity as now stored. The Worker writes it back to D1 and clears pending, or records `last_sync_error`.
- Retry: cron every 5 min re-sends pending ops; a pull never overwrites a pending row.
- Pull: new action `exportActivities {tid}` returns programs + ACTIVITIES (pausedFrom/pausedUntil) + admins for WORKER_TENANTS. Cron pulls test2 every 5 min. Edits made in the bot (`PZ` buttons), in the Sheet by hand or by the script panel are picked up within ≤5 min. Rows the Worker hasn't synced yet are never overwritten.
- Window: between the Worker reply and the Sheet write (~3–5 s), the student bot still uses the old state. Same order of delay as today's script path, but the owner is no longer waiting for it.

## 5. Automatic fallback (any doubt → today's script path)
The Worker answers `{ok:false, fallback:true, reason}` and the page silently repeats the same call to the script when:
- the tenant is not in ALLOWLIST (every client except test2);
- the action is not handled (date pauses, every other action);
- there is no `app_keys` entry, the signature is bad or expired, or the user is not owner/admin;
- the pid/activity is unknown, the row is dirty/pending, or the mirror is stale (>30 min);
- there is no snapshot yet (bootstrap only);
- any D1 error or exception.

The page also falls back on network error or after a **4 s timeout**, as in today's suspend/resume code.

**Kill switches (instant):** `ALLOWLIST=""` (Worker var), remove `MINIAPP_FAST_*` from `config.js`, or remove test2 from Script Property `WORKER_TENANTS` (stops sync/export).

## 6. Page changes (Muse pushes to `adabway/adabway.github.io`)
1. `config.js`: keep `MINIAPP_FAST_API`, `MINIAPP_FAST_TENANTS = ['test2']`.
2. Generic `fastCall(action, body)` → `POST FAST_API + (isPlatform ? '/app/platform' : '/app/tenant?t=' + tid + '&r=' + role)`.
   - Same body as `api()`, 4 s timeout.
   - Returns `null` unless `ok && fast`; otherwise the caller uses `api()` as today.
   - Only when `FAST_TENANTS` includes `tid` (or test2 is the platform target).
3. `refresh()` (bootstrap): try `fastCall('bootstrap')` first and `applyData()` it.
   - If `r.stale`, also call the script `api('bootstrap')` in the background and re-apply silently when it returns.
   - If not fast → today's code.
4. Activities tab buttons (`.js-pz`, `.js-res`): use `fastCall('pause'|'resume', body)`. On a fast answer, **update that activity card from `r.label` locally and do NOT call the full `refresh()`**. Today every pause triggers a full bootstrap = a second 3–8 s wait. On no fast answer → `runAdmin` as today.
5. Send `action:'metric' {opId, ms}` after a fast pause/resume (click→render), as for suspend/resume.
6. Cache-bust:
   - Platform menu button: we bump `?v=N` via the Worker admin endpoint.
   - Tenant bots' menu buttons are set by the script (`miniAppUrl_`). For test2 only, we can call `setChatMenuButton` with `&v=N` from the script editor if needed.
   - Muse: add `?v=N` to `<script src="config.js">`.
7. jsdom tests (as in `miniapp-patch/test`):
   - test2 → Worker;
   - another tenant → script only;
   - Worker fallback / timeout → script;
   - pause updates the card without a refresh.

## 7. Test plan
**Unit (node, D1 emulation, no network)** — must pass before any deploy:
- `verifyInitDataWithSecret` == script algorithm (vectors with signature/query_id/Arabic names, tampered, expired, wrong key).
- Bootstraps:
  - snapshot hit returns `fast` + overlay;
  - stale → revalidate in waitUntil;
  - miss → fallback + warm;
  - a non-allowlisted tenant gets nothing from D1;
  - a student cannot read another uid's snapshot.
- Pause/resume:
  - days 1/3/7 and inf → same `from`/`until`/label/message as the script functions (golden values from the Apps Script functions run in the editor);
  - "already available";
  - admin without access to pid → fallback;
  - dirty / pending / stale / D1 failure → fallback with no write;
  - out-of-order syncs;
  - sync down → still fast, cron retries;
  - pull never undoes a pending op.

**Script side (editor test function, test2 only):** `syncActivityPause` writes the same cells as a mini-app pause, logs the same change row, invalidates the cache, and skips stale ops. `exportActivities` / `exportAppKeys` refuse tenants outside WORKER_TENANTS.

**Live on test2 (no clicks from Ahmed):**
1. Admin-only mint of short-lived (10 min) test initData inside the Worker for test2's owner uid, using the derived key. Nothing secret leaves the Worker.
2. Bootstrap ×3 per panel: first = fallback + warm, then fast. Record Worker ms and round trip vs the script's `?b=app` time for the same body.
3. Pause one test2 activity for 1 day → check D1 `activity_ops`, then «الإعدادات» cells pausedFrom/pausedUntil (+ سجل التعديلات row) within ~5 s, and the student bot no longer offering the activity.
4. «حتى إشعار آخر» → same checks.
5. Resume → cells cleared, D1 synced.
6. Restore: the activity ends exactly as before the test (available). D1 and the Sheet are compared field by field.
7. Post the timings in the group, then ask Ahmed for **one** real try (owner panel: pause يوم → تفعيل الآن). His `client_ms` appears in `activity_ops`.

## 8. Rollout and rollback
- **Order:**
  1. D1 migration 0003 (additive);
  2. script version with the 3 new `?b=worker` actions (existing deployment, same /exec URL; old version number recorded);
  3. Worker deploy (previous version id recorded);
  4. page push by Muse;
  5. live test on test2.
- **Rollback, any one is enough:**
  - `ALLOWLIST=""`;
  - re-upload the previous Worker version;
  - revert the page commit;
  - redeploy the previous script version (new actions unused);
  - the new D1 tables are harmless if left.
- **Expansion beyond test2:** only after Ahmed says so in the group, one client at a time (add it to `ALLOWLIST` and `WORKER_TENANTS`, pull, mint-test, then announce). **Never** بوابة الأدب 10 without his explicit word.

## 9. Expected gain (to be measured)
- Bootstrap refresh: 3–8 s → ~0.2–0.5 s (snapshot), with silent background correction.
- Pause/resume: script 3–8 s **plus** a full refresh (another 3–8 s) → ~0.4 s and no refresh.

## 10. Needed from Ahmed
Nothing now. (He pre-approved what Grok and Muse agree on, msg 119.) Only expanding beyond test2 needs his word in the group.

## Next batches (from INVENTORY hot paths)
- **Batch 2:** student panel `subs`/`grades` reads from snapshots; owner `toggleOpen`; date-range pauses.
- **Batch 3:** student submission acknowledgement (instant reply in the Worker, Sheet append in the background). This needs the tenant bot webhooks behind the Worker, which is a bigger change, planned separately.
