/**
 * Pure logic ported 1:1 from «Adab SaaS Platform» (snapshot 2026-11-24 01:04 Cairo, deployment @34).
 * Every function names its source so a future script change can be mirrored.
 */

export const TENANT_STATUS = { ACTIVE: 'active', TRIAL: 'trial', SUSPENDED: 'suspended' }; // Part3:1855
export const DEFAULT_GRACE_DAYS = 3;                                                     // Part3:2136
export const TENANT_ID_RE = /^[a-z0-9]{2,20}$/;                                          // Part3:1850
const DAY_MS = 86400000;
export const SUSPEND_PREFIX = '⏸ أُوقف (البيانات محفوظة): ';                              // Part4:667
export const RESUME_PREFIX = '▶️ استُؤنف: ';                                              // Part4:667
export const NOT_FOUND_TEXT = '⚠️ العميل غير موجود.';                                    // Part4:621 (never sent by the Worker: unknown ids are forwarded)

/** safeEqual_ (Part3:2154) — constant time, false on empty / different length */
export function safeEqual(a, b) {
  a = String(a ?? ''); b = String(b ?? '');
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** str_ (Part2:187) */
const str = (v) => (v == null ? '' : String(v).trim());

const CAIRO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
/** dayKey_ (Part3:2167) = fmtTime(ms).slice(0,10) in the script time zone (appsscript.json: Africa/Cairo) */
export function dayKey(ms) { return CAIRO_DAY.format(new Date(ms ?? Date.now())); }

/** licenseState_ (Part3:2125) */
export function licenseState(t, graceDays, now = Date.now()) {
  if (!t) return { ok: false, reason: 'missing' };
  if (t.status === TENANT_STATUS.SUSPENDED) return { ok: false, reason: 'suspended' };
  if (t.expiry != null && now > t.expiry) {
    const graceEnd = t.expiry + graceDays * DAY_MS;
    if (now <= graceEnd) return { ok: true, grace: true, graceEnd };
    return { ok: false, reason: 'expired' };
  }
  return { ok: true };
}

/** String(number) the way Apps Script concatenates a quota (3 → "3", 2.5 → "2.5") */
const numText = (n) => String(n);

/** tenantLine_ (Part4:576) */
export function tenantLine(t, graceDays, now = Date.now()) {
  const lic = licenseState(t, graceDays, now);
  return (lic.ok ? (t.status === TENANT_STATUS.TRIAL ? '🟡' : '🟢') : '🔴') + ' ' + t.id + ' — ' + t.name + ' | ' + t.status +
    (t.expiry ? ' حتى ' + dayKey(t.expiry) : '') +
    (lic.ok ? (lic.grace ? ' (مهلة حتى ' + dayKey(lic.graceEnd) + ')' : '') : ' (' + (lic.reason === 'expired' ? 'منتهٍ' : 'موقوف') + ')') +
    ' | حصة ' + numText(t.quota) + ' | إعداد: ' + (t.setup || '—');
}

/** setTenantSuspended_ (Part4:596): suspend → suspended, resume → active (even from trial) */
export function nextStatus(action) { return action === 'suspend' ? TENANT_STATUS.SUSPENDED : TENANT_STATUS.ACTIVE; }

/** Confirmation text exactly as ownerCommand_ sends it (Part4:667) */
export function confirmationText(action, tenantAfter, graceDays, now = Date.now()) {
  return (action === 'suspend' ? SUSPEND_PREFIX : RESUME_PREFIX) + tenantLine(tenantAfter, graceDays, now);
}

/**
 * Parse a platform-bot update like platformPost_ / onPlatformMessage_ (Part4:380-418).
 * Returns {kind:'owner-cmd', cmd, args, uid, chat, updateId} for a private text command, else {kind:'other'}.
 */
export function parsePlatformUpdate(u) {
  const m = u && u.message;
  if (!u || u.callback_query || !m || !m.chat || m.chat.type !== 'private' || !m.from) return { kind: 'other' };
  const text = str(m.text);
  const args = text.split(/\s+/);
  const cmd = text.charAt(0) === '/' ? args[0].replace(/@.*/, '').toLowerCase() : '';
  if (!cmd) return { kind: 'other' };
  return { kind: 'owner-cmd', cmd, args: args.slice(1), uid: String(m.from.id), chat: m.chat.id, updateId: u.update_id ?? null };
}

/** Commands the Worker may answer itself. Everything else is forwarded. */
export const LOCAL_COMMANDS = { '/suspend': 'suspend', '/resume': 'resume' };
/** Owner commands whose effect on an allowlisted tenant the Worker cannot see → mark its D1 row dirty */
export const SHEET_WRITING_COMMANDS = ['/extend', '/quota', '/owner', '/addon', '/rotate', '/webhooks'];

/**
 * Decide: handle locally or forward. Pure (no I/O).
 * Mirrors the order in onPlatformMessage_: /myid /cancel /app /activate /status are checked first,
 * none of them is /suspend or /resume, so for those two the owner branch is reached directly.
 */
export function classify(parsed, allowlist) {
  if (parsed.kind !== 'owner-cmd') return { local: false };
  const action = LOCAL_COMMANDS[parsed.cmd];
  const tid = str(parsed.args[0]).toLowerCase();
  if (!action) return { local: false, touches: SHEET_WRITING_COMMANDS.includes(parsed.cmd) && allowlist.includes(tid) ? tid : null };
  if (!TENANT_ID_RE.test(tid) || !allowlist.includes(tid)) return { local: false };
  return { local: true, action, tid };
}

export const parseList = (s) => String(s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

// ───────── mini-app (ported from MiniApp.gs / MiniAppPlatform.gs) ─────────
export const MINIAPP_MAX_AGE = 86400; // Part2:2136

/** miniAppDecodeURI_ (Part2:2168): '+' → ' ', decodeURIComponent, tolerant of bad % */
export function miniAppDecodeURI(s) {
  s = String(s == null ? '' : s).replace(/\+/g, ' ');
  try { return decodeURIComponent(s); }
  catch { return s.replace(/%([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))); }
}

const enc = new TextEncoder();
async function hmac(keyBytes, msg) {
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * verifyMiniAppInit_ (Part2:2179) — HMAC_SHA256(key=HMAC_SHA256(key="WebAppData", msg=token), msg=dataCheckString).
 * Excludes hash and the page params r/t/b exactly like the script. Returns {ok, reason, uid, user}.
 */
export async function verifyInitData(raw, token, now) {
  if (!raw || !token) return { ok: false, reason: 'bad' };
  return verifyInitDataSecret(raw, await hmac(enc.encode('WebAppData'), String(token)), now);
}

/** Same check from the derived key HMAC_SHA256("WebAppData", token) (what the script exports for tenant bots). */
export async function verifyInitDataSecret(raw, secret, now) {
  if (!raw || !secret) return { ok: false, reason: 'bad' };
  const fields = []; let hash = '', authDate = 0, userRaw = '';
  for (const p of String(raw).split('&')) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const k = miniAppDecodeURI(p.slice(0, eq)), v = miniAppDecodeURI(p.slice(eq + 1));
    if (k === 'hash') hash = v;
    else if (k === 'r' || k === 't' || k === 'b') { /* page params, not signed by Telegram */ }
    else {
      fields.push(k + '=' + v);
      if (k === 'auth_date') authDate = Number(v);
      if (k === 'user') userRaw = v;
    }
  }
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return { ok: false, reason: 'bad' };
  fields.sort();
  const calc = hex(await hmac(secret, fields.join('\n')));
  if (!safeEqual(calc, hash.toLowerCase())) return { ok: false, reason: 'hash' };
  now = now != null ? Number(now) : Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > MINIAPP_MAX_AGE || authDate > now + 60) return { ok: false, reason: 'expired' };
  let user = null;
  try { user = userRaw ? JSON.parse(userRaw) : null; } catch { return { ok: false, reason: 'bad' }; }
  if (!user || user.id == null) return { ok: false, reason: 'bad' };
  return { ok: true, uid: String(user.id), user };
}

/** miniAppPlatformLicLabel_ (Part2:3404) */
export function licLabel(t, graceDays, now = Date.now()) {
  const lic = licenseState(t, graceDays, now);
  if (t.status === TENANT_STATUS.SUSPENDED) return 'suspended';
  if (!lic.ok && lic.reason === 'expired') return 'expired';
  if (lic.grace) return 'grace';
  if (t.status === TENANT_STATUS.TRIAL) return 'trial';
  return 'active';
}

/**
 * The status-related part of miniAppPlatformTenantDto_ (Part2:3462). Fields the D1 mirror does not hold
 * (license, addons, ownerId, usage, editors…) are omitted; the page keeps them from the detail it already shows.
 */
export function miniAppTenantDto(t, graceDays, now = Date.now()) {
  const lic = licenseState(t, graceDays, now);
  return {
    id: t.id, name: t.name, status: t.status, kind: licLabel(t, graceDays, now),
    licenseOk: !!lic.ok, grace: !!lic.grace, reason: lic.reason || '',
    expiry: t.expiry != null ? dayKey(t.expiry) : '', graceEnd: lic.graceEnd ? dayKey(lic.graceEnd) : '',
    quota: t.quota, setup: t.setup || '', line: tenantLine(t, graceDays, now),
  };
}

// ───────── activity pause (Part1:1285 pauseLabel, Part2:541 fmtTime, Part2:550 pauseState, Part2:2754 miniAppAdminActDto_) ─────────
export const PAUSE_DAY = 86400000; // Part1:1601
const CAIRO_MIN = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** fmtTime(ms) in the script's timezone (Africa/Cairo): «YYYY-MM-DD HH:MM» */
export function fmtTime(ms) {
  if (ms == null || ms === '') return '';
  const p = Object.fromEntries(CAIRO_MIN.formatToParts(new Date(Number(ms))).map((x) => [x.type, x.value]));
  return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute;
}
export function pauseState(a, now) {
  const f = a && a.pausedFrom, u = a && a.pausedUntil;
  if (f == null && u == null) return null;
  if (f != null && now < f) return null;
  if (u != null && now >= u) return null;
  return { from: f == null ? null : f, until: u == null ? null : u };
}
export function pauseLabel(a, now) {
  const ps = pauseState(a, now);
  if (ps) return '⏸ موقوفة ' + (ps.until ? 'حتى ' + fmtTime(ps.until) : 'حتى يعاد تفعيلها');
  if (a && a.pausedFrom != null && now < a.pausedFrom) return '🗓 إيقاف مجدول من ' + fmtTime(a.pausedFrom) + (a.pausedUntil != null ? ' حتى ' + fmtTime(a.pausedUntil) : '');
  return '';
}
/** status part of miniAppAdminActDto_ */
export function actPauseDto(a, now) {
  const ps = pauseState(a, now);
  return { paused: !!ps, scheduled: !!(a && a.pausedFrom != null && now < a.pausedFrom && !ps), pauseLabel: pauseLabel(a, now) || '▶️ متاحة' };
}
// ───────── pause dates (Part2:197 latinDigits_, Part2:525 dateValue_, Part1:1296 parsePauseInput) ─────────
export const latinDigits = (s) => String(s).replace(/[\u0660-\u0669]/g, (d) => d.charCodeAt(0) - 0x0660).replace(/[\u06F0-\u06F9]/g, (d) => d.charCodeAt(0) - 0x06F0);
const GAP = Symbol('gap');
/**
 * new Date(y, mo-1, d, h, mi) in Africa/Cairo (the script's timeZone). Impossible dates → undefined, as in the script.
 * A wall time that does not exist (DST spring-forward gap) → GAP, and the caller leaves it to the script.
 * An ambiguous one (fall-back hour) → the earlier instant, which is what new Date() picks.
 */
export function cairoWallMs(y, mo, d, h, mi) {
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h >= 0 && h < 24 && mi >= 0 && mi < 60)) return undefined;
  const g = Date.UTC(y, mo - 1, d, h, mi);
  const back = new Date(g);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return undefined;
  const want = String(y).padStart(4, '0') + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0') + ' ' + String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
  const hits = [3, 2].map((off) => g - off * 3600000).filter((t) => fmtTime(t) === want); // Cairo is UTC+2 or UTC+3 (DST)
  return hits.length ? hits[0] : GAP;
}
/** dateValue_ for strings: null = empty, undefined = not understood, GAP = DST gap */
export function dateValueStr(v) {
  const s = latinDigits(String(v ?? '').trim());
  if (!s) return null;
  if (/T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) { const t = Date.parse(s); return isNaN(t) ? undefined : t; }
  let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T]+(\d{1,2})(?::(\d{2}))?)?$/);
  if (m) return cairoWallMs(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0));
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})(?:\s+(\d{1,2})(?::(\d{2}))?)?$/);
  if (m) return cairoWallMs(+m[3], +m[2], +m[1], +(m[4] || 0), +(m[5] || 0));
  return undefined;
}
/**
 * parsePauseInput without the error texts: {from, until} (ms), or null whenever the script would answer with an
 * error (or the input hits a DST gap), so the script keeps writing its own message.
 */
