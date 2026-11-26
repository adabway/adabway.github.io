
// ===== MonthlyReport.gs =====
/**
 * MonthlyReport.gs — إضافة «📊 التقرير الشهري» (monthlyReport). تعمل فقط إن كانت isModuleActive_('monthlyReport').
 *
 * متى: في المشغّل الساعي، يوم 1 من كل شهر بعد الساعة MR.HOUR (9 صباحًا بتوقيت القاهرة) عن الشهر السابق كاملًا.
 *   برنامجًا برنامجًا؛ إن قارب وقت المشغّل النفاد يُحفظ ما أُنجز (حالة run) ويُجدول استئناف ويُكمل في التشغيل التالي.
 * ماذا: أرقام مجمّعة فقط (لا أسماء): المسجلون، النشطون ونسبة الالتزام، التسليمات المقبولة والمرفوضة، الجدد، المنقطعون،
 *   المجتازون وقت الحساب، التذكيرات المرسلة، منشورات الورد، أسئلة الطلاب.
 * أين: ورقة «التقرير الشهري» في ملف كل برنامج (صف لكل شهر) + «الملخص الشهري» في ملف التحكم (صف لكل برنامج لكل شهر).
 *   اختياري لكل عميل (موقوف افتراضيًا): ورقة «تفاصيل YYYY-MM» بالأسماء في ملف البرنامج، ويُحتفظ بآخر MR.KEEP_DETAILS أشهر.
 * لمن: مالك العميل، والمشرفون الذين يسمح لهم المالك صراحةً (/report admins؛ الافتراضي لا أحد)، كلٌّ لبرامجه فقط.
 * عند الطلب: /report [YYYY-MM] [البرنامج] للمالك والمشرفين المسموح لهم.
 */
var MR = { HOUR: 9, SHEET: 'التقرير الشهري', SUMMARY: 'الملخص الشهري', DETAIL_PREFIX: 'تفاصيل ', KEEP_DETAILS: 3 };
var MR_FIELDS = [['registered', 'المسجلون'], ['active', 'النشطون'], ['commit', 'نسبة الالتزام %'], ['accepted', 'التسليمات المقبولة'], ['rejected', 'المرفوضة'],
  ['fresh', 'الجدد'], ['dropped', 'المنقطعون'], ['passers', 'المجتازون (وقت الحساب)'], ['passPct', 'نسبة الاجتياز %'], ['reminders', 'التذكيرات المرسلة'],
  ['wird', 'منشورات الورد'], ['questions', 'أسئلة الطلاب']];
var MR_HEADERS = ['الشهر'].concat(MR_FIELDS.map(function (f) { return f[1]; }), ['وقت الحساب']);
var MR_SUM_HEADERS = ['الشهر', 'البرنامج', 'اسم البرنامج'].concat(MR_FIELDS.map(function (f) { return f[1]; }), ['وقت الحساب']);
var MR_DETAIL_HEADERS = ['الاسم', 'البريد', 'تسليمات الشهر', 'كل التسليمات', 'الدرجة النهائية', 'مجتاز'];

function mrState_() { var s = moduleState_('monthlyReport'); s.admins = s.admins || []; return s; }
function monthKey_(ms) { return dayKey_(ms).slice(0, 7); }
function monthRange_(key) { var y = +key.slice(0, 4), m = +key.slice(5, 7); return { from: new Date(y, m - 1, 1).getTime(), to: new Date(y, m, 1).getTime() }; }
function prevMonthKey_(now) { var d = new Date(now); return monthKey_(new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime()); }
/** الخلية قد تصير تاريخًا في Sheets: نعيدها «YYYY-MM» */
function monthCell_(v) { return v instanceof Date || typeof v === 'number' ? monthKey_(dateValue_(v)) : str_(v).slice(0, 7); }

/* ───────── الحساب (خالص قدر الإمكان) ───────── */
/** أرقام الشهر من ورقة التسليمات: {accepted, rejected, active, fresh, dropped, perEmailMonth, perEmailAll} */
function monthSubStats(values, from, to) {
  var o = { accepted: 0, rejected: 0, active: 0, fresh: 0, dropped: 0, perEmailMonth: {}, perEmailAll: {} };
  if (!values || values.length < 2) return o;
  var ix = subIndex_(values[0]), seen = {}, first = {}, before = {};
  values.slice(1).forEach(function (r, k) {
    var id = str_(r[ix['معرف التسليم']]) || 'row' + k, st = str_(r[ix['الحالة']]), t = dateValue_(r[ix['الطابع الزمني']]);
    if (seen[id]) return; seen[id] = 1;
    if (t == null || t === undefined || t >= to) return;
    if (st === SUB_ST.DEL) return;
    if (SUB_REJECTED.indexOf(st) >= 0) { if (t >= from) o.rejected++; return; }
    var e = normalizeEmail(r[ix['البريد']]);
    if (!e) return;
    o.perEmailAll[e] = (o.perEmailAll[e] || 0) + 1;
    if (first[e] == null || t < first[e]) first[e] = t;
    if (t < from) { before[e] = 1; return; }
    o.accepted++; o.perEmailMonth[e] = (o.perEmailMonth[e] || 0) + 1;
  });
  var act = Object.keys(o.perEmailMonth);
  o.active = act.length;
  o.fresh = act.filter(function (e) { return first[e] >= from; }).length;
  o.dropped = Object.keys(before).filter(function (e) { return !o.perEmailMonth[e]; }).length;
  return o;
}

var MR_EVENTS_ = null;
function mrEvents_() { if (!MR_EVENTS_) { try { MR_EVENTS_ = readEvents_({}); } catch (e) { MR_EVENTS_ = []; } } return MR_EVENTS_; }

/** أرقام برنامج لشهر: {m: {…MR_FIELDS}, detail: [[…]]} */
function monthlyMetrics_(pid, key, withDetail) {
  var rg = monthRange_(key), ss = programSpreadsheet_(pid);
  var out = calculateForSpreadsheet(ss, { write: false }), cfg = out.input.cfg, reg = {};
  if (out.input.registration) reg = readRegistration(out.input.registration, cfg.general, buildCorrections(out.input.corrections)).map;
  var ms = monthSubStats(out.input.submissions, rg.from, rg.to), regN = Object.keys(reg).length || out.res.stats.registered || 0;
  var pct = function (a, b) { return b ? Math.round(a * 1000 / b) / 10 : 0; };
  var inRange = function (t) { var x = t instanceof Date ? t.getTime() : dateValue_(t); return x >= rg.from && x < rg.to; };
  var rem = 0;
  try { rem = remValues_(REMIND_LOG).slice(1).filter(function (r) { return str_(r[1]) === pid && str_(r[6]) === RST.SENT && inRange(r[0]); }).length; } catch (e) { rem = 0; }
  var evs = mrEvents_().filter(function (e) { return e.pid === pid && inRange(e.at); });
  var m = {
    registered: regN, active: ms.active, commit: pct(ms.active, regN), accepted: ms.accepted, rejected: ms.rejected, fresh: ms.fresh, dropped: ms.dropped,
    passers: out.res.passers.length, passPct: pct(out.res.passers.length, regN), reminders: rem,
    wird: evs.filter(function (e) { return e.type === EVENT_TYPES.WIRD_POSTED; }).length,
    questions: evs.filter(function (e) { return e.type === EVENT_TYPES.QA_ASKED; }).length
  };
  var detail = null;
  if (withDetail) {
    var byE = {}; out.res.students.forEach(function (s) { byE[s.email] = s; });
    var emails = Object.keys(reg).length ? Object.keys(reg) : Object.keys(byE);
    detail = emails.map(function (e) { var s = byE[e] || {}; return [str_((reg[e] || {}).name || s.name), e, ms.perEmailMonth[e] || 0, ms.perEmailAll[e] || 0, s.final == null ? '' : s.final, s.passed ? 'نعم' : 'لا']; })
      .sort(function (a, b) { return b[2] - a[2] || String(a[0]).localeCompare(String(b[0]), 'ar'); });
  }
  return { m: m, detail: detail, hasActivity: ms.accepted + ms.rejected > 0 };
}

/* ───────── الكتابة ───────── */
function mrSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (sh && sh.getLastRow() >= 1 && str_(sh.getRange(1, 1).getValue()) !== headers[0]) { name = name + ' (الخدمة)'; sh = ss.getSheetByName(name); } // لا نكتب فوق ورقة كتبها إنسان
  if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, headers.length).setValues([headers]); try { sh.setFrozenRows(1); sh.setRightToLeft(true); } catch (e) { /* تجاهل */ } }
  return sh;
}
/** يكتب صف الشهر في ورقة البرنامج ويعيد صف الشهر السابق (للمقارنة) أو null */
function writeProgramMonth_(pid, key, m) {
  var sh = mrSheet_(programSpreadsheet_(pid), MR.SHEET, MR_HEADERS), n = sh.getLastRow();
  var vals = n > 1 ? sh.getRange(2, 1, n - 1, MR_HEADERS.length).getValues() : [], prevKey = prevMonthKey_(monthRange_(key).from + DAY_MS), prev = null, at = -1;
  vals.forEach(function (r, i) { var k = monthCell_(r[0]); if (k === key) at = i; if (k === prevKey) prev = r; });
  var row = [key].concat(MR_FIELDS.map(function (f) { return m[f[0]]; }), [new Date()]);
  if (at >= 0) sh.getRange(at + 2, 1, 1, row.length).setValues([row]); else sh.getRange(n + 1, 1, 1, row.length).setValues([row]);
  return prev ? MR_FIELDS.reduce(function (o, f, i) { o[f[0]] = num_(prev[i + 1]); return o; }, {}) : null;
}
function readProgramMonth_(pid, key) {
  var sh = programSpreadsheet_(pid).getSheetByName(MR.SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  var r = sh.getRange(2, 1, sh.getLastRow() - 1, MR_HEADERS.length).getValues().filter(function (x) { return monthCell_(x[0]) === key; })[0];
  return r ? MR_FIELDS.reduce(function (o, f, i) { o[f[0]] = num_(r[i + 1]); return o; }, {}) : null;
}
function writeSummaryMonth_(key, list) {
  var sh = mrSheet_(central_(), MR.SUMMARY, MR_SUM_HEADERS), n = sh.getLastRow();
  var vals = n > 1 ? sh.getRange(2, 1, n - 1, MR_SUM_HEADERS.length).getValues() : [];
  list.forEach(function (x) {
    var row = [key, x.pid, x.name].concat(MR_FIELDS.map(function (f) { return x.m[f[0]]; }), [new Date()]), at = -1;
    vals.forEach(function (r, i) { if (monthCell_(r[0]) === key && str_(r[1]) === x.pid) at = i; });
    if (at >= 0) { sh.getRange(at + 2, 1, 1, row.length).setValues([row]); vals[at] = row; }
    else { sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]); vals.push(row); }
  });
}
function writeDetail_(pid, key, detail) {
  var ss = programSpreadsheet_(pid), name = MR.DETAIL_PREFIX + key, sh = ss.getSheetByName(name);
  if (sh) ss.deleteSheet(sh);
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, MR_DETAIL_HEADERS.length).setValues([MR_DETAIL_HEADERS]);
  if (detail.length) sh.getRange(2, 1, detail.length, MR_DETAIL_HEADERS.length).setValues(detail);
  var old = ss.getSheets().map(function (x) { return x.getName(); }).filter(function (nm) { return /^تفاصيل \d{4}-\d{2}$/.test(nm); }).sort();
  old.slice(0, Math.max(0, old.length - MR.KEEP_DETAILS)).forEach(function (nm) { ss.deleteSheet(ss.getSheetByName(nm)); });
}

/* ───────── النص ───────── */
function mrDelta_(cur, prev) {
  if (prev == null) return '';
  if (!prev) return cur ? ' ▲' : '';
  var d = Math.round((cur - prev) * 100 / prev);
  return d === 0 ? ' (=)' : d > 0 ? ' ▲ ' + d + '%' : ' ▼ ' + (-d) + '%';
}
function monthlyText_(key, list, partial) {
  var L = ['📊 التقرير الشهري — ' + key + (partial ? ' (حتى اليوم، لم يُحفظ)' : '')];
  list.forEach(function (x) {
    var m = x.m, p = x.prev || {}, has = !!x.prev;
    L.push('', '«' + x.name + '» (' + x.pid + ')',
      '👥 المسجلون ' + m.registered + ' | 📤 النشطون ' + m.active + ' (' + m.commit + '%)' + (has ? mrDelta_(m.active, p.active) : ''),
      '📥 التسليمات المقبولة ' + m.accepted + (has ? mrDelta_(m.accepted, p.accepted) : '') + ' | ❌ المرفوضة ' + m.rejected,
      '🆕 جدد ' + m.fresh + ' | 💤 منقطعون ' + m.dropped + (has ? mrDelta_(m.dropped, p.dropped) : ''),
      '✅ المجتازون ' + m.passers + ' (' + m.passPct + '%)' + (has ? ' — كانوا ' + p.passers : ''),
      '🔔 تذكيرات ' + m.reminders + ' | 📖 ورد ' + m.wird + ' | ❓ أسئلة ' + m.questions);
  });
  if (!list.length) L.push('', 'لا برامج بنشاط في هذا الشهر.');
  if (!partial) L.push('', '📄 الأرقام في ورقة «' + MR.SHEET + '» بملف كل برنامج، و«' + MR.SUMMARY + '» في ملف التحكم.');
  return clip(L.join('\n'));
}

/** المستلمون: المالك (كل البرامج) + المشرفون المسموح لهم (برامجهم فقط) */
function mrRecipients_(st) {
  var out = [];
  if (ownerId_()) out.push({ id: ownerId_(), adm: { owner: true, programs: [] } });
  if (st.admins.length) readAdmins_().forEach(function (a) { if (st.admins.indexOf(a.id) >= 0 && a.id !== ownerId_()) out.push({ id: a.id, adm: { owner: false, programs: a.programs } }); });
  return out;
}

/* ───────── المشغّل ───────── */
function monthlyTick_(now, budgetEnd) {
  MR_EVENTS_ = null;
  var st = mrState_(), d = new Date(now), key = prevMonthKey_(now);
  if (!st.init) { st.init = dayKey_(now); if (!(d.getDate() === 1 && d.getHours() < MR.HOUR)) st.last = key; saveModuleState_('monthlyReport', st); return 'init'; }
  if (st.last >= key) return '';
  if (d.getDate() === 1 && d.getHours() < MR.HOUR) return '';
  var run = st.run && st.run.month === key ? st.run : { month: key, done: [], list: [] };
  var progs = getPrograms_();
  for (var i = 0; i < progs.length; i++) {
    var p = progs[i];
    if (run.done.indexOf(p.id) >= 0) continue;
    if (Date.now() > budgetEnd - 30000) { st.run = run; saveModuleState_('monthlyReport', st); scheduleContinuation_(); return 'partial'; }
    try {
      var r = monthlyMetrics_(p.id, key, !!st.details);
      if (p.open || r.hasActivity) {
        var prev = writeProgramMonth_(p.id, key, r.m);
        if (r.detail) writeDetail_(p.id, key, r.detail);
        run.list.push({ pid: p.id, name: p.name || p.id, m: r.m, prev: prev });
      }
    } catch (e) { logError_(e, 'monthly ' + p.id); }
    run.done.push(p.id);
    st.run = run; saveModuleState_('monthlyReport', st);
  }
  try { writeSummaryMonth_(key, run.list); } catch (e) { logError_(e, 'monthly summary'); }
  mrRecipients_(st).forEach(function (rc) {
    var mine = run.list.filter(function (x) { return canAccess_(rc.adm, x.pid); });
    if (!mine.length && !rc.adm.owner) return;
    try { tgAs_('admin', 'sendMessage', { chat_id: rc.id, text: monthlyText_(key, mine), disable_web_page_preview: true }, true); } catch (e) { logError_(e, 'monthly send'); }
  });
  emitEvent_(EVENT_TYPES.MONTHLY_REPORT, '', { month: key, programs: run.list.length }, 'tick');
  st.last = key; delete st.run; saveModuleState_('monthlyReport', st);
  return 'sent';
}

/* ───────── /report ───────── */
function mrBack_() { return [[{ text: '🧩 الوحدات', callback_data: 'MOD:' }, { text: '🏠 القائمة', callback_data: 'L' }]]; }
var REPORT_HELP = 'التقرير الشهري:\n/report — الشهر الجاري حتى اليوم\n/report 2026-10 — شهر محدد\n/report 2026-10 p1 — برنامج واحد\n' +
  'للمالك: /report admins (من يستلم التقرير من المشرفين) · /report details on|off (أوراق تفاصيل بالأسماء، موقوفة افتراضيًا)';

