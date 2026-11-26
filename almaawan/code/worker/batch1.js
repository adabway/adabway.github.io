/**
 * Batch 1 (ALLOWLIST tenants only): tenant mini-app bootstraps from snapshots + owner-panel activity pause/resume,
 * and the platform panel bootstrap. Every doubt → {ok:false, fallback:true, reason} and the page calls the script as today.
 *
 *   POST /app/tenant?t=<tid>&r=admin|student|unified   {initData, action:'bootstrap'|'pause'|'resume'|'toggleOpen'|'metric', …}
 *   (batch 2: toggleOpen {pid, open}; pause by date {until | date | from+until} — parsed exactly like parsePauseInput)
 *   POST /app/platform                                  {initData, action:'bootstrap'}  (handled here via platformBootstrap)
 *
 * Verification: tenant bots' initData is checked with the derived key HMAC_SHA256("WebAppData", token) exported by the
 * script (?b=worker exportAppKeys) and stored AES-GCM-encrypted in D1 (key = HKDF(SYNC_SECRET)). Bot tokens never reach the Worker.
 * Sheet stays the source of truth: pauses are pushed with ?b=worker syncActivityPause (same write path as miniAppAdminPause_),
 * the mirror is re-pulled by cron (exportActivities).
 */
import { safeEqual, parseList, TENANT_ID_RE, verifyInitDataSecret, verifyInitData, actPauseDto, planFastPause, licenseState, miniAppTenantDto, DEFAULT_GRACE_DAYS, hmac, hex, enc } from './logic.js';
import { log, execBase, loadMeta, APP_JSON, allowedOrigin, corsHeaders, postScript, botToken } from './index.js';

const ROLES = ['admin', 'student', 'unified'];
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const fromHex = (h) => Uint8Array.from(String(h).match(/../g) || [], (x) => parseInt(x, 16));

// ───────── key storage (AES-GCM, key from HKDF(SYNC_SECRET)) ─────────
export async function aesKey(env) {
  if (!env.SYNC_SECRET) throw new Error('SYNC_SECRET missing');
  const base = await crypto.subtle.importKey('raw', enc.encode(String(env.SYNC_SECRET)), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('adab-app-keys'), info: enc.encode('v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function sealKey(env, hexKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), fromHex(hexKey)));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return b64(out);
}
async function openKey(env, sealed) {
  const all = unb64(sealed);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, await aesKey(env), all.slice(12)));
}
async function loadAppKey(env, tid, role) {
  const r = await env.DB.prepare('SELECT key_enc FROM app_keys WHERE tenant_id = ? AND role = ?').bind(tid, role).first();
  return r ? openKey(env, r.key_enc) : null;
}

// ───────── pulls (Sheet → D1) ─────────
export async function pullAppKeys(env, tid) {
  const r = await postScript(env, { action: 'exportAppKeys', tid });
  if (!r.ok) { log('keys_pull_failed', { tid, error: String(r.error || '').slice(0, 200) }); return { ok: false, error: r.error }; }
  const now = Date.now(), stmts = [], roles = [];
  for (const role of ROLES) {
    const k = r.keys && r.keys[role];
    if (k && /^[0-9a-f]{64}$/i.test(k)) { stmts.push(env.DB.prepare('INSERT INTO app_keys(tenant_id,role,key_enc,fetched_ms) VALUES (?,?,?,?) ON CONFLICT(tenant_id,role) DO UPDATE SET key_enc=excluded.key_enc, fetched_ms=excluded.fetched_ms').bind(tid, role, await sealKey(env, k), now)); roles.push(role); }
    else stmts.push(env.DB.prepare('DELETE FROM app_keys WHERE tenant_id = ? AND role = ?').bind(tid, role));
  }
  await env.DB.batch(stmts);
  log('keys_pull_ok', { tid, roles, mode: r.mode });
  return { ok: true, roles, mode: r.mode };
}

