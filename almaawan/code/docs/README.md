# adab-platform-gateway — activation/close in a Cloudflare Worker + D1

## Update 2026-11-24 19:30 Cairo — batch 2 (a) bot تسليماتي/درجاتي: paused for budget, nothing deployed

Ahmed approved moving (a) to the Worker with test2's bot token. I read the script and wrote the design in `PLAN-batch2a.md`, then stopped on the usage budget before writing code.

Current state:
- No script push: v37 is still live.
- No Worker deploy: d2135f39 is still live.
- No migration.
- test2's bot webhook was never changed, and the token was not exported.
- Group messages: 166 (start), plus the pause note.

## Update 2026-11-24 19:10 Cairo — batch 2: toggleOpen + pause by date on the fast path (test2 only); (a) assessed, not built

Group messages: start 163, done + (a) assessment 164, contract for Muse 165.

- Script: version **37** on deployment `AKfycbwlkioY…aF1G` (it was 36). Additive only:
  - The new file `WorkerBatch2.js` adds `syncProgramOpen {tid,pid,open,opId,atMs,actor}`. It uses the same write half as `miniAppAdminToggleOpen_` and the order guard `WORKER_OPEN_LAST:<tid>:<pid>`.
  - `WorkerBatch1.js` routes that action and lets `syncActivityPause` take an optional `label` for the change log.
  - Both are gated to WORKER_TENANTS.
- D1: migration `0004_batch2.sql` adds `programs.updated_ms`, `pending_op` and `last_sync_error`. Program ops reuse `activity_ops` with akey `#open`.
- Worker: version `d2135f39-68ea-4543-bf1e-e415c0ed2026`, deployment `e3247b77-355a-4225-bafd-3810e43472f5`. Previous version: `1f2415a7-9ee7-4747-8672-c6c9442c22cf`.
  - `toggleOpen {pid, open}` runs on the fast path. If D1 already shows the requested state, it falls back to the script.
  - Pause by date (`until` / `date` / `from+until` / «… إلى …») is parsed exactly like `parsePauseInput`, in Cairo wall time, with Arabic digits accepted. Past, unparsable or non-string dates, and DST-gap times, fall back to the script.
  - When the Sheet refuses a change (`invalid…` / not found), the D1 mirror is undone and the op is not retried.
  - Pulls upsert programs and keep in-flight toggles.
  - Admin snapshot overlays `open`. A student snapshot falls back once ('program changed') when a program changed after it was built.
  - New admin route `/admin/restore-program {tid,pid,open}`.
- Tests: npm test **92/92** before deploy.
- Live test on test2 (Worker vs script direct):
  - toggleOpen: 0.88–0.98 s vs 3.58 s. The Sheet updated in 8–10 s; confirmed by re-pull.
  - Date pause (until date+time / from+until / range text): 0.93–0.98 s vs 5.45 s, with identical labels.
  - Resume: 1.08 s vs 7.10 s.
  - The Sheet was re-read after every op and matched D1. Past date → fallback.
  - Server-side time from the box is about 0.8 s. Page ops from Muse's tests showed 0.22–0.26 s.
- test2 restored and verified identical to the 18:58 baseline:
  - trial until 2026-12-07; p1 closed;
  - مشاركة paused∞ (from 1795530334547), نقاش available, واجب available;
  - no pending ops.
  - Evidence is in `livetest/b2/`.
- (a) bot /mysubs, /mygrades, ms/my, تسليماتي/درجاتي: not built, because the risk is large.
  - It needs a mirror of the full submissions log (student texts) and the registrations.
  - The follow-up sv:/edit/delete buttons depend on the script's CacheService conversation state (st.ml/st.email/st.p).
  - Replying from the Worker needs the tenant bot token, which batch 1 deliberately never gives the Worker.
  - All of test2's real bot traffic would route through the Worker.
  - test2's bot webhook is untouched.
- Rollback:
  - script: `clasp update-deployment AKfycbwlkioYyV0B9hGaB6053Khi_YReYvwXfhPSLFoB4MVtryWXZIvnWi4LRT4jasZnaF1G -V 36`
  - Worker: deploy version `1f2415a7-9ee7-4747-8672-c6c9442c22cf`
  - kill switch: `ALLOWLIST=""`
  - The 0004 columns are inert if left in place.

## Update 2026-11-24 15:05 Cairo — batch 1: panel bootstraps + owner activity pause/resume (test2 only)

