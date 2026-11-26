/**
 * Batch 2a (ALLOWLIST tenants only): tenant-bot /mysubs + /mygrades via the Worker (test2 only).
 * Design: PLAN-batch2a.md (Grok, paused 2026-11-24 19:30, nothing deployed). Built by Bayan alone.
 *
 *   POST /tg/<tid>/<role>  (tenant bot webhook; secret_token = HMAC(SYNC_SECRET, 'tg-hook:tid:role'))
 *     - answers locally ONLY for private, non-admin /mysubs, /mygrades and ms/my, and only when:
 *         the cached view is a plain view, fresh (built after any dirty mark, ≤15 min),
 *         exactly 1 open program, license and setup OK.
 *     - everything else, and every error, is forwarded to the script (awaited, 55 s timeout);
 *       on failure the Worker returns 502 so Telegram retries and the script dedups.
 *       Persistent failure → self-heal: setWebhook back to the original script URL.
 *     - after a forward: views are marked dirty and re-pulled (per uid for a private chat,
 *       all views for groups/admins). A forward for a uid waits while that uid's
 *       studentViewServed is in flight (≤10 s).
 *     - text «تسليماتي»/«درجاتي» is always forwarded (M approved 2026-11-25): only the script
 *       knows the conversation state (mid-submission or not).
 *   Admin (x-admin-key): bot-pull, bot-state, bot-point?to=worker|script, bot-sim.
 *
 * The script side (WorkerBatch3.js, ?b=worker): exportBotHook, exportStudentViews,
 * studentViewServed. The bot token is never logged and never travels in chat: the script
 * exports it, the Worker stores it AES-GCM-encrypted in D1 (same HKDF(SYNC_SECRET) key
 * as the app keys). The Sheet stays the source of truth; the script owns all state
 * transitions (studentViewServed mirrors cmd keep+clear / cb current state + setState_ + countUsage_).
 */
import { safeEqual, parseList, TENANT_ID_RE, licenseState, hmac, hex, enc, DEFAULT_GRACE_DAYS } from './logic.js';
import { log, execBase, loadMeta, postScript, redactUrl } from './index.js';
import { aesKey } from './batch1.js';

const ROLES = ['admin', 'student', 'unified'];
const TG_API = 'https://api.telegram.org/bot';
const VIEW_FRESH_MS = 15 * 60 * 1000; // a cached view older than this is never answered locally
const SERVE_WAIT_MS = 10 * 1000;     // max wait for another studentViewServed for the same uid
const VIEW_TEXTS = { subs: 'تسليماتي', grades: 'درجاتي' };

const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ───────── text sealing (same HKDF(SYNC_SECRET) key as the app keys; tokens are not hex) ─────────
export async function sealText(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(String(text ?? ''))));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return b64(out);
}
export async function openText(env, sealed) {
  const all = unb64(sealed);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, await aesKey(env), all.slice(12));
  return new TextDecoder().decode(pt);
}

// ───────── Telegram Bot API with a tenant token (never env.BOT_TOKEN: that is the platform bot) ─────────
async function tgWith(token, method, payload) {
  const res = await fetch(TG_API + token + '/' + method, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}),
  });
  try { return await res.json(); } catch { return { ok: false, description: 'HTTP ' + res.status }; }
}

/** secret_token the Worker expects on POST /tg/<tid>/<role> (set by bot-point?to=worker) */
export async function tgSecret(env, tid, role) {
  return hex(await hmac(enc.encode(String(env.SYNC_SECRET || '')), 'tg-hook:' + tid + ':' + role));
}

// ───────── update parsing (tenant bot; mirrors handleTenantPost_ routing, read-only) ─────────
function str(v) { return (v == null ? '' : String(v).trim()); }
/**
 * Returns {kind, ...}:
 *  cmd  {cmd, uid, chat, updateId}            /mysubs | /mygrades (private text command)
 *  cb   {data, uid, chat, msgId, cbId, updateId}  ms | my callback
 *  viewtext {uid, chat, updateId}             «تسليماتي» | «درجاتي» as plain text → always forwarded
 *  other {}                                    everything else → forwarded
 */
