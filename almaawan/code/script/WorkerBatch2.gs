// ===== WorkerBatch2.gs =====
/**
 * WorkerBatch2.gs — batch 2 of the Cloudflare Worker fast path (WORKER_TENANTS only, today test2).
 * New ?b=worker action only (routed from workerBatch1_); no existing function is changed.
 *  - syncProgramOpen {tid,pid,open,opId,atMs,actor} → same write half as miniAppAdminToggleOpen_ (lock, programRow_,
 *                    column 4 = نعم/لا, invalidateProgram_, logChange_), never older-over-newer.
 */
function workerSyncProgramOpen_(t, body) {
  var pid = str_(body.pid);
  var want = body.open === true || body.open === 'true' || body.open === 1;
  var to = want ? OPT.YES : OPT.NO;
  var at = Number(body.atMs) || 0, lastKey = 'WORKER_OPEN_LAST:' + t.id + ':' + pid;
  var lock = tenantLock_();
  lock.waitLock(25000);
  try {
    var pr = programRow_(pid);
    if (!pr) return { ok: false, error: 'program not found' };
    var now = isYes_(pr.values[3]) ? OPT.YES : OPT.NO;
    if (at && Number(platformProp_(lastKey) || 0) > at) return { ok: true, stale: true, opId: body.opId, open: now === OPT.YES };
    if (now !== to) {
      pr.sh.getRange(pr.row, 4).setValue(to);
      invalidateProgram_(pid);
      var actor = body.actor || {};
      logChange_({ id: actor.id || '', first_name: actor.first_name || '', last_name: actor.last_name || '', username: actor.username || '' },
        pid, 'البرامج', pid, 'مفتوح للتسليم', now, to);
    }
    setPlatformProp_(lastKey, String(at || Date.now()));
    return { ok: true, opId: body.opId, open: want, same: now === to };
  } finally { lock.releaseLock(); }
}
