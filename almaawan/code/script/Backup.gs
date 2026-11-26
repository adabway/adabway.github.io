/**
 * Backup.js — نسخة احتياطية أسبوعية لسجل العملاء وملفات كل عميل (ملف التحكم وملفات البرامج).
 * المشغّل يبقى متوقفًا حتى يُشغَّل backupInstall_ مرة واحدة من المحرر.
 * مجلد الأرشيف يُقرأ من خاصية السكربت BACKUP_FOLDER_ID؛ إن غابت يُسجَّل الخطأ ويُتخطى التشغيل.
 * تُحفظ آخر 4 نسخ أسبوعية مكتملة. لا يُصدَّر كود المشروع: ذلك يحتاج نطاق
 * https://www.googleapis.com/auth/script.projects وهو غير مصرَّح حاليًا.
 */
var BACKUP = {
  PROP_FOLDER: 'BACKUP_FOLDER_ID',
  PROP_RESUME: 'BACKUP_RESUME_FOLDER',
  KEEP: 4,
  HANDLER: 'backupWeekly_',
  CONT_HANDLER: 'backupWeeklyContinue_',
  LOCK_KEY: 'backup:run',
  NAME_RE: /^\d{4}-\d{2}-\d{2}(T\d{4})?$/
};

/** مثبّت متماثل: ينشئ مشغّلًا أسبوعيًا (الأحد 3 صباحًا بتوقيت السكربت) إن لم يكن موجودًا. */
function backupInstall_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === BACKUP.HANDLER) {
      console.info('backupInstall_: a backupWeekly_ trigger already exists; nothing created.');
      return false;
    }
  }
  ScriptApp.newTrigger(BACKUP.HANDLER).timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
  console.info('backupInstall_: created a weekly Sunday 03:00 trigger for backupWeekly_.');
  return true;
}

function backupWeeklyContinue_() {
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === BACKUP.CONT_HANDLER) ScriptApp.deleteTrigger(t);
    });
  } catch (e) { /* تجاهل */ }
  return backupWeekly_();
}

/** معالج المشغّل الأسبوعي والاستئناف. لا يعمل إلا بعد backupInstall_. */
function backupWeekly_() {
  var prev = TENANT_;
  resetMemo_(); leaveTenant_();
  var budgetEnd = Date.now() + CENTRAL.BUDGET_MS;
  var sl = LockService.getScriptLock();
  if (!sl.tryLock(5000)) return { ok: false, reason: 'busy' };
  var busy;
  try {
    busy = rawCache_().get(BACKUP.LOCK_KEY);
    if (!busy) rawCache_().put(BACKUP.LOCK_KEY, String(Date.now()), 400);
  } finally { sl.releaseLock(); }
  if (busy) return { ok: false, reason: 'busy' };
  try {
    return backupRun_(budgetEnd);
  } catch (err) {
    logError_(err, 'backupWeekly_');
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    rawCache_().remove(BACKUP.LOCK_KEY);
    if (prev) enterTenant_(prev); else leaveTenant_();
  }
}

function backupRun_(budgetEnd) {
  var folderId = platformProp_(BACKUP.PROP_FOLDER);
  if (!folderId) {
    logError_(new Error('BACKUP_FOLDER_ID غير مضبوط'), 'backupWeekly_');
    return { ok: false, reason: 'missing-folder' };
  }
  var root;
  try { root = DriveApp.getFolderById(folderId); }
  catch (e) {
    logError_(e, 'backupWeekly_ folder ' + folderId);
    return { ok: false, reason: 'bad-folder' };
  }

  var dest = backupDestFolder_(root);
  if (!dest) return { ok: false, reason: 'dest' };
  var jobs = backupCollectJobs_();
  var names = backupExistingNames_(dest.folder);
  var copied = 0, skipped = 0, failed = 0, i = 0;
  for (i = 0; i < jobs.length; i++) {
    if (Date.now() > budgetEnd - 20000) {
      setPlatformProp_(BACKUP.PROP_RESUME, dest.folder.getId());
      backupScheduleContinuation_();
      return { ok: false, stopped: true, copied: copied, skipped: skipped, failed: failed, remaining: jobs.length - i };
    }
    var job = jobs[i];
    if (names[job.name]) { skipped++; continue; }
    try {
      DriveApp.getFileById(job.id).makeCopy(job.name, dest.folder);
      names[job.name] = 1;
      copied++;
    } catch (e) {
      failed++;
      logError_(e, 'backup copy ' + job.name);
    }
  }

  try { dest.folder.setName(dest.finalName); } catch (e) { logError_(e, 'backup rename ' + dest.finalName); }
  setPlatformProp_(BACKUP.PROP_RESUME, '');
  backupPrune_(root);
  return { ok: true, copied: copied, skipped: skipped, failed: failed, folder: dest.finalName };
}