export function parseTenantUpdate(u) {
  const m = u && u.message, cb = u && u.callback_query;
  if (cb && cb.message && cb.message.chat && cb.from) {
    const data = str(cb.data);
    if (data === 'ms' || data === 'my') {
      return { kind: 'cb', data, uid: String(cb.from.id), chat: cb.message.chat.id, msgId: cb.message.message_id, cbId: cb.id, updateId: u.update_id ?? null };
    }
    return { kind: 'other' };
  }
  if (!m || !m.chat || !m.from) return { kind: 'other' };
  if (m.chat.type !== 'private') return { kind: 'other' };
  const text = str(m.text);
  if (!text) return { kind: 'other' };
  if (text === VIEW_TEXTS.subs || text === VIEW_TEXTS.grades) return { kind: 'viewtext', uid: String(m.from.id), chat: m.chat.id, updateId: u.update_id ?? null };
  if (text.charAt(0) === '/') {
    const cmd = text.split(/\s+/)[0].replace(/@.*/, '').toLowerCase();
    if (cmd === '/mysubs' || cmd === '/mygrades') return { kind: 'cmd', cmd, uid: String(m.from.id), chat: m.chat.id, updateId: u.update_id ?? null };
  }
  return { kind: 'other' };
}

async function isTenantAdmin(env, tid, uid) {
  try {
    const meta = await env.DB.prepare('SELECT owner_id FROM tenant_app_meta WHERE tenant_id = ?').bind(tid).first();
    if (meta && meta.owner_id && safeEqual(uid, String(meta.owner_id))) return true;
    const a = await env.DB.prepare('SELECT 1 AS x FROM tenant_admins WHERE tenant_id = ? AND uid = ?').bind(tid, uid).first();
    return !!a;
  } catch { return true; } // on D1 error, treat as admin → forward (never answer locally on doubt)
}

async function loadHook(env, tid, role) {
  try {
    const r = await env.DB.prepare('SELECT * FROM bot_hooks WHERE tenant_id = ? AND role = ?').bind(tid, role).first();
    return r || null;
  } catch { return null; }
}

/**
 * Local-answer gates (all must hold, else forward). Returns {ok:true, row, token} or {ok:false, reason}.
 * row is the cached student_views row; token is the decrypted tenant bot token.
 */
async function localGates(env, tid, role, uid, view) {
  const hook = await loadHook(env, tid, role);
  if (!hook || !hook.token_enc) return { ok: false, reason: 'no bot hook (run bot-pull)' };
  let token;
  try { token = await openText(env, hook.token_enc); } catch { return { ok: false, reason: 'token decrypt' }; }
  if (!token) return { ok: false, reason: 'no token' };
  let meta, t, row, openCount;
  try {
    meta = await env.DB.prepare('SELECT * FROM tenant_app_meta WHERE tenant_id = ?').bind(tid).first();
    t = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(tid).first();
    row = await env.DB.prepare('SELECT * FROM student_views WHERE tenant_id = ? AND uid = ? AND view = ?').bind(tid, uid, view).first();
    openCount = (await env.DB.prepare('SELECT COUNT(*) AS n FROM programs WHERE tenant_id = ? AND open = 1').bind(tid).first())?.n ?? 0;
  } catch (e) { return { ok: false, reason: 'd1 read: ' + String(e?.message || e) }; }
  if (!meta || !t) return { ok: false, reason: 'not mirrored' };
  if (Date.now() - Number(meta.pulled_ms || 0) > Number(env.MAX_STALE_MS || 1800000)) return { ok: false, reason: 'stale mirror' };
  let pm; try { pm = await loadMeta(env); } catch { return { ok: false, reason: 'd1 meta' }; }
  const lic = licenseState({ id: t.id, status: t.status, expiry: t.expiry_ms == null ? null : Number(t.expiry_ms) }, Number(pm.grace_days ?? DEFAULT_GRACE_DAYS));
  if (!lic.ok || !meta.license_ok || meta.setup !== 'done' || t.dirty || t.pending_sync) return { ok: false, reason: 'tenant state' };
  if (openCount !== 1) return { ok: false, reason: openCount === 0 ? 'no open program' : 'several open programs' };
  if (!row) return { ok: false, reason: 'no cached view' };
  if (row.dirty) return { ok: false, reason: 'view dirty' };
  if (row.kind !== 'view') return { ok: false, reason: 'not a plain view' };
  if (Date.now() - Number(row.built_ms || 0) > VIEW_FRESH_MS) return { ok: false, reason: 'view stale' };
  return { ok: true, row, token };
}

