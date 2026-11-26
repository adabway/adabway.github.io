/**
 * منسّق الأوراد — مسودة كود (MiniAppWird.gs) — 25 نوفمبر 2026
 * تُنسخ إلى ملف جديد MiniAppWird.gs في مشروع «Adab SaaS Platform»، ثم تُنشر v40.
 *
 * التصميم (من القراءة الحرفية 25 نوفمبر):
 * - الناشر القائم dailyWird يقرأ ورقة «خطة الورد» في ملف البرنامج؛ صف لكل يوم.
 * - الصف القانوني (WIRD_FIELDS): [date, title, text, extra1..4, links, attach, attachType, slide, act, deadline, note]
 *   والتعيين إلى الأعمدة بالاسم لا بالموضع (رؤوس WIRD_HEADERS الأربعة عشر).
 * - الاستيراد القائم يستبدل الخطة كلها؛ المنسّق يضيف صفوفه إلحاقًا فقط، ويتخطّى أي
 *   تاريخ فيه صف قائم (الناشر ينشر صفًا واحدًا في اليوم، فالتداخل يُضيع وردًا).
 * - سجل المواد: ورقة جديدة في ملف البرنامج «المواد المنسقة»؛ صف لكل مادة + جدول أيامها JSON.
 * - أيام الراحة: إعداد برنامج نصي restDays (GENERAL_FIELDS + editable_() GENERAL) —
 *   أسماء أيام مفصولة بفواصل، الافتراضي «الجمعة»، وفارغ = بلا أيام راحة (قرارا M 22:22).
 * - المفتاح: YT_API_KEY محفوظ في خصائص السكربت (مشروع Madarij YouTube، 25 نوفمبر 23:09).
 * - صيغة نص الورد المرئي: صيغة واقعية مختصرة (عنوان المحاضرة + من mm:ss إلى mm:ss + رابط
 *   بالطابع الزمني) — لا قالب مفروض، تنفيذًا لقرار M (رسالة 956): قالب التذكير يحدده المستخدم.
 * - لا يُمسّ dailyWird ولا wirdTick_ ولا الاستيراد؛ test2 فقط؛ adab10 خارج كل تجريب.
 *
 * تحريرات ملفات قائمة (تُنفذ مع اللصق، في المهمة نفسها):
 *  E0) **تم التحقق 25 نوفمبر 23:26: المشروع يحرر القفل بـ lock.releaseLock() (وليس releaseLock_())
 *      — والمسودة صححت لذلك: var lock = tenantLock_(); ... lock.releaseLock(); في المواضع الثلاثة.**
 *  E1) Part2.gs GENERAL_FIELDS بعد سطر regFormUrl: ['restDays', 'أيام الراحة في البرنامج', 'الجمعة', null, 'أسماء أيام مفصولة بفواصل (مثال: الجمعة، السبت)؛ فارغ = بلا أيام راحة'],
 *  E2) Part1.gs editable_() GENERAL بعد ['regFormUrl', 'textOpt'],: ['restDays', 'textOpt'],
 *  E3) Part2.gs handleMiniAppAdmin_ بعد سطر addProgram: خمسة أسطر توجيه (wirdMaterials/wirdPreview/wirdGenerate/wirdEditDay/wirdDeleteMaterial).
 *  E4) Part4.gs createProgramFromTemplate_ قرب سطر regFormUrl: if (o.restDays !== undefined) gen.restDays = o.restDays;
 *      + miniAppAdminAddProgram_ يمرر restDays من الطلب؛ + نموذج «برنامج جديد» في التطبيق يضيف حقل أيام الراحة.
 *  ملاحظة: مؤشر «تغييرات غير محفوظة» على Part4.gs ظهر أثناء قراءة فقط (بلا تعديل) — يُعاد تحميل
 *  المحرر دون حفظ قبل أي تعديل، حتى لا يُحفظ شيء غير مقصود.
 */

var WIRD_COORD = {
  REGISTRY: 'المواد المنسقة',
  REG_HEADERS: ['معرّف المادة', 'العنوان', 'النوع', 'صفحة البداية', 'صفحة النهاية', 'تاريخ البداية', 'تاريخ النهاية', 'عدد الأيام', 'أيام الراحة', 'أيام النشر', 'إضافة في الراحة', 'جدول الأيام', 'الحالة', 'أُنشئت في'],
  TYPE_WRITTEN: 'مكتوبة',
  TYPE_VIDEO: 'مرئية',
  TYPE_PLAYLIST: 'قائمة تشغيل'
};

var WIRD_COORD_WEEKDAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
var WIRD_COORD_WEEKDAYS_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** يحوّل نص أيام الراحة إلى أرقام أيام (0=الأحد..6=السبت). يقبل أسماء عربية (بهمزاتها أو بدونها)، وإنجليزية، وأرقامًا. فارغ = []. */
function wirdCoordParseRestDays_(raw) {
  if (raw == null) return [];
  var s = String(raw).replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').toLowerCase();
  var parts = s.split(/[،,;\/\s]+/);
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (!p) continue;
    var n = -1;
    if (/^\d$/.test(p)) { n = parseInt(p, 10); if (n < 0 || n > 6) n = -1; }
    if (n < 0) {
      for (var d = 0; d < 7; d++) {
        var ar = WIRD_COORD_WEEKDAYS_AR[d].replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه');
        if (ar.indexOf(p) === 0 || p.indexOf(ar) === 0 || WIRD_COORD_WEEKDAYS_EN[d].indexOf(p) === 0) { n = d; break; }
      }
    }
    if (n >= 0 && out.indexOf(n) < 0) out.push(n);
  }
  out.sort();
  return out;
}