function reportCommand_(ctx, text) {
  var st = mrState_(), a = str_(text).replace(/^\/report(@\S+)?\s*/i, '').split(/\s+/).filter(String), back = mrBack_();
  if (!ctx.adm.owner && st.admins.indexOf(ctx.uid) < 0) return show_(ctx, '⛔ التقرير الشهري للمالك ومن يسمح لهم المالك من المشرفين.', back);
  if (a[0] === 'admins' || a[0] === 'details') {
    if (!ctx.adm.owner) return show_(ctx, '⛔ للمالك فقط.', back);
    if (a[0] === 'admins') return showReportAdmins_(ctx, st);
    var on = /^(on|نعم|yes)$/i.test(a[1] || '');
    if (!a[1]) return show_(ctx, 'أوراق التفاصيل بالأسماء: ' + (st.details ? '🟢 مفعّلة' : '⚪️ موقوفة') + '\n/report details on|off', back);
    st.details = on; saveModuleState_('monthlyReport', st);
    logChange_(ctx.from, '-', 'الوحدات', 'monthlyReport', 'أوراق التفاصيل', '', on ? 'مفعّلة' : 'موقوفة');
    return show_(ctx, on ? '✅ سيُكتب مع كل تقرير شهري ورقة «تفاصيل YYYY-MM» بالأسماء في ملف كل برنامج (آخر ' + MR.KEEP_DETAILS + ' أشهر فقط).' : '✅ أُوقفت أوراق التفاصيل بالأسماء (الأوراق السابقة باقية).', back);
  }
  if (a[0] === 'help') return show_(ctx, REPORT_HELP, back);
  var key = /^\d{4}-\d{2}$/.test(latinDigits_(a[0] || '')) ? latinDigits_(a.shift()) : monthKey_(Date.now()), only = a[0] || '';
  var partial = key >= monthKey_(Date.now());
  var progs = getPrograms_().filter(function (p) { return canAccess_(ctx.adm, p.id) && (!only || p.id === only); });
  if (!progs.length) return show_(ctx, '⚠️ لا برامج' + (only ? ' بالمعرّف «' + only + '»' : '') + '.\n\n' + REPORT_HELP, back);
  MR_EVENTS_ = null;
  var prevKey = prevMonthKey_(monthRange_(key).from + DAY_MS), list = [];
  progs.forEach(function (p) {
    try {
      var r = monthlyMetrics_(p.id, key, false), prev = readProgramMonth_(p.id, prevKey);
      if (!partial && ctx.adm.owner) writeProgramMonth_(p.id, key, r.m);
      list.push({ pid: p.id, name: p.name || p.id, m: r.m, prev: prev });
    } catch (e) { logError_(e, 'report ' + p.id); list.push({ pid: p.id, name: (p.name || p.id) + ' ⚠️ ' + e.message, m: MR_FIELDS.reduce(function (o, f) { o[f[0]] = 0; return o; }, {}) }); }
  });
  return show_(ctx, monthlyText_(key, list, partial), back);
}

function showReportAdmins_(ctx, st, notice) {
  var admins = readAdmins_();
  var kb = admins.map(function (a) { var on = st.admins.indexOf(a.id) >= 0; return [{ text: (on ? '✅ ' : '⬜️ ') + (a.name || a.id), callback_data: 'MX:monthlyReport:ra:' + a.id }]; });
  kb = kb.concat(mrBack_());
  return show_(ctx, (notice ? notice + '\n\n' : '') + '📊 من يستلم التقرير الشهري ويستعمل /report من المشرفين؟ (المالك دائمًا)\nكلٌّ يرى برامجه فقط. اضغط للتبديل:' + (admins.length ? '' : '\n(لا مشرفين بعد)'), kb);
}

function reportCallback_(ctx, data) {
  if (!ctx.adm.owner) return show_(ctx, '⛔ للمالك فقط.', mrBack_());
  var m = data.match(/^ra:(\d+)$/);
  if (!m) return undefined;
  var st = mrState_(), i = st.admins.indexOf(m[1]);
  if (i >= 0) st.admins.splice(i, 1); else if (readAdmins_().some(function (a) { return a.id === m[1]; })) st.admins.push(m[1]);
  saveModuleState_('monthlyReport', st);
  logChange_(ctx.from, '-', 'الوحدات', 'monthlyReport', 'مستلم التقرير ' + m[1], i >= 0 ? 'نعم' : 'لا', i >= 0 ? 'لا' : 'نعم');
  return showReportAdmins_(ctx, st, '✅ حُفظ.');
}

// ===== Output.gs =====
/**
 * Output.gs — كتابة أوراق الإخراج قيمًا (بلا معادلات) بتنسيق مرتب من اليمين لليسار.
 * الأوراق التي أنشأها السكربت تُعلَّم ببيانات وصفية؛ وإن وُجدت ورقة بالاسم نفسه لم ينشئها السكربت
 * (مثل ورقة Grades اليدوية) فتُحفظ نسخة منها بإعادة تسميتها ولا تُحذف.
 */
var GEN_KEY = 'adab_generated';
var COLORS = { header: '#1f4e5f', headerText: '#ffffff', basic: '#2e6f8e', extra: '#3d7d4f', group: '#6b4e8e', total: '#8a5a12', bad: '#fde2e1', good: '#e3f4e6' };

function isGenerated_(sh) {
  return sh.getDeveloperMetadata().some(function (m) { return m.getKey() === GEN_KEY; });
}

function prepareSheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (sh && !isGenerated_(sh) && sh.getLastRow() === 0) sh.addDeveloperMetadata(GEN_KEY, 'true'); // ورقة يدوية فارغة: تُستعمل كما هي
  if (sh && !isGenerated_(sh)) {
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH-mm');
    sh.setName(name + ' (يدوي قديم ' + stamp + ')');
    sh = null;
  }
  if (!sh) { sh = ss.insertSheet(name); sh.addDeveloperMetadata(GEN_KEY, 'true'); }
  sh.getBandings().forEach(function (b) { b.remove(); });
  sh.clear();
  sh.clearConditionalFormatRules();
  sh.setRightToLeft(true);
  return sh;
}

function writeTable_(ss, name, table, opts) {
  opts = opts || {};
  var sh = prepareSheet_(ss, name);
  var data = [table.header].concat(table.rows.length ? table.rows : (opts.emptyText ? [[opts.emptyText].concat(table.header.slice(1).map(function () { return ''; }))] : []));
  var w = table.header.length;
  if (sh.getMaxColumns() < w) sh.insertColumnsAfter(sh.getMaxColumns(), w - sh.getMaxColumns());
  if (sh.getMaxRows() < data.length + 1) sh.insertRowsAfter(sh.getMaxRows(), data.length + 1 - sh.getMaxRows());
  var range = sh.getRange(1, 1, data.length, w);
  range.setValues(data).setFontFamily('Arial').setVerticalAlignment('middle').setHorizontalAlignment('center');
  sh.getRange(1, 1, 1, w).setFontWeight('bold').setBackground(COLORS.header).setFontColor(COLORS.headerText).setWrap(true);
  sh.setFrozenRows(1);
  if (data.length > 1) range.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);
  sh.getRange(1, 1, 1, w).setBackground(COLORS.header);
  sh.autoResizeColumns(1, w);
  for (var c = 1; c <= w; c++) if (sh.getColumnWidth(c) < 70) sh.setColumnWidth(c, 70);
  sh.setRowHeight(1, 42);
  return sh;
}

function writeGradesSheet_(ss, name, table, items) {
  var sh = writeTable_(ss, name, table, {});
  var w = table.header.length, n = table.rows.length;
  sh.setFrozenColumns(2);
  // تلوين رؤوس الأعمدة حسب النوع
  items.forEach(function (it, i) {
    var color = it.kind === 'group' ? COLORS.group : (it.group ? '#7a8a96' : (it.type === 'extra' ? COLORS.extra : COLORS.basic));
    sh.getRange(1, 4 + i).setBackground(color);
  });
  var lc = table.levelCols || 0;
  if (lc) sh.getRange(1, 4 + items.length, 1, lc).setBackground(COLORS.group);
  sh.getRange(1, 4 + items.length + lc, 1, 4).setBackground(COLORS.total);
  if (!n) return;
  var resultCol = w - 1, notesCol = w;
  sh.getRange(2, notesCol, n, 1).setHorizontalAlignment('right').setWrap(true);
  sh.setColumnWidth(notesCol, 320);
  sh.getRange(2, 1, n, 2).setHorizontalAlignment('right');
  var rRange = sh.getRange(2, resultCol, n, 1);
  var lvRanges = [];
  for (var k = 1; k < lc; k += 2) lvRanges.push(sh.getRange(2, 4 + items.length + k, n, 1));
  if (lvRanges.length) lvRanges.push(rRange); else lvRanges = [rRange];
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('مجتاز').setBackground(COLORS.good).setRanges(lvRanges).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('لم يجتز').setBackground(COLORS.bad).setRanges(lvRanges).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('ناجح').setBackground(COLORS.good).setRanges([rRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=REGEXMATCH($' + columnLetter_(notesCol) + '2,"غير موجود في التسجيل")')
      .setFontColor('#b00020').setRanges([sh.getRange(2, 1, n, 1)]).build()
  ]);
  sh.getRange(2, 4, n, items.length + lc + 3).setNumberFormat('0.##');
}

/** ورقة «بريد غير مطابق»: تلوين عمود الحالة (أخضر: حُسبت، أحمر: يدوي، أصفر: أكثر من طالب) */
function writeUnmatchedSheet_(ss, name, table) {
  var sh = writeTable_(ss, name, table, { emptyText: 'لا يوجد بريد غير مطابق 👍' });
  var n = table.rows.length, w = table.header.length;
  if (!n) return sh;
  var col = function (h) { return table.header.indexOf(h) + 1; };
  var stCol = col('الحالة'), noteCol = col('ملاحظة'), tCol = col('الطابع الزمني');
  var st = sh.getRange(2, stCol, n, 1);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(UNMATCHED_STATUS.CREDITED).setBackground(COLORS.good).setFontColor('#1b5e20').setRanges([st]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(UNMATCHED_STATUS.MANUAL).setBackground(COLORS.bad).setFontColor('#b00020').setRanges([st]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(UNMATCHED_STATUS.AMBIGUOUS).setBackground('#fff4d6').setFontColor('#8a5a12').setRanges([st]).build()
  ]);
  st.setFontWeight('bold');
  sh.getRange(2, tCol, n, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  sh.getRange(2, 1, n, w).setHorizontalAlignment('right');
  sh.getRange(2, noteCol, n, 1).setWrap(true);
  sh.setColumnWidth(noteCol, 380);
  sh.setFrozenColumns(2);
  return sh;
}

function columnLetter_(c) {
  var s = '';
  while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); }
  return s;
}

// ===== Platform.gs =====
/**
 * Platform.gs — بوت المنصة (لمالك المنصة وللتفعيل) والتثبيت لأول مرة.
 *
 * رابط بوت المنصة: <WEBAPP_URL>?b=platform&k=<PLATFORM_SECRET>
 * أوامر عامة (أي مستخدم): /start /help /myid /activate /status (تفعيل نظام بمفتاح الترخيص ثم توكني البوتين).
 * أوامر المالك فقط (PLATFORM_OWNER_ID في خصائص السكربت):
 *   /addtenant <id> <الاسم>        عميل جديد: مفتاح ترخيص + سر + ملف تحكم + مجلد، تجريبي PLATFORM_TRIAL_DAYS يومًا (14 افتراضيًا)، حصة 3، ومهلة PLATFORM_GRACE_DAYS (3) بعد الانتهاء
 *   /tenants                       قائمة العملاء
 *   /tenant <id>                   التفاصيل والاستهلاك وحالة الويب هوك
 *   /extend <id> <أيام|YYYY-MM-DD>  تمديد (ويصبح «active»)
 *   /suspend <id> · /resume <id>   إيقاف/استئناف (البيانات باقية)
 *   /quota <id> <عدد>              حصة البرامج
 *   /owner <id> <tgid>             تعيين/تغيير مالك العميل
 *   /rotate <id>                   سر جديد للويب هوك وإعادة الربط · /webhooks <id> إعادة الربط فقط
 *   /addon <id> [+وحدة] [-وحدة]…    منح/سحب الإضافات (عمود «الإضافات المسموحة»)؛ بلا وحدات = عرض المسموح والمفعّل.
 *                                  السحب يوقف الوحدة عند العميل فورًا (ويتوقف مشغّلها وأحداثها)، وبياناتها تبقى.
 *   /setmsg student|admin <نص>     نص الإيقاف (أو /setmsg reset)
 *   /stats                         إحصاءات الاستهلاك
 */
var PLATFORM_HELP_PUBLIC = 'مرحبًا 👋 هذا بوت تفعيل نظام التسليمات والدرجات.\n/activate تفعيل نظامك بمفتاح الترخيص\n/myid معرّفك في تيليجرام\n/status تقدّم إعداد نظامك';
var PLATFORM_HELP_OWNER = 'أوامر المالك:\n/addtenant <id> <الاسم>\n/tenants\n/tenant <id>\n/extend <id> <أيام|YYYY-MM-DD>\n/suspend <id>\n/resume <id>\n/quota <id> <عدد>\n/owner <id> <tgid>\n/rotate <id>\n/webhooks <id>\n/addon <id> [+وحدة -وحدة]\n/setmsg student|admin <نص> | reset\n/stats';
var ACT_MAX_FAILS = 5;

function isPlatformOwner_(uid) { var o = str_(platformProp_('PLATFORM_OWNER_ID')); return !!o && String(uid) === o; }
function pCache_() { return nsCache_('p|'); }

function platformPost_(e) {
  
  var p = (e && e.parameter) || {};
  var secret = platformProp_('PLATFORM_SECRET');
  if (!secret || !safeEqual_(p.k, secret)) return out_('forbidden');
  BOT_ROLE = 'platform';
  var u;
  try { u = JSON.parse(e.postData.contents); } catch (x) { return out_('ok'); }
  if (u.update_id != null) { var uk = 'pupd:' + u.update_id; if (pCache_().get(uk)) return out_('dup'); pCache_().put(uk, '1', 21600); }
  var m = u.message;
  if (u.callback_query) { answerCallback_(u.callback_query.id); return out_('ok'); }
  if (!m || !m.chat || m.chat.type !== 'private' || !m.from) return out_('ok');
  
try { onPlatformMessage_(m); } catch (err) {
    logError_(err, 'platform ' + String(e.postData.contents).slice(0, 500));
    try { send_(m.chat.id, '⚠️ خطأ: ' + err.message); } catch (x) { /* تجاهل */ }
  }
  return out_('ok');
}

function onPlatformMessage_(m) {
  
  var uid = String(m.from.id), chat = m.chat.id, text = str_(m.text);
  var args = text.split(/\s+/), cmd = text.charAt(0) === '/' ? args[0].replace(/@.*/, '').toLowerCase() : '';
  var owner = isPlatformOwner_(uid), st = JSON.parse(pCache_().get('pst:' + uid) || 'null');
  if (cmd === '/myid') return send_(chat, 'معرّفك في تيليجرام: ' + uid);
  if (cmd === '/cancel') { pCache_().remove('pst:' + uid); return send_(chat, 'أُلغي.'); }
  if (cmd === '/app') {
    var appUrl = platformMiniAppUrl_();
    if (!appUrl) return send_(chat, '⏸ رابط التطبيق غير مضبوط بعد.');
    if (!owner) return send_(chat, 'غير مصرّح');
    return send_(chat, '📱 اضغط لفتح لوحة المنصة:', [[{ text: '📱 لوحة المنصة', web_app: { url: appUrl } }]]);
  }
  if (cmd === '/activate') { pCache_().put('pst:' + uid, JSON.stringify({ step: 'lic' }), 3600); return send_(chat, '🔑 أرسل مفتاح الترخيص الذي وصلك.\nمثال: ADAB-1A2B-3C4D-5E6F-7A8B\n(/cancel للإلغاء)'); }
  if (cmd === '/status') return sendSetupStatus_(chat, uid);
  if (!cmd && st) return activateStep_(m, uid, chat, st, text);
  if (owner && cmd) { var r = ownerCommand_(cmd, args.slice(1), text, chat, uid); if (r !== undefined) return r; }
  return send_(chat, PLATFORM_HELP_PUBLIC + (owner ? '\n\n' + PLATFORM_HELP_OWNER : ''));
}

/* ───────── التفعيل: مفتاح ← توكن الإداري ← توكن الطلاب ← ربط الويب هوك ───────── */
function tgWithToken_(token, method, payload) {
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload || {}), muteHttpExceptions: true });
  try { return JSON.parse(res.getContentText()); } catch (e) { return { ok: false, description: 'رد غير مفهوم' }; }
}
function tokenInUse_(token, exceptTid) {
  var P = allProps_();
  return Object.keys(P).some(function (k) {
    var mm = k.match(/^T:([a-z0-9]+):(ADMIN_BOT_TOKEN|BOT_TOKEN)$/);
    return mm && mm[1] !== exceptTid && P[k] === token;
  }) || P.PLATFORM_BOT_TOKEN === token;
}