// ───────── dedup for locally handled tenant updates (per bot: scope tid:role) ─────────
async function dedupClaim(env, tid, role, updateId) {
  if (updateId == null) return true;
  try {
    const ins = await env.DB.prepare('INSERT OR IGNORE INTO tg_processed(scope, update_id, at_ms) VALUES (?, ?, ?)').bind(tid + ':' + role, updateId, Date.now()).run();
    return !!(ins.meta && ins.meta.changes);
  } catch { return false; }
}

// ───────── studentViewServed round-trip (script owns the state transition; Worker caches the fresh view) ─────────
async function markServing(env, tid, uid, on) {
  try {
    if (on) await env.DB.prepare('INSERT INTO student_view_serving(tenant_id,uid,serving_ms) VALUES (?,?,?) ON CONFLICT(tenant_id,uid) DO UPDATE SET serving_ms=excluded.serving_ms').bind(tid, uid, Date.now()).run();
    else await env.DB.prepare('DELETE FROM student_view_serving WHERE tenant_id = ? AND uid = ?').bind(tid, uid).run();
  } catch { /* serving marker is best-effort; the ≤10 s wait below bounds the damage */ }
}
async function waitServing(env, tid, uid) {
  const t0 = Date.now();
  for (;;) {
    let r = null;
    try { r = await env.DB.prepare('SELECT serving_ms FROM student_view_serving WHERE tenant_id = ? AND uid = ?').bind(tid, uid).first(); } catch { return; }
    if (!r || Date.now() - Number(r.serving_ms || 0) > SERVE_WAIT_MS) {
      if (r) await env.DB.prepare('DELETE FROM student_view_serving WHERE tenant_id = ? AND uid = ?').bind(tid, uid).run().catch(() => {});
      return;
    }
    if (Date.now() - t0 > SERVE_WAIT_MS) return;
    await new Promise((res) => setTimeout(res, 500));
  }
}
async function serveView(env, { tid, uid, chat, view, kind, msgId, text, kb, via }) {
  await markServing(env, tid, uid, true);
  try {
    const r = await postScript(env, { action: 'studentViewServed', tid, uid, chat, view, kind, msgId, text, kb, via });
    if (r && r.ok && r.view) {
      // the script's fresh view keeps the cache current (it already edited the message if it differed)
      await env.DB.prepare(`INSERT INTO student_views(tenant_id,uid,view,kind,text,kb_json,built_ms,dirty) VALUES (?,?,?,?,?,?,?,0)
        ON CONFLICT(tenant_id,uid,view) DO UPDATE SET kind=excluded.kind, text=excluded.text, kb_json=excluded.kb_json, built_ms=excluded.built_ms, dirty=0`)
        .bind(tid, uid, view, r.view.kind || kind, r.view.text ?? text, r.view.kb ? JSON.stringify(r.view.kb) : null, Date.now()).run().catch(() => {});
    }
    if (!r || !r.ok) log('serve_view_failed', { tid, uid, view, error: String((r && r.error) || '').slice(0, 200) });
    return r;
  } catch (e) {
    log('serve_view_error', { tid, uid, view, error: String(e?.message || e).slice(0, 200) });
    return { ok: false, error: String(e?.message || e) };
  } finally {
    await markServing(env, tid, uid, false);
  }
}