export function parsePauseRange(text, now) {
  const s = latinDigits(String(text ?? '').trim()).replace(/\s+/g, ' ');
  const parts = s.split(/\s*(?:إلى|الى|حتى|->|—)\s*/);
  if (parts.length > 2) return null;
  const a = dateValueStr(parts[0]), b = parts.length === 2 ? dateValueStr(parts[1]) : null;
  const bad = (x) => x == null || x === GAP;
  if (bad(a) || (parts.length === 2 && bad(b))) return null;
  if (parts.length === 1) return a <= now ? null : { from: now, until: a };
  if (b <= a || b <= now) return null;
  return { from: Math.max(a, now), until: b };
}

/**
 * The fast part of miniAppAdminPause_ (Part2:2911): resume, days>0, until='inf' (or nothing given), and explicit
 * dates (until | date | from+until) parsed exactly like the script. Returns {from, until, label} (ms or '') or null
 * when the script must answer (bad/past dates, non-string values, DST gap).
 */
export function planFastPause(body, resume, now) {
  if (resume) return { from: '', until: '', label: '▶️ متاحة الآن' };
  const days = Number(body.days);
  if (body.days && days > 0) { const until = now + days * PAUSE_DAY; return { from: now, until, label: '⏸ موقوفة حتى ' + fmtTime(until) }; }
  const u = String(body.until ?? '').trim();
  if (u === 'inf' || (!u && !String(body.from ?? '').trim() && !String(body.date ?? '').trim())) return { from: now, until: '', label: '⏸ موقوفة حتى يعاد تفعيلها' };
  for (const k of ['from', 'date', 'until']) if (body[k] != null && typeof body[k] !== 'string') return null;
  const str = (v) => String(v ?? '').trim();
  const start = str(body.from || body.date);
  const raw = start && u && u !== 'inf' ? start + ' إلى ' + u : str(body.until || body.date || body.from);
  const pr = parsePauseRange(raw, now);
  if (!pr) return null;
  const label = (pr.from > now + 60000 ? '🗓 إيقاف مجدول من ' + fmtTime(pr.from) + ' ' : '⏸ موقوفة ') + 'حتى ' + fmtTime(pr.until);
  return { from: pr.from, until: pr.until, label };
}
export { hmac, hex, enc };