export async function pullActivities(env, tid) {
  const r = await postScript(env, { action: 'exportActivities', tid });
  if (!r.ok) { log('acts_pull_failed', { tid, error: String(r.error || '').slice(0, 200) }); return { ok: false, error: r.error }; }
  const now = Date.now();
  const stmts = [
    env.DB.prepare(`INSERT INTO tenant_app_meta(tenant_id,owner_id,unified,mini_app,license_ok,setup,pulled_ms) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(tenant_id) DO UPDATE SET owner_id=excluded.owner_id, unified=excluded.unified, mini_app=excluded.mini_app, license_ok=excluded.license_ok, setup=excluded.setup, pulled_ms=excluded.pulled_ms`)
      .bind(tid, String(r.ownerId || ''), r.unified ? 1 : 0, r.miniApp ? 1 : 0, r.licenseOk ? 1 : 0, String(r.setup || ''), now),
    env.DB.prepare('DELETE FROM tenant_admins WHERE tenant_id = ?').bind(tid),
    // activities that vanished from the Sheet (and have no local change in flight)
    env.DB.prepare('DELETE FROM activities WHERE tenant_id = ? AND pending_op IS NULL').bind(tid),
  ];
  // programs: upsert (an in-flight toggleOpen keeps its row), drop vanished ones
  const pids = (r.programs || []).map((p) => String(p.pid));
  stmts.push(env.DB.prepare('DELETE FROM programs WHERE tenant_id = ? AND pending_op IS NULL' + (pids.length ? ' AND pid NOT IN (' + pids.map(() => '?').join(',') + ')' : '')).bind(tid, ...pids));
  for (const p of r.programs || []) stmts.push(env.DB.prepare(`INSERT INTO programs(tenant_id,pid,name,open,pulled_ms,updated_ms) VALUES (?,?,?,?,?,?)
      ON CONFLICT(tenant_id,pid) DO UPDATE SET name=excluded.name, open=excluded.open, pulled_ms=excluded.pulled_ms,
        updated_ms=CASE WHEN programs.open IS excluded.open THEN programs.updated_ms ELSE excluded.updated_ms END
      WHERE programs.pending_op IS NULL`).bind(tid, String(p.pid), String(p.name || ''), p.open ? 1 : 0, now, now));
  for (const a of r.admins || []) stmts.push(env.DB.prepare('INSERT INTO tenant_admins(tenant_id,uid,name,programs_csv,pulled_ms) VALUES (?,?,?,?,?)').bind(tid, String(a.id), String(a.name || ''), (a.programs || []).join(','), now));
  for (const a of r.activities || []) {
    stmts.push(env.DB.prepare(`INSERT INTO activities(tenant_id,pid,akey,title,level,points,bot,paused_from_ms,paused_until_ms,pulled_ms,updated_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(tenant_id,pid,akey) DO UPDATE SET title=excluded.title, level=excluded.level, points=excluded.points, bot=excluded.bot,
        paused_from_ms=excluded.paused_from_ms, paused_until_ms=excluded.paused_until_ms, pulled_ms=excluded.pulled_ms,
        updated_ms=CASE WHEN activities.paused_from_ms IS excluded.paused_from_ms AND activities.paused_until_ms IS excluded.paused_until_ms THEN activities.updated_ms ELSE excluded.updated_ms END
      WHERE activities.pending_op IS NULL`)
      .bind(tid, String(a.pid), String(a.key), String(a.title || ''), String(a.level || ''), a.points == null ? null : Number(a.points), a.bot === false ? 0 : 1,
        a.pausedFrom == null ? null : Number(a.pausedFrom), a.pausedUntil == null ? null : Number(a.pausedUntil), now, now));
  }
  await env.DB.batch(stmts);
  log('acts_pull_ok', { tid, programs: (r.programs || []).length, activities: (r.activities || []).length, admins: (r.admins || []).length, errors: (r.errors || []).length });
  return { ok: true, programs: (r.programs || []).length, activities: (r.activities || []).length, admins: (r.admins || []).length, miniApp: !!r.miniApp, licenseOk: !!r.licenseOk, unified: !!r.unified, errors: r.errors || [] };
}

/** cron part for batch 1: retry pending pushes, then re-pull keys + activities for every ALLOWLIST tenant */
export async function scheduledBatch1(env) {
  try {
    const { results } = await env.DB.prepare('SELECT a.tenant_id, a.pid, a.akey, o.op_id, o.from_ms, o.until_ms, o.at_ms, o.actor_uid FROM activities a JOIN activity_ops o ON o.op_id = a.pending_op WHERE a.pending_op IS NOT NULL').all();
    for (const p of results || []) await syncActivityOp(env, { tid: p.tenant_id, pid: p.pid, ref: p.akey, opId: p.op_id, from: p.from_ms ?? '', until: p.until_ms ?? '', atMs: p.at_ms, actor: { id: p.actor_uid } });
  } catch (e) { log('acts_retry_error', { error: String(e?.message || e) }); }
  try {
    const { results } = await env.DB.prepare('SELECT p.tenant_id, p.pid, o.op_id, o.action, o.at_ms, o.actor_uid FROM programs p JOIN activity_ops o ON o.op_id = p.pending_op WHERE p.pending_op IS NOT NULL').all();
    for (const p of results || []) await syncProgramOp(env, { tid: p.tenant_id, pid: p.pid, opId: p.op_id, open: p.action === 'open', atMs: p.at_ms, actor: { id: p.actor_uid } });
  } catch (e) { log('open_retry_error', { error: String(e?.message || e) }); }
  for (const tid of parseList(env.ALLOWLIST)) {
    try { await pullAppKeys(env, tid); } catch (e) { log('keys_pull_error', { tid, error: String(e?.message || e) }); }
    try { await pullActivities(env, tid); } catch (e) { log('acts_pull_error', { tid, error: String(e?.message || e) }); }
  }
  try { await env.DB.prepare('DELETE FROM app_snapshots WHERE built_ms < ?').bind(Date.now() - 7 * 86400000).run(); } catch { /* ignore */ }
}