/** أسماء أيام الراحة المعروضة (من أرقام). */
function wirdCoordRestNames_(days) {
  var names = [];
  for (var i = 0; i < days.length; i++) names.push(WIRD_COORD_WEEKDAYS_AR[days[i]]);
  return names;
}

/** منتصف ليل اليوم نفسه (بتوقيت السكربت). */
function wirdCoordMidnight_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

/** اليوم الحالي منتصف ليله. */
function wirdCoordToday_() { return wirdCoordMidnight_(new Date()); }

/** الغد منتصف ليله. */
function wirdCoordTomorrow_() { var t = wirdCoordToday_(); t.setDate(t.getDate() + 1); return t; }

/** يفسّر تاريخًا بصيغة YYYY-MM-DD؛ null إن لم يطابق. */
function wirdCoordParseDateInput_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  var d = new Date(+m[1], +m[2] - 1, +m[3]);
  if (d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) return null;
  return d;
}

/** يقسّم total صفحة على days يومًا؛ الباقي للأيام الأولى. */
function wirdCoordSplitPages_(total, days) {
  var base = Math.floor(total / days), rem = total % days, out = [], cur = 1;
  for (var i = 0; i < days; i++) {
    var n = base + (i < rem ? 1 : 0);
    out.push({ from: cur, to: cur + n - 1 });
    cur += n;
  }
  return out;
}

/**
 * يحسب تواريخ النشر بالترتيب.
 * start: تاريخ البداية (منتصف ليل)؛ daysCount: عدد أيام النشر المطلوب (أو null)؛
 * end: تاريخ النهاية شاملًا (أو null)؛ restDays: أرقام أيام الراحة؛ publishDays: أرقام أيام
 * النشر المحددة (أو [] = كل الأيام)؛ includeRest: نشر في أيام الراحة أم لا.
 * يعيد مصفوفة تواريخ (منتصف ليل). يتوقف بعد 4000 يوم حمايةً.
 */