function activateStep_(m, uid, chat, st, text) {
  var save = function () { pCache_().put('pst:' + uid, JSON.stringify(st), 3600); };
  if (st.step === 'lic') {
    var fk = 'actfail:' + uid, fails = Number(pCache_().get(fk) || 0);
    if (fails >= ACT_MAX_FAILS) return send_(chat, '⛔ محاولات كثيرة. حاول بعد ساعة.');
    tg_('deleteMessage', { chat_id: chat, message_id: m.message_id }, true);
    var key = latinDigits_(text).toUpperCase().replace(/\s+/g, '');
    var t = listTenants_().filter(function (x) { return x.license && safeEqual_(key, x.license); })[0];
    if (!t) { pCache_().put(fk, String(fails + 1), 3600); return send_(chat, '⚠️ مفتاح غير صحيح.'); }
    if (!licenseState_(t).ok) return send_(chat, '⛔ هذا الترخيص موقوف أو منتهٍ. تواصل مع مزوّد الخدمة.');
    if (t.ownerId && t.ownerId !== uid) return send_(chat, '⛔ هذا الترخيص مسجَّل لمالك آخر.');
    st = { step: 'mode', tid: t.id}; save();
    return send_(chat, '🔀 كيف تريد ربط بوتاتك؟\nأرسل 1 = بوت موحّد واحد (للطلاب والإدارة معًا) — الأبسط\nأرسل 2 = بوتان منفصلان (بوت للإدارة وبوت للطلاب)');
  }
  if (st.step === 'mode') {
    var choice = text.replace(/\s+/g, '');
    if (choice === '1') { st = { step: 'tok', tid: st.tid, mode: 'unified'}; save(); return send_(chat, '🤖 أرسل توكن البوت الموحّد الذي أنشأته من BotFather.');}
    if (choice === '2') { var tm = loadTenant_(st.tid, true); if (!tm) return send_(chat, '⚠️ العميل لم يعد موجودًا.'); st = { step: 'atok', tid: st.tid, mode: 'dual'}; save(); return send_(chat, '✅ الترخيص صحيح: «' + tm.name + '».\n\n١) أنشئ بوتين من @BotFather: بوتًا إداريًا وبوتًا للطلاب.\n٢) أرسل هنا توكن البوت الإداري (مثل 123456:ABC…).\nسأحذف رسالة التوكن فور قراءتها.');}
    return send_(chat, '⚠️ أرسل 1 للبوت الموحّد أو 2 للبوتين المنفصلين.');
  }
  if (st.step === 'atok' || st.step === 'stok') {
    tg_('deleteMessage', { chat_id: chat, message_id: m.message_id }, true);
    var tok = text.replace(/\s+/g, '');
    if (!/^\d+:[\w-]{30,}$/.test(tok)) return send_(chat, '⚠️ هذا لا يبدو توكن بوت صحيحًا (مثل 123456:ABC…).');
    if (tokenInUse_(tok, st.tid) || tok === st.atok) return send_(chat, '⚠️ هذا التوكن مستعمل لبوت آخر. كل بوت يجب أن يكون مستقلًا.');
    var me = tgWithToken_(tok, 'getMe', {});
    if (!me.ok) return send_(chat, '⚠️ تيليجرام رفض التوكن: ' + (me.description || ''));
    if (st.step === 'atok') { st.atok = tok; st.aname = me.result.username; st.step = 'stok'; save(); return send_(chat, '✅ البوت الإداري: @' + me.result.username + '\nأرسل الآن توكن بوت الطلاب.'); }
    var t2 = loadTenant_(st.tid, true);
    if (!t2) return send_(chat, '⚠️ العميل لم يعد موجودًا.');
    setTenantPropOf_(t2.id, 'ADMIN_BOT_TOKEN', st.atok);
    setTenantPropOf_(t2.id, 'BOT_TOKEN', tok);
    var res = withTenant_(t2, function () {
      var patch = { STOK: maskToken_(tok), ATOK: maskToken_(st.atok), SETUP: t2.setup === SETUP_DONE ? SETUP_DONE : 'bots' };
    if (!t2.ownerId) patch.OWNER = uid; // ليسجَّل المفعِّل مالكًا فيعرف /status نظامه
    updateTenant_(t2.id, patch);
      return setTenantWebhooks_();
    });
    pCache_().remove('pst:' + uid);
    var okAll = res.student.ok && res.admin.ok;
    var po = platformProp_('PLATFORM_OWNER_ID');
    if (po && po !== uid) try { send_(po, '🔔 فُعّل بوتا العميل ' + t2.id + ' («' + t2.name + '») من ' + uid + '.'); } catch (x) { /* تجاهل */ }
    return send_(chat, (okAll ? '✅ رُبط البوتان بالخدمة:' : '⚠️ رُبط جزئيًا:') + '\n• الإداري: @' + st.aname + (res.admin.ok ? '' : ' — ' + res.admin.description) +
      '\n• الطلاب: @' + me.result.username + (res.student.ok ? '' : ' — ' + res.student.description) +
      '\n\n' + setupStatusText_(setupStatusState_(uid, t2), st.aname));
  }
  
  if (st.step === 'tok') {
    tg_('deleteMessage', { chat_id: chat, message_id: m.message_id }, true);
    var tok = text.replace(/\s+/g, '');
    if (!/^\d+:[\w-]{30,}$/.test(tok)) return send_(chat, '⚠️ هذا لا يبدو توكن بوت صحيحًا (مثل: 123456:ABC...).');
    if (tokenInUse_(tok, st.tid)) return send_(chat, '⚠️ هذا التوكن مستعمل لبوت آخر. كل بوت يجب أن يكون مستقلًا.');
    var me = tgWithToken_(tok, 'getMe', {});
    if (!me.ok) return send_(chat, '⚠️ تيليجرام رفض التوكن: ' + (me.description || ''));
    var t2 = loadTenant_(st.tid, true);
    if (!t2) return send_(chat, '⚠️ العميل لم يعد موجودًا.');
    setTenantPropOf_(t2.id, 'BOT_TOKEN', tok);
    setTenantPropOf_(t2.id, 'BOT_MODE', 'unified');
    var res = withTenant_(t2, function () {
      var patch = { STOK: maskToken_(tok), ATOK: '', SETUP: t2.setup === SETUP_DONE ? SETUP_DONE : 'bots' };
      if (!t2.ownerId) patch.OWNER = uid;
      updateTenant_(t2.id, patch);
      return setTenantWebhooks_();
  });
  
    pCache_().remove('pst:' + uid);
  var okU = res.unified.ok;
  var po = platformProp_('PLATFORM_OWNER_ID');
    if (po && po !== uid) try { send_(po, '🔔 فُعّل بوت العميل الموحّد ' + t2.id + ' («' + t2.name + '») من ' + uid + '.'); } catch (x) { /* تجاهل */ }
    return send_(chat, (okU ? '✅ رُبط البوت الموحّد بالخدمة:' : '⚠️ رُبط جزئيًا:') + '\n• البوت الموحّد: @' + me.result.username + ' (' + (res.unified.ok ? '✓' : '– ' + res.unified.description) + ')' + '\n\n' + setupStatusText_(setupStatusState_(uid, t2), me.result.username));
    }
     pCache_().remove('pst:' + uid);
     return send_(chat, 'انتهت الخطوة. أرسل /activate من جديد.');
}

/* ───────── أوامر المالك ───────── */
/** تقدّم الإعداد (/status): حالة تُبنى فقط مما يمكن قراءته فعلًا: الترخيص و«الإعداد» من صف العميل في ورقة «العملاء»، وتوكنا البوتين من خصائص العميل (tokenFor_ داخل withTenant_)، وربط ملف ردود نموذج التسجيل وفتح التسليم من ملف التحكم (getPrograms_ / loadProgram_ داخل withTenant_)؛ فإن تعذّرت قراءة برامج النظام أُسقطت هاتان الخطوتان من القائمة بدل تزييفهما. يُعرَف العميل من التفعيل الجاري (pst) أو من معرّف المالك في صفه؛ ولهذا يسجَّل المفعِّل مالكًا عند اكتمال التفعيل إن لم يكن للصف مالك. */
function setupStatusState_(uid, tenant) {
  var st = null;
  try { st = JSON.parse(pCache_().get('pst:' + uid) || 'null'); } catch (e) { st = null; }
  var t = tenant || null;
  if (!t && st && st.tid) t = loadTenant_(st.tid, true);
  if (!t) {
    var mine = listTenants_().filter(function (x) { return x.ownerId === uid; });
    if (mine.length) t = mine[0];
  }
  var s = { tenant: t, inProgress: !!st, name: t ? t.name : '', lic: false, atok: false, stok: false, setup: false, reg: false, open: false, progsOk: false };
  if (!t) return s;
  s.lic = !!t.license;
  s.setup = t.setup === SETUP_DONE;
  try {
    var r = withTenant_(t, function () {
      var out = { atok: false, stok: false, progsOk: false, reg: false, open: false };
      try { out.atok = !!tokenFor_('admin'); } catch (e1) { /* تجاهل */ }
      try { out.stok = !!tokenFor_('student'); } catch (e2) { /* تجاهل */ }
      try {
        var progs = getPrograms_();
        out.progsOk = true;
        out.open = progs.some(function (p) { return p.open; });
        for (var i = 0; i < progs.length; i++) {
          try {
            var prog = loadProgram_(progs[i].id);
            var link = prog && prog.general && prog.general.regSpreadsheetId;
            if (link && String(link).replace(/\s+/g, '')) { out.reg = true; break; }
          } catch (e3) { /* تجاهل */ }
        }
      } catch (e4) { /* برامج النظام غير قابلة للقراءة حاليًا */ }
      return out;
    });
    s.atok = r.atok; s.stok = r.stok; s.progsOk = r.progsOk; s.reg = r.reg; s.open = r.open;
  } catch (e) { s.progsOk = false; }
  if (st && st.step === 'stok' && st.atok) s.atok = true;
  return s;
}

function setupStatusText_(s, adminName) {
  var setupNext = adminName ? 'افتح @' + adminName + ' وأرسل /setup لإكمال الإعداد.' : 'افتح بوت الإدارة وأرسل /setup لإكمال الإعداد.';
  var items = [
    { ok: s.lic, label: 'مفتاح الترخيص مقبول', next: 'أرسل /activate ثم مفتاح الترخيص.' },
    { ok: s.atok, label: 'توكن بوت الإدارة محفوظ', next: 'أرسل توكن بوت الإدارة هنا.' },
    { ok: s.stok, label: 'توكن بوت الطلاب محفوظ', next: 'أرسل توكن بوت الطلاب هنا.' },
    { ok: s.setup, label: 'اكتمل الإعداد الأول في بوت الإدارة (المالك + أول برنامج)', next: setupNext },
    { ok: s.reg, label: 'ربط ملف ردود نموذج التسجيل', next: 'في بوت الإدارة: إدارة البرنامج ← الإعدادات العامة، والصق رابط ملف ردود استمارة التسجيل.' },
    { ok: s.open, label: 'فتح التسليم', next: 'في بوت الإدارة: إدارة البرنامج، واضغط «🔓 فتح التسليم».' }
  ];
  if (s.tenant && !s.progsOk) items = items.slice(0, 4);
  var done = 0, next = '';
  var lines = items.map(function (it) {
    if (it.ok) done++;
    else if (!next) next = it.next;
    return (it.ok ? '✅ ' : '⬜ ') + it.label;
  });
  var head = s.tenant ? '📋 تقدّم إعداد نظام «' + s.name + '»' : '📋 تقدّم الإعداد';
  var tail = done === items.length ? '🎉 اكتمل كل شيء — نظامك جاهز لاستقبال التسليمات.' : 'الخطوة التالية: ' + next;
  return head + '\n' + lines.join('\n') + '\nأنجزت ' + done + ' من ' + items.length + '\n' + tail;
}

function sendSetupStatus_(chat, uid) {
  var s = setupStatusState_(uid, null);
  if (!s.tenant && !s.inProgress) return send_(chat, 'لا يوجد نظام مرتبط بحسابك بعد. ابدأ بـ /activate ثم أرسل مفتاح الترخيص.');
  return send_(chat, setupStatusText_(s, null));
}

function tenantLine_(t) {
  var lic = licenseState_(t);
  return (lic.ok ? (t.status === TENANT_STATUS.TRIAL ? '🟡' : '🟢') : '🔴') + ' ' + t.id + ' — ' + t.name + ' | ' + t.status + (t.expiry ? ' حتى ' + dayKey_(t.expiry) : '') +
    (lic.ok ? (lic.grace ? ' (مهلة حتى ' + dayKey_(lic.graceEnd) + ')' : '') : ' (' + (lic.reason === 'expired' ? 'منتهٍ' : 'موقوف') + ')') + ' | حصة ' + t.quota + ' | إعداد: ' + (t.setup || '—');
}

/** أيام أو YYYY-MM-DD → تاريخ انتهاء، أو {error} */
function parseExtendExpiry_(t, arg) {
  arg = latinDigits_(str_(arg));
  if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) return { expiry: arg };
  if (/^\d{1,4}$/.test(arg)) return { expiry: dayKey_(Math.max(Date.now(), t.expiry || 0) + Number(arg) * DAY_MS) };
  return { error: 'الصيغة: /extend <id> <أيام|YYYY-MM-DD>' };
}
/** يمدّد الاشتراك (ويصبح active إلا إن كان موقوفًا). يعيد {ok, tenant} أو {error} */
function extendTenant_(t, arg) {
  var p = parseExtendExpiry_(t, arg);
  if (p.error) return p;
  return { ok: true, tenant: updateTenant_(t.id, { EXPIRY: p.expiry, STATUS: t.status === TENANT_STATUS.SUSPENDED ? t.status : TENANT_STATUS.ACTIVE }) };
}
/** إيقاف أو استئناف (البيانات باقية). resume يجعل الحالة active */
function setTenantSuspended_(t, suspended) {
  return { ok: true, tenant: updateTenant_(t.id, { STATUS: suspended ? TENANT_STATUS.SUSPENDED : TENANT_STATUS.ACTIVE }) };
}
/** تطبيق +وحدة/-وحدة كما في /addon. يعيد {ok, tenant, grants, revokes, stopped} أو {error, bad} أو {ok, summaryOnly} إن لم تُرسل عمليات */
function applyAddonOps_(t, ops) {
  if (!t) return { error: 'العميل غير موجود.' };
  ops = ops || [];
  if (!ops.length) return { ok: true, tenant: t, grants: [], revokes: [], stopped: [], summaryOnly: true };
  var allowed = t.addons.slice(), grants = [], revokes = [], bad = [];
  ops.forEach(function (op) {
    var mm = String(op).match(/^([+-])([A-Za-z][A-Za-z0-9]*)$/), id = mm ? moduleIdOf_(mm[2]) : null;
    if (!id) { bad.push(op); return; }
    if (mm[1] === '+') { if (allowed.indexOf(id) < 0) allowed.push(id); grants.push(id); revokes = revokes.filter(function (x) { return x !== id; }); }
    else { allowed = allowed.filter(function (x) { return x !== id; }); revokes.push(id); grants = grants.filter(function (x) { return x !== id; }); }
  });
  if (bad.length) return { error: 'غير مفهوم: ' + bad.join(' '), bad: bad };
  var nt = updateTenant_(t.id, { ADDONS: allowed.join(',') });
  var stopped = [];
  if (revokes.length) withTenant_(nt, function () { revokes.forEach(function (id) { if (disableModule_(id)) stopped.push(id); }); }); 
  if (grants.length) try { withTenant_(nt, function () { grants.forEach(function (id) { try { var m = MODULES[id], patch = {}; patch[id] = true; saveTenantConf_({ modules: patch }); if (m && m.onEnable) m.onEnable(); } catch (e) { logError_(e, 'addon auto-enable ' + id); } }); }); } catch (e) { logError_(e, 'addon auto-enable'); }
  return { ok: true, tenant: nt, grants: grants, revokes: revokes, stopped: stopped };
}