// ───────── snapshots (stale-while-revalidate of the script's own bootstrap answer) ─────────
async function scriptApp(env, query, bodyText) {
  const res = await fetch(execBase(env) + query, {
    method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: bodyText, redirect: 'follow',
    signal: AbortSignal.timeout(Number(env.FORWARD_TIMEOUT_MS || 25000)),
  }); // 302 → GET googleusercontent with the JSON
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return { ok: false, error: 'non-json HTTP ' + res.status }; }
}

async function revalidate(env, key, query, bodyText) {
  const t0 = Date.now();
  // one revalidation per key at a time (20 s window)
  const claim = await env.DB.prepare('UPDATE app_snapshots SET revalidating_ms = ? WHERE tenant_id = ? AND panel = ? AND uid = ? AND (revalidating_ms IS NULL OR revalidating_ms < ?)')
    .bind(t0, key.tid, key.panel, key.uid, t0 - 20000).run();
  const exists = await env.DB.prepare('SELECT 1 AS x FROM app_snapshots WHERE tenant_id = ? AND panel = ? AND uid = ?').bind(key.tid, key.panel, key.uid).first();
  if (exists && !(claim.meta && claim.meta.changes)) return { skipped: true };
  let r;
  try { r = await scriptApp(env, query, bodyText); } catch (e) { r = { ok: false, error: String(e?.message || e) }; }
  if (r && r.ok) {
    await env.DB.prepare(`INSERT INTO app_snapshots(tenant_id,panel,uid,payload_json,built_ms,revalidating_ms) VALUES (?,?,?,?,?,NULL)
      ON CONFLICT(tenant_id,panel,uid) DO UPDATE SET payload_json=excluded.payload_json, built_ms=excluded.built_ms, revalidating_ms=NULL`)
      .bind(key.tid, key.panel, key.uid, JSON.stringify(r), Date.now()).run();
    log('snap_ok', { tid: key.tid, panel: key.panel, scriptMs: Date.now() - t0 });
  } else {
    await env.DB.prepare('UPDATE app_snapshots SET revalidating_ms = NULL WHERE tenant_id = ? AND panel = ? AND uid = ?').bind(key.tid, key.panel, key.uid).run().catch(() => {});
    log('snap_failed', { tid: key.tid, panel: key.panel, error: String(r && (r.error || r.code) || '').slice(0, 120), scriptMs: Date.now() - t0 });
  }
  return r;
}

/** owner/admin panel: activity labels from D1 when D1 changed after the snapshot was built */
async function programsChangedSince(env, tid, builtMs) {
  const { results } = await env.DB.prepare('SELECT pid, open FROM programs WHERE tenant_id = ? AND updated_ms > ?').bind(tid, builtMs).all();
  return results || [];
}
async function overlayActivities(env, tid, payload, builtMs) {
  if (!payload || !Array.isArray(payload.programs)) return payload;
  for (const row of await programsChangedSince(env, tid, builtMs)) {
    const p = payload.programs.find((x) => x.id === row.pid);
    if (p && 'open' in p) p.open = !!row.open;
  }
  const { results } = await env.DB.prepare('SELECT pid, akey, paused_from_ms, paused_until_ms, updated_ms FROM activities WHERE tenant_id = ? AND updated_ms > ?').bind(tid, builtMs).all();
  if (!results || !results.length) return payload;
  const now = Date.now();
  for (const p of payload.programs) for (const a of p.activities || []) {
    const row = results.find((x) => x.pid === p.id && x.akey === a.key);
    if (row) Object.assign(a, actPauseDto({ pausedFrom: row.paused_from_ms, pausedUntil: row.paused_until_ms }, now));
  }
  return payload;
}

