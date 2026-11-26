
// ===== Reminders.gs =====
/**
 * Reminders.gs — إرسال التذكيرات الآلية (v7) من بوت الطلاب، عبر المشغّل الساعي نفسه (weeklyReportTick).
 * • دفعات متوازية (fetchAll) بحد ~25 رسالة/ثانية، وتتوقف قرب 4.5 دقيقة ثم تُكمل في التشغيل التالي (لا تكرار: كل رسالة لها مفتاح في «سجل التذكيرات»).
 * • 403 (الطالب أوقف البوت) ← يُعلَّم «محظور» ويُتخطى حتى يعود فيستعمل البوت.
 * • لا قفل طويل: علامة تشغيل قصيرة في الذاكرة المؤقتة حتى لا تتأخر تسليمات الطلاب.
 */
var REM = { BATCH: 25, PAUSE_MS: 1000, BUDGET_MS: 270000, MANUAL_BUDGET_MS: 40000, MAX_BATCHES: Infinity, FAIL_MAX: 3, JOB_TTL: 86400000 };

function remSheet_(name, headers) {
  var ss = central_(), sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    try { sh.hideSheet(); } catch (e) { /* اختياري */ }
  }
  return sh;
}
function remValues_(name) { var sh = central_().getSheetByName(name); return sh && sh.getLastRow() > 1 ? sh.getDataRange().getValues() : []; }

/** فهرس التسليمات المقبولة: بريد ← {byKey: {مفتاح: [أوقات]}, last, levels, chat, chatT, name} */
function remSubsIndex_(values) {
  var out = {};
  if (!values || values.length < 2) return out;
  var h = values[0].map(str_), ix = function (n) { return h.indexOf(n); };
  var ie = ix('البريد'), ia = ix('الفعالية'), il = ix(LEVEL_HEADER), ist = ix('الحالة'), it = ix('الطابع الزمني'), ic = ix('معرف المحادثة'), iu = ix('معرف المستخدم'), iname = ix('الاسم'), iid = ix('معرف التسليم');
  var seen = {};
  values.slice(1).forEach(function (r) {
    var e = normalizeEmail(r[ie]); if (!e) return;
    var x = out[e] || (out[e] = { byKey: {}, last: null, levels: {}, chat: '', chatT: -1, uid: '', name: '' });
    var t = dateValue_(r[it]); if (t == null || t === undefined) t = 0;
    var lv = il >= 0 ? str_(r[il]) : '';
    if (lv) x.levels[lv] = 1;
    if (ic >= 0 && str_(r[ic]) && t >= x.chatT) { x.chat = str_(r[ic]); x.chatT = t; x.uid = iu >= 0 ? str_(r[iu]) : x.chat; }
    if (iname >= 0 && str_(r[iname])) x.name = str_(r[iname]);
    if (ist >= 0 && SUB_REJECTED.indexOf(str_(r[ist])) >= 0) return;
    var id = iid >= 0 ? str_(r[iid]) : ''; if (id && seen[id]) return; if (id) seen[id] = 1;
    var key = str_(r[ia]) + (lv ? ' (' + lv + ')' : '');
    [key, str_(r[ia])].forEach(function (k, j) { if (j && k === key) return; (x.byKey[k] = x.byKey[k] || []).push(t); });
    if (x.last == null || t > x.last) x.last = t;
  });
  return out;
}

/** حالة كل مستخدم في «إيقاف التذكيرات» (الأحدث) */
function remOffMap_() {
  var m = {};
  remValues_(REMIND_OFF).slice(1).forEach(function (r) { m[str_(r[0])] = { state: str_(r[1]), t: dateValue_(r[2]) || 0 }; });
  return m;
}
function remSetOff_(uid, state, note) {
  remSheet_(REMIND_OFF, REMIND_OFF_HEADERS).appendRow([String(uid), state, new Date(), note || '']);
  cache_().remove('rmo:' + uid);
}
/** هل أوقف الطالب التذكيرات؟ (ذاكرة مؤقتة؛ لزر «🔕/🔔») */
function remIsOff_(uid) {
  var c = cache_().get('rmo:' + uid);
  if (c != null) return c === '1';
  var o = remOffMap_()[String(uid)], off = !!o && o.state === 'موقوفة';
  cache_().put('rmo:' + uid, off ? '1' : '0', TTL.USER);
  return off;
}

/** كل ما يحتاجه التخطيط لبرنامج */
function remContext_(prog, now) {
  var ss = openSS_(prog.ssId), subsSh = ss.getSheetByName(NAMES.SUBMISSIONS);
  var subsValues = subsSh ? subsSh.getDataRange().getValues() : [];
  var subs = remSubsIndex_(subsValues);
  // الروابط: «المستخدمون» (معرّف ← البريد المحفوظ) + محادثات ورقة التسليمات
  var users = {}, lastSeen = {};
  remValues_(BOT.USERS).slice(1).forEach(function (r) {
    var uid = str_(r[0]), e = normalizeEmail(r[1]), t = dateValue_(r[3]) || 0;
    if (!uid) return; users[uid] = e; lastSeen[uid] = Math.max(lastSeen[uid] || 0, t);
  });
  var links = {};
  Object.keys(subs).forEach(function (e) {
    var x = subs[e]; if (!x.chat) return;
    lastSeen[x.uid] = Math.max(lastSeen[x.uid] || 0, x.chatT);
    if (users[x.uid] && users[x.uid] !== e) return; // الحساب صار يستعمل بريدًا آخر
    links[e] = { chat: x.chat, uid: x.uid, t: x.chatT };
  });
  Object.keys(users).forEach(function (uid) { var e = users[uid]; if (e && (!links[e] || (lastSeen[uid] || 0) >= links[e].t)) links[e] = { chat: uid, uid: uid, t: lastSeen[uid] || 0 }; });
  var reg = null; try { reg = getRegMap_(prog, false).map; } catch (e) { reg = null; }
  var off = remOffMap_(), students = {};
  Object.keys(links).forEach(function (e) {
    if (reg && reg[e] == null) return; // غير مسجل في هذا البرنامج
    var L = links[e], o = off[L.uid];
    if (o && o.state === 'موقوفة') return;
    if (o && o.state === RST.BLOCKED && (lastSeen[L.uid] || 0) <= o.t) return;
    students[e] = { name: (reg && reg[e]) || (subs[e] && subs[e].name) || '', chat: L.chat, uid: L.uid, levels: (subs[e] || {}).levels || {} };
  });
  var done = {}, fails = {};
  remValues_(REMIND_LOG).slice(1).forEach(function (r) {
    if (str_(r[1]) !== prog.id) return;
    var k = normalizeEmail(r[4]) + '|' + str_(r[3]), s = str_(r[6]);
    if (s === RST.FAIL) { fails[k] = (fails[k] || 0) + 1; if (fails[k] >= REM.FAIL_MAX) done[k] = 1; } else done[k] = 1;
  });
  var snapMemo = null, needMemo = null;
  var snap = function () { if (!snapMemo) snapMemo = standingSnapshot_(prog); return snapMemo; };
  return {
    now: now, prog: prog, items: prog.schedule || [], students: students, subs: subs, done: done, subsValues: subsValues,
    quizDone: function (e, key) { var x = snap().s[e]; return !!(x && x[1][key] != null); },
    needed: function (e) {
      if (!needMemo) {
        needMemo = {};
        var out = calculateForSpreadsheet(ss, { write: false }), multi = (out.res.levels || []).length > 0;
        try { putStandingSnapshot_(prog.id, out); } catch (x) { /* اختياري */ }
        out.res.students.forEach(function (s) { needMemo[s.email] = pointsNeeded(s, out.input.cfg.general, multi); });
      }
      if (needMemo[e] != null) return needMemo[e];
      // مسجّل بلا أي درجة (لا يظهر في نتيجة المحرك حين تكون القاعدة «من له درجة»): ينقصه النجاح كله
      var g = prog.general, pm = num_(g.overallPassMark) != null && (prog.levels || []).length ? num_(g.overallPassMark) : num_(g.passMark);
      return pm == null ? null : pm;
    }
  };
}

function shortHash_(s) { var h = 0; s = String(s); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 46656; return h.toString(36); }