function ownerCommand_(cmd, a, text, chat, uid) {
  
  var need = function (t) { if (!t) { send_(chat, '⚠️ العميل غير موجود.'); return false; } return true; };
  if (cmd === '/addtenant') {
    var id = str_(a[0]).toLowerCase(), name = a.slice(1).join(' ').trim();
    if (!TENANT_ID_RE.test(id) || !name) return send_(chat, 'الصيغة: /addtenant <id> <الاسم>\nالمعرّف: حروف لاتينية صغيرة وأرقام (2-20).\nمثال: /addtenant noor مبادرة نور');
    var r = addTenant_(id, name);
    if (r.error) return send_(chat, '⚠️ ' + r.error);
    return send_(chat, '✅ أُضيف العميل ' + id + ' («' + name + '») تجريبيًا حتى ' + r.expiry + '، حصة ' + DEFAULT_QUOTA + ' برامج.\n🔑 مفتاح الترخيص (أرسله للعميل):\n' + r.license +
      '\n📄 ملف التحكم: ' + r.controlUrl + '\n\nخطوات العميل: يفتح هذا البوت ← /activate ← المفتاح ← توكنا البوتين ← ثم /setup في بوته الإداري.');
  }
  if (cmd === '/tenants') {
    var list = listTenants_();
    return send_(chat, clip(list.length ? '👥 العملاء (' + list.length + '):\n' + list.map(tenantLine_).join('\n') : 'لا عملاء بعد.'));
  }
    var t = null;
  if (a[0]) {
    if (String(a[0]).toLowerCase() === 'test2') {
      t = loadTenantTest2Fast_(a[0]) || loadTenant_(a[0], true);
    } else t = loadTenant_(a[0], true);
  }
  
if (cmd === '/tenant') {
    if (!need(t)) return;
    var lines = [tenantLine_(t), 'المالك: ' + (t.ownerId || '—'), 'المحررون: ' + (t.editors.join('، ') || '—'), 'ملف التحكم: https://docs.google.com/spreadsheets/d/' + t.controlSsId + '/edit'];
    var today = dayKey_(), u = usageOf_(t.id, today);
    lines.push('الإضافات المسموحة: ' + (t.addons.join('، ') || 'لا شيء'));
    lines.push('الاستهلاك اليوم: ' + u.updates + ' تحديثًا، ' + u.ticks + ' تشغيل مشغّل');
    withTenant_(t, function () {
      try { lines.push('البرامج: ' + getPrograms_().length + ' من ' + t.quota); } catch (e) { lines.push('البرامج: ؟ (' + e.message + ')'); }
      ['admin', 'student'].forEach(function (role) {
        if (!tokenFor_(role)) { lines.push((role === 'admin' ? 'الإداري' : 'الطلاب') + ': لا توكن'); return; }
        var j = tgAs_(role, 'getWebhookInfo', {}, true);
        lines.push((role === 'admin' ? 'الإداري' : 'الطلاب') + ': ' + (j.ok ? (j.result.url ? 'مربوط' : 'غير مربوط') + ' | معلّق ' + j.result.pending_update_count + (j.result.last_error_message ? ' | آخر خطأ: ' + j.result.last_error_message : '') : j.description));
      });
    });
    return send_(chat, clip(lines.join('\n')));
  }
  if (cmd === '/extend') {
    if (!need(t)) return;
    var er = extendTenant_(t, a[1]);
    if (er.error) return send_(chat, er.error);
    return send_(chat, '✅ ' + tenantLine_(er.tenant));
  }
  if (cmd === '/suspend' || cmd === '/resume') {
    if (!need(t)) return;
    var nt2 = setTenantSuspended_(t, cmd === '/suspend').tenant;
  
      return send_(chat, (cmd === '/suspend' ? '⏸ أُوقف (البيانات محفوظة): ' : '▶️ استُؤنف: ') + tenantLine_(nt2));
  }
  if (cmd === '/quota') {
    if (!need(t)) return;
    var q = Number(latinDigits_(str_(a[1])));
    if (!(q >= 0 && q <= 500 && Math.floor(q) === q)) return send_(chat, 'الصيغة: /quota <id> <عدد صحيح>');
    return send_(chat, '✅ ' + tenantLine_(updateTenant_(t.id, { QUOTA: q })));
  }
  if (cmd === '/owner') {
    if (!need(t)) return;
    if (!/^\d{4,15}$/.test(str_(a[1]))) return send_(chat, 'الصيغة: /owner <id> <معرّف تيليجرام>');
    return send_(chat, '✅ المالك الآن ' + a[1] + ': ' + tenantLine_(updateTenant_(t.id, { OWNER: str_(a[1]) })));
  }
  if (cmd === '/rotate' || cmd === '/webhooks') {
    if (!need(t)) return;
    if (cmd === '/rotate') setTenantPropOf_(t.id, 'SECRET', randomHex_(40));
    var res = withTenant_(t, setTenantWebhooks_);
    return send_(chat, (cmd === '/rotate' ? '🔁 سر جديد. ' : '') + 'الإداري: ' + (res.admin.ok ? 'مربوط ✅' : res.admin.description) + ' | الطلاب: ' + (res.student.ok ? 'مربوط ✅' : res.student.description));
  }
  if (cmd === '/addon') {
    if (!a[0]) return send_(chat, addonUsage_());
    if (!t) return send_(chat, '⚠️ العميل غير موجود: ' + a[0]);
    var ar = applyAddonOps_(t, a.slice(1));
    if (ar.summaryOnly) return send_(chat, addonSummary_(t));
    if (ar.error) return send_(chat, '⚠️ ' + ar.error + '\n\n' + addonUsage_());
    return send_(chat, '✅ حُفظت إضافات ' + t.id + '.' + (ar.grants.length ? '\n➕ سُمح: ' + ar.grants.join('، ') : '') +
      (ar.revokes.length ? '\n➖ سُحب: ' + ar.revokes.join('، ') + (ar.stopped.length ? ' (أُوقف عند العميل: ' + ar.stopped.join('، ') + ')' : '') : '') +
      '\n\n' + addonSummary_(ar.tenant));
  }
  if (cmd === '/setmsg') {
    var role = str_(a[0]).toLowerCase(), msg = text.replace(/^\/setmsg(@\S+)?\s+\S+\s*/i, '');
    if (role === 'reset') { setPlatformProp_('PLATFORM_BLOCKED_MSG', ''); setPlatformProp_('PLATFORM_BLOCKED_ADMIN_MSG', ''); return send_(chat, '✅ عادت النصوص الافتراضية.'); }
    if ((role !== 'student' && role !== 'admin') || msg.length < 5) return send_(chat, 'الصيغة: /setmsg student|admin <النص>\nالحالي (الطلاب): ' + blockedText_('student') + '\nالحالي (الإداري): ' + blockedText_('admin'));
    setPlatformProp_(role === 'admin' ? 'PLATFORM_BLOCKED_ADMIN_MSG' : 'PLATFORM_BLOCKED_MSG', msg.slice(0, 1000));
    return send_(chat, '✅ حُفظ نص الإيقاف (' + role + ').');
  }
  if (cmd === '/stats') {
    var all = listTenants_(), day = dayKey_(), soon = Date.now() + 7 * DAY_MS, L = ['📊 الإحصاءات (' + day + ')'];
    var by = {}; all.forEach(function (x) { var k = licenseState_(x).ok ? x.status : 'blocked'; by[k] = (by[k] || 0) + 1; });
    L.push('العملاء: ' + all.length + ' — ' + Object.keys(by).map(function (k) { return k + ' ' + by[k]; }).join('، '));
    all.forEach(function (x) {
      var w = [0, 1, 2, 3, 4, 5, 6].reduce(function (s, i) { return s + usageOf_(x.id, dayKey_(Date.now() - i * DAY_MS)).updates; }, 0);
      L.push('• ' + x.id + ': اليوم ' + usageOf_(x.id, day).updates + ' | 7 أيام ' + w + (x.expiry && x.expiry < soon && licenseState_(x).ok ? ' | ⏰ ينتهي ' + dayKey_(x.expiry) : ''));
    });
    L.push('(تقريبية من الذاكرة المؤقتة؛ الأرشيف اليومي في ورقة «' + REGISTRY.USAGE + '»)');
    return send_(chat, clip(L.join('\n')));
  }
  return undefined;
}

/* ───────── الإضافات المسموحة لكل عميل ───────── */
/** يطابق المعرّف بسجل الوحدات بلا حساسية لحالة الأحرف؛ null إن لم يوجد */
function moduleIdOf_(x) { x = String(x || '').toLowerCase(); for (var id in MODULES) if (id.toLowerCase() === x) return id; return null; }
function addonUsage_() {
  return 'الصيغة: /addon <id> +وحدة -وحدة …\nمثال: /addon demo +quizImport\n/addon <id> وحده يعرض المسموح والمفعّل.\n\nالوحدات:\n' +
    Object.keys(MODULES).map(function (id) { return '• ' + id + ' — ' + MODULES[id].title + (MODULES[id].ready ? '' : ' (قريبًا)'); }).join('\n');
}
function addonSummary_(t) {
  var conf = {}; try { conf = withTenant_(t, function () { return tenantConf_().modules; }); } catch (e) { conf = {}; }
  var L = ['🧩 إضافات ' + t.id + ' («' + t.name + '»):'];
  Object.keys(MODULES).forEach(function (id) {
    var m = MODULES[id], al = t.addons.indexOf(id) >= 0;
    L.push((al ? (conf[id] && m.ready ? '🟢 ' : '✅ ') : '🔒 ') + id + ' — ' + (al ? 'مسموحة' + (!m.ready ? ' (قريبًا)' : conf[id] ? '، مفعّلة عند العميل' : '، لم يفعّلها العميل') : 'غير مسموحة'));
  });
  return L.join('\n');
}

/** ينشئ عميلًا: صف السجل + السر + ملف التحكم + المجلد. يعيد {license, expiry, controlUrl} أو {error} */
function addTenant_(id, name) {
  var sl = LockService.getScriptLock();
  sl.waitLock(20000);
  try {
    if (listTenants_().some(function (x) { return x.id === id; })) return { error: 'المعرّف «' + id + '» مستعمل.' };
    var license = newLicenseKey_(), days = Number(platformProp_('PLATFORM_TRIAL_DAYS') || DEFAULT_TRIAL_DAYS);
    var expiry = dayKey_(Date.now() + days * DAY_MS), now = new Date();
    var folderId = '';
    try { var root = platformProp_('ROOT_FOLDER_ID'), f = root ? DriveApp.getFolderById(root).createFolder('عميل — ' + name + ' (' + id + ')') : DriveApp.createFolder('عميل — ' + name + ' (' + id + ')'); folderId = f.getId(); }
    catch (e) { logError_(e, 'tenant folder ' + id); }
    var controlId = createControlSpreadsheet_(name);
    if (folderId) { try { DriveApp.getFileById(controlId).moveTo(DriveApp.getFolderById(folderId)); } catch (e) { /* تجاهل */ } }
    var row = REGISTRY_HEADERS.map(function () { return ''; });
    row[RC.ID] = id; row[RC.NAME] = name; row[RC.LICENSE] = license; row[RC.STATUS] = TENANT_STATUS.TRIAL; row[RC.EXPIRY] = expiry;
    row[RC.QUOTA] = DEFAULT_QUOTA; row[RC.CONTROL] = 'https://docs.google.com/spreadsheets/d/' + controlId + '/edit'; row[RC.CREATED] = now; row[RC.UPDATED] = now;
    setTenantPropOf_(id, 'SECRET', randomHex_(40));
    if (folderId) setTenantPropOf_(id, 'FOLDER_ID', folderId);
    registrySheet_().appendRow(row);
    invalidateTenant_(id);
    invalidateTenantsCache_();
    return { license: license, expiry: expiry, controlUrl: row[RC.CONTROL], controlId: controlId };
  } finally { sl.releaseLock(); }
}

/* ───────── التثبيت لأول مرة (يُشغَّل من المحرر بحساب المالك) ───────── */
/**
 * platformInstall: يتطلب ضبط PLATFORM_OWNER_ID و PLATFORM_BOT_TOKEN (و WEBAPP_URL بعد أول نشر) في خصائص السكربت.
 * ينشئ ملف «سجل العملاء» (للمالك فقط) إن لم يوجد، ويولّد PLATFORM_SECRET، وينشئ المشغّل الساعي المركزي، ويربط بوت المنصة.
 * آمن للتكرار.
 */
function platformInstall() {
  resetMemo_(); leaveTenant_();
  if (!platformProp_('PLATFORM_OWNER_ID')) throw new Error('اضبط PLATFORM_OWNER_ID في إعدادات المشروع ← خصائص السكربت أولًا.');
  var out = [];
  if (!platformProp_('REGISTRY_SS_ID')) {
    var ss = SpreadsheetApp.create('سجل العملاء — المنصة (للمالك فقط)');
    var sh = ss.getSheets()[0]; sh.setName(REGISTRY.SHEET);
    sh.getRange(1, 1, 1, REGISTRY_HEADERS.length).setValues([REGISTRY_HEADERS]);
    try { sh.setFrozenRows(1); sh.setRightToLeft(true); } catch (e) { /* تجاهل */ }
    ss.insertSheet(REGISTRY.LOG).getRange(1, 1, 1, 3).setValues([['الوقت', 'الخطأ', 'السياق']]);
    ss.insertSheet(REGISTRY.USAGE).getRange(1, 1, 1, 4).setValues([['اليوم', 'العميل', 'التحديثات', 'تشغيلات المشغّل']]);
    setPlatformProp_('REGISTRY_SS_ID', ss.getId());
    out.push('أُنشئ سجل العملاء: ' + ss.getUrl());
  } else { out.push('سجل العملاء موجود.'); try { if (ensureRegistryColumns_(registrySS_().getSheetByName(REGISTRY.SHEET))) out.push('أُضيفت أعمدة السجل الجديدة.'); } catch (e) { out.push('⚠️ أعمدة السجل: ' + e.message); } }
  if (!platformProp_('PLATFORM_SECRET')) { setPlatformProp_('PLATFORM_SECRET', randomHex_(40)); out.push('وُلّد PLATFORM_SECRET.'); }
  try { out.push(ensureWeeklyTrigger_() ? 'أُنشئ المشغّل الساعي المركزي.' : 'المشغّل الساعي موجود.'); } catch (e) { out.push('⚠️ المشغّل: ' + e.message); }
  if (platformProp_('PLATFORM_BOT_TOKEN')) {
    try { out.push('بوت المنصة: ' + JSON.stringify(platformSetWebhook())); } catch (e) { out.push('⚠️ بوت المنصة: ' + e.message + ' (انشر تطبيق الويب واضبط WEBAPP_URL ثم شغّل platformSetWebhook)'); }
  } else out.push('⚠️ PLATFORM_BOT_TOKEN غير مضبوط بعد.');
  console.log(out.join('\n'));
  return out;
}

var PLATFORM_MINIAPP_MENU = '📱 لوحة المنصة';
var PLATFORM_COMMANDS = [
  { command: 'activate', description: 'تفعيل نظامك' },
  { command: 'status', description: 'تقدّم الإعداد' },
  { command: 'app', description: 'لوحة المنصة' },
  { command: 'myid', description: 'معرّفي' },
  { command: 'help', description: 'المساعدة' }
];

/** رابط لوحة المنصة (بلا أسرار). فارغ إن لم يُضبط MINIAPP_BASE_URL */
function platformMiniAppUrl_() {
  var base = platformProp_('MINIAPP_BASE_URL');
  if (!base) return '';
  return String(base).replace(/\/+$/, '') + '/?r=platform';
}

/**
 * يُشغَّل مرة من المحرر بعد ضبط MINIAPP_BASE_URL: زر قائمة بوت المنصة «📱 لوحة المنصة» وأمر /app.
 * الزر يظهر لأي مستخدم؛ التطبيق نفسه لا يعمل إلا لمالك المنصة (isPlatformOwner_).
 */
function platformMiniAppSetup() {
  resetMemo_(); leaveTenant_();
  var url = platformMiniAppUrl_();
  if (!url) throw new Error('اضبط MINIAPP_BASE_URL في إعدادات المشروع ← خصائص السكربت أولًا.');
  if (!platformProp_('PLATFORM_BOT_TOKEN')) throw new Error('اضبط PLATFORM_BOT_TOKEN أولًا.');
  tgAs_('platform', 'setMyCommands', { commands: PLATFORM_COMMANDS }, true);
  var j = tgAs_('platform', 'setChatMenuButton', { menu_button: { type: 'web_app', text: PLATFORM_MINIAPP_MENU, web_app: { url: url } } }, true);
  return { ok: !!(j && j.ok), url: url, description: (j && j.description) || '' };
}

function platformSetWebhook() {
  resetMemo_(); leaveTenant_();
  var url = webAppUrl_() + '?b=platform&k=' + encodeURIComponent(platformProp_('PLATFORM_SECRET'));
  var j = tgAs_('platform', 'setWebhook', { url: url, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false, max_connections: 5 }, true);
  tgAs_('platform', 'setMyCommands', { commands: PLATFORM_COMMANDS }, true);
  if (platformMiniAppUrl_()) { try { platformMiniAppSetup(); } catch (e) { logError_(e, 'platform miniapp setup'); } }
  return { ok: j.ok, description: j.description || '' };
}

