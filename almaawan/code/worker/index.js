/**
 * adab-platform-gateway — Cloudflare Worker in front of the PLATFORM bot.
 *
 * /telegram (secret header verified):
 *   - /suspend <id> | /resume <id> from the platform owner, <id> in ALLOWLIST → handled here:
 *       D1 write → confirmation text identical to ownerCommand_ → 200; Sheet sync in ctx.waitUntil.
 *   - anything else (other commands, other clients, callbacks, non-owners) → 200 at once, and the
 *     ORIGINAL body is POSTed unchanged to <SCRIPT_EXEC_URL>?b=platform&k=<SCRIPT_K> in ctx.waitUntil.
 *   - any D1 / validation problem on the local path → falls back to forwarding (script answers as today).
 * scheduled (cron): retry pending Sheet syncs, re-pull allowlisted rows + owner id + grace days, prune dedup.
 * /app/platform (mini-app, initData-signed): «⏸ إيقاف» / «▶️ استئناف» for ALLOWLIST tenants via the same D1 op; else {fallback:true}.
 * /admin/* (x-admin-key): webhook-info, point-to-worker, rollback, pull, state.
 *
 * Secrets: TG_WEBHOOK_SECRET, SCRIPT_K (=PLATFORM_SECRET), BOT_TOKEN (=PLATFORM_BOT_TOKEN), SYNC_SECRET (=WORKER_SYNC_SECRET), ADMIN_KEY
 * Binding: DB (D1).  Vars: SCRIPT_EXEC_URL, ALLOWLIST, MAX_STALE_MS, FORWARD_TIMEOUT_MS, FAILURE_NOTICE
 */
import { handleTenantApp, platformBootstrap, scheduledBatch1, pullAppKeys, pullActivities, mintInitData, appState, applyActivityOp, syncActivityOp, applyProgramOp, syncProgramOp } from './batch1.js';
import { handleTenantTelegram, botPull, botState, botPoint, botSim } from './batch2a.js';
import { safeEqual, parsePlatformUpdate, classify, nextStatus, confirmationText, parseList, DEFAULT_GRACE_DAYS, TENANT_ID_RE, verifyInitData, miniAppTenantDto } from './logic.js';

export const FAILURE_TEXT = 'تعذّر إتمام طلبك الآن، حاول مرة أخرى بعد قليل';
const TG_API = 'https://api.telegram.org/bot';
const ALLOWED_UPDATES = ['message', 'callback_query']; // platformSetWebhook (Part4:821)
const PLATFORM_MAX_CONNECTIONS = 5;                    // platformSetWebhook

export const log = (event, data = {}) => console.log(JSON.stringify({ event, ts: Date.now(), ...data })); // never secrets

// ───────── URLs ─────────
export function execBase(env) {
  const base = String(env.SCRIPT_EXEC_URL || '');
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(base)) throw new Error('SCRIPT_EXEC_URL must end with /exec');
  return base;
}
/** Same URL platformSetWebhook registers: WEBAPP_URL?b=platform&k=PLATFORM_SECRET */
export function platformUrl(env) {
  if (!env.SCRIPT_K) throw new Error('SCRIPT_K missing');
  return execBase(env) + '?b=platform&k=' + encodeURIComponent(env.SCRIPT_K);
}
/** New endpoint from apps-script-worker-sync.patch: WEBAPP_URL?b=worker&k=WORKER_SYNC_SECRET */
export function syncUrl(env) {
  if (!env.SYNC_SECRET) throw new Error('SYNC_SECRET missing');
  return execBase(env) + '?b=worker&k=' + encodeURIComponent(env.SYNC_SECRET);
}
export const redactUrl = (u) => String(u || '').replace(/([?&]k=)[^&]*/, '$1***');