/** أزرار رسالة التذكير */
function remKeyboard_(prog, m) {
  var kb = [];
  var it = m.item;
  if (it && it.kind === 'component' && /^https?:\/\//.test(it.link)) kb.push([{ text: '📤 سلّم الآن', url: it.link }]);
  else if (it && it.kind === 'activity') {
    var i = -1; prog.activities.forEach(function (a, k) { if (a.key === it.key) i = k; });
    var lvs = Object.keys(m.levels || {}), lvi = it.level ? prog.levels.indexOf(it.level) : (lvs.length === 1 ? prog.levels.indexOf(lvs[0]) : -1);
    if (i >= 0) kb.push([{ text: '📤 سلّم الآن', callback_data: 'go:' + prog.id + ':' + i + ':' + (lvi >= 0 ? lvi : '-') + ':' + shortHash_(it.key) }]);
  } else kb.push([{ text: '📋 تسليم مشاركة', callback_data: 'p:' + prog.id }]);
  kb.push([{ text: '🔕 إيقاف التذكيرات', callback_data: 'rm:off' }]);
  return kb;
}

/**
 * يرسل الرسائل دفعات. يعيد {sent, failed, blocked, skipped, left, byType, stopped}
 * budgetEnd: لحظة التوقف (ms)؛ ما لم يُرسل يبقى بلا سجل فيُكمل في التشغيل التالي.
 */
function remSend_(prog, msgs, budgetEnd) {
  var r = { sent: 0, failed: 0, blocked: 0, skipped: 0, left: 0, byType: {}, stopped: false, errors: [] };
  var log = remSheet_(REMIND_LOG, REMIND_LOG_HEADERS), rows = [];
  var flush = function () { if (rows.length) { log.getRange(log.getLastRow() + 1, 1, rows.length, REMIND_LOG_HEADERS.length).setValues(rows); rows = []; } };
  var row = function (m, status, note) { rows.push([new Date(), prog.id, m.type, m.key, m.email, String(m.chat), status, note || '']); };
  msgs.filter(function (m) { return m.skip; }).forEach(function (m) { row(m, RST.SKIP, 'فات وقته (أُرسل تذكير أحدث)'); r.skipped++; });
  var todo = msgs.filter(function (m) { return !m.skip; }), batches = 0, i = 0;
  while (i < todo.length) {
    if (Date.now() >= budgetEnd || batches >= REM.MAX_BATCHES) { r.stopped = true; break; }
    if (batches) Utilities.sleep(REM.PAUSE_MS);
    var chunk = todo.slice(i, i + REM.BATCH), stop429 = false;
    var res = UrlFetchApp.fetchAll(chunk.map(function (m) {
      return tgRequest_('student', 'sendMessage', { chat_id: m.chat, text: m.text, disable_web_page_preview: true, reply_markup: { inline_keyboard: remKeyboard_(prog, m) } });
    }));
    batches++;
    res.forEach(function (x, k) {
      var m = chunk[k], j;
      try { j = JSON.parse(x.getContentText()); } catch (e) { j = { ok: false, description: 'رد غير مفهوم' }; }
      if (j.ok) { row(m, RST.SENT); r.sent++; r.byType[m.type] = (r.byType[m.type] || 0) + 1; return; }
      if (j.error_code === 429) { stop429 = true; r.left++; return; } // حد السرعة: يُعاد لاحقًا بلا سجل
      if (j.error_code === 403) { row(m, RST.BLOCKED, String(j.description || '').slice(0, 200)); r.blocked++; try { remSetOff_(m.uid || m.chat, RST.BLOCKED, 'من التذكيرات'); } catch (e) { /* اختياري */ } return; }
      row(m, RST.FAIL, String(j.description || '').slice(0, 200)); r.failed++;
      if (r.errors.length < 3) r.errors.push(String(j.description || ''));
    });
    i += chunk.length;
    flush();
    if (stop429) { r.stopped = true; break; }
  }
  r.left += todo.length - i;
  flush();
  return r;
}

/* ───────── المهام اليدوية («📣 أرسل تذكيرًا الآن») ───────── */
function remJobs_() { try { return JSON.parse(prop_('REM_JOBS') || '[]'); } catch (e) { return []; } }
function remSaveJobs_(list) { setProp_('REM_JOBS', JSON.stringify(list)); }

/** علامة تشغيل قصيرة لكل برنامج (بدل قفل طويل) */
function remClaim_(pid) {
  var lock = tenantLock_();
  if (!lock.tryLock(5000)) return false;
  try { if (cache_().get('remrun:' + pid)) return false; cache_().put('remrun:' + pid, '1', 330); return true; } finally { lock.releaseLock(); }
}
function remRelease_(pid) { cache_().remove('remrun:' + pid); }

/**
 * تشغيل برنامج واحد: تخطيط ثم إرسال ثم ملخص للمشرفين.
 * p = { now, budgetEnd, jobs (يدوية لهذا البرنامج), manualNow (إرسال يدوي فوري يتجاهل ساعات الهدوء) }
 */
function runRemindersFor_(prog, p) {
  var opts = reminderOptions(prog.general);
  if (p.manualNow) opts = Object.assign({}, opts, { quiet: null });
  if (p.onlyManual) opts = Object.assign({}, opts, { on: false });
  var quietNow = inQuiet(new Date(p.now).getHours(), opts.quiet);
  if (quietNow || (opts.end != null && p.now > opts.end + 3 * DAY_MS && !(p.jobs || []).length)) return { sent: 0, failed: 0, blocked: 0, skipped: 0, left: 0, byType: {}, planned: 0, quiet: quietNow }; // لا قراءة أوراق بلا داعٍ
  var ctx = remContext_(prog, p.now);
  var msgs = planReminders(Object.assign({ opts: opts, manual: p.jobs || [] }, ctx));
  msgs.forEach(function (m) { m.levels = (ctx.students[m.email] || {}).levels; m.uid = (ctx.students[m.email] || {}).uid; });
  if (!msgs.length) return { sent: 0, failed: 0, blocked: 0, skipped: 0, left: 0, byType: {}, planned: 0, quiet: quietNow };
  var r = remSend_(prog, msgs, p.budgetEnd);
  r.planned = msgs.length;
  r.quiet = quietNow;
  if (r.sent + r.failed + r.blocked && !p.manualNow) remSummary_(prog, r, opts);
  return r;
}

function remSummary_(prog, r, opts) {
  if (opts.summary === 'لا أحد') return;
  var types = Object.keys(r.byType).map(function (t) { return RTYPE_LABEL[t] + ' ' + r.byType[t]; }).join('، ');
  var text = '🔔 دفعة تذكيرات «' + (prog.name || prog.id) + '» — ' + fmtTime(Date.now()) +
    '\n✅ أُرسل: ' + r.sent + (types ? ' (' + types + ')' : '') + '\n⚠️ فشل: ' + r.failed + ' | 🚫 أوقفوا البوت: ' + r.blocked +
    (r.left ? '\n⏳ متبقٍّ يُكمل في التشغيل التالي: ' + r.left : '') + (r.errors && r.errors.length ? '\nسبب الفشل: ' + r.errors.join(' | ').slice(0, 300) : '');
  weeklyRecipients_(prog.id, { admins: opts.summary === 'المالك والمشرفون' }).forEach(function (id) {
    tgAs_('admin', 'sendMessage', { chat_id: id, text: text, disable_web_page_preview: true }, true);
  });
}

/** يُستدعى من المشغّل الساعي لكل البرامج المفتوحة */
function remindersTick_(now, t0) {
  var jobs = remJobs_().filter(function (j) { return now - j.t < REM.JOB_TTL; }), keep = [];
  getPrograms_().forEach(function (p) {
    var mine = jobs.filter(function (j) { return j.pid === p.id; });
    if (!p.open) return;
    try {
      var prog = loadProgram_(p.id);
      if (!prog || (!reminderOptions(prog.general).on && !mine.length)) { keep = keep.concat(mine); return; }
      if (!remClaim_(p.id)) { keep = keep.concat(mine); return; }
      try {
        var r = runRemindersFor_(prog, { now: now, budgetEnd: t0 + REM.BUDGET_MS, jobs: mine });
        if (r.left || r.quiet) keep = keep.concat(mine); // ساعات الهدوء: التذكير اليدوي المؤجل ينتظر
      } finally { remRelease_(p.id); }
    } catch (e) { logError_(e, 'reminders ' + p.id); keep = keep.concat(mine); }
  });
  var before = remJobs_().length;
  if (keep.length !== before || jobs.length !== before) remSaveJobs_(keep);
}

/* ───────── المعاينة وإحصاءات التقرير الأسبوعي ───────── */

/** معاينة الغد: كل ساعة من الغد، والمرسل فعلًا لا يتكرر */
function previewReminders_(prog, now) {
  var opts = reminderOptions(prog.general), ctx = remContext_(prog, now);
  var preview = Object.assign({}, opts, { on: true }); // تُعرض حتى لو كانت التذكيرات موقوفة
  var t0 = dayStart_(now) + DAY_MS, seen = {}, all = [];
  for (var h = 0; h < 24; h++) {
    planReminders(Object.assign({}, ctx, { now: t0 + h * HOUR_MS, opts: preview, done: Object.assign({}, ctx.done, seen) })).forEach(function (m) {
      seen[m.email + '|' + m.key] = 1; if (!m.skip) { m.at = t0 + h * HOUR_MS; all.push(m); }
    });
  }
  var L = ['👀 معاينة تذكيرات الغد (' + fmtTime(t0).slice(0, 10) + ') — «' + (prog.name || prog.id) + '»'];
  if (!opts.on) L.push('(التذكيرات الآلية موقوفة الآن؛ هذا ما سيُرسل إن فُعّلت مع الأنواع المفعّلة)');
  var off = ['open', 'before', 'missed', 'risk', 'idle'].filter(function (t) { return !opts[t]; });
  if (off.length) L.push('أنواع موقوفة لا تُعرض: ' + off.map(function (t) { return RTYPE_LABEL[t]; }).join('، '));
  L.push('الطلاب المرتبطون بالبوت: ' + Object.keys(ctx.students).length, '');
  if (!all.length) { L.push('لا شيء يُرسل غدًا.'); return L.join('\n'); }
  var groups = {};
  all.forEach(function (m) { var g = RTYPE_LABEL[m.type] + (m.item ? ' — ' + m.item.key : ''); (groups[g] = groups[g] || []).push(m); });
  Object.keys(groups).forEach(function (g) {
    var list = groups[g];
    L.push('• ' + g + ': ' + list.length + ' طالب (الساعة ' + new Date(list[0].at).getHours() + ':00)');
    L.push('   ' + list.slice(0, 8).map(function (m) { return ctx.students[m.email].name || m.email; }).join('، ') + (list.length > 8 ? '… و' + (list.length - 8) : ''));
  });
  L.push('', 'مثال نص الرسالة:', '«' + all[0].text + '»');
  return clip(L.join('\n'));
}

/** إحصاءات التذكيرات لآخر أسبوع (للتقرير الأسبوعي) */
function reminderStats_(pid, since, subsValues) {
  var rows = remValues_(REMIND_LOG).slice(1).filter(function (r) { return str_(r[1]) === pid && (dateValue_(r[0]) || 0) >= since; });
  var st = { sent: 0, failed: 0, blocked: 0, byType: {}, followBase: 0, followed: 0 };
  if (!rows.length) return st;
  var subs = remSubsIndex_(subsValues);
  rows.forEach(function (r) {
    var s = str_(r[6]), type = str_(r[2]);
    if (s === RST.FAIL) st.failed++;
    if (s === RST.BLOCKED) st.blocked++;
    if (s !== RST.SENT) return;
    st.sent++; st.byType[type] = (st.byType[type] || 0) + 1;
    if (['open', 'before', 'missed', 'manual'].indexOf(type) < 0) return;
    var key = str_(r[3]).split('@')[1], t = dateValue_(r[0]) || 0, ts = (((subs[normalizeEmail(r[4])] || {}).byKey || {})[key]) || [];
    st.followBase++;
    if (ts.some(function (x) { return x > t; })) st.followed++;
  });
  return st;
}

// ===== ReviewGroup.gs =====
/**
 * ReviewGroup.gs — مجموعة المراجعة في بوت الطلاب:
 *  (١) ربطها من داخلها: /linkreview [معرف البرنامج] و /unlinkreview (للمالك ومشرفي البرنامج فقط).
 *  (٢) الرد على تسليم بعينه: يرد المشرف (Reply) على رسالة التسليم في المجموعة فتصل ملاحظته إلى الطالب.
 * في المجموعات لا يعمل أي مسار تسليم للطلاب؛ كل ما عدا ما سبق يُتجاهل دون أي قراءة للجداول.
 * خريطة «رسالة في المجموعة ← التسليم» في ورقة مخفية «رسائل المراجعة» بملف التحكم + ذاكرة مؤقتة.
 */
var REVIEW_MAP = { SHEET: 'رسائل المراجعة', TTL: 21600 };
var REVIEW_MAP_HEADERS = ['المفتاح', 'الوقت', 'معرف المجموعة', 'معرف الرسالة في المجموعة', 'البرنامج', 'الفعالية', 'رقم التسليم',
  'معرف التسليم', 'محادثة الطالب', 'معرف الطالب', 'رسالة الطالب', 'البريد', 'الاسم'];
var FEEDBACK_HEADER = 'ملاحظات المشرف';
var REVIEW_HDR_FLAG = 'سطر التعريف'; // v6: عمود 14 = 1 لسطر التعريف (عليه أزرار الرفض)؛ صفوف v5 بلا قيمة

var GROUP_HELP = 'دليل مجموعة المراجعة (للمشرفين):\n' +
  '• /linkreview — ربط هذه المجموعة ببرنامج لتصلها نسخة من كل تسليم (أو /linkreview course1).\n' +
  '• /unlinkreview — إيقاف إرسال التسليمات إلى هذه المجموعة.\n' +
  '• ❌ «رفض» تحت سطر تعريف التسليم: يُلغى احتسابه ويُبلغ الطالب؛ «رفض مع ملاحظة» يطلب السبب؛ و«↩️ تراجع عن الرفض» يعيده.\n' +
  '• للرد على طالب: اضغط «رد» (Reply) على رسالة تسليمه هنا (السطر الأول أو المحتوى المنسوخ) واكتب ملاحظتك نصًّا أو أرسل صورة/ملفًا/تسجيلًا صوتيًا؛ تصله من البوت مع رقم تسليمه، ويظهر 👍 على ردك عند الإيصال.\n' +
  '• الردود من غير المشرفين، والرسائل التي ليست ردًّا على تسليم، يتجاهلها البوت.\n' +
  '• لا ترسل الأوامر وأنت «مشرف مجهول الهوية»: البوت لا يعرف من أنت حينها.\n' +
  'يُستحسن أن يكون البوت مشرفًا (Admin) في المجموعة.';

function isGroupChat_(chat) { return !!chat && (chat.type === 'group' || chat.type === 'supergroup'); }

/** مدخل رسائل المجموعات في بوت الطلاب */
function onGroupMessage_(m) {
  if (m.migrate_to_chat_id) return migrateReviewChat_(String(m.chat.id), String(m.migrate_to_chat_id));
  if (m.migrate_from_chat_id) return migrateReviewChat_(String(m.migrate_from_chat_id), String(m.chat.id));
  var text = m.text ? String(m.text).trim() : '';
  if (text.charAt(0) === '/') return onGroupCommand_(m, text);
  var r = m.reply_to_message;
  if (r && r.from && r.from.is_bot && m.from && !m.from.is_bot) {
    if (onRejectReasonInGroup_(m)) return; // رد على طلب «سبب الرفض»
    if (moduleHook_('onGroupReply', [m]) !== undefined) return; // رد على رسالة إضافة (مثل رد مكتوب على سؤال طالب)
    return onReviewReply_(m);
  }
  // ما عدا ذلك يُتجاهل بلا أي قراءة
}

/** اسم مستخدم بوت الطلاب (getMe مرة كل 6 ساعات) */
function botUsername_() {
  var c = cache_().get('botname:student');
  if (c != null) return c;
  var j = tg_('getMe', {}, true);
  var u = j.ok && j.result && j.result.username ? String(j.result.username).toLowerCase() : '';
  if (u) cache_().put('botname:student', u, 21600);
  return u;
}

function anonymousSender_(m) { return !!m.sender_chat || (m.from && m.from.username === 'GroupAnonymousBot'); }

function onGroupCommand_(m, text) {
  var parts = text.split(/\s+/), cmd = parts[0].toLowerCase(), at = cmd.indexOf('@');
  if (at >= 0) {
    var target = cmd.slice(at + 1);
    var me = botUsername_();
    if (me && target !== me) return; // أمر موجّه لبوت آخر في المجموعة
    cmd = cmd.slice(0, at);
  }
  var chat = m.chat.id;
  if (cmd === '/help' || cmd === '/start') return send_(chat, GROUP_HELP);
  if (cmd !== '/linkreview' && cmd !== '/unlinkreview') return;
  if (anonymousSender_(m)) return send_(chat, '⚠️ أنت ترسل بصفة «مشرف مجهول الهوية»، فلا يعرف البوت من أنت. أوقفها مؤقتًا من إعدادات المجموعة (Remain anonymous) ثم أعد الأمر.');
  var adm = adminInfo_(m.from.id);
  var progs = adm ? getPrograms_().filter(function (p) { return canAccess_(adm, p.id); }) : [];
  if (!progs.length) return send_(chat, '⛔ هذا الأمر لمالك البوت ومشرفي البرامج فقط.\nمعرّفك: ' + m.from.id);
  if (cmd === '/unlinkreview') {
    var linked = progs.filter(function (p) { return reviewChatOf_(p.id) === String(chat); });
    if (!linked.length) return send_(chat, 'هذه المجموعة غير مربوطة بأي برنامج من برامجك.');
    if (linked.length === 1) return doLinkReview_(m.chat, m.from, linked[0].id, false);
    return send_(chat, 'اختر البرنامج الذي تريد فصله عن هذه المجموعة:', linked.map(function (p) {
      return [{ text: p.name || p.id, callback_data: 'gu:' + p.id }];
    }));
  }
  var arg = parts.slice(1).join(' ').trim();
  if (arg) {
    var k = normKey_(arg);
    var hit = progs.filter(function (p) { return normKey_(p.id) === k || normKey_(p.name) === k; })[0];
    if (!hit) return send_(chat, '⚠️ لا أعرف برنامجًا باسم «' + arg + '» ضمن برامجك.\nالصيغة: /linkreview <معرف البرنامج>\nمثال: /linkreview ' + progs[0].id + '\nأو أرسل /linkreview وحده واختر من الأزرار.');
    return doLinkReview_(m.chat, m.from, hit.id, true);
  }
  if (progs.length === 1) return doLinkReview_(m.chat, m.from, progs[0].id, true);
  return send_(chat, 'اختر البرنامج الذي تُرسل تسليماته إلى هذه المجموعة:', progs.map(function (p) {
    return [{ text: (p.open ? '🟢 ' : '⚪️ ') + (p.name || p.id), callback_data: 'gl:' + p.id }];
  }));
}

/** أزرار المجموعة (gl: ربط، gu: فصل) — يتحقق من صلاحية من ضغط */
function onGroupCallback_(q) {
  var data = String(q.data || ''), pid = data.slice(3), act = data.slice(0, 3);
  if (data === 'rj' || data === 'rn' || data === 'ru') return onReviewButton_(q, data);
  if (data.indexOf('mx:') === 0) return moduleStudentCallback_(q, data, true);
  if (act !== 'gl:' && act !== 'gu:') return answerCallback_(q.id);
  var adm = adminInfo_(q.from.id);
  if (!adm || !canAccess_(adm, pid)) return answerCallback_(q.id, '⛔ هذا لمشرفي البرنامج فقط', true);
  ackAndClear_(q);
  return doLinkReview_(q.message.chat, q.from, pid, act === 'gl:');
}

/** يكتب معرّف المجموعة (أو يمسحه) في «الإعدادات» بالمسار نفسه لتعديلات البوت الإداري */
function doLinkReview_(chat, from, pid, link) {
  var p = getPrograms_().filter(function (x) { return x.id === pid; })[0];
  if (!p) return send_(chat.id, 'البرنامج غير موجود: ' + pid);
  var r = setReviewChat_(pid, link ? String(chat.id) : '', from);
  var name = p.name || p.id;
  if (r.error) return send_(chat.id, '⚠️ لم يُحفظ: ' + r.error);
  if (link) {
    var prev = r.old && r.old !== String(chat.id) ? '\n(كانت التسليمات تُرسل قبلها إلى ' + r.old + ')' : '';
    return send_(chat.id, '✅ رُبطت هذه المجموعة ببرنامج «' + name + '».\nستصل هنا نسخة من كل تسليم جديد، وللرد على طالب اضغط «رد» على رسالة تسليمه.' + prev + '\n/help للدليل.');
  }
  return send_(chat.id, '✅ فُصلت هذه المجموعة عن «' + name + '»؛ لن تصلها تسليمات جديدة.');
}

/** يعيد {old} أو {error}. يقرأ الورقة من جديد داخل قفل، ويسجل، ويمسح الذاكرة المؤقتة. */
function setReviewChat_(pid, value, from) {
  var lock = tenantLock_();
  lock.waitLock(25000);
  try {
    var sh = programSpreadsheet_(pid).getSheetByName(NAMES.SETTINGS);
    if (!sh) return { error: 'لا توجد ورقة «الإعدادات» في ملف البرنامج.' };
    var values = sh.getDataRange().getValues();
    var plan = planEdit(values, 'GENERAL', null, 'reviewChatId', value);
    if (plan.error) return { error: plan.error };
    var old = str_(plan.old);
    if (old === value) { invalidateProgram_(pid); return { old: old }; }
    var err = validatePlan(values, plan);
    if (err) return { error: err };
    writePlan_(sh, plan);
    invalidateProgram_(pid);
    logChange_(from, pid, SECTIONS.GENERAL, '-', fieldLabel('GENERAL', 'reviewChatId'), old, value);
    return { old: old };
  } finally {
    lock.releaseLock();
  }
}

function reviewChatOf_(pid) {
  try { var prog = loadProgram_(pid); return prog ? str_(prog.general.reviewChatId) : ''; } catch (e) { return ''; }
}

/** ترقية المجموعة إلى supergroup تغيّر معرّفها: نحدّث كل برنامج مربوط بالمعرّف القديم */
function migrateReviewChat_(oldId, newId) {
  var done = cache_().get('migr:' + oldId);
  if (done === newId) return;
  getPrograms_().forEach(function (p) {
    if (reviewChatOf_(p.id) !== oldId) return;
    var r = setReviewChat_(p.id, newId, { id: 'telegram', first_name: 'ترقية المجموعة (migrate)' });
    if (r.error) logError_(new Error('migrate ' + p.id + ': ' + r.error), oldId + ' → ' + newId);
  });
  cache_().put('migr:' + oldId, newId, 21600);
}

/* ───────── خريطة رسائل المراجعة ───────── */

function reviewKey_(chatId, messageId) { return 'r' + chatId + '_' + messageId; }

function reviewSheet_() {
  var ss = central_(), sh = ss.getSheetByName(REVIEW_MAP.SHEET);
  if (!sh) {
    sh = ss.insertSheet(REVIEW_MAP.SHEET);
    sh.getRange(1, 1, 1, REVIEW_MAP_HEADERS.length + 1).setValues([REVIEW_MAP_HEADERS.concat([REVIEW_HDR_FLAG])]).setFontWeight('bold');
    sh.setFrozenRows(1);
    try { sh.hideSheet(); } catch (e) { /* تجاهل */ }
  }
  return sh;
}

/** يسجل رسائل المجموعة (السطر الأول والنسخة وأجزاء الألبوم) مع بيانات التسليم */
function saveReviewMap_(groupId, messageIds, info, headerId) {
  var sh = reviewSheet_(), now = new Date(), put = {};
  if (headerId && str_(sh.getRange(1, REVIEW_MAP_HEADERS.length + 1).getValue()) !== REVIEW_HDR_FLAG) sh.getRange(1, REVIEW_MAP_HEADERS.length + 1).setValue(REVIEW_HDR_FLAG);
  messageIds.forEach(function (mid) {
    if (!mid) return;
    var key = reviewKey_(groupId, mid);
    sh.appendRow([key, now, String(groupId), mid, info.p, info.a, info.n, info.subId, String(info.chat), String(info.uid), info.msg, info.email, info.name, mid === headerId ? '1' : '']);
    put['rv:' + key] = JSON.stringify(info);
  });
  if (Object.keys(put).length) cache_().putAll(put, REVIEW_MAP.TTL);
  if (info.subId) cache_().remove('rvs:' + info.subId);
}

function findReviewMap_(groupId, messageId) {
  var key = reviewKey_(groupId, messageId), c = cache_().get('rv:' + key);
  if (c) return JSON.parse(c);
  var sh = central_().getSheetByName(REVIEW_MAP.SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  var f = sh.getRange(2, 1, sh.getLastRow() - 1, 1).createTextFinder(key).matchEntireCell(true).findNext();
  if (!f) return null;
  var r = sh.getRange(f.getRow(), 1, 1, REVIEW_MAP_HEADERS.length).getValues()[0];
  var info = { p: str_(r[4]), a: str_(r[5]), n: r[6], subId: str_(r[7]), chat: str_(r[8]), uid: str_(r[9]), msg: r[10], email: str_(r[11]), name: str_(r[12]) };
  cache_().put('rv:' + key, JSON.stringify(info), REVIEW_MAP.TTL);
  return info;
}

/* ───────── الرد على تسليم ───────── */

function onReviewReply_(m) {
  var group = String(m.chat.id), target = m.reply_to_message.message_id;
  var info = findReviewMap_(group, target);
  if (!info) return; // ليس ردًّا على رسالة تسليم
  if (anonymousSender_(m)) return tg_('sendMessage', { chat_id: group, text: '⚠️ لم تُرسل الملاحظة: أنت «مشرف مجهول الهوية». أوقفها ثم أعد الرد.',
    reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true } });
  var adm = adminInfo_(m.from.id);
  if (!adm || !canAccess_(adm, info.p)) return; // ليس مشرفًا لهذا البرنامج: تجاهل
  var replyTo = info.msg ? { message_id: Number(info.msg), allow_sending_without_reply: true } : null;
  var first = !m.media_group_id || !cache_().get('fbmg:' + m.media_group_id);
  if (m.media_group_id) cache_().put('fbmg:' + m.media_group_id, '1', 900);
  var h = { ok: true };
  if (first) {
    var hp = { chat_id: info.chat, text: '📝 ملاحظة المشرف على تسليمك رقم ' + info.n + ' في «' + info.a + '»:', disable_web_page_preview: true };
    if (replyTo) hp.reply_parameters = replyTo;
    h = tg_('sendMessage', hp, true);
  }
  var c = h.ok ? tg_('copyMessage', { chat_id: info.chat, from_chat_id: m.chat.id, message_id: m.message_id }, true) : h;
  if (!c.ok) {
    var why = /blocked|deactivated|chat not found|forbidden/i.test(String(c.description)) ?
      'الطالب أوقف البوت أو حذف المحادثة، فلا يمكن مراسلته.' : String(c.description || 'خطأ غير معروف');
    logError_(new Error('Telegram feedback: ' + c.description), 'review reply ' + info.p + ' #' + info.n);
    return tg_('sendMessage', { chat_id: m.chat.id, text: '⚠️ لم تصل الملاحظة إلى ' + (info.name || 'الطالب') + ': ' + why,
      reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true } });
  }
  var re = tg_('setMessageReaction', { chat_id: m.chat.id, message_id: m.message_id, reaction: [{ type: 'emoji', emoji: '👍' }] }, true);
  if (!re.ok && first) tg_('sendMessage', { chat_id: m.chat.id, text: '✅ وصلت إلى ' + (info.name || 'الطالب'), reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true } }, true);
  if (first || m.text || m.caption) logFeedback_(info, m);
}

/** يضيف الملاحظة إلى عمود «ملاحظات المشرف» في سطر التسليم (لا يمنع الإيصال إن فشل) */
function logFeedback_(info, m) {
  try {
    var p = getPrograms_().filter(function (x) { return x.id === info.p; })[0];
    if (!p || !info.subId) return;
    var sh = openSS_(p.ssId).getSheetByName(NAMES.SUBMISSIONS);
    if (!sh || sh.getLastRow() < 2) return;
    var lock = tenantLock_();
    lock.waitLock(20000);
    try {
      var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      var col = head.indexOf(FEEDBACK_HEADER) + 1;
      if (!col) { col = head.length + 1; sh.getRange(1, col).setValue(FEEDBACK_HEADER); }
      var idCol = head.indexOf('معرف التسليم') + 1 || 2;
      var f = sh.getRange(2, idCol, sh.getLastRow() - 1, 1).createTextFinder(info.subId).matchEntireCell(true).findNext();
      if (!f) return;
      var cell = sh.getRange(f.getRow(), col), prev = str_(cell.getValue());
      var who = [m.from.first_name, m.from.last_name].filter(Boolean).join(' ');
      var body = m.text || m.caption || '';
      var kind = m.text ? '' : (m.photo ? '[صورة] ' : m.voice ? '[تسجيل صوتي] ' : m.document ? '[ملف] ' : m.video ? '[فيديو] ' : m.audio ? '[صوت] ' : '[مرفق] ');
      var line = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm') + ' ' + who + ': ' + kind + body;
      cell.setValue(safeText_((prev ? prev + '\n' : '') + line));
    } finally { lock.releaseLock(); }
  } catch (e) { logError_(e, 'logFeedback ' + info.p); }
}

// ===== Router.gs =====
/**
 * Router.gs — نقطة الدخول الوحيدة لتطبيق الويب المركزي.
 * رابط كل بوت: <WEBAPP_URL>?t=<tenantId>&b=<student|admin>&k=<سر العميل>
 * رابط بوت المنصة: <WEBAPP_URL>?b=platform&k=<PLATFORM_SECRET>
 * رابط التطبيق المصغّر: <WEBAPP_URL>?b=app&t=<tenantId>&r=<student|admin> (بلا سر؛ التوقيع في الجسم)
 * لوحة المنصة: <WEBAPP_URL>?b=app&r=platform (توقيع بوت المنصة، لمالك المنصة فقط)
 * لا يُعالج أي تحديث قبل التحقق من: صحة المعرّف، وتطابق السر (مقارنة ثابتة الزمن)، ووجود العميل، وحالة الترخيص.
 */
var SETUP_DONE = 'done';
var BLOCKED_DEFAULT = {
  student: 'عذرًا، خدمة التسليم متوقفة مؤقتًا لدى هذه الجهة. ستعود قريبًا بإذن الله، ونعتذر عن الإزعاج 🌿',
  admin: '⏸ اشتراك هذا النظام متوقف أو منتهٍ، والبيانات محفوظة كما هي. تواصل مع مزوّد الخدمة لتجديد الاشتراك وسيعود كل شيء كما كان.'
};

function doGet() { return out_('ok'); }

function doPost(e) {
  
resetMemo_(); leaveTenant_(); LOCKS_HELD_ = {};
  var p = (e && e.parameter) || {};
  try {
    
if (p.b === 'platform') return platformPost_(e);
    if (p.b === 'worker') return workerSyncPost_(e);
    if (p.b === 'app') return miniAppPost_(e);
    var tid = String(p.t || '').toLowerCase(), role = p.b === 'admin' ? 'admin' : (p.b === 'student' ? 'student' : (p.b === 'unified' ? 'unified' : ''));
    if (!TENANT_ID_RE.test(tid) || !role) return out_('forbidden');
    var secret = tenantPropOf_(tid, 'SECRET');
    if (!secret || !safeEqual_(p.k, secret)) return out_('forbidden');
    var t = loadTenant_(tid);
    if (!t) return out_('forbidden');
    if (role === 'unified' && tenantPropOf_(tid, 'BOT_MODE') !== 'unified') return out_('forbidden');
    enterTenant_(t);
    countUsage_();
    var lic = licenseState_(t);
    if (!lic.ok) { BOT_ROLE = role; return blockedReply_(e, role); }
    return handleTenantPost_(e, role);
  } catch (err) {
    try { logError_(err, 'router ' + String(p.t || '') + ' ' + String(p.b || '')); } catch (x) { /* تجاهل */ }
    return p.b === 'app' ? appOut_({ ok: false, error: 'error' }) : out_('ok');
  } finally {
    try { leaveTenant_(); } catch (x) { /* تجاهل */ }
  }
}

/** نص الإيقاف: قابل للتعديل من بوت المنصة (/setmsg) */
function blockedText_(role) {
  return platformProp_(role === 'admin' ? 'PLATFORM_BLOCKED_ADMIN_MSG' : 'PLATFORM_BLOCKED_MSG') || BLOCKED_DEFAULT[role === 'admin' ? 'admin' : 'student'];
}

/**
 * عميل موقوف أو منتهٍ: رد مهذب واحد (مرة كل 6 ساعات لكل محادثة) ولا شيء غيره.
 * المجموعات لا يُرد فيها. البيانات لا تُمس.
 */
function blockedReply_(e, role) {
  var u;
  try { u = JSON.parse(e.postData.contents); } catch (x) { return out_('ok'); }
  var q = u.callback_query, m = u.message, text = blockedText_(role);
  if (q) { answerCallback_(q.id, text.slice(0, 190), true); return out_('blocked'); }
  if (!m || !m.chat || m.chat.type !== 'private') return out_('blocked');
  var k = 'blk:' + role + ':' + m.chat.id;
  if (cache_().get(k)) return out_('blocked');
  cache_().put(k, '1', 21600);
  send_(m.chat.id, text);
  return out_('blocked');
}

/** رابط ويب هوك بوت عميل */
function tenantHookUrl_(tid, role) {
  var base = webAppUrl_();
  return base + '?t=' + encodeURIComponent(tid) + '&b=' + role + '&k=' + encodeURIComponent(tenantPropOf_(tid, 'SECRET'));
}
function webAppUrl_() {
  var u = platformProp_('WEBAPP_URL');
  if (!u) { try { u = ScriptApp.getService().getUrl(); } catch (e) { u = ''; } }
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(u || '')) throw new Error('رابط تطبيق الويب غير معروف: اضبط WEBAPP_URL في خصائص السكربت (ينتهي بـ /exec).');
  return u;
}