/** يُشغَّل مرة من المحرر: صلاحية المشغّلات الزمنية */
function authorizeTriggers() {
  var n = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === WEEKLY_HANDLER; }).length;
  console.log('صلاحية المشغّلات مفعّلة. المشغّل الساعي المركزي الموجود: ' + n);
  return n;
}
/** يُشغَّل مرة من المحرر: صلاحية درايف (الإنشاء والنسخ والمشاركة) */
function authorizeDrive() {
  var root = DriveApp.getRootFolder().getName();
  console.log('صلاحية درايف مفعّلة (' + root + ').');
  return root;
}

// ===== ProgramCopy.gs =====
/**
 * ProgramCopy.gs — خطة نسخ نظام الدرجات لبرنامج جديد (دوال خالصة + تجهيز النسخة).
 * النسخ نفسه في ProgramFactory.gs: ملف جديد تنسخ إليه الأوراق ورقةً ورقة (copyTo)، فلا ينتقل أي سكربت أبدًا.
 * في النسخة: تبقى ورقة «الإعدادات» كاملة ورؤوس الأوراق وتنسيقها، وتُفرَّغ صفوف بيانات الطلاب،
 * وتُحذف النسخ الاحتياطية القديمة «(يدوي قديم …)» و«(قديم)» لأنها بيانات الدفعة السابقة.
 */
var COPY_BACKUP_RE = /\((يدوي قديم|قديم)/;
var COPY_EMAIL_RE = /بريد|e-?mail/i;

/**
 * خالص (قابل للاختبار): يقرر مصير كل ورقة في النسخة.
 * sheets: [{name, header: [..]}]، cfg: ناتج parseSettings لإعدادات المصدر.
 * يعيد { clear: [أسماء تُفرَّغ صفوفها بعد الأول], drop: [أسماء تُحذف], keep: [الباقي] }
 */
function copySheetPlan(sheets, cfg) {
  var g = (cfg && cfg.general) || {};
  var named = [NAMES.SUBMISSIONS, NAMES.CORRECTIONS, NAMES.OVERRIDES, NAMES.UNMATCHED,
    g.gradesSheet, g.passersSheet, g.malePassersSheet, g.femalePassersSheet, g.unmatchedSheet, g.finalSheet];
  ((cfg && cfg.components) || []).forEach(function (c) { named.push(c.sheet); });
  named = named.map(str_).filter(String);
  var out = { clear: [], drop: [], keep: [] };
  sheets.forEach(function (s) {
    var name = s.name;
    if (name === NAMES.SETTINGS) return out.keep.push(name);
    if (COPY_BACKUP_RE.test(name)) return out.drop.push(name);
    var hasEmail = (s.header || []).some(function (h) { return COPY_EMAIL_RE.test(str_(h)); });
    if (named.indexOf(name) >= 0 || hasEmail) return out.clear.push(name);
    out.keep.push(name);
  });
  return out;
}

/**
 * خالص: خلايا القسم العام التي تُكتب في «الإعدادات». map: {programName: '…', regSpreadsheetId: '…', …}
 * يعيد { cells: [{row, col (0-based), key, old, value}], missing: [نص البند الغائب] }
 */
function generalCellsPlan(values, map) {
  var rows = {}, inGeneral = false;
  for (var r = 0; r < values.length; r++) {
    var k = sectionKeyOf_((values[r] || [])[0]);
    if (k) { inGeneral = k === 'GENERAL'; continue; }
    if (inGeneral) rows[str_(values[r][0])] = r;
  }
  var out = { cells: [], missing: [] };
  Object.keys(map).forEach(function (key) {
    var f = GENERAL_FIELDS.filter(function (x) { return x[0] === key; })[0];
    if (!f) return;
    var r = rows[f[1]];
    if (r == null) { if (str_(map[key])) out.missing.push(f[1]); return; }
    out.cells.push({ row: r, col: 1, key: key, old: values[r][1], value: map[key] });
  });
  return out;
}

/**
 * يفحص ملف التسجيل قبل النسخ. wantedSheet: اسم ورقة التسجيل في المصدر (تُستعمل إن وُجدت في الملف الجديد).
 * يعيد {ok, id, title, sheet, rows, warning} أو {error}
 */
function inspectRegistration(rawLink, wantedSheet, g) {
  var id = extractSpreadsheetId(rawLink);
  if (!/^[A-Za-z0-9_-]{20,}$/.test(id)) return { error: 'هذا ليس رابط ملف Google Sheets ولا معرّفه.' };
  var ss;
  try { ss = SpreadsheetApp.openById(id); } catch (e) {
    return { error: 'تعذر فتح ملف التسجيل. شارك الملف مع حساب الخدمة (' + serviceEmail_() + ') بصلاحية «محرر» أو «مشاهد» ثم أعد الإرسال.\n(' + e.message + ')' };
  }
  var sh = (wantedSheet && ss.getSheetByName(wantedSheet)) || ss.getSheets()[0];
  var lastCol = sh.getLastColumn();
  if (!lastCol || sh.getLastRow() < 1) return { error: 'ورقة «' + sh.getName() + '» في ملف التسجيل فارغة (لا صف عناوين). اربط نموذج التسجيل بالملف أولًا ثم أعد الإرسال.' };
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var pattern = (g && g.regEmailPattern) || 'بريد|e-?mail';
  if (findColumn(header, pattern) < 0) {
    return { error: 'لم أجد عمود البريد في ورقة «' + sh.getName() + '» من ملف التسجيل.\nالعناوين الموجودة: ' + header.map(str_).filter(String).slice(0, 8).join('، ') +
      '\n(يجب أن يحوي عنوان عمود البريد كلمة «بريد» أو «email»)' };
  }
  var warning = '';
  if (g && g.regNamePattern && findColumn(header, g.regNamePattern) < 0) warning = 'لم أجد عمود الاسم (النمط: ' + g.regNamePattern + ')؛ عدّل «نمط عمود الاسم في التسجيل» بعد النسخ.';
  return { ok: true, id: id, title: ss.getName(), sheet: sh.getName(), sheetChanged: !!wantedSheet && sh.getName() !== wantedSheet, rows: Math.max(0, sh.getLastRow() - 1), warning: warning };
}

/** يفرّغ النسخة ويكتب إعدادات البرنامج الجديد. o: {name, regId, regSheet, reviewChatId} */
function prepareCopiedProgram(ss, o) {
  var set = ss.getSheetByName(NAMES.SETTINGS);
  if (!set) throw new Error('النسخة لا تحوي ورقة «الإعدادات».');
  var values = set.getDataRange().getValues();
  var cfg = parseSettings(values);
  var infos = ss.getSheets().map(function (sh) {
    var lc = sh.getLastColumn();
    return { name: sh.getName(), header: lc && sh.getLastRow() ? sh.getRange(1, 1, 1, lc).getValues()[0] : [] };
  });
  var plan = copySheetPlan(infos, cfg), res = { cleared: [], dropped: [], warnings: [] };
  plan.clear.forEach(function (name) {
    var sh = ss.getSheetByName(name), n = sh.getLastRow() - 1, lc = Math.max(1, sh.getLastColumn());
    if (n > 0) sh.getRange(2, 1, n, lc).clearContent();
    res.cleared.push({ name: name, rows: Math.max(0, n) });
  });
  plan.drop.forEach(function (name) {
    if (ss.getSheets().length > 1) { ss.deleteSheet(ss.getSheetByName(name)); res.dropped.push(name); }
  });
  var cells = generalCellsPlan(values, {
    programName: o.name,
    regSpreadsheetId: 'https://docs.google.com/spreadsheets/d/' + o.regId + '/edit',
    regSheet: o.regSheet || '',
    reviewChatId: o.reviewChatId || ''
  });
  cells.cells.forEach(function (c) { set.getRange(c.row + 1, c.col + 1).setValue(c.value); });
  cells.missing.forEach(function (l) { res.warnings.push('البند «' + l + '» غير موجود في «الإعدادات»؛ يضيفه مزوّد الخدمة بتحديث ورقة الإعدادات، ثم اكتبه.'); });
  SpreadsheetApp.flush();
  return res;
}

/** ملخص نصي لما فُرّغ وحُذف */
function copySummaryLines(res) {
  var lines = [];
  var withRows = res.cleared.filter(function (c) { return c.rows > 0; });
  lines.push('• فُرّغت ' + res.cleared.length + ' ورقة من بيانات الطلاب' + (withRows.length ? ' (' + withRows.map(function (c) { return c.name + ': ' + c.rows; }).join('، ') + ' صفًّا)' : '') + '، وبقيت رؤوسها وتنسيقها.');
  if (res.dropped.length) lines.push('• حُذفت النسخ الاحتياطية القديمة: ' + res.dropped.join('، '));
  lines.push('• بقيت ورقة «الإعدادات» كاملة (الفعاليات والاختبارات والمجموعات والتقديرات ودرجة النجاح).');
  return lines;
}

// ===== ProgramFactory.gs =====
/**
 * ProgramFactory.gs — إنشاء ملفات البرامج ونسخها داخل الخدمة المركزية فقط (من حساب المالك).
 *  - لا يُرفق بأي ملف سكربت: الإنشاء بـ SpreadsheetApp.create، والنسخ ورقةً ورقة بـ Sheet.copyTo
 *    (makeCopy كان ينقل السكربت المرتبط؛ هنا لا ينتقل شيء حتى لو كان المصدر قديمًا مرتبطًا بسكربت).
 *  - يُشارك الملف مع بريد محرري العميل (بيانات فقط)؛ نسخ العميل للملف لا يعطيه أي وظيفة.
 *  - حصة البرامج تُفحص قبل كل إنشاء/نسخ (quotaError_ في Tenant.gs).
 */

/** بريد حساب الخدمة (يظهر للعملاء ليشاركوا معه ملفات التسجيل والاختبارات) */
function serviceEmail_() {
  var e = platformProp_('SERVICE_EMAIL');
  if (!e) { try { e = Session.getEffectiveUser().getEmail(); } catch (x) { e = ''; } }
  return e || 'حساب الخدمة';
}

/** مجلد العميل في درايف حساب الخدمة (يُنشأ مع العميل) */
function tenantFolder_() {
  var id = prop_('FOLDER_ID');
  if (!id) return null;
  try { return DriveApp.getFolderById(id); } catch (e) { return null; }
}

/** ينقل الملف إلى مجلد (أو مجلد العميل) — لا يرمي */
function placeFile_(fileId, folder) {
  folder = folder || tenantFolder_();
  if (!folder) return null;
  try { DriveApp.getFileById(fileId).moveTo(folder); return folder; } catch (e) { logError_(e, 'move ' + fileId); return null; }
}

/** يشارك الملف مع محرري العميل (بلا سكربت = بيانات فقط). يعيد قائمة من شُورك معهم */
function shareWithTenant_(fileId) {
  var list = (TENANT_ && TENANT_.editors) || [], done = [];
  if (!list.length) return done;
  try {
    var f = DriveApp.getFileById(fileId);
    list.forEach(function (em) { try { f.addEditor(em); done.push(em); } catch (e) { logError_(e, 'share ' + em); } });
  } catch (e) { logError_(e, 'share ' + fileId); }
  return done;
}

/**
 * ينشئ ملف درجات جديدًا من قالب العميل. o = {name, levels: [..], reviewChatId, regLink}
 * يعيد {id, url, title, shared}
 */
function createProgramFromTemplate_(o) {
  var conf = tenantConf_(), title = 'درجات ' + o.name;
  var ss = SpreadsheetApp.create(title);
  var first = ss.getSheets()[0];
  var gen = { programName: o.name, passMark: conf.template.passMark };
  if (o.reviewChatId) gen.reviewChatId = o.reviewChatId;
  if (o.regLink) gen.regSpreadsheetId = o.regLink;
  if (o.regFormUrl) gen.regFormUrl = o.regFormUrl;
  if (o.restDays !== undefined) gen.restDays = o.restDays;
  buildSettingsSheet_(ss, { quizzes: [], finalSheet: '', all: [] }, { activities: conf.template.activities, levels: o.levels || [], general: gen });
  ensureAuxSheets_(ss);
  if (first && first.getName() !== NAMES.SETTINGS && ss.getSheets().length > 1) { try { ss.deleteSheet(first); } catch (e) { /* تجاهل */ } }
  var id = ss.getId();
  markOwnedFile_(id);
  placeFile_(id);
  var shared = shareWithTenant_(id);
  return { id: id, url: 'https://docs.google.com/spreadsheets/d/' + id + '/edit', title: title, shared: shared };
}

/** يسجل البرنامج في «البرامج» داخل قفل العميل مع فحص الحصة والمعرّف */
function registerProgram_(pid, name, url, open, note) {
  var lock = tenantLock_();
  lock.waitLock(25000);
  try {
    var q = quotaError_();
    if (q) return { error: q };
    if (getPrograms_().some(function (p) { return p.id.toLowerCase() === pid.toLowerCase(); })) return { error: 'المعرّف «' + pid + '» مستعمل لبرنامج آخر.' };
    central_().getSheetByName(BOT.PROGRAMS).appendRow([pid, name, url, open ? OPT.YES : OPT.NO, note || '']);
    invalidateProgram_(pid);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/**
 * ينسخ ملف درجات برنامج لبرنامج جديد (في مجلد المصدر إن أمكن، وإلا مجلد العميل) ويجهزه.
 * يعيد {id, url, title, folder, cleared, dropped, warnings}
 */
function copyProgramSpreadsheet(srcId, o) {
  var src = SpreadsheetApp.openById(srcId), title = 'درجات ' + o.name, folder = null;
  try { var it = DriveApp.getFileById(srcId).getParents(); if (it.hasNext()) folder = it.next(); } catch (e) { folder = null; }
  var dst = SpreadsheetApp.create(title), blank = dst.getSheets()[0];
  src.getSheets().forEach(function (sh) {
    var c = sh.copyTo(dst);
    c.setName(sh.getName());
  });
  if (blank && dst.getSheets().length > 1) { try { dst.deleteSheet(blank); } catch (e) { /* تجاهل */ } }
  var id = dst.getId();
  if (TENANT_) markOwnedFile_(id);
  var placed = placeFile_(id, folder) || placeFile_(id), warnFolder = '';
  if (folder && placed !== folder) warnFolder = 'تعذر الحفظ في مجلد المصدر «' + folder.getName() + '»، فحُفظت النسخة في مجلد العميل.';
  var res;
  try { res = prepareCopiedProgram(SpreadsheetApp.openById(id), o); } catch (e) {
    throw new Error(e.message + '\n(أُنشئ الملف https://docs.google.com/spreadsheets/d/' + id + '/edit لكن لم يكتمل تجهيزه؛ احذفه ثم أعد المحاولة)');
  }
  if (warnFolder) res.warnings.unshift(warnFolder);
  res.shared = shareWithTenant_(id);
  res.id = id; res.url = 'https://docs.google.com/spreadsheets/d/' + id + '/edit'; res.title = title;
  res.folder = placed ? placed.getName() : 'My Drive';
  return res;
}

/** ملف تحكم جديد لعميل (يُنشأ من بوت المنصة) بأوراق البوت كلها */
function createControlSpreadsheet_(tenantName) {
  var ss = SpreadsheetApp.create('تحكم — ' + tenantName);
  var first = ss.getSheets()[0];
  function ensure(name, headers, color) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      try { sh.setRightToLeft(true); sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground(color).setFontColor('#ffffff'); sh.setFrozenRows(1); }
      catch (e) { sh.getRange(1, 1, 1, headers.length).setValues([headers]); }
    }
    return sh;
  }
  ensure(BOT.PROGRAMS, PROGRAM_HEADERS, '#1f4e5f');
  ensure(BOT.USERS, USER_HEADERS, '#3d7d4f');
  ensure(BOT.LOG, ['الوقت', 'الخطأ', 'السياق'], '#8a1c1c');
  ensure(ADMIN_SHEETS.ADMINS, ADMIN_HEADERS, '#6b4e8e');
  ensure(ADMIN_SHEETS.CHANGES, CHANGE_HEADERS, '#8a5a12');
  ensure(EVENTS.SHEET, EVENT_HEADERS, '#2f5d8a');
  if (first && ss.getSheets().length > 1) { try { ss.deleteSheet(first); } catch (e) { /* تجاهل */ } }
  return ss.getId();
}

// ===== QuizImport.gs =====
/**
 * QuizImport.gs — وحدة «📥 استيراد نتائج الاختبارات» (quizImport).
 * لكل مصدر: {pid, comp (مفتاح الاختبار كما في الإعدادات: «العنوان» أو «العنوان (المستوى)»), ssId, sheet, sig, last, stats}
 *  1) يقرأ ورقة ردود نموذج Google (اختبار) من ملفها بالمعرّف (يجب أن يشاركه العميل مع حساب الخدمة مشاهدًا).
 *  2) يجد عمودي البريد والدرجة بأنماط الاختبار نفسه في «الإعدادات» (نمط عمود البريد/الدرجة)، ويقبل «8 / 10».
 *  3) يوحّد البريد ويطبق «تصحيح البريد»، ويطابقه مع ملف التسجيل (للإحصاء فقط؛ غير المطابق يظهر كعادته في «بريد غير مطابق»).
 *  4) يكتب الصفوف في ورقة الاختبار (عمود «الورقة» للاختبار في المستوى الصحيح) داخل ملف درجات البرنامج،
 *     ولا يكتب فوق ورقة فيها بيانات يدوية لم تُنشئها الوحدة (تُعلَّم أوراقها بالبيانات الوصفية «quizImport»).
 *  5) يعيد حساب الدرجات ويطلق quiz_result_imported ثم grade_updated.
 * التشغيل: تلقائيًا كل ساعة إن تغيّر المصدر، أو فورًا بـ /quiz run.
 */
var QUIZ_META = 'quizImport';
var QUIZ_SCORE_FALLBACK = '^(النتيجة|score|total score|الدرجة|المجموع|النقاط|points)';

function quizSources_() { return moduleState_('quizImport').sources || []; }
function saveQuizSources_(list) { var s = moduleState_('quizImport'); s.sources = list; saveModuleState_('quizImport', s); }

/** «8 / 10» أو 8 أو «٨» ← 8؛ غير ذلك null */
function parseQuizScore_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var s = latinDigits_(str_(v)).replace(/[٫,]/g, '.');
  var m = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*(?:\/\s*\d+(?:\.\d+)?)?\s*$/);
  return m ? Number(m[1]) : null;
}