/**
 * يجمع سجل العملاء ثم ملف التحكم وكل ملفات البرامج لكل عميل (بما في ذلك الموقوف والمنتهي).
 * يتخطى المعرّفات المكررة. لا يشمل أوراق ردود النماذج الخارجية غير المسجّلة في «البرامج».
 */
function backupCollectJobs_() {
  var jobs = [], seen = {};
  function add(id, name) {
    id = extractSpreadsheetId(id) || str_(id);
    if (!id || seen[id]) return;
    seen[id] = 1;
    jobs.push({ id: id, name: name });
  }
  add(platformProp_('REGISTRY_SS_ID'), 'registry');
  var tenants = [];
  try { tenants = listTenants_(); } catch (e) { logError_(e, 'backup listTenants_'); }
  tenants.forEach(function (t) {
    if (!t || !t.id) return;
    if (t.controlSsId) add(t.controlSsId, t.id + '__control');
    if (!t.controlSsId) return;
    try {
      var sh = openSS_(t.controlSsId).getSheetByName(BOT.PROGRAMS);
      if (!sh || sh.getLastRow() < 2) return;
      sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().forEach(function (r) {
        var pid = str_(r[0]), ssId = extractSpreadsheetId(r[2]);
        if (pid && ssId) add(ssId, t.id + '__prog_' + pid);
      });
    } catch (e) { logError_(e, 'backup programs ' + t.id); }
  });
  return jobs;
}

function backupDestFolder_(root) {
  var resume = platformProp_(BACKUP.PROP_RESUME);
  if (resume) {
    try {
      var f = DriveApp.getFolderById(resume);
      return { folder: f, finalName: String(f.getName()).replace(/\.inprogress$/, '') };
    } catch (e) { logError_(e, 'backup resume folder'); }
  }
  var tz = Session.getScriptTimeZone() || 'Africa/Cairo';
  var finalName = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  if (root.getFoldersByName(finalName).hasNext()) finalName = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HHmm");
  var folder = root.createFolder(finalName + '.inprogress');
  return { folder: folder, finalName: finalName };
}

function backupExistingNames_(folder) {
  var names = {}, it = folder.getFiles();
  while (it.hasNext()) names[it.next().getName()] = 1;
  return names;
}

function backupScheduleContinuation_() {
  try {
    if (ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === BACKUP.CONT_HANDLER; })) return;
    ScriptApp.newTrigger(BACKUP.CONT_HANDLER).timeBased().after(CENTRAL.CONT_AFTER_MS).create();
  } catch (e) { logError_(e, 'backup continuation trigger'); }
}

/** يبقي آخر KEEP مجلدات مكتملة (اسمها تاريخ)، ويُرسل الأقدم إلى المهملات. لا يمسّ مجلدًا غير مكتمل. */
function backupPrune_(root) {
  var list = [], it = root.getFolders();
  while (it.hasNext()) {
    var f = it.next(), n = f.getName();
    if (BACKUP.NAME_RE.test(n)) list.push({ folder: f, name: n });
  }
  list.sort(function (a, b) { return a.name < b.name ? 1 : a.name > b.name ? -1 : 0; });
  for (var i = BACKUP.KEEP; i < list.length; i++) {
    try { list[i].folder.setTrashed(true); } catch (e) { logError_(e, 'backup prune ' + list[i].name); }
  }
}

/** تهيئة تلقائية من فحص الصحة: يضبط مجلد النسخ الافتراضي إن غاب ويثبّت المشغّل الأسبوعي. متماثلة. */
var BACKUP_DEFAULT_FOLDER_ID = '19cDG4scJlWmud6oMxfjUhViNk9uyjpzX';
function backupEnsure_() {
  var sp = PropertiesService.getScriptProperties();
  if (!sp.getProperty('BACKUP_FOLDER_ID')) sp.setProperty('BACKUP_FOLDER_ID', BACKUP_DEFAULT_FOLDER_ID);
  backupInstall_();
}