var STUDENT_COMMANDS = [
  { command: 'start', description: 'تسليم مشاركة جديدة' },
  { command: 'mysubs', description: 'تسليماتي (عرض وتعديل وحذف)' },
  { command: 'mygrades', description: 'درجاتي' },
  { command: 'email', description: 'تغيير البريد المحفوظ' },
  { command: 'cancel', description: 'إلغاء العملية الحالية' },
  { command: 'help', description: 'طريقة الاستخدام' }
];
var ADMIN_COMMANDS = [
  { command: 'start', description: 'اختيار برنامج وإدارته' },
  { command: 'setup', description: 'معالج الإعداد' },
  { command: 'modules', description: 'الوحدات الإضافية' },
  { command: 'myid', description: 'معرّفي في تيليجرام' },
  { command: 'cancel', description: 'إلغاء الإدخال الحالي' },
  { command: 'help', description: 'دليل الاستخدام' }
];
var UNIFIED_COMMANDS = [
  { command: 'start', description: 'القائمة الرئيسية' },
  { command: 'mysubs', description: 'تسليماتي (للطالب)' },
  { command: 'mygrades', description: 'درجاتي (للطالب)' },
  { command: 'email', description: 'تغيير البريد المحفوظ' },
  { command: 'setup', description: 'معالج الإعداد (للمالك)' },
  { command: 'modules', description: 'الوحدات الإضافية (للمالك)' },
  { command: 'myid', description: 'معرّفي' },
  { command: 'cancel', description: 'إلغاء العملية الحالية' },
  { command: 'help', description: 'المساعدة' }
];

/** يربط بوتي العميل الحالي بالتطبيق المركزي (setWebhook عبر UrlFetch) ويضبط قائمة الأوامر */
function setTenantWebhooks_() {
  var out = {};
  if (isUnifiedTenant_()) {
    if (!tokenFor_('unified')) { out.unified = { ok: false, description: 'لا توكن' }; return out; }
    var ju = tgAs_('unified', 'setWebhook', { url: tenantHookUrl_(TENANT_.id, 'unified'), allowed_updates: ['message', 'callback_query'], drop_pending_updates: false, max_connections: 20 }, true);
    tgAs_('unified', 'setMyCommands', { commands: UNIFIED_COMMANDS }, true);
    out.unified = ju; out.student = ju; out.admin = ju;
    if (isModuleActive_('miniApp')) miniAppOnEnable_();
    return out;
    }
  ['student', 'admin'].forEach(function (role) {
    if (!tokenFor_(role)) { out[role] = { ok: false, description: 'لا توكن' }; return; }
    var j = tgAs_(role, 'setWebhook', { url: tenantHookUrl_(TENANT_.id, role), allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false, max_connections: role === 'admin' ? 5 : 20 }, true);
    tgAs_(role, 'setMyCommands', { commands: role === 'admin' ? ADMIN_COMMANDS : STUDENT_COMMANDS }, true);
    out[role] = j;
  });
  if (isModuleActive_('miniApp')) miniAppOnEnable_();
  return out;
}

// ===== Store.gs =====
/**
 * Store.gs — الحالة والذاكرة المؤقتة وقراءة البرامج والتسجيل.
 * - حالة المحادثة: CacheService (6 ساعات).
 * - البريد المحفوظ لكل مستخدم: ورقة «المستخدمون» في ملف تحكم العميل + ذاكرة مؤقتة.
 * كل ما هنا يعمل داخل سياق عميل (Tenant.gs).
 * - إعدادات البرامج وقوائم التسجيل: ذاكرة مؤقتة قصيرة لتسريع الرد.
 */
var BOT = { PROGRAMS: 'البرامج', USERS: 'المستخدمون', LOG: 'سجل الأخطاء' };
var PROGRAM_HEADERS = ['معرف البرنامج (لاتيني قصير)', 'اسم البرنامج', 'رابط ملف الدرجات (أو معرّفه)', 'مفتوح للتسليم', 'ملاحظات'];
var USER_HEADERS = ['معرف المستخدم', 'البريد', 'اسم المستخدم', 'آخر تحديث'];
// مدد الذاكرة المؤقتة بالثواني. البوت الإداري يمسح ذاكرة البرنامج فور أي تعديل، فلا ضرر من إطالتها.
var TTL = { STATE: 21600, PROGRAMS: 600, CONFIG: 600, REG: 1800, REG_REFRESH: 60, USER: 21600, SETTINGS: 120, ADMINS: 600 };

/* ── ذاكرة داخل التشغيل الواحد: تُفتح الملفات وتُقرأ الخصائص مرة واحدة لكل تحديث ── */
var SS_MEMO_ = {}, CENTRAL_MEMO_ = null, CACHE_MEMO_ = null;
function resetMemo_() { SS_MEMO_ = {}; CENTRAL_MEMO_ = null; CACHE_MEMO_ = null; PROPS_MEMO_ = null; }

/** ذاكرة العميل الحالي فقط (المفاتيح مسبوقة بمعرّفه). بلا سياق عميل = خطأ، حتى لا تختلط بيانات العملاء */
function cache_() {
  if (!TENANT_) throw new Error('cache_ بلا سياق عميل');
  return CACHE_MEMO_ || (CACHE_MEMO_ = nsCache_(tenantCachePrefix_(TENANT_.id)));
}

function openSS_(id) { return SS_MEMO_[id] || (SS_MEMO_[id] = SpreadsheetApp.openById(id)); }

/** ملف التحكم للعميل الحالي (البرامج، المستخدمون، المشرفون، السجلات) */
function central_() {
  if (CENTRAL_MEMO_) return CENTRAL_MEMO_;
  if (!TENANT_ || !TENANT_.controlSsId) throw new Error('لا ملف تحكم للعميل الحالي');
  return (CENTRAL_MEMO_ = openSS_(TENANT_.controlSsId));
}

/* ── حالة المحادثة ── */
function getState_(uid) { var s = cache_().get('st:' + uid); return s ? JSON.parse(s) : null; }
function setState_(uid, st) { cache_().put('st:' + uid, JSON.stringify(st), TTL.STATE); }
function clearState_(uid) { cache_().remove('st:' + uid); }

/* ── البريد المحفوظ ── */
function getUserEmail_(uid) {
  var c = cache_().get('ue:' + uid);
  if (c !== null) return c === '∅' ? '' : c;
  var sh = central_().getSheetByName(BOT.USERS);
  var email = '';
  if (sh && sh.getLastRow() > 1) {
    var f = sh.getRange(2, 1, sh.getLastRow() - 1, 1).createTextFinder(String(uid)).matchEntireCell(true).findNext();
    if (f) email = String(sh.getRange(f.getRow(), 2).getValue() || '');
  }
  cache_().put('ue:' + uid, email || '∅', TTL.USER);
  return email;
}

function saveUserEmail_(uid, email, username) {
  var sh = central_().getSheetByName(BOT.USERS);
  if (sh) {
    var row = 0;
    if (sh.getLastRow() > 1) {
      var f = sh.getRange(2, 1, sh.getLastRow() - 1, 1).createTextFinder(String(uid)).matchEntireCell(true).findNext();
      if (f) row = f.getRow();
    }
    var vals = [[String(uid), email, username || '', new Date()]];
    if (row) sh.getRange(row, 1, 1, 4).setValues(vals); else sh.appendRow(vals[0]);
  }
  cache_().put('ue:' + uid, email || '∅', TTL.USER);
}

/* ── البرامج ── */
function getPrograms_() {
  var c = cache_().get('progs');
  if (c) return JSON.parse(c);
  var sh = central_().getSheetByName(BOT.PROGRAMS);
  var list = [];
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().forEach(function (r) {
      var id = str_(r[0]), ssId = extractSpreadsheetId(r[2]);
      if (!id || !ssId) return;
      if (!isOwnedFile_(ssId)) { warnUnowned_(id); return; }
      list.push({ id: id, name: str_(r[1]), ssId: ssId, open: isYes_(r[3]) });
    });
  }
  cache_().put('progs', JSON.stringify(list), TTL.PROGRAMS);
  return list;
}

/** صف في «البرامج» يشير إلى ملف لم تنشئه الخدمة: يُتجاهل ويُسجَّل مرة كل 6 ساعات */
function warnUnowned_(id) {
  if (cache_().get('unowned:' + id)) return;
  cache_().put('unowned:' + id, '1', 21600);
  logError_(new Error('تُجوهل البرنامج «' + id + '»: ملفه لم تنشئه الخدمة. أنشئ البرامج من البوت الإداري (🆕 أو 📋 نسخ).'), 'programs');
}

function getOpenPrograms_() { return getPrograms_().filter(function (p) { return p.open; }); }

/** يحمّل إعدادات برنامج من ورقة «الإعدادات» في ملف درجاته */
function loadProgram_(id) {
  var key = 'pcfg:' + id, c = cache_().get(key);
  if (c) return JSON.parse(c);
  var p = getPrograms_().filter(function (x) { return x.id === id; })[0];
  if (!p) return null;
  var ss = openSS_(p.ssId);
  var sh = ss.getSheetByName(NAMES.SETTINGS);
  if (!sh) throw new Error('لا توجد ورقة الإعدادات في ملف البرنامج ' + id);
  var cfg = parseSettings(sh.getDataRange().getValues());
  var prog = {
    id: p.id, ssId: p.ssId, open: p.open,
    name: p.name || cfg.general.programName || p.id,
    general: cfg.general,
    activities: cfg.activities.filter(function (a) { return a.bot; }),
    levels: cfg.levels.map(function (l) { return l.title; }) // فارغة = برنامج بلا مستويات
  };
  attachSchedule_(prog, ss, cfg);
  cache_().put(key, JSON.stringify(prog), TTL.CONFIG);
  return prog;
}

/**
 * (v7) مواعيد ورقة «المواعيد» إن وُجدت: prog.schedule لكل العناصر، و a.sched لكل فعالية (للإغلاق بعد الموعد).
 * برنامج بلا الورقة = كما في v6. خطأ في الورقة لا يوقف البوت (يُسجَّل فقط).
 */
function attachSchedule_(prog, ss, cfg) {
  prog.schedule = []; prog.scheduleWarnings = [];
  try {
    var sh = ss.getSheetByName(SCHEDULE_SHEET);
    if (!sh || sh.getLastRow() < 2) return;
    var ps = parseSchedule(sh.getDataRange().getValues(), cfg);
    prog.schedule = ps.items; prog.scheduleWarnings = ps.warnings;
    prog.activities.forEach(function (a) {
      var w = ps.items.filter(function (it) { return it.kind === 'activity' && it.key === a.key; });
      if (w.length) a.sched = w.map(function (it) { return { s: it.s, d: it.d, c: it.c }; });
    });
  } catch (e) { logError_(e, 'schedule ' + prog.id); }
}

/* ── ذاكرة مؤقتة مجزأة للقيم الكبيرة ── */
function putBig_(key, obj, ttl) {
  var s = JSON.stringify(obj), size = 30000, parts = {}, n = Math.ceil(s.length / size) || 1;
  for (var i = 0; i < n; i++) parts[key + ':' + i] = s.substr(i * size, size);
  parts[key + ':n'] = String(n);
  cache_().putAll(parts, ttl);
}

function getBig_(key) {
  var n = cache_().get(key + ':n');
  if (!n) return null;
  var keys = []; for (var i = 0; i < Number(n); i++) keys.push(key + ':' + i);
  var got = cache_().getAll(keys), s = '';
  for (var j = 0; j < keys.length; j++) { if (got[keys[j]] == null) return null; s += got[keys[j]]; }
  return JSON.parse(s);
}

/* ── تصحيح البريد والتسجيل ── */
function getCorrections_(prog) {
  var key = 'corr:' + prog.id, c = cache_().get(key);
  if (c) return JSON.parse(c);
  var sh = openSS_(prog.ssId).getSheetByName(NAMES.CORRECTIONS);
  var map = sh ? buildCorrections(sh.getDataRange().getValues()) : {};
  cache_().put(key, JSON.stringify(map), TTL.CONFIG);
  return map;
}

/** خريطة: البريد الموحد ← الاسم، من ملف التسجيل الخاص بالبرنامج */
function getRegMap_(prog, fresh) {
  var g = prog.general, key = 'reg:' + prog.id;
  if (!fresh) { var c = getBig_(key); if (c) return { map: c, cached: true }; }
  if (!g.regSpreadsheetId) throw new Error('لم يُحدد ملف التسجيل في إعدادات البرنامج ' + prog.id);
  var rss = openSS_(extractSpreadsheetId(g.regSpreadsheetId));
  var rsh = g.regSheet ? rss.getSheetByName(g.regSheet) : rss.getSheets()[0];
  var reg = readRegistration(rsh.getDataRange().getValues(), g, getCorrections_(prog));
  if (reg.errors.length) throw new Error(reg.errors.join(' '));
  var map = {};
  Object.keys(reg.map).forEach(function (e) { map[e] = reg.map[e].name; });
  putBig_(key, map, TTL.REG);
  cache_().put('regfresh:' + prog.id, '1', TTL.REG_REFRESH);
  return { map: map, cached: false };
}

/**
 * يعيد {email, name} إن كان البريد مسجلًا، وإلا null.
 * قبل الرفض يعيد قراءة ملف التسجيل (لمن سجّل للتو)، لكن مرة واحدة على الأكثر كل دقيقة حتى لا يبطؤ البوت.
 */
function lookupRegistration_(prog, rawEmail) {
  var email = applyCorrection(getCorrections_(prog), normalizeEmail(rawEmail));
  var r = getRegMap_(prog, false);
  if (r.map[email] == null && r.cached && !cache_().get('regfresh:' + prog.id)) r = getRegMap_(prog, true);
  return r.map[email] == null ? null : { email: email, name: r.map[email] };
}

/** يسجل الخطأ في ورقة «سجل الأخطاء» (الوقت، الخطأ، السياق) ولا يرمي أبدًا */
var LOGGING_ = false;
function logError_(err, context) {
  console.error(err && err.stack || err);
  if (LOGGING_) return;
  LOGGING_ = true;
  try {
    var sh = TENANT_ ? central_().getSheetByName(BOT.LOG) : registrySS_().getSheetByName(REGISTRY.LOG);
    if (sh) { var m_ = sanitizeLogText_(String(err && err.message || err).slice(0, 1000)); var c_ = sanitizeLogText_(String(context || '').slice(0, 2000)); sh.appendRow([new Date(), m_, c_]); if (!TENANT_) alertPlatformError_(c_, m_); }
  } catch (e) { /* تجاهل */ } finally { LOGGING_ = false; }
}

// ===== StudentQA.gs =====
/**
 * StudentQA.gs — إضافة «❓ أسئلة الطلاب» (studentQA) بوضع الأسئلة الشائعة فقط، بلا ذكاء اصطناعي.
 * تعمل فقط إن كانت isModuleActive_('studentQA').
 *
 * الطالب: /ask [السؤال] في بوت الطلاب (في الخاص). حد يومي لكل طالب (QA.LIMIT افتراضيًا، يغيّره المالك بـ /faq limit).
 * المطابقة: ورقة «الأسئلة الشائعة» في ملف البرنامج (السؤال، الكلمات المفتاحية، الإجابة) يملؤها العميل.
 *   توحيد عربي (حذف التشكيل والتطويل، توحيد الألف والياء والتاء المربوطة) ثم: كل كلمة مفتاحية موجودة = 3 نقاط،
 *   وكل كلمة مشتركة مع نص السؤال الشائع = نقطة. أعلى صف بـ QA.MIN_SCORE فأكثر هو الإجابة المقترحة.
 * المراجعة: السؤال والإجابة المقترحة يصلان مجموعة المراجعة (بوت الطلاب) أو، إن لم تكن، المالك والمشرفين (البوت الإداري)،
 *   بأزرار: ✅ أرسل المقترحة · ✍️ رد مكتوب · 🙈 تجاهل. **لا يصل الطالبَ شيء قبل موافقة مشرف.**
 *   بعد الرد المكتوب: زر «📌 أضف إلى الأسئلة الشائعة» يضيف السؤال والرد صفًا جديدًا.
 * السجل: ورقة «سجل الأسئلة» في ملف التحكم؛ السؤال بلا إجابة مقترحة يبقى فيها ظاهرًا («—» في صف الشائعة).
 */
var QA = { FAQ: 'الأسئلة الشائعة', LOG: 'سجل الأسئلة', LIMIT: 3, MIN_SCORE: 2, MAX_LEN: 1000 };
var QA_FAQ_HEADERS = ['السؤال', 'الكلمات المفتاحية (مفصولة بفواصل)', 'الإجابة'];
var QA_LOG_HEADERS = ['الوقت', 'المعرّف', 'البرنامج', 'معرف الطالب', 'اسم الطالب', 'السؤال', 'الإجابة المقترحة', 'صف الشائعة', 'الحالة', 'المراجِع', 'الرد المرسل', 'وقت الرد'];
var QL = { T: 0, ID: 1, PID: 2, UID: 3, NAME: 4, Q: 5, SUG: 6, ROW: 7, ST: 8, BY: 9, REPLY: 10, AT: 11 };
var QS = { WAIT: 'بانتظار المراجعة', SENT: 'أُرسلت المقترحة', CUSTOM: 'أُرسل رد مكتوب', IGN: 'تجوهل' };
var QA_STOP = ['من', 'في', 'على', 'عن', 'الى', 'الي', 'ما', 'ماذا', 'هل', 'كيف', 'متي', 'لماذا', 'هو', 'هي', 'ان', 'او', 'ثم', 'مع', 'هذا', 'هذه', 'ذلك', 'التي', 'الذي', 'كان', 'لا', 'نعم', 'يا', 'انا', 'لي', 'لو', 'قد', 'كل', 'اي', 'عند', 'بعد', 'قبل'];

function qaConf_() { var s = moduleState_('studentQA'); if (!(s.limit >= 0)) s.limit = QA.LIMIT; return s; }

/* ───────── التوحيد والمطابقة (خالصة) ───────── */
function qaNorm(s) { return normKey_(s).replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/_/g, ' ').replace(/\s+/g, ' ').trim(); }
function qaTokens(s) {
  var out = [];
  qaNorm(s).split(' ').forEach(function (w) {
    var x = w.replace(/^(وال|بال|كال|فال|لل|ال)(?=...)/, '');
    if (x.length >= 2 && QA_STOP.indexOf(w) < 0 && QA_STOP.indexOf(x) < 0 && out.indexOf(x) < 0) out.push(x);
  });
  return out;
}
/** faq: [{r, q, kws, a}] — يعيد {row, score} أو null */
function qaMatch(question, faq) {
  var qn = ' ' + qaNorm(question) + ' ', qt = qaTokens(question), best = null;
  (faq || []).forEach(function (f) {
    if (!f.a) return;
    var score = 0;
    (f.kws || []).forEach(function (k) { var kn = qaNorm(k); if (kn && qn.indexOf(' ' + kn + ' ') >= 0) score += 3; else if (kn && kn.length >= 4 && qn.indexOf(kn) >= 0) score += 2; });
    var ft = qaTokens(f.q + ' ' + (f.kws || []).join(' '));
    qt.forEach(function (t) { if (ft.indexOf(t) >= 0) score += 1; });
    if (score >= QA.MIN_SCORE && (!best || score > best.score)) best = { row: f, score: score };
  });
  return best;
}

/* ───────── الأوراق ───────── */
function ensureFaqSheet_(pid) {
  var ss = programSpreadsheet_(pid), sh = ss.getSheetByName(QA.FAQ);
  if (sh) return sh;
  sh = ss.insertSheet(QA.FAQ);
  sh.getRange(1, 1, 1, QA_FAQ_HEADERS.length).setValues([QA_FAQ_HEADERS]);
  try { sh.setFrozenRows(1); sh.setRightToLeft(true); } catch (e) { /* تجاهل */ }
  return sh;
}
function readFaq_(pid) {
  var c = cache_().get('faq:' + pid);
  if (c) return JSON.parse(c);
  var sh = ensureFaqSheet_(pid), out = [];
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r, i) {
    var q = str_(r[0]), a = str_(r[2]);
    if (q || a) out.push({ r: i + 2, q: q, kws: str_(r[1]).split(/[,،;؛\n]+/).map(str_).filter(String), a: a });
  });
  try { cache_().put('faq:' + pid, JSON.stringify(out), 600); } catch (e) { /* كبيرة: بلا ذاكرة */ }
  return out;
}
function qaLogSheet_() {
  var ss = central_(), sh = ss.getSheetByName(QA.LOG);
  if (!sh) { sh = ss.insertSheet(QA.LOG); sh.getRange(1, 1, 1, QA_LOG_HEADERS.length).setValues([QA_LOG_HEADERS]); }
  return sh;
}
var QALOG_MEMO_ = null;
function qaLogValues_() {
  if (QALOG_MEMO_) return QALOG_MEMO_;
  var sh = qaLogSheet_();
  QALOG_MEMO_ = (!sh || sh.getLastRow() < 2) ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, QA_LOG_HEADERS.length).getValues();
  return QALOG_MEMO_;
}
function qaFind_(qid) {
  var sh = qaLogSheet_(), n = sh.getLastRow();
  if (n < 2) return null;
  var v = sh.getRange(2, 1, n - 1, QA_LOG_HEADERS.length).getValues();
  for (var i = v.length - 1; i >= 0; i--) if (str_(v[i][QL.ID]) === qid) return { sh: sh, row: i + 2, v: v[i] };
  return null;
}
function qaUpdate_(f, patch) {
  Object.keys(patch).forEach(function (k) { f.v[QL[k]] = patch[k]; });
  f.sh.getRange(f.row, 1, 1, QA_LOG_HEADERS.length).setValues([f.v]);
}
function qaWho_(from) { return [from.first_name, from.last_name].filter(Boolean).join(' ') + (from.username ? ' @' + from.username : ''); }