/** يجد الاختبار في إعدادات البرنامج بمفتاحه أو عنوانه (+ المستوى) */
function findComponent_(cfg, ref) {
  ref = str_(ref);
  var hit = cfg.components.filter(function (c) { return c.key === ref; });
  if (!hit.length) hit = cfg.components.filter(function (c) { return c.title === ref; });
  return hit.length === 1 ? hit[0] : null;
}

/**
 * يستورد مصدرًا واحدًا. force = تجاهل توقيع التغيّر. يعيد {skipped} أو {ok, rows, matched, unmatched, invalid} أو {error}
 */
function importQuizSource_(src, force) {
  var prog = loadProgram_(src.pid);
  if (!prog) return { error: 'البرنامج «' + src.pid + '» غير موجود.' };
  var pss = openSS_(prog.ssId), cfg = parseSettings(pss.getSheetByName(NAMES.SETTINGS).getDataRange().getValues());
  var c = findComponent_(cfg, src.comp);
  if (!c) return { error: 'لم أجد الاختبار «' + src.comp + '» في إعدادات «' + (prog.name || prog.id) + '». المتاح: ' + (cfg.components.map(function (x) { return x.key; }).join('، ') || 'لا اختبارات') };
  var sss;
  try { sss = SpreadsheetApp.openById(src.ssId); } catch (e) { return { error: 'تعذر فتح ملف ردود الاختبار. شاركه مع ' + serviceEmail_() + ' (مشاهد يكفي).' }; }
  var ssh = src.sheet ? sss.getSheetByName(src.sheet) : sss.getSheets()[0];
  if (!ssh) return { error: 'الورقة «' + src.sheet + '» غير موجودة في ملف الردود.' };
  var v = ssh.getDataRange().getValues();
  if (!v.length) return { error: 'ملف الردود فارغ.' };
  var h = v[0], ei = findColumn(h, c.emailPattern), si = findColumn(h, c.scorePattern);
  if (si < 0) si = findColumn(h, QUIZ_SCORE_FALLBACK);
  if (ei < 0 || si < 0) return { error: 'لم أجد ' + (ei < 0 ? 'عمود البريد' : 'عمود الدرجة') + ' في ملف الردود (العناوين: ' + h.join('، ') + ').' };
  var emailHdr = str_(h[ei]), scoreHdr = str_(h[si]);
  if (findColumn([scoreHdr], c.scorePattern) < 0) scoreHdr = 'النتيجة';
  if (findColumn([scoreHdr], c.scorePattern) < 0) return { error: 'عنوان عمود الدرجة لا يطابق «نمط عمود الدرجة» للاختبار (' + c.scorePattern + '). عدّل النمط في الإعدادات.' };
  var last = v.length > 1 ? JSON.stringify(v[v.length - 1]).slice(0, 300) : '';
  var sig = v.length + '|' + last.length + '|' + last.slice(-60);
  if (!force && src.sig === sig) return { skipped: true };
  var corr = getCorrections_(prog), regMap = null;
  try { regMap = getRegMap_(prog, false).map; } catch (e) { regMap = null; }
  var ti = findColumn(h, 'طابع|timestamp|الوقت');
  var rows = [], matched = 0, unmatched = 0, invalid = 0, seen = {};
  for (var i = 1; i < v.length; i++) {
    var email = applyCorrection(corr, normalizeEmail(v[i][ei])), score = parseQuizScore_(v[i][si]);
    if (!isValidEmail(email) || score == null) { invalid++; continue; }
    rows.push([ti >= 0 ? v[i][ti] : '', email, score]);
    if (!seen[email]) { seen[email] = 1; if (regMap && regMap[email] != null) matched++; else unmatched++; }
  }
  var tsh = pss.getSheetByName(c.sheet);
  if (tsh && tsh.getLastRow() > 1) {
    var ours = (tsh.getDeveloperMetadata() || []).some(function (m) { return m.getKey() === QUIZ_META; });
    if (!ours) return { error: 'ورقة «' + c.sheet + '» فيها بيانات لم تستوردها هذه الوحدة؛ لم أكتب فوقها. غيّر «الورقة» للاختبار في الإعدادات إلى اسم جديد، أو أفرغها.' };
  }
  if (!tsh) tsh = pss.insertSheet(c.sheet);
  var lock = tenantLock_();
  lock.waitLock(25000);
  try {
    tsh.clear();
    var out = [['الطابع الزمني', emailHdr, scoreHdr]].concat(rows);
    tsh.getRange(1, 1, out.length, 3).setValues(out);
    if (!(tsh.getDeveloperMetadata() || []).some(function (m) { return m.getKey() === QUIZ_META; })) tsh.addDeveloperMetadata(QUIZ_META);
  } finally { lock.releaseLock(); }
  invalidateProgram_(prog.id);
  src.sig = sig; src.last = Date.now(); src.stats = { rows: rows.length, matched: matched, unmatched: unmatched, invalid: invalid };
  var stats = { comp: c.key, sheet: c.sheet, level: c.level || '', rows: rows.length, students: matched + unmatched, matched: matched, unmatched: unmatched, invalid: invalid, source: src.ssId };
  emitEvent_(EVENT_TYPES.QUIZ_RESULT_IMPORTED, prog.id, stats, 'quizImport');
  var calc = recalcProgram_(prog.id, 'quizImport');
  return { ok: true, rows: rows.length, students: matched + unmatched, matched: matched, unmatched: unmatched, invalid: invalid, comp: c.key, sheet: c.sheet, calc: calc };
}

/** مشغّل الساعة: يستورد ما تغيّر فقط، ضمن الميزانية */
function quizImportTick_(now, budgetEnd) {
  var list = quizSources_(), changed = false;
  list.forEach(function (src) {
    if (Date.now() > budgetEnd) return;
    try { var r = importQuizSource_(src, false); if (r.ok) changed = true; if (r.error) { src.error = r.error; changed = true; } else delete src.error; }
    catch (e) { logError_(e, 'quizImport ' + src.pid + ' ' + src.comp); }
  });
  if (changed) saveQuizSources_(list);
}

/** /quiz — قائمة المصادر وإدارتها (المالك فقط، والوحدة مفعّلة) */
function quizCommand_(ctx, text) {
  var rest = str_(text).replace(/^\/quiz(@\S+)?\s*/i, ''), sub = rest.split(/\s+/)[0].toLowerCase(), list = quizSources_();
  var back = [[{ text: '🧩 الوحدات', callback_data: 'MOD:' }, { text: '🏠 القائمة', callback_data: 'L' }]];
  if (sub === 'add') {
    var parts = rest.replace(/^add\s*/i, '').split('|').map(str_);
    if (parts.length < 3) return show_(ctx, 'الصيغة:\n/quiz add <معرّف البرنامج> | <الاختبار كما في الإعدادات> | <رابط ملف ردود الاختبار> [| اسم ورقة الردود]\nمثال:\n/quiz add p1 | اختبار 1 (المستوى الأول) | https://docs.google.com/spreadsheets/d/1AbC…/edit', back);
    var pid = parts[0], prog = loadProgram_(pid);
    if (!prog) return show_(ctx, '⚠️ لا يوجد برنامج بالمعرّف «' + pid + '».', back);
    var ssId = extractSpreadsheetId(parts[2]);
    if (!/^[A-Za-z0-9_-]{20,}$/.test(ssId)) return show_(ctx, '⚠️ هذا ليس رابط ملف Google Sheets.', back);
    var cfg = parseSettings(openSS_(prog.ssId).getSheetByName(NAMES.SETTINGS).getDataRange().getValues()), c = findComponent_(cfg, parts[1]);
    if (!c) return show_(ctx, '⚠️ لم أجد الاختبار «' + parts[1] + '». المتاح: ' + (cfg.components.map(function (x) { return x.key; }).join('، ') || 'لا اختبارات في «الإعدادات»'), back);
    if (list.some(function (s) { return s.pid === pid && s.comp === c.key; })) return show_(ctx, '⚠️ هذا الاختبار له مصدر من قبل. احذفه أولًا: /quiz del <الرقم>', back);
    var src = { pid: pid, comp: c.key, ssId: ssId, sheet: parts[3] || '' };
    var r = importQuizSource_(src, true);
    if (r.error) return show_(ctx, '⚠️ لم يُضف المصدر: ' + r.error, back);
    list.push(src); saveQuizSources_(list);
    logChange_(ctx.from, pid, 'الوحدات', 'quizImport', 'إضافة مصدر', '', c.key + ' ← ' + ssId);
    return show_(ctx, '✅ أُضيف المصدر واستُورد الآن:\n' + quizResultLine_(r), back);
  }
  if (sub === 'del') {
    var n = Number(latinDigits_(rest.split(/\s+/)[1] || '')) - 1;
    if (!(n >= 0 && n < list.length)) return show_(ctx, '⚠️ رقم غير صحيح. أرسل /quiz لترى الأرقام.', back);
    var gone = list.splice(n, 1)[0]; saveQuizSources_(list);
    logChange_(ctx.from, gone.pid, 'الوحدات', 'quizImport', 'حذف مصدر', gone.comp, '');
    return show_(ctx, '🗑 حُذف مصدر «' + gone.comp + '». (الورقة المستوردة باقية كما هي.)', back);
  }
  if (sub === 'run') {
    var lines = list.map(function (s) {
      var r; try { r = importQuizSource_(s, true); } catch (e) { r = { error: e.message }; }
      if (r.error) s.error = r.error; else delete s.error;
      return '• ' + s.pid + ' / ' + s.comp + ': ' + (r.error ? '⚠️ ' + r.error : quizResultLine_(r));
    });
    saveQuizSources_(list);
    return show_(ctx, clip(lines.length ? '📥 نتيجة الاستيراد:\n' + lines.join('\n') : 'لا مصادر بعد.'), back);
  }
  var L = ['📥 مصادر نتائج الاختبارات (' + list.length + '):'];
  list.forEach(function (s, i) {
    L.push((i + 1) + ') ' + s.pid + ' / ' + s.comp + (s.stats ? ' — ' + s.stats.rows + ' ردًا، مطابق ' + s.stats.matched : '') + (s.last ? ' — آخر استيراد ' + fmtTime(s.last) : '') + (s.error ? '\n   ⚠️ ' + s.error : ''));
  });
  L.push('', 'الأوامر:', '/quiz add <البرنامج> | <الاختبار> | <رابط الردود> [| الورقة]', '/quiz run (استيراد الآن)', '/quiz del <الرقم>',
    'شارك ملف الردود مع ' + serviceEmail_() + ' (مشاهد يكفي). يُستورد تلقائيًا كل ساعة عند تغيّره.');
  return show_(ctx, clip(L.join('\n')), back);
}

function quizResultLine_(r) {
  var nStu = r.students != null ? r.students : (Number(r.matched || 0) + Number(r.unmatched || 0));
  return r.comp + ' ← ورقة «' + r.sheet + '»: ' + r.rows + ' ردًا من ' + nStu + ' طالب، مطابقون للتسجيل ' + r.matched + '، غير مطابقين ' + r.unmatched + (r.invalid ? '، صفوف بلا بريد/درجة ' + r.invalid : '') +
    (r.calc && r.calc.error ? '\n⚠️ الحساب: ' + r.calc.error : r.calc ? '\n🧮 أُعيد الحساب: ' + r.calc.passers + ' مجتاز' : '');
}

// ===== Reject.gs =====
/**
 * Reject.gs — رفض التسليم من مجموعة المراجعة (v6) وإشعارات التعديل والحذف فيها.
 *  • تحت سطر تعريف كل تسليم جديد: «❌ رفض» و«❌ رفض مع ملاحظة» (للمالك ومشرفي البرنامج فقط؛ غيرهم يرى تنبيهًا).
 *  • الملاحظة: يرد المشرف على رسالة البوت (force_reply) في المجموعة، أو يرسلها للبوت في الخاص خلال 30 دقيقة.
 *  • بعد الرفض يصير الزر «↩️ تراجع عن الرفض». الرفض = الحالة «مرفوض» + السبب ومن رفض ومتى؛ يخرج من العد والدرجة.
 * رسائل المجموعة القديمة (بلا أزرار) تبقى كما هي، والرد على التسليم (Reply) يعمل كما كان.
 */
var REJ = { PROMPT_TTL: 3600, PRIVATE_TTL: 1800 };

function rejectKeyboard_(prog) { return studentOptions(prog && prog.general).rejectButtons ? [[{ text: '❌ رفض', callback_data: 'rj' }, { text: '❌ رفض مع ملاحظة', callback_data: 'rn' }]] : null; }
function undoKeyboard_() { return [[{ text: '↩️ تراجع عن الرفض', callback_data: 'ru' }]]; }
function whoName_(from) { return [from.first_name, from.last_name].filter(Boolean).join(' ') || String(from.id); }
function stripStatus_(text) { return String(text || '').replace(/\n\n(❌ مرفوض|↩️ أُلغي الرفض)[\s\S]*$/, ''); }

/** زر في رسالة تسليم بالمجموعة: rj | rn | ru */
function onReviewButton_(q, act) {
  var group = String(q.message.chat.id), mid = q.message.message_id;
  var info = findReviewMap_(group, mid);
  if (!info) return answerCallback_(q.id, 'لم أجد هذا التسليم في السجل.', true);
  if (q.from && q.from.username === 'GroupAnonymousBot') return answerCallback_(q.id, '⚠️ أنت «مشرف مجهول الهوية»؛ أوقفها ثم أعد الضغط.', true);
  var adm = adminInfo_(q.from.id);
  if (!adm || !canAccess_(adm, info.p)) return answerCallback_(q.id, '⛔ الرفض لمالك البوت ومشرفي هذا البرنامج فقط.', true);
  var hdr = { chat: group, mid: mid, text: q.message.text || '' };
  if (act === 'rj') {
    var r = doReject_(info, q.from, '', hdr);
    return answerCallback_(q.id, r.error ? '⚠️ ' + r.error : '❌ رُفض التسليم' + (r.notified === false ? ' (تعذر إبلاغ الطالب)' : ' وأُبلغ الطالب'), !!r.error);
  }
  if (act === 'ru') {
    var u = doUnreject_(info, q.from, hdr);
    return answerCallback_(q.id, u.error ? '⚠️ ' + u.error : '↩️ أُلغي الرفض وعادت الدرجة', !!u.error);
  }
  // rn: طلب السبب
  var st0 = subStatus_(info);
  if (st0.error) return answerCallback_(q.id, '⚠️ ' + st0.error, true);
  answerCallback_(q.id, 'اكتب سبب الرفض ردًّا على رسالة البوت');
  var who = q.from.username ? '@' + q.from.username + ' ' : '';
  var pr = tg_('sendMessage', { chat_id: group, text: who + '✍️ اكتب سبب رفض تسليم ' + (info.name || 'الطالب') + ' رقم ' + info.n + ' في «' + info.a + '» ردًّا على هذه الرسالة.\n(أو أرسله لبوت التسليمات في الخاص خلال 30 دقيقة، و/cancel هناك للتراجع.)',
    reply_parameters: { message_id: mid, allow_sending_without_reply: true },
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: 'سبب الرفض' } });
  var pend = JSON.stringify({ info: info, hdr: hdr, by: String(q.from.id) });
  if (pr.ok && pr.result) cache_().put('rjp:' + group + ':' + pr.result.message_id, pend, REJ.PROMPT_TTL);
  cache_().put('rjpu:' + q.from.id, pend, REJ.PRIVATE_TTL);
}