// ───────── Telegram ─────────
export async function tg(env, method, payload) {
  if (!env.BOT_TOKEN) throw new Error('BOT_TOKEN missing');
  const res = await fetch(TG_API + env.BOT_TOKEN + '/' + method, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}),
  });
  try { return await res.json(); } catch { return { ok: false, description: 'HTTP ' + res.status }; }
}
/** send_ (Part3:1796) payload shape */
const sendText = (env, chatId, text) => tg(env, 'sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });

/** Apps Script HtmlService wraps out_('…') inside a ~9 KB page as …userHtml\x22:\x22<text>\x22… ; return that text, else the raw body. */
export function scriptReplyText(body) {
  const m = /userHtml\\x22:\\x22(.*?)\\x22/.exec(body || '');
  return m ? m[1] : String(body || '');
}

// ───────── forwarding (unchanged behaviour for everything not handled locally) ─────────
export async function forwardToScript(env, rawBody) {
  const started = Date.now();
  const signal = AbortSignal.timeout(Number(env.FORWARD_TIMEOUT_MS || 25000));
  let res;
  try {
    res = await fetch(platformUrl(env), { method: 'POST', headers: { 'content-type': 'application/json' }, body: rawBody, redirect: 'manual', signal });
  } catch (e) {
    const timeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return { ok: false, status: 0, ms: Date.now() - started, reason: timeout ? 'timeout' : 'network' };
  }
  let body = '';
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location'); // doPost already ran; body is informative only
    if (loc) { try { body = (await (await fetch(loc, { redirect: 'follow', signal })).text()).slice(0, 20000); } catch { /* ignore */ } }
  } else { try { body = (await res.text()).slice(0, 20000); } catch { /* ignore */ } }
  const ms = Date.now() - started;
  body = scriptReplyText(body);
  if (res.status >= 400) return { ok: false, status: res.status, ms, reason: 'http ' + res.status };
  if (/(^|[^a-z])forbidden([^a-z]|$)/i.test(body)) return { ok: false, status: res.status, ms, reason: 'script forbidden (check SCRIPT_K)' };
  return { ok: true, status: res.status, ms, tag: /(^|[^a-z])dup([^a-z]|$)/.test(body) ? 'dup' : 'ok' };
}

async function forwardInBackground(env, rawBody, update, receivedAt, why) {
  const fwd = await forwardToScript(env, rawBody);
  if (fwd.ok) { log('forward_ok', { updateId: update?.update_id, why, status: fwd.status, tag: fwd.tag, forwardMs: fwd.ms, totalMs: Date.now() - receivedAt }); return fwd; }
  log('forward_failed', { updateId: update?.update_id, why, status: fwd.status, reason: fwd.reason, forwardMs: fwd.ms });
  const m = update?.message;
  if (String(env.FAILURE_NOTICE || 'on') === 'on' && m?.chat?.type === 'private') {
    try { await sendText(env, m.chat.id, FAILURE_TEXT); } catch (e) { log('failure_msg_error', { error: String(e?.message || e) }); }
  }
  return fwd;
}

// ───────── D1 ─────────
const rowToTenant = (r) => r && ({ id: r.id, name: r.name, status: r.status, expiry: r.expiry_ms == null ? null : Number(r.expiry_ms), quota: r.quota == null ? 3 : Number(r.quota), setup: r.setup || '' });

export async function loadMeta(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM platform_meta').all();
  const m = {}; for (const r of results || []) m[r.key] = r.value;
  return m;
}

/**
 * Shared local op (used by the Telegram command path and the mini-app path).
 * Checks owner / mirror freshness, dedups update_id (if any), writes D1 (tenants + tenant_ops).
 * Returns {handled:false, reason} (→ caller falls back to the script) or
 * {handled:true, dup?, before, after, graceDays, opId, atMs, d1Ms}. Nothing user-visible happens here.
 */