/* ───────── الطالب ───────── */
function qaStudentCommand_(m, uid, text) {
  var chat = m.chat.id, q = str_(text).replace(/^\/ask(@\S+)?\s*/i, ''), progs = getOpenPrograms_();
  if (!progs.length) return send_(chat, 'لا توجد برامج مفتوحة الآن.');
  if (progs.length > 1) {
    if (q) cache_().put('qaq:' + uid, q.slice(0, QA.MAX_LEN), 1800);
    return send_(chat, 'عن أي برنامج سؤالك؟', progs.map(function (p) { return [{ text: p.name || p.id, callback_data: 'mx:studentQA:p:' + p.id }]; }));
  }
  return qaStart_(chat, uid, m.from, progs[0].id, q);
}
function qaStart_(chat, uid, from, pid, q) {
  var lim = qaLimit_(uid);
  if (lim) return send_(chat, lim);
  if (q) return qaSubmit_(chat, uid, from, pid, q);
  setState_(uid, { step: 'mx', mod: 'studentQA', p: pid });
  return send_(chat, '❓ اكتب سؤالك في رسالة واحدة (نصًّا). سيصل إلى المشرفين، وتصلك الإجابة بعد مراجعتهم.\n/cancel للإلغاء');
}
function qaStudentMessage_(m, uid, st) {
  if (st.mod !== 'studentQA') return undefined;
  var text = str_(m.text);
  if (!text) return send_(m.chat.id, 'أرسل سؤالك نصًّا، أو /cancel للإلغاء.');
  clearState_(uid);
  return qaSubmit_(m.chat.id, uid, m.from, st.p, text);
}
function qaStudentCallback_(q, data) {
  var mm = data.match(/^p:(.+)$/);
  if (!mm) return undefined;
  var uid = String(q.from.id), text = cache_().get('qaq:' + uid) || '';
  cache_().remove('qaq:' + uid);
  if (!getOpenPrograms_().some(function (p) { return p.id === mm[1]; })) return send_(q.message.chat.id, 'هذا البرنامج غير متاح الآن.');
  return qaStart_(q.message.chat.id, uid, q.from, mm[1], text);
}
function qaCountKey_(uid) { return 'qan:' + uid + ':' + dayKey_(); }
function qaLimit_(uid) {
  var lim = qaConf_().limit, n = Number(cache_().get(qaCountKey_(uid)) || 0);
  return n >= lim ? '⏳ وصلت إلى حد الأسئلة اليومي (' + lim + '). أرسل سؤالك غدًا إن شاء الله.' : '';
}

function qaSubmit_(chat, uid, from, pid, text) {
  var lim = qaLimit_(uid);
  if (lim) return send_(chat, lim);
  text = text.slice(0, QA.MAX_LEN);
  var prog = loadProgram_(pid), name = qaWho_(from), hit = null;
  try { hit = qaMatch(text, readFaq_(pid)); } catch (e) { logError_(e, 'faq ' + pid); }
  var qid = Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  var row = QA_LOG_HEADERS.map(function () { return ''; });
  row[QL.T] = new Date(); row[QL.ID] = qid; row[QL.PID] = pid; row[QL.UID] = uid; row[QL.NAME] = name; row[QL.Q] = text;
  row[QL.SUG] = hit ? hit.row.a : ''; row[QL.ROW] = hit ? hit.row.r : '—'; row[QL.ST] = QS.WAIT;
  qaLogSheet_().appendRow(row);
  cache_().put(qaCountKey_(uid), String(Number(cache_().get(qaCountKey_(uid)) || 0) + 1), 172800);
  emitEvent_(EVENT_TYPES.QA_ASKED, pid, { qid: qid, matched: !!hit }, uid);
  var card = '❓ سؤال طالب — «' + ((prog && prog.name) || pid) + '»\n👤 ' + name + ' (' + uid + ')\n\n«' + text + '»\n\n' +
    (hit ? '💡 الإجابة المقترحة (صف ' + hit.row.r + ' من «' + QA.FAQ + '»):\n' + hit.row.a : '🔎 لا إجابة مقترحة في «' + QA.FAQ + '».');
  var sent = qaNotifyReviewers_(pid, clip(card), qid, !!hit);
  if (!sent) logError_(new Error('سؤال طالب لم يصل أي مراجع: ' + qid), 'studentQA');
  return send_(chat, '✅ وصل سؤالك، وستصلك الإجابة هنا بعد مراجعة المشرف.');
}
function qaButtons_(prefix, qid, hasSug) {
  var row = [];
  if (hasSug) row.push({ text: '✅ أرسل المقترحة', callback_data: prefix + 's:' + qid });
  row.push({ text: '✍️ رد مكتوب', callback_data: prefix + 'c:' + qid }, { text: '🙈 تجاهل', callback_data: prefix + 'i:' + qid });
  return [row];
}
/** مجموعة المراجعة أولًا (بوت الطلاب)، وإلا المالك والمشرفون المخولون (البوت الإداري). يعيد عدد من وصلهم */
function qaNotifyReviewers_(pid, card, qid, hasSug) {
  var g = reviewChatOf_(pid);
  if (g) {
    var r = tgAs_('student', 'sendMessage', { chat_id: g, text: card, disable_web_page_preview: true, reply_markup: { inline_keyboard: qaButtons_('mx:studentQA:', qid, hasSug) } }, true);
    if (r && r.ok) return 1;
  }
  var ids = [];
  if (ownerId_()) ids.push(ownerId_());
  readAdmins_().forEach(function (a) { if (canAccess_({ owner: false, programs: a.programs }, pid) && ids.indexOf(a.id) < 0) ids.push(a.id); });
  var n = 0;
  ids.forEach(function (id) { var r2 = tgAs_('admin', 'sendMessage', { chat_id: id, text: card, disable_web_page_preview: true, reply_markup: { inline_keyboard: qaButtons_('MX:studentQA:', qid, hasSug) } }, true); if (r2 && r2.ok) n++; });
  return n;
}

/* ───────── إجراءات المراجع (مشتركة بين المجموعة والبوت الإداري) ───────── */
/** يعيد {f} أو {error} بعد التحقق من الصلاحية */
function qaAuth_(from, qid) {
  var f = qaFind_(qid);
  if (!f) return { error: 'السؤال غير موجود في «' + QA.LOG + '».' };
  var adm = adminInfo_(from.id);
  if (!adm || !canAccess_(adm, str_(f.v[QL.PID]))) return { error: '⛔ هذا لمشرفي البرنامج فقط.' };
  return { f: f };
}
function qaSendToStudent_(f, answer, from, status) {
  var r = tgAs_('student', 'sendMessage', { chat_id: str_(f.v[QL.UID]), text: clip('💬 الإجابة عن سؤالك:\n«' + clip(str_(f.v[QL.Q]), 300) + '»\n\n' + answer), disable_web_page_preview: true }, true);
  if (!r || !r.ok) return { error: 'تعذر الإرسال للطالب: ' + ((r && r.description) || '') };
  qaUpdate_(f, { ST: status, BY: qaWho_(from) + ' (' + from.id + ')', REPLY: answer, AT: new Date() });
  emitEvent_(EVENT_TYPES.QA_ANSWERED, str_(f.v[QL.PID]), { qid: str_(f.v[QL.ID]), how: status }, String(from.id));
  return { ok: true };
}
/** s/i/f: يعيد {text, kb?} أو {error}؛ c يعالجه المستدعي (يختلف بين المجموعة والخاص) */
function qaAction_(from, act, qid) {
  var a = qaAuth_(from, qid);
  if (a.error) return a;
  var f = a.f, st = str_(f.v[QL.ST]);
  if (act === 'f') {
    var reply = str_(f.v[QL.REPLY]);
    if (!reply) return { error: 'لا رد مكتوب لهذا السؤال بعد.' };
    if (/^أُضيف/.test(str_(f.v[QL.ROW]))) return { text: 'ℹ️ أُضيف إلى «' + QA.FAQ + '» من قبل.' };
    var pid = str_(f.v[QL.PID]), sh = ensureFaqSheet_(pid);
    sh.appendRow([str_(f.v[QL.Q]), '', reply]);
    cache_().remove('faq:' + pid);
    qaUpdate_(f, { ROW: 'أُضيف صف ' + sh.getLastRow() });
    return { text: '📌 أُضيف السؤال وردّك إلى «' + QA.FAQ + '» (صف ' + sh.getLastRow() + '). أضف له كلمات مفتاحية من الملف لتحسين المطابقة.' };
  }
  if (st !== QS.WAIT) return { text: 'ℹ️ عولج هذا السؤال من قبل: ' + st + (str_(f.v[QL.BY]) ? ' — ' + str_(f.v[QL.BY]) : '') };
  if (act === 'i') { qaUpdate_(f, { ST: QS.IGN, BY: qaWho_(from) + ' (' + from.id + ')', AT: new Date() }); return { text: '🙈 تُجوهل السؤال (لم يصل الطالبَ شيء).' }; }
  if (act === 's') {
    var sug = str_(f.v[QL.SUG]);
    if (!sug) return { error: 'لا إجابة مقترحة لهذا السؤال.' };
    var r = qaSendToStudent_(f, sug, from, QS.SENT);
    return r.error ? r : { text: '✅ أُرسلت الإجابة المقترحة إلى الطالب (' + qaWho_(from) + ').' };
  }
  return { error: 'إجراء غير معروف.' };
}
function qaCustom_(from, qid, text) {
  var a = qaAuth_(from, qid);
  if (a.error) return a;
  if (str_(a.f.v[QL.ST]) !== QS.WAIT) return { text: 'ℹ️ عولج هذا السؤال من قبل: ' + str_(a.f.v[QL.ST]) };
  var r = qaSendToStudent_(a.f, str_(text).slice(0, 3500), from, QS.CUSTOM);
  return r.error ? r : { text: '✅ أُرسل ردّك إلى الطالب.', kb: [[{ text: '📌 أضف إلى الأسئلة الشائعة', callback_data: 'f:' + qid }]] };
}
function qaKb_(prefix, kb) { return kb ? kb.map(function (row) { return row.map(function (b) { return { text: b.text, callback_data: prefix + b.callback_data }; }); }) : null; }

/* مجموعة المراجعة (بوت الطلاب) */
function qaGroupCallback_(q, data) {
  var mm = data.match(/^([scif]):(\w+)$/);
  if (!mm) return undefined;
  var chat = q.message.chat.id;
  if (mm[1] === 'c') {
    var a = qaAuth_(q.from, mm[2]);
    if (a.error) return answerCallback_(q.id, a.error, true);
    if (str_(a.f.v[QL.ST]) !== QS.WAIT) return answerCallback_(q.id, 'عولج من قبل: ' + str_(a.f.v[QL.ST]), true);
    answerCallback_(q.id);
    var pr = tgAs_('student', 'sendMessage', { chat_id: chat, text: '✍️ ' + qaWho_(q.from) + ': اكتب الرد للطالب «ردًّا» (Reply) على هذه الرسالة.', reply_to_message_id: q.message.message_id }, true);
    if (pr && pr.ok) cache_().put('qarm:' + chat + '_' + pr.result.message_id, mm[2], 21600);
    return true;
  }
  var r = qaAction_(q.from, mm[1], mm[2]);
  if (r.error) return answerCallback_(q.id, r.error, true);
  ackAndClear_(q);
  return tgAs_('student', 'sendMessage', { chat_id: chat, text: r.text, reply_to_message_id: q.message.message_id }, true) || true;
}
function qaGroupReply_(m) {
  var r = m.reply_to_message, qid = r ? cache_().get('qarm:' + m.chat.id + '_' + r.message_id) : null;
  if (!qid) return undefined;
  var a = qaAuth_(m.from, qid);
  if (a.error) { send_(m.chat.id, '⚠️ ' + a.error); return true; }
  if (!str_(m.text)) { send_(m.chat.id, 'الرد يجب أن يكون نصًّا.'); return true; }
  var res = qaCustom_(m.from, qid, m.text);
  if (res.error) { send_(m.chat.id, '⚠️ ' + res.error); return true; }
  cache_().remove('qarm:' + m.chat.id + '_' + r.message_id);
  tgAs_('student', 'sendMessage', { chat_id: m.chat.id, text: res.text, reply_to_message_id: m.message_id, reply_markup: res.kb ? { inline_keyboard: qaKb_('mx:studentQA:', res.kb) } : undefined }, true);
  return true;
}

/* البوت الإداري (الخاص) */
function qaBack_() { return [[{ text: '🏠 القائمة', callback_data: 'L' }]]; }
function qaAdminCallback_(ctx, data) {
  var mm = data.match(/^([scif]):(\w+)$/);
  if (!mm) return undefined;
  if (mm[1] === 'c') {
    var a = qaAuth_(ctx.from, mm[2]);
    if (a.error) return show_(ctx, '⚠️ ' + a.error, qaBack_());
    if (str_(a.f.v[QL.ST]) !== QS.WAIT) return show_(ctx, 'ℹ️ عولج من قبل: ' + str_(a.f.v[QL.ST]), qaBack_());
    setModWait_(ctx.uid, { mod: 'studentQA', step: 'reply', qid: mm[2] });
    return send_(ctx.chat, '✍️ اكتب الآن ردّك على سؤال الطالب:\n«' + clip(str_(a.f.v[QL.Q]), 300) + '»\n(/cancel للإلغاء)');
  }
  var r = qaAction_(ctx.from, mm[1], mm[2]);
  return show_(ctx, r.error ? '⚠️ ' + r.error : r.text, qaBack_());
}
function qaAdminMessage_(ctx, m) {
  var w = modWait_(ctx.uid);
  if (!w || w.mod !== 'studentQA' || w.step !== 'reply') return undefined;
  if (!str_(m.text)) return send_(ctx.chat, 'الرد يجب أن يكون نصًّا، أو /cancel.');
  setModWait_(ctx.uid, null);
  var r = qaCustom_(ctx.from, w.qid, m.text);
  return send_(ctx.chat, r.error ? '⚠️ ' + r.error : r.text, r.kb ? qaKb_('MX:studentQA:', r.kb) : qaBack_());
}

/* ───────── /faq (المالك والمشرفون لبرامجهم) ───────── */
function faqCommand_(ctx, text) {
  var a = str_(text).replace(/^\/faq(@\S+)?\s*/i, '').split(/\s+/).filter(String), conf = qaConf_(), back = qaBack_();
  if (a[0] === 'limit') {
    if (!ctx.adm.owner) return show_(ctx, '⛔ للمالك فقط.', back);
    var n = Number(latinDigits_(a[1] || ''));
    if (!(n >= 1 && n <= 50 && Math.floor(n) === n)) return show_(ctx, 'الصيغة: /faq limit <1-50> (الحالي ' + conf.limit + ' أسئلة لكل طالب يوميًا)', back);
    conf.limit = n; saveModuleState_('studentQA', conf);
    logChange_(ctx.from, '-', 'الوحدات', 'studentQA', 'الحد اليومي', '', n);
    return show_(ctx, '✅ الحد اليومي: ' + n + ' أسئلة لكل طالب.', back);
  }
  var progs = getPrograms_().filter(function (p) { return canAccess_(ctx.adm, p.id); });
  var log = qaLogSheet_(), rows = log.getLastRow() > 1 ? log.getRange(2, 1, log.getLastRow() - 1, QA_LOG_HEADERS.length).getValues() : [];
  rows = rows.filter(function (r) { return progs.some(function (p) { return p.id === str_(r[QL.PID]); }); });
  if (a[0] === 'pending') {
    var wait = rows.filter(function (r) { return str_(r[QL.ST]) === QS.WAIT; }).slice(-8);
    if (!wait.length) return show_(ctx, 'لا أسئلة بانتظار المراجعة.', back);
    send_(ctx.chat, '⏳ بانتظار المراجعة: ' + wait.length);
    wait.forEach(function (r) {
      send_(ctx.chat, clip('❓ ' + str_(r[QL.PID]) + ' — ' + str_(r[QL.NAME]) + '\n«' + str_(r[QL.Q]) + '»' + (str_(r[QL.SUG]) ? '\n💡 ' + str_(r[QL.SUG]) : '\n🔎 بلا إجابة مقترحة')),
        qaButtons_('MX:studentQA:', str_(r[QL.ID]), !!str_(r[QL.SUG])));
    });
    return true;
  }
  var L = ['❓ أسئلة الطلاب (الحد اليومي ' + conf.limit + ' لكل طالب):'];
  progs.forEach(function (p) {
    var n = 0; try { n = readFaq_(p.id).length; } catch (e) { n = '؟'; }
    var mine = rows.filter(function (r) { return str_(r[QL.PID]) === p.id; });
    L.push('• «' + (p.name || p.id) + '»: ' + n + ' سؤالًا شائعًا | وصل ' + mine.length + ' سؤالًا، بانتظار ' + mine.filter(function (r) { return str_(r[QL.ST]) === QS.WAIT; }).length +
      '، بلا إجابة مقترحة ' + mine.filter(function (r) { return str_(r[QL.ROW]) === '—'; }).length);
  });
  L.push('', 'املأ ورقة «' + QA.FAQ + '» في ملف كل برنامج: السؤال، الكلمات المفتاحية، الإجابة.', 'الطلاب يسألون بـ /ask في بوت الطلاب، وتصل الأسئلة مجموعة المراجعة (أو أنت والمشرفين).',
    '/faq pending — الأسئلة المنتظرة بأزرارها' + (ctx.adm.owner ? '\n/faq limit <عدد> — الحد اليومي لكل طالب' : ''));
  return show_(ctx, clip(L.join('\n')), back);
}

// ===== StudentViews.gs =====
/**
 * StudentViews.gs — في بوت الطلاب (v6):
 *  «📊 درجاتي» (/mygrades): درجة الطالب في كل عنصر (ولكل مستوى)، والمجموع، والنتيجة، وما بقي له للنجاح.
 *  «🗂 تسليماتي» (/mysubs): قائمة تسليماته، وعرض كل تسليم، وتعديله (استبدال المحتوى) أو حذفه.
 * السرعة: درجات الاختبارات والمقياس تُحسب مرة كل ساعة على الأكثر (لقطة في الذاكرة المؤقتة)، والفعاليات تُقرأ حية
 * من ورقة التسليمات، والنص النهائي يُخزَّن 10 دقائق ويُمسح عند أي تسليم أو تعديل أو حذف أو رفض.
 * كل شيء يتبع «الإعدادات» (خيارات الطلاب)، والتعديل والحذف للتسليمات المرسلة من حساب الطالب نفسه فقط.
 */
var VIEW = { SNAP_TTL: 3600, MY_TTL: 600, LIST: 10 };

var VMSG = {
  gradesOff: 'عرض الدرجات غير متاح في هذا البرنامج حاليًا.',
  subsOff: 'عرض التسليمات غير متاح في هذا البرنامج حاليًا.',
  askEmail: 'اكتب بريدك الإلكتروني الذي سجلت به في البرنامج لعرض بياناتك:',
  noSubs: 'لا توجد تسليمات مرسلة من حسابك هذا في هذا البرنامج بعد. اضغط /start لتسليم مشاركة.',
  expired: 'انتهت صلاحية هذه القائمة. اضغط /mysubs لعرضها من جديد.',
  stale: 'هذا الزر من رسالة قديمة. اضغط /start للبدء من جديد، أو /help للأوامر.'
};

function myKey_(pid, email) { return 'my:' + pid + ':' + email; }
function forgetMine_(pid, email) { try { cache_().remove(myKey_(pid, email)); } catch (e) { /* تجاهل */ } }

/* ───────── لقطة الدرجات (الاختبارات والمقياس والدرجات اليدوية) ───────── */

/** يحفظ من نتيجة حساب كامل ما يلزم لعرض درجات أي طالب دون إعادة الحساب: الإعدادات + لكل بريد [عبأ المقياس، {عنصر: درجة ثابتة}] */
function putStandingSnapshot_(pid, out) {
  var cfg = out.input.cfg, comps = cfg.components.map(function (c) { return c.key; }), s = {};
  out.res.students.forEach(function (x) {
    var fixed = {}, any = false;
    comps.concat(x.overridden || []).forEach(function (k) { if (x.values[k] != null) { fixed[k] = x.values[k]; any = true; } });
    if (any || x.hasFinal) s[x.email] = [x.hasFinal ? 1 : 0, fixed];
  });
  var snap = { t: Date.now(), cfg: cfg, s: s };
  try { putBig_('snap:' + pid, snap, VIEW.SNAP_TTL); } catch (e) { logError_(e, 'snapshot cache ' + pid); }
  return snap;
}

function standingSnapshot_(prog) {
  var c = getBig_('snap:' + prog.id);
  if (c) return c;
  return putStandingSnapshot_(prog.id, calculateForSpreadsheet(openSS_(prog.ssId), { write: false }));
}

/**
 * (خالص) درجات طالب واحد: المحرك نفسه على مدخل مصغّر = درجات اللقطة الثابتة (كدرجات يدوية) + تسليماته الحية.
 * يعيد { res, st, cfg } — st قد يكون null إن لم يكن للطالب أي شيء.
 */