/** رد المشرف على رسالة طلب السبب في المجموعة؛ يعيد true إن كانت رسالة سبب */
function onRejectReasonInGroup_(m) {
  var key = 'rjp:' + m.chat.id + ':' + m.reply_to_message.message_id, c = cache_().get(key);
  if (!c) return false;
  var pend = JSON.parse(c), adm = adminInfo_(m.from.id);
  if (!adm || !canAccess_(adm, pend.info.p)) return true; // غير مشرف: تجاهل بصمت
  var reason = str_(m.text || m.caption);
  var rp = { message_id: m.message_id, allow_sending_without_reply: true };
  if (!reason) { tg_('sendMessage', { chat_id: m.chat.id, text: '⚠️ اكتب سبب الرفض نصًّا ردًّا على رسالة البوت.', reply_parameters: rp }); return true; }
  var r = doReject_(pend.info, m.from, reason, pend.hdr);
  cache_().remove(key); cache_().remove('rjpu:' + pend.by);
  if (r.error) tg_('sendMessage', { chat_id: m.chat.id, text: '⚠️ لم يُرفض: ' + r.error, reply_parameters: rp });
  else tg_('setMessageReaction', { chat_id: m.chat.id, message_id: m.message_id, reaction: [{ type: 'emoji', emoji: '👍' }] }, true);
  return true;
}

/** السبب يُرسل في الخاص؛ يعيد true إن عولجت الرسالة */
function onRejectReasonPrivate_(m, uid, text) {
  var c = cache_().get('rjpu:' + uid);
  if (!c) return false;
  var pend = JSON.parse(c);
  cache_().remove('rjpu:' + uid);
  var adm = adminInfo_(uid);
  if (!adm || !canAccess_(adm, pend.info.p)) return false;
  if (!text) { cache_().put('rjpu:' + uid, c, REJ.PRIVATE_TTL); send_(m.chat.id, '⚠️ اكتب سبب الرفض نصًّا، أو /cancel للتراجع.'); return true; }
  var r = doReject_(pend.info, m.from, text, pend.hdr);
  send_(m.chat.id, r.error ? '⚠️ لم يُرفض: ' + r.error : '❌ رُفض تسليم ' + (pend.info.name || 'الطالب') + ' رقم ' + pend.info.n + ' في «' + pend.info.a + '» بالسبب:\n' + text + (r.notified === false ? '\n(تعذر إبلاغ الطالب)' : '\nوأُبلغ الطالب.'));
  return true;
}

function progOf_(pid) { return getPrograms_().filter(function (x) { return x.id === pid; })[0] || null; }

/** حالة التسليم الآن (للتحقق قبل طلب السبب) */
function subStatus_(info) {
  var p = progOf_(info.p);
  var sh = p && openSS_(p.ssId).getSheetByName(NAMES.SUBMISSIONS);
  if (!sh || !info.subId) return { error: 'لم أجد التسليم في الورقة.' };
  var f = subRows_(sh, info.subId);
  if (!f.rows.length) return { error: 'لم أجد التسليم في الورقة.' };
  var s = str_(f.rows[0].v[f.h.indexOf('الحالة')]) || SUB_ST.OK;
  if (s === SUB_ST.DEL) return { error: 'حذف الطالب هذا التسليم.' };
  if (s === SUB_ST.REJ) return { error: 'هذا التسليم مرفوض من قبل.' };
  return { status: s };
}

/** يكتب الرفض أو يلغيه في كل صفوف التسليم (داخل القفل) */
function setSubStatus_(info, reject, reason, from) {
  var p = progOf_(info.p);
  if (!p) return { error: 'البرنامج غير موجود.' };
  var lock = tenantLock_();
  lock.waitLock(25000);
  try {
    var sh = openSS_(p.ssId).getSheetByName(NAMES.SUBMISSIONS);
    if (!sh || !info.subId) return { error: 'لم أجد التسليم في الورقة.' };
    var h = ensureSubColumns_(sh, [SUB_EXTRA.REASON, SUB_EXTRA.BY, SUB_EXTRA.AT]), f = subRows_(sh, info.subId), W = h.length;
    if (!f.rows.length) return { error: 'لم أجد التسليم في الورقة.' };
    var ist = h.indexOf('الحالة'), cur = str_(f.rows[0].v[ist]) || SUB_ST.OK, now = new Date();
    if (cur === SUB_ST.DEL) return { error: 'حذف الطالب هذا التسليم.' };
    if (reject && cur === SUB_ST.REJ) return { error: 'هذا التسليم مرفوض من قبل.' };
    if (!reject && cur !== SUB_ST.REJ) return { error: 'هذا التسليم غير مرفوض الآن.' };
    var email = normalizeEmail(f.rows[0].v[h.indexOf('البريد')]), who = whoName_(from) + ' (' + from.id + ')';
    f.rows.forEach(function (r) {
      var v = r.v.slice(); while (v.length < W) v.push('');
      if (str_(v[ist]) === SUB_ST.DEL) return;
      v[ist] = reject ? SUB_ST.REJ : SUB_ST.OK;
      v[h.indexOf(SUB_EXTRA.REASON)] = reject ? safeText_(reason) : '';
      v[h.indexOf(SUB_EXTRA.BY)] = reject ? who : '';
      v[h.indexOf(SUB_EXTRA.AT)] = reject ? now : '';
      if (!reject) { var ni = h.indexOf('ملاحظة'); v[ni] = (str_(v[ni]) ? str_(v[ni]) + ' • ' : '') + 'رُفض ثم أُلغي الرفض (' + who + ' ' + fmtTime(now) + ')'; }
      writeRow_(sh, r.r, v, W);
    });
    forgetMine_(info.p, email);
    emitEvent_(EVENT_TYPES.SUBMISSION_REJECTED, info.p, { subId: info.subId, email: email, activity: info.a, n: info.n, rejected: !!reject, reason: reject ? safeText_(reason) : '' }, from.id);
    return { ok: true, prog: p };
  } finally { lock.releaseLock(); }
}

function doReject_(info, from, reason, hdr) {
  var r = setSubStatus_(info, true, reason, from);
  if (r.error) return r;
  var prog = loadProgram_(info.p);
  var txt = stripStatus_(hdr.text) + '\n\n❌ مرفوض — ' + whoName_(from) + ' ' + fmtTime(Date.now()) + (reason ? '\nالسبب: ' + reason : '');
  if (hdr.text) tg_('editMessageText', { chat_id: hdr.chat, message_id: hdr.mid, text: clip(txt), reply_markup: { inline_keyboard: undoKeyboard_() } }, true);
  else tg_('editMessageReplyMarkup', { chat_id: hdr.chat, message_id: hdr.mid, reply_markup: { inline_keyboard: undoKeyboard_() } }, true);
  var notified = null;
  if (studentOptions(prog && prog.general).notifyReject && info.chat) {
    var o = studentOptions(prog.general);
    var n = tg_('sendMessage', { chat_id: info.chat, text: '❌ رُفض تسليمك رقم ' + info.n + ' في «' + info.a + '»' + (reason ? '\nالسبب: ' + reason : '') + '\nلا تُحتسب درجته.' +
      (o.allowEdit && o.showSubs ? '\nيمكنك تعديله وإعادة إرساله من /mysubs' : ''), reply_parameters: info.msg ? { message_id: Number(info.msg), allow_sending_without_reply: true } : undefined });
    notified = !!n.ok;
  }
  return { ok: true, notified: notified };
}

function doUnreject_(info, from, hdr) {
  var r = setSubStatus_(info, false, '', from);
  if (r.error) return r;
  var prog = loadProgram_(info.p), kb = rejectKeyboard_(prog) || [];
  var txt = stripStatus_(hdr.text) + '\n\n↩️ أُلغي الرفض — ' + whoName_(from) + ' ' + fmtTime(Date.now());
  if (hdr.text) tg_('editMessageText', { chat_id: hdr.chat, message_id: hdr.mid, text: clip(txt), reply_markup: { inline_keyboard: kb } }, true);
  else tg_('editMessageReplyMarkup', { chat_id: hdr.chat, message_id: hdr.mid, reply_markup: { inline_keyboard: kb } }, true);
  if (studentOptions(prog && prog.general).notifyReject && info.chat)
    tg_('sendMessage', { chat_id: info.chat, text: '↩️ أُلغي رفض تسليمك رقم ' + info.n + ' في «' + info.a + '»، وعادت درجته.', reply_parameters: info.msg ? { message_id: Number(info.msg), allow_sending_without_reply: true } : undefined });
  return { ok: true };
}

/* ───────── إشعار المجموعة بتعديل أو حذف ───────── */

/** رسائل المجموعة المرتبطة بتسليم (الأحدث آخرًا) */
function reviewMessagesOf_(subId) {
  var c = cache_().get('rvs:' + subId);
  if (c) return JSON.parse(c);
  var sh = central_().getSheetByName(REVIEW_MAP.SHEET), out = [];
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, REVIEW_MAP_HEADERS.length + 1).getValues().forEach(function (r) {
      if (str_(r[7]) === subId) out.push({ g: str_(r[2]), m: Number(r[3]), h: str_(r[13]) === '1' ? 1 : 0 });
    });
  }
  cache_().put('rvs:' + subId, JSON.stringify(out), REVIEW_MAP.TTL);
  return out;
}

/** يبلغ مجموعة المراجعة بتعديل الطالب (مع نسخة المحتوى الجديد وأزرار الرفض) أو بحذفه — ردًّا على رسالة التسليم الأصلية */
function notifyReviewChange_(prog, sub, st, kind, m, wasRejected) {
  try {
    var chat = prog.general.reviewChatId;
    var msgs = reviewMessagesOf_(sub.id);
    if (!chat && !msgs.length) return;
    var hdrs = msgs.filter(function (x) { return x.h; }), anchor = (hdrs.length ? hdrs : msgs).slice(-1)[0];
    var target = chat || (anchor && anchor.g);
    if (!target) return;
    var text = (kind === 'edit' ? '✏️ عدّل ' : '🗑 حذف ') + (st.name || st.email) + ' تسليمه رقم ' + sub.n + ' في «' + sub.act + '»' + (sub.level ? ' (' + sub.level + ')' : '') +
      (kind === 'edit' ? (wasRejected ? ' (كان مرفوضًا، فعاد مقبولًا)' : '') + '\nالمحتوى الجديد تحت هذه الرسالة. ↩️ للرد على الطالب اضغط «رد».' : '\nخرج من الدرجات.');
    var p = { chat_id: target, text: text, disable_web_page_preview: true };
    if (anchor && String(anchor.g) === String(target)) p.reply_parameters = { message_id: anchor.m, allow_sending_without_reply: true };
    var kb = kind === 'edit' ? rejectKeyboard_(prog) : null;
    if (kb) p.reply_markup = { inline_keyboard: kb };
    var h = tg_('sendMessage', p), ids = [];
    if (h.ok && h.result) ids.push(h.result.message_id);
    if (kind === 'edit' && m) { var c = tg_('copyMessage', { chat_id: target, from_chat_id: m.chat.id, message_id: m.message_id }); if (c.ok && c.result) ids.push(c.result.message_id); }
    // أزرار الرسائل القديمة لهذا التسليم لم تعد صالحة
    hdrs.forEach(function (x) { tg_('editMessageReplyMarkup', { chat_id: x.g, message_id: x.m, reply_markup: { inline_keyboard: [] } }, true); });
    if (ids.length && kind === 'edit') {
      saveReviewMap_(target, ids, { p: prog.id, a: sub.act, n: sub.n, subId: sub.id, chat: m.chat.id, uid: m.from && m.from.id, msg: m.message_id, email: st.email, name: st.name || '' }, ids[0]);
    }
  } catch (e) { logError_(e, 'review change ' + kind); }
}

// ===== RemindCore.gs =====
/**
 * RemindCore.gs — منطق التذكيرات الآلية (v7) بلا خدمات Google: ورقة «المواعيد»، والإغلاق بالموعد،
 * وخيارات التذكير، والقوالب، وتخطيط من يُذكَّر ومتى (planReminders).
 * كل أنواع التذكير موقوفة افتراضيًا (البنود الغائبة من ورقة قديمة = «لا»).
 */
var SCHEDULE_SHEET = 'المواعيد';
var SCHEDULE_FIELDS = [
  ['item', 'العنصر', 170], ['level', 'المستوى', 110], ['start', 'يبدأ في', 140], ['deadline', 'آخر موعد', 140],
  ['close', 'إغلاق بعد الموعد', 110], ['link', 'رابط الاختبار (اختياري)', 220], ['note', 'ملاحظة', 200]
];
var REMIND_LOG = 'سجل التذكيرات';
var REMIND_LOG_HEADERS = ['الوقت', 'البرنامج', 'النوع', 'المفتاح', 'البريد', 'المحادثة', 'النتيجة', 'ملاحظة'];
var REMIND_OFF = 'إيقاف التذكيرات';
var REMIND_OFF_HEADERS = ['معرف المستخدم', 'الحالة', 'الوقت', 'ملاحظة'];
var RST = { SENT: 'أُرسل', FAIL: 'فشل', BLOCKED: 'محظور', SKIP: 'تخطي' };
var RTYPE_LABEL = { open: 'إعلان الفتح', before: 'قبل الموعد', missed: 'فوات الموعد', risk: 'تنبيه التعثر', idle: 'الانقطاع', manual: 'يدوي' };
var TPL_KEYS = { open: 'tplOpen', before: 'tplBefore', missed: 'tplMissed', risk: 'tplRisk', idle: 'tplIdle', manual: 'tplManual' };
var TEMPLATE_VARS = ['الاسم', 'الفعالية', 'الموعد', 'المتبقي', 'المستوى', 'التعويض'];
var HOUR_MS = 3600000, DAY_MS = 86400000;

/* ───────── ورقة «المواعيد» ───────── */

/** آخر موعد بلا ساعة (00:00) = نهاية ذلك اليوم 23:59 */
function deadlineValue_(v) {
  var t = dateValue_(v);
  if (t == null || t === undefined) return t;
  var d = new Date(t);
  return d.getHours() === 0 && d.getMinutes() === 0 ? t + DAY_MS - 60000 : t;
}

/**
 * يقرأ ورقة «المواعيد» ويربط كل صف بفعالية أو اختبار من الإعدادات.
 * يعيد { items: [{r, key, title, level, kind, s, d, c, link, id, prevD}], warnings }
 */
function parseSchedule(values, cfg) {
  var out = { items: [], warnings: [] };
  if (!values || values.length < 2) return out;
  var h = values[0].map(str_), col = {};
  SCHEDULE_FIELDS.forEach(function (f) { col[f[0]] = h.indexOf(f[1]); });
  if (col.item < 0) { out.warnings.push('ورقة «' + SCHEDULE_SHEET + '»: لا عمود «' + SCHEDULE_FIELDS[0][1] + '».'); return out; }
  var known = {};
  (cfg.activities || []).forEach(function (a) { known[a.key] = { kind: 'activity', title: a.title, level: a.level || '' }; });
  (cfg.components || []).forEach(function (c) { if (!known[c.key]) known[c.key] = { kind: 'component', title: c.title, level: c.level || '' }; });
  var get = function (row, k) { return col[k] >= 0 ? row[col[k]] : ''; };
  for (var r = 1; r < values.length; r++) {
    var row = values[r] || [], title = str_(get(row, 'item'));
    if (!title) continue;
    var level = str_(get(row, 'level')), key = level ? title + ' (' + level + ')' : title, k = known[key];
    var where = '«' + SCHEDULE_SHEET + '» صف ' + (r + 1) + ': ';
    if (!k) { out.warnings.push(where + '«' + key + '» ليس فعالية ولا اختبارًا في الإعدادات.'); continue; }
    var s = dateValue_(get(row, 'start')), d = deadlineValue_(get(row, 'deadline'));
    if (s === undefined) { out.warnings.push(where + 'تاريخ البدء غير مفهوم: ' + str_(get(row, 'start')) + ' (مثال: 2026-11-20 18:00)'); continue; }
    if (d === undefined) { out.warnings.push(where + 'آخر موعد غير مفهوم: ' + str_(get(row, 'deadline')) + ' (مثال: 2026-11-27)'); continue; }
    if (s == null && d == null) { out.warnings.push(where + 'لا تاريخ بدء ولا آخر موعد.'); continue; }
    if (s != null && d != null && d <= s) { out.warnings.push(where + 'آخر موعد قبل تاريخ البدء.'); continue; }
    out.items.push({ r: r + 1, key: key, title: k.title, level: k.level, kind: k.kind, s: s, d: d, c: isYes_(get(row, 'close')),
      link: str_(get(row, 'link')), id: key + '@' + fmtTime(d != null ? d : s) });
  }
  // بداية النافذة الفعلية لمن لم يحدد «يبدأ في»: آخر موعد سابق للعنصر نفسه
  var byKey = {};
  out.items.slice().sort(function (a, b) { return (a.d || a.s) - (b.d || b.s); }).forEach(function (it) {
    it.prevD = byKey[it.key] != null ? byKey[it.key] : null;
    if (it.d != null) byKey[it.key] = it.d;
  });
  return out;
}