async function serveSnapshot(env, ctx, key, query, bodyText, overlay) {
  const row = await env.DB.prepare('SELECT payload_json, built_ms FROM app_snapshots WHERE tenant_id = ? AND panel = ? AND uid = ?').bind(key.tid, key.panel, key.uid).first();
  ctx.waitUntil(revalidate(env, key, query, bodyText).catch((e) => log('snap_error', { error: String(e?.message || e) })));
  if (!row) return null;
  let payload = JSON.parse(row.payload_json);
  if (overlay) payload = await overlay(payload, Number(row.built_ms));
  if (!payload) return { vetoed: true };
  const age = Date.now() - Number(row.built_ms);
  return { ...payload, ok: true, fast: true, builtAt: Number(row.built_ms), stale: age > Number(env.SNAPSHOT_STALE_MS || 60000) };
}

// ───────── platform panel bootstrap (called from handleMiniApp after initData + owner check) ─────────
export async function platformBootstrap(env, ctx, { uid, bodyText, body, meta }) {
  if (!parseList(env.ALLOWLIST).length) return { fallback: 'disabled' };
  if (String(body.q || '').trim()) return { fallback: 'search' }; // search results are not snapshotted
  const overlay = async (payload) => {
    if (!Array.isArray(payload.tenants)) return payload;
    const ids = parseList(env.ALLOWLIST), now = Date.now(), grace = Number(meta.grace_days ?? DEFAULT_GRACE_DAYS);
    for (const t of payload.tenants) {
      if (!ids.includes(String(t.id))) continue;
      const r = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(t.id).first();
      if (r) Object.assign(t, miniAppTenantDto({ id: r.id, name: r.name, status: r.status, expiry: r.expiry_ms == null ? null : Number(r.expiry_ms), quota: r.quota == null ? 3 : Number(r.quota), setup: r.setup || '' }, grace, now));
    }
    return payload;
  };
  const snap = await serveSnapshot(env, ctx, { tid: '_platform', panel: 'platform', uid }, '?b=app&r=platform', bodyText, overlay);
  return snap ? { answer: snap } : { fallback: 'no snapshot' };
}

// ───────── tenant panels ─────────
async function adminOf(env, tid, meta, uid) {
  if (meta.owner_id && safeEqual(uid, meta.owner_id)) return { owner: true, programs: [] };
  const a = await env.DB.prepare('SELECT programs_csv FROM tenant_admins WHERE tenant_id = ? AND uid = ?').bind(tid, uid).first();
  return a ? { owner: false, programs: String(a.programs_csv || '').split(',').filter(Boolean) } : null;
}
const canAccess = (adm, pid) => !!adm && (adm.owner || !adm.programs.length || adm.programs.includes(pid));