function wirdCoordPublishDates_(start, daysCount, end, restDays, publishDays, includeRest) {
  var out = [];
  var d = wirdCoordMidnight_(start);
  var guard = 0;
  while (guard < 4000) {
    guard++;
    var dow = d.getDay();
    var isRest = restDays.indexOf(dow) >= 0;
    var isPubDay = !publishDays || !publishDays.length || publishDays.indexOf(dow) >= 0;
    if (isPubDay && (includeRest || !isRest)) {
      out.push(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
      if (daysCount && out.length >= daysCount) break;
    }
    if (end && d.getTime() >= wirdCoordMidnight_(end).getTime()) break;
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/* ---------- يوتيوب ---------- */
/** مفتاح YouTube Data API v3 من خصائص السكربت (YT_API_KEY). */
function ytApiKey_() {
  var k = PropertiesService.getScriptProperties().getProperty('YT_API_KEY');
  if (!k) throw new Error('مفتاح يوتيوب غير مضبوط (YT_API_KEY). أُنشئ 25 نوفمبر 2026 ويُحفظ في خصائص السكربت.');
  return k;
}

/** استعلام GET إلى YouTube Data API v3؛ يعيد JSON. يرمي برسالة واضحة عند خطأ الواجهة. */
function ytGet_(path, params) {
  var qs = [];
  for (var k in params) qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
  qs.push('key=' + encodeURIComponent(ytApiKey_()));
  var url = 'https://www.googleapis.com/youtube/v3/' + path + '?' + qs.join('&');
  var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var j;
  try { j = JSON.parse(r.getContentText()); } catch (e) { throw new Error('تعذّرت قراءة رد يوتيوب.'); }
  if (j.error) throw new Error('خطأ يوتيوب: ' + (j.error.message || j.error.status || 'غير معروف'));
  return j;
}

/** يحوّل مدة ISO 8601 (PT1H2M3S) إلى ثوانٍ. */
function ytParseDuration_(iso) {
  var m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso || ''));
  if (!m) return 0;
  return (parseInt(m[1] || '0', 10) * 3600) + (parseInt(m[2] || '0', 10) * 60) + parseInt(m[3] || '0', 10);
}

/** ينسّق ثوانٍ إلى ساعة:دقيقة:ثانية (1:02:03) أو دقيقة:ثانية (1:30). */
function ytFormatClock_(sec) {
  sec = Math.max(0, Math.round(sec));
  var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  var mm = (m < 10 ? '0' : '') + m, ss = (s < 10 ? '0' : '') + s;
  return h > 0 ? h + ':' + mm + ':' + ss : m + ':' + ss;
}

/** يستخرج معرّف فيديو من رابط (youtu.be / watch / shorts / embed / live) أو معرّف خام. */
function ytVideoId_(url) {
  var s = String(url || '').trim();
  var m = s.match(/(?:youtu\.be\/|v=|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  return '';
}

/** يستخرج معرّف قائمة تشغيل من رابط (list=...) أو معرّف خام. */
function ytPlaylistId_(url) {
  var s = String(url || '').trim();
  var m = s.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{18,}$/.test(s)) return s;
  return '';
}

/** معلومات فيديو واحد: {id, title, seconds, channel}. */
function ytVideoInfo_(urlOrId) {
  var id = ytVideoId_(urlOrId);
  if (!id) throw new Error('رابط الفيديو غير صالح.');
  var j = ytGet_('videos', { part: 'snippet,contentDetails', id: id });
  if (!j.items || !j.items.length) throw new Error('الفيديو غير موجود أو خاص.');
  var it = j.items[0];
  return { id: id, title: it.snippet.title, seconds: ytParseDuration_(it.contentDetails.duration), channel: it.snippet.channelTitle };
}

/** عناصر قائمة تشغيل: [{id, title, seconds}] بترتيب القائمة (حتى 200 عنصر). */
function ytPlaylistItems_(urlOrId) {
  var pid = ytPlaylistId_(urlOrId);
  if (!pid) throw new Error('رابط قائمة التشغيل غير صالح.');
  var out = [], pageToken = '';
  while (out.length < 200) {
    var params = { part: 'snippet,contentDetails', playlistId: pid, maxResults: 50 };
    if (pageToken) params.pageToken = pageToken;
    var j = ytGet_('playlistItems', params);
    if (!j.items) break;
    for (var i = 0; i < j.items.length; i++) {
      var it = j.items[i];
      if (!it.contentDetails || !it.contentDetails.videoId) continue;
      out.push({ id: it.contentDetails.videoId, title: it.snippet.title, seconds: 0 });
    }
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  // مدة كل عنصر باستعلام واحد لكل 50 معرّفًا
  for (var s = 0; s < out.length; s += 50) {
    var batch = out.slice(s, s + 50);
    var ids = batch.map(function (x) { return x.id; }).join(',');
    var vj = ytGet_('videos', { part: 'contentDetails', id: ids });
    var byId = {};
    for (var k = 0; k < (vj.items || []).length; k++) byId[vj.items[k].id] = ytParseDuration_(vj.items[k].contentDetails.duration);
    for (var b = 0; b < batch.length; b++) batch[b].seconds = byId[batch[b].id] || 0;
  }
  return out;
}

/* ---------- ورقة «خطة الورد» (إلحاق فقط، لا استبدال) ---------- */

/** خريطة الحقول القانونية (WIRD_FIELDS) إلى أعمدة الورقة بالاسم؛ احتياطيًا بالمواضع القديمة. */
function wirdCoordPlanColMap_(headers) {
  var byName = {
    'التاريخ': 'date', 'العنوان {{TITLE}}': 'title', 'نص الرسالة الأساسي': 'text',
    'إما 1': 'extra1', 'إما 2': 'extra2', 'إما 3': 'extra3', 'إما 4': 'extra4',
    'رقم الشريحة المخصص': 'slide', 'نوع المعرف': 'attachType', 'رابط المعرف': 'attach',
    'الروابط المتعددة': 'links', 'آخر موعد (اختياري)': 'deadline',
    'الفعالية المرتبطة (اختياري)': 'act', 'ملاحظة «توقف» = لا نشر': 'note'
  };
  var map = {};
  for (var c = 0; c < headers.length; c++) {
    var f = byName[String(headers[c]).trim()];
    if (f && map[f] === undefined) map[f] = c;
  }
  if (map.date === undefined || map.title === undefined || map.text === undefined) {
    map = { date: 0, title: 1, text: 2, extra1: 3, extra2: 4, extra3: 5, extra4: 6, slide: 7, attachType: 8, attach: 9, links: 10, deadline: 11, act: 12, note: 13 };
  }
  return map;
}

/** يعيد ورقة «خطة الورد» في ملف البرنامج، منشئًا إياها بالرؤوس إن غابت، ومكملًا الرؤوس الناقصة. */
function wirdCoordPlanSheet_(pid) {
  var ss = programSpreadsheet_(pid);
  var sh = ss.getSheetByName(WIRD.SHEET);
  if (!sh) {
    sh = ss.insertSheet(WIRD.SHEET);
    sh.appendRow(WIRD_HEADERS);
    sh.setFrozenRows(1);
    sh.setRightToLeft(true);
    return sh;
  }
  var head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  var missing = [];
  for (var i = 0; i < WIRD_HEADERS.length; i++) {
    var found = false;
    for (var c = 0; c < head.length; c++) { if (String(head[c]).trim() === WIRD_HEADERS[i]) { found = true; break; } }
    if (!found) missing.push(WIRD_HEADERS[i]);
  }
  if (missing.length) {
    var startCol = sh.getLastColumn() + 1;
    sh.getRange(1, startCol, 1, missing.length).setValues([missing]);
  }
  return sh;
}

/** مفاتيح الأيام (YYYY-MM-DD) التي فيها صفوف مؤرّخة فعلًا في «خطة الورد» — لكشف التداخل. */
function wirdCoordExistingDateKeys_(pid) {
  var sh = wirdCoordPlanSheet_(pid);
  var last = sh.getLastRow();
  var keys = {};
  if (last < 2) return keys;
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var map = wirdCoordPlanColMap_(head);
  var vals = sh.getRange(2, map.date + 1, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i][0];
    if (v === '' || v == null) continue;
    var key = '';
    try {
      if (v instanceof Date) key = dayKey_(v);
      else if (/^\d{4}-\d{2}-\d{2}/.test(String(v))) key = String(v).slice(0, 10);
      else { var t = wirdParseDate_(v); if (t) key = dayKey_(t); }
    } catch (e) { key = ''; }
    if (key) keys[key] = true;
  }
  return keys;
}

/** يلحق صفوفًا قانونية (14 عنصرًا بترتيب WIRD_FIELDS) بورقة «خطة الورد» دون مسّ غيرها. */
function wirdCoordAppendPlanRows_(pid, canonicalRows) {
  var sh = wirdCoordPlanSheet_(pid);
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var map = wirdCoordPlanColMap_(head);
  var grid = [];
  for (var i = 0; i < canonicalRows.length; i++) {
    var src = canonicalRows[i];
    var row = [];
    for (var c = 0; c < head.length; c++) row.push('');
    var fields = ['date', 'title', 'text', 'extra1', 'extra2', 'extra3', 'extra4', 'links', 'attach', 'attachType', 'slide', 'act', 'deadline', 'note'];
    for (var f = 0; f < fields.length; f++) {
      if (map[fields[f]] !== undefined) row[map[fields[f]]] = src[f];
    }
    grid.push(row);
  }
  if (grid.length) sh.getRange(sh.getLastRow() + 1, 1, grid.length, head.length).setValues(grid);
  return grid.length;
}

/** يجد صفًا في «خطة الورد» بتاريخه وعنوانه؛ يعيد رقم الصف (1-based) أو 0. */
function wirdCoordFindPlanRow_(pid, dateKey, title) {
  var sh = wirdCoordPlanSheet_(pid);
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var map = wirdCoordPlanColMap_(head);
  var vals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i][map.date];
    var key = '';
    try {
      if (v instanceof Date) key = dayKey_(v);
      else if (/^\d{4}-\d{2}-\d{2}/.test(String(v))) key = String(v).slice(0, 10);
      else { var t = wirdParseDate_(v); if (t) key = dayKey_(t); }
    } catch (e) { key = ''; }
    if (key === dateKey && String(vals[i][map.title]) === String(title)) return i + 2;
  }
  return 0;
}