// ───────── views refresh (after a forward): exportStudentViews → upsert cache, clear dirty ─────────
export async function repullViews(env, tid, uids) {
  let r;
  try { r = await postScript(env, { action: 'exportStudentViews', tid, ...(uids ? { uids } : {}) }); }
  catch (e) { log('views_pull_error', { tid, error: String(e?.message || e).slice(0, 200) }); return { ok: false, error: String(e?.message || e) }; }
  if (!r || !r.ok) { log('views_pull_failed', { tid, error: String((r && r.error) || '').slice(0, 200) }); return { ok: false, error: (r && r.error) || 'unknown' }; }
  const now = Date.now(), stmts = [];
  let n = 0;
  for (const v of r.views || []) {
    for (const name of ['subs', 'grades']) {
      const view = v[name];
      if (!view) continue;
      stmts.push(env.DB.prepare(`INSERT INTO student_views(tenant_id,uid,view,kind,text,kb_json,built_ms,dirty) VALUES (?,?,?,?,?,?,?,0)
        ON CONFLICT(tenant_id,uid,view) DO UPDATE SET kind=excluded.kind, text=excluded.text, kb_json=excluded.kb_json, built_ms=excluded.built_ms, dirty=0`)
        .bind(tid, String(v.uid), name, view.kind || 'view', view.text || '', view.kb ? JSON.stringify(view.kb) : null, now));
      n++;
    }
  }
  if (stmts.length) await env.DB.batch(stmts).catch((e) => log('views_store_error', { tid, error: String(e?.message || e).slice(0, 200) }));
  return { ok: true, views: n };
}
async function markViewsDirty(env, tid, uid) {
  try {
    if (uid) await env.DB.prepare('UPDATE student_views SET dirty = 1 WHERE tenant_id = ? AND uid = ?').bind(tid, uid).run();
    else await env.DB.prepare('UPDATE student_views SET dirty = 1 WHERE tenant_id = ?').bind(tid).run();
  } catch { /* dirty mark is best-effort; staleness gate still protects */ }
}

// ───────── forwarding to the script (original webhook URL, unchanged body) ─────────
async function forwardToTenantScript(env, hookUrl, rawBody) {
  const started = Date.now();
  const signal = AbortSignal.timeout(Number(env.TG_FORWARD_TIMEOUT_MS || 55000));
  let res;
  try {
    res = await fetch(hookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: rawBody, redirect: 'manual', signal });
  } catch (e) {
    const timeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return { ok: false, status: 0, ms: Date.now() - started, reason: timeout ? 'timeout' : 'network' };
  }
  let body = '';
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location');
    if (loc) { try { body = (await (await fetch(loc, { redirect: 'follow', signal })).text()).slice(0, 20000); } catch { /* ignore */ } }
  } else { try { body = (await res.text()).slice(0, 20000); } catch { /* ignore */ } }
  const ms = Date.now() - started;
  if (res.status >= 400) return { ok: false, status: res.status, ms, reason: 'http ' + res.status };
  if (/(^|[^a-z])forbidden([^a-z]|$)/i.test(body)) return { ok: false, status: res.status, ms, reason: 'forbidden' };
  return { ok: true, status: res.status, ms };
}

async function selfHeal(env, tid, role) {
  const hook = await loadHook(env, tid, role);
  if (!hook || !hook.orig_hook_url_enc || !hook.token_enc) { log('selfheal_no_hook', { tid, role }); return { ok: false }; }
  let token, orig;
  try { token = await openText(env, hook.token_enc); orig = await openText(env, hook.orig_hook_url_enc); } catch { return { ok: false }; }
  if (!token || !orig) return { ok: false };
  const r = await tgWith(token, 'setWebhook', { url: orig, allowed_updates: ['message', 'callback_query'], max_connections: 20, drop_pending_updates: false });
  log(r.ok ? 'selfheal_ok' : 'selfheal_failed', { tid, role, description: r.ok ? undefined : String(r.description || '').slice(0, 200) });
  return r;
}
async function noteForwardFailure(env, tid, role, reason) {
  try {
    const hook = await loadHook(env, tid, role);
    if (!hook) return false;
    const n = Number(hook.fail_count || 0) + 1;
    await env.DB.prepare('UPDATE bot_hooks SET fail_count = ?, last_fail_ms = ? WHERE tenant_id = ? AND role = ?').bind(n, Date.now(), tid, role).run();
    if (reason === 'forbidden' || n >= 3) {
      await env.DB.prepare('UPDATE bot_hooks SET fail_count = 0 WHERE tenant_id = ? AND role = ?').bind(tid, role).run();
      await selfHeal(env, tid, role);
      return true;
    }
  } catch { /* failure accounting must never break the webhook */ }
  return false;
}
async function noteForwardSuccess(env, tid, role) {
  try { await env.DB.prepare('UPDATE bot_hooks SET fail_count = 0 WHERE tenant_id = ? AND role = ?').bind(tid, role).run(); } catch { /* ignore */ }
}