export async function applyLocalOp(env, { tid, action, uid, updateId = null, source = 'telegram' }) {
  const t0 = Date.now();
  const allowlist = parseList(env.ALLOWLIST);
  if (!allowlist.includes(tid)) return { handled: false, reason: 'not allowlisted' };
  let meta, row;
  try {
    meta = await loadMeta(env);
    row = await env.DB.prepare('SELECT t.*, (SELECT MAX(at_ms) FROM tenant_ops o WHERE o.tenant_id = t.id) AS last_op_at FROM tenants t WHERE t.id = ?').bind(tid).first();
  } catch (e) { return { handled: false, reason: 'd1 read: ' + String(e?.message || e) }; }
  const maxStale = Number(env.MAX_STALE_MS || 1800000);
  if (!meta.owner_id) return { handled: false, reason: 'no owner_id imported' };
  if (!safeEqual(uid, meta.owner_id)) return { handled: false, reason: 'not owner' }; // script answers, as today
  if (!row) return { handled: false, reason: 'tenant not in D1' };
  if (row.dirty) return { handled: false, reason: 'tenant dirty (re-pull pending)' };
  if (!row.pulled_ms || Date.now() - Number(row.pulled_ms) > maxStale) return { handled: false, reason: 'tenant mirror stale' };
  const graceDays = meta.grace_days != null && meta.grace_days !== '' ? Number(meta.grace_days) : DEFAULT_GRACE_DAYS;

  // dedup (only for Telegram updates handled here; forwarded ones keep the script's own pupd: dedup)
  if (updateId != null) {
    try {
      const ins = await env.DB.prepare('INSERT OR IGNORE INTO processed_updates(update_id, at_ms) VALUES (?, ?)').bind(updateId, Date.now()).run();
      if (ins.meta && ins.meta.changes === 0) { log('dup', { updateId }); return { handled: true, dup: true }; }
    } catch (e) { return { handled: false, reason: 'd1 dedup: ' + String(e?.message || e) }; }
  }

  const before = rowToTenant(row);
  const to = nextStatus(action);
  const opId = crypto.randomUUID();
  const atMs = Math.max(Date.now(), Number(row.last_op_at || 0) + 1); // strictly increasing per tenant → script can order ops
  try {
    await env.DB.batch([
      env.DB.prepare('UPDATE tenants SET status = ?, pending_sync = 1, pending_op = ? WHERE id = ?').bind(to, opId, tid),
      env.DB.prepare('INSERT INTO tenant_ops(op_id, tenant_id, action, from_status, to_status, update_id, at_ms, source) VALUES (?,?,?,?,?,?,?,?)')
        .bind(opId, tid, action, before.status, to, updateId, atMs, source),
    ]);
  } catch (e) {
    try { if (updateId != null) await env.DB.prepare('DELETE FROM processed_updates WHERE update_id = ?').bind(updateId).run(); } catch { /* ignore */ }
    return { handled: false, reason: 'd1 write: ' + String(e?.message || e) };
  }
  return { handled: true, before, after: { ...before, status: to }, graceDays, opId, atMs, d1Ms: Date.now() - t0 };
}

/**
 * Local handling of /suspend|/resume. Returns {handled:true,...} or {handled:false, reason} (→ caller forwards).
 * Nothing user-visible happens before every check has passed and D1 is written.
 */
export async function handleLocally(env, ctx, parsed, decision, receivedAt) {
  const op = await applyLocalOp(env, { tid: decision.tid, action: decision.action, uid: parsed.uid, updateId: parsed.updateId, source: 'telegram' });
  if (!op.handled || op.dup) return op;
  const text = confirmationText(decision.action, op.after, op.graceDays);
  let sent = await sendText(env, parsed.chat, text).catch((e) => ({ ok: false, description: String(e?.message || e) }));
  if (!sent.ok) sent = await sendText(env, parsed.chat, text).catch((e) => ({ ok: false, description: String(e?.message || e) })); // one retry
  const replyMs = Date.now() - receivedAt;
  log(sent.ok ? 'local_ok' : 'local_reply_failed', { updateId: parsed.updateId, tid: decision.tid, action: decision.action, from: op.before.status, to: op.after.status, d1Ms: op.d1Ms, replyMs, description: sent.ok ? undefined : sent.description });
  ctx.waitUntil(env.DB.prepare('UPDATE tenant_ops SET server_ms = ? WHERE op_id = ?').bind(replyMs, op.opId).run().catch(() => {}));
  ctx.waitUntil(syncOp(env, decision.tid, op.opId, op.after.status, op.atMs).catch((e) => log('sync_error', { opId: op.opId, error: String(e?.message || e) })));
  return { handled: true, text, replyMs, opId: op.opId };
}

// ───────── mini-app fast path (POST /app/platform) ─────────
/** Bot tokens never contain whitespace; a pasted secret may carry a trailing newline that Telegram URLs ignore but the HMAC would not. */
export const botToken = (env) => String(env.BOT_TOKEN || '').replace(/\s+/g, '');
/**
 * The platform mini-app (adabway.github.io/?r=platform) calls this for «⏸ إيقاف» / «▶️ استئناف» on ALLOWLIST tenants.
 * Same auth as miniAppPlatformPost_: Telegram initData signed with the platform bot token, max age 24 h,
 * user id == PLATFORM_OWNER_ID. Answer shape = miniAppPlatformStatus_ ({ok, tenant, message}) plus {fast, opId}.
 * Any problem → {ok:false, fallback:true, reason} and the page calls the script (?b=app&r=platform) as before.
 * action:'metric' {opId, ms} stores the click→render time the page measured (owner-authenticated, numbers only).
 */