function computeStanding(snap, email, subValues) {
  var cfg = JSON.parse(JSON.stringify(snap.cfg)), g = cfg.general;
  var entry = snap.s[email] || [0, {}];
  g.regSpreadsheetId = ''; g.finalEmailPattern = '^البريد$';
  var sheets = {};
  if (g.finalSheet) sheets[g.finalSheet] = entry[0] ? [['البريد'], [email]] : [['البريد']];
  var ov = [OVERRIDE_HEADERS.slice()];
  Object.keys(entry[1]).forEach(function (k) { ov.push([email, k, entry[1][k]]); });
  var subs = null;
  if (subValues && subValues.length) {
    var ie = subValues[0].indexOf('البريد');
    subs = [subValues[0]].concat(subValues.slice(1).filter(function (r) { return normalizeEmail(r[ie]) === email; }));
  }
  var input = { cfg: cfg, sheets: sheets, registration: null, corrections: null, overrides: ov, submissions: subs };
  var res = computeGrades(input), st = res.students.filter(function (x) { return x.email === email; })[0] || null;
  if (!st) {
    var anyItem = cfg.activities[0] || cfg.components[0];
    if (anyItem) { input.overrides = ov.concat([[email, anyItem.key, 0]]); res = computeGrades(input); st = res.students.filter(function (x) { return x.email === email; })[0] || null; }
  }
  return { res: res, st: st, cfg: cfg };
}

/** (خالص) عدد التسليمات المقبولة لكل فعالية (بمفتاحها) لبريد واحد */
function acceptedCounts(cfg, subValues, email) {
  var out = {};
  if (!subValues || subValues.length < 2) return out;
  var h = subValues[0], ie = h.indexOf('البريد'), ia = h.indexOf('الفعالية'), iid = h.indexOf('معرف التسليم'), ist = h.indexOf('الحالة'), il = h.indexOf(LEVEL_HEADER);
  var seen = {};
  subValues.slice(1).forEach(function (r, k) {
    if (normalizeEmail(r[ie]) !== email || SUB_REJECTED.indexOf(str_(r[ist])) >= 0) return;
    var id = str_(r[iid]) || 'row' + k; if (seen[id]) return; seen[id] = 1;
    var t = normalizeName_(r[ia]), lv = il >= 0 ? str_(r[il]) : '';
    var list = cfg.activities.filter(function (a) { return normalizeName_(a.title) === t; });
    var a = list.filter(function (x) { return x.level === lv; })[0] || list.filter(function (x) { return !x.level; })[0] || (list.length === 1 ? list[0] : null);
    if (a) out[a.key] = (out[a.key] || 0) + 1;
  });
  return out;
}

/** (خالص) نص «📊 درجاتي» */
function formatStanding(o) {
  var res = o.res, st = o.st, cfg = o.cfg, g = cfg.general, counts = o.counts || {};
  var round = function (x) { return Math.round(x * 100) / 100; };
  var L = ['📊 درجاتك في «' + o.programName + '»', o.email, ''];
  if (!st) return L.concat(['لا توجد لك درجات بعد.']).join('\n');
  var multi = (res.levels || []).length > 0, lastLv = null;
  res.items.forEach(function (it) {
    if (multi && it.level !== lastLv) { lastLv = it.level; L.push('🪜 ' + (it.level || 'مشترك بين المستويات') + ':'); }
    var v = st.values[it.key], ind = it.groupKey ? '   ◦ ' : '• ';
    if (it.kind === 'activity') {
      var n = counts[it.key] || 0;
      L.push(ind + it.title + ': ' + n + ' تسليم ← ' + (v == null ? 0 : v) + (it.maxPoints != null ? ' من ' + it.maxPoints : '') + (it.maxCount != null ? ' (يُحتسب حتى ' + it.maxCount + ')' : ''));
    } else L.push(ind + it.title + (it.kind === 'group' ? ' (مجموعة)' : '') + ': ' + (v == null ? '—' : v) + (it.max != null && it.kind === 'component' ? ' من ' + it.max : ''));
  });
  L.push('');
  (st.levels || []).forEach(function (l) { L.push('🪜 ' + l.title + ': ' + l.final + (l.passMark != null ? ' من ' + l.passMark + ' المطلوبة' : '') + ' — ' + (l.passed ? 'مجتاز ✅' : 'لم تجتزه بعد')); });
  L.push('الأساسية: ' + st.basic + ' | الإضافية: ' + st.extra + (g.extrasCap != null ? ' (السقف ' + g.extrasCap + ')' : ''));
  L.push((multi ? 'المجموع الكلي: ' : 'الدرجة النهائية: ') + st.final + (multi ? (st.overallMark != null ? ' (المطلوب ' + st.overallMark + ')' : '') : (g.passMark != null ? ' (النجاح ' + g.passMark + ')' : '')));
  L.push('');
  if (st.passed) { L.push('✅ مجتاز حتى الآن' + (st.rating ? ' — ' + st.rating : '') + '. أحسنت!'); }
  else {
    var need = [];
    if (!multi && g.passMark != null && st.final < g.passMark) need.push('تحتاج ' + round(g.passMark - st.final) + ' درجة أخرى لتبلغ درجة النجاح ' + g.passMark + '.');
    if (multi) {
      if (g.levelPassRule !== OPT.LV_TOTAL) (st.levels || []).forEach(function (l) { if (l.passMark != null && l.final < l.passMark) need.push('«' + l.title + '»: تحتاج ' + round(l.passMark - l.final) + ' درجة أخرى.'); });
      if (g.levelPassRule !== OPT.LV_EACH && st.overallMark != null && st.final < st.overallMark) need.push('المجموع الكلي: تحتاج ' + round(st.overallMark - st.final) + ' درجة أخرى.');
    }
    res.items.forEach(function (it) { if (it.min != null && (st.values[it.key] || 0) < it.min) need.push('«' + it.key + '»: لديك ' + (st.values[it.key] || 0) + ' والحد الأدنى ' + it.min + '.'); });
    if (g.finalSheet && g.finalRequired && !st.hasFinal) need.push('لم تعبئ المقياس النهائي بعد (شرط للنجاح).');
    L.push('⏳ لم تجتز بعد. المتبقي:');
    (need.length ? need : ['راجع إدارة البرنامج.']).forEach(function (x) { L.push('• ' + x); });
  }
  if (g.extrasCap != null && st.extra >= g.extrasCap && !multi) L.push('ℹ️ بلغت سقف الدرجات الإضافية؛ التسليمات الإضافية الجديدة لن ترفع درجتك.');
  L.push('', '(الفعاليات محدّثة الآن، ودرجات الاختبارات من آخر حساب' + (o.snapAt ? ' ' + fmtTime(o.snapAt) : '') + '.)');
  return L.join('\n');
}

/* ───────── قائمة التسليمات (خالص) ───────── */

/** تسليمات بريد (تسليم = معرّف فريد؛ الألبوم سطر واحد)، الأحدث أولًا، بلا المحذوف */
function mySubmissions(values, email) {
  if (!values || values.length < 2) return [];
  var h = values[0], ix = {};
  SUB_HEADERS.concat([LEVEL_HEADER, SUB_EXTRA.EDITED, SUB_EXTRA.REASON]).forEach(function (n) { ix[n] = h.indexOf(n); });
  var byId = {}, list = [];
  values.slice(1).forEach(function (r, k) {
    if (normalizeEmail(r[ix['البريد']]) !== email) return;
    if (str_(r[ix['الحالة']]) === SUB_ST.DEL) return;
    var id = str_(r[ix['معرف التسليم']]) || 'row' + (k + 2);
    if (byId[id]) { if (str_(r[ix['الحالة']]) !== SUB_ST.DEL) byId[id].parts++; return; }
    var status = str_(r[ix['الحالة']]) || SUB_ST.OK;
    var t = r[ix['الطابع الزمني']];
    byId[id] = { id: id, row: k + 2, act: str_(r[ix['الفعالية']]), level: ix[LEVEL_HEADER] >= 0 ? str_(r[ix[LEVEL_HEADER]]) : '',
      n: r[ix['رقم التسليم']], time: t instanceof Date ? t.getTime() : dateValue_(t), type: str_(r[ix['نوع المحتوى']]),
      text: str_(r[ix['النص']]), fileName: str_(r[ix['اسم الملف']]), hasFile: !!str_(r[ix['file_id']]), status: status,
      reason: ix[SUB_EXTRA.REASON] >= 0 ? str_(r[ix[SUB_EXTRA.REASON]]) : '', edited: ix[SUB_EXTRA.EDITED] >= 0 ? r[ix[SUB_EXTRA.EDITED]] : '',
      uid: str_(r[ix['معرف المستخدم']]), parts: 1 };
    list.push(byId[id]);
  });
  return list.filter(function (x) { return x.status !== SUB_ST.DEL; }).reverse();
}

function subLabel_(x) { return x.act + (x.level ? ' (' + x.level + ')' : '') + ' #' + x.n; }
function statusIcon_(x) { return x.status === SUB_ST.REJ ? '❌ مرفوض' : (SUB_REJECTED.indexOf(x.status) >= 0 ? '⛔ ' + x.status : '✅'); }

/** (خالص) هل يُسمح للطالب بتعديل/حذف التسليم؟ يعيد null أو سببًا واضحًا */
function modifyBlock(x, act, opts, progOpen, now, uid, kind) {
  var rejected = x.status === SUB_ST.REJ;
  if (kind === 'edit' && !opts.allowEdit) return 'تعديل التسليمات غير متاح في هذا البرنامج.';
  if (kind === 'delete' && !opts.allowDelete) return 'حذف التسليمات غير متاح في هذا البرنامج.';
  if (!progOpen) return 'البرنامج مغلق للتسليم الآن، فلا يمكن تعديل التسليمات أو حذفها.';
  if (!act) return 'فعالية «' + x.act + '» لم تعد متاحة في البوت.';
  var ps = closedState(act, now); // إيقاف مؤقت، أو موعد مغلق في «المواعيد» (v7)
  if (ps && ps.kind === 'pause') return 'فعالية «' + act.title + '» موقوفة مؤقتًا' + (ps.until ? ' حتى ' + fmtTime(ps.until) : '') + '، فلا يمكن تعديل تسليماتها أو حذفها الآن.';
  if (ps && ps.kind === 'deadline') return 'انتهى موعد «' + act.title + '»' + (ps.deadline ? ' (' + fmtTime(ps.deadline) + ')' : '') + '، فلا يمكن تعديل تسليماتها أو حذفها.';
  if (ps) return 'التسليم في «' + act.title + '» مغلق الآن (يفتح ' + fmtTime(ps.from) + ')، فلا يمكن تعديل تسليماتها أو حذفها.';
  if (x.uid && String(x.uid) !== String(uid)) return 'هذا التسليم أُرسل من حساب تيليجرام آخر، فلا يمكن تعديله أو حذفه من هنا.';
  if (SUB_REJECTED.indexOf(x.status) >= 0 && !rejected) return 'هذا التسليم ' + x.status + '.';
  if (!rejected && opts.editWindowH != null && x.time != null && now - x.time > opts.editWindowH * 3600000)
    return 'انتهت مدة التعديل والحذف (' + opts.editWindowH + ' ساعة من وقت التسليم).';
  return null;
}

/* ───────── المدخل: الأوامر والأزرار ───────── */

/** يحدد البرنامج ثم البريد ثم يعرض: view = 'grades' | 'subs' */
function openView_(chat, uid, st, view, from) {
  st = st || {};
  var progs = getOpenPrograms_();
  var p = st.p && progs.filter(function (x) { return x.id === st.p; })[0];
  if (!p && progs.length === 1) p = progs[0];
  if (!p) {
    if (!progs.length) return send_(chat, MSG.noPrograms);
    setState_(uid, { step: 'program' });
    return send_(chat, 'اختر البرنامج:', rows_(progs.map(function (x) { return { text: x.name || x.id, callback_data: 'pv:' + view + ':' + x.id }; }), 1));
  }
  return viewForProgram_(chat, uid, st, p.id, view, from);
}

function viewForProgram_(chat, uid, st, pid, view, from) {
  var prog = loadProgram_(pid);
  if (!prog || !prog.open) return send_(chat, MSG.noPrograms);
  var opts = studentOptions(prog.general);
  if (view === 'grades' && !opts.showGrades) return send_(chat, VMSG.gradesOff);
  if (view === 'subs' && !opts.showSubs) return send_(chat, VMSG.subsOff);
  if (st.p !== prog.id) st = { p: prog.id };
  if (!st.email) {
    var saved = getUserEmail_(uid), f = saved && lookupRegistration_(prog, saved);
    if (f) { st.email = f.email; st.name = f.name; }
  }
  if (!st.email) { st.step = 'email'; st.after = view; delete st.a; setState_(uid, st); return send_(chat, VMSG.askEmail); }
  if (!st.step || st.step === 'email' || st.step === 'confirmEmail' || st.step === 'program') st.step = 'done';
  delete st.after;
  setState_(uid, st);
  return view === 'grades' ? showMyGrades_(chat, uid, st, prog) : showMySubs_(chat, uid, st, prog);
}

var SUBS_MEMO_ = {};
function subsValues2_(prog) {
  if (SUBS_MEMO_[prog.id]) return SUBS_MEMO_[prog.id];
  var sh = openSS_(prog.ssId).getSheetByName(NAMES.SUBMISSIONS);
  var v = sh ? sh.getDataRange().getValues() : [];
  SUBS_MEMO_[prog.id] = v;
  return v;
}

function viewButtons_(prog) {
  var o = studentOptions(prog.general), row = [];
  if (o.showSubs) row.push({ text: '🗂 تسليماتي', callback_data: 'ms' });
  if (o.showGrades) row.push({ text: '📊 درجاتي', callback_data: 'my' });
  return row.length ? [row] : [];
}

function showMyGrades_(chat, uid, st, prog) {
  var key = myKey_(prog.id, st.email), c = cache_().get(key);
  if (c) return send_(chat, c, [[{ text: '📋 تسليم جديد', callback_data: 'menu' }].concat(studentOptions(prog.general).showSubs ? [{ text: '🗂 تسليماتي', callback_data: 'ms' }] : [])]);
  var text;
  try {
    var snap = standingSnapshot_(prog), subs = subsValues2_(prog);
    var r = computeStanding(snap, st.email, subs);
    text = clip(formatStanding({ res: r.res, st: r.st, cfg: r.cfg, counts: acceptedCounts(r.cfg, subs, st.email), email: st.email, programName: prog.name, snapAt: snap.t }));
    cache_().put(key, text, VIEW.MY_TTL);
  } catch (e) {
    logError_(e, 'mygrades ' + prog.id + ' ' + st.email);
    return send_(chat, 'تعذر حساب درجاتك الآن (قد تكون الإعدادات قيد التعديل). حاول بعد قليل.');
  }
  return send_(chat, text, [[{ text: '📋 تسليم جديد', callback_data: 'menu' }].concat(studentOptions(prog.general).showSubs ? [{ text: '🗂 تسليماتي', callback_data: 'ms' }] : [])]);
}

function showMySubs_(chat, uid, st, prog) {
  // الخصوصية: تُعرض فقط التسليمات المرسلة من حساب تيليجرام هذا (البريد وحده لا يكفي لرؤية نصوص غيره)
  var list = mySubmissions(subsValues2_(prog), st.email).filter(function (x) { return String(x.uid) === String(uid); }).slice(0, VIEW.LIST);
  if (!list.length) return send_(chat, VMSG.noSubs);
  st.ml = list.map(function (x) { return x.id; }); setState_(uid, st);
  var lines = list.map(function (x, i) {
    var body = x.text ? '«' + clip(x.text, 60).replace(/\n/g, ' ') + '»' : (x.fileName || x.type);
    return (i + 1) + ') ' + subLabel_(x) + ' — ' + fmtTime(x.time) + ' — ' + statusIcon_(x) + (x.edited ? ' ✏️' : '') + '\n   ' + body;
  });
  var kb = rows_(list.map(function (x, i) { return { text: String(i + 1), callback_data: 'sv:' + i }; }), 5);
  kb.push([{ text: '📋 تسليم جديد', callback_data: 'menu' }].concat(studentOptions(prog.general).showGrades ? [{ text: '📊 درجاتي', callback_data: 'my' }] : []));
  return send_(chat, '🗂 تسليماتك في «' + prog.name + '» (آخر ' + list.length + '):\n\n' + lines.join('\n') + '\n\nاضغط رقمًا لعرض التسليم وتعديله أو حذفه.', kb);
}

/** يجد تسليمًا من القائمة المحفوظة في الجلسة، من الورقة الآن */
function pickSub_(st, prog, i) {
  var id = (st.ml || [])[Number(i)];
  if (!id) return null;
  return mySubmissions(subsValues2_(prog), st.email).filter(function (x) { return x.id === id; })[0] || { gone: true };
}

function actForSub_(prog, x) {
  var list = prog.activities.filter(function (a) { return a.title === x.act; });
  return list.filter(function (a) { return (a.level || '') === (x.level || ''); })[0] || list.filter(function (a) { return !a.level; })[0] || (list.length === 1 ? list[0] : null);
}

function showSub_(chat, uid, st, prog, i) {
  var x = pickSub_(st, prog, i);
  if (!x) return send_(chat, VMSG.expired);
  if (x.gone) return send_(chat, 'هذا التسليم لم يعد موجودًا (ربما حُذف). /mysubs');
  var act = actForSub_(prog, x), opts = studentOptions(prog.general), now = Date.now();
  var L = ['📄 ' + subLabel_(x), 'التاريخ: ' + fmtTime(x.time) + (x.edited ? ' | عُدّل: ' + fmtTime(x.edited) : ''), 'الحالة: ' + statusIcon_(x) + (x.reason ? '\nسبب الرفض: ' + x.reason : ''), 'النوع: ' + x.type + (x.fileName ? ' — ' + x.fileName : '') + (x.parts > 1 ? ' (' + x.parts + ' أجزاء)' : '')];
  if (x.text) L.push('', clip(x.text, 1500));
  var kb = [], eb = modifyBlock(x, act, opts, prog.open, now, uid, 'edit'), db = modifyBlock(x, act, opts, prog.open, now, uid, 'delete');
  var row = [];
  if (!eb) row.push({ text: x.status === SUB_ST.REJ ? '✏️ تعديل وإعادة إرسال' : '✏️ تعديل', callback_data: 'se:' + i });
  if (!db) row.push({ text: '🗑 حذف', callback_data: 'sd:' + i });
  if (row.length) kb.push(row);
  var why = eb && db ? (eb === db ? eb : eb + '\n' + db) : (eb && opts.allowEdit ? eb : (db && opts.allowDelete ? db : ''));
  if (why) L.push('', 'ℹ️ ' + why);
  if (x.hasFile && !x.text) L.push('', '(الملف محفوظ في تيليجرام؛ لعرضه ارجع إلى رسالتك الأصلية في هذه المحادثة.)');
  kb.push([{ text: '↩️ تسليماتي', callback_data: 'ms' }]);
  return send_(chat, L.join('\n'), kb);
}

function askDelete_(chat, uid, st, prog, i) {
  var x = pickSub_(st, prog, i);
  if (!x || x.gone) return send_(chat, VMSG.expired);
  var why = modifyBlock(x, actForSub_(prog, x), studentOptions(prog.general), prog.open, Date.now(), uid, 'delete');
  if (why) return send_(chat, '⚠️ ' + why, [[{ text: '↩️ تسليماتي', callback_data: 'ms' }]]);
  return send_(chat, 'حذف تسليمك ' + subLabel_(x) + '؟\n' + (x.status === SUB_ST.REJ ? 'هو مرفوض أصلًا ولا درجة له.' : 'ستُخصم درجته من مجموعك فورًا.') + ' لا يمكن التراجع.',
    [[{ text: '🗑 نعم، احذفه', callback_data: 'sdy:' + i }, { text: '↩️ رجوع', callback_data: 'sv:' + i }]]);
}

function startEditSub_(chat, uid, st, prog, i) {
  var x = pickSub_(st, prog, i);
  if (!x || x.gone) return send_(chat, VMSG.expired);
  var act = actForSub_(prog, x);
  var why = modifyBlock(x, act, studentOptions(prog.general), prog.open, Date.now(), uid, 'edit');
  if (why) return send_(chat, '⚠️ ' + why, [[{ text: '↩️ تسليماتي', callback_data: 'ms' }]]);
  st.step = 'edit'; st.ed = { id: x.id, a: act.key || act.title, n: x.n }; setState_(uid, st);
  var what = act.accepts === 'text' ? 'نصًّا' : (act.accepts === 'file' ? 'ملفًا' : 'نصًّا أو ملفًا');
  return send_(chat, '✏️ أرسل الآن المحتوى الجديد لتسليمك ' + subLabel_(x) + ' ' + what + '.\nسيحل محل المحتوى السابق، ويبقى تاريخ التسليم الأصلي' + (x.status === SUB_ST.REJ ? '، ويعود التسليم مقبولًا وتُحتسب درجته' : '') + '.\n\n(للإلغاء: /cancel)');
}

/* ───────── الكتابة في ورقة التسليمات ───────── */

/** يضيف أعمدة غائبة بعد آخر عمود (الصفوف القديمة تبقى كما هي) ويعيد رأس الورقة */
function ensureSubColumns_(sh, names) {
  var lc = sh.getLastColumn(), h = sh.getRange(1, 1, 1, lc).getValues()[0].map(str_);
  names.forEach(function (n) { if (h.indexOf(n) < 0) { h.push(n); sh.getRange(1, h.length).setValue(n); } });
  return h;
}

/** يقرأ صفوف تسليم بمعرّفه (داخل القفل) */
function subRows_(sh, subId) {
  var data = sh.getDataRange().getValues(), h = data[0].map(str_), iid = h.indexOf('معرف التسليم'), rows = [];
  for (var r = 1; r < data.length; r++) if (str_(data[r][iid]) === subId) rows.push({ r: r + 1, v: data[r] });
  return { h: h, rows: rows };
}