// ───────── local answer (command → new message; callback → answer + edit) ─────────
async function answerLocally(env, ctx, { tid, role, parsed, view, row, token, receivedAt }) {
  let kb = null;
  try { kb = row.kb_json ? JSON.parse(row.kb_json) : null; } catch { kb = null; }
  const markup = kb ? { inline_keyboard: kb } : undefined;
  let sent;
  if (parsed.kind === 'cmd') {
    sent = await tgWith(token, 'sendMessage', { chat_id: parsed.chat, text: row.text, disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}) });
    if (!sent.ok) return { handled: false, reason: 'send failed: ' + String(sent.description || '').slice(0, 120) };
  } else {
    const ack = await tgWith(token, 'answerCallbackQuery', { callback_query_id: parsed.cbId });
    if (!ack.ok) return { handled: false, reason: 'ack failed: ' + String(ack.description || '').slice(0, 120) };
    sent = await tgWith(token, 'editMessageText', { chat_id: parsed.chat, message_id: parsed.msgId, text: row.text, disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}) });
    if (!sent.ok) {
      if (/message is not modified/i.test(String(sent.description || ''))) {
        log('local_already_shown', { tid, uid: parsed.uid, view });
        return { handled: true, alreadyShown: true, replyMs: Date.now() - receivedAt };
      }
      return { handled: false, reason: 'edit failed: ' + String(sent.description || '').slice(0, 120) };
    }
  }
  const msgId = parsed.kind === 'cmd' ? sent.result.message_id : parsed.msgId;
  log('local_ok', { tid, uid: parsed.uid, view, via: parsed.kind, replyMs: Date.now() - receivedAt, msgId });
  ctx.waitUntil(serveView(env, { tid, uid: parsed.uid, chat: parsed.chat, view, kind: row.kind, msgId, text: row.text, kb, via: parsed.kind }).catch(() => {}));
  return { handled: true, msgId, replyMs: Date.now() - receivedAt };
}

// ───────── main handler: POST /tg/<tid>/<role> ─────────
export async function handleTenantTelegram(request, env, ctx, url) {
  const receivedAt = Date.now();
  const parts = url.pathname.split('/').filter(Boolean); // ['tg', tid, role]
  const tid = String(parts[1] || '').toLowerCase(), role = String(parts[2] || '');
  if (request.method !== 'POST') return new Response('ok');
  if (!TENANT_ID_RE.test(tid) || !parseList(env.ALLOWLIST).includes(tid) || !ROLES.includes(role)) return new Response('ok');
  if (!env.SYNC_SECRET || !safeEqual(request.headers.get('x-telegram-bot-api-secret-token'), await tgSecret(env, tid, role))) {
    log('tg_forbidden', { tid, role });
    return new Response('forbidden', { status: 401 });
  }
  const rawBody = await request.text();
  let update;
  try { update = JSON.parse(rawBody); } catch { log('tg_bad_json', { tid, role, len: rawBody.length }); return new Response('ok'); }

  const parsed = parseTenantUpdate(update);
  const hook = await loadHook(env, tid, role);
  if (!hook || !hook.hook_url_enc) { log('tg_no_hook', { tid, role }); return new Response('retry', { status: 502 }); }
  let hookUrl;
  try { hookUrl = await openText(env, hook.hook_url_enc); } catch { log('tg_hook_decrypt', { tid, role }); return new Response('retry', { status: 502 }); }
  if (!hookUrl) { log('tg_no_hook_url', { tid, role }); return new Response('retry', { status: 502 }); }

  const forward = async (why) => {
    if (parsed.uid) await waitServing(env, tid, parsed.uid);
    const fwd = await forwardToTenantScript(env, hookUrl, rawBody);
    if (fwd.ok) {
      log('tg_forward_ok', { tid, role, updateId: update.update_id, why, ms: fwd.ms });
      await noteForwardSuccess(env, tid, role);
      // views may have changed: mark dirty + re-pull (per uid for a private chat, all for groups/admins)
      const uid = parsed.kind === 'cmd' || parsed.kind === 'viewtext' || parsed.kind === 'cb' ? parsed.uid : null;
      ctx.waitUntil((async () => { await markViewsDirty(env, tid, uid || null); await repullViews(env, tid, uid ? [uid] : undefined); })().catch(() => {}));
      return new Response('ok');
    }
    log('tg_forward_failed', { tid, role, updateId: update.update_id, why, status: fwd.status, reason: fwd.reason });
    await noteForwardFailure(env, tid, role, fwd.reason);
    return new Response('retry', { status: 502 }); // Telegram retries; the script dedups
  };

  // local-answer candidates: private, non-admin /mysubs, /mygrades, ms/my only
  if (parsed.kind === 'cmd' || parsed.kind === 'cb') {
    const view = (parsed.kind === 'cmd' ? parsed.cmd === '/mysubs' : parsed.data === 'ms') ? 'subs' : 'grades';
    if (await isTenantAdmin(env, tid, parsed.uid)) return forward('admin');
    const g = await localGates(env, tid, role, parsed.uid, view);
    if (!g.ok) { log('tg_local_fallback', { tid, role, uid: parsed.uid, view, reason: g.reason }); return forward('gate: ' + g.reason); }
    if (!(await dedupClaim(env, tid, role, parsed.updateId))) { log('tg_dup', { tid, role, updateId: parsed.updateId }); return new Response('ok'); }
    const ans = await answerLocally(env, ctx, { tid, role, parsed, view, row: g.row, token: g.token, receivedAt });
    if (ans.handled) return new Response('ok');
    log('tg_answer_fallback', { tid, role, uid: parsed.uid, view, reason: ans.reason });
    return forward('answer: ' + ans.reason);
  }
  return forward(parsed.kind === 'viewtext' ? 'viewtext' : 'passthrough');
}