Design: PLAN-batch1.md. Page-side work is Muse's (contract posted in group msg 148).

- Script: version 36 is on deployment `AKfycbwlkioY…aF1G` (it was 35). The change is additive only: the new file `WorkerBatch1.js` and one dispatch line in `WorkerSync.js`. New `?b=worker` actions: `exportAppKeys`, `exportActivities`, `syncActivityPause`. All are gated to WORKER_TENANTS (test2). Muse's `M3Temp.js` was already at HEAD and is included unchanged.
- D1: migration `0003_batch1.sql` applied. It adds tables: app_keys, tenant_app_meta, app_snapshots, programs, activities, tenant_admins, activity_ops.
- Worker: version `1f2415a7-9ee7-4747-8672-c6c9442c22cf`, deployment `4d93d69e-916d-4874-92b0-721072214bfb`. Previous version: `e319789f-51ec-4021-8511-55806add71cf`.
  - New: `POST /app/tenant?t=&r=admin|student|unified`, with actions bootstrap, pause, resume and metric.
  - `/app/platform` now also handles bootstrap.
  - New admin routes: `/admin/pull-app`, `/admin/app-state`, `/admin/mint`, `/admin/restore-activity`.
  - The cron pulls keys and activities.
  - New var: `SNAPSHOT_STALE_MS=60000`.
- Tests: npm test 80/80 before deploy.
- Live test on test2 (live/script direct, warm snapshot):
  - student panel bootstrap: 0.61–0.81 s vs 3.29 s
  - unified panel bootstrap: 0.68–0.83 s vs 3.13 s
  - admin panel bootstrap: 0.63–0.83 s vs 8.50 s
  - platform panel bootstrap: 0.25–0.45 s vs 3.49 s
  - The first call is a fallback ('no snapshot'), and the next call is fast. Payload is identical to the script except `fast`, `stale` and `builtAt`.
  - Pause 1 day, pause «حتى إشعار آخر», resume: 0.88–0.94 s each. Each synced to the Sheet in about 6–7 s, with sync_result ok, and was confirmed by re-reading via exportActivities.
  - Script resume (no write): 3.67 s.
  - Negative checks: tampered initData, a non-allowlisted tenant, and «متاحة أصلًا» all fall back. Metric with opId gives ok.
  - Box→CF RTT is about 30 ms.
- test2 restored and verified: trial, expiry 1796594400000 (2026-12-07), no dirty or pending flags; activities identical to baseline (مشاركة paused∞, نقاش available, واجب paused∞). Evidence is in `livetest/`.
- Rollback:
  - script: `clasp update-deployment AKfycbwlkioYyV0B9hGaB6053Khi_YReYvwXfhPSLFoB4MVtryWXZIvnWi4LRT4jasZnaF1G -V 35`
  - Worker: deploy version `e319789f-…` (Cloudflare deployments API, 100%)
  - kill switch: `ALLOWLIST=""`
  - The 0003 tables are inert if left in place.