function writeRow_(sh, rowNum, vals, width) {
  var v = vals.slice(); while (v.length < width) v.push('');
  sh.getRange(rowNum, 1, 1, width).setValues([v.slice(0, width)]);
}

/** تعديل: يستبدل المحتوى في السطر الأول، ويحذف بقية أجزاء الألبوم القديم، ويعيد المرفوض مقبولًا */
function applyEdit_(prog, act, st, m, c, uid) {
  var lock = tenantLock_();
  lock.waitLock(25000);
  try {
    var mk = 'msg:' + m.chat.id + ':' + m.message_id;
    if (cache_().get(mk)) return { dup: true };
    var sh = openSS_(prog.ssId).getSheetByName(NAMES.SUBMISSIONS);
    if (!sh) return { error: 'لم أجد ورقة التسليمات.' };
    var h = ensureSubColumns_(sh, [SUB_EXTRA.EDITED, SUB_EXTRA.REASON, SUB_EXTRA.BY, SUB_EXTRA.AT]);
    var found = subRows_(sh, st.ed.id), W = h.length, col = function (n) { return h.indexOf(n); };
    if (!found.rows.length) return { error: 'لم أجد هذا التسليم (ربما حُذف).' };
    var x = mySubmissions([h].concat(found.rows.map(function (r) { return r.v; })), st.email)[0];
    if (!x) return { error: 'هذا التسليم ليس لبريدك أو حُذف.' };
    var why = modifyBlock(x, act, studentOptions(prog.general), prog.open, Date.now(), uid, 'edit');
    if (why) return { error: why };
    var first = found.rows[0].v.slice(), f = c.file || {}, now = new Date(), wasRejected = x.status === SUB_ST.REJ;
    var set = function (n, v) { var i = col(n); if (i >= 0) { while (first.length <= i) first.push(''); first[i] = v; } };
    set('نوع المحتوى', c.type); set('النص', safeText_(c.text)); set('file_id', f.file_id || ''); set('file_unique_id', f.file_unique_id || '');
    set('اسم الملف', safeText_(c.fileName)); set('حجم الملف (بايت)', f.file_size || ''); set('نوع الملف (MIME)', c.mime);
    set('معرف المحادثة', String(m.chat.id)); set('معرف الرسالة', m.message_id); set(SUB_EXTRA.EDITED, now);
    if (wasRejected) { set('الحالة', SUB_ST.OK); set(SUB_EXTRA.REASON, ''); set(SUB_EXTRA.BY, ''); set(SUB_EXTRA.AT, ''); }
    var note = str_(first[col('ملاحظة')]);
    set('ملاحظة', (note ? note + ' • ' : '') + 'عدّله الطالب ' + fmtTime(now) + (wasRejected ? ' (كان مرفوضًا)' : ''));
    writeRow_(sh, found.rows[0].r, first, W);
    found.rows.slice(1).forEach(function (r) {
      var v = r.v.slice(); if (str_(v[col('الحالة')]) === SUB_ST.DEL) return;
      v[col('الحالة')] = SUB_ST.DEL; v[col('ملاحظة')] = (str_(v[col('ملاحظة')]) ? str_(v[col('ملاحظة')]) + ' • ' : '') + 'جزء ألبوم استُبدل بالتعديل';
      writeRow_(sh, r.r, v, W);
    });
    cache_().put(mk, '1', 21600);
    forgetMine_(prog.id, st.email);
    emitEvent_(EVENT_TYPES.SUBMISSION_EDITED, prog.id, { subId: st.ed.id, email: st.email, activity: x.act, level: x.level || '', n: x.n, type: c.type, wasRejected: wasRejected }, uid);
    return { ok: true, sub: x, wasRejected: wasRejected };
  } finally { lock.releaseLock(); }
}

/** حذف (ناعم): الحالة «محذوف» ووقت التعديل؛ يبقى السطر للأرشيف ويخرج من الحساب */
function applyDelete_(prog, st, x, uid) {
  var lock = tenantLock_();
  lock.waitLock(25000);
  try {
    var sh = openSS_(prog.ssId).getSheetByName(NAMES.SUBMISSIONS);
    var h = ensureSubColumns_(sh, [SUB_EXTRA.EDITED]), found = subRows_(sh, x.id), W = h.length, now = new Date();
    var cur = mySubmissions([h].concat(found.rows.map(function (r) { return r.v; })), st.email)[0];
    if (!cur) return { error: 'هذا التسليم حُذف من قبل.' };
    var why = modifyBlock(cur, actForSub_(prog, cur), studentOptions(prog.general), prog.open, Date.now(), uid, 'delete');
    if (why) return { error: why };
    found.rows.forEach(function (r) {
      var v = r.v.slice(); while (v.length < W) v.push('');
      v[h.indexOf('الحالة')] = SUB_ST.DEL; v[h.indexOf(SUB_EXTRA.EDITED)] = now;
      var ni = h.indexOf('ملاحظة'); v[ni] = (str_(v[ni]) ? str_(v[ni]) + ' • ' : '') + 'حذفه الطالب ' + fmtTime(now);
      writeRow_(sh, r.r, v, W);
    });
    forgetMine_(prog.id, st.email);
    var act = actForSub_(prog, cur), cnt = act ? countPrior_(sh, st.email, act.title, act.level) : 0;
    emitEvent_(EVENT_TYPES.SUBMISSION_DELETED, prog.id, { subId: x.id, email: st.email, activity: cur.act, level: cur.level || '', n: cur.n }, uid);
    return { ok: true, sub: cur, act: act, count: cnt, total: act ? activityPoints(cnt, act) : 0 };
  } finally { lock.releaseLock(); }
}

function doDelete_(chat, uid, st, prog, i) {
  var x = pickSub_(st, prog, i);
  if (!x || x.gone) return send_(chat, VMSG.expired);
  var r = applyDelete_(prog, st, x, uid);
  if (r.error) return send_(chat, '⚠️ ' + r.error, [[{ text: '↩️ تسليماتي', callback_data: 'ms' }]]);
  notifyReviewChange_(prog, r.sub, st, 'delete');
  return send_(chat, '🗑 حُذف تسليمك ' + subLabel_(r.sub) + '.' + (r.act ? '\nمجموع درجتك في «' + r.act.title + '» الآن: ' + r.total + ' (' + r.count + ' تسليم)' : ''),
    [[{ text: '🗂 تسليماتي', callback_data: 'ms' }, { text: '📋 تسليم جديد', callback_data: 'menu' }]]);
}

/** المحتوى الجديد في خطوة التعديل */
function onEditContent_(m, uid, st) {
  var chat = m.chat.id;
  if (m.media_group_id) {
    var mg = 'mgx:' + m.media_group_id;
    if (cache_().get(mg)) return; // بقية أجزاء ألبوم التعديل: يُستعمل الجزء الأول فقط
    cache_().put(mg, '1', 900);
  }
  var prog = loadProgram_(st.p), act = prog && findAct_(prog, st.ed && st.ed.a);
  if (!prog || !act) { clearState_(uid); return send_(chat, 'هذه الفعالية لم تعد متاحة. اضغط /start.'); }
  var c = extractContent_(m);
  if (!c) return send_(chat, MSG.unsupported);
  if (act.accepts === 'text' && c.type !== 'نص') return send_(chat, MSG.wrongType.text);
  if (act.accepts === 'file' && !c.file) return send_(chat, MSG.wrongType.file);
  var r = applyEdit_(prog, act, st, m, c, uid);
  if (r.dup) return;
  if (r.error) { st.step = 'done'; delete st.ed; setState_(uid, st); return send_(chat, '⚠️ لم يُعدَّل: ' + r.error, [[{ text: '↩️ تسليماتي', callback_data: 'ms' }]]); }
  notifyReviewChange_(prog, r.sub, st, 'edit', m, r.wasRejected);
  st.step = 'done'; st.a = act.key || act.title; delete st.ed; setState_(uid, st);
  return send_(chat, '✅ عُدّل تسليمك ' + subLabel_(r.sub) + ' وحلّ المحتوى الجديد محل القديم.' + (r.wasRejected ? '\nعاد التسليم مقبولًا وتُحتسب درجته.' : '') + (m.media_group_id ? '\n(من الألبوم استُعمل أول ملف فقط.)' : ''),
    [[{ text: '🗂 تسليماتي', callback_data: 'ms' }, { text: '📋 تسليم جديد', callback_data: 'menu' }]]);
}

// ===== Submit.gs =====
/**
 * Submit.gs — تسجيل التسليم في ورقة «تسليمات الفعاليات» داخل ملف درجات البرنامج.
 * لا تُحفظ الملفات في درايف: يُحفظ النص ومعرّف ملف تيليجرام (file_id) وبياناته فقط.
 * الدرجة تُحسب فورًا: (عدد التسليمات المقبولة حتى الحد المحتسب × درجة التسليم) مع سقف الفعالية.
 */
var MAX_CELL_TEXT = 45000;

function ensureSubSheet_(ss) {
  var sh = ss.getSheetByName(NAMES.SUBMISSIONS);
  if (!sh) {
    sh = ss.insertSheet(NAMES.SUBMISSIONS);
    sh.setRightToLeft(true);
    sh.getRange(1, 1, 1, SUB_HEADERS.length).setValues([SUB_HEADERS]).setFontWeight('bold')
      .setBackground('#3d7d4f').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** يحسب التسليمات السابقة المقبولة لهذا البريد في هذه الفعالية (معرّفات تسليم فريدة) */
function countPrior_(sh, email, actTitle, level) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var ci = function (name) { var i = h.indexOf(name); return i; };
  var ie = ci('البريد'), ia = ci('الفعالية'), iid = ci('معرف التسليم'), ist = ci('الحالة'), il = ci(LEVEL_HEADER);
  var data = sh.getRange(2, 1, last - 1, h.length).getValues();
  var ids = {}, want = normalizeName_(actTitle);
  data.forEach(function (r, k) {
    if (normalizeEmail(r[ie]) !== email) return;
    if (normalizeName_(r[ia]) !== want) return;
    if (level && il >= 0 && str_(r[il]) !== level) return; // فعالية المستوى: تسليمات مستواها فقط
    if (ist >= 0 && SUB_REJECTED.indexOf(str_(r[ist])) >= 0) return;
    ids[iid >= 0 && str_(r[iid]) ? str_(r[iid]) : 'row' + k] = true;
  });
  return Object.keys(ids).length;
}

/** يمنع تحويل النص إلى معادلة */
function safeText_(s) {
  s = String(s || '');
  if (s.length > MAX_CELL_TEXT) s = s.slice(0, MAX_CELL_TEXT) + ' …[اقتُطع النص لطوله]';
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/** يستخرج محتوى الرسالة: نص أو ملف (مع بياناته) */
function extractContent_(m) {
  var c = { type: '', text: m.text || m.caption || '', file: null, fileName: '', mime: '' };
  if (m.text) c.type = 'نص';
  else if (m.document) { c.type = 'ملف'; c.file = m.document; }
  else if (m.photo && m.photo.length) { c.type = 'صورة'; c.file = m.photo[m.photo.length - 1]; }
  else if (m.voice) { c.type = 'تسجيل صوتي'; c.file = m.voice; }
  else if (m.audio) { c.type = 'ملف صوتي'; c.file = m.audio; }
  else if (m.video) { c.type = 'فيديو'; c.file = m.video; }
  else if (m.video_note) { c.type = 'فيديو دائري'; c.file = m.video_note; }
  else return null;
  if (c.file) { c.fileName = c.file.file_name || ''; c.mime = c.file.mime_type || ''; }
  return c;
}

/**
 * يسجل التسليم داخل قفل. يعيد null إن كانت الرسالة مسجلة سابقًا (تكرار من تيليجرام).
 * أجزاء الألبوم الواحد (media_group_id) تُعد تسليمًا واحدًا.
 */
function recordSubmission_(prog, act, st, m, c) {
  var lock = tenantLock_();
  lock.waitLock(25000);
  try {
    var cache = cache_();
    var mk = 'msg:' + m.chat.id + ':' + m.message_id;
    if (cache.get(mk)) return null;
    var ss = openSS_(prog.ssId);
    var sh = ensureSubSheet_(ss);
    var subId = null, albumPart = false;
    if (m.media_group_id) {
      var ex = cache.get('mg:' + m.media_group_id);
      if (ex) { subId = ex; albumPart = true; }
    }
    var prior = countPrior_(sh, st.email, act.title, act.level);
    var n = albumPart ? prior : prior + 1;
    var before = activityPoints(albumPart ? prior - 1 : prior, act);
    var after = activityPoints(n, act);
    var points = albumPart ? 0 : after - before;
    var note = '';
    if (albumPart) note = 'جزء من ألبوم التسليم نفسه';
    else if (points === 0 && act.maxCount != null && n > act.maxCount) note = 'تجاوز الحد المحتسب (' + act.maxCount + ' تسليمات)';
    else if (points === 0 && act.maxPoints != null) note = 'بلغ أقصى درجة للفعالية (' + act.maxPoints + ')';
    if (!subId) subId = Utilities.getUuid();
    var f = c.file || {};
    var from = m.from || {};
    var row = [new Date(), subId, st.email, st.name || '', act.title, c.type, safeText_(c.text),
      f.file_id || '', f.file_unique_id || '', safeText_(c.fileName), f.file_size || '', c.mime,
      String(from.id || ''), from.username ? '@' + from.username : '', safeText_([from.first_name, from.last_name].filter(Boolean).join(' ')),
      String(m.chat.id), m.message_id, n, points, 'مقبول', note];
    var lv = act.level || st.lv || '';
    if (lv) {
      // برنامج بمستويات: المستوى في عمود «المستوى» (يُضاف رأسه أول مرة بعد آخر عمود)
      var lc = sh.getLastColumn(), hdr = sh.getRange(1, 1, 1, lc).getValues()[0], li = hdr.indexOf(LEVEL_HEADER);
      if (li < 0) { li = Math.max(lc, row.length); sh.getRange(1, li + 1).setValue(LEVEL_HEADER); }
      while (row.length < li) row.push('');
      row[li] = lv;
    }
    sh.appendRow(row);
    cache.put(mk, '1', 21600);
    forgetMine_(prog.id, st.email);
    if (m.media_group_id && !albumPart) cache.put('mg:' + m.media_group_id, subId, 900);
    if (!albumPart) emitEvent_(EVENT_TYPES.SUBMISSION_CREATED, prog.id, { subId: subId, email: st.email, activity: act.title, level: lv, n: n, points: points, type: c.type }, from.id);
    return { n: n, points: points, total: after, albumPart: albumPart, note: note, subId: subId };
  } finally {
    lock.releaseLock();
  }
}

/**
 * نسخة اختيارية من التسليم إلى مجموعة المراجعة (بلا تخزين في درايف).
 * تُسجَّل معرّفات الرسائل في المجموعة (السطر الأول + النسخة + أجزاء الألبوم) ليرد المشرف على تسليم بعينه.
 */
function forwardToReview_(prog, act, st, m, res) {
  var chat = prog.general.reviewChatId;
  if (!chat) return;
  try {
    var ids = [], headerId = null;
    if (!res.albumPart) {
      var lvTag = act.level || st.lv ? ' | ' + (act.level || st.lv) : '';
      var h = send_(chat, '#' + act.title.replace(/\s+/g, '_') + lvTag + ' | ' + (st.name || '') + ' | ' + st.email + ' | التسليم ' + res.n + ' | +' + res.points +
        '\n↩️ للرد على الطالب: اضغط «رد» على هذه الرسالة أو على المحتوى تحتها.', rejectKeyboard_(prog));
      if (h.ok && h.result) { ids.push(h.result.message_id); headerId = h.result.message_id; }
    }
    var c = tg_('copyMessage', { chat_id: chat, from_chat_id: m.chat.id, message_id: m.message_id });
    if (c.ok && c.result) ids.push(c.result.message_id);
    if (ids.length) saveReviewMap_(chat, ids, { p: prog.id, a: act.title, n: res.n, subId: res.subId, chat: m.chat.id,
      uid: m.from && m.from.id, msg: m.message_id, email: st.email, name: st.name || '' }, headerId);
  } catch (e) { logError_(e, 'review'); }
}

// ===== Telegram.gs =====
/**
 * Telegram.gs — استدعاء واجهة تيليجرام. لكل عميل بوتان (الطلاب والإداري) وتوكناهما في خصائص العميل
 *   T:<id>:BOT_TOKEN و T:<id>:ADMIN_BOT_TOKEN، وبوت المنصة (للمالك والتفعيل) في PLATFORM_BOT_TOKEN.
 * BOT_ROLE يحدده الموجّه (Router.gs) من الرابط (&b=student|admin|platform) فتذهب الردود من البوت الصحيح.
 * كل فشل من تيليجرام يُسجَّل في ورقة «سجل الأخطاء» (عدا الأخطاء المعتادة غير المؤثرة).
 */
var BOT_ROLE = 'student';

/** أخطاء معتادة لا داعي لتسجيلها */
var TG_BENIGN = /message is not modified|query is too old|query ID is invalid|message to edit not found|message can't be edited/i;

/** خصائص السكربت تُقرأ مرة واحدة في كل تشغيل (prop_ و platformProp_ في Tenant.gs) */
var PROPS_MEMO_ = null;

function isUnifiedTenant_() { return TENANT_ ? prop_('BOT_MODE') === 'unified' : false; }

function tokenFor_(role) {
    if (role === 'platform') return platformProp_('PLATFORM_BOT_TOKEN');
    if (role === 'unified') return prop_('BOT_TOKEN');
    if (role === 'admin') { var a = prop_('ADMIN_BOT_TOKEN'); if (a) return a; return isUnifiedTenant_() ? prop_('BOT_TOKEN') : null; }
    return prop_('BOT_TOKEN');
}

function tgRequest_(role, method, payload) {
  var token = tokenFor_(role);
  if (!token) throw new Error((role === 'platform' ? 'PLATFORM_BOT_TOKEN' : role === 'admin' ? 'ADMIN_BOT_TOKEN' : 'BOT_TOKEN') + ' غير مضبوط' + (TENANT_ ? ' للعميل ' + TENANT_.id : '') + '.');
  return {
    url: 'https://api.telegram.org/bot' + token + '/' + method,
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload || {}), muteHttpExceptions: true
  };
}

function tgParse_(role, method, res, quiet) {
  var j;
  try { j = JSON.parse(res.getContentText()); } catch (e) { j = { ok: false, description: String(res.getContentText()).slice(0, 300) }; }
  if (!j.ok && !quiet && !TG_BENIGN.test(String(j.description))) {
    console.warn('Telegram ' + role + ' ' + method + ': ' + j.description);
    logError_(new Error('Telegram ' + method + ': ' + j.description), role);
  }
  return j;
}

function tgAs_(role, method, payload, quiet) {
  var req = tgRequest_(role, method, payload), url = req.url;
  delete req.url;
  return tgParse_(role, method, UrlFetchApp.fetch(url, req), quiet);
}

/** عدة استدعاءات في رحلة شبكة واحدة (متوازية): [[method, payload], …] */
function tgBatch_(calls) {
  var reqs = calls.map(function (c) { return tgRequest_(BOT_ROLE, c[0], c[1]); });
  var res = UrlFetchApp.fetchAll(reqs);
  return res.map(function (r, i) { return tgParse_(BOT_ROLE, calls[i][0], r, calls[i][2]); });
}

/** إرسال متعدد الأجزاء (لرفع ملف) */
function tgMultipartAs_(role, method, payload) {
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + tokenFor_(role) + '/' + method, {
    method: 'post', payload: payload, muteHttpExceptions: true
  });
  return tgParse_(role, method, res, false);
}

function tg_(method, payload, quiet) { return tgAs_(BOT_ROLE, method, payload, quiet); }

function send_(chatId, text, keyboard) {
  var p = { chat_id: chatId, text: text, disable_web_page_preview: true };
  if (keyboard) p.reply_markup = { inline_keyboard: keyboard };
   return tg_('sendMessage', p);
}

/**
 * يعرض شاشة: إن جاءت من زر (editId) تُعدَّل الرسالة نفسها (أسرع وبلا تكرار)، وإلا تُرسل رسالة جديدة.
 * إن تعذر التعديل (رسالة قديمة مثلًا) تُرسل رسالة جديدة.
 */
function screen_(chatId, editId, text, keyboard) {
  if (editId) {
    var p = { chat_id: chatId, message_id: editId, text: text, disable_web_page_preview: true,
      reply_markup: { inline_keyboard: keyboard || [] } };
    var r = tg_('editMessageText', p, true);
    if (r.ok || /not modified/i.test(String(r.description))) return r;
  }
  return send_(chatId, text, keyboard);
}

function answerCallback_(id, text, alert) { return tg_('answerCallbackQuery', { callback_query_id: id, text: text || '', show_alert: !!alert }, true); }