/** بداية النافذة: «يبدأ في»، أو الموعد السابق للعنصر نفسه، أو بلا حد */
function windowStart(it) { return it.s != null ? it.s : (it.prevD != null ? it.prevD : -Infinity); }

/**
 * هل الفعالية مغلقة الآن؟ الإيقاف المؤقت، أو المواعيد التي «إغلاق بعد الموعد = نعم» (النوافذ المغلقة تحدد وقت الإتاحة).
 * a.sched = [{s, d, c}] (يضيفه loadProgram_؛ الغائب من ذاكرة v6 = بلا مواعيد). يعيد null أو {kind, from, until, deadline}
 */
function closedState(a, now) {
  var p = pauseState(a, now);
  if (p) { p.kind = 'pause'; return p; }
  var w = ((a && a.sched) || []).filter(function (x) { return x.c; });
  if (!w.length) return null;
  if (w.some(function (x) { return (x.s == null || now >= x.s) && (x.d == null || now < x.d); })) return null;
  var next = w.filter(function (x) { return x.s != null && x.s > now; }).sort(function (x, y) { return x.s - y.s; })[0];
  if (next) return { kind: 'notyet', from: next.s, until: next.s };
  var last = w.filter(function (x) { return x.d != null && x.d <= now; }).sort(function (x, y) { return y.d - x.d; })[0];
  return { kind: 'deadline', deadline: last ? last.d : null, until: null };
}

/** رسالة الطالب لفعالية مغلقة */
function closedMessage(a, cs) {
  if (cs.kind === 'notyet') return 'التسليم في «' + a.title + '» لم يُفتح بعد؛ يبدأ في ' + fmtTime(cs.from) + '.';
  if (cs.kind === 'deadline') return 'انتهى موعد التسليم في «' + a.title + '»' + (cs.deadline ? ' (' + fmtTime(cs.deadline) + ')' : '') + '.';
  return 'فعالية «' + a.title + '» موقوفة مؤقتًا' + (cs.until ? ' حتى ' + fmtTime(cs.until) : '') + '، فلا يمكن التسليم فيها الآن.';
}

/* ───────── الخيارات والقوالب ───────── */

/** «3ي، 1ي، 3س» ← [{ms, label, day}] مرتبة من الأبعد للأقرب، أو {error} */
function parseOffsets(text) {
  var s = latinDigits_(str_(text));
  if (!s || CLEAR_WORDS_R_.indexOf(s) >= 0) return [];
  var out = [], bad = null;
  s.split(/[\s،,;؛]+/).filter(String).forEach(function (t) {
    var m = t.match(/^(\d+(?:\.\d+)?)\s*(ي|يوم|أيام|ايام|d|س|ساعة|ساعات|h)$/i);
    if (!m || Number(m[1]) <= 0) { bad = bad || t; return; }
    var day = /^(ي|يوم|أيام|ايام|d)$/i.test(m[2]);
    out.push({ ms: Number(m[1]) * (day ? DAY_MS : HOUR_MS), label: m[1] + (day ? 'ي' : 'س'), day: day });
  });
  if (bad) return { error: '«' + bad + '» غير مفهوم. اكتب أعدادًا متبوعة بـ «ي» (يوم) أو «س» (ساعة) بينها فاصلة، مثل: 3ي، 1ي، 3س' };
  var seen = {};
  return out.filter(function (o) { if (seen[o.ms]) return false; seen[o.ms] = 1; return true; }).sort(function (a, b) { return b.ms - a.ms; });
}
var CLEAR_WORDS_R_ = ['-', 'فارغ', 'بدون', 'لا شيء', 'لا يوجد'];

/** «23-8» ← {from: 23, to: 8}؛ «-» ← null؛ أو {error} */
function parseQuiet(text) {
  var s = latinDigits_(str_(text));
  if (!s || CLEAR_WORDS_R_.indexOf(s) >= 0) return null;
  var m = s.replace(/^'/, '').match(/^(\d{1,2})\s*(?:-|–|—|إلى|الى|حتى)\s*(\d{1,2})$/);
  if (!m || +m[1] > 23 || +m[2] > 23 || +m[1] === +m[2]) return { error: 'اكتب ساعتين من 0 إلى 23 بينهما «إلى» أو شرطة: بداية الهدوء ثم نهايته، مثل 23 إلى 8 (من 11 ليلًا إلى 8 صباحًا)، أو «-» لبلا هدوء.' };
  return { from: +m[1], to: +m[2] };
}
function inQuiet(hour, q) { return !!q && (q.from < q.to ? hour >= q.from && hour < q.to : hour >= q.from || hour < q.to); }

/** يتحقق من قالب رسالة: المتغيرات المعروفة فقط */
function checkTemplate(text) {
  var s = String(text || ''), bad = [];
  (s.match(/\{[^{}]*\}/g) || []).forEach(function (v) { if (TEMPLATE_VARS.indexOf(v.slice(1, -1).trim()) < 0) bad.push(v); });
  if (bad.length) return 'متغير غير معروف: ' + bad.join('، ') + '. المتاح: ' + TEMPLATE_VARS.map(function (v) { return '{' + v + '}'; }).join(' ');
  if (s.length > 1000) return 'النص أطول من 1000 حرف.';
  if (!str_(s)) return 'النص فارغ.';
  return null;
}

/** يملأ القالب؛ السطر الذي فيه متغير بلا قيمة يُحذف */
function fillTemplate(tpl, vars) {
  return String(tpl).split('\n').map(function (line) {
    var empty = false;
    var out = line.replace(/\{([^{}]*)\}/g, function (m, k) { var v = vars[k.trim()]; if (v == null || v === '') { empty = true; return ''; } return String(v); });
    return empty ? null : out;
  }).filter(function (l) { return l !== null; }).join('\n').trim();
}

function reminderOptions(g) {
  g = g || {};
  var yn = function (k) { return isYes_(g[k]); };
  var def = function (k) { var f = GENERAL_FIELDS.filter(function (x) { return x[0] === k; })[0]; return f ? f[2] : ''; };
  var n = function (k, lo, hi) { var v = num_(g[k]); if (v == null || v < lo || v > hi) v = num_(def(k)); return v; };
  var offs = parseOffsets(g.remOffsets === undefined ? def('remOffsets') : g.remOffsets); if (offs.error) offs = parseOffsets(def('remOffsets'));
  var q = parseQuiet(g.remQuiet === undefined ? def('remQuiet') : g.remQuiet); if (q && q.error) q = parseQuiet(def('remQuiet'));
  var tpl = {};
  Object.keys(TPL_KEYS).forEach(function (t) { var v = str_(g[TPL_KEYS[t]]); tpl[t] = v && !checkTemplate(v) ? String(g[TPL_KEYS[t]]) : def(TPL_KEYS[t]); });
  var st = dateValue_(g.programStart), en = deadlineValue_(g.programEnd);
  return {
    on: yn('remindersOn'), open: yn('remOpen'), before: yn('remBefore'), missed: yn('remMissed'), risk: yn('remRisk'), idle: yn('remIdle'),
    offsets: offs, riskAt: n('remRiskAt', 1, 100), riskGap: n('remRiskGap', 0, 1e6), idleDays: n('remIdleDays', 1, 365),
    hour: Math.floor(n('remHour', 0, 23)), quiet: q, summary: ['المالك', 'المالك والمشرفون', 'لا أحد'].indexOf(str_(g.remSummary)) >= 0 ? str_(g.remSummary) : 'المالك',
    start: st == null || st === undefined ? null : st, end: en == null || en === undefined ? null : en, tpl: tpl
  };
}

/** مدة مقروءة: «يومان»، «3 ساعات» */
function fmtSpan(ms) {
  var d = Math.floor(ms / DAY_MS), h = Math.round(ms / HOUR_MS);
  var ar = function (n, one, two, few, many) { return n === 1 ? one : n === 2 ? two : n <= 10 ? n + ' ' + few : n + ' ' + many; };
  if (d >= 1) return ar(d, 'يوم واحد', 'يومان', 'أيام', 'يومًا');
  if (h >= 1) return ar(h, 'ساعة واحدة', 'ساعتان', 'ساعات', 'ساعة');
  return 'أقل من ساعة';
}

/* ───────── التخطيط ───────── */

function dayStart_(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
/** وقت إرسال تذكير يومي مرتبط بلحظة t: ساعة الإرسال في يوم t (ولا يسبق t نفسها) */
function dailyAt_(t, hour) { return Math.max(t, dayStart_(t) + hour * HOUR_MS); }

/** النقاط الناقصة للنجاح من نتيجة طالب في المحرك */
function pointsNeeded(st, g, multi) {
  if (!st || st.passed) return 0;
  var need = 0;
  if (!multi) need = g.passMark != null ? Math.max(0, g.passMark - st.final) : 0;
  else {
    var lv = 0; (st.levels || []).forEach(function (l) { if (l.passMark != null) lv += Math.max(0, l.passMark - l.final); });
    var ov = st.overallMark != null ? Math.max(0, st.overallMark - st.final) : 0;
    need = g.levelPassRule === OPT.LV_EACH ? lv : (g.levelPassRule === OPT.LV_TOTAL ? ov : Math.max(lv, ov));
  }
  return Math.round(need * 100) / 100;
}

/**
 * من يُذكَّر الآن (خالص). o = {
 *   now, opts (reminderOptions), prog {id, open, activities[{key,title,level,points,maxCount,bot,sched...}], levels},
 *   items (parseSchedule), students {email: {name, chat, levels: {lv:1}}}, subs {email: {byKey: {key: [t…]}, last}},
 *   done {'email|key': 1}, quizDone(email, key) → bool, needed(email) → رقم/null, manual [{id, itemId}], types (تقييد اختياري)
 * } يعيد [{type, key, email, chat, text, item, act}] — مع حقل skip لمن فات أوانه (يُسجَّل «تخطي» ولا يُرسل)
 */
function planReminders(o) {
  var now = o.now, op = o.opts, hour = new Date(now).getHours(), out = [], prog = o.prog;
  var quiet = inQuiet(hour, op.quiet);
  var manual = o.manual || [];
  if (!prog.open || quiet) return out;
  if (!op.on && !manual.length) return out;
  if (op.end != null && now > op.end + 3 * DAY_MS && !manual.length) return out;
  var multi = (prog.levels || []).length > 0;
  var emails = Object.keys(o.students);
  var actByKey = {}; (prog.activities || []).forEach(function (a, i) { actByKey[a.key] = { a: a, i: i }; });
  var submitted = function (email, it) {
    if (it.kind === 'component') return !!(o.quizDone && o.quizDone(email, it.key));
    var ts = ((o.subs[email] || {}).byKey || {})[it.key] || [], from = windowStart(it);
    return ts.some(function (t) { return t >= from; });
  };
  var inLevel = function (email, it) {
    if (!multi || !it.level) return true;
    var lv = o.students[email].levels || {};
    return !Object.keys(lv).length || !!lv[it.level];
  };
  var vars = function (email, it, extra) {
    var s = o.students[email];
    return Object.assign({ 'الاسم': s.name || '', 'الفعالية': it ? it.title : '', 'المستوى': it ? it.level : '', 'الموعد': it && it.d != null ? fmtTime(it.d) : '' }, extra || {});
  };
  var push = function (type, key, email, it, extra, skip) {
    if (o.done[email + '|' + key]) return;
    out.push({ type: type, key: key, email: email, chat: o.students[email].chat, item: it || null, skip: !!skip,
      text: skip ? '' : fillTemplate(op.tpl[type], vars(email, it, extra)) });
  };
  var want = function (t) { return op.on && op[t] && (!o.types || o.types.indexOf(t) >= 0); };
  var due = function (T, span) { return now >= T && now < T + span; };

  (o.items || []).forEach(function (it) {
    var A = actByKey[it.key];
    if (it.kind === 'activity' && (!A || pauseState(A.a, now))) return; // فعالية غير متاحة في البوت أو موقوفة مؤقتًا: لا تذكير
    // (أ) إعلان الفتح
    if (want('open') && it.s != null && (it.d == null || now < it.d) && due(dailyAt_(it.s, op.hour), 2 * DAY_MS))
      emails.forEach(function (e) { if (inLevel(e, it) && !submitted(e, it)) push('open', 'open@' + it.id, e, it); });
    // (ب) قبل الموعد: أحدث موعد حان فقط، وما سبقه دون إرسال يُسجَّل «تخطي»
    if (want('before') && it.d != null && now < it.d && now >= windowStart(it)) {
      var dueOffs = op.offsets.filter(function (f) {
        var t = it.d - f.ms, T = f.day ? dailyAt_(t, op.hour) : t;
        if (f.day && T >= it.d) T = t;
        return now >= T && (it.s == null || T >= it.s);
      });
      if (dueOffs.length) emails.forEach(function (e) {
        if (!inLevel(e, it) || submitted(e, it)) return;
        dueOffs.forEach(function (f, k) { push('before', 'before@' + it.id + '@' + f.label, e, it, { 'المتبقي': fmtSpan(it.d - now) }, k < dueOffs.length - 1); });
      });
    }
    // (ج) فوات الموعد
    if (want('missed') && it.d != null && due(dailyAt_(it.d, op.hour), 3 * DAY_MS))
      emails.forEach(function (e) {
        if (!inLevel(e, it) || submitted(e, it)) return;
        push('missed', 'missed@' + it.id, e, it, { 'التعويض': compensation_(o, e, it, now) });
      });
  });
  // (د) التعثر: مرة واحدة بعد نسبة من مدة البرنامج
  if (want('risk') && op.start != null && op.end != null && op.end > op.start && o.needed) {
    var tr = op.start + (op.end - op.start) * op.riskAt / 100;
    if (due(dailyAt_(tr, op.hour), 3 * DAY_MS)) emails.forEach(function (e) {
      if (o.done[e + '|risk']) return;
      var nd = o.needed(e);
      if (nd != null && nd > op.riskGap) push('risk', 'risk', e, null, { 'المتبقي': nd });
    });
  }
  // (هـ) الانقطاع: N يوم بلا تسليم (من آخر تسليم، أو من بداية البرنامج لمن لم يسلّم)
  if (want('idle') && (op.end == null || now <= op.end)) emails.forEach(function (e) {
    var last = (o.subs[e] || {}).last, from = last != null ? last : op.start;
    if (from == null || (op.start != null && now < op.start)) return;
    var T = dailyAt_(from + op.idleDays * DAY_MS, op.hour);
    if (now >= T) push('idle', 'idle@' + fmtTime(from).slice(0, 10), e, null, { 'المتبقي': fmtSpan(now - from) });
  });
  // يدوي («📣 أرسل تذكيرًا الآن»): لكل من لم يسلّم في العنصر
  manual.forEach(function (job) {
    var it = (o.items || []).filter(function (x) { return x.id === job.itemId; })[0] || job.item;
    if (!it) return;
    emails.forEach(function (e) { if (inLevel(e, it) && !submitted(e, it)) push('manual', 'manual@' + job.id, e, it); });
  });
  return out;
}

/** «يمكنك التعويض في: …» — فعاليات إضافية متاحة الآن في مستوى الطالب لم يبلغ حدها */
function compensation_(o, email, it, now) {
  var lvs = Object.keys((o.students[email] || {}).levels || {}), lv = it.level;
  var counts = (o.subs[email] || {}).byKey || {};
  var list = (o.prog.activities || []).filter(function (a) {
    if (a.key === it.key || !a.points || closedState(a, now)) return false;
    if (a.level && a.level !== lv && lvs.indexOf(a.level) < 0) return false;
    return a.maxCount == null || (counts[a.key] || []).length < a.maxCount;
  }).map(function (a) { return a.title; });
  return list.length ? 'يمكنك التعويض بالتسليم في: ' + list.slice(0, 6).join('، ') + '.' : '';
}

/** من يُذكَّر يدويًا بعنصر (للتأكيد قبل الإرسال) */
function manualRecipients(o, it) {
  var o2 = Object.assign({}, o, { opts: Object.assign({}, o.opts, { on: false, quiet: null }), manual: [{ id: 'preview', item: it, itemId: it.id }], done: {} });
  return planReminders(o2);
}