/* ---------- سجل المواد «المواد المنسقة» ---------- */
function wirdCoordRegistrySheet_(pid) {
  var ss = programSpreadsheet_(pid);
  var sh = ss.getSheetByName(WIRD_COORD.REGISTRY);
  if (!sh) {
    sh = ss.insertSheet(WIRD_COORD.REGISTRY);
    sh.appendRow(WIRD_COORD.REG_HEADERS);
    sh.setFrozenRows(1);
    sh.setRightToLeft(true);
  }
  return sh;
}

/** يقرأ سجل المواد: [{r, id, title, type, startPage, endPage, startDate, endDate, daysCount, restDays, publishDays, includeRest, days, status, createdAt}]. */
function wirdCoordReadRegistry_(pid) {
  var sh = wirdCoordRegistrySheet_(pid);
  var last = sh.getLastRow();
  var out = [];
  if (last < 2) return out;
  var vals = sh.getRange(2, 1, last - 1, WIRD_COORD.REG_HEADERS.length).getValues();
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i];
    var days = [];
    try { days = JSON.parse(v[11] || '[]') || []; } catch (e) { days = []; }
    out.push({
      r: i + 2, id: String(v[0] || ''), title: String(v[1] || ''), type: String(v[2] || ''),
      startPage: v[3] === '' ? null : Number(v[3]), endPage: v[4] === '' ? null : Number(v[4]),
      startDate: String(v[5] || ''), endDate: String(v[6] || ''),
      daysCount: v[7] === '' ? null : Number(v[7]),
      restDays: String(v[8] || ''), publishDays: String(v[9] || ''),
      includeRest: String(v[10] || '') === 'نعم',
      days: days, status: String(v[12] || 'نشطة'), createdAt: v[13]
    });
  }
  return out;
}

/* ---------- المعاينة (بلا كتابة) ---------- */