export async function handleTenantApp(request, env, ctx, url) {
  const receivedAt = Date.now();
  const origin = allowedOrigin(env, request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== 'POST') return APP_JSON({ ok: false, fallback: true, reason: 'method' }, origin, 405);
  const fb = (reason, extra = {}) => { log('tapp_fallback', { reason, ...extra }); return APP_JSON({ ok: false, fallback: true, reason }, origin); };
  const tid = String(url.searchParams.get('t') || '').toLowerCase(), role = String(url.searchParams.get('r') || '');
  if (!TENANT_ID_RE.test(tid) || !parseList(env.ALLOWLIST).includes(tid)) return fb('not allowlisted');
  if (!ROLES.includes(role)) return fb('bad role');
  const bodyText = await request.text();
  let body; try { body = JSON.parse(bodyText); } catch { return fb('bad json'); }
  if (!body || typeof body !== 'object') return fb('bad body');
  const action = String(body.action || 'bootstrap');

  let key; try { key = await loadAppKey(env, tid, role); } catch { return fb('key read'); }
  if (!key) return fb('no key', { tid, role });
  let v; try { v = await verifyInitDataSecret(body.initData, key); } catch { return fb('verify error'); }
  if (!v.ok) return fb('initData ' + v.reason, { tid, role });

  let meta, t, pm;
  try {
    meta = await env.DB.prepare('SELECT * FROM tenant_app_meta WHERE tenant_id = ?').bind(tid).first();
    t = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(tid).first();
    pm = await loadMeta(env);
  } catch { return fb('d1 read'); }
  if (!meta || !t) return fb('not mirrored');
  if (Date.now() - Number(meta.pulled_ms || 0) > Number(env.MAX_STALE_MS || 1800000)) return fb('stale mirror');
  const lic = licenseState({ id: t.id, status: t.status, expiry: t.expiry_ms == null ? null : Number(t.expiry_ms) }, Number(pm.grace_days ?? DEFAULT_GRACE_DAYS));
  if (!lic.ok || !meta.license_ok || !meta.mini_app || meta.setup !== 'done' || t.dirty || t.pending_sync) return fb('tenant state'); // script shows paused/disabled/not_ready

  const adm = (role === 'admin' || meta.unified) ? await adminOf(env, tid, meta, v.uid) : null;
  if (role === 'admin' && !adm) return fb('not admin'); // script answers forbidden as today

  if (action === 'bootstrap') {
    const q = '?b=app&t=' + encodeURIComponent(tid) + '&r=' + encodeURIComponent(role);
    const overlay = adm ? (p, b) => overlayActivities(env, tid, p, b)
      : async (p, b) => ((await programsChangedSince(env, tid, b)).length ? null : p); // student DTO derives more from «open»
    const snap = await serveSnapshot(env, ctx, { tid, panel: role, uid: v.uid }, q, bodyText, overlay);
    if (!snap) return fb('no snapshot', { tid, role });
    if (snap.vetoed) return fb('program changed', { tid, role });
    log('tapp_boot', { tid, role, stale: snap.stale, ageMs: Date.now() - snap.builtAt, serverMs: Date.now() - receivedAt });
    return APP_JSON(snap, origin);
  }
  if (action === 'metric') {
    const ms = Math.round(Number(body.ms));
    if (!adm || !(ms >= 0 && ms < 120000) || typeof body.opId !== 'string') return fb('bad metric');
    await env.DB.prepare('UPDATE activity_ops SET client_ms = ? WHERE op_id = ? AND tenant_id = ?').bind(ms, body.opId, tid).run().catch(() => {});
    return APP_JSON({ ok: true }, origin);
  }
  if (action === 'toggleOpen') {
    if (!adm) return fb('not admin');
    const pid = String(body.pid || '');
    if (!pid || !canAccess(adm, pid)) return fb('no access');
    const want = body.open === true || body.open === 'true' || body.open === 1;
    const op = await applyProgramOp(env, { tid, pid, open: want, uid: v.uid, user: v.user });
    if (!op.handled) return fb(op.reason, { tid, pid });
    const serverMs = Date.now() - receivedAt;
    log('tapp_ok', { tid, pid, action, d1Ms: op.d1Ms, serverMs, opId: op.opId });
    ctx.waitUntil(env.DB.prepare('UPDATE activity_ops SET server_ms = ? WHERE op_id = ?').bind(serverMs, op.opId).run().catch(() => {}));
    ctx.waitUntil(syncProgramOp(env, { tid, pid, opId: op.opId, open: want, atMs: op.atMs, actor: op.actor }).catch((e) => log('open_sync_error', { error: String(e?.message || e) })));
    return APP_JSON({ ok: true, fast: true, opId: op.opId, open: want, message: '✅ البرنامج الآن ' + (want ? 'مفتوح 🟢' : 'مغلق ⚪️') }, origin);
  }
  if (action !== 'pause' && action !== 'resume') return fb('action not handled');
  if (!adm) return fb('not admin');
  const pid = String(body.pid || ''), ref = String(body.activity || '');
  if (!pid || !ref || !canAccess(adm, pid)) return fb('no access');
  const op = await applyActivityOp(env, { tid, pid, ref, resume: action === 'resume', body, uid: v.uid, user: v.user });
  if (!op.handled) return fb(op.reason, { tid, pid });
  const serverMs = Date.now() - receivedAt;
  log('tapp_ok', { tid, pid, action, d1Ms: op.d1Ms, serverMs, opId: op.opId });
  ctx.waitUntil(env.DB.prepare('UPDATE activity_ops SET server_ms = ? WHERE op_id = ?').bind(serverMs, op.opId).run().catch(() => {}));
  ctx.waitUntil(syncActivityOp(env, { tid, pid, ref, opId: op.opId, from: op.from, until: op.until, atMs: op.atMs, actor: op.actor, label: op.label }).catch((e) => log('acts_sync_error', { error: String(e?.message || e) })));
  return APP_JSON({ ok: true, fast: true, opId: op.opId, activity: ref, label: op.label, message: '✅ حُفظ: «' + ref + '» — ' + op.label, act: op.dto }, origin);
}