// ───────── admin endpoints (x-admin-key checked by the caller) ─────────
async function telegramTokenCall(token, method, payload) { return tgWith(token, method, payload); }

/** Pull the tenant bot hook(s) from the script + record the original webhook; warm the views cache. */
export async function botPull(env, tid) {
  const roles = [], failures = [];
  for (const role of ROLES) {
    let r;
    try { r = await postScript(env, { action: 'exportBotHook', tid, role }); }
    catch (e) { const err = 'throw: ' + String(e?.message || e).slice(0, 200); log('bot_pull_error', { tid, role, error: err }); failures.push({ role, error: err }); continue; }
    if (!r || !r.ok || !r.token || !r.hookUrl) { const err = String((r && r.error) || 'missing token/hookUrl').slice(0, 200); log('bot_pull_failed', { tid, role, error: err }); failures.push({ role, error: err }); continue; }
    let info = null;
    try { info = await telegramTokenCall(r.token, 'getWebhookInfo', {}); } catch { /* keep going without it */ }
    const origUrl = info && info.ok && info.result && info.result.url ? String(info.result.url) : String(r.hookUrl);
    try {
      await env.DB.prepare(`INSERT INTO bot_hooks(tenant_id,role,token_enc,hook_url_enc,orig_hook_url_enc,orig_allowed_updates,orig_max_connections,fail_count,fetched_ms)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,role) DO UPDATE SET token_enc=excluded.token_enc, hook_url_enc=excluded.hook_url_enc,
        orig_hook_url_enc=excluded.orig_hook_url_enc, orig_allowed_updates=excluded.orig_allowed_updates,
        orig_max_connections=excluded.orig_max_connections, fail_count=0, fetched_ms=excluded.fetched_ms`)
        .bind(tid, role, await sealText(env, r.token), await sealText(env, String(r.hookUrl)), await sealText(env, origUrl),
          info && info.result && info.result.allowed_updates ? JSON.stringify(info.result.allowed_updates) : null,
          info && info.result && info.result.max_connections != null ? Number(info.result.max_connections) : null, 0, Date.now()).run();
      roles.push(role);
    } catch (e) { const err = 'store: ' + String(e?.message || e).slice(0, 200); log('bot_pull_store_error', { tid, role, error: err }); failures.push({ role, error: err }); }
  }
  const views = await repullViews(env, tid);
  return { ok: roles.length > 0, roles, views: views.ok ? views.views : 0, viewsError: views.ok ? undefined : views.error, failures };
}