/** يبني أيام مادة مكتوبة من المدخلات؛ يعيد {days, totalPages, restDays} أو يرمي بخطأ واضح. */
function wirdCoordPreviewWritten_(prog, b) {
  var title = str_(b.title || '');
  if (title.length < 2 || title.length > 100) throw new Error('عنوان المادة بين حرفين و100 حرف.');
  var sp = Math.floor(Number(b.startPage)), ep = Math.floor(Number(b.endPage));
  if (!(sp >= 1) || !(ep >= sp) || ep - sp + 1 > 100000) throw new Error('صفحتا البداية والنهاية غير صالحتين.');
  var total = ep - sp + 1;
  var start = wirdCoordParseDateInput_(b.startDate) || wirdCoordTomorrow_();
  var today = wirdCoordToday_();
  if (start.getTime() < today.getTime()) throw new Error('تاريخ البداية في الماضي؛ الفائت لا يُعوَّض.');
  var daysCount = b.daysCount != null && b.daysCount !== '' ? Math.floor(Number(b.daysCount)) : null;
  var end = wirdCoordParseDateInput_(b.endDate);
  if (daysCount != null && end) throw new Error('اختر إما عدد الأيام أو تاريخي البداية والنهاية، لا كليهما.');
  if (daysCount == null && !end) throw new Error('حدّد عدد الأيام أو تاريخي البداية والنهاية.');
  if (daysCount != null && (daysCount < 1 || daysCount > 365)) throw new Error('عدد الأيام بين 1 و365.');
  if (end && end.getTime() < start.getTime()) throw new Error('تاريخ النهاية قبل البداية.');
  var restDays = wirdCoordParseRestDays_(prog.general && prog.general.restDays);
  var publishDays = wirdCoordParseRestDays_(b.publishDays || '');
  var includeRest = !!b.includeRest;
  if (publishDays.length && !includeRest) {
    var allRest = true;
    for (var i = 0; i < publishDays.length; i++) { if (restDays.indexOf(publishDays[i]) < 0) { allRest = false; break; } }
    if (allRest) throw new Error('أيام النشر المحددة كلها أيام راحة — فعّل «إضافة في أيام الراحة» أو غيّر الأيام.');
  }
  var dates = wirdCoordPublishDates_(start, daysCount, end, restDays, publishDays, includeRest);
  if (daysCount != null && dates.length < daysCount) throw new Error('تعذّر إيجاد ' + daysCount + ' أيام نشر — راجع أيام الراحة وأيام النشر.');
  if (!dates.length) throw new Error('لا أيام نشر في المدة المحددة — راجع أيام الراحة وأيام النشر.');
  var n = Math.min(dates.length, total);
  var split = wirdCoordSplitPages_(total, n);
  var days = [];
  for (var d = 0; d < n; d++) {
    days.push({
      date: dayKey_(dates[d]), title: title,
      text: 'من صفحة ' + split[d].from + ' إلى صفحة ' + split[d].to,
      from: split[d].from, to: split[d].to, startSec: null, endSec: null, links: ''
    });
  }
  return { days: days, totalPages: total, restDays: restDays, startDate: dayKey_(start), endDate: end ? dayKey_(end) : null, daysCount: daysCount };
}

/** يبني أيام فيديو واحد من رابطه؛ minutesPerDay دقائق كل يوم (أو null = كاملًا في يوم واحد). */
function wirdCoordPreviewVideo_(prog, b) {
  var title = str_(b.title || '');
  var info = ytVideoInfo_(b.url || '');
  if (!info.seconds) throw new Error('تعذّرت قراءة مدة الفيديو.');
  var startSec = b.startSec != null && b.startSec !== '' ? Math.floor(Number(b.startSec)) : 0;
  var endSec = b.endSec != null && b.endSec !== '' ? Math.floor(Number(b.endSec)) : info.seconds;
  if (startSec < 0 || endSec <= startSec || endSec > info.seconds) throw new Error('موضعا البداية والنهاية غير صالحين (المدة ' + ytFormatClock_(info.seconds) + ').');
  var whole = !!b.wholeDay;
  var perDay = whole ? (endSec - startSec) : Math.floor(Number(b.minutesPerDay || 0)) * 60;
  if (!whole && (perDay < 60 || perDay > 12 * 3600)) throw new Error('الدقائق اليومية بين 1 و720.');
  var start = wirdCoordParseDateInput_(b.startDate) || wirdCoordTomorrow_();
  var today = wirdCoordToday_();
  if (start.getTime() < today.getTime()) throw new Error('تاريخ البداية في الماضي؛ الفائت لا يُعوَّض.');
  var daysCount = b.daysCount != null && b.daysCount !== '' ? Math.floor(Number(b.daysCount)) : null;
  var end = wirdCoordParseDateInput_(b.endDate);
  if (daysCount != null && end) throw new Error('اختر إما عدد الأيام أو تاريخي البداية والنهاية، لا كليهما.');
  if (daysCount == null && !end) throw new Error('حدّد عدد الأيام أو تاريخي البداية والنهاية.');
  if (daysCount != null && (daysCount < 1 || daysCount > 365)) throw new Error('عدد الأيام بين 1 و365.');
  if (end && end.getTime() < start.getTime()) throw new Error('تاريخ النهاية قبل البداية.');
  var restDays = wirdCoordParseRestDays_(prog.general && prog.general.restDays);
  var publishDays = wirdCoordParseRestDays_(b.publishDays || '');
  var includeRest = !!b.includeRest;
  var dates = wirdCoordPublishDates_(start, daysCount, end, restDays, publishDays, includeRest);
  var needDays = Math.ceil((endSec - startSec) / perDay);
  if (daysCount != null && dates.length < daysCount) throw new Error('تعذّر إيجاد ' + daysCount + ' أيام نشر — راجع أيام الراحة وأيام النشر.');
  if (dates.length < needDays) throw new Error('المدة المحددة تكفي ' + dates.length + ' يومًا فقط، والمقطع يحتاج ' + needDays + ' أيام بهذا المعدل اليومي.');
  if (!dates.length) throw new Error('لا أيام نشر في المدة المحددة.');
  var videoTitle = title || info.title;
  var days = [], cur = startSec;
  for (var d = 0; d < needDays; d++) {
    var to = Math.min(endSec, cur + perDay);
    days.push({
      date: dayKey_(dates[d]), title: videoTitle,
      text: 'من ' + ytFormatClock_(cur) + ' إلى ' + ytFormatClock_(to),
      from: null, to: null, startSec: cur, endSec: to,
      links: 'https://youtu.be/' + info.id + '?t=' + cur
    });
    cur = to;
  }
  return { days: days, totalSeconds: endSec - startSec, videoTitle: info.title, videoId: info.id, restDays: restDays, startDate: dayKey_(start), endDate: end ? dayKey_(end) : null, daysCount: daysCount };
}

