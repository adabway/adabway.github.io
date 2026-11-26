// ===== WorkerBatch1.gs =====
/**
 * WorkerBatch1.gs — batch 1 of the Cloudflare Worker fast path (WORKER_TENANTS only, today test2).
 * New ?b=worker actions only; no existing function is changed. Called from workerSyncPost_ (WorkerSync.gs).
 *  - exportAppKeys     {tid}  → derived Telegram WebApp keys HMAC_SHA256("WebAppData", token) per role (cannot call the Bot API)
 *  - exportActivities  {tid}  → programs + ACTIVITIES pause columns + admins + owner, for the Worker's D1 mirror
 *  - syncActivityPause {tid,pid,ref,from,until,opId,atMs,actor} → same write half as miniAppAdminPause_ (lock, planPause,
 *                               validatePlan, writePlan_, invalidateProgram_, logChange_), never older-over-newer.
 */
function workerBatch1_(body, allowed) {
  var a = body && body.action;
  if (a !== 'exportAppKeys' && a !== 'exportActivities' && a !== 'syncActivityPause' && a !== 'syncProgramOpen' && a !== 'exportBotHook' && a !== 'exportStudentViews' && a !== 'studentViewServed') return null; // syncProgramOpen: WorkerBatch2.gs; batch 2a: WorkerBatch3.gs
  var tid = String(body.tid || '').toLowerCase();
  if (allowed.indexOf(tid) < 0) return { ok: false, error: 'tenant not allowed' };
  var t = loadTenant_(tid, true);
  if (!t) return { ok: false, error: 'tenant not found' };
  if (a === 'exportAppKeys') return workerAppKeys_(t);
  if (a === 'exportActivities') return withTenant_(t, function () { return workerActivities_(t); });
  if (a === 'syncProgramOpen') return withTenant_(t, function () { return workerSyncProgramOpen_(t, body); });
  if (a === 'exportBotHook') return withTenant_(t, function () { return workerExportBotHook_(t, body); });
  if (a === 'exportStudentViews') return withTenant_(t, function () { return workerExportStudentViews_(t, body); });
  if (a === 'studentViewServed') return withTenant_(t, function () { return workerStudentViewServed_(t, body); });
  return withTenant_(t, function () { return workerSyncActivityPause_(t, body); });
}

function workerDerivedKeyHex_(token) {
  if (!token) return '';
  return miniAppHex_(Utilities.computeHmacSha256Signature(Utilities.newBlob(String(token)).getBytes(), Utilities.newBlob('WebAppData').getBytes()));
}

function workerAppKeys_(t) {
  var mode = tenantPropOf_(t.id, 'BOT_MODE') === 'unified' ? 'unified' : 'dual';
  var stok = tenantPropOf_(t.id, 'BOT_TOKEN'), atok = tenantPropOf_(t.id, 'ADMIN_BOT_TOKEN');
  var keys = {};
  // same token choice as tokenFor_(role) inside the tenant
  keys.student = workerDerivedKeyHex_(stok);
  keys.unified = workerDerivedKeyHex_(stok);
  keys.admin = workerDerivedKeyHex_(atok || (mode === 'unified' ? stok : ''));
  return { ok: true, tid: t.id, mode: mode, keys: keys, now: Date.now() };
}

function workerActivityDto_(pid, a) {
  return { pid: pid, key: a.key || a.title, title: a.title, level: a.level || '', points: a.points == null ? null : a.points,
    bot: a.bot !== false, pausedFrom: a.pausedFrom == null ? null : Number(a.pausedFrom), pausedUntil: a.pausedUntil == null ? null : Number(a.pausedUntil) };
}

function workerActivities_(t) {
  var programs = [], activities = [], errors = [];
  getPrograms_().forEach(function (p) {
    programs.push({ pid: p.id, name: p.name || p.id, open: !!p.open });
    try {
      var cfg = parseSettings(settingsValues_(p.id, true));
      (cfg.activities || []).forEach(function (a) { activities.push(workerActivityDto_(p.id, a)); });
    } catch (e) { errors.push(p.id + ': ' + e.message); }
  });
  return {
    ok: true, tid: t.id, ownerId: str_(t.ownerId), setup: t.setup, miniApp: isModuleActive_('miniApp'), licenseOk: !!licenseState_(t).ok,
    unified: isUnifiedTenant_(), programs: programs, activities: activities,
    admins: readAdmins_().map(function (x) { return { id: x.id, name: x.name, programs: x.programs }; }),
    errors: errors, now: Date.now()
  };
}

function workerSyncActivityPause_(t, body) {
  var pid = str_(body.pid), ref = str_(body.ref);
  var from = body.from === '' || body.from == null ? '' : Number(body.from);
  var until = body.until === '' || body.until == null ? '' : Number(body.until);
  var at = Number(body.atMs) || 0, lastKey = 'WORKER_ACT_LAST:' + t.id + ':' + pid + ':' + ref;
  if (!getPrograms_().some(function (p) { return p.id === pid; })) return { ok: false, error: 'program not found' };
  var label = typeof body.label === 'string' && body.label && body.label.length <= 120 ? body.label : (from === '' && until === '' ? '▶️ متاحة الآن' : (until === '' ? '⏸ موقوفة حتى يعاد تفعيلها' : '⏸ موقوفة حتى ' + fmtTime(until)));
  var lock = tenantLock_();
  lock.waitLock(25000);
  try {
    var sh = programSpreadsheet_(pid).getSheetByName(NAMES.SETTINGS);
    var values = sh.getDataRange().getValues();
    var act = parseSettings(values).activities.filter(function (a) { return (a.key || a.title) === ref; })[0];
    if (!act) return { ok: false, error: 'activity not found' };
    if (at && Number(platformProp_(lastKey) || 0) > at) return { ok: true, stale: true, opId: body.opId, activity: workerActivityDto_(pid, act) };
    var old = pauseLabel(act, Date.now()) || '▶️ متاحة';
    var plan = planPause(values, ref, from === '' ? '' : new Date(from), until === '' ? '' : new Date(until));
    var err = validatePlan(values, plan);
    if (err) return { ok: false, error: 'invalid: ' + err };
    writePlan_(sh, plan);
    invalidateProgram_(pid);
    var actor = body.actor || {};
    logChange_({ id: actor.id || '', first_name: actor.first_name || '', last_name: actor.last_name || '', username: actor.username || '' },
      pid, SECTIONS.ACTIVITIES, ref, 'إيقاف مؤقت', old, label);
    setPlatformProp_(lastKey, String(at || Date.now()));
    var now = parseSettings(sh.getDataRange().getValues()).activities.filter(function (a) { return (a.key || a.title) === ref; })[0];
    return { ok: true, opId: body.opId, label: label, activity: workerActivityDto_(pid, now || act) };
  } finally { lock.releaseLock(); }
}