export async function botState(env, tid) {
  const hooks = [];
  try {
    const rows = (await env.DB.prepare('SELECT role, fetched_ms, fail_count, last_fail_ms, hook_url_enc, orig_hook_url_enc FROM bot_hooks WHERE tenant_id = ?').bind(tid).all()).results || [];
    for (const r of rows) {
      let hookUrl = '', origUrl = '', currentUrl = '';
      try { hookUrl = redactUrl(await openText(env, r.hook_url_enc)); origUrl = r.orig_hook_url_enc ? redactUrl(await openText(env, r.orig_hook_url_enc)) : ''; } catch { /* redacted */ }
      try {
        const token = await openText(env, (await env.DB.prepare('SELECT token_enc FROM bot_hooks WHERE tenant_id = ? AND role = ?').bind(tid, r.role).first())?.token_enc || '');
        if (token) { const info = await telegramTokenCall(token, 'getWebhookInfo', {}); if (info && info.ok && info.result && info.result.url) currentUrl = redactUrl(info.result.url); }
      } catch { /* current url unknown */ }
      hooks.push({ role: r.role, fetched_ms: r.fetched_ms, fail_count: r.fail_count || 0, last_fail_ms: r.last_fail_ms, hookUrl, origUrl, currentUrl });
    }
  } catch { /* hooks list stays empty */ }
  let views = [];
  try { views = (await env.DB.prepare('SELECT uid, view, kind, built_ms, dirty FROM student_views WHERE tenant_id = ?').bind(tid).all()).results || []; } catch { /* ignore */ }
  let serving = [];
  try { serving = (await env.DB.prepare('SELECT uid, serving_ms FROM student_view_serving WHERE tenant_id = ?').bind(tid).all()).results || []; } catch { /* ignore */ }
  return { ok: true, hooks, views, serving, freshMs: VIEW_FRESH_MS };
}

/** Point a tenant bot webhook at the Worker (/tg) or back at the script (original URL). */
export async function botPoint(env, tid, role, to, origin) {
  if (!ROLES.includes(role)) return { ok: false, error: 'bad role' };
  if (to !== 'worker' && to !== 'script') return { ok: false, error: 'to must be worker|script' };
  const hook = await loadHook(env, tid, role);
  if (!hook || !hook.token_enc) return { ok: false, error: 'no bot hook — run bot-pull first' };
  let token;
  try { token = await openText(env, hook.token_enc); } catch { return { ok: false, error: 'token decrypt' }; }
  if (!token) return { ok: false, error: 'no token' };
  let r;
  if (to === 'worker') {
    const url = String(origin).replace(/\/$/, '') + '/tg/' + tid + '/' + role;
    r = await telegramTokenCall(token, 'setWebhook', { url, secret_token: await tgSecret(env, tid, role), allowed_updates: ['message', 'callback_query'], max_connections: 20, drop_pending_updates: false });
  } else {
    let orig;
    try { orig = hook.orig_hook_url_enc ? await openText(env, hook.orig_hook_url_enc) : ''; } catch { orig = ''; }
    if (!orig) return { ok: false, error: 'no original webhook recorded' };
    r = await telegramTokenCall(token, 'setWebhook', { url: orig, allowed_updates: ['message', 'callback_query'], max_connections: 20, drop_pending_updates: false });
  }
  log(r.ok ? 'bot_point_ok' : 'bot_point_failed', { tid, role, to, description: r.ok ? undefined : String(r.description || '').slice(0, 200) });
  return { ok: !!r.ok, to, description: r.description };
}

/** Dry run: classify a sample update and report the local-answer gates. Read-only: sends nothing, writes nothing. */
export async function botSim(env, tid, update) {
  if (!update || typeof update !== 'object') {
    const counts = (await env.DB.prepare('SELECT view, COUNT(*) AS n, SUM(dirty) AS dirty FROM student_views WHERE tenant_id = ? GROUP BY view').bind(tid).all().catch(() => ({ results: [] }))).results || [];
    return { ok: true, tid, views: counts, note: 'pass an update object to simulate one' };
  }
  const role = String(update._role || 'unified');
  const parsed = parseTenantUpdate(update);
  if (parsed.kind !== 'cmd' && parsed.kind !== 'cb') return { ok: true, decision: 'forward', reason: parsed.kind };
  const view = (parsed.kind === 'cmd' ? parsed.cmd === '/mysubs' : parsed.data === 'ms') ? 'subs' : 'grades';
  if (await isTenantAdmin(env, tid, parsed.uid)) return { ok: true, decision: 'forward', reason: 'admin' };
  const g = await localGates(env, tid, role, parsed.uid, view);
  return { ok: true, decision: g.ok ? 'local' : 'forward', reason: g.ok ? 'all gates pass' : g.reason, view };
}