export const APP_JSON = (obj, origin, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(origin) } });
export function corsHeaders(origin) {
  return { 'access-control-allow-origin': origin || '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400', vary: 'origin' };
}
export function allowedOrigin(env, request) {
  const o = request.headers.get('origin') || '';
  const list = parseList(env.MINIAPP_ORIGINS || 'https://adabway.github.io');
  return list.includes(o.toLowerCase()) ? o : (list[0] || '*');
}

export async function handleMiniApp(request, env, ctx) {
  const receivedAt = Date.now();
  const origin = allowedOrigin(env, request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== 'POST') return APP_JSON({ ok: false, fallback: true, reason: 'method' }, origin, 405);
  const fb = (reason, extra = {}) => { log('app_fallback', { reason, ...extra }); return APP_JSON({ ok: false, fallback: true, reason }, origin); };
  let body;
  try { body = JSON.parse(await request.text()); } catch { return fb('bad json'); }
  if (!body || typeof body !== 'object') return fb('bad body');
  const action = String(body.action || '');
  if (!env.BOT_TOKEN) return fb('no token');
  let v;
  try { v = await verifyInitData(body.initData, botToken(env)); } catch (e) { return fb('verify error'); }
  if (!v.ok) return fb('initData ' + v.reason);

  if (action === 'metric') {
    const ms = Math.round(Number(body.ms));
    if (!(ms >= 0 && ms < 120000) || typeof body.opId !== 'string') return fb('bad metric');
    let meta; try { meta = await loadMeta(env); } catch { return fb('d1 read'); }
    if (!meta.owner_id || !safeEqual(v.uid, meta.owner_id)) return fb('not owner');
    try { await env.DB.prepare('UPDATE tenant_ops SET client_ms = ? WHERE op_id = ? AND source = ?').bind(ms, body.opId, 'miniapp').run(); } catch { return fb('d1 write'); }
    log('app_metric', { opId: body.opId, clientMs: ms });
    return APP_JSON({ ok: true }, origin);
  }
  if (action === 'bootstrap' || action === 'tenants') { // batch 1: platform panel from snapshot
    let meta; try { meta = await loadMeta(env); } catch { return fb('d1 read'); }
    if (!meta.owner_id || !safeEqual(v.uid, meta.owner_id)) return fb('not owner');
    let b; try { b = await platformBootstrap(env, ctx, { uid: v.uid, bodyText: JSON.stringify(body), body, meta }); } catch (e) { return fb('boot error'); }
    if (!b.answer) return fb(b.fallback);
    log('app_boot', { stale: b.answer.stale, ageMs: Date.now() - b.answer.builtAt, serverMs: Date.now() - receivedAt });
    return APP_JSON(b.answer, origin);
  }
  if (action !== 'suspend' && action !== 'resume') return fb('action not handled');
  const tid = String(body.id || '').trim().toLowerCase();
  if (!TENANT_ID_RE.test(tid) || !parseList(env.ALLOWLIST).includes(tid)) return fb('not allowlisted', { tid: TENANT_ID_RE.test(tid) ? tid : undefined });

  let op;
  try { op = await applyLocalOp(env, { tid, action, uid: v.uid, source: 'miniapp' }); }
  catch (e) { op = { handled: false, reason: 'exception: ' + String(e?.message || e) }; }
  if (!op.handled) return fb(op.reason, { tid });
  const now = Date.now();
  const tenant = miniAppTenantDto(op.after, op.graceDays, now);
  const message = confirmationText(action, op.after, op.graceDays, now);
  const serverMs = Date.now() - receivedAt;
  log('app_ok', { tid, action, from: op.before.status, to: op.after.status, d1Ms: op.d1Ms, serverMs, opId: op.opId });
  ctx.waitUntil(env.DB.prepare('UPDATE tenant_ops SET server_ms = ? WHERE op_id = ?').bind(serverMs, op.opId).run().catch(() => {}));
  ctx.waitUntil(syncOp(env, tid, op.opId, op.after.status, op.atMs).catch((e) => log('sync_error', { opId: op.opId, error: String(e?.message || e) })));
  return APP_JSON({ ok: true, fast: true, opId: op.opId, tenant, message }, origin);
}