/** يبني أيام قائمة تشغيل: كل محاضرة يوم (أو أكثر إن طالت عن المعدل اليومي). */
function wirdCoordPreviewPlaylist_(prog, b) {
  var title = str_(b.title || '');
  if (title.length < 2 || title.length > 100) throw new Error('عنوان المادة بين حرفين و100 حرف.');
  var items = ytPlaylistItems_(b.url || '');
  if (!items.length) throw new Error('قائمة التشغيل فارغة أو غير متاحة.');
  var perDay = Math.floor(Number(b.minutesPerDay || 0)) * 60;
  if (perDay < 60 || perDay > 12 * 3600) throw new Error('الدقائق اليومية بين 1 و720.');
  var start = wirdCoordParseDateInput_(b.startDate) || wirdCoordTomorrow_();
  var today = wirdCoordToday_();
  if (start.getTime() < today.getTime()) throw new Error('تاريخ البداية في الماضي؛ الفائت لا يُعوَّض.');
  var daysCount = b.daysCount != null && b.daysCount !== '' ? Math.floor(Number(b.daysCount)) : null;
  var end = wirdCoordParseDateInput_(b.endDate);
  if (daysCount != null && end) throw new Error('اختر إما عدد الأيام أو تاريخي البداية والنهاية، لا كليهما.');
  if (daysCount == null && !end) throw new Error('حدّد عدد الأيام أو تاريخي البداية والنهاية.');
  if (daysCount != null && (daysCount < 1 || daysCount > 365)) throw new Error('عدد الأيام بين 1 و365.');
  if (end && end.getTime() < start.getTime()) throw new Error('تاريخ النهاية قبل البداية.');
  var restDays = wirdCoordParseRestDays_(prog.general && prog.general.restDays);
  var publishDays = wirdCoordParseRestDays_(b.publishDays || '');
  var includeRest = !!b.includeRest;
  var dates = wirdCoordPublishDates_(start, daysCount, end, restDays, publishDays, includeRest);
  if (daysCount != null && dates.length < daysCount) throw new Error('تعذّر إيجاد ' + daysCount + ' أيام نشر — راجع أيام الراحة وأيام النشر.');
  if (!dates.length) throw new Error('لا أيام نشر في المدة المحددة.');
  var days = [], di = 0;
  for (var i = 0; i < items.length && di < dates.length; i++) {
    var it = items[i];
    if (!it.seconds) continue;
    var cur = 0;
    while (cur < it.seconds && di < dates.length) {
      var to = Math.min(it.seconds, cur + perDay);
      days.push({
        date: dayKey_(dates[di]), title: it.title,
        text: 'من ' + ytFormatClock_(cur) + ' إلى ' + ytFormatClock_(to),
        from: null, to: null, startSec: cur, endSec: to,
        links: 'https://youtu.be/' + it.id + '?t=' + cur
      });
      cur = to;
      di++;
    }
  }
  if (!days.length) throw new Error('لا أيام نشر كافية لمواد القائمة.');
  return { days: days, lectures: items.length, restDays: restDays, startDate: dayKey_(start), endDate: end ? dayKey_(end) : null, daysCount: daysCount };
}

/** يتحقق من أيام مرسلة من الواجهة (بعد تعديل المعاينة): تواريخ صالحة، بلا تكرار، وفي المستقبل. */
function wirdCoordValidateDays_(days) {
  if (!days || !days.length || days.length > 365) throw new Error('جدول الأيام غير صالح.');
  var seen = {}, today = wirdCoordToday_();
  for (var i = 0; i < days.length; i++) {
    var d = days[i];
    if (!d.date || !wirdCoordParseDateInput_(d.date)) throw new Error('تاريخ غير صالح في اليوم ' + (i + 1) + '.');
    if (seen[d.date]) throw new Error('تاريخ مكرر في الجدول: ' + d.date + '.');
    seen[d.date] = true;
    if (wirdCoordParseDateInput_(d.date).getTime() < today.getTime()) throw new Error('تاريخ في الماضي: ' + d.date + ' — الفائت لا يُعوَّض.');
    if (!d.title || !d.text) throw new Error('يوم بلا عنوان أو نص: ' + d.date + '.');
  }
  days.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  return days;
}