function clearButtons_(chatId, messageId) {
  return tg_('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }, true);
}

/** يرد على الزر ويزيل أزرار رسالته في رحلة شبكة واحدة */
function ackAndClear_(q) {
  return tgBatch_([
    ['answerCallbackQuery', { callback_query_id: q.id }, true],
    ['editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }, true]
  ]);
}

/** يرتب الأزرار صفوفًا (عدد الأزرار في كل صف) */
function rows_(buttons, perRow) {
  var out = [];
  for (var i = 0; i < buttons.length; i += perRow) out.push(buttons.slice(i, i + perRow));
  return out;
}

// ===== Tenant.gs =====
/**
 * Tenant.gs — سياق العميل (المستأجر) في التطبيق المركزي متعدد العملاء.
 *
 * كل تحديث أو تشغيل زمني يدخل سياق عميل واحد بـ enterTenant_(t)؛ بعدها:
 *  - prop_(k)    يقرأ خاصية العميل «T:<id>:<k>» فقط (التوكنات، الحالة الداخلية…)؛ لا يرى خصائص غيره.
 *  - cache_()    ذاكرة مؤقتة مفاتيحها مسبوقة بـ «t:<id>|».
 *  - central_()  ملف التحكم الخاص بالعميل (البرامج، المستخدمون، المشرفون…).
 *  - tenantLock_() قفل خاص بالعميل (لا ينتظر عميلٌ عميلًا آخر).
 * خصائص المنصة (عامة): PLATFORM_OWNER_ID, PLATFORM_BOT_TOKEN, PLATFORM_SECRET, REGISTRY_SS_ID, WEBAPP_URL, PLATFORM_BLOCKED_MSG …
 * سجل العملاء: ورقة «العملاء» في ملف السجل (للمالك وحده). التوكنات والأسرار لا تُكتب في الورقة أبدًا.
 */
var TENANT_ = null;
var TENANT_ID_RE = /^[a-z0-9]{2,20}$/;
var REGISTRY = { SHEET: 'العملاء', LOG: 'سجل أخطاء المنصة', USAGE: 'الاستهلاك' };
var REGISTRY_HEADERS = ['معرّف العميل', 'الاسم', 'مفتاح الترخيص', 'الحالة', 'تاريخ الانتهاء', 'حصة البرامج', 'معرّف المالك',
  'توكن الطلاب', 'توكن الإداري', 'ملف التحكم', 'بريد المحررين', 'الإعداد', 'تاريخ الإنشاء', 'آخر تحديث', 'ملاحظات', 'الإضافات المسموحة'];
var RC = { ID: 0, NAME: 1, LICENSE: 2, STATUS: 3, EXPIRY: 4, QUOTA: 5, OWNER: 6, STOK: 7, ATOK: 8, CONTROL: 9, EDITORS: 10, SETUP: 11, CREATED: 12, UPDATED: 13, NOTES: 14, ADDONS: 15 };
var TENANT_STATUS = { ACTIVE: 'active', TRIAL: 'trial', SUSPENDED: 'suspended' };
var TENANT_TTL = 300;

/* ───────── خصائص المنصة والعميل ───────── */
function allProps_() {
  if (!PROPS_MEMO_) PROPS_MEMO_ = PropertiesService.getScriptProperties().getProperties() || {};
  return PROPS_MEMO_;
}
function platformProp_(k) { return allProps_()[k] || null; }
function setPlatformProp_(k, v) {
  PropertiesService.getScriptProperties().setProperty(k, String(v));
  if (PROPS_MEMO_) PROPS_MEMO_[k] = String(v);
}
function tkey_(tid, k) { return 'T:' + tid + ':' + k; }
/** خاصية للعميل الحالي فقط؛ بلا سياق عميل = null (لا رجوع إلى خاصية عامة) */
function prop_(k) { return TENANT_ ? (allProps_()[tkey_(TENANT_.id, k)] || null) : null; }
function setProp_(k, v) {
  if (!TENANT_) throw new Error('لا سياق عميل');
  setPlatformProp_(tkey_(TENANT_.id, k), v);
}
function tenantPropOf_(tid, k) { return allProps_()[tkey_(tid, k)] || null; }
function setTenantPropOf_(tid, k, v) { setPlatformProp_(tkey_(tid, k), v); }

/* ───────── إعدادات العميل (JSON في خصائصه): الوحدات، الحساب التلقائي، القالب ───────── */
var TENANT_CONF_DEFAULTS = {
  autoCalc: true,
  adminCreateProgram: false,
  ownedFilesOnly: true,      // «البرامج» تقبل فقط ملفات أنشأتها الخدمة (OWNED_FILES)            // يحل محل مشغّل «الحساب التلقائي كل ساعة» الذي كان مرتبطًا بملف الدرجات
  reviewChatId: '',          // مجموعة المراجعة الافتراضية للبرامج الجديدة (من معالج الإعداد)
  template: { activities: ['مشاركة', 'واجب', 'نقاش'], passMark: 60 },
  modules: { quizImport: false, dailyWird: false, studentQA: false, monthlyReport: false, miniApp: false, tasks: false, tawasul: false }
};
function tenantConf_() {
  var raw = prop_('CONF'), c = {};
  try { c = raw ? JSON.parse(raw) : {}; } catch (e) { c = {}; }
  var out = JSON.parse(JSON.stringify(TENANT_CONF_DEFAULTS));
  Object.keys(c).forEach(function (k) {
    if (k === 'modules' || k === 'template') Object.keys(c[k] || {}).forEach(function (m) { out[k][m] = c[k][m]; });
    else out[k] = c[k];
  });
  return out;
}
function saveTenantConf_(patch) {
  var c = tenantConf_();
  Object.keys(patch).forEach(function (k) {
    if ((k === 'modules' || k === 'template') && patch[k]) Object.keys(patch[k]).forEach(function (m) { c[k][m] = patch[k][m]; });
    else c[k] = patch[k];
  });
  setProp_('CONF', JSON.stringify(c));
  return c;
}

/* ───────── الذاكرة المؤقتة ───────── */
function rawCache_() { return CacheService.getScriptCache(); }
function nsCache_(prefix) {
  var c = rawCache_(), k = function (x) { return prefix + x; };
  return {
    get: function (x) { return c.get(k(x)); },
    put: function (x, v, ttl) { return ttl == null ? c.put(k(x), v) : c.put(k(x), v, ttl); },
    remove: function (x) { return c.remove(k(x)); },
    removeAll: function (a) { return c.removeAll(a.map(k)); },
    putAll: function (o, ttl) { var p = {}; Object.keys(o).forEach(function (x) { p[k(x)] = o[x]; }); return ttl == null ? c.putAll(p) : c.putAll(p, ttl); },
    getAll: function (a) { var g = c.getAll(a.map(k)) || {}, o = {}; a.forEach(function (x) { if (g[k(x)] != null) o[x] = g[k(x)]; }); return o; }
  };
}
function tenantCachePrefix_(tid) { return 't:' + tid + '|'; }

/* ───────── القفل لكل عميل ───────── */
/**
 * قفل منطقي لكل عميل: قفل السكربت يُمسك لحظةً فقط لحجز مفتاح «lock:<id>» في الذاكرة المؤقتة (مهلة 120ث).
 * فلا ينتظر تسليمُ عميلٍ عمليةً طويلة عند عميل آخر. إعادة الدخول في التشغيل نفسه مسموحة.
 */
var LOCKS_HELD_ = {};
var TENANT_LOCK_TTL = 120;
function tenantLock_() {
  var tid = TENANT_ ? TENANT_.id : '_platform', key = 'lock:' + tid, held = false;
  function attempt() {
    var h = LOCKS_HELD_[tid];
    if (h) { h.depth++; held = true; return true; }
    var sl = LockService.getScriptLock();
    if (!sl.tryLock(3000)) return false;
    try {
      var c = rawCache_(), cur = c.get(key);
      if (cur && Number(String(cur).split('|')[1]) > Date.now()) return false;
      var tok = Math.random().toString(36).slice(2) + '|' + (Date.now() + TENANT_LOCK_TTL * 1000);
      c.put(key, tok, TENANT_LOCK_TTL);
      LOCKS_HELD_[tid] = { tok: tok, depth: 1 };
      held = true; return true;
    } finally { sl.releaseLock(); }
  }
  return {
    tryLock: function (ms) {
      var end = Date.now() + (ms || 0);
      while (true) {
        if (attempt()) return true;
        if (Date.now() >= end) return false;
        Utilities.sleep(150);
      }
    },
    waitLock: function (ms) { if (!this.tryLock(ms)) throw new Error('تعذر الحصول على القفل (العميل ' + tid + ') — حاول بعد قليل.'); },
    releaseLock: function () {
      if (!held) return;
      held = false;
      var h = LOCKS_HELD_[tid];
      if (!h) return;
      if (--h.depth > 0) return;
      delete LOCKS_HELD_[tid];
      try { var c = rawCache_(); if (c.get(key) === h.tok) c.remove(key); } catch (e) { /* ينتهي وحده بعد المهلة */ }
    }
  };
}

/* ───────── سجل العملاء ───────── */
function registrySS_() {
  var id = platformProp_('REGISTRY_SS_ID');
  if (!id) throw new Error('REGISTRY_SS_ID غير مضبوط: شغّل platformInstall مرة واحدة من المحرر.');
  return openSS_(id);
}
function registrySheet_() {
  var sh = registrySS_().getSheetByName(REGISTRY.SHEET);
  if (!sh) throw new Error('لا توجد ورقة «' + REGISTRY.SHEET + '» في ملف السجل.');
  ensureRegistryColumns_(sh);
  return sh;
}
/**
 * ترحيل تلقائي آمن للتكرار: يضيف عناوين الأعمدة الجديدة (مثل «الإضافات المسموحة») في آخر السجل إن غابت.
 * لا يمسّ عنوانًا موجودًا ولا أي بيانات. مرة واحدة لكل تشغيل (REG_COLS_OK_).
 */
var REG_COLS_OK_ = {};
function ensureRegistryColumns_(sh) {
  var key = String(platformProp_('REGISTRY_SS_ID') || '');
  if (REG_COLS_OK_[key]) return false;
  var n = REGISTRY_HEADERS.length, changed = false;
  try { var mc = sh.getMaxColumns(); if (mc < n) sh.insertColumnsAfter(mc, n - mc); } catch (e) { /* تجاهل */ }
  var width = n;
  try { width = Math.max(1, Math.min(n, sh.getMaxColumns())); } catch (e) { /* تجاهل */ }
  var hdr = [];
  try { hdr = sh.getRange(1, 1, 1, width).getValues()[0] || []; } catch (e) { hdr = []; }
  while (hdr.length < n) hdr.push('');
  for (var i = 0; i < n; i++) if (str_(hdr[i]) === '') {
    try { sh.getRange(1, i + 1).setValue(REGISTRY_HEADERS[i]); changed = true; } catch (e) { /* تجاهل */ }
  }
  REG_COLS_OK_[key] = true;
  return changed;
}
/** «الإضافات المسموحة»: معرّفات مفصولة بفواصل؛ الفارغ = لا إضافات */
function parseAddons_(v) {
  var out = [];
  str_(v).split(/[\s,،;]+/).forEach(function (x) { if (x && /^[A-Za-z][A-Za-z0-9]*$/.test(x) && out.indexOf(x) < 0) out.push(x); });
  return out;
}
function parseTenantRow_(r, rowNum) {
  var exp = r[RC.EXPIRY], expMs = exp instanceof Date ? exp.getTime() : (str_(exp) ? new Date(str_(exp) + (String(exp).length <= 10 ? 'T23:59:59' : '')).getTime() : null);
  return {
    id: str_(r[RC.ID]).toLowerCase(), name: str_(r[RC.NAME]), license: str_(r[RC.LICENSE]),
    status: str_(r[RC.STATUS]).toLowerCase() || TENANT_STATUS.TRIAL, expiry: isNaN(expMs) ? null : expMs,
    quota: num_(r[RC.QUOTA]) == null ? DEFAULT_QUOTA : num_(r[RC.QUOTA]), ownerId: str_(r[RC.OWNER]),
    controlSsId: extractSpreadsheetId(str_(r[RC.CONTROL])), editors: str_(r[RC.EDITORS]).split(/[\s,،;]+/).filter(String),
    setup: str_(r[RC.SETUP]), addons: parseAddons_(r[RC.ADDONS]), row: rowNum
  };
}
var TENANTS_LIST_CACHE_KEY = 'tenants:v1';
var TENANTS_LIST_TTL = 120;
function invalidateTenantsCache_() { try { rawCache_().remove(TENANTS_LIST_CACHE_KEY); } catch (e) { /* ignore */ } }
// Tenants list cache (120s, invalidated on writes).
function listTenants_() { try { var hit = rawCache_().get(TENANTS_LIST_CACHE_KEY); if (hit) { var cached = JSON.parse(hit); if (Array.isArray(cached)) return cached; } } catch (e) {} var tenants = listTenantsFromSheet_(); try { rawCache_().put(TENANTS_LIST_CACHE_KEY, JSON.stringify(tenants), TENANTS_LIST_TTL); } catch (e) {} return tenants; }
function listTenantsFromSheet_() {
  var sh = registrySheet_(), n = sh.getLastRow();
  if (n < 2) return [];
  var cols = REGISTRY_HEADERS.length;
  try { cols = Math.max(1, Math.min(cols, sh.getMaxColumns())); } catch (e) { /* تجاهل */ }
  return sh.getRange(2, 1, n - 1, cols).getValues()
    .map(function (r, i) {
      r = r || [];
      while (r.length < REGISTRY_HEADERS.length) r.push('');
      return parseTenantRow_(r, i + 2);
    })
    .filter(function (t) { return TENANT_ID_RE.test(t.id); });
}
function loadTenantRowOnly_(tid) {
  tid = String(tid || '').toLowerCase();
  if (tid !== 'test2') return null;
    try {
    var sh = registrySheet_();
    var last = sh.getLastRow();
    if (last < 2) return null;
    var found = sh.getRange(2, 1, last - 1, 1).createTextFinder(tid).matchEntireCell(true).matchCase(false).findNext();
    if (!found) return null;
    var r = found.getRow();
    if (r < 2) return null;
    var row = sh.getRange(r, 1, 1, REGISTRY_HEADERS.length).getValues()[0];
    var t = parseTenantRow_(row, r);
    if (!t || t.id !== tid) return null;
    try { rawCache_().put('ten:' + tid, JSON.stringify(t), TENANT_TTL); } catch (__e0) {}
    return t;
  } catch (__e) { return null; }
}
function loadTenantTest2ListCache_() {
    try {
    var hit = rawCache_().get(TENANTS_LIST_CACHE_KEY);
    if (!hit) return null;
    var arr = JSON.parse(hit);
    if (!Array.isArray(arr)) return null;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].id === 'test2') {
        return arr[i];
      }
    }
  } catch (__e) {}
  return null;
}
function loadTenantTest2Fast_(tid) {
  if (String(tid || '').toLowerCase() !== 'test2') return null;
  return loadTenantTest2ListCache_() || loadTenantRowOnly_('test2');
}

function loadTenant_(tid, fresh) {
  
  tid = String(tid || '').toLowerCase();
  if (!TENANT_ID_RE.test(tid)) return null;
  var c = rawCache_(), key = 'ten:' + tid;
  if (!fresh) { var hit = c.get(key); if (hit) return JSON.parse(hit); }
  var t = (fresh ? listTenantsFromSheet_() : listTenants_()).filter(function (x) { return x.id === tid; })[0] || null;
  
if (t) c.put(key, JSON.stringify(t), TENANT_TTL);
  return t;
}
function invalidateTenant_(tid) { try { rawCache_().remove('ten:' + tid); } catch (e) { /* تجاهل */ } }

/** يكتب حقولًا في صف العميل (patch بمفاتيح RC) */
function updateTenant_(tid, patch) {
  
    var t = null;
  if (String(tid || '').toLowerCase() === 'test2' && TENANT_ && TENANT_.id === 'test2' && TENANT_.row) {
    t = TENANT_;
  } else if (String(tid || '').toLowerCase() === 'test2') {
    t = loadTenantTest2Fast_(tid) || loadTenant_(tid, true);
  } else t = loadTenant_(tid, true);
  
if (!t) throw new Error('العميل غير موجود: ' + tid);
  var sh = registrySheet_(), row = sh.getRange(t.row, 1, 1, REGISTRY_HEADERS.length).getValues()[0];
  
Object.keys(patch).forEach(function (k) { row[RC[k]] = patch[k]; });
  row[RC.UPDATED] = new Date();
    sh.getRange(t.row, 1, 1, REGISTRY_HEADERS.length).setValues([row]);
    invalidateTenant_(tid);
  if (tid === 'test2') { try { var __hit = rawCache_().get(TENANTS_LIST_CACHE_KEY); if (__hit) { var __arr = JSON.parse(__hit); if (Array.isArray(__arr)) { var __nt = parseTenantRow_(row, t.row), __f = false; for (var __i = 0; __i < __arr.length; __i++) { if (__arr[__i] && __arr[__i].id === __nt.id) { __arr[__i] = __nt; __f = true; break; } } if (!__f) __arr.push(__nt); rawCache_().put(TENANTS_LIST_CACHE_KEY, JSON.stringify(__arr), TENANTS_LIST_TTL); } } } catch (__e) { invalidateTenantsCache_(); } } else invalidateTenantsCache_();
  
var nt = parseTenantRow_(row, t.row);
  if (TENANT_ && TENANT_.id === tid) TENANT_ = nt;
  
return nt;
}

/* ───────── الدخول في سياق عميل ───────── */
function enterTenant_(t) {
  TENANT_ = t;
  CENTRAL_MEMO_ = null; CACHE_MEMO_ = null;
  return t;
}
function leaveTenant_() { TENANT_ = null; CENTRAL_MEMO_ = null; CACHE_MEMO_ = null; }
/** يشغّل fn داخل سياق عميل ثم يعيد السياق السابق */
function withTenant_(t, fn) {
  var prev = TENANT_;
  enterTenant_(t);
  try { return fn(t); } finally { if (prev) enterTenant_(prev); else leaveTenant_(); }
}
function currentTenantId_() { return TENANT_ ? TENANT_.id : null; }

/* ───────── الترخيص والحصة ───────── */
/** {ok, reason: 'suspended'|'expired'|'missing'} */
function licenseState_(t, now) {
  if (!t) return { ok: false, reason: 'missing' };
  if (t.status === TENANT_STATUS.SUSPENDED) return { ok: false, reason: 'suspended' };
  if (t.expiry != null && (now || Date.now()) > t.expiry) {
    var graceEnd = t.expiry + graceDays_() * 86400000;
    if ((now || Date.now()) <= graceEnd) return { ok: true, grace: true, graceEnd: graceEnd };
    return { ok: false, reason: 'expired' };
  }
  return { ok: true };
}
/** مهلة بعد انتهاء الاشتراك تعمل فيها البوتات عاديًا مع تنبيه يومي للمالك (PLATFORM_GRACE_DAYS، 3 افتراضيًا) */
var DEFAULT_GRACE_DAYS = 3, DEFAULT_TRIAL_DAYS = 14, DEFAULT_QUOTA = 3;
function graceDays_() { var g = Number(platformProp_('PLATFORM_GRACE_DAYS')); return g >= 0 && platformProp_('PLATFORM_GRACE_DAYS') !== '' && platformProp_('PLATFORM_GRACE_DAYS') != null ? g : DEFAULT_GRACE_DAYS; }

/* ── ملفات أنشأتها الخدمة فقط: لا يُقبل في «البرامج» ملف لم تنشئه الخدمة (لا ربط لملفات موجودة) ── */
function ownedFiles_() { try { return JSON.parse(prop_('OWNED_FILES') || '[]'); } catch (e) { return []; } }
function markOwnedFile_(id) { var l = ownedFiles_(); if (l.indexOf(id) < 0) { l.push(id); setProp_('OWNED_FILES', JSON.stringify(l)); } }
function isOwnedFile_(id) { return !tenantConf_().ownedFilesOnly || ownedFiles_().indexOf(id) >= 0; }
function programCount_() { return getPrograms_().length; }
/** نص خطأ إن بلغ العميل حصته من البرامج، وإلا '' */
function quotaError_(extra) {
  if (!TENANT_) return 'لا سياق عميل.';
  cache_().remove('progs');
  var used = programCount_(), q = TENANT_.quota;
  if (used + (extra || 1) > q) return '⛔ بلغت حصة اشتراكك من البرامج (' + used + ' من ' + q + '). لإضافة برامج أخرى تواصل مع مزوّد الخدمة لرفع الحصة.';
  return '';
}