// ───────── Sheet sync (D1 → Sheet) ─────────
export async function postScript(env, payload) {
  const res = await fetch(syncUrl(env), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    redirect: 'follow', signal: AbortSignal.timeout(Number(env.FORWARD_TIMEOUT_MS || 25000)),
  }); // Apps Script answers 302 → GET googleusercontent with the JSON
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return { ok: false, error: 'non-json HTTP ' + res.status }; }
}

/** Push one status change to the Sheet via action=syncTenantStatus; on success clear pending (if still ours). */
export async function syncOp(env, tid, opId, status, atMs) {
  const t0 = Date.now();
  let r;
  try { r = await postScript(env, { action: 'syncTenantStatus', tid, status, opId, atMs }); }
  catch (e) { r = { ok: false, error: String(e?.message || e) }; }
  const now = Date.now();
  if (r.ok) {
    const stmts = [
      env.DB.prepare('UPDATE tenant_ops SET synced_ms = ?, sync_result = ? WHERE op_id = ?').bind(now, r.stale ? 'stale-skipped' : 'ok', opId),
    ];
    if (r.tenant) {
      // Sheet is the source of truth: take back exactly what it now holds (only if this op is still the pending one)
      stmts.push(env.DB.prepare(
        'UPDATE tenants SET name=?, status=?, expiry_ms=?, quota=?, setup=?, sheet_row=?, sheet_updated_ms=?, pulled_ms=?, pending_sync=0, pending_op=NULL, last_sync_ms=?, last_sync_error=NULL WHERE id=? AND pending_op=?'
      ).bind(r.tenant.name, r.tenant.status, r.tenant.expiry, r.tenant.quota, r.tenant.setup, r.tenant.row, r.tenant.updatedMs, now, now, tid, opId));
    }
    await env.DB.batch(stmts);
    log('sync_ok', { tid, opId, status, stale: !!r.stale, syncMs: now - t0 });
  } else {
    await env.DB.prepare('UPDATE tenants SET last_sync_error = ? WHERE id = ? AND pending_op = ?').bind(String(r.error || 'unknown').slice(0, 300), tid, opId).run();
    log('sync_failed', { tid, opId, status, error: String(r.error || '').slice(0, 300), syncMs: now - t0 });
  }
  return r;
}