## Update 2026-11-24 04:04 Cairo — cache-busting of the platform menu button
- Worker: admin-only `GET|POST /admin/menu-button` (getChatMenuButton / setChatMenuButton with BOT_TOKEN inside the Worker). Deployment `e319789f…`.
- Platform bot default menu button «📱 لوحة المنصة» changed `https://adabway.github.io/?r=platform` → `https://adabway.github.io/?r=platform&v=2` (same base URL, only `v`). Bump with `{"v":"3"}` next time.
- **Rollback:** `curl -sS -X POST -H "x-admin-key: $(cat .secrets/admin_key)" -H 'content-type: application/json' -d '{"url":"https://adabway.github.io/?r=platform"}' https://adab-platform-gateway.safwa-adab.workers.dev/admin/menu-button` (or run the script's `platformMiniAppSetup` from the editor).
- Note: the `/app` command's inline button (script, Part4:411) still uses the URL without `v`; `config.js` is loaded without a version param (page repo not writable from here).

## Update 2026-11-24 04:02 Cairo — why the buttons were still slow + e2e self-test (test2)
**Root cause (evidence):** it was NOT an initData/token problem. Worker observability shows every `/app/platform` request so far (incl. the "rejected at 03:41") had `user-agent: curl/8.14.1` + `Origin: https://adabway.github.io` = our own curl tests; **no browser request from Ahmed ever reached the Worker** (no browser OPTIONS preflight either). So his clicks went to the script. The live page (etag 6b04ea7d, last-modified 01:38Z = 03:38 Cairo) does contain the fast path + MINIAPP_FAST_* config (diffed identical to miniapp-patch). GitHub Pages sends `cache-control: max-age=600`, so Telegram's WebView kept the old index.html/config.js (03:41 click was 3 min after upload; WebView can cache longer than 10 min).
Checks: `verifyInitData` == `verifyMiniAppInit_` line by line (same r/t/b exclusion, `signature` kept, '+'→space, UTF-8 HMAC). Worker `BOT_TOKEN`: 46 chars, no whitespace, valid shape, `getMe` = @AutomatePrBot (id 9058869044) — the platform bot whose webhook points to the Worker. A Telegram-shaped initData signed with it (incl. `signature`, `query_id`, Arabic name) is accepted.
**Self-test (box, signed initData for owner 6107899189, Origin adabway.github.io):** suspend 413 ms round trip (server_ms 342), resume 446 ms (server_ms 379); both synced to the Sheet (`sync_result ok`, ~4 s later in background), D1 and Sheet agreed. (Script path: ~8 s.)
**test2 restored to `trial`:** the script cannot set trial via sync, so the status cell D3 of «العملاء» in the registry sheet was set back to `trial` and `/admin/pull` refreshed D1 (state: trial, pending_sync 0, dirty 0). The two self-test ops stay in `tenant_ops` (source miniapp).
**Worker changes:** added admin-only `GET /admin/token-info` (len/fingerprint/getMe, no secret). A temporary admin `mint-initdata` helper was used for the self-test and then removed (its unit test removed too); `botToken(env)` whitespace-stripping (added in parallel) kept — harmless. npm test 53/53. Redeployed (deployment `5d07f605…`); rollback = `deploy/rollback-v1/` as before.
**Ahmed's step:** close the mini-app completely and reopen it (preferably via a link with a new query like `?r=platform&v=2`, or after >10 min) then click once. Then `/admin/state` → `ops[].client_ms` shows his real timings; a browser UA in the Worker log confirms the fast path.

## Update 2026-11-24 03:10 Cairo — mini-app buttons fast path (test2 only)
**Why:** Ahmed suspends/resumes from the platform mini-app (adabway.github.io/?r=platform), not by typing. Those buttons are
NOT Telegram updates: the page `fetch`es `POST <MINIAPP_API>?b=app&r=platform {initData, action:'suspend'|'resume', id}`
straight to Apps Script (`miniAppPlatformPost_` → `miniAppPlatformStatus_`), so the Worker never saw them → 5–10 s.

**What changed**
- **Worker** (deployed 2026-11-24 03:07 Cairo, deployment `fc065680…`): new `POST /app/platform` (+ CORS `OPTIONS`, origin `MINIAPP_ORIGINS=https://adabway.github.io`).
  - Auth = same as the script: Telegram initData HMAC with the platform bot token (`BOT_TOKEN`), max age 24 h, page params r/t/b ignored (`verifyInitData` = port of `verifyMiniAppInit_`), and user id == `PLATFORM_OWNER_ID` (D1 `owner_id`).
  - Only `suspend`/`resume` with `id ∈ ALLOWLIST` (test2). Same D1 op as the typed commands (`applyLocalOp`, shared with `/suspend`), then Sheet sync via `?b=worker syncTenantStatus` in `waitUntil`.
  - Answer = script shape `{ok, tenant, message}` + `{fast:true, opId}`; `tenant` is the status part of `miniAppPlatformTenantDto_` (no license key/addons/usage — the page keeps those from the detail on screen).
  - Anything else (other tenant, other action, bad/expired initData, non-owner, stale/dirty mirror, D1 error) → `{ok:false, fallback:true, reason}` and the page calls the script as before.
  - `action:'metric' {opId, ms}` stores the click→re-render time measured by the page in `tenant_ops.client_ms`.
- **D1 migration 0002** (applied): `tenant_ops.source` ('telegram'|'miniapp'), `server_ms`, `client_ms`. `/admin/state` now also lists the last 20 ops.
- **Mini-app page** (`miniapp-patch/`, needs upload to github.com/adabway/adabway.github.io by Ahmed — no push access from here):
  - `config.js`: + `MINIAPP_FAST_API` (Worker URL) and `MINIAPP_FAST_TENANTS = ['test2']`.
  - `index.html`: «⏸ إيقاف»/«▶️ استئناف» call `statusClick()` → Worker first (4 s timeout) **only** for tenants in that list; on any non-fast answer or network error the same click goes to the script exactly as before. Other tenants: unchanged code path (`runAdmin` → script).
  - Copies also in Ahmed's Drive folder «تسريع أزرار الإيقاف والاستئناف test2 - ملفات adabway.github.io».
- **Apps Script: not changed** (still Version 35). `/exec` URL unchanged.

**Measurements (from the box)**: Worker `/app/platform` round trip (rejected initData) 80–112 ms ×5; the script's
`?b=app&r=platform` rejecting the same request (no Sheet work at all) 2.1–2.8 s ×3. Real click→render numbers: see
`/admin/state` → `ops[].client_ms` / `server_ms` after Ahmed's first clicks.

**Tests**: `npm test` → 51/51 (15 new: initData port, fast ok/resume/metric, 8 fallback cases, stale/dirty/D1 failure,
sync-down+cron retry, CORS). `node --test miniapp-patch/test/miniapp.test.cjs` → 5/5 (jsdom: test2 → Worker only,
بوابة الأدب 10 → script only, Worker fallback/down → script, no config = original behaviour).

**Rollback (any one is enough)**
1. Page: delete the two `MINIAPP_FAST_*` lines from `config.js` on GitHub (or re-upload `miniapp-patch/config.orig.js`) → page behaves exactly as before. Full revert: re-upload `miniapp-patch/index.orig.html` as `index.html`.
2. Worker: re-upload the previous code from `deploy/rollback-v1/` (same connector call as `4-upload-worker.js`, keep_bindings secret_text). Without `/app/platform` the page falls back to the script automatically.
3. `ALLOWLIST=""` disables every Worker fast path (typed commands and buttons).
The D1 columns from 0002 are additive and harmless; leave them.

---

**Status at 01:35 Cairo (historical — since then the 5 secrets were set, test2 imported, and the platform webhook now points to the Worker):**
- **Script:** Version 35 «worker sync (test2)» is live on the existing deployment `AKfycbwlkioY…aF1G`, so the /exec URL is unchanged. Version 35 = v34 + 1 line in doPost + WorkerSync.js.
- **Script Properties:** NOT set yet. `WORKER_TENANTS`, `WORKER_SYNC_SECRET` → `b=worker` answers `forbidden` until they exist.
- **Cloudflare:**
  - Worker `adab-platform-gateway` is live at https://adab-platform-gateway.safwa-adab.workers.dev.
  - D1 `adab-platform` = `ff2a00a6-f137-44c4-8d0e-1456d021a70f` (EEUR), schema applied.
  - Cron `*/5 * * * *` is set.
  - **No secrets yet**, so every `/telegram` and `/admin/*` request is rejected (401/403), and the cron does nothing.
- **Platform webhook:** NOT re-pointed (still the script).
- **Sync secret:** a value was generated in `.secrets/sync_secret` (chmod 600, never printed).
## Design
```
Telegram (platform bot) ──► Worker /telegram  (checks X-Telegram-Bot-Api-Secret-Token)
   │
   ├─ /suspend <id> | /resume <id>, private chat, sender == PLATFORM_OWNER_ID, <id> ∈ ALLOWLIST (test2)
   │     D1: dedup update_id → UPDATE tenants.status (+ tenant_ops row) → sendMessage (exact ownerCommand_ text) → 200
   │     ctx.waitUntil: POST script ?b=worker  action=syncTenantStatus  (Sheet write, cache invalidation, no Telegram message)
   │
   ├─ any problem on that path (D1 error, row missing/stale/dirty, owner id not imported) → forward to the script (as today)
   │
   └─ everything else (other clients, other commands, /activate flow, callbacks, non-owners)
         → 200 at once; ctx.waitUntil: POST the ORIGINAL body unchanged to  <WEBAPP_URL>?b=platform&k=<PLATFORM_SECRET>
cron */5: retry pending Sheet syncs → re-pull allowlisted rows + PLATFORM_OWNER_ID + graceDays_() (action=exportTenants) → prune dedup
```
- **Ported 1:1 from the script** (`src/logic.js`; each function cites its source line): `tenantLine_`, `licenseState_`, `dayKey_` (Africa/Cairo), `setTenantSuspended_` semantics, and the command parsing of `onPlatformMessage_`.
  - `/resume` sets the status to `active` even from `trial`, exactly as the script does.
  - Confirmation texts: `⏸ أُوقف (البيانات محفوظة): ` / `▶️ استُؤنف: ` followed by `tenantLine_`.
- **D1 mirror** (`schema.sql`) holds only what this path reads or writes: id, name, status, expiry, quota, setup, row, «آخر تحديث». It also keeps the sync bookkeeping: `pending_sync`, `pending_op`, `dirty`, `pulled_ms`.
- **The Sheet stays the source of truth:**
  - Every local change is pushed to it.
  - The push result (the row as the Sheet now holds it) is written back into D1.
  - A pull never overwrites a row that still has an unpushed change.
- **Conflicts:**
  - *Out-of-order pushes:* the script keeps `WORKER_LAST_OP_AT:<id>` and refuses ops older than the last applied one (`stale`).
  - *Script-side writes the Worker can't see* (`/extend`, `/quota`, `/owner`, `/addon`, `/rotate`, `/webhooks` for an allowlisted id): forwarding them marks the D1 row `dirty`. A dirty row forces a fallback to the script until the next pull.
  - *Mini-app writes (`?b=app`) and manual cell edits:* picked up by the 5-minute re-pull. A mirror older than 30 minutes (`MAX_STALE_MS`) is never used.
- **Tenant-bot side (test2's own bot):**
  - In `doPost`, the bot loads the client with `loadTenant_(tid)`, from cache `ten:<id>` (TENANT_TTL = **300 s**) and then `tenants:v1` (**120 s**). It runs `licenseState_(t)`; when that fails, it calls `blockedReply_`.
  - So test2's bot reacts to a suspend or resume only once the Sheet and those caches change.
  - `syncTenantStatus` calls `updateTenant_` (it clears `ten:<id>`, and for test2 rewrites the `tenants:v1` entry), then explicitly `invalidateTenant_` and `invalidateTenantsCache_()`. The bot therefore sees the new status on its next update, about one Apps Script cold start (~2–3 s) after the owner's reply, not after 120–300 s.
  - If the push fails, test2's bot keeps the old status until a cron retry succeeds (every 5 min). `/admin/state` shows `pending_sync` and `last_sync_error`.
  - Manual Sheet edits behave as today (up to 300 s of cache staleness), because the script has no edit trigger.

## Files
| File | Purpose |
|---|---|
| `src/index.js` | Worker entry: telegram, local path, forwarding, sync, pull, cron, admin |
| `src/logic.js` | pure ports of the script logic |
| `schema.sql` (= `migrations/0001_init.sql`) | D1 migration |
| `wrangler.toml` | D1 binding `DB`, cron, vars; account `ea0a315b…53bd`; workers.dev, no routes |
| `apps-script-worker-sync.patch` | new `?b=worker` endpoint (`syncTenantStatus`, `exportTenants`). **Not applied.** Passes `patch --dry-run` and `node --check` against the snapshot |
| `apps-script-dedup.patch` | step-2 note: script already dedupes `update_id` (still true for forwarded updates) |
| `test/` | unit tests: real SQL on `node:sqlite` emulating D1, plus mocked fetch |
| `deploy/make-connector-calls.mjs` → `deploy/calls/*.js` | exact Cloudflare-connector `execute` bodies (no secrets inside) |
| `legacy/` | the earlier forwarding-only gateway (superseded) |
| `script-snapshot/` | read-only clasp clone used for the port (push disabled) |
| `migrations/0002_tenant_ops_source.sql` | adds source/server_ms/client_ms to tenant_ops (applied 2026-11-24) |
| `miniapp-patch/` | patched `index.html` + `config.js` for adabway.github.io, originals (`*.orig.*`), diff, jsdom test |
| `deploy/rollback-v1/` | Worker code as deployed before the mini-app path |

## Secrets (names only, values never in chat or files)
| Worker secret | Value comes from |
|---|---|
| `TG_WEBHOOK_SECRET` | new random value (`A-Za-z0-9_-`, ≤256) |
| `SCRIPT_K` | Script Property `PLATFORM_SECRET` |
| `BOT_TOKEN` | Script Property `PLATFORM_BOT_TOKEN` |
| `SYNC_SECRET` | new random value; the **same** value goes into the new Script Property `WORKER_SYNC_SECRET` |
| `ADMIN_KEY` | new random value (for `/admin/*`); keep it in the vault |

There's also the new Script Property `WORKER_TENANTS = test2`. It isn't secret; it is the script-side allowlist.

## Deploy (in order; each step that changes state needs Ahmed's go)
Account check, done read-only: connector `whoami` returns 1adabway@gmail.com, and account `ea0a315b7800c4ea60e19a3a1aba53bd` has **no D1 databases, no Workers, and no workers.dev subdomain yet**.

1. **Apps Script (Muse or Ahmed):**
   - Apply `apps-script-worker-sync.patch`.
   - Add the Script Properties `WORKER_SYNC_SECRET` and `WORKER_TENANTS=test2`.
   - Deploy a **new version on the existing @34 deployment**, so `WEBAPP_URL` doesn't change. Nothing changes for existing URLs; the new branch only matches `b=worker`.
2. **Cloudflare** (connector `user-Cloudflare` → `execute`, bodies in `deploy/calls/`; or wrangler):
   1. `1-create-subdomain.js`: pick the workers.dev subdomain name (Ahmed).
   2. `2-create-d1.js` creates `adab-platform`. Put the returned `uuid` into `wrangler.toml` and into `DATABASE_ID` in calls 3 and 4.
   3. `3-apply-schema.js` (or `npx wrangler d1 migrations apply adab-platform --remote`).
   4. `4-upload-worker.js` uploads modules `index.js` + `logic.js`, D1 binding `{type:'d1',name:'DB',id}`, and the vars (or `npx wrangler deploy --env=""`).
   5. `5-enable-workers-dev.js`, then `6-cron.js` (`*/5 * * * *`).
3. **Secrets:** Ahmed enters them himself in the dashboard (Workers & Pages → adab-platform-gateway → Settings → Variables and Secrets → Add → Secret), through a screen handoff. Don't use the connector's secrets API for this, since it would put the values in the conversation. Then run `7-verify-secret-names.js`, which lists names only.
4. **First import:** `curl -X POST https://<worker>/admin/pull -H "x-admin-key: …"`, then `GET /admin/state`. You should see test2 with `pending_sync=0`, `has_owner=true`, and a recent `pulled_ms`.
5. **Re-point the platform webhook to the Worker** (needs Ahmed's explicit approval; it affects the shared platform bot):
   - `curl -X POST https://<worker>/admin/point-to-worker -H "x-admin-key: …"`. This calls `setWebhook` with url `<worker>/telegram`, `secret_token`, `allowed_updates` `["message","callback_query"]`, `max_connections:5` and `drop_pending_updates:false`, the same values as `platformSetWebhook`.
   - Check: `GET /admin/webhook-info` (the k value is redacted).

## Rollback
- **Preferred:** in the Apps Script editor, run `platformSetWebhook()`. It re-registers `WEBAPP_URL?b=platform&k=PLATFORM_SECRET` and re-sets the platform commands and menu button. Or: `POST /admin/rollback` sets the same URL without a secret_token.
- If a local suspend or resume hasn't synced yet (`/admin/state` shows `pending_sync=1`), run `/suspend test2` or `/resume test2` again after rollback; the script writes it directly.
- Optional: remove the Worker (`9-delete-worker-rollback.js`), and revert the patch by removing the `b=worker` line and `WorkerSync.js`. With no Worker calling it, the endpoint is inert.

## Measurement
- Run `npx wrangler tail adab-platform-gateway --format json` (or Workers Logs in the dashboard). Then, as owner, send `/suspend test2` and `/resume test2` 10 times each, cold and warm.
- `local_ok.replyMs` is the time from Worker receipt to Telegram `sendMessage` returning ok, i.e. the reply has been sent. `d1Ms` is the D1 read and write part. Expected: well under 1 s, roughly D1 30–150 ms plus sendMessage 100–300 ms. Compare with Muse's script figures (webhook 3.0–3.5 s, @34: 3532 / 2839 ms).
- `sync_ok.syncMs` measures the background Sheet write; it is about the old ~3 s, but nobody waits for it.
- `local_fallback.reason` counts how often the slow path was used.
- End-to-end check: the update's `message.date` vs the reply's `date` in Telegram (1 s resolution).

## Tests
`node --test test/worker.test.js legacy/gateway-worker.test.js` gives **35/35 pass** (21 new + 14 legacy). `npx wrangler deploy --dry-run --env=""` builds 19 KiB. The D1 migration was applied to a *local* wrangler D1: 7 statements OK.