/* ---------- التوليد والتعديل والحذف ---------- */
/** يولّد مادة: يكتب صفوف الأيام غير المتداخلة في «خطة الورد» ويسجّل المادة. يعيد {id, created, skipped}. */
function wirdCoordGenerate_(pid, prog, b, preview, session) {
  var days = wirdCoordValidateDays_(preview.days);
  var existing = wirdCoordExistingDateKeys_(pid);
  var toWrite = [], skipped = [];
  for (var i = 0; i < days.length; i++) {
    if (existing[days[i].date]) skipped.push({ date: days[i].date, reason: 'يوجد صف في هذا التاريخ' });
    else toWrite.push(days[i]);
  }
  if (!toWrite.length) return { id: null, created: 0, skipped: skipped };
  var id = 'w' + Date.now().toString(36);
  var lock = tenantLock_();
  try {
    lock.waitLock(25000);
    try {
      var rows = [];
      for (var r = 0; r < toWrite.length; r++) {
        var d = toWrite[r];
        var dateObj = wirdCoordParseDateInput_(d.date);
        rows.push([dateObj, d.title, d.text, '', '', '', '', d.links || '', '', '', '', '', '', '']);
      }
      wirdCoordAppendPlanRows_(pid, rows);
      var sh = wirdCoordRegistrySheet_(pid);
      sh.appendRow([
        id, str_(b.title || preview.videoTitle || ''), b.type,
        b.startPage != null ? b.startPage : '', b.endPage != null ? b.endPage : '',
        preview.startDate || '', preview.endDate || '',
        preview.daysCount != null ? preview.daysCount : '',
        wirdCoordRestNames_(preview.restDays).join('، '), str_(b.publishDays || ''),
        b.includeRest ? 'نعم' : 'لا',
        JSON.stringify(toWrite), 'نشطة', new Date()
      ]);
      logChange_(miniAppFrom_(session), pid, 'الأوراد', id, 'إضافة', '', (b.title || preview.videoTitle || '') + ' — ' + toWrite.length + ' يومًا');
    } finally { lock.releaseLock(); }
  } catch (e) { throw e; }
  return { id: id, created: toWrite.length, skipped: skipped };
}

/** يعدّل يومًا مستقبليًا واحدًا في السجل وفي «خطة الورد». */
function wirdCoordEditDay_(pid, b) {
  var mats = wirdCoordReadRegistry_(pid);
  var mat = null;
  for (var i = 0; i < mats.length; i++) { if (mats[i].id === String(b.id || '') && mats[i].status === 'نشطة') { mat = mats[i]; break; } }
  if (!mat) throw new Error('المادة غير موجودة أو محذوفة.');
  var day = null, di = -1;
  for (var d = 0; d < mat.days.length; d++) { if (mat.days[d].date === String(b.date || '')) { day = mat.days[d]; di = d; break; } }
  if (!day) throw new Error('اليوم غير موجود في جدول المادة.');
  if (wirdCoordParseDateInput_(day.date).getTime() < wirdCoordToday_().getTime()) throw new Error('اليوم في الماضي — لا يُعدَّل بعد نشره أو فواته.');
  if (mat.type === WIRD_COORD.TYPE_WRITTEN) {
    var from = Math.floor(Number(b.from)), to = Math.floor(Number(b.to));
    if (!(from >= 1) || !(to >= from) || to > mat.endPage) throw new Error('نطاق الصفحات غير صالح.');
    day.from = from; day.to = to;
    day.text = 'من صفحة ' + from + ' إلى صفحة ' + to;
  } else {
    var ss = Math.floor(Number(b.startSec)), es = Math.floor(Number(b.endSec));
    if (!(ss >= 0) || !(es > ss)) throw new Error('موضعا البداية والنهاية غير صالحين.');
    day.startSec = ss; day.endSec = es;
    day.text = 'من ' + ytFormatClock_(ss) + ' إلى ' + ytFormatClock_(es);
    var m = String(day.links || '').match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
    if (m) day.links = 'https://youtu.be/' + m[1] + '?t=' + ss;
  }
  mat.days[di] = day;
  var lock = tenantLock_();
  try {
    lock.waitLock(25000);
    try {
      var sh = wirdCoordRegistrySheet_(pid);
      sh.getRange(mat.r, 12, 1, 1).setValue(JSON.stringify(mat.days));
      var planSh = wirdCoordPlanSheet_(pid);
      var head = planSh.getRange(1, 1, 1, planSh.getLastColumn()).getValues()[0];
      var map = wirdCoordPlanColMap_(head);
      var rowNo = wirdCoordFindPlanRow_(pid, day.date, day.title);
      if (!rowNo) throw new Error('صف الورد لهذا اليوم غير موجود في «خطة الورد» (ربما حُذف يدويًا).');
      planSh.getRange(rowNo, map.text + 1, 1, 1).setValue(day.text);
      if (map.links !== undefined) planSh.getRange(rowNo, map.links + 1, 1, 1).setValue(day.links || '');
    } finally { lock.releaseLock(); }
  } catch (e) { throw e; }
  return { ok: true, day: day };
}

/** يحذف مادة: يعلّمها محذوفة ويحذف صفوف أيامها المستقبلية من «خطة الورد» (الماضي يُترك). */
function wirdCoordDeleteMaterial_(pid, id) {
  var mats = wirdCoordReadRegistry_(pid);
  var mat = null;
  for (var i = 0; i < mats.length; i++) { if (mats[i].id === String(id || '') && mats[i].status === 'نشطة') { mat = mats[i]; break; } }
  if (!mat) throw new Error('المادة غير موجودة أو محذوفة أصلًا.');
  var today = dayKey_(wirdCoordToday_());
  var removed = 0;
  var lock = tenantLock_();
  try {
    lock.waitLock(25000);
    try {
      var sh = wirdCoordRegistrySheet_(pid);
      sh.getRange(mat.r, 13, 1, 1).setValue('محذوفة');
      var planSh = wirdCoordPlanSheet_(pid);
      for (var d = mat.days.length - 1; d >= 0; d--) {
        var day = mat.days[d];
        if (day.date < today) continue;
        var rowNo = wirdCoordFindPlanRow_(pid, day.date, day.title);
        if (rowNo) { planSh.deleteRow(rowNo); removed++; }
      }
    } finally { lock.releaseLock(); }
  } catch (e) { throw e; }
  return { ok: true, removed: removed };
}