/** Sheet → D1 import (one-time and periodic). Rows with a pending local change are not overwritten. */
export async function pullFromSheet(env) {
  const ids = parseList(env.ALLOWLIST);
  const r = await postScript(env, { action: 'exportTenants', ids });
  if (!r.ok) { log('pull_failed', { error: String(r.error || '').slice(0, 300) }); return r; }
  const now = Date.now();
  const stmts = [
    env.DB.prepare('INSERT INTO platform_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('owner_id', String(r.platformOwnerId || '')),
    env.DB.prepare('INSERT INTO platform_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('grace_days', String(r.graceDays ?? DEFAULT_GRACE_DAYS)),
    env.DB.prepare('INSERT INTO platform_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('last_pull_ms', String(now)),
  ];
  for (const t of r.tenants || []) {
    if (!ids.includes(String(t.id))) continue; // never mirror non-allowlisted clients
    stmts.push(env.DB.prepare(
      `INSERT INTO tenants(id,name,status,expiry_ms,quota,setup,sheet_row,sheet_updated_ms,pulled_ms,dirty,pending_sync)
       VALUES (?,?,?,?,?,?,?,?,?,0,0)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, status=excluded.status, expiry_ms=excluded.expiry_ms, quota=excluded.quota,
         setup=excluded.setup, sheet_row=excluded.sheet_row, sheet_updated_ms=excluded.sheet_updated_ms, pulled_ms=excluded.pulled_ms, dirty=0
       WHERE tenants.pending_sync = 0`
    ).bind(t.id, t.name, t.status, t.expiry, t.quota, t.setup, t.row, t.updatedMs, now));
  }
  // allowlisted ids that vanished from the Sheet → drop from mirror (they will be forwarded)
  const present = (r.tenants || []).map((t) => String(t.id));
  for (const id of ids) if (!present.includes(id)) stmts.push(env.DB.prepare('DELETE FROM tenants WHERE id = ? AND pending_sync = 0').bind(id));
  await env.DB.batch(stmts);
  log('pull_ok', { tenants: present.length });
  return r;
}

export async function scheduled(env) {
  // 1) retry pending pushes first (so a pull never undoes an owner command)
  try {
    const { results } = await env.DB.prepare(
      'SELECT t.id, t.pending_op, o.to_status, o.at_ms FROM tenants t JOIN tenant_ops o ON o.op_id = t.pending_op WHERE t.pending_sync = 1'
    ).all();
    for (const p of results || []) await syncOp(env, p.id, p.pending_op, p.to_status, p.at_ms);
  } catch (e) { log('retry_error', { error: String(e?.message || e) }); }
  // 2) re-pull (human Sheet edits, /extend /quota /owner, mini-app actions, owner id, grace days)
  try { await pullFromSheet(env); } catch (e) { log('pull_error', { error: String(e?.message || e) }); }
  // 2b) batch 1: activity pushes retry + keys/activities pull (ALLOWLIST tenants)
  try { await scheduledBatch1(env); } catch (e) { log('batch1_cron_error', { error: String(e?.message || e) }); }
  // 3) prune dedup rows older than 2 days
  try { await env.DB.prepare('DELETE FROM processed_updates WHERE at_ms < ?').bind(Date.now() - 2 * 86400000).run(); } catch { /* ignore */ }
  // 3b) batch 2a: tenant-bot dedup (>2 days), stale serving markers (>60 s), old cached views (>7 days)
  try { await env.DB.prepare('DELETE FROM tg_processed WHERE at_ms < ?').bind(Date.now() - 2 * 86400000).run(); } catch { /* ignore */ }
  try { await env.DB.prepare('DELETE FROM student_view_serving WHERE serving_ms < ?').bind(Date.now() - 60000).run(); } catch { /* ignore */ }
  try { await env.DB.prepare('DELETE FROM student_views WHERE built_ms < ?').bind(Date.now() - 7 * 86400000).run(); } catch { /* ignore */ }
}

// ───────── admin ─────────
async function handleAdmin(request, env, url) {
  if (!env.ADMIN_KEY || !safeEqual(request.headers.get('x-admin-key'), env.ADMIN_KEY)) return new Response('forbidden', { status: 403 });
  const action = url.pathname.replace(/^\/admin\//, '');
  const post = request.method === 'POST';
  let j;
  if (action === 'webhook-info') { j = await tg(env, 'getWebhookInfo', {}); if (j.ok && j.result) j.result.url = redactUrl(j.result.url); }
  else if (action === 'state') {
    const meta = await loadMeta(env);
    const { results } = await env.DB.prepare('SELECT id,status,expiry_ms,pulled_ms,dirty,pending_sync,last_sync_ms,last_sync_error FROM tenants').all();
    const ops = (await env.DB.prepare('SELECT op_id,tenant_id,action,from_status,to_status,source,at_ms,server_ms,client_ms,synced_ms,sync_result FROM tenant_ops ORDER BY at_ms DESC LIMIT 20').all()).results;
    j = { ok: true, meta: { has_owner: !!meta.owner_id, grace_days: meta.grace_days, last_pull_ms: meta.last_pull_ms }, tenants: results, ops };
  }
  else if (action === 'token-info') {
    const t = String(env.BOT_TOKEN || '');
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));
    const me = await tg(env, 'getMe', {});
    j = { ok: true, len: t.length, trimmedLen: t.trim().length, hasWs: /\s/.test(t), shape: /^\d+:[A-Za-z0-9_-]{30,}$/.test(t), idPart: t.split(':')[0], fp: Array.from(d.slice(0, 4), (x) => x.toString(16).padStart(2, '0')).join(''), me: me.ok ? { id: me.result.id, username: me.result.username } : me };
  }
  else if (action === 'menu-button' && !post) j = await tg(env, 'getChatMenuButton', {});
  else if (action === 'menu-button' && post) {
    // cache-busting: same base URL, only the v query param changes; rollback = POST {"url":"https://adabway.github.io/?r=platform"}
    let b = {}; try { b = JSON.parse((await request.text()) || '{}'); } catch { /* empty */ }
    const cur = await tg(env, 'getChatMenuButton', {});
    const old = cur.ok && cur.result && cur.result.web_app ? cur.result.web_app.url : '';
    let next = '';
    if (b.url) next = String(b.url);
    else if (old && b.v) { const u = new URL(old); u.searchParams.set('v', String(b.v)); next = u.toString(); }
    if (!next || !next.startsWith('https://adabway.github.io/')) j = { ok: false, error: 'no url', old };
    else {
      const set = await tg(env, 'setChatMenuButton', { menu_button: { type: 'web_app', text: (cur.result && cur.result.text) || '📱 لوحة المنصة', web_app: { url: next } } });
      j = { ok: !!set.ok, old, now: next, description: set.description };
    }
  }
  else if (action === 'pull-app' && post) {
    const tid = String(url.searchParams.get('t') || '').toLowerCase();
    if (!parseList(env.ALLOWLIST).includes(tid)) j = { ok: false, error: 'not allowlisted' };
    else j = { ok: true, keys: await pullAppKeys(env, tid), activities: await pullActivities(env, tid) };
  }
  else if (action === 'app-state') j = await appState(env, String(url.searchParams.get('t') || 'test2').toLowerCase());
  else if (action === 'mint' && post) {
    // self-test helper: initData for the owner (or ?uid=), signed inside the Worker, valid 10 min. Nothing secret leaves.
    const tid = String(url.searchParams.get('t') || '').toLowerCase(), role = String(url.searchParams.get('r') || '');
    let uid = url.searchParams.get('uid');
    if (!uid) uid = role === 'platform' ? (await loadMeta(env)).owner_id : (await env.DB.prepare('SELECT owner_id FROM tenant_app_meta WHERE tenant_id = ?').bind(tid).first())?.owner_id;
    j = (role === 'platform' || parseList(env.ALLOWLIST).includes(tid)) && uid ? await mintInitData(env, { tid, role, uid }) : { ok: false, error: 'not allowed' };
  }
  else if (action === 'restore-activity' && post) {
    // put one activity's pause columns back to exact values (ms or null), through the same D1 op + Sheet sync
    let b = {}; try { b = JSON.parse((await request.text()) || '{}'); } catch { /* empty */ }
    const tid = String(b.tid || '').toLowerCase();
    if (!parseList(env.ALLOWLIST).includes(tid)) j = { ok: false, error: 'not allowlisted' };
    else {
      const op = await applyActivityOp(env, { tid, pid: String(b.pid), ref: String(b.ref), resume: false, action: 'restore', body: { from: b.from == null ? '' : Number(b.from), until: b.until == null ? '' : Number(b.until) }, uid: 'worker-restore', user: { first_name: 'Worker', last_name: 'restore' } });
      j = op.handled ? await syncActivityOp(env, { tid, pid: String(b.pid), ref: String(b.ref), opId: op.opId, from: op.from, until: op.until, atMs: op.atMs, actor: op.actor }) : { ok: false, error: op.reason };
    }
  }
  else if (action === 'restore-program' && post) {
    // put one program's «مفتوح للتسليم» back to an exact value, through the same D1 op + Sheet sync
    let b = {}; try { b = JSON.parse((await request.text()) || '{}'); } catch { /* empty */ }
    const tid = String(b.tid || '').toLowerCase();
    if (!parseList(env.ALLOWLIST).includes(tid) || typeof b.open !== 'boolean') j = { ok: false, error: 'not allowlisted / open must be boolean' };
    else {
      const op = await applyProgramOp(env, { tid, pid: String(b.pid), open: b.open, action: 'restore', uid: 'worker-restore', user: { first_name: 'Worker', last_name: 'restore' } });
      j = op.handled ? await syncProgramOp(env, { tid, pid: String(b.pid), opId: op.opId, open: b.open, atMs: op.atMs, actor: op.actor }) : { ok: false, error: op.reason };
    }
  }
  else if (action === 'pull' && post) j = await pullFromSheet(env).then((r) => ({ ok: !!r.ok, tenants: (r.tenants || []).length, error: r.error }));
  else if (action === 'point-to-worker' && post) j = await tg(env, 'setWebhook', { url: url.origin + '/telegram', secret_token: env.TG_WEBHOOK_SECRET, allowed_updates: ALLOWED_UPDATES, drop_pending_updates: false, max_connections: PLATFORM_MAX_CONNECTIONS });
  else if (action === 'rollback' && post) j = await tg(env, 'setWebhook', { url: platformUrl(env), allowed_updates: ALLOWED_UPDATES, drop_pending_updates: false, max_connections: PLATFORM_MAX_CONNECTIONS });
  else if (action === 'bot-pull' && post) {
    const tid = String(url.searchParams.get('t') || '').toLowerCase();
    if (!parseList(env.ALLOWLIST).includes(tid)) j = { ok: false, error: 'not allowlisted' };
    else j = await botPull(env, tid);
  }
  else if (action === 'bot-state') {
    const tid = String(url.searchParams.get('t') || 'test2').toLowerCase();
    j = parseList(env.ALLOWLIST).includes(tid) ? await botState(env, tid) : { ok: false, error: 'not allowlisted' };
  }
  else if (action === 'bot-point' && post) {
    const tid = String(url.searchParams.get('t') || '').toLowerCase();
    let b = {}; try { b = JSON.parse((await request.text()) || '{}'); } catch { /* empty */ }
    const role = String(b.role || url.searchParams.get('r') || 'unified');
    const to = String(b.to || url.searchParams.get('to') || '');
    if (!parseList(env.ALLOWLIST).includes(tid)) j = { ok: false, error: 'not allowlisted' };
    else j = await botPoint(env, tid, role, to, url.origin);
  }
  else if (action === 'bot-sim' && post) {
    const tid = String(url.searchParams.get('t') || '').toLowerCase();
    let b = {}; try { b = JSON.parse((await request.text()) || '{}'); } catch { /* empty */ }
    if (!parseList(env.ALLOWLIST).includes(tid)) j = { ok: false, error: 'not allowlisted' };
    else j = await botSim(env, tid, b.update ?? null);
  }
  else return new Response('not found', { status: 404 });
  return new Response(JSON.stringify(j), { headers: { 'content-type': 'application/json' } });
}

// ───────── entry ─────────
export async function handleTelegram(request, env, ctx) {
  if (!env.TG_WEBHOOK_SECRET || !safeEqual(request.headers.get('x-telegram-bot-api-secret-token'), env.TG_WEBHOOK_SECRET)) return new Response('forbidden', { status: 401 });
  const receivedAt = Date.now();
  const rawBody = await request.text();
  let update;
  try { update = JSON.parse(rawBody); } catch { log('bad_json', { len: rawBody.length }); return new Response('ok'); }

  const parsed = parsePlatformUpdate(update);
  const decision = classify(parsed, parseList(env.ALLOWLIST));
  if (decision.local) {
    let r;
    try { r = await handleLocally(env, ctx, parsed, decision, receivedAt); }
    catch (e) { r = { handled: false, reason: 'exception: ' + String(e?.message || e) }; }
    if (r.handled) return new Response('ok');
    log('local_fallback', { updateId: update.update_id, tid: decision.tid, reason: r.reason });
    ctx.waitUntil(forwardInBackground(env, rawBody, update, receivedAt, 'fallback'));
    return new Response('ok');
  }
  if (decision.touches) {
    // e.g. /extend test2 — the script will change the Sheet; don't trust the mirror until the next pull
    ctx.waitUntil(env.DB.prepare('UPDATE tenants SET dirty = 1 WHERE id = ?').bind(decision.touches).run().catch(() => {}));
  }
  ctx.waitUntil(forwardInBackground(env, rawBody, update, receivedAt, 'passthrough'));
  return new Response('ok');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/admin/')) return handleAdmin(request, env, url);
    if (url.pathname.startsWith('/tg/')) return handleTenantTelegram(request, env, ctx, url);
    if (url.pathname === '/telegram' && request.method === 'POST') return handleTelegram(request, env, ctx);
    if (url.pathname === '/app/platform') return handleMiniApp(request, env, ctx);
    if (url.pathname === '/app/tenant') return handleTenantApp(request, env, ctx, url);
    return new Response('ok');
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(scheduled(env)); },
};