/* ───────── أدوات ───────── */
function safeEqual_(a, b) {
  a = String(a == null ? '' : a); b = String(b == null ? '' : b);
  if (!a || !b || a.length !== b.length) return false;
  var d = 0; for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function randomHex_(n) {
  var s = '';
  while (s.length < n) s += Utilities.getUuid().replace(/-/g, '');
  return s.slice(0, n);
}
function newLicenseKey_() { var h = randomHex_(16).toUpperCase(); return 'ADAB-' + h.slice(0, 4) + '-' + h.slice(4, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16); }
function maskToken_(t) { return t ? '••••' + String(t).slice(-4) : ''; }
function dayKey_(ms) { return fmtTime(ms || Date.now()).slice(0, 10); }

/** عدّاد استهلاك تقريبي (ذاكرة مؤقتة، يُرحَّل يوميًا إلى ورقة «الاستهلاك» بالمشغّل) */
function countUsage_(kind) {
  try {
    var c = rawCache_(), k = 'use:' + TENANT_.id + ':' + dayKey_() + ':' + (kind || 'u');
    c.put(k, String(Number(c.get(k) || 0) + 1), 172800);
  } catch (e) { /* تجاهل */ }
}
function usageOf_(tid, day) {
  var c = rawCache_();
  return { updates: Number(c.get('use:' + tid + ':' + day + ':u') || 0), ticks: Number(c.get('use:' + tid + ':' + day + ':tick') || 0), app: Number(c.get('use:' + tid + ':' + day + ':app') || 0) };
}

/** عدّاد استهلاك يوم معيّن؛ آمن (أصفار عند أي خطأ) — يُستخدم في لوحة المنصة فقط */
function usageSafe_(tid, day) {
 try { return usageOf_(tid, day); } catch (e) { return { updates: 0, ticks: 0, app: 0 }; }
}

/** آخر يوم نشاط لكل عميل من ورقة «الاستهلاك» (قراءة واحدة مجمّعة للورقة)؛ {} عند أي خطأ أو غياب الورقة */
function usageLastDayByTenant_() {
 var out = {};
 try {
  var sh = registrySS_().getSheetByName(REGISTRY.USAGE);
  if (!sh || sh.getLastRow() < 2) return out;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  vals.forEach(function (r) {
   var tid = str_(r[1]).toLowerCase(), d = r[0] instanceof Date ? dayKey_(r[0].getTime()) : str_(r[0]);
   if (tid && d && (!out[tid] || d > out[tid])) out[tid] = d;
  });
 } catch (e) { /* تجاهل: تُستخدم الذاكرة المؤقتة فقط */ }
 return out;
}

// ===== Weekly.gs =====
/**
 * Weekly.gs — التقرير الأسبوعي للمالك والمشرفين عبر البوت الإداري (v6).
 * مشغّل مركزي واحد كل ساعة (weeklyReportTick في CentralTick.gs) يمر على كل العملاء ثم برامجهم المفتوحة؛ يرسل لكل برنامج مفعّل مرة واحدة في يومه وساعته (بتوقيت المشروع: القاهرة).
 * إنشاء المشغّل يحتاج صلاحية script.scriptapp: شغّل authorizeTriggers مرة واحدة من المحرر.
 */
var WEEKLY_HANDLER = 'weeklyReportTick';

function weeklyTriggers_() { return ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === WEEKLY_HANDLER; }); }

function ensureWeeklyTrigger_() {
  if (weeklyTriggers_().length) return false;
  ScriptApp.newTrigger(WEEKLY_HANDLER).timeBased().everyHours(1).create();
  return true;
}

/** (متعدد العملاء) المشغّل الساعي مشترك بين كل العملاء ويشغّل الحساب التلقائي أيضًا، فلا يحذفه إجراءُ عميل أبدًا */
function removeWeeklyTriggerIfUnused_(except) { return false; }

function toggleWeekly_(ctx, st) {
  var g = parseSettings(settingsValues_(st.pid, true)).general, on = weeklyOptions(g).on;
  aReset_(st); st.sec = 'WEEKLY';
  st.pending = { kind: 'weekly', value: on ? OPT.NO : OPT.YES, old: on ? OPT.YES : OPT.NO, back: 'S:WRP' };
  aSave_(ctx.uid, st);
  return confirm_(ctx, '🗓 التقرير الأسبوعي', on ? 'مفعّل' : 'موقوف', on ? 'موقوف' : 'مفعّل (كل ' + WEEK_DAYS_JS[weeklyOptions(g).day] + ' ' + weeklyOptions(g).hour + ':00)');
}

function commitWeekly_(ctx, st, pd) {
  st.sec = 'WEEKLY';
  if (pd.value === OPT.YES) {
    try { ensureWeeklyTrigger_(); } catch (e) {
      logError_(e, 'weekly trigger');
      return showSection_(ctx, st, 'WEEKLY', '⚠️ لم يُفعَّل: تعذر إنشاء المشغّل الزمني لأن المشروع يحتاج تفويضًا جديدًا.\nالحل (مرة واحدة): افتح مشروع البوت في المحرر ← اختر الدالة authorizeTriggers ← تشغيل ← وافق على الصلاحية، ثم اضغط «تفعيل» هنا مرة أخرى.');
    }
  }
  var sh = programSpreadsheet_(st.pid).getSheetByName(NAMES.SETTINGS);
  var values = sh.getDataRange().getValues();
  var plan = planEdit(values, 'GENERAL', null, 'weeklyReport', pd.value);
  var err = validatePlan(values, plan);
  if (err) return showSection_(ctx, st, 'WEEKLY', '⚠️ لم يُحفظ:\n' + err);
  writePlan_(sh, plan);
  invalidateProgram_(st.pid);
  logChange_(ctx.from, st.pid, SECTIONS.GENERAL, '-', fieldLabel('GENERAL', 'weeklyReport'), pd.old, pd.value);
  if (pd.value === OPT.NO) { try { removeWeeklyTriggerIfUnused_(st.pid); } catch (e) { logError_(e, 'weekly trigger remove'); } }
  return showSection_(ctx, st, 'WEEKLY', pd.value === OPT.YES ? '✅ فُعّل التقرير الأسبوعي.' : '✅ أُوقف التقرير الأسبوعي.');
}

/** نص التقرير لبرنامج (حساب في الذاكرة فقط، لا يكتب أوراقًا) */
function weeklyReportText_(pid, now) {
  var p = progOf_(pid);
  var out = calculateForSpreadsheet(programSpreadsheet_(pid), { write: false });
  try { putStandingSnapshot_(pid, out); } catch (e) { /* اختياري */ }
  var cfg = out.input.cfg, reg = {};
  if (out.input.registration) reg = readRegistration(out.input.registration, cfg.general, buildCorrections(out.input.corrections)).map;
  var wo = weeklyOptions(cfg.general);
  var rs = null;
  try { rs = reminderStats_(pid, (now || Date.now()) - 7 * DAY_MS, out.input.submissions); } catch (e) { logError_(e, 'reminder stats ' + pid); }
  return clip(buildWeeklyReport({ name: (p && p.name) || pid, res: out.res, submissions: out.input.submissions, reg: reg, cfg: cfg, now: now || Date.now(), low: wo.low, cap: 20, reminders: rs }));
}

function weeklyNow_(ctx, st, prog) {
  show_(ctx, '⏳ جارٍ إعداد التقرير…');
  try {
    send_(ctx.chat, weeklyReportText_(prog.id), [[{ text: SEC_TITLE.WEEKLY, callback_data: 'S:WRP' }, { text: '⚙️ القائمة', callback_data: 'M' }]]);
  } catch (e) {
    logError_(e, 'weekly now ' + prog.id);
    send_(ctx.chat, '⚠️ تعذر إعداد التقرير:\n' + e.message, [[{ text: '⚙️ القائمة', callback_data: 'M' }]]);
  }
}

/** من يستلم تقرير برنامج */
function weeklyRecipients_(pid, wo) {
  var ids = [];
  if (ownerId_()) ids.push(ownerId_());
  if (wo.admins) readAdmins_().forEach(function (a) { if (canAccess_({ owner: false, programs: a.programs }, pid) && ids.indexOf(a.id) < 0) ids.push(a.id); });
  return ids;
}

/**
 * مهام الساعة لعميل واحد (داخل سياقه): التقرير الأسبوعي ثم التذكيرات. يستدعيها المشغّل المركزي (CentralTick.gs).
 * t0 = بداية التشغيل المركزي (لميزانية الوقت المشتركة). لا يمسك قفل العميل طوال التشغيل.
 */
function tenantTick_(now, t0) {
  resetMemo_();
  BOT_ROLE = 'admin';
  t0 = t0 || Date.now(); now = now || t0;
  var d = new Date(now);
  var lock = tenantLock_();
  if (!lock.tryLock(5000)) return;
  var busy;
  try { busy = cache_().get('tick:run'); if (!busy) cache_().put('tick:run', String(t0), 360); } finally { lock.releaseLock(); }
  if (busy) return;
  try {
    var today = fmtTime(now).slice(0, 10);
    getPrograms_().forEach(function (p) {
      if (!p.open) return; // برنامج مغلق للتسليم: لا تقرير
      try {
        var prog = loadProgram_(p.id);
        if (!prog) return;
        var wo = weeklyOptions(prog.general);
        if (studentOptions(prog.general).showGrades && !getBig_('snap:' + p.id)) { try { standingSnapshot_(prog); } catch (x) { /* اختياري */ } }
        if (!wo.on || d.getDay() !== wo.day || d.getHours() < wo.hour) return;
        if (prop_('WR_SENT_' + p.id) === today) return;
        var text = weeklyReportText_(p.id, now), sent = 0;
        weeklyRecipients_(p.id, wo).forEach(function (id) { var r = tgAs_('admin', 'sendMessage', { chat_id: id, text: text, disable_web_page_preview: true }); if (r && r.ok) sent++; });
        if (sent) setProp_('WR_SENT_' + p.id, today);
      } catch (err) { logError_(err, 'weekly ' + p.id); }
    });
    try { remindersTick_(now, t0); } catch (err) { logError_(err, 'reminders tick'); }
  } finally { cache_().remove('tick:run'); }
}

// ===== Wizard.gs =====
/**
 * Wizard.gs — معالج الإعداد في البوت الإداري للعميل (/setup) قبل اكتمال الإعداد.
 * الخطوات: مفتاح الترخيص ← تأكيد المالك ← مجموعة المراجعة ← بريد مشاركة الملفات ← اسم أول برنامج ← المستويات ← تأكيد وإنشاء.
 * أول برنامج يُنشأ من قالب العميل داخل الخدمة (بلا سكربت) ويُشارك مع البريد المُدخل، ثم يكتمل الإعداد.
 * الويب هوك نفسه ضبطته الخدمة عند التفعيل في بوت المنصة (Platform.gs).
 */
var WZ_STEPS = ['license', 'owner', 'review', 'emails', 'pname', 'levels', 'confirm'];
var WZ_MAX_FAILS = 5;

function wzState_(uid) { var s = cache_().get('wz:' + uid); return s ? JSON.parse(s) : null; }
function wzSave_(uid, st) { cache_().put('wz:' + uid, JSON.stringify(st), 21600); }
function wzClear_(uid) { cache_().remove('wz:' + uid); }
function wzNav_() { return [[{ text: '✖ إلغاء المعالج', callback_data: 'WZ:X' }]]; }

function handleWizardUpdate_(u) {
  var q = u.callback_query, m = u.message, from = q ? q.from : (m && m.from);
  if (!from) return;
  if (m && (!m.chat || m.chat.type !== 'private')) return;
  var uid = String(from.id), chat = q ? q.message.chat.id : m.chat.id;
  var text = m && m.text ? String(m.text).trim() : '';
  var cmd = text.charAt(0) === '/' ? text.split(/\s+/)[0].replace(/@.*/, '').toLowerCase() : '';
  if (q) answerCallback_(q.id);
  if (cmd === '/myid') return send_(chat, 'معرّفك في تيليجرام: ' + uid);
  if (TENANT_.ownerId && TENANT_.ownerId !== uid) return send_(chat, '⛔ هذا النظام قيد الإعداد ومسجَّل لمالك آخر.\nمعرّفك: ' + uid);
  var st = wzState_(uid);
  if (cmd === '/setup' || cmd === '/start') {
    if (TENANT_.ownerId === uid && TENANT_.license && st && st.ok) return wzAsk_(chat, uid, st, st.step || 'review');
    st = { step: 'license' }; wzSave_(uid, st);
    return wzAsk_(chat, uid, st, 'license');
  }
  if (cmd === '/cancel' || (q && q.data === 'WZ:X')) { wzClear_(uid); return send_(chat, 'أُلغي المعالج. أرسل /setup للبدء من جديد.'); }
  if (!st) return send_(chat, '👋 أهلًا! هذا البوت الإداري لنظامك الجديد.\nأرسل /setup لبدء الإعداد (يحتاج مفتاح الترخيص الذي وصلك).');
  if (q) return wzCallback_(chat, uid, st, String(q.data || ''), from);
  if (!text) return send_(chat, 'أرسل نصًّا من فضلك.', wzNav_());
  return wzText_(chat, uid, st, text, from, m);
}

function wzAsk_(chat, uid, st, step) {
  st.step = step; wzSave_(uid, st);
  if (step === 'license') return send_(chat, '🛠 معالج الإعداد (١/٦)\nأرسل مفتاح الترخيص الذي وصلك من مزوّد الخدمة.\nمثال: ADAB-1A2B-3C4D-5E6F-7A8B', wzNav_());
  if (step === 'owner') return send_(chat, '🛠 (٢/٦) تأكيد المالك\nسيُسجَّل حسابك مالكًا لهذا النظام (كل الصلاحيات وإدارة المشرفين):\n• المعرّف: ' + uid + '\n\nتأكيد؟',
    [[{ text: '✅ نعم، أنا المالك', callback_data: 'WZ:OWN' }], wzNav_()[0]]);
  if (step === 'review') {
    var me = tgAs_('student', 'getMe', {}, true), un = me && me.ok ? '@' + me.result.username : 'بوت الطلاب';
    return send_(chat, '🛠 (٣/٦) مجموعة مراجعة التسليمات (اختياري)\nتصل إليها نسخة من كل تسليم مع أزرار الرفض.\n١) أضف ' + un + ' إلى المجموعة.\n٢) أرسل هنا معرّف المجموعة (رقم سالب، مثل -1001234567890).\nأو تخطَّ الآن واربطها لاحقًا من داخل المجموعة بالأمر /linkreview',
      [[{ text: '⏭ تخطي', callback_data: 'WZ:SKIPR' }], wzNav_()[0]]);
  }
  if (step === 'emails') return send_(chat, '🛠 (٤/٦) بريد Google لمشاركة الملفات\nأرسل بريدًا أو أكثر (مفصولة بفاصلة) لتُشارك معه ملفات البرامج للتعديل (بيانات فقط).\nمثال: admin@gmail.com, team@gmail.com',
    [[{ text: '⏭ تخطي', callback_data: 'WZ:SKIPE' }], wzNav_()[0]]);
  if (step === 'pname') return send_(chat, '🛠 (٥/٦) أول برنامج\nأرسل اسم البرنامج كما يظهر للطلاب (من 2 إلى 60 حرفًا).\nمثال: الدورة الأولى', wzNav_());
  if (step === 'levels') return send_(chat, '🛠 (٦/٦) المستويات (اختياري)\nأرسل أسماء المستويات مفصولة بفاصلة، أو اضغط «بلا مستويات».\nمثال: المستوى الأول، المستوى الثاني',
    [[{ text: '➖ بلا مستويات', callback_data: 'WZ:NOLV' }], wzNav_()[0]]);
  var conf = tenantConf_();
  return send_(chat, '📋 مراجعة قبل الإنشاء:\n• المالك: ' + uid + '\n• مجموعة المراجعة: ' + (st.review || '— (لاحقًا)') + '\n• المشاركة مع: ' + ((st.emails || []).join('، ') || '—') +
    '\n• البرنامج: «' + st.pname + '»\n• المستويات: ' + ((st.levels || []).join('، ') || 'بلا مستويات') + '\n• الفعاليات (من القالب): ' + conf.template.activities.join('، ') +
    '\n\nسيُنشأ ملف درجات جديد للبرنامج (مغلق للتسليم حتى تفتحه).',
    [[{ text: '✅ إنشاء', callback_data: 'WZ:GO' }], wzNav_()[0]]);
}

function wzCallback_(chat, uid, st, data, from) {
  if (data === 'WZ:OWN' && st.step === 'owner' && st.ok) {
    updateTenant_(TENANT_.id, { OWNER: uid });
    return wzAsk_(chat, uid, st, 'review');
  }
  if (data === 'WZ:SKIPR' && st.step === 'review') { st.review = ''; return wzAsk_(chat, uid, st, 'emails'); }
  if (data === 'WZ:SKIPE' && st.step === 'emails') { st.emails = []; return wzAsk_(chat, uid, st, 'pname'); }
  if (data === 'WZ:NOLV' && st.step === 'levels') { st.levels = []; return wzAsk_(chat, uid, st, 'confirm'); }
  if (data === 'WZ:GO' && st.step === 'confirm') return wzFinish_(chat, uid, st, from);
  return send_(chat, 'انتهت هذه الخطوة. أرسل /setup للمتابعة.');
}

function wzText_(chat, uid, st, text, from, m) {
  if (st.step === 'license') {
    var fk = 'wzfail:' + uid, fails = Number(cache_().get(fk) || 0);
    if (fails >= WZ_MAX_FAILS) return send_(chat, '⛔ محاولات كثيرة. حاول بعد ساعة.');
    try { tgAs_('admin', 'deleteMessage', { chat_id: chat, message_id: m.message_id }, true); } catch (e) { /* تجاهل */ }
    var key = latinDigits_(text).toUpperCase().replace(/\s+/g, '');
    if (!safeEqual_(key, TENANT_.license)) { cache_().put(fk, String(fails + 1), 3600); return send_(chat, '⚠️ المفتاح غير صحيح. تأكد منه وأعد الإرسال.', wzNav_()); }
    st.ok = true;
    return wzAsk_(chat, uid, st, 'owner');
  }
  if (!st.ok) return wzAsk_(chat, uid, st, 'license');
  if (st.step === 'review') {
    var id = latinDigits_(text).replace(/[\s\u200B-\u200F\u061C]/g, '');
    if (!/^-\d{5,}$/.test(id)) return send_(chat, '⚠️ معرّف المجموعة رقم يبدأ بعلامة السالب، مثل -1001234567890.', [[{ text: '⏭ تخطي', callback_data: 'WZ:SKIPR' }], wzNav_()[0]]);
    var r = tgAs_('student', 'getChat', { chat_id: id }, true);
    if (!r.ok) return send_(chat, '⚠️ بوت الطلاب لا يجد هذه المجموعة (' + (r.description || '') + '). أضفه إليها أولًا ثم أعد الإرسال.', [[{ text: '⏭ تخطي', callback_data: 'WZ:SKIPR' }], wzNav_()[0]]);
    st.review = id; st.reviewTitle = r.result && r.result.title || '';
    saveTenantConf_({ reviewChatId: id });
    return wzAsk_(chat, uid, st, 'emails');
  }
  if (st.step === 'emails') {
    var list = text.split(/[\s,،;]+/).map(normalizeEmail).filter(String);
    var bad = list.filter(function (e) { return !isValidEmail(e); });
    if (!list.length || bad.length) return send_(chat, '⚠️ بريد غير صالح: ' + (bad.join('، ') || text), [[{ text: '⏭ تخطي', callback_data: 'WZ:SKIPE' }], wzNav_()[0]]);
    st.emails = list.slice(0, 10);
    return wzAsk_(chat, uid, st, 'pname');
  }
  if (st.step === 'pname') {
    var name = str_(text).replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 60) return send_(chat, '⚠️ اكتب اسمًا من 2 إلى 60 حرفًا.', wzNav_());
    st.pname = name;
    return wzAsk_(chat, uid, st, 'levels');
  }
  if (st.step === 'levels') {
    var lv = text.split(/[,،\n]+/).map(function (s) { return str_(s).replace(/\s+/g, ' '); }).filter(String);
    if (!lv.length || lv.length > 8 || lv.some(function (x) { return x.length > 40; })) return send_(chat, '⚠️ من 1 إلى 8 مستويات، كل اسم حتى 40 حرفًا.', [[{ text: '➖ بلا مستويات', callback_data: 'WZ:NOLV' }], wzNav_()[0]]);
    st.levels = lv;
    return wzAsk_(chat, uid, st, 'confirm');
  }
  return wzAsk_(chat, uid, st, st.step);
}

function wzFinish_(chat, uid, st, from) {
  var q = quotaError_();
  if (q) return send_(chat, q);
  send_(chat, '⏳ جارٍ إنشاء ملف البرنامج…');
  if (st.emails && st.emails.length) updateTenant_(TENANT_.id, { EDITORS: st.emails.join(', ') });
  try { shareWithTenant_(TENANT_.controlSsId); } catch (e) { /* تجاهل */ }
  var pid = 'p1', n = 1;
  while (getPrograms_().some(function (p) { return p.id === pid; })) pid = 'p' + (++n);
  var made;
  try { made = createProgramFromTemplate_({ name: st.pname, levels: st.levels || [], reviewChatId: st.review || '' }); }
  catch (e) { logError_(e, 'wizard create'); return send_(chat, '⚠️ تعذر إنشاء الملف: ' + e.message + '\nاضغط «✅ إنشاء» مرة أخرى.', [[{ text: '✅ إنشاء', callback_data: 'WZ:GO' }]]); }
  var reg = registerProgram_(pid, st.pname, made.url, false, 'أُنشئ بمعالج الإعداد');
  if (reg.error) return send_(chat, '⚠️ ' + reg.error);
  updateTenant_(TENANT_.id, { SETUP: SETUP_DONE });
  logChange_(from, pid, 'البرامج', pid, 'إنشاء برنامج (المعالج)', '', made.url);
  wzClear_(uid);
  return send_(chat, '🎉 اكتمل الإعداد!\n• البرنامج: «' + st.pname + '» (' + pid + ') ⚪️ مغلق للتسليم\n• الملف: ' + made.url +
    (made.shared.length ? '\n• شُورك مع: ' + made.shared.join('، ') : '') +
    '\n\nالخطوات التالية:\n١) ⚙️ إدارة البرنامج ← الإعدادات العامة: الصق رابط ملف ردود استمارة التسجيل (وشاركه مع ' + serviceEmail_() + ').\n٢) راجع الفعاليات ودرجاتها.\n٣) افتح التسليم بزر «🔓 فتح التسليم».' +
    (st.review ? '' : '\n٤) اربط مجموعة المراجعة: أرسل داخلها /linkreview ' + pid),
    [[{ text: '⚙️ إدارة «' + st.pname + '»', callback_data: 'P:' + pid }], [{ text: '🗂 البرامج', callback_data: 'L' }]]);
}