/* ---------- إجراءات التطبيق المصغّر (مشرف) ---------- */

function miniAppAdminWirdMaterials_(session, body) {
  var acc = miniAppAdminNeed_(session, body.pid);
  if (!acc.ok) return { ok: false, error: acc.error, message: acc.message };
  var prog = loadProgram_(acc.pid);
  var restRaw = (prog.general && prog.general.restDays != null) ? String(prog.general.restDays) : 'الجمعة';
  var restDays = wirdCoordParseRestDays_(restRaw);
  var mats = wirdCoordReadRegistry_(acc.pid).filter(function (m) { return m.status === 'نشطة'; });
  var list = mats.map(function (m) {
    return { id: m.id, title: m.title, type: m.type, startPage: m.startPage, endPage: m.endPage, startDate: m.startDate, endDate: m.endDate, daysCount: m.daysCount, days: m.days };
  });
  return { ok: true, pid: acc.pid, restDays: restDays, restNames: wirdCoordRestNames_(restDays), materials: list };
}

function miniAppAdminWirdPreview_(session, body) {
  var acc = miniAppAdminNeed_(session, body.pid);
  if (!acc.ok) return { ok: false, error: acc.error, message: acc.message };
  var prog = loadProgram_(acc.pid);
  var type = str_(body.type || '');
  var preview;
  try {
    if (type === WIRD_COORD.TYPE_WRITTEN) preview = wirdCoordPreviewWritten_(prog, body);
    else if (type === WIRD_COORD.TYPE_VIDEO) preview = wirdCoordPreviewVideo_(prog, body);
    else if (type === WIRD_COORD.TYPE_PLAYLIST) preview = wirdCoordPreviewPlaylist_(prog, body);
    else return { ok: false, error: 'type', message: 'نوع المادة غير معروف.' };
  } catch (e) { return { ok: false, error: 'preview', message: e.message || String(e) }; }
  var existing = wirdCoordExistingDateKeys_(acc.pid);
  var collisions = 0;
  for (var i = 0; i < preview.days.length; i++) {
    preview.days[i].collided = !!existing[preview.days[i].date];
    if (preview.days[i].collided) collisions++;
  }
  preview.ok = true;
  preview.type = type;
  preview.collisions = collisions;
  preview.restNames = wirdCoordRestNames_(preview.restDays);
  return preview;
}

function miniAppAdminWirdGenerate_(session, body) {
  var acc = miniAppAdminNeed_(session, body.pid);
  if (!acc.ok) return { ok: false, error: acc.error, message: acc.message };
  var prog = loadProgram_(acc.pid);
  var type = str_(body.type || '');
  var preview;
  try {
    if (body.days) {
      preview = { days: wirdCoordValidateDays_(body.days), restDays: wirdCoordParseRestDays_(prog.general && prog.general.restDays), startDate: body.days[0].date, endDate: body.days[body.days.length - 1].date, daysCount: null, videoTitle: body.videoTitle || '' };
    } else if (type === WIRD_COORD.TYPE_WRITTEN) preview = wirdCoordPreviewWritten_(prog, body);
    else if (type === WIRD_COORD.TYPE_VIDEO) preview = wirdCoordPreviewVideo_(prog, body);
    else if (type === WIRD_COORD.TYPE_PLAYLIST) preview = wirdCoordPreviewPlaylist_(prog, body);
    else return { ok: false, error: 'type', message: 'نوع المادة غير معروف.' };
  } catch (e) { return { ok: false, error: 'preview', message: e.message || String(e) }; }
  try {
    var res = wirdCoordGenerate_(acc.pid, prog, body, preview, session);
    var msg = res.created > 0
      ? '✅ وُلّدت ' + res.created + ' أيام في «خطة الورد»' + (res.skipped.length ? ' (تُخطّي ' + res.skipped.length + ' أيام متداخلة)' : '') + '.'
      : '⚠️ لم يُولَّد شيء — كل الأيام متداخلة مع صفوف قائمة في «خطة الورد».';
    return { ok: true, pid: acc.pid, id: res.id, created: res.created, skipped: res.skipped, message: msg };
  } catch (e) { return { ok: false, error: 'generate', message: e.message || String(e) }; }
}

function miniAppAdminWirdEditDay_(session, body) {
  var acc = miniAppAdminNeed_(session, body.pid);
  if (!acc.ok) return { ok: false, error: acc.error, message: acc.message };
  try {
    var res = wirdCoordEditDay_(acc.pid, body);
    return { ok: true, pid: acc.pid, day: res.day, message: '✅ عُدّل يوم ' + res.day.date + '.' };
  } catch (e) { return { ok: false, error: 'edit', message: e.message || String(e) }; }
}

function miniAppAdminWirdDeleteMaterial_(session, body) {
  var acc = miniAppAdminNeed_(session, body.pid);
  if (!acc.ok) return { ok: false, error: acc.error, message: acc.message };
  try {
    var res = wirdCoordDeleteMaterial_(acc.pid, body.id);
    return { ok: true, pid: acc.pid, removed: res.removed, message: '✅ حُذفت المادة وحُذف ' + res.removed + ' صفوف مستقبلية من «خطة الورد».' };
  } catch (e) { return { ok: false, error: 'delete', message: e.message || String(e) }; }
}