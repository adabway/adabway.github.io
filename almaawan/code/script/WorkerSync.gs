// ===== WorkerSync.gs =====
/**
 * WorkerSync.gs — private endpoint for the Cloudflare Worker that answers /suspend and /resume
 * for allowlisted tenants from D1. The Sheet stays the source of truth: the Worker pushes each
 * change here, and re-pulls rows periodically (exportTenants).
 */
function workerOut_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function workerTenants_() { return str_(platformProp_('WORKER_TENANTS')).toLowerCase().split(/[\s,،;]+/).filter(function (x) { return TENANT_ID_RE.test(x); }); }

/** Tenant DTO for D1 — only what /suspend|/resume and tenantLine_ need, plus «آخر تحديث» */
function workerTenantDto_(t) {
  var updated = null;
  try { var u = registrySheet_().getRange(t.row, RC.UPDATED + 1).getValue(); updated = u instanceof Date ? u.getTime() : (str_(u) ? new Date(u).getTime() : null); } catch (e) { /* تجاهل */ }
  return { id: t.id, name: t.name, status: t.status, expiry: t.expiry, quota: t.quota, setup: t.setup, row: t.row, updatedMs: isNaN(updated) ? null : updated };
}

function workerSyncPost_(e) {
  var p = (e && e.parameter) || {};
  var secret = platformProp_('WORKER_SYNC_SECRET');
  if (!secret || !safeEqual_(p.k, secret)) return out_('forbidden');
  var body; try { body = JSON.parse(e.postData.contents); } catch (x) { return workerOut_({ ok: false, error: 'bad json' }); }
  var allowed = workerTenants_();

  if (body.action === 'exportTenants') {
    var want = (body.ids || []).map(function (x) { return String(x).toLowerCase(); }).filter(function (x) { return allowed.indexOf(x) >= 0; });
    var rows = want.length ? listTenantsFromSheet_().filter(function (t) { return want.indexOf(t.id) >= 0; }) : []; // fresh from the Sheet
    return workerOut_({ ok: true, platformOwnerId: str_(platformProp_('PLATFORM_OWNER_ID')), graceDays: graceDays_(), now: Date.now(), tenants: rows.map(workerTenantDto_) });
  }

  if (body.action === 'syncTenantStatus') {
    var tid = String(body.tid || '').toLowerCase(), status = String(body.status || '');
    if (allowed.indexOf(tid) < 0) return workerOut_({ ok: false, error: 'tenant not allowed' });
    if (status !== TENANT_STATUS.SUSPENDED && status !== TENANT_STATUS.ACTIVE) return workerOut_({ ok: false, error: 'bad status' });
    var at = Number(body.atMs) || 0, lastKey = 'WORKER_LAST_OP_AT:' + tid;
    var lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      // Ops can arrive out of order (async pushes / cron retries): never let an older op overwrite a newer one.
      if (at && Number(platformProp_(lastKey) || 0) > at) {
        var cur = loadTenant_(tid, true);
        return workerOut_({ ok: true, stale: true, opId: body.opId, tenant: cur ? workerTenantDto_(cur) : null });
      }
      var t = tid === 'test2' ? (loadTenantTest2Fast_(tid) || loadTenant_(tid, true)) : loadTenant_(tid, true); // as ownerCommand_
      if (!t) return workerOut_({ ok: false, error: 'tenant not found' });
      var nt = setTenantSuspended_(t, status === TENANT_STATUS.SUSPENDED).tenant; // same side effects, no send_()
      setPlatformProp_(lastKey, String(at || Date.now()));
      invalidateTenant_(tid);       // ten:<id> (TENANT_TTL 300 s) → tenant bot doPost sees the new status at once
      invalidateTenantsCache_();    // tenants:v1 (120 s)
      return workerOut_({ ok: true, opId: body.opId, tenant: workerTenantDto_(nt) });
    } finally { lock.releaseLock(); }
  }
  var b1 = workerBatch1_(body, allowed); // WorkerBatch1.gs (new actions only)
  if (b1) return workerOut_(b1);
  return workerOut_({ ok: false, error: 'unknown action' });
}