/** D1 write for one fast pause/resume. {handled:false, reason} → script. */
export async function applyActivityOp(env, { tid, pid, ref, resume, body, uid, user, action }) {
  const t0 = Date.now();
  let row, prog;
  try {
    prog = await env.DB.prepare('SELECT pid FROM programs WHERE tenant_id = ? AND pid = ?').bind(tid, pid).first();
    row = await env.DB.prepare('SELECT a.*, (SELECT MAX(at_ms) FROM activity_ops o WHERE o.tenant_id = a.tenant_id AND o.pid = a.pid AND o.akey = a.akey) AS last_op_at FROM activities a WHERE a.tenant_id = ? AND a.pid = ? AND a.akey = ?').bind(tid, pid, ref).first();
  } catch (e) { return { handled: false, reason: 'd1 read: ' + String(e?.message || e) }; }
  if (!prog) return { handled: false, reason: 'program not mirrored' };
  if (!row) return { handled: false, reason: 'activity not mirrored' };
  if (row.pending_op) return { handled: false, reason: 'pending op' };
  if (Date.now() - Number(row.pulled_ms || 0) > Number(env.MAX_STALE_MS || 1800000)) return { handled: false, reason: 'stale mirror' };
  const now = Date.now();
  let plan;
  if (action === 'restore') plan = { from: body.from ?? '', until: body.until ?? '', label: 'restore' };
  else {
    plan = planFastPause(body || {}, resume, now);
    if (!plan) return { handled: false, reason: 'date pause' };
    // «متاحة أصلًا» is only trusted from the Sheet (the mirror can be up to 5 min behind a bot change) → script
    if (resume && row.paused_from_ms == null && row.paused_until_ms == null) return { handled: false, reason: 'already available?' };
  }
  const atMs = Math.max(now, Number(row.last_op_at || 0) + 1);
  const opId = crypto.randomUUID();
  const from = plan.from === '' ? null : Number(plan.from), until = plan.until === '' ? null : Number(plan.until);
  const before = JSON.stringify({ from: row.paused_from_ms, until: row.paused_until_ms });
  try {
    const res = await env.DB.batch([
      env.DB.prepare('UPDATE activities SET paused_from_ms = ?, paused_until_ms = ?, pending_op = ?, updated_ms = ? WHERE tenant_id = ? AND pid = ? AND akey = ? AND pending_op IS NULL').bind(from, until, opId, now, tid, pid, ref),
      env.DB.prepare('INSERT INTO activity_ops(op_id,tenant_id,pid,akey,action,from_ms,until_ms,before_json,actor_uid,at_ms) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(opId, tid, pid, ref, action || (resume ? 'resume' : 'pause'), from, until, before, String(uid || ''), atMs),
    ]);
    if (!(res[0].meta && res[0].meta.changes)) throw new Error('row changed');
  } catch (e) { return { handled: false, reason: 'd1 write: ' + String(e?.message || e) }; }
  const u = user || {};
  return { handled: true, opId, atMs, from: plan.from, until: plan.until, label: plan.label, dto: actPauseDto({ pausedFrom: from, pausedUntil: until }, Date.now()), d1Ms: Date.now() - t0,
    actor: { id: String(uid || ''), first_name: u.first_name || '', last_name: u.last_name || '', username: u.username || '' } };
}

/** D1 → Sheet for one op (same write path as miniAppAdminPause_). Clears pending only if still ours. */
export async function syncActivityOp(env, { tid, pid, ref, opId, from, until, atMs, actor, label }) {
  const t0 = Date.now();
  let r;
  try { r = await postScript(env, { action: 'syncActivityPause', tid, pid, ref, from: from ?? '', until: until ?? '', opId, atMs, actor, ...(label && label !== 'restore' ? { label } : {}) }); }
  catch (e) { r = { ok: false, error: String(e?.message || e) }; }
  const now = Date.now();
  if (r.ok) {
    const stmts = [env.DB.prepare('UPDATE activity_ops SET synced_ms = ?, sync_result = ? WHERE op_id = ?').bind(now, r.stale ? 'stale-skipped' : 'ok', opId)];
    if (r.activity) stmts.push(env.DB.prepare('UPDATE activities SET paused_from_ms = ?, paused_until_ms = ?, pulled_ms = ?, updated_ms = ?, pending_op = NULL, last_sync_ms = ?, last_sync_error = NULL WHERE tenant_id = ? AND pid = ? AND akey = ? AND pending_op = ?')
      .bind(r.activity.pausedFrom, r.activity.pausedUntil, now, now, now, tid, pid, ref, opId));
    await env.DB.batch(stmts);
    log('acts_sync_ok', { tid, pid, opId, stale: !!r.stale, syncMs: now - t0 });
  } else if (isTerminal(r.error)) {
    const op = await env.DB.prepare('SELECT before_json FROM activity_ops WHERE op_id = ?').bind(opId).first();
    let b = {}; try { b = JSON.parse(op?.before_json || '{}'); } catch { /* keep {} */ }
    await env.DB.batch([
      env.DB.prepare('UPDATE activity_ops SET synced_ms = ?, sync_result = ? WHERE op_id = ?').bind(now, 'rejected: ' + String(r.error).slice(0, 200), opId),
      env.DB.prepare('UPDATE activities SET paused_from_ms = ?, paused_until_ms = ?, updated_ms = ?, pending_op = NULL, last_sync_ms = ?, last_sync_error = ? WHERE tenant_id = ? AND pid = ? AND akey = ? AND pending_op = ?')
        .bind(b.from ?? null, b.until ?? null, now, now, String(r.error).slice(0, 300), tid, pid, ref, opId),
    ]);
    log('acts_sync_rejected', { tid, pid, opId, error: String(r.error || '').slice(0, 300), syncMs: now - t0 });
  } else {
    await env.DB.prepare('UPDATE activities SET last_sync_error = ? WHERE tenant_id = ? AND pid = ? AND akey = ? AND pending_op = ?').bind(String(r.error || 'unknown').slice(0, 300), tid, pid, ref, opId).run();
    log('acts_sync_failed', { tid, pid, opId, error: String(r.error || '').slice(0, 300), syncMs: now - t0 });
  }
  return r;
}

/** the script refused the change itself (not a network/timeout problem): retrying cannot help */
const isTerminal = (e) => /^(invalid|activity not found|program not found|tenant not (allowed|found))/.test(String(e || ''));

/** D1 write for one fast toggleOpen. {handled:false, reason} → script. */
export async function applyProgramOp(env, { tid, pid, open, uid, user, action }) {
  const t0 = Date.now();
  let row;
  try {
    row = await env.DB.prepare("SELECT p.*, (SELECT MAX(at_ms) FROM activity_ops o WHERE o.tenant_id = p.tenant_id AND o.pid = p.pid AND o.akey = '#open') AS last_op_at FROM programs p WHERE p.tenant_id = ? AND p.pid = ?").bind(tid, pid).first();
  } catch (e) { return { handled: false, reason: 'd1 read: ' + String(e?.message || e) }; }
  if (!row) return { handled: false, reason: 'program not mirrored' };
  if (row.pending_op) return { handled: false, reason: 'pending op' };
  if (Date.now() - Number(row.pulled_ms || 0) > Number(env.MAX_STALE_MS || 1800000)) return { handled: false, reason: 'stale mirror' };
  // «أصلًا مفتوح/مغلق» is only trusted from the Sheet (the mirror can be minutes behind a bot change) → script
  if (action !== 'restore' && !!row.open === !!open) return { handled: false, reason: 'already ' + (open ? 'open' : 'closed') + '?' };
  const now = Date.now(), atMs = Math.max(now, Number(row.last_op_at || 0) + 1), opId = crypto.randomUUID();
  try {
    const res = await env.DB.batch([
      env.DB.prepare('UPDATE programs SET open = ?, pending_op = ?, updated_ms = ? WHERE tenant_id = ? AND pid = ? AND pending_op IS NULL').bind(open ? 1 : 0, opId, now, tid, pid),
      env.DB.prepare("INSERT INTO activity_ops(op_id,tenant_id,pid,akey,action,before_json,actor_uid,at_ms) VALUES (?,?,?,'#open',?,?,?,?)").bind(opId, tid, pid, open ? 'open' : 'close', JSON.stringify({ open: !!row.open }), String(uid || ''), atMs),
    ]);
    if (!(res[0].meta && res[0].meta.changes)) throw new Error('row changed');
  } catch (e) { return { handled: false, reason: 'd1 write: ' + String(e?.message || e) }; }
  const u = user || {};
  return { handled: true, opId, atMs, d1Ms: Date.now() - t0,
    actor: { id: String(uid || ''), first_name: u.first_name || '', last_name: u.last_name || '', username: u.username || '' } };
}

/** D1 → Sheet for one toggleOpen (same write path as miniAppAdminToggleOpen_). */
export async function syncProgramOp(env, { tid, pid, opId, open, atMs, actor }) {
  const t0 = Date.now();
  let r;
  try { r = await postScript(env, { action: 'syncProgramOpen', tid, pid, open: !!open, opId, atMs, actor }); }
  catch (e) { r = { ok: false, error: String(e?.message || e) }; }
  const now = Date.now();
  if (r.ok) {
    await env.DB.batch([
      env.DB.prepare('UPDATE activity_ops SET synced_ms = ?, sync_result = ? WHERE op_id = ?').bind(now, r.stale ? 'stale-skipped' : (r.same ? 'ok-same' : 'ok'), opId),
      env.DB.prepare('UPDATE programs SET open = ?, pulled_ms = ?, updated_ms = ?, pending_op = NULL, last_sync_error = NULL WHERE tenant_id = ? AND pid = ? AND pending_op = ?').bind(r.open ? 1 : 0, now, now, tid, pid, opId),
    ]);
    log('open_sync_ok', { tid, pid, opId, stale: !!r.stale, syncMs: now - t0 });
  } else if (isTerminal(r.error)) {
    const op = await env.DB.prepare('SELECT before_json FROM activity_ops WHERE op_id = ?').bind(opId).first();
    let b = {}; try { b = JSON.parse(op?.before_json || '{}'); } catch { /* keep {} */ }
    await env.DB.batch([
      env.DB.prepare('UPDATE activity_ops SET synced_ms = ?, sync_result = ? WHERE op_id = ?').bind(now, 'rejected: ' + String(r.error).slice(0, 200), opId),
      env.DB.prepare('UPDATE programs SET open = ?, updated_ms = ?, pending_op = NULL, last_sync_error = ? WHERE tenant_id = ? AND pid = ? AND pending_op = ?').bind(b.open ? 1 : 0, now, String(r.error).slice(0, 300), tid, pid, opId),
    ]);
    log('open_sync_rejected', { tid, pid, opId, error: String(r.error || '').slice(0, 300) });
  } else {
    await env.DB.prepare('UPDATE programs SET last_sync_error = ? WHERE tenant_id = ? AND pid = ? AND pending_op = ?').bind(String(r.error || 'unknown').slice(0, 300), tid, pid, opId).run();
    log('open_sync_failed', { tid, pid, opId, error: String(r.error || '').slice(0, 300), syncMs: now - t0 });
  }
  return r;
}

// ───────── admin helpers (x-admin-key checked by the caller) ─────────
/** Telegram-shaped initData signed inside the Worker, expiring 10 min after minting. role 'platform' uses BOT_TOKEN. */
export async function mintInitData(env, { tid, role, uid }) {
  let secret;
  if (role === 'platform') secret = await hmac(enc.encode('WebAppData'), botToken(env));
  else secret = await loadAppKey(env, tid, role);
  if (!secret) return { ok: false, error: 'no key' };
  const user = JSON.stringify({ id: Number(uid), first_name: 'اختبار', last_name: 'Worker', username: 'selftest', language_code: 'ar', allows_write_to_pm: true });
  const f = { auth_date: String(Math.floor(Date.now() / 1000) - 86400 + 600), query_id: 'AAselftest', signature: 'c2VsZnRlc3Q', user };
  const dcs = Object.keys(f).sort().map((k) => k + '=' + f[k]).join('\n');
  const hash = hex(await hmac(secret, dcs));
  return { ok: true, initData: Object.keys(f).map((k) => k + '=' + encodeURIComponent(f[k])).join('&') + '&hash=' + hash };
}

export async function appState(env, tid) {
  const q = (sql, ...a) => env.DB.prepare(sql).bind(...a).all().then((r) => r.results);
  return {
    ok: true,
    meta: await env.DB.prepare("SELECT (owner_id IS NOT NULL AND owner_id != '') AS has_owner, unified, mini_app, license_ok, setup, pulled_ms FROM tenant_app_meta WHERE tenant_id = ?").bind(tid).first(),
    keys: await q('SELECT role, fetched_ms FROM app_keys WHERE tenant_id = ?', tid),
    programs: await q('SELECT pid, name, open, updated_ms, pending_op, last_sync_error FROM programs WHERE tenant_id = ?', tid),
    admins: (await q('SELECT COUNT(*) AS n FROM tenant_admins WHERE tenant_id = ?', tid))[0].n,
    activities: await q('SELECT pid, akey, paused_from_ms, paused_until_ms, pulled_ms, updated_ms, pending_op, last_sync_error FROM activities WHERE tenant_id = ?', tid),
    ops: await q('SELECT op_id, pid, akey, action, from_ms, until_ms, before_json, at_ms, server_ms, client_ms, synced_ms, sync_result FROM activity_ops WHERE tenant_id = ? ORDER BY at_ms DESC LIMIT 20', tid),
    snapshots: await q('SELECT tenant_id, panel, length(payload_json) AS bytes, built_ms FROM app_snapshots WHERE tenant_id IN (?, ?)', tid, '_platform'),
  };
}
