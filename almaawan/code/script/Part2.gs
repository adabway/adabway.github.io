// ===== Common.gs =====
/**
 * Common.gs — ملف مشترك: انسخه كما هو في مشروع «سكربت الدرجات» وفي مشروع «البوت».
 * يحوي: أسماء الأوراق، قراءة ورقة الإعدادات، توحيد البريد، البحث عن الأعمدة، حساب درجة الفعالية.
 * لا يستدعي أي خدمة من خدمات Google، لذلك يمكن اختباره خارج Apps Script.
 */

var NAMES = {
  SETTINGS: 'الإعدادات',
  CORRECTIONS: 'تصحيح البريد',
  OVERRIDES: 'درجات يدوية',
  SUBMISSIONS: 'تسليمات الفعاليات',
  UNMATCHED: 'بريد غير مطابق'
};

/** عناوين أقسام ورقة الإعدادات (تُكتب في العمود A) */
var SECTIONS = {
  GENERAL: 'الإعدادات العامة',
  COMPONENTS: 'الاختبارات',
  GROUPS: 'المجموعات',
  ACTIVITIES: 'الفعاليات المصاحبة',
  BANDS: 'التقديرات',
  LEVELS: 'المستويات'
};

var OPT = {
  YES: 'نعم', NO: 'لا',
  BASIC: 'أساسي', EXTRA: 'إضافي',
  FIRST: 'الأولى', HIGHEST: 'الأعلى', LAST: 'الأخيرة',
  G_MAX: 'الأعلى', G_SUM: 'المجموع', G_AVG: 'المتوسط',
  BASIS_BASIC: 'الأساسية فقط', BASIS_TOTAL: 'المجموع مع الإضافية',
  BASE_ALL: 'كل المسجلين', BASE_ACTIVE: 'المسجلون الذين لهم أي درجة', BASE_FINAL: 'من عبأ المقياس النهائي',
  SORT_GRADE: 'الدرجة تنازليًا', SORT_NAME: 'الاسم أبجديًا',
  ACC_TEXT: 'نص فقط', ACC_FILE: 'ملف فقط', ACC_ANY: 'نص أو ملف',
  LV_EACH: 'كل مستوى', LV_TOTAL: 'المجموع', LV_BOTH: 'الاثنان'
};

/** المستويات (اختيارية): عمود «المستوى» في الاختبارات والمجموعات والفعاليات + جدول «المستويات». الفارغ = برنامج بلا مستويات. */
var LEVEL_HEADER = 'المستوى';

/** [المفتاح الداخلي، النص في الورقة، القيمة الافتراضية، الخيارات أو null، ملاحظة] */
var GENERAL_FIELDS = [
  ['programName', 'اسم البرنامج', '', null, 'يظهر للطلاب في البوت'],
  ['regSpreadsheetId', 'رابط ملف ردود التسجيل (أو معرّفه)', '', null, 'ملف التسجيل الخاص بهذه الدفعة'],
  ['regSheet', 'ورقة ردود التسجيل', '', null, 'فارغ = أول ورقة في الملف'],
  ['regFormUrl', 'رابط استمارة التسجيل (اختياري)', '', null, 'يظهر للطالب غير المسجّل زر التسجيل في التطبيق المصغّر'],
  ['restDays', 'أيام الراحة في البرنامج', 'الجمعة', null, 'أسماء أيام مفصولة بفواصل (مثال: الجمعة، السبت)؛ فارغ = بلا أيام راحة'],
  ['regEmailPattern', 'نمط عمود البريد في التسجيل', 'بريد|e-?mail', null, 'تعبير نمطي يطابق عنوان العمود'],
  ['regNamePattern', 'نمط عمود الاسم في التسجيل', 'الاسم', null, ''],
  ['regGenderPattern', 'نمط عمود الجنس في التسجيل', 'الجنس|النوع', null, ''],
  ['finalSheet', 'ورقة المقياس النهائي', '', 'SHEETS', 'ردود المقياس النهائي في هذا الملف'],
  ['finalEmailPattern', 'نمط عمود البريد في المقياس', 'بريد|e-?mail', null, ''],
  ['finalNamePattern', 'نمط عمود الاسم في المقياس', 'الاسم', null, ''],
  ['finalGenderPattern', 'نمط عمود الجنس في المقياس', 'الجنس|النوع', null, 'يُستعمل إن لم يوجد الجنس في التسجيل'],
  ['quizNamePattern', 'نمط عمود الاسم في الاختبارات', 'الاسم', null, 'لمطابقة البريد غير المسجل بالاسم الرباعي'],
  ['nameMatch', 'المطابقة بالاسم الرباعي', 'نعم', ['نعم', 'لا'], 'بريد غير مسجل + اسم رباعي يطابق طالبًا مسجلًا واحدًا ← تُحتسب درجته لبريد ذلك الطالب'],
  ['finalRequired', 'اشتراط تعبئة المقياس النهائي للنجاح', 'نعم', ['نعم', 'لا'], ''],
  ['studentBase', 'من يظهر في ورقة الدرجات', 'المسجلون الذين لهم أي درجة', ['المسجلون الذين لهم أي درجة', 'كل المسجلين', 'من عبأ المقياس النهائي'], 'إن لم يُحدد ملف التسجيل فالقائمة = من عبأ المقياس'],
  ['passMark', 'درجة النجاح', 60, null, ''],
  ['passBasis', 'أساس الدرجة النهائية', 'المجموع مع الإضافية', ['المجموع مع الإضافية', 'الأساسية فقط'], 'تُستعمل للنجاح والتقدير والعرض'],
  ['extrasCap', 'سقف الدرجات الإضافية', 20, null, 'فارغ = بلا سقف'],
  ['finalCap', 'الحد الأعلى للدرجة النهائية', '', null, 'فارغ = بلا حد (مثلًا 100)'],
  ['sortBy', 'ترتيب أوراق الدرجات والمجتازين', 'الدرجة تنازليًا', ['الدرجة تنازليًا', 'الاسم أبجديًا'], ''],
  ['decimals', 'عدد المنازل العشرية', 2, null, ''],
  ['maleValue', 'قيمة الذكور في عمود الجنس', 'ذكر', null, ''],
  ['femaleValue', 'قيمة الإناث في عمود الجنس', 'أنثى', null, ''],
  ['timestampPattern', 'نمط عمود الطابع الزمني', 'طابع زمني|timestamp', null, 'يُستعمل لتحديد المحاولة الأولى/الأخيرة'],
  ['gradesSheet', 'اسم ورقة الدرجات', 'Grades', null, ''],
  ['passersSheet', 'اسم ورقة المجتازين', 'المجتازين', null, ''],
  ['malePassersSheet', 'اسم ورقة المجتازين الذكور', 'المجتازين-ذكور', null, ''],
  ['femalePassersSheet', 'اسم ورقة المجتازات الإناث', 'المجتازين-إناث', null, ''],
  ['unmatchedSheet', 'اسم ورقة البريد غير المطابق', 'بريد غير مطابق', null, 'تُعاد كتابتها في كل حساب'],
  ['botWelcome', 'رسالة ترحيب البوت (اختياري)', '', null, ''],
  ['reviewChatId', 'معرّف قناة مراجعة التسليمات في تيليجرام (اختياري)', '', null, 'إن وُضع يُنسخ كل تسليم إليها، والبوت مشرف فيها'],
  ['levelPassRule', 'قاعدة النجاح في المستويات', 'الاثنان', ['الاثنان', 'كل مستوى', 'المجموع'], 'للبرامج ذات المستويات فقط: «كل مستوى» = يجتاز كل مستوى بدرجة نجاحه، «المجموع» = المجموع الكلي، «الاثنان» = كلاهما'],
  ['overallPassMark', 'درجة النجاح في المجموع الكلي للمستويات', '', null, 'فارغ = مجموع درجات نجاح المستويات'],
  ['levelPassers', 'ورقة مجتازين لكل مستوى', 'لا', ['نعم', 'لا'], 'تُكتب ورقة «<اسم ورقة المجتازين> - <المستوى>» لكل مستوى'],
  // ── خيارات الطلاب (v6) — الغائب من ورقة قديمة = القيمة الافتراضية ──
  ['showGrades', 'إظهار الدرجات للطالب («📊 درجاتي»)', 'لا', ['نعم', 'لا'], 'نعم = يرى الطالب درجته في كل عنصر وما بقي له للنجاح (/mygrades)'],
  ['adminAddStudent', 'السماح للمشرفين بإضافة طلاب', 'نعم', ['نعم', 'لا'], 'نعم = يستطيع أي مشرف إضافة طلاب في برامجه'],
  ['showSubs', 'إظهار «🗂 تسليماتي» للطالب', 'نعم', ['نعم', 'لا'], 'يرى الطالب قائمة تسليماته (/mysubs)'],
  ['allowDelete', 'السماح للطالب بحذف تسليمه', 'نعم', ['نعم', 'لا'], 'الحذف يخصم درجة التسليم فورًا'],
  ['allowEdit', 'السماح للطالب بتعديل تسليمه', 'نعم', ['نعم', 'لا'], 'المحتوى الجديد يحل محل القديم ويبقى تاريخ التسليم الأصلي'],
  ['editWindow', 'مدة السماح بالتعديل والحذف (بالساعات)', '', null, 'فارغ = بلا حد (حتى يُغلق البرنامج). رقم = ساعات من وقت التسليم الأصلي، مثل 48. يُمنع دائمًا إذا أُغلق البرنامج أو أُوقفت الفعالية أو فات موعدها المغلق في «المواعيد»'],
  ['rejectButtons', 'أزرار الرفض في مجموعة المراجعة', 'نعم', ['نعم', 'لا'], '«❌ رفض» و«❌ رفض مع ملاحظة» تحت كل تسليم جديد في المجموعة'],
  ['notifyReject', 'إبلاغ الطالب عند رفض تسليمه', 'نعم', ['نعم', 'لا'], 'تصله رسالة بالرفض وسببه إن كُتب'],
  // ── التقرير الأسبوعي (v6) ──
  ['weeklyReport', 'التقرير الأسبوعي', 'لا', ['نعم', 'لا'], 'فعّله من البوت الإداري («🗓 التقرير الأسبوعي») ليُنشأ المؤقت'],
  ['weeklyDay', 'يوم التقرير الأسبوعي', 'الجمعة', ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'], ''],
  ['weeklyHour', 'ساعة التقرير الأسبوعي (0-23 بتوقيت القاهرة)', 20, null, 'مثال: 20 = الثامنة مساءً'],
  ['weeklyTo', 'مستلمو التقرير الأسبوعي', 'المالك', ['المالك', 'المالك والمشرفون'], 'المشرفون = من لهم صلاحية هذا البرنامج في البوت الإداري'],
  ['weeklyLow', 'حد التعثر في التقرير (عدد التسليمات)', 1, null, 'يُعد الطالب المسجل متعثرًا إن كانت تسليماته المقبولة بهذا العدد أو أقل'],
  // ── التذكيرات الآلية (v7) — كلها موقوفة افتراضيًا؛ المواعيد في ورقة «المواعيد» ──
  ['programStart', 'تاريخ بداية البرنامج', '', null, 'مثال: 2026-11-01 (لتنبيه التعثر وتذكير الانقطاع)'],
  ['programEnd', 'تاريخ نهاية البرنامج', '', null, 'مثال: 2027-01-31؛ لا تذكيرات بعده'],
  ['remindersOn', 'التذكيرات الآلية', 'لا', ['نعم', 'لا'], 'المفتاح العام للبرنامج: «لا» = لا يُرسل أي تذكير آلي'],
  ['remOpen', 'تذكير: إعلان فتح الفعالية', 'لا', ['نعم', 'لا'], 'يوم «يبدأ في» من ورقة «المواعيد»'],
  ['remBefore', 'تذكير: قبل الموعد لمن لم يسلّم', 'لا', ['نعم', 'لا'], ''],
  ['remOffsets', 'مواعيد التذكير قبل الموعد', '1ي، 3س', null, 'ي = يوم، س = ساعة. مثال: 3ي، 1ي، 3س'],
  ['remMissed', 'تذكير: فوات الموعد', 'لا', ['نعم', 'لا'], 'لمن لم يسلّم، مع ذكر ما يمكن التعويض به'],
  ['remRisk', 'تنبيه: الطالب المتعثر', 'لا', ['نعم', 'لا'], 'مرة واحدة بعد نسبة من مدة البرنامج'],
  ['remRiskAt', 'تنبيه التعثر بعد (% من مدة البرنامج)', 50, null, ''],
  ['remRiskGap', 'تنبيه التعثر إن بقي للنجاح أكثر من (درجة)', 20, null, ''],
  ['remIdle', 'تذكير: الانقطاع عن التسليم', 'لا', ['نعم', 'لا'], ''],
  ['remIdleDays', 'أيام الانقطاع قبل التذكير', 7, null, ''],
  ['remHour', 'ساعة إرسال التذكيرات (0-23 بتوقيت القاهرة)', 19, null, 'التذكيرات اليومية تُرسل في هذه الساعة؛ تذكير الساعات (مثل 3س) في وقته'],
  ['remQuiet', 'ساعات الهدوء (لا إرسال)', '23 إلى 8', null, 'مثال: 23 إلى 8 = لا إرسال من 11 ليلًا إلى 8 صباحًا؛ «-» = بلا'],
  ['remSummary', 'ملخص كل دفعة تذكيرات يصل إلى', 'المالك', ['المالك', 'المالك والمشرفون', 'لا أحد'], 'عبر البوت الإداري: كم أُرسل وكم فشل أو حُظر'],
  ['tplOpen', 'نص إعلان الفتح', '🔔 أهلًا {الاسم}\nفُتح الآن التسليم في «{الفعالية}».\nآخر موعد: {الموعد}', null, 'المتغيرات: {الاسم} {الفعالية} {الموعد} {المتبقي} {المستوى}'],
  ['tplBefore', 'نص التذكير قبل الموعد', '⏰ تذكير يا {الاسم}: لم يصلنا تسليمك في «{الفعالية}» بعد.\nآخر موعد: {الموعد} (بقي {المتبقي}).', null, ''],
  ['tplMissed', 'نص فوات الموعد', '📌 {الاسم}، انتهى موعد «{الفعالية}» ({الموعد}) ولم يصلنا تسليمك.\n{التعويض}', null, '{التعويض} = الفعاليات التي يمكن التعويض بها'],
  ['tplRisk', 'نص تنبيه التعثر', '📊 {الاسم}، مضى جزء كبير من البرنامج وتحتاج {المتبقي} درجة أخرى لتبلغ النجاح. ما زال في الوقت متسع 🌿', null, '{المتبقي} = الدرجات الناقصة'],
  ['tplIdle', 'نص تذكير الانقطاع', '👋 {الاسم}، لم يصلنا منك تسليم منذ {المتبقي}. ننتظر مشاركتك!', null, '{المتبقي} = مدة الانقطاع'],
  ['tplManual', 'نص التذكير اليدوي', '🔔 {الاسم}، تذكير بتسليم «{الفعالية}».\nآخر موعد: {الموعد}', null, 'يُرسل من «📣 أرسل تذكيرًا الآن»']
];

/** أيام الأسبوع بترتيب getDay() في JavaScript (الأحد = 0) */
var WEEK_DAYS_JS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** أعمدة الجداول: [المفتاح، عنوان العمود، الخيارات أو null، العرض] */
var TABLE_FIELDS = {
  COMPONENTS: [
    ['title', 'العنوان في ورقة الدرجات', null, 170],
    ['sheet', 'الورقة', 'SHEETS', 120],
    ['type', 'النوع', ['أساسي', 'إضافي'], 80],
    ['max', 'الدرجة العظمى', null, 90],
    ['attempts', 'المحاولات المكررة', ['الأولى', 'الأعلى', 'الأخيرة'], 110],
    ['min', 'الحد الأدنى للنجاح', null, 110],
    ['group', 'المجموعة', 'GROUPS', 150],
    ['order', 'الترتيب', null, 70],
    ['emailPattern', 'نمط عمود البريد', null, 130],
    ['scorePattern', 'نمط عمود الدرجة', null, 130],
    ['enabled', 'مفعّل', ['نعم', 'لا'], 60],
    ['level', LEVEL_HEADER, 'LEVELS', 110]
  ],
  GROUPS: [
    ['title', 'اسم المجموعة', null, 170],
    ['rule', 'طريقة الحساب', ['الأعلى', 'المجموع', 'المتوسط'], 110],
    ['type', 'النوع', ['أساسي', 'إضافي'], 80],
    ['max', 'الدرجة العظمى (سقف)', null, 120],
    ['min', 'الحد الأدنى للنجاح', null, 110],
    ['order', 'الترتيب', null, 70],
    ['level', LEVEL_HEADER, 'LEVELS', 110]
  ],
  ACTIVITIES: [
    ['title', 'اسم الفعالية', null, 120],
    ['points', 'درجة التسليم الواحد', null, 120],
    ['maxCount', 'أقصى عدد تسليمات محتسبة', null, 150],
    ['maxPoints', 'أقصى درجة للفعالية', null, 120],
    ['type', 'النوع', ['إضافي', 'أساسي'], 80],
    ['min', 'الحد الأدنى للنجاح', null, 110],
    ['group', 'المجموعة', 'GROUPS', 120],
    ['order', 'الترتيب', null, 70],
    ['bot', 'متاحة في البوت', ['نعم', 'لا'], 100],
    ['accepts', 'نوع التسليم', ['نص أو ملف', 'نص فقط', 'ملف فقط'], 100],
    ['instructions', 'تعليمات تظهر للطالب', null, 260],
    ['level', LEVEL_HEADER, 'LEVELS', 110],
    ['pausedFrom', 'موقوف من', null, 130],
    ['pausedUntil', 'موقوف حتى', null, 130]
  ],
  BANDS: [
    ['min', 'من درجة', null, 90],
    ['label', 'التقدير', null, 120]
  ],
  LEVELS: [
    ['title', 'اسم المستوى', null, 170],
    ['passMark', 'درجة النجاح (فارغ = العامة)', null, 150],
    ['order', 'الترتيب', null, 70]
  ]
};

/** أعمدة ورقة التسليمات (يكتبها البوت ويقرؤها سكربت الدرجات) */
var SUB_HEADERS = ['الطابع الزمني', 'معرف التسليم', 'البريد', 'الاسم', 'الفعالية', 'نوع المحتوى', 'النص',
  'file_id', 'file_unique_id', 'اسم الملف', 'حجم الملف (بايت)', 'نوع الملف (MIME)',
  'معرف المستخدم', 'اسم المستخدم', 'الاسم في تيليجرام', 'معرف المحادثة', 'معرف الرسالة',
  'رقم التسليم', 'الدرجة المضافة', 'الحالة', 'ملاحظة'];
var SUB_REJECTED = ['مرفوض', 'ملغى', 'ملغي', 'محذوف'];
/** حالات التسليم، وأعمدة تُضاف إلى ورقة التسليمات عند أول حاجة (بعد آخر عمود؛ الصفوف القديمة بلا قيمة = مقبول) */
var SUB_ST = { OK: 'مقبول', REJ: 'مرفوض', DEL: 'محذوف' };
var SUB_EXTRA = { EDITED: 'وقت التعديل', REASON: 'سبب الرفض', BY: 'رفضه', AT: 'وقت الرفض' };

var CORRECTION_HEADERS = ['البريد الخاطئ', 'البريد الصحيح', 'ملاحظة'];
var UNMATCHED_HEADERS = ['المصدر', 'البريد المكتوب', 'الاسم المكتوب', 'الدرجة', 'الطابع الزمني', 'الاسم المسجل الصحيح', 'البريد المسجل الصحيح', 'الحالة', 'ملاحظة'];
var UNMATCHED_STATUS = { CREDITED: 'حُسبت للبريد الصحيح', MANUAL: 'يحتاج تصحيحًا يدويًا', AMBIGUOUS: 'الاسم يطابق أكثر من طالب' };
var OVERRIDE_HEADERS = ['البريد', 'العنصر (اختبار أو فعالية أو مجموعة)', 'الدرجة', 'ملاحظة'];

/* ───────────── أدوات عامة ───────────── */

function str_(v) { return v == null ? '' : String(v).trim(); }

function isBlank_(v) { return v === '' || v == null; }

function isYes_(v) {
  var s = str_(v).toLowerCase();
  return s === 'نعم' || s === 'yes' || s === 'true' || s === '✓' || v === true;
}

/** توحيد الأرقام العربية/الفارسية إلى لاتينية */
function latinDigits_(s) {
  return String(s).replace(/[\u0660-\u0669]/g, function (d) { return d.charCodeAt(0) - 0x0660; })
    .replace(/[\u06F0-\u06F9]/g, function (d) { return d.charCodeAt(0) - 0x06F0; });
}

function num_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var s = latinDigits_(str_(v)).replace(/[٫,]/g, '.');
  if (!s) return null;
  var m = s.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** توحيد صارم للبريد: NFKC + حذف كل المسافات والمحارف الخفية + أحرف صغيرة */
function normalizeEmail(v) {
  var s = v == null ? '' : String(v);
  if (s.normalize) s = s.normalize('NFKC');
  s = s.replace(/[\s\u00A0\u00AD\u034F\u061C\u115F\u1160\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u206F\u3000\uFEFF]/g, '');
  s = s.replace(/^mailto:/i, '');
  return s.toLowerCase();
}

function isValidEmail(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e); }

/** توحيد الأسماء العربية لأغراض المطابقة فقط */
function normalizeName_(v) {
  var s = str_(v);
  if (s.normalize) s = s.normalize('NFKC');
  return s.replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[^\u0621-\u064Aa-zA-Z ]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * أجزاء الاسم بعد التوحيد: حذف التشكيل والتطويل، أإآٱ←ا، ى←ي، ة←ه، مسافات موحدة.
 * «عبد» تُضم إلى ما بعدها (عبد الله = عبدالله) لأنها جزء واحد من الاسم.
 */
function nameTokens_(v) {
  var s = str_(v);
  if (s.normalize) s = s.normalize('NFKC');
  s = s.replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[^\u0621-\u064Aa-zA-Z ]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!s) return [];
  var t = s.split(' '), out = [];
  for (var i = 0; i < t.length; i++) {
    if (t[i] === 'عبد' && i + 1 < t.length) { out.push('عبد' + t[i + 1]); i++; } else out.push(t[i]);
  }
  return out;
}

/** مفتاح الاسم الرباعي: أول أربعة أجزاء، أو '' إن كان الاسم أقل من أربعة أجزاء */
function fourPartKey_(v) {
  var t = nameTokens_(v);
  return t.length >= 4 ? t.slice(0, 4).join(' ') : '';
}

/**
 * ترقية ورقة إعدادات قديمة: يعيد بنود القسم العام الغائبة وموضع إدراجها
 * { afterRow (1-based: آخر بند عام موجود), rows: [[النص، القيمة الافتراضية، الملاحظة]], fields }
 */
function missingGeneralRows(values) {
  var present = {}, inGeneral = false, last = -1;
  for (var r = 0; r < values.length; r++) {
    var k = sectionKeyOf_((values[r] || [])[0]);
    if (k) { inGeneral = k === 'GENERAL'; if (inGeneral) last = r; continue; }
    if (!inGeneral) continue;
    var label = str_((values[r] || [])[0]);
    if (!label) continue;
    GENERAL_FIELDS.forEach(function (f) { if (f[1] === label) { present[f[0]] = true; last = r; } });
  }
  var miss = GENERAL_FIELDS.filter(function (f) { return !present[f[0]]; });
  return { afterRow: last + 1, rows: miss.map(function (f) { return [f[1], f[2], f[4]]; }), fields: miss, hasGeneral: last >= 0 };
}

/**
 * ترقية جداول ورقة إعدادات قديمة للمستويات (خالص): أعمدة «المستوى» الغائبة وقسم «المستويات» الغائب.
 * يعيد { columns: [{row, col (0-based), table}], addLevelsSection: bool }
 */
function missingLevelParts(values) {
  var out = { columns: [], addLevelsSection: true };
  for (var r = 0; r < values.length; r++) {
    var k = sectionKeyOf_((values[r] || [])[0]);
    if (!k) continue;
    if (k === 'LEVELS') { out.addLevelsSection = false; continue; }
    if (['COMPONENTS', 'GROUPS', 'ACTIVITIES'].indexOf(k) < 0) continue;
    var hdr = (values[r + 1] || []).map(str_);
    if (hdr.indexOf(LEVEL_HEADER) >= 0) continue;
    var w = 0; TABLE_FIELDS[k].forEach(function (f) { var i = hdr.indexOf(f[1]); if (i >= 0) w = Math.max(w, i + 1); });
    out.columns.push({ row: r + 1, col: w, table: k });
  }
  return out;
}

/** سطر الملخص عن البريد غير المطابق (لرسالة الحساب وملخص البوت الإداري) */
function unmatchedSummary(stats, g) {
  if (!stats.unmatched) return 'بريد غير مطابق: لا يوجد 👍';
  return 'بريد غير مطابق: ' + stats.unmatched + ' سطرًا (ورقة «' + ((g && g.unmatchedSheet) || NAMES.UNMATCHED) + '»)' +
    '\n  • حُسب للبريد الصحيح بالاسم الرباعي: ' + (stats.credited || 0) +
    '\n  • يحتاج تصحيحًا يدويًا: ' + (stats.manual || 0) + (stats.ambiguous ? '\n  • الاسم يطابق أكثر من طالب: ' + stats.ambiguous : '');
}

/** يعيد رقم أول عمود يطابق عنوانه النمط (أو -1) */
function findColumn(headers, pattern) {
  if (!pattern) return -1;
  var re;
  try { re = new RegExp(pattern, 'i'); } catch (e) { re = new RegExp(String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
  for (var i = 0; i < headers.length; i++) {
    if (re.test(str_(headers[i]))) return i;
  }
  return -1;
}

/** يحوّل الطابع الزمني إلى رقم قابل للمقارنة */
function timeValue_(v, fallback) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v * 86400000; // رقم تسلسلي من الجدول
  var s = latinDigits_(str_(v));
  var m = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([صم])?\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m) {
    var h = Number(m[1]) % 12; if (m[4] === 'م') h += 12;
    return Date.UTC(+m[5], +m[6] - 1, +m[7], h, +m[2], +(m[3] || 0));
  }
  var t = Date.parse(s);
  return isNaN(t) ? fallback : t;
}

function extractSpreadsheetId(v) {
  var s = str_(v);
  var m = s.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  return m ? m[1] : s;
}

/* ───────────── قراءة ورقة الإعدادات ───────────── */

function sectionKeyOf_(cell) {
  var s = str_(cell).replace(/[^\u0621-\u064Aa-zA-Z ]/g, '').replace(/\s+/g, ' ').trim();
  for (var k in SECTIONS) if (SECTIONS[k] === s) return k;
  return null;
}

/**
 * يقرأ ورقة الإعدادات من مصفوفة قيم ثنائية ويعيد كائن الإعدادات.
 * الأقسام مكدسة رأسيًا؛ كل قسم يبدأ بسطر عنوانه في العمود A، ثم سطر رؤوس الأعمدة (عدا القسم العام).
 * يمكن تبديل ترتيب الأعمدة داخل الجداول لأن القراءة بالعناوين.
 */
function parseSettings(values) {
  var cfg = { general: {}, components: [], groups: [], activities: [], bands: [], levels: [], errors: [], warnings: [] };
  GENERAL_FIELDS.forEach(function (f) { cfg.general[f[0]] = f[2]; });
  var section = null, colMap = null, seq = 0;
  for (var r = 0; r < values.length; r++) {
    var row = values[r] || [];
    var sec = sectionKeyOf_(row[0]);
    if (sec) {
      section = sec; colMap = null;
      if (sec !== 'GENERAL') {
        var hdr = values[r + 1] || [];
        colMap = {};
        TABLE_FIELDS[sec].forEach(function (f) {
          for (var c = 0; c < hdr.length; c++) if (str_(hdr[c]) === f[1]) { colMap[f[0]] = c; break; }
        });
        r++;
      }
      continue;
    }
    if (!section || row.every(isBlank_)) continue;
    if (section === 'GENERAL') {
      var label = str_(row[0]);
      GENERAL_FIELDS.forEach(function (f) { if (f[1] === label) cfg.general[f[0]] = isBlank_(row[1]) ? '' : row[1]; });
      continue;
    }
    var obj = { _seq: seq++ };
    TABLE_FIELDS[section].forEach(function (f) { obj[f[0]] = colMap[f[0]] == null ? '' : row[colMap[f[0]]]; });
    if (!str_(obj.title) && section !== 'BANDS') continue;
    if (section === 'BANDS' && (num_(obj.min) == null || !str_(obj.label))) continue;
    cfg[{ COMPONENTS: 'components', GROUPS: 'groups', ACTIVITIES: 'activities', BANDS: 'bands', LEVELS: 'levels' }[section]].push(obj);
  }
  normalizeConfig_(cfg);
  return cfg;
}

function normalizeConfig_(cfg) {
  var g = cfg.general;
  ['passMark', 'extrasCap', 'finalCap', 'decimals'].forEach(function (k) { g[k] = num_(g[k]); });
  if (g.decimals == null) g.decimals = 2;
  g.finalRequired = isYes_(g.finalRequired);
  g.regSpreadsheetId = extractSpreadsheetId(g.regSpreadsheetId);
  ['programName', 'regSheet', 'finalSheet', 'gradesSheet', 'passersSheet', 'malePassersSheet', 'femalePassersSheet',
    'studentBase', 'passBasis', 'sortBy', 'maleValue', 'femaleValue'].forEach(function (k) { g[k] = str_(g[k]); });
  g.reviewChatId = str_(g.reviewChatId);
  g.regFormUrl = str_(g.regFormUrl);
  // بنود أُضيفت لاحقًا: الفارغ أو الغائب من ورقة قديمة = القيمة الافتراضية
  g.nameMatch = str_(g.nameMatch) === '' ? true : isYes_(g.nameMatch);
  g.quizNamePattern = str_(g.quizNamePattern) || 'الاسم';
  g.unmatchedSheet = str_(g.unmatchedSheet) || NAMES.UNMATCHED;
  if (g.passMark == null) cfg.errors.push('لم تُحدد درجة النجاح.');
  g.levelPassRule = [OPT.LV_EACH, OPT.LV_TOTAL, OPT.LV_BOTH].indexOf(str_(g.levelPassRule)) >= 0 ? str_(g.levelPassRule) : OPT.LV_BOTH;
  g.overallPassMark = num_(g.overallPassMark);
  g.levelPassers = isYes_(g.levelPassers);

  var titles = {};
  function claim(t, kind) {
    if (titles[t]) cfg.errors.push('العنوان «' + t + '» مكرر بين ' + titles[t] + ' و' + kind + '. يجب أن تكون العناوين فريدة.');
    titles[t] = kind;
  }
  cfg.components = cfg.components.filter(function (c) { return str_(c.enabled) !== OPT.NO; }).map(function (c) {
    var o = {
      kind: 'component', title: str_(c.title), sheet: str_(c.sheet) || str_(c.title),
      type: str_(c.type) === OPT.EXTRA ? 'extra' : 'basic', max: num_(c.max),
      attempts: str_(c.attempts) === OPT.HIGHEST ? 'highest' : (str_(c.attempts) === OPT.LAST ? 'last' : 'first'),
      min: num_(c.min), group: str_(c.group), order: num_(c.order), seq: c._seq,
      emailPattern: str_(c.emailPattern) || 'بريد|e-?mail', scorePattern: str_(c.scorePattern) || '^(النتيجة|score|الدرجة|المجموع)'
    };
    withLevel_(o, c); claim(o.key, 'اختبار'); return o;
  });
  cfg.groups = cfg.groups.map(function (c) {
    var rule = str_(c.rule);
    var o = {
      kind: 'group', title: str_(c.title), rule: rule === OPT.G_SUM ? 'sum' : (rule === OPT.G_AVG ? 'avg' : 'max'),
      type: str_(c.type) === OPT.EXTRA ? 'extra' : 'basic', max: num_(c.max), min: num_(c.min),
      order: num_(c.order), seq: 1000 + c._seq
    };
    withLevel_(o, c); claim(o.key, 'مجموعة'); return o;
  });
  cfg.activities = cfg.activities.map(function (c) {
    var acc = str_(c.accepts);
    var o = {
      kind: 'activity', title: str_(c.title), points: num_(c.points) || 0, maxCount: num_(c.maxCount),
      maxPoints: num_(c.maxPoints), type: str_(c.type) === OPT.BASIC ? 'basic' : 'extra', min: num_(c.min),
      group: str_(c.group), order: num_(c.order), seq: 2000 + c._seq, bot: str_(c.bot) !== OPT.NO,
      accepts: acc === OPT.ACC_TEXT ? 'text' : (acc === OPT.ACC_FILE ? 'file' : 'any'),
      instructions: str_(c.instructions)
    };
    withLevel_(o, c); claim(o.key, 'فعالية');
    // الإيقاف المؤقت: يُحسب عند القراءة (لا مؤقت)؛ التاريخ غير المفهوم تنبيه لا خطأ حتى لا يتوقف شيء
    ['pausedFrom', 'pausedUntil'].forEach(function (k) {
      var v = dateValue_(c[k]);
      if (v === undefined) { cfg.warnings.push('«' + o.key + '»: تاريخ غير مفهوم في عمود «' + (k === 'pausedFrom' ? 'موقوف من' : 'موقوف حتى') + '»: ' + str_(c[k]) + ' (الصيغة: 2026-11-20 18:00)'); v = null; }
      o[k] = v;
    });
    return o;
  });
  cfg.bands = cfg.bands.map(function (b) { return { min: num_(b.min), label: str_(b.label) }; })
    .sort(function (a, b) { return b.min - a.min; });
  // المستويات: جدول «المستويات» (اختياري) + قيم عمود «المستوى» في العناصر، بترتيب الجدول ثم أول ظهور
  var lvDefs = cfg.levels.map(function (l) { return { title: str_(l.title), passMark: num_(l.passMark), order: num_(l.order), seq: l._seq }; })
    .filter(function (l) { return l.title; })
    .sort(function (a, b) { var oa = a.order == null ? 1e9 : a.order, ob = b.order == null ? 1e9 : b.order; return oa !== ob ? oa - ob : a.seq - b.seq; });
  var lvByName = {};
  lvDefs.forEach(function (l) { if (lvByName[l.title]) cfg.errors.push('المستوى «' + l.title + '» مكرر في جدول المستويات.'); lvByName[l.title] = l; });
  var defined = lvDefs.length > 0, all = cfg.components.concat(cfg.groups, cfg.activities);
  all.forEach(function (it) {
    if (!it.level || lvByName[it.level]) return;
    if (defined) { cfg.errors.push('«' + it.title + '» في مستوى غير معرّف في جدول «' + SECTIONS.LEVELS + '»: ' + it.level); return; }
    lvByName[it.level] = { title: it.level, passMark: null }; lvDefs.push(lvByName[it.level]);
  });
  cfg.levels = lvDefs.map(function (l) { return { title: l.title, passMark: l.passMark != null ? l.passMark : g.passMark }; });
  // المجموعة تُطلب في مستوى العنصر نفسه
  var groupKeys = {};
  cfg.groups.forEach(function (gr) { groupKeys[gr.level + '\u0001' + gr.title] = gr; });
  cfg.components.concat(cfg.activities).forEach(function (it) {
    if (!it.group) return;
    var gr = groupKeys[it.level + '\u0001' + it.group];
    if (gr) { it.groupKey = gr.key; return; }
    var other = cfg.groups.filter(function (x) { return x.title === it.group; })[0];
    if (other) cfg.errors.push('«' + it.key + '» في ' + (it.level ? 'المستوى «' + it.level + '»' : 'بلا مستوى') + ' لكن المجموعة «' + it.group + '» ' +
      (other.level ? 'في المستوى «' + other.level + '»' : 'بلا مستوى') + '. المجموعة تجمع عناصر مستوى واحد.');
    else cfg.errors.push('«' + it.title + '» يشير إلى مجموعة غير معرّفة: ' + it.group);
  });
  return cfg;
}

/** يضيف المستوى والمفتاح الفريد: «العنوان» بلا مستوى، و«العنوان (المستوى)» مع مستوى (فيتكرر العنوان نفسه في مستويات مختلفة) */
function withLevel_(o, raw) {
  o.level = str_(raw.level);
  o.key = o.level ? o.title + ' (' + o.level + ')' : o.title;
  return o;
}

/** يحسب درجة فعالية من عدد التسليمات المقبولة وفق إعداداتها */
function activityPoints(count, act) {
  var counted = act.maxCount != null ? Math.min(count, act.maxCount) : count;
  var p = counted * (act.points || 0);
  if (act.maxPoints != null) p = Math.min(p, act.maxPoints);
  return p;
}

/** خريطة تصحيح البريد من جدول (الخاطئ ← الصحيح) */
function buildCorrections(values) {
  var map = {};
  (values || []).slice(1).forEach(function (r) {
    var a = normalizeEmail(r[0]), b = normalizeEmail(r[1]);
    if (a && b && a !== b) map[a] = b;
  });
  return map;
}

function applyCorrection(map, email) {
  var e = email, hops = 0;
  while (map[e] && hops++ < 5) e = map[e];
  return e;
}

/**
 * يقرأ ردود التسجيل ويعيد خريطة: البريد ← {name, gender}
 * المكرر يُحتفظ بأحدث ردوده (الأخير في الورقة).
 */
function readRegistration(values, g, corrections) {
  var out = { map: {}, duplicates: 0, rows: 0, errors: [] };
  if (!values || !values.length) return out;
  var h = values[0];
  var ei = findColumn(h, g.regEmailPattern), ni = findColumn(h, g.regNamePattern), gi = findColumn(h, g.regGenderPattern);
  if (ei < 0) { out.errors.push('لم يُعثر على عمود البريد في ملف التسجيل (النمط: ' + g.regEmailPattern + ').'); return out; }
  for (var r = 1; r < values.length; r++) {
    var e = applyCorrection(corrections || {}, normalizeEmail(values[r][ei]));
    if (!e) continue;
    out.rows++;
    if (out.map[e]) out.duplicates++;
    out.map[e] = { name: ni >= 0 ? str_(values[r][ni]) : '', gender: gi >= 0 ? str_(values[r][gi]) : '' };
  }
  return out;
}

/* ───────── التواريخ والإيقاف المؤقت وخيارات الطلاب (v6) ───────── */

/**
 * يحوّل قيمة تاريخ من الورقة إلى ميلي ثانية: Date، أو نص «2026-11-20 18:00» / «20/11/2026» (بالتوقيت المحلي للمشروع)،
 * أو ISO من الذاكرة المؤقتة. الفارغ = null، وغير المفهوم = undefined.
 */
function dateValue_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? undefined : v.getTime();
  if (typeof v === 'number') return v > 1e11 ? v : new Date(1899, 11, 30).getTime() + Math.round(v * 86400000);
  var s = latinDigits_(str_(v));
  if (!s) return null;
  if (/T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) { var t = Date.parse(s); return isNaN(t) ? undefined : t; }
  // تاريخ مستحيل (شهر 13، يوم 31 في شهر من 30، ساعة 25) = غير مفهوم، لا يُرحَّل لتاريخ آخر
  var mk = function (y, mo, d, h, mi) { var t = new Date(y, mo - 1, d, h, mi); return t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === d && h < 24 && mi < 60 ? t.getTime() : undefined; };
  var m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T]+(\d{1,2})(?::(\d{2}))?)?$/);
  if (m) return mk(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0));
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})(?:\s+(\d{1,2})(?::(\d{2}))?)?$/);
  if (m) return mk(+m[3], +m[2], +m[1], +(m[4] || 0), +(m[5] || 0));
  return undefined;
}

/** «2026-11-20 18:00» بالتوقيت المحلي (توقيت المشروع: القاهرة) */
function fmtTime(ms) {
  if (ms == null || ms === '') return '';
  var d = ms instanceof Date ? ms : new Date(typeof ms === 'number' ? ms : dateValue_(ms));
  if (isNaN(d.getTime())) return str_(ms);
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/** الفعالية موقوفة الآن؟ يعيد null أو {from, until} (until = null: حتى يعاد تفعيلها). فعالية من ذاكرة v5 بلا الحقلين = غير موقوفة. */
function pauseState(a, now) {
  var f = a && a.pausedFrom, u = a && a.pausedUntil;
  if (f == null && u == null) return null;
  if (f != null && now < f) return null;
  if (u != null && now >= u) return null;
  return { from: f == null ? null : f, until: u == null ? null : u };
}

/** خيارات الطلاب من القسم العام؛ تتحمل إعدادات قديمة أو مخزنة من نسخة سابقة (الغائب = الافتراضي) */
function studentOptions(g) {
  g = g || {};
  function yn(k, def) { var s = str_(g[k]); return s === '' ? def : isYes_(s); }
  var w = num_(g.editWindow); // الغائب أو الفارغ = بلا حد (قرار v7)
  return {
    showGrades: yn('showGrades', false), showSubs: yn('showSubs', true),
    allowDelete: yn('allowDelete', true), allowEdit: yn('allowEdit', true), editWindowH: w,
    rejectButtons: yn('rejectButtons', true), notifyReject: yn('notifyReject', true)
  };
}

/** خيارات التقرير الأسبوعي */
function weeklyOptions(g) {
  g = g || {};
  var d = WEEK_DAYS_JS.indexOf(str_(g.weeklyDay)), h = num_(g.weeklyHour), low = num_(g.weeklyLow);
  return {
    on: isYes_(g.weeklyReport), day: d >= 0 ? d : 5, hour: h != null && h >= 0 && h <= 23 ? Math.floor(h) : 20,
    admins: str_(g.weeklyTo) === 'المالك والمشرفون', low: low != null && low >= 0 ? low : 1
  };
}

/** أعمدة جداول الإعدادات الغائبة غير «المستوى» (مثل «موقوف من/حتى») — للترقية دون المساس بالقيم */
function missingTableColumns(values) {
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var k = sectionKeyOf_((values[r] || [])[0]);
    if (k !== 'ACTIVITIES') continue;
    var hdr = (values[r + 1] || []).map(str_), w = 0;
    TABLE_FIELDS[k].forEach(function (f) { var i = hdr.indexOf(f[1]); if (i >= 0) w = Math.max(w, i + 1); });
    TABLE_FIELDS[k].forEach(function (f) {
      if (f[0] === 'level' || hdr.indexOf(f[1]) >= 0) return;
      out.push({ row: r + 1, col: w++, table: k, header: f[1] });
    });
  }
  return out;
}

// ===== DailyWird.gs =====
/**
 * DailyWird.gs — إضافة «📖 الورد اليومي» (dailyWird). تعمل فقط إن كانت isModuleActive_('dailyWird').
 *
 * الخطة: ورقة «خطة الورد» في ملف البرنامج (تنشئها الخدمة؛ يملؤها العميل أو يستوردها بـ /wird import).
 *   (قرار المالك) بالتاريخ فقط: كل صف يُنشر في تاريخه هو (توقيت القاهرة). الصف بلا تاريخ لا يُنشر أبدًا،
 *   ويُنبَّه المالك بأرقام صفوفه (في /wird وفي فحص يومي). الأيام الفائتة لا تُعوَّض: تُسجَّل «فات» فقط.
 *   «توقف» في الملاحظة = لا نشر ذلك اليوم.
 * الإعدادات لكل برنامج (صغيرة) في حالة الوحدة MOD_dailyWird: القناة، الساعة، الشكل (نص/صورة ثابتة بمعرّف تيليجرام فقط)،
 *   تخطي الجمعة، العطل بتاريخ، الإيقاف المؤقت، آخر يوم عولج.
 * النشر: في المشغّل الساعي من بوت الطلاب، مرة واحدة يوميًا (last = اليوم بعد النجاح)، خلال WIRD_LATE_H ساعات من ساعة النشر،
 *   ويُسجَّل في «سجل الورد» (ملف التحكم) مع حدث wird_posted. الفشل: إعادة في الساعات التالية + تنبيه واحد يوميًا للمالك.
 * قرار المالك: يستمر النشر بعد إغلاق البرنامج للتسليم أو انتهائه ما دامت في الخطة صفوف بتواريخ قادمة؛ يتوقف فقط بالإيقاف الصريح أو انتهاء الخطة.
 * لا ملفات على درايف: الصورة تُحفظ معرّفات تيليجرام فقط (معرّف البوت الإداري، ثم معرّف بوت الطلاب بعد أول نشر).
 */
var WIRD = { SHEET: 'خطة الورد', LOG: 'سجل الورد', LATE_H: 6, SCHED_NOTE: 'من خطة الورد', MAX_BUTTONS: 8, CAPTION: 1024 };
/** عناوين ورقة «خطة الورد» التي تنشئها الخدمة: أعمدة القالب الحديث ثم حقول الخدمة في الآخر. */
var WIRD_HEADERS = [
  'التاريخ', 'العنوان {{TITLE}}', 'نص الرسالة الأساسي',
  'إضافي 1', 'إضافي 2', 'إضافي 3', 'إضافي 4',
  'الروابط المتعددة', 'رابط المرفق', 'نوع المرفق', 'رقم الشريحة المخصص',
  'الفعالية المرتبطة (اختياري)', 'آخر موعد (اختياري)', 'ملاحظة («توقف» = لا نشر)'
];
var WIRD_FIELDS = ['date', 'title', 'text', 'extra1', 'extra2', 'extra3', 'extra4', 'links', 'attach', 'attachType', 'slide', 'act', 'deadline', 'note'];
var WIRD_LOG_HEADERS = ['الوقت', 'البرنامج', 'اليوم', 'الصف', 'العنوان', 'المحادثة', 'الرسالة', 'النتيجة', 'ملاحظة'];
var WIRD_DEFAULTS = { on: false, chat: '', chatTitle: '', hour: 6, fmt: 'text', photoA: '', photoS: '', fri: false, hol: [], pause: '', last: '', since: '', missTo: '', n: 0, alertDay: '', undatedDay: '', endNote: '' };
/** مطابقة مرنة: القالب الحديث، ومثالا منسّق الأوراد، والعناوين القديمة المنشورة. */
var WIRD_COL_ALIASES = {
  date: ['التاريخ', 'تاريخ', 'اليوم', 'date', 'day'],
  title: ['العنوان {{TITLE}}', 'العنوان', 'عنوان الورد', 'عنوان', 'نص قالب التذكير', 'قالب التذكير', 'المقرر', 'الموضوع', 'title'],
  text: ['نص الرسالة الأساسي', 'نص الرسالة', 'رسالة التذكير', 'النص', 'المحتوى', 'التوجيه', 'الوصف', 'text', 'content'],
  extra1: ['إضافي 1', 'اضافي 1'],
  extra2: ['إضافي 2', 'اضافي 2'],
  extra3: ['إضافي 3', 'اضافي 3'],
  extra4: ['إضافي 4', 'اضافي 4'],
  links: ['الروابط المتعددة', 'الروابط', 'روابط', 'أبيات المقطوعات ورابطها وأية روابط أخرى', 'أبيات المقطوعات', 'links'],
  attach: ['رابط المرفق', 'المرفق'],
  attachType: ['نوع المرفق'],
  slide: ['رقم الشريحة المخصص', 'رقم الشريحة'],
  act: ['الفعالية المرتبطة', 'الفعالية', 'المهمة'],
  deadline: ['آخر موعد', 'اخر موعد', 'الموعد', 'deadline'],
  note: ['ملاحظة', 'ملاحظات', 'note']
};
var WIRD_SKIP_TABS = /^(الاعدادات|settings|تعليمات|دليل الاستخدام|دليل الاستعمال|guide|instructions)/i;
var WIRD_MONTHS_AR = { يناير: 1, فبراير: 2, مارس: 3, ابريل: 4, مايو: 5, يونيو: 6, يونيه: 6, يوليو: 7, يوليه: 7, اغسطس: 8, سبتمبر: 9, اكتوبر: 10, نوفمبر: 11, ديسمبر: 12 };

function wirdState_() { var s = moduleState_('dailyWird'); s.p = s.p || {}; return s; }
function wirdCfg_(s, pid) { var c = JSON.parse(JSON.stringify(WIRD_DEFAULTS)); var x = s.p[pid] || {}; Object.keys(x).forEach(function (k) { c[k] = x[k]; }); return c; }
function saveWirdCfg_(pid, patch) {
  var s = wirdState_(), c = wirdCfg_(s, pid);
  Object.keys(patch).forEach(function (k) { c[k] = patch[k]; });
  s.p[pid] = c; saveModuleState_('dailyWird', s);
  return c;
}

/* ───────── ورقة الخطة (قراءة بالعنوان، متوافقة مع العناوين القديمة والقالب الحديث) ───────── */
function wirdHeaderScore_(h, alias) {
  var a = normKey_(alias);
  if (!h || !a) return 0;
  if (h === a) return 1000 + a.length;
  if (h.indexOf(a) === 0 && (h.length === a.length || h.charAt(a.length) === ' ')) return 500 + a.length;
  if (a.length >= 8 && h.indexOf(a) >= 0) return 200 + a.length;
  return 0;
}
function wirdPlanCols_(head) {
  var hn = (head || []).map(function (x) { return normKey_(x); }), best = [];
  WIRD_FIELDS.forEach(function (k) {
    (WIRD_COL_ALIASES[k] || []).forEach(function (alias) {
      hn.forEach(function (h, j) {
        var sc = wirdHeaderScore_(h, alias);
        if (sc) best.push({ j: j, k: k, s: sc });
      });
    });
  });
  best.sort(function (a, b) { return b.s - a.s; });
  var col = {}, used = {};
  best.forEach(function (x) {
    if (col[x.k] != null || used[x.j]) return;
    col[x.k] = x.j;
    used[x.j] = 1;
  });
  return col;
}
function wirdHeaderCellIsDate_(v) {
  return wirdParseDate_(v) != null && wirdParseDate_(v) !== undefined && !/(^| )(تاريخ|التاريخ|اليوم|date|day)( |$)/.test(normKey_(v));
}
function wirdColsOrLegacy_(head) {
  var col = wirdPlanCols_(head);
  var byHeader = col.date != null || col.title != null || col.text != null;
  // الصف الأول تاريخ فعلي (لا كلمة «التاريخ») = بيانات بلا صف عناوين: الترتيبة القديمة
  if (byHeader && (wirdHeaderCellIsDate_(head[0]) || (col.date != null && wirdHeaderCellIsDate_(head[col.date])))) {
    byHeader = false;
  }
  if (byHeader) return { col: col, byHeader: true };
  return { col: { date: 0, title: 1, text: 2, links: 7 }, byHeader: false };
}
function wirdMappingText_(col, head, byHeader) {
  if (!byHeader) return 'بلا عناوين معروفة: الترتيبة القديمة (A تاريخ، B عنوان، C نص، H روابط)';
  var parts = [];
  WIRD_FIELDS.forEach(function (k) {
    if (col[k] != null) parts.push(k + '←' + str_(head[col[k]]));
  });
  return 'بالعناوين: ' + parts.join('، ');
}
function wirdParseDate_(v) {
  var t = dateValue_(v);
  if (t != null && t !== undefined) return t;
  var s = latinDigits_(str_(v));
  if (!s) return t;
  if (s.normalize) s = s.normalize('NFKC');
  s = s.replace(/[أإآٱ]/g, 'ا');
  var m = s.match(/^(\d{1,2})\s+([^\s\d/]+)\s+(\d{4})(?:[ T]+(\d{1,2})(?::(\d{2}))?)?/);
  if (m) {
    var mon = WIRD_MONTHS_AR[m[2]] || WIRD_MONTHS_AR[normKey_(m[2])];
    if (mon) return dateValue_(m[3] + '-' + mon + '-' + m[1] + (m[4] ? ' ' + m[4] + ':' + (m[5] || '00') : ''));
  }
  return t;
}
function wirdHasClock_(v) {
  if (typeof v === 'number' && v <= 1e11) return Math.abs(v - Math.round(v)) > 1e-6; // كسر الرقم التسلسلي = ساعة
  if (Object.prototype.toString.call(v) === '[object Date]') return !!(v.getHours() || v.getMinutes());
  return /[ T]\d{1,2}:\d{2}/.test(latinDigits_(str_(v)));
}
function wirdStamp_(v) {
  var t = wirdParseDate_(v);
  if (t == null || t === undefined) return { date: '', hour: null, stamp: '' };
  var d = new Date(t), hour = wirdHasClock_(v) ? d.getHours() : null;
  return { date: dayKey_(t), hour: hour, stamp: hour != null ? fmtTime(t) : dayKey_(t) };
}
function wirdDay_(v) { return wirdStamp_(v).date; }
function wirdCell_(r, col, k) { return col[k] != null ? r[col[k]] : ''; }
function wirdPlanRow_(r, col, line) {
  var st = wirdStamp_(wirdCell_(r, col, 'date'));
  var o = { r: line, date: st.date, hour: st.hour, stamp: st.stamp };
  WIRD_FIELDS.forEach(function (k) {
    if (k === 'date') return;
    var raw = wirdCell_(r, col, k);
    o[k] = k === 'deadline' && (raw instanceof Date || Object.prototype.toString.call(raw) === '[object Date]') ? raw : str_(raw);
  });
  o.stop = /توقف|stop/i.test(o.note);
  return o;
}
function wirdRowFilled_(o) {
  return !!(o.title || o.text || o.stop || o.extra1 || o.extra2 || o.extra3 || o.extra4 || o.links || o.attach);
}
function wirdCanonicalRow_(o) {
  return WIRD_FIELDS.map(function (k) {
    if (k === 'date') return o.stamp || o.date || '';
    if (k === 'deadline') return o.deadline == null ? '' : o.deadline;
    return o[k] || '';
  });
}
function readWirdPlanValues_(values) {
  if (!values || !values.length) return [];
  var info = wirdColsOrLegacy_(values[0]);
  var data = info.byHeader ? values.slice(1) : values;
  var start = info.byHeader ? 2 : 1, out = [];
  data.forEach(function (r, i) {
    var o = wirdPlanRow_(r, info.col, start + i);
    if (wirdRowFilled_(o)) out.push(o);
  });
  return out;
}
function ensureWirdHead_(sh) {
  var last = sh.getLastRow(), width = Math.max(sh.getLastColumn(), 1);
  if (last <= 1) {
    sh.getRange(1, 1, 1, WIRD_HEADERS.length).setValues([WIRD_HEADERS]);
    return WIRD_HEADERS.slice();
  }
  var head = sh.getRange(1, 1, 1, width).getValues()[0].slice();
  var col = wirdPlanCols_(head), added = false;
  WIRD_FIELDS.forEach(function (k, i) {
    if (col[k] != null) return;
    head.push(WIRD_HEADERS[i]);
    col[k] = head.length - 1;
    added = true;
  });
  if (added) sh.getRange(1, 1, 1, head.length).setValues([head]);
  return head;
}
function ensureWirdSheet_(pid) {
  var ss = programSpreadsheet_(pid), sh = ss.getSheetByName(WIRD.SHEET);
  if (!sh) {
    sh = ss.insertSheet(WIRD.SHEET);
    sh.getRange(1, 1, 1, WIRD_HEADERS.length).setValues([WIRD_HEADERS]);
    try { sh.setFrozenRows(1); sh.setRightToLeft(true); } catch (e) { /* تجاهل */ }
    return sh;
  }
  ensureWirdHead_(sh);
  try { if (sh.getLastRow() <= 1) { sh.setFrozenRows(1); sh.setRightToLeft(true); } } catch (e) { /* تجاهل */ }
  return sh;
}
function wirdWritePlanRows_(sh, rows) {
  var head = ensureWirdHead_(sh), col = wirdPlanCols_(head), last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, head.length).clearContent();
  if (!rows || !rows.length) return;
  var grid = rows.map(function (canon) {
    var dest = head.map(function () { return ''; });
    WIRD_FIELDS.forEach(function (k, i) { dest[col[k]] = canon[i] == null ? '' : canon[i]; });
    return dest;
  });
  sh.getRange(2, 1, grid.length, head.length).setValues(grid);
}
/** صفوف الخطة: كائن بكل الحقول + {r, hour, stamp, stop} (الفارغة تُتجاهل) */
function readWirdPlan_(pid) {
  var sh = programSpreadsheet_(pid).getSheetByName(WIRD.SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var w = Math.max(sh.getLastColumn(), 1);
  return readWirdPlanValues_(sh.getRange(1, 1, sh.getLastRow(), w).getValues());
}

/** يختار ما يُنشر يوم day (بالتاريخ فقط): {row} أو {skip} أو {none} أو {end} */
function pickWird_(plan, day) {
  var dated = plan.filter(function (x) { return x.date === day; });
  if (dated.some(function (x) { return x.stop; })) return { skip: 'توقف (صف بتاريخ ' + day + ')' };
  if (dated.length) return { row: dated[0] };
  return plan.some(function (x) { return x.date && x.date > day; }) ? { none: true } : { end: true };
}
/** صفوف بلا تاريخ (لا تُنشر أبدًا) */
function undatedWird_(plan) { return plan.filter(function (x) { return !x.date && !x.stop; }); }
function undatedText_(p, und) {
  return '⚠️ في «' + WIRD.SHEET + '» لبرنامج «' + (p.name || p.id) + '» ' + und.length + ' صفًا بلا تاريخ، ولن تُنشر حتى تكتب تاريخها: الصفوف ' +
    und.slice(0, 20).map(function (x) { return x.r; }).join('، ') + (und.length > 20 ? '…' : '') + '.';
}

/** لماذا لا يُنشر اليوم (إيقاف مؤقت/جمعة/عطلة) أو '' */
function wirdDayOff_(cfg, now) {
  var day = dayKey_(now);
  if (cfg.pause && (cfg.pause === 'x' || day <= cfg.pause)) return 'pause';
  if (cfg.fri && new Date(now).getDay() === 5) return 'الجمعة';
  if ((cfg.hol || []).indexOf(day) >= 0) return 'عطلة';
  return '';
}

/* ───────── بناء المنشور وإرساله (HTML: الأبيات/العنوان رابط أزرق، بلا إظهار URL وبدون زر له) ───────── */
function wirdHtmlEscape_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function wirdHtmlAttr_(s) {
  return wirdHtmlEscape_(s).replace(/"/g, '&quot;');
}
function wirdCleanUrl_(u) {
  var url = str_(u).replace(/[).,،]+$/, '');
  return /^https?:\/\//i.test(url) ? url : '';
}
function wirdHtmlLink_(url, text) {
  url = wirdCleanUrl_(url);
  if (!url) return wirdHtmlEscape_(text);
  if (!str_(text)) return wirdHtmlEscape_(url);
  return '<a href="' + wirdHtmlAttr_(url) + '">' + wirdHtmlEscape_(text) + '</a>';
}
function wirdClipHtml_(s, n) {
  s = str_(s);
  if (s.length <= n) return s;
  var cut = s.slice(0, n), lt = cut.lastIndexOf('<'), gt = cut.lastIndexOf('>');
  if (lt > gt) cut = cut.slice(0, lt);
  if ((cut.match(/<a\b/gi) || []).length > (cut.match(/<\/a>/gi) || []).length) {
    var i = cut.lastIndexOf('<a');
    if (i >= 0) cut = cut.slice(0, i);
  }
  return cut.replace(/\s+$/, '') + '\n…';
}
/** مقاطع من عمود الروابط: {text, url}. URL:: يربط النص السابق كله (كما في المذكّر الأصلي). */
function wirdLinkSegments_(raw) {
  var out = [];
  str_(raw).replace(/\r\n/g, '\n').split(/\n?---LINK---\n?/).forEach(function (chunk) {
    if (!str_(chunk).trim()) return;
    var found = [], rx = /URL::\s*(https?:\/\/\S+)/gi, m;
    while ((m = rx.exec(chunk))) found.push({ i: m.index, len: m[0].length, url: wirdCleanUrl_(m[1]) });
    if (found.length) {
      var cursor = 0;
      found.forEach(function (f) {
        out.push({ text: chunk.slice(cursor, f.i).trim(), url: f.url });
        cursor = f.i + f.len;
      });
      var tail = chunk.slice(cursor).trim();
      if (tail) out.push({ text: tail, url: '' });
      return;
    }
    chunk.split(/\n/).forEach(function (line) {
      var s = str_(line).trim();
      if (!s) return;
      var m = s.match(/^(.*?)\s*[|｜]\s*(https?:\/\/\S+)\s*$/) ||
        s.match(/^(.*?)\s*[:：]\s*(https?:\/\/\S+)\s*$/) ||
        s.match(/^(.*?)\s+[\-–—]\s*(https?:\/\/\S+)\s*$/) ||
        s.match(/^(.*?)\s+(https?:\/\/\S+)\s*$/) ||
        s.match(/^\s*()(https?:\/\/\S+)\s*$/);
      if (m) out.push({ text: str_(m[1]).replace(/^URL$/i, ''), url: wirdCleanUrl_(m[2]) });
      else out.push({ text: s, url: '' });
    });
  });
  return out;
}
function wirdLinksBlock_(links) {
  return wirdLinkSegments_(links).map(function (seg, i, arr) {
    if (seg.url && seg.text) return wirdHtmlLink_(seg.url, seg.text);
    if (seg.url) return wirdHtmlEscape_(seg.url);
    return wirdHtmlEscape_(seg.text);
  }).filter(Boolean).join('\n');
}
function wirdButtons_(links, attach, attachType) {
  var out = [], um = str_(attach).match(/https?:\/\/\S+/);
  if (um) {
    var typ = str_(attachType);
    var label = /صوت|audio/i.test(typ) ? '🎵 صوت' : /صور|photo|image/i.test(typ) ? '🖼 صورة' : /ملف|file|pdf|document/i.test(typ) ? '📎 ملف' : '📎 المرفق';
    out.push([{ text: label, url: wirdCleanUrl_(um[0]) || um[0] }]);
  }
  return out;
}
function wirdComposeBody_(row) {
  var body = [row.text, row.extra1, row.extra2, row.extra3, row.extra4].map(function (p) {
    return str_(p).replace(/\r\n/g, '\n').split('%LINKS_BLOCK%').map(wirdHtmlEscape_).join('%LINKS_BLOCK%');
  }).filter(Boolean).join('\n\n');
  var block = wirdLinksBlock_(row.links);
  if (body.indexOf('%LINKS_BLOCK%') >= 0) body = body.split('%LINKS_BLOCK%').join(block);
  else if (block) body = body + (body ? '\n\n' : '') + block;
  return body;
}
function wirdText_(row, n) {
  var title = str_(row.title).replace(/\s+/g, ' ').trim();
  var head = wirdHtmlEscape_('📖 ورد اليوم ' + n + (title ? ' — ' + title : '') + ' ✨');
  var body = wirdComposeBody_(row);
  return { head: head, body: wirdClipHtml_(head + (body ? '\n\n' + body : ''), 4000) };
}
/** يرسل منشور الورد إلى chat من بوت role. يعيد {ok, mid, desc, photoS} */
function sendWird_(role, chat, cfg, row, n, extra) {
  var t = wirdText_(row, n), kb = wirdButtons_(row.links, row.attach, row.attachType);
  var prefix = wirdHtmlEscape_(extra || '');
  var base = { chat_id: chat, parse_mode: 'HTML', disable_web_page_preview: true };
  if (kb.length) base.reply_markup = { inline_keyboard: kb };
  var r;
  if (cfg.fmt === 'photo' && (cfg.photoA || cfg.photoS)) {
    var full = prefix + t.body, longText = full.length > WIRD.CAPTION, cap = longText ? prefix + t.head : full, photoS = '';
    if (cap.length > WIRD.CAPTION) cap = wirdClipHtml_(cap, WIRD.CAPTION);
    var p = { chat_id: chat, caption: cap, parse_mode: 'HTML' };
    if (!longText && kb.length) p.reply_markup = base.reply_markup;
    if (role === 'admin') { p.photo = cfg.photoA; r = tgAs_('admin', 'sendPhoto', p, true); }
    else if (cfg.photoS) { p.photo = cfg.photoS; r = tgAs_('student', 'sendPhoto', p, true); }
    else {
      // أول نشر بالصورة: تُنقل من البوت الإداري إلى بوت الطلاب في الذاكرة (لا تخزين)، ثم يُحفظ معرّفها عند بوت الطلاب
      var f = tgAs_('admin', 'getFile', { file_id: cfg.photoA }, true);
      if (!f.ok) return { ok: false, desc: 'تعذر جلب الصورة: ' + (f.description || '') };
      var blob = UrlFetchApp.fetch('https://api.telegram.org/file/bot' + tokenFor_('admin') + '/' + f.result.file_path).getBlob();
      var mp = { chat_id: String(chat), caption: p.caption, parse_mode: 'HTML', photo: blob };
      if (p.reply_markup) mp.reply_markup = JSON.stringify(p.reply_markup);
      r = tgMultipartAs_('student', 'sendPhoto', mp);
      if (r && r.ok && r.result && r.result.photo && r.result.photo.length) photoS = r.result.photo[r.result.photo.length - 1].file_id;
    }
    if (!r || !r.ok) return { ok: false, desc: (r && r.description) || 'فشل' };
    var mid = r.result && r.result.message_id;
    if (longText) {
      var r2 = tgAs_(role, 'sendMessage', Object.assign({}, base, { text: full }), true);
      if (!r2.ok) return { ok: false, desc: r2.description, photoS: photoS };
    }
    return { ok: true, mid: mid, photoS: photoS };
  }
  r = tgAs_(role, 'sendMessage', Object.assign({}, base, { text: prefix + t.body }), true);
  return r && r.ok ? { ok: true, mid: r.result && r.result.message_id } : { ok: false, desc: (r && r.description) || 'فشل' };
}

function wirdLog_(pid, day, row, chat, mid, result, note) {
  try {
    var ss = central_(), sh = ss.getSheetByName(WIRD.LOG);
    if (!sh) { sh = ss.insertSheet(WIRD.LOG); sh.getRange(1, 1, 1, WIRD_LOG_HEADERS.length).setValues([WIRD_LOG_HEADERS]); }
    sh.appendRow([new Date(), pid, day, row ? row.r : '', row ? row.title : '', String(chat || ''), mid || '', result, note || '']);
  } catch (e) { logError_(e, 'wird log'); }
}
function wirdAlert_(text) {
  if (!ownerId_()) return;
  try { tgAs_('admin', 'sendMessage', { chat_id: ownerId_(), text: text, disable_web_page_preview: true }, true); } catch (e) { logError_(e, 'wird alert'); }
}

/* ───────── المشغّل الساعي ───────── */
function wirdTick_(now, budgetEnd) {
  var s = wirdState_(), out = [];
  getPrograms_().forEach(function (p) {
    if (Date.now() > budgetEnd - 15000) return;
    var cfg = wirdCfg_(s, p.id);
    if (!cfg.on || !cfg.chat) return;
    try { var r = wirdTickProgram_(p, cfg, now); if (r) out.push(p.id + ':' + r); } catch (e) { logError_(e, 'wird ' + p.id); }
  });
  return out;
}

function wirdTickProgram_(p, cfg, now) {
  var day = dayKey_(now), hour = new Date(now).getHours();
  if (cfg.last === day) return '';
  var off = wirdDayOff_(cfg, now);
  if (off === 'pause') return '';
  var lock = tenantLock_();
  if (!lock.tryLock(5000)) return '';
  try {
    cfg = wirdCfg_(wirdState_(), p.id); // قراءة جديدة داخل القفل (منع النشر المزدوج)
    if (cfg.last === day) return '';
    var plan = readWirdPlan_(p.id), patch = {};
    // الفائت لا يُعوَّض: يُسجَّل مرة واحدة (منذ آخر يوم عولج أو منذ بدء النشر)
    if (cfg.missTo !== day) {
      var from = cfg.last || cfg.since || day;
      plan.filter(function (x) { return x.date && !x.stop && x.date < day && (x.date > from || (!cfg.last && x.date >= from)); })
        .forEach(function (x) { wirdLog_(p.id, x.date, x, cfg.chat, '', 'فات', 'لم يُنشر في يومه، ولا يُعوَّض'); });
      patch.missTo = day;
    }
    var und = undatedWird_(plan);
    if (und.length && cfg.undatedDay !== day) { patch.undatedDay = day; wirdAlert_(undatedText_(p, und)); }
    var done = function (o) { Object.keys(o).forEach(function (k) { patch[k] = o[k]; }); saveWirdCfg_(p.id, patch); };
    if (off) {
      if (hour < cfg.hour) { if (Object.keys(patch).length) saveWirdCfg_(p.id, patch); return ''; }
      done({ last: day }); wirdLog_(p.id, day, null, cfg.chat, '', 'تخطي', off); return 'skip';
    }
    var pick = pickWird_(plan, day);
    var rh = pick.row && pick.row.hour != null ? pick.row.hour : cfg.hour;
    if (hour < rh) return '';
    if (pick.end) {
      if (cfg.endNote !== 'done') { patch.endNote = 'done'; wirdAlert_('📖 انتهت «خطة الورد» لبرنامج «' + (p.name || p.id) + '»: لا صفوف بتواريخ قادمة (نُشر ' + cfg.n + ' وردًا). أضف صفوفًا بتواريخ ليستمر النشر.'); }
      done({ last: day }); return 'end';
    }
    if (pick.none) { done({ last: day }); return ''; }
    if (pick.skip) { done({ last: day }); wirdLog_(p.id, day, null, cfg.chat, '', 'تخطي', pick.skip); return 'skip'; }
    if (hour >= rh + WIRD.LATE_H) {
      done({ last: day }); wirdLog_(p.id, day, pick.row, cfg.chat, '', 'فات', 'تجاوز مهلة ' + WIRD.LATE_H + ' ساعات');
      wirdAlert_('⚠️ لم يُنشر ورد اليوم لبرنامج «' + (p.name || p.id) + '» (فات وقته). السبب الأخير في «' + WIRD.LOG + '».');
      return 'missed';
    }
    var res = sendWird_('student', cfg.chat, cfg, pick.row, cfg.n + 1);
    if (!res.ok) {
      wirdLog_(p.id, day, pick.row, cfg.chat, '', 'فشل', res.desc);
      if (res.photoS) patch.photoS = res.photoS;
      if (cfg.alertDay !== day) {
        patch.alertDay = day;
        wirdAlert_('⚠️ تعذر نشر ورد اليوم لبرنامج «' + (p.name || p.id) + '» في ' + (cfg.chatTitle || cfg.chat) + ':\n' + res.desc +
          '\nتأكد أن بوت الطلاب مشرف في القناة وله صلاحية النشر. سأعيد المحاولة كل ساعة حتى ' + (rh + WIRD.LATE_H) + ':00.');
      }
      saveWirdCfg_(p.id, patch);
      return 'fail';
    }
    var ok = { last: day, n: cfg.n + 1, endNote: '' };
    if (res.photoS) ok.photoS = res.photoS;
    done(ok);
    wirdLog_(p.id, day, pick.row, cfg.chat, res.mid, 'نُشر', '');
    emitEvent_(EVENT_TYPES.WIRD_POSTED, p.id, { day: day, row: pick.row.r, n: cfg.n + 1, chat: String(cfg.chat) }, 'tick');
    return 'posted';
  } finally { lock.releaseLock(); }
}

/* ───────── التحويل إلى «المواعيد» (بلا محرك تذكير جديد) ───────── */
/** الصفوف القادمة التي ستُنشر فعلًا (بتاريخ اليوم أو بعده، لا توقف ولا تخطي ولا إيقاف): [{row, day}] */
function projectWird_(plan, cfg, now) {
  var today = dayKey_(now);
  return plan.filter(function (x) {
    if (!x.date || x.stop || x.date < today || (x.date === today && cfg.last === today)) return false;
    if (plan.some(function (y) { return y.date === x.date && y.stop; })) return false;
    return !wirdDayOff_(cfg, dateValue_(x.date + ' 12:00'));
  }).filter(function (x, i, arr) { return arr.findIndex(function (y) { return y.date === x.date; }) === i; })
    .map(function (x) { return { row: x, day: x.date }; });
}

function wirdToSchedule_(pid, cfg) {
  var plan = readWirdPlan_(pid), proj = projectWird_(plan, cfg, Date.now()).filter(function (x) { return x.row.act; });
  var ss = programSpreadsheet_(pid), sh = ss.getSheetByName(SCHEDULE_SHEET);
  if (!sh) { sh = ss.insertSheet(SCHEDULE_SHEET); sh.getRange(1, 1, 1, SCHEDULE_FIELDS.length).setValues([SCHEDULE_FIELDS.map(function (f) { return f[1]; })]); }
  var vals = sh.getDataRange().getValues(), head = vals[0].map(str_), col = {};
  SCHEDULE_FIELDS.forEach(function (f) { col[f[0]] = head.indexOf(f[1]); });
  if (col.note < 0 || col.item < 0) return { error: 'ورقة «' + SCHEDULE_SHEET + '» بلا عمود «العنصر» أو «ملاحظة».' };
  var keep = vals.slice(1).filter(function (r) { return str_(r[col.note]) !== WIRD.SCHED_NOTE && r.some(function (x) { return str_(x) !== ''; }); });
  var removed = vals.length - 1 - keep.length, pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var add = proj.map(function (x) {
    var r = head.map(function () { return ''; });
    var dl = x.row.deadline, dlt = dl instanceof Date ? pad(dl.getHours()) + ':' + pad(dl.getMinutes()) : (str_(dl).match(/^\d{1,2}:\d{2}$/) ? str_(dl) : '23:59');
    var am = x.row.act.match(/^(.*?)\s*\((.+)\)\s*$/);
    r[col.item] = am ? am[1] : x.row.act;
    if (col.level >= 0 && am) r[col.level] = am[2];
    if (col.start >= 0) r[col.start] = x.day + ' ' + pad(cfg.hour) + ':00';
    if (col.deadline >= 0) r[col.deadline] = x.day + ' ' + dlt;
    if (col.close >= 0) r[col.close] = 'لا';
    r[col.note] = WIRD.SCHED_NOTE;
    return r;
  });
  var all = [head].concat(keep, add), w = head.length;
  sh.getRange(1, 1, vals.length, w).clearContent();
  sh.getRange(1, 1, all.length, w).setValues(all);
  invalidateProgram_(pid);
  var warn = [];
  try { warn = parseSchedule(all, parseSettings(ss.getSheetByName(NAMES.SETTINGS).getDataRange().getValues())).warnings; } catch (e) { warn = [e.message]; }
  return { added: add.length, removed: removed, warnings: warn };
}

/* ───────── الاستيراد من ملف «منسّق الأوراد» (قيم فقط) ───────── */
function wirdSheetPlanLike_(sh) {
  var n = normKey_(sh.getName());
  if (WIRD_SKIP_TABS.test(n)) return false;
  if (/^(الورقه|ورقه|خطه الورد|الاوراد)/.test(n)) return true;
  if (sh.getLastRow() < 1) return false;
  var head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
  var col = wirdPlanCols_(head);
  return col.date != null || col.title != null || col.text != null;
}
function wirdPickSheet_(src, name) {
  var all = src.getSheets() || [];
  if (!all.length) return { error: 'الملف بلا أوراق.' };
  if (name) {
    var want = normKey_(name);
    var sh = src.getSheetByName(name);
    if (!sh) all.forEach(function (x) { if (!sh && normKey_(x.getName()) === want) sh = x; });
    if (!sh) return { error: '⚠️ لا ورقة باسم «' + name + '». الأوراق: ' + all.map(function (x) { return x.getName(); }).join('، ') };
    return { sh: sh, picked: sh.getName(), others: [] };
  }
  var plans = all.filter(wirdSheetPlanLike_);
  var sh = plans[0] || null;
  if (!sh) all.forEach(function (x) { if (!sh && !WIRD_SKIP_TABS.test(normKey_(x.getName()))) sh = x; });
  if (!sh) sh = all[0];
  var others = plans.filter(function (x) { return x !== sh; }).map(function (x) { return x.getName(); });
  return { sh: sh, picked: sh.getName(), others: others };
}
function wirdImportRows_(values) {
  if (!values || !values.length) return { rows: [], mapping: 'فارغ', undated: [] };
  var info = wirdColsOrLegacy_(values[0]);
  var data = info.byHeader ? values.slice(1) : values;
  var start = info.byHeader ? 2 : 1, rows = [], undated = [];
  data.forEach(function (r, i) {
    var o = wirdPlanRow_(r, info.col, start + i);
    if (!wirdRowFilled_(o)) return;
    if (!o.date) undated.push(o.r);
    rows.push(wirdCanonicalRow_(o));
  });
  return { rows: rows, mapping: wirdMappingText_(info.col, values[0], info.byHeader), undated: undated };
}

/* ───────── الأمر /wird (للمالك) ───────── */
var WIRD_HELP = 'أوامر الورد اليومي:\n/wird — الحالة\n/wird <البرنامج> — تفاصيل برنامج (ويُنشئ ورقة «خطة الورد»)\n' +
  '/wird <البرنامج> channel <-100…|@اسم> — القناة (أو أرسل الأمر بلا معرّف ثم أعد توجيه منشور منها)\n' +
  '/wird <البرنامج> hour <0-23> — ساعة النشر بتوقيت القاهرة\n/wird <البرنامج> format text|photo — نص أو صورة ثابتة (ترسلها بعدها)\n' +
  '/wird <البرنامج> friday skip|post — تخطي الجمعة\n/wird <البرنامج> holiday <YYYY-MM-DD> — إضافة عطلة أو حذفها\n' +
  '/wird <البرنامج> pause <أيام|YYYY-MM-DD|stop> · resume\n/wird <البرنامج> test — معاينة ورد اليوم لك في الخاص\n' +
  '/wird <البرنامج> on|off — بدء النشر أو إيقافه\n/wird <البرنامج> import <رابط ملف المنسّق> [| اسم الورقة]\n' +
  '/wird <البرنامج> schedule — أنشئ صفوف «المواعيد» من الصفوف القادمة التي لها «الفعالية المرتبطة» (للتذكيرات الحالية)\n' +
  'كل صف يُنشر في تاريخه فقط؛ الصف بلا تاريخ لا يُنشر، والأيام الفائتة لا تُعوَّض.';

function wirdBack_() { return [[{ text: '🧩 الوحدات', callback_data: 'MOD:' }, { text: '🏠 القائمة', callback_data: 'L' }]]; }

function wirdStatus_(p, cfg, plan) {
  var today = dayKey_(), und = undatedWird_(plan), up = plan.filter(function (x) { return x.date && x.date >= today && !x.stop; });
  return '📖 «' + (p.name || p.id) + '» (' + p.id + '): ' + (cfg.on ? '🟢 ينشر' : '⚪️ موقوف') +
    '\n  القناة: ' + (cfg.chat ? (cfg.chatTitle || '') + ' ' + cfg.chat : '— (لم تُضبط)') + ' | الساعة ' + cfg.hour + ':00 | ' + (cfg.fmt === 'photo' ? '🖼 صورة ثابتة' + (cfg.photoA ? '' : ' (لم تُرسل بعد)') : '📝 نص') +
    '\n  الخطة: ' + plan.length + ' صفًا، القادمة ' + up.length + (up.length ? ' (' + up[0].date + ' ← ' + up.map(function (x) { return x.date; }).sort().pop() + ')' : '') + ' | نُشر إجمالًا ' + cfg.n + (cfg.last ? ' | آخر يوم ' + cfg.last : '') +
    (und.length ? '\n  ' + undatedText_(p, und) : '') +
    (cfg.fri ? '\n  تخطي الجمعة' : '') + ((cfg.hol || []).length ? '\n  عطل: ' + cfg.hol.join('، ') : '') +
    (cfg.pause ? '\n  ⏸ موقوف مؤقتًا ' + (cfg.pause === 'x' ? 'حتى تستأنف' : 'حتى ' + cfg.pause) : '');
}

function wirdCommand_(ctx, text) {
  var a = str_(text).replace(/^\/wird(@\S+)?\s*/i, '').split(/\s+/).filter(String), progs = getPrograms_(), back = wirdBack_();
  if (a[0] && a[0].toLowerCase() === 'import') { // /wird import [<البرنامج>] <رابط>
    if (a[1] && progs.some(function (x) { return x.id === a[1]; })) a = [a[1], 'import'].concat(a.slice(2));
    else if (progs.length === 1) a.unshift(progs[0].id);
  }
  if (!a.length) {
    var s = wirdState_();
    return show_(ctx, clip((progs.length ? progs.map(function (p) { var c = wirdCfg_(s, p.id); return '📖 ' + (p.name || p.id) + ' (' + p.id + '): ' + (c.on ? '🟢 ينشر الساعة ' + c.hour + ':00' : '⚪️ موقوف') + ' — نُشر ' + c.n; }).join('\n') : 'لا برامج.') + '\n\n' + WIRD_HELP), back);
  }
  var p = progs.filter(function (x) { return x.id === a[0]; })[0];
  if (!p) return show_(ctx, '⚠️ لا برنامج بالمعرّف «' + a[0] + '».\n\n' + WIRD_HELP, back);
  var sub = (a[1] || '').toLowerCase(), arg = a.slice(2).join(' '), cfg = wirdCfg_(wirdState_(), p.id), pid = p.id;
  var log = function (f, o, n) { logChange_(ctx.from, pid, 'الوحدات', 'dailyWird', f, o, n); };
  if (!sub) { ensureWirdSheet_(pid); return show_(ctx, clip(wirdStatus_(p, cfg, readWirdPlan_(pid)) + '\n\n📄 الخطة في ورقة «' + WIRD.SHEET + '» داخل ملف البرنامج.\n\n' + WIRD_HELP), back); }
  if (sub === 'channel') {
    if (!arg) { setModWait_(ctx.uid, { mod: 'dailyWird', step: 'chan', pid: pid }); return show_(ctx, 'أعد توجيه (Forward) أي منشور من القناة إلى هنا، أو أرسل معرّفها (مثل -1001234567890 أو @channel).', back); }
    return wirdSetChannel_(ctx, pid, arg);
  }
  if (sub === 'hour') {
    var h = Number(latinDigits_(arg));
    if (!(h >= 0 && h <= 23 && Math.floor(h) === h)) return show_(ctx, 'الصيغة: /wird ' + pid + ' hour <0-23>', back);
    saveWirdCfg_(pid, { hour: h }); log('ساعة النشر', cfg.hour, h);
    return show_(ctx, '✅ ساعة النشر: ' + h + ':00 (بتوقيت القاهرة؛ يقع النشر خلال تلك الساعة).', back);
  }
  if (sub === 'format') {
    if (arg === 'text') { saveWirdCfg_(pid, { fmt: 'text' }); log('الشكل', cfg.fmt, 'text'); return show_(ctx, '✅ الشكل: نص فقط.', back); }
    if (arg === 'photo') { setModWait_(ctx.uid, { mod: 'dailyWird', step: 'photo', pid: pid }); return show_(ctx, '🖼 أرسل الآن الصورة الثابتة (صورة، لا ملف). تُحفظ معرّفاتها في تيليجرام فقط.', back); }
    return show_(ctx, 'الصيغة: /wird ' + pid + ' format text|photo', back);
  }
  if (sub === 'friday') { var fr = /^(skip|نعم|yes)$/i.test(arg); saveWirdCfg_(pid, { fri: fr }); log('تخطي الجمعة', cfg.fri, fr); return show_(ctx, fr ? '✅ لا نشر يوم الجمعة (صف الجمعة يُتخطى).' : '✅ يُنشر يوم الجمعة.', back); }
  if (sub === 'holiday') {
    var d = wirdDay_(arg);
    if (!d) return show_(ctx, 'الصيغة: /wird ' + pid + ' holiday 2026-12-25 (مرة للإضافة، ومرة أخرى للحذف)', back);
    var hol = (cfg.hol || []).slice(), i = hol.indexOf(d);
    if (i >= 0) hol.splice(i, 1); else hol.push(d);
    hol = hol.filter(function (x) { return x >= dayKey_(); }).sort().slice(-60);
    saveWirdCfg_(pid, { hol: hol }); log('العطل', (cfg.hol || []).join(','), hol.join(','));
    return show_(ctx, (i >= 0 ? '🗑 حُذفت العطلة ' : '✅ أُضيفت العطلة ') + d + '.\nالعطل القادمة: ' + (hol.join('، ') || 'لا شيء'), back);
  }
  if (sub === 'pause') {
    var until = /^(stop|x)$/i.test(arg) ? 'x' : /^\d{1,3}$/.test(latinDigits_(arg)) ? dayKey_(Date.now() + (Number(latinDigits_(arg)) - 1) * DAY_MS) : wirdDay_(arg);
    if (!until) return show_(ctx, 'الصيغة: /wird ' + pid + ' pause <عدد الأيام|YYYY-MM-DD|stop>', back);
    saveWirdCfg_(pid, { pause: until }); log('إيقاف مؤقت', cfg.pause, until);
    return show_(ctx, '⏸ أوقف نشر الورد ' + (until === 'x' ? 'حتى ترسل resume' : 'حتى نهاية ' + until) + '. أوراد أيام الإيقاف لا تُعوَّض.', back);
  }
  if (sub === 'resume') { saveWirdCfg_(pid, { pause: '' }); log('إيقاف مؤقت', cfg.pause, ''); return show_(ctx, '▶️ استؤنف نشر الورد.', back); }
  if (sub === 'on' || sub === 'off') {
    if (sub === 'on' && !cfg.chat) return show_(ctx, '⚠️ اضبط القناة أولًا: /wird ' + pid + ' channel', back);
    if (sub === 'on' && cfg.fmt === 'photo' && !cfg.photoA && !cfg.photoS) return show_(ctx, '⚠️ اختر «صورة» لكن لم تُرسل الصورة: /wird ' + pid + ' format photo', back);
    if (sub === 'on') { ensureWirdSheet_(pid); if (!readWirdPlan_(pid).length) return show_(ctx, '⚠️ «' + WIRD.SHEET + '» فارغة. املأها أو استورد: /wird ' + pid + ' import <رابط>', back); }
    saveWirdCfg_(pid, sub === 'on' && !cfg.on ? { on: true, since: dayKey_() } : { on: sub === 'on' }); log('النشر', cfg.on ? 'يعمل' : 'موقوف', sub === 'on' ? 'يعمل' : 'موقوف');
    return show_(ctx, sub === 'on' ? '🟢 بدأ نشر الورد يوميًا الساعة ' + cfg.hour + ':00 في ' + (cfg.chatTitle || cfg.chat) + '.' : '⚪️ أُوقف نشر الورد لهذا البرنامج.', back);
  }
  if (sub === 'test') {
    var plan = readWirdPlan_(pid), pk = pickWird_(plan, dayKey_()), up = projectWird_(plan, {}, Date.now());
    var row = pk.row || (up[0] && up[0].row) || plan.filter(function (x) { return !x.stop; })[0];
    if (!row) return show_(ctx, '⚠️ لا صفوف في «' + WIRD.SHEET + '» بعد.', back);
    var r = sendWird_('admin', ctx.chat, cfg, row, cfg.n + 1, '🧪 معاينة (لم يُنشر في القناة):\n');
    return r.ok ? true : show_(ctx, '⚠️ تعذرت المعاينة: ' + r.desc, back);
  }
  if (sub === 'import') return wirdImport_(ctx, pid, a.slice(2).join(' '));
  if (sub === 'schedule') {
    var res = wirdToSchedule_(pid, cfg);
    if (res.error) return show_(ctx, '⚠️ ' + res.error, back);
    log('المواعيد من الخطة', res.removed, res.added);
    return show_(ctx, clip('📅 كُتب في «' + SCHEDULE_SHEET + '» ' + res.added + ' صفًا من خطة الورد (وحُذف ' + res.removed + ' صفًا قديمًا منها).\n' +
      'فعّل «قبل الموعد» و«فوات الموعد» من 🔔 التذكيرات لتذكير من لم يسلّم. أعد الأمر إذا عدّلت الخطة.' +
      (res.warnings.length ? '\n\n⚠️ تنبيهات:\n' + res.warnings.slice(0, 8).join('\n') : '')), back);
  }
  return show_(ctx, WIRD_HELP, back);
}

function wirdSetChannel_(ctx, pid, chatRef) {
  var back = wirdBack_(), chat = latinDigits_(str_(chatRef));
  var c = tgAs_('student', 'getChat', { chat_id: chat }, true);
  if (!c.ok) return show_(ctx, '⚠️ بوت الطلاب لا يصل إلى «' + chat + '»: ' + (c.description || '') + '\nأضفه مشرفًا في القناة أولًا ثم أعد المحاولة.', back);
  var me = tgAs_('student', 'getMe', {}, true), mem = me.ok ? tgAs_('student', 'getChatMember', { chat_id: c.result.id, user_id: me.result.id }, true) : { ok: false };
  var stt = mem.ok ? mem.result.status : '', isChan = c.result.type === 'channel';
  var canPost = stt === 'creator' || (stt === 'administrator' && (!isChan || mem.result.can_post_messages !== false)) || (!isChan && stt === 'member');
  if (!canPost) return show_(ctx, '⚠️ بوت الطلاب ليس له صلاحية النشر في «' + (c.result.title || chat) + '» (الحالة: ' + (stt || 'غير معروفة') + ').\nاجعله مشرفًا مع صلاحية «نشر الرسائل» ثم أعد الأمر.', back);
  var old = wirdCfg_(wirdState_(), pid).chat;
  saveWirdCfg_(pid, { chat: String(c.result.id), chatTitle: c.result.title || c.result.username || '' });
  logChange_(ctx.from, pid, 'الوحدات', 'dailyWird', 'القناة', old, String(c.result.id));
  return show_(ctx, '✅ القناة: «' + (c.result.title || chat) + '» (' + c.result.id + ')، وصلاحية النشر متاحة.\nالتالي: /wird ' + pid + ' test ثم /wird ' + pid + ' on', back);
}

function wirdImport_(ctx, pid, rest) {
  var back = wirdBack_(), parts = rest.split('|').map(str_), id = extractSpreadsheetId(parts[0]);
  if (!/^[A-Za-z0-9_-]{20,}$/.test(id)) return show_(ctx, 'الصيغة: /wird ' + pid + ' import <رابط ملف منسّق الأوراد> [| اسم الورقة]\nشارك الملف مع ' + serviceEmail_() + ' (مشاهد يكفي).', back);
  var src, sh;
  try { src = openSS_(id); } catch (e) { return show_(ctx, '⚠️ تعذر فتح الملف. شاركه مع ' + serviceEmail_() + ' (مشاهد يكفي).', back); }
  var picked = wirdPickSheet_(src, parts[1]);
  if (picked.error) return show_(ctx, picked.error, back);
  var imp = wirdImportRows_(picked.sh.getDataRange().getValues());
  if (!imp.rows.length) return show_(ctx, '⚠️ لم أجد صفوفًا فيها عنوان أو نص في «' + picked.picked + '».\nطريقة المطابقة: ' + imp.mapping, back);
  putBig_('wimp:' + ctx.uid, { pid: pid, rows: imp.rows }, 1800);
  var dates = imp.rows.map(function (r) { return r[0]; }).filter(String).sort(), existing = readWirdPlan_(pid).length, nod = (imp.undated || []).length;
  return show_(ctx, clip('📥 سأنسخ القيم فقط (بلا ربط) إلى «' + WIRD.SHEET + '» في «' + pid + '» من ورقة «' + picked.picked + '»:\n• ' + imp.rows.length + ' صفًا' +
    (dates.length ? '، بتاريخ ' + dates.length + ' (' + String(dates[0]).slice(0, 10) + ' ← ' + String(dates[dates.length - 1]).slice(0, 10) + ')' : '') +
    (nod ? '\n⚠️ ' + nod + ' صفًا بلا تاريخ لن تُنشر حتى تكتب تواريخها.' : '') +
    (picked.others.length ? '\n• أوراق خطة أخرى (حدّدها بـ | اسم الورقة): ' + picked.others.join('، ') : '') +
    '\n• المطابقة: ' + imp.mapping + '\n• مثال الصف الأول: ' + (imp.rows[0][1] || clip(imp.rows[0][2], 60)) +
    (existing ? '\n\n⚠️ في الخطة الآن ' + existing + ' صفًا ستُستبدل.' : '') + '\n\nتأكيد؟'),
    [[{ text: '✅ تأكيد الاستيراد', callback_data: 'MX:dailyWird:imp' }, { text: CANCEL, callback_data: 'X' }]]);
}

function wirdCallback_(ctx, data) {
  if (!ctx.adm.owner) return show_(ctx, '⛔ للمالك فقط.', wirdBack_());
  if (data !== 'imp') return undefined;
  var pend = getBig_('wimp:' + ctx.uid);
  if (!pend) return show_(ctx, 'انتهت مهلة التأكيد. أعد أمر الاستيراد.', wirdBack_());
  var sh = ensureWirdSheet_(pend.pid), prev = Math.max(0, sh.getLastRow() - 1);
  wirdWritePlanRows_(sh, pend.rows);
  saveWirdCfg_(pend.pid, { endNote: '' });
  cache_().remove('wimp:' + ctx.uid + ':n');
  logChange_(ctx.from, pend.pid, 'الوحدات', 'dailyWird', 'استيراد الخطة', prev, pend.rows.length);
  return show_(ctx, '✅ استُورد ' + pend.rows.length + ' صفًا إلى «' + WIRD.SHEET + '». راجعها في ملف البرنامج ثم: /wird ' + pend.pid + ' test', wirdBack_());
}

/** صورة أو منشور معاد توجيهه بعد /wird … format photo | channel */
function wirdAdminMessage_(ctx, m) {
  var w = modWait_(ctx.uid);
  if (!w || w.mod !== 'dailyWird' || !ctx.adm.owner) return undefined;
  if (w.step === 'photo') {
    var ph = m.photo && m.photo.length ? m.photo[m.photo.length - 1] : null;
    if (!ph) return send_(ctx.chat, 'أرسل صورة (لا ملفًا ولا نصًا)، أو /cancel.');
    setModWait_(ctx.uid, null);
    saveWirdCfg_(w.pid, { fmt: 'photo', photoA: ph.file_id, photoS: '' });
    logChange_(ctx.from, w.pid, 'الوحدات', 'dailyWird', 'الشكل', '', 'photo');
    return show_(ctx, '✅ حُفظت الصورة (معرّف تيليجرام فقط). الشكل الآن: صورة + نص. جرّب: /wird ' + w.pid + ' test', wirdBack_());
  }
  if (w.step === 'chan') {
    var fc = m.forward_from_chat || (m.forward_origin && m.forward_origin.chat);
    var ref = fc ? String(fc.id) : str_(m.text);
    if (!ref) return send_(ctx.chat, 'أعد توجيه منشور من القناة، أو أرسل معرّفها، أو /cancel.');
    setModWait_(ctx.uid, null);
    return wirdSetChannel_(ctx, w.pid, ref);
  }
  return undefined;
}

// ===== Events.gs =====
/**
 * Events.gs — سجل الأحداث وطبقة الربط (hooks) لكل عميل.
 *
 * عقد الحدث (ثابت للتكامل لاحقًا):
 *   { id, type, tenant, pid, at (ms), actor, data }   — data كائن JSON صغير (< 40KB).
 * الأنواع: EVENT_TYPES أدناه. كل حدث:
 *   1) يُكتب صفًّا في ورقة «سجل الأحداث» بملف تحكم العميل (دفعة واحدة في آخر التحديث: flushEvents_).
 *   2) يُسلَّم لكل وحدة مفعّلة عند العميل وتشترك في نوعه (Modules.gs: module.events + module.onEvent).
 * الإطلاق لا يرمي أبدًا ولا يبطئ رد الطالب: الكتابة والتسليم للوحدات بعد انتهاء المعالجة.
 */
var EVENTS = { SHEET: 'سجل الأحداث' };
var EVENT_HEADERS = ['الوقت', 'الحدث', 'البرنامج', 'معرّف الحدث', 'الفاعل', 'البيانات (JSON)'];
var EVENT_TYPES = {
  SUBMISSION_CREATED: 'submission_created',
  SUBMISSION_EDITED: 'submission_edited',
  SUBMISSION_DELETED: 'submission_deleted',
  SUBMISSION_REJECTED: 'submission_rejected',
  GRADE_UPDATED: 'grade_updated',
  PROGRAM_ENDED: 'program_ended',
  QUIZ_RESULT_IMPORTED: 'quiz_result_imported',
  WIRD_POSTED: 'wird_posted',
  QA_ASKED: 'qa_asked',
  QA_ANSWERED: 'qa_answered',
  MONTHLY_REPORT: 'monthly_report',
  TAWASUL_POSTED: 'tawasul_posted'
};
var EVENT_QUEUE_ = [];
var EVENT_SEQ_ = 0;

/** يطلق حدثًا للعميل الحالي. أحداث التسليم تعلّم البرنامج «متسخًا» لإعادة الحساب المركزي */
function emitEvent_(type, pid, data, actor) {
  try {
    if (!TENANT_) return null;
    var ev = { id: Date.now().toString(36) + '-' + (++EVENT_SEQ_), type: type, tenant: TENANT_.id, pid: pid || '', at: Date.now(), actor: actor == null ? '' : String(actor), data: data || {} };
    EVENT_QUEUE_.push(ev);
    if (pid && /^submission_/.test(type)) markDirty_(pid);
    return ev;
  } catch (e) { return null; }
}

/** يكتب الأحداث المعلقة ثم يسلّمها للوحدات المفعّلة. يُستدعى في آخر كل تحديث وفي آخر مهام كل عميل في المشغّل */
function flushEvents_() {
  if (!EVENT_QUEUE_.length || !TENANT_) return 0;
  var q = EVENT_QUEUE_.filter(function (e) { return e.tenant === TENANT_.id; });
  EVENT_QUEUE_ = EVENT_QUEUE_.filter(function (e) { return e.tenant !== TENANT_.id; });
  if (!q.length) return 0;
  try {
    var sh = central_().getSheetByName(EVENTS.SHEET);
    if (!sh) { sh = central_().insertSheet(EVENTS.SHEET); sh.getRange(1, 1, 1, EVENT_HEADERS.length).setValues([EVENT_HEADERS]); }
    var rows = q.map(function (e) { return [new Date(e.at), e.type, e.pid, e.id, e.actor, JSON.stringify(e.data).slice(0, 40000)]; });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, EVENT_HEADERS.length).setValues(rows);
  } catch (e) { logError_(e, 'events flush'); }
  q.forEach(dispatchEvent_);
  return q.length;
}

/** يقرأ آخر الأحداث (للوحدات والاختبارات): {type?, pid?, limit} */
function readEvents_(f) {
  f = f || {};
  var sh = central_().getSheetByName(EVENTS.SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var out = sh.getRange(2, 1, sh.getLastRow() - 1, EVENT_HEADERS.length).getValues().map(function (r) {
    var d = {}; try { d = JSON.parse(r[5] || '{}'); } catch (e) { d = {}; }
    return { at: r[0], type: str_(r[1]), pid: str_(r[2]), id: str_(r[3]), actor: str_(r[4]), data: d };
  }).filter(function (e) { return (!f.type || e.type === f.type) && (!f.pid || e.pid === f.pid); });
  return f.limit ? out.slice(-f.limit) : out;
}

/* ───────── «متسخ» = يحتاج إعادة حساب في المشغّل المركزي ───────── */
function markDirty_(pid) { try { cache_().put('dirty:' + pid, String(Date.now()), 21600); } catch (e) { /* تجاهل */ } }
function isDirty_(pid) { return !!cache_().get('dirty:' + pid); }
function clearDirty_(pid) { cache_().remove('dirty:' + pid); }

// ===== GradesCore.gs =====
/**
 * GradesCore.gs — محرك الحساب (منطق خالص بلا خدمات Google).
 * المدخل: input = {
 *   cfg,                        // ناتج parseSettings
 *   sheets: {اسم الورقة: values},  // أوراق الاختبارات والمقياس
 *   registration: values|null,  // ردود التسجيل
 *   corrections: values|null, overrides: values|null, submissions: values|null
 * }
 * المخرج: { items, students, passers, unmatched, warnings, stats }
 */

function computeGrades(input) {
  var cfg = input.cfg, g = cfg.general;
  var warnings = cfg.warnings.slice();
  var corr = buildCorrections(input.corrections);
  var fix = function (raw) { return applyCorrection(corr, normalizeEmail(raw)); };
  var round = function (x) { var p = Math.pow(10, g.decimals); return Math.round(x * p) / p; };

  /* 1) التسجيل */
  var reg = readRegistration(input.registration, g, corr);
  warnings = warnings.concat(reg.errors);
  var hasReg = !!(input.registration && input.registration.length > 1 && !reg.errors.length);

  /* مطابقة البريد غير المسجل بالاسم الرباعي (طالب مسجل واحد فقط) */
  var ATT_LABEL = { first: OPT.FIRST, highest: OPT.HIGHEST, last: OPT.LAST };
  var umRows = [];           // سطور ورقة «بريد غير مطابق»
  var creditNotes = {};      // البريد الصحيح ← [ملاحظات]
  var nameIdx = null, fullIdx = null, poolRef = null;
  function buildNameIndex(pool) {
    poolRef = pool; nameIdx = {}; fullIdx = {};
    Object.keys(pool).forEach(function (e) {
      var nm = pool[e].name, k4 = fourPartKey_(nm), full = nameTokens_(nm).join(' ');
      if (k4 && (nameIdx[k4] || (nameIdx[k4] = [])).indexOf(e) < 0) nameIdx[k4].push(e);
      if (full) (fullIdx[full] || (fullIdx[full] = [])).push(e);
    });
  }
  function emailSuggestions(e, name) {
    var sugg = [];
    var full = nameTokens_(name).join(' ');
    if (full && fullIdx[full]) sugg = sugg.concat(fullIdx[full]);
    Object.keys(poolRef).forEach(function (c) {
      if (sugg.indexOf(c) < 0 && c.slice(0, 3) === e.slice(0, 3) && levenshtein_(e, c, 2) <= 2) sugg.push(c);
    });
    var fixedDomain = e.replace(/@(gamil|gmial|gmai|gmal|gnail|gmaill)\.(com|con|co)$/, '@gmail.com').replace(/@gmail\.(con|co|cm)$/, '@gmail.com');
    if (fixedDomain !== e && poolRef[fixedDomain] && sugg.indexOf(fixedDomain) < 0) sugg.push(fixedDomain);
    return sugg.slice(0, 3);
  }
  /** يصنف ردًّا ببريد غير مسجل ويضيف سطره إلى الورقة؛ يعيد البريد الصحيح إن حُسب له */
  function classify(source, e, name, score, time, noCredit) {
    var row = { source: source, email: e, name: name, score: score == null ? '' : score, time: time == null ? '' : time,
      regName: '', regEmail: '', status: UNMATCHED_STATUS.MANUAL, note: '' };
    umRows.push(row);
    var key = fourPartKey_(name), cands = key && nameIdx[key] ? nameIdx[key] : [];
    if (g.nameMatch && cands.length === 1 && noCredit) {
      row.regEmail = cands[0]; row.regName = poolRef[cands[0]].name;
      row.note = 'الاسم الرباعي يطابق طالبًا مسجلًا، لكن المطابقة التلقائية للاختبارات والمقياس فقط. أضف السطر إلى «' + NAMES.CORRECTIONS + '» لتُحتسب.';
      return { row: row };
    }
    if (g.nameMatch && cands.length === 1) {
      var t = cands[0];
      row.status = UNMATCHED_STATUS.CREDITED; row.regEmail = t; row.regName = poolRef[t].name; row.target = t;
      row.note = 'الاسم الرباعي يطابق طالبًا مسجلًا واحدًا، فحُسبت درجة البريد الخاطئ لبريده المسجل. لتثبيت ذلك أضف السطر إلى «' + NAMES.CORRECTIONS + '».';
      (creditNotes[t] || (creditNotes[t] = [])).push(source + ' من ' + e);
      return { target: t, row: row };
    }
    if (g.nameMatch && cands.length > 1) {
      row.status = UNMATCHED_STATUS.AMBIGUOUS;
      row.regEmail = cands.join('، '); row.regName = cands.map(function (c) { return poolRef[c].name; }).join('، ');
      row.note = 'الاسم الرباعي يطابق ' + cands.length + ' طلاب مسجلين، فلم تُحتسب الدرجة. حدّد الصحيح وأضفه إلى «' + NAMES.CORRECTIONS + '».';
      return { row: row };
    }
    var why = !g.nameMatch ? 'المطابقة بالاسم الرباعي معطلة في الإعدادات.' :
      (!str_(name) ? 'لا يوجد اسم في الرد.' : (!key ? 'الاسم المكتوب أقل من أربعة أجزاء، فلا تُجرى المطابقة التلقائية.' : 'الاسم الرباعي لا يطابق أي طالب مسجل.'));
    var sugg = emailSuggestions(e, name);
    if (sugg.length) {
      row.regEmail = sugg.join('، '); row.regName = sugg.map(function (c) { return poolRef[c].name; }).join('، ');
      why += ' اقتراح غير مؤكد (تشابه الاسم أو البريد): تحقق منه ثم أضفه إلى «' + NAMES.CORRECTIONS + '».';
    } else why += ' صحّحه يدويًا بإضافة سطر إلى «' + NAMES.CORRECTIONS + '».';
    row.note = why;
    return { row: row };
  }

  /* 2) المقياس النهائي */
  var finalMap = {};
  if (hasReg) buildNameIndex(reg.map);
  if (g.finalSheet) {
    var fv = input.sheets[g.finalSheet];
    if (!fv) warnings.push('ورقة المقياس النهائي «' + g.finalSheet + '» غير موجودة.');
    else {
      var fh = fv[0] || [];
      var fe = findColumn(fh, g.finalEmailPattern), fn = findColumn(fh, g.finalNamePattern), fg = findColumn(fh, g.finalGenderPattern);
      var ft = findColumn(fh, g.timestampPattern);
      var fCredited = [];
      if (fe < 0) warnings.push('لم يُعثر على عمود البريد في ورقة المقياس.');
      else for (var r = 1; r < fv.length; r++) {
        var e = fix(fv[r][fe]); if (!e) continue;
        var fRec = { name: fn >= 0 ? str_(fv[r][fn]) : '', gender: fg >= 0 ? str_(fv[r][fg]) : '' };
        if (hasReg && !reg.map[e]) {
          var fc = classify(g.finalSheet, e, fRec.name, '', ft >= 0 ? fv[r][ft] : '');
          if (fc.target) { fCredited.push({ t: fc.target, rec: fRec, row: fc.row }); continue; }
        }
        finalMap[e] = fRec;
      }
      fCredited.forEach(function (x) {
        if (finalMap[x.t]) x.row.note += ' (للطالب ردّ ببريده المسجل في المقياس أيضًا؛ لا أثر لهذا الرد.)';
        else finalMap[x.t] = x.rec;
      });
    }
  }
  var refAvailable = hasReg || Object.keys(finalMap).length > 0;
  var pool = hasReg ? reg.map : finalMap;
  if (!hasReg && refAvailable) buildNameIndex(finalMap);

  /* 3) الاختبارات */
  var scores = {};           // email -> title -> value
  var seen = {};             // email -> {sources:{}, name}
  function see(e, src, name) {
    var s = seen[e] || (seen[e] = { sources: {}, name: '' });
    s.sources[src] = true; if (!s.name && name) s.name = name;
  }
  function setScore(e, title, v) { (scores[e] || (scores[e] = {}))[title] = v; }

  cfg.components.forEach(function (c) {
    var v = input.sheets[c.sheet];
    if (!v) { warnings.push('ورقة الاختبار «' + c.sheet + '» غير موجودة (' + c.title + ').'); return; }
    var h = v[0] || [];
    var ei = findColumn(h, c.emailPattern), si = findColumn(h, c.scorePattern);
    var ti = findColumn(h, g.timestampPattern), ni = findColumn(h, g.quizNamePattern);
    if (ni < 0) ni = findColumn(h, 'الاسم|name');
    if (ei < 0 || si < 0) { warnings.push('«' + c.title + '»: لم يُعثر على عمود ' + (ei < 0 ? 'البريد' : 'الدرجة') + ' في ورقة ' + c.sheet + '.'); return; }
    var attempts = {};       // البريد ← [{s, t, row}] (row = سطر «غير مطابق» إن حُسب بالاسم)
    for (var r = 1; r < v.length; r++) {
      var e = fix(v[r][ei]); var sc = num_(v[r][si]);
      if (!e || sc == null) continue;
      var nm = ni >= 0 ? str_(v[r][ni]) : '';
      var t = ti >= 0 ? timeValue_(v[r][ti], r) : r;
      var target = e, via = null;
      if (refAvailable && !pool[e]) {
        var cl = classify(c.key + (c.sheet !== c.title ? ' (' + c.sheet + ')' : ''), e, nm, sc, ti >= 0 ? v[r][ti] : '');
        if (cl.target) { target = cl.target; via = cl.row; }
      }
      see(target, c.sheet, via ? '' : nm);
      (attempts[target] || (attempts[target] = [])).push({ s: sc, t: t, row: via });
    }
    Object.keys(attempts).forEach(function (e) {
      var list = attempts[e], cur = null;
      list.forEach(function (x) {
        var take = !cur ||
          (c.attempts === 'first' && x.t < cur.t) ||
          (c.attempts === 'last' && x.t >= cur.t) ||
          (c.attempts === 'highest' && x.s > cur.s);
        if (take) cur = x;
      });
      setScore(e, c.key, cur.s);
      if (list.length < 2) return;
      var own = list.some(function (x) { return !x.row; });
      list.forEach(function (x) {
        if (!x.row) return;
        x.row.note += ' ' + (own ? 'للطالب ردّ ببريده المسجل في هذا الاختبار أيضًا؛' : 'للطالب أكثر من رد في هذا الاختبار؛') +
          ' طُبقت قاعدة المحاولات «' + ATT_LABEL[c.attempts] + '» فاحتُسبت ' + (cur === x ? 'درجة هذا الرد (' + x.s + ').' : 'درجة رد آخر (' + cur.s + ').');
      });
    });
  });

  /* 4) الفعاليات من ورقة التسليمات */
  // العنوان قد يتكرر في مستويات مختلفة: يُميَّز بعمود «المستوى» في التسليم؛ الفعالية بلا مستوى مشتركة بين المستويات
  var actByTitle = {};
  cfg.activities.forEach(function (a) { var k = normalizeName_(a.title); (actByTitle[k] || (actByTitle[k] = [])).push(a); });
  function findAct(title, level) {
    var list = actByTitle[normalizeName_(title)] || [], lv = normalizeName_(level);
    var hit = list.filter(function (a) { return normalizeName_(a.level) === lv; })[0] || list.filter(function (a) { return !a.level; })[0];
    return hit || (list.length === 1 ? list[0] : null);
  }
  var subCounts = {}; // email -> title -> {ids}
  if (input.submissions && input.submissions.length > 1) {
    var sh = input.submissions[0];
    var col = function (name, pat) { var i = sh.indexOf(name); return i >= 0 ? i : findColumn(sh, pat); };
    var se = col('البريد', 'بريد'), sa = col('الفعالية', 'الفعالية|النشاط'), sid = col('معرف التسليم', 'معرف التسليم'), sst = col('الحالة', 'الحالة');
    var snm = col('الاسم', '^الاسم$'), slv = sh.indexOf(LEVEL_HEADER);
    var unknownActs = {};
    for (var r2 = 1; r2 < input.submissions.length; r2++) {
      var row = input.submissions[r2];
      var e2 = fix(row[se]); if (!e2) continue;
      if (sst >= 0 && SUB_REJECTED.indexOf(str_(row[sst])) >= 0) continue;
      var act = findAct(row[sa], slv >= 0 ? row[slv] : '');
      if (!act) { unknownActs[str_(row[sa]) + (slv >= 0 && str_(row[slv]) ? ' (' + str_(row[slv]) + ')' : '')] = true; continue; }
      see(e2, NAMES.SUBMISSIONS, snm >= 0 ? str_(row[snm]) : '');
      var m = (subCounts[e2] || (subCounts[e2] = {}));
      var ids = (m[act.key] || (m[act.key] = {}));
      ids[sid >= 0 && str_(row[sid]) ? str_(row[sid]) : 'row' + r2] = true;
    }
    Object.keys(unknownActs).forEach(function (t) { warnings.push('في ورقة التسليمات فعالية غير معرّفة في الإعدادات: «' + t + '» (أُهملت).'); });
  }
  Object.keys(subCounts).forEach(function (e) {
    Object.keys(subCounts[e]).forEach(function (t) {
      var a = cfg.activities.filter(function (x) { return x.key === t; })[0];
      setScore(e, t, activityPoints(Object.keys(subCounts[e][t]).length, a));
    });
  });

  /* 5) الدرجات اليدوية (تستبدل الدرجة المحسوبة) */
  // العنصر بمفتاحه «العنوان (المستوى)»، أو بعنوانه وحده إن لم يتكرر
  var itemTitles = {}, allItems = cfg.components.concat(cfg.groups, cfg.activities);
  allItems.forEach(function (it) { itemTitles[normalizeName_(it.key)] = it; });
  allItems.forEach(function (it) {
    var k = normalizeName_(it.title);
    if (itemTitles[k] && itemTitles[k] !== it && itemTitles[k].key !== itemTitles[k].title) itemTitles[k] = false; // مكرر بين مستويين
    else if (itemTitles[k] === undefined) itemTitles[k] = it;
  });
  var overridden = {};
  (input.overrides || []).slice(1).forEach(function (r) {
    var e = fix(r[0]); if (!e) return;
    var it = itemTitles[normalizeName_(r[1])];
    var v = num_(r[2]);
    if (it === false) { warnings.push('درجة يدوية لـ«' + str_(r[1]) + '»: العنوان في أكثر من مستوى، فاكتبه مع المستوى مثل «' + str_(r[1]) + ' (المستوى)».'); return; }
    if (!it) { if (str_(r[1])) warnings.push('درجة يدوية لعنصر غير معرّف: «' + str_(r[1]) + '».'); return; }
    if (v == null) return;
    setScore(e, it.key, v);
    (overridden[e] || (overridden[e] = [])).push(it.key);
    see(e, NAMES.OVERRIDES, '');
  });

  /* 6) قائمة الطلاب */
  Object.keys(finalMap).forEach(function (e) { see(e, g.finalSheet, finalMap[e].name); });
  var base = [];
  if (hasReg) {
    if (g.studentBase === OPT.BASE_ALL) base = Object.keys(reg.map);
    else if (g.studentBase === OPT.BASE_FINAL) base = Object.keys(finalMap);
    else base = Object.keys(reg.map).filter(function (e) { return seen[e]; });
  } else {
    if (g.regSpreadsheetId) warnings.push('تعذر قراءة ملف التسجيل؛ القائمة مبنية على المقياس النهائي.');
    else warnings.push('لم يُحدد ملف التسجيل؛ القائمة مبنية على من عبأ المقياس النهائي.');
    base = Object.keys(finalMap);
    if (!base.length) base = Object.keys(seen);
  }
  var inBase = {}; base.forEach(function (e) { inBase[e] = true; });

  /* 7) ترتيب الأعمدة */
  var levels = cfg.levels || [], multi = levels.length > 0;
  var lvIndex = {}; levels.forEach(function (l, i) { lvIndex[l.title] = i; });
  var items = cfg.components.concat(cfg.groups, cfg.activities).slice().sort(function (a, b) {
    if (multi) { var la = a.level ? lvIndex[a.level] : levels.length, lb = b.level ? lvIndex[b.level] : levels.length; if (la !== lb) return la - lb; }
    var oa = a.order == null ? 1e9 : a.order, ob = b.order == null ? 1e9 : b.order;
    return oa !== ob ? oa - ob : a.seq - b.seq;
  });
  var topLevel = items.filter(function (it) { return it.kind === 'group' || !it.group; });

  var male = normalizeName_(g.maleValue), female = normalizeName_(g.femaleValue);
  function genderOf(raw) {
    var s = normalizeName_(raw);
    if (!s) return '';
    if (female && s.indexOf(female) >= 0) return g.femaleValue;
    if (male && s.indexOf(male) >= 0) return g.maleValue;
    return '';
  }

  /* 8) الحساب لكل طالب */
  var students = base.map(function (e) {
    var sc = scores[e] || {};
    var vals = {};
    cfg.components.concat(cfg.activities).forEach(function (it) { vals[it.key] = sc[it.key] != null ? sc[it.key] : null; });
    cfg.groups.forEach(function (gr) {
      if (sc[gr.key] != null) { vals[gr.key] = sc[gr.key]; return; } // درجة يدوية للمجموعة
      var mem = items.filter(function (it) { return it.groupKey === gr.key && vals[it.key] != null; })
        .map(function (it) { return vals[it.key]; });
      var v = null;
      if (mem.length) {
        if (gr.rule === 'sum') v = mem.reduce(function (a, b) { return a + b; }, 0);
        else if (gr.rule === 'avg') v = mem.reduce(function (a, b) { return a + b; }, 0) / mem.length;
        else v = Math.max.apply(null, mem);
        if (gr.max != null) v = Math.min(v, gr.max);
      }
      vals[gr.key] = v;
    });
    // المجموع والسقوف: لكل مستوى وحده (والعناصر بلا مستوى «عامة» تُضاف إلى المجموع الكلي فقط)
    function totals(list) {
      var b = 0, x = 0;
      list.forEach(function (it) { var v = vals[it.key] || 0; if (it.type === 'extra') x += v; else b += v; });
      var xc = g.extrasCap != null ? Math.min(x, g.extrasCap) : x;
      var f = g.passBasis === OPT.BASIS_BASIC ? b : b + xc;
      if (g.finalCap != null) f = Math.min(f, g.finalCap);
      return { basic: round(b), extraRaw: x, extra: round(xc), final: round(f) };
    }
    var reasons = [], notes = [], lvRes = [], basic, extraCapped, final, extra, overallMark = null, rateOn;
    if (!multi) {
      var t0 = totals(topLevel);
      basic = t0.basic; extraCapped = t0.extra; final = t0.final; extra = t0.extraRaw; rateOn = final;
      if (g.passMark != null && final < g.passMark) reasons.push('الدرجة أقل من ' + g.passMark);
    } else {
      basic = 0; extraCapped = 0; final = 0; extra = 0;
      var parts = levels.map(function (l) { return { l: l, list: topLevel.filter(function (it) { return it.level === l.title; }) }; });
      var common = topLevel.filter(function (it) { return !it.level; });
      parts.forEach(function (p) {
        var t = totals(p.list), mins = items.filter(function (it) { return it.level === p.l.title && it.min != null && (vals[it.key] || 0) < it.min; });
        var ok = (p.l.passMark == null || t.final >= p.l.passMark) && !mins.length;
        lvRes.push({ title: p.l.title, basic: t.basic, extra: t.extra, final: t.final, passMark: p.l.passMark, passed: ok });
        basic += t.basic; extraCapped += t.extra; final += t.final; extra += t.extraRaw;
        if (t.extraRaw > t.extra) notes.push('إضافية «' + p.l.title + '» قبل السقف: ' + round(t.extraRaw));
        if (g.levelPassRule !== OPT.LV_TOTAL && p.l.passMark != null && t.final < p.l.passMark) reasons.push('«' + p.l.title + '»: ' + t.final + ' أقل من ' + p.l.passMark);
      });
      if (common.length) { var tc = totals(common); basic += tc.basic; extraCapped += tc.extra; final += tc.final; extra += tc.extraRaw; }
      basic = round(basic); extraCapped = round(extraCapped); final = round(final);
      var marks = levels.map(function (l) { return l.passMark; });
      overallMark = g.overallPassMark != null ? g.overallPassMark : (marks.some(function (m) { return m == null; }) ? null : round(marks.reduce(function (a, b) { return a + b; }, 0)));
      if (g.levelPassRule !== OPT.LV_EACH && overallMark != null && final < overallMark) reasons.push('المجموع الكلي ' + final + ' أقل من ' + overallMark);
      rateOn = round(final / levels.length);
    }
    var hasFinal = !!finalMap[e];
    if (g.finalSheet && g.finalRequired && !hasFinal) reasons.push('لم يعبئ المقياس النهائي');
    items.forEach(function (it) {
      if (it.min != null && (vals[it.key] || 0) < it.min) reasons.push(it.key + ' أقل من ' + it.min);
    });
    var passed = reasons.length === 0;
    var rating = '';
    if (passed) for (var i = 0; i < cfg.bands.length; i++) if (rateOn >= cfg.bands[i].min) { rating = cfg.bands[i].label; break; }

    var r = reg.map[e], f = finalMap[e];
    var name = (r && r.name) || (f && f.name) || (seen[e] && seen[e].name) || '';
    var gender = genderOf(r && r.gender) || genderOf(f && f.gender);
    if (hasReg && !r) notes.push('غير موجود في التسجيل');
    if (!gender) notes.push('الجنس غير معروف');
    if (!multi && extra > extraCapped) notes.push('الإضافية قبل السقف: ' + round(extra));
    if (overridden[e]) notes.push('درجة يدوية: ' + overridden[e].join('، '));
    if (creditNotes[e]) notes.push('محتسب من بريد مكتوب خطأ (مطابقة الاسم الرباعي): ' + creditNotes[e].join('، '));
    return {
      email: e, name: name, gender: gender, values: vals, basic: basic, extra: extraCapped, final: final,
      passed: passed, rating: rating, reasons: reasons, notes: notes, levels: lvRes, overallMark: overallMark,
      hasFinal: hasFinal, overridden: overridden[e] || []
    };
  });

  var byName = function (a, b) { return a.name.localeCompare(b.name, 'ar'); };
  var byGrade = function (a, b) { return b.final - a.final || byName(a, b); };
  students.sort(g.sortBy === OPT.SORT_NAME ? byName : byGrade);
  var passers = students.filter(function (s) { return s.passed; });

  /* 9) البريد غير المطابق: سطر لكل رد في الاختبارات/المقياس، وسطر لكل بريد في التسليمات/الدرجات اليدوية */
  if (refAvailable) {
    var listed = {};
    umRows.forEach(function (u) { listed[u.email] = true; });
    Object.keys(seen).forEach(function (e) {
      if (inBase[e] || pool[e] || listed[e]) return;
      var src = Object.keys(seen[e].sources);
      classify(src.join('، '), e, seen[e].name, '', '', true);
    });
  }
  var rank = {}; rank[UNMATCHED_STATUS.MANUAL] = 0; rank[UNMATCHED_STATUS.AMBIGUOUS] = 1; rank[UNMATCHED_STATUS.CREDITED] = 2;
  var unmatched = umRows.map(function (u, i) { u.i = i; return u; }).sort(function (a, b) { return rank[a.status] - rank[b.status] || a.i - b.i; });
  var count = function (st) { return unmatched.filter(function (u) { return u.status === st; }).length; };

  return {
    items: items, levels: levels, students: students, passers: passers, unmatched: unmatched, warnings: warnings,
    stats: { registered: Object.keys(reg.map).length, regDuplicates: reg.duplicates, finalCount: Object.keys(finalMap).length, students: students.length, passers: passers.length,
      unmatched: unmatched.length, credited: count(UNMATCHED_STATUS.CREDITED), ambiguous: count(UNMATCHED_STATUS.AMBIGUOUS), manual: count(UNMATCHED_STATUS.MANUAL) }
  };
}

/** مسافة التحرير مع حد أقصى للإيقاف المبكر */
function levenshtein_(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  var prev = [], cur, i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) {
    cur = [i]; var rowMin = i;
    for (j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > limit) return limit + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** يحوّل النتيجة إلى جداول جاهزة للكتابة */
function buildOutputTables(res, cfg) {
  var g = cfg.general;
  var levels = res.levels || [], multi = levels.length > 0;
  // برنامج بمستويات: لكل مستوى عمودا «مجموع» و«نتيجة» بعد العناصر، ثم المجموع الكلي
  var lvHeader = [];
  levels.forEach(function (l) { lvHeader.push('مجموع ' + l.title + (l.passMark != null ? ' (من ' + l.passMark + ')' : ''), 'نتيجة ' + l.title); });
  var gradesHeader = ['البريد', 'الاسم', 'الجنس'].concat(res.items.map(function (it) { return it.key; }), lvHeader,
    ['مجموع الأساسية', 'مجموع الإضافية' + (g.extrasCap != null ? ' (بعد السقف)' : ''), multi ? 'المجموع الكلي' : 'الدرجة النهائية', 'التقدير', 'النتيجة', 'ملاحظات']);
  var gradesRows = res.students.map(function (s) {
    var lv = [];
    (s.levels || []).forEach(function (x) { lv.push(x.final, x.passed ? 'مجتاز' : 'لم يجتز'); });
    return [s.email, s.name, s.gender].concat(res.items.map(function (it) { var v = s.values[it.key]; return v == null ? '-' : v; }), lv,
      [s.basic, s.extra, s.final, s.rating, s.passed ? 'ناجح' : 'لم يجتز', s.reasons.concat(s.notes).join(' • ')]);
  });
  function passersTable(list, withGender) {
    var h = ['م', 'الاسم', 'البريد'].concat(withGender ? ['الجنس'] : [], levels.map(function (l) { return 'مجموع ' + l.title; }), [multi ? 'المجموع الكلي' : 'الدرجة النهائية', 'التقدير']);
    var rows = list.map(function (s, i) {
      return [i + 1, s.name, s.email].concat(withGender ? [s.gender] : [], (s.levels || []).map(function (x) { return x.final; }), [s.final, s.rating]);
    });
    return { header: h, rows: rows };
  }
  var levelPassers = !multi || !g.levelPassers ? [] : levels.map(function (l, li) {
    var list = res.students.filter(function (s) { return s.levels[li] && s.levels[li].passed; });
    if (g.sortBy !== OPT.SORT_NAME) list = list.slice().sort(function (a, b) { return b.levels[li].final - a.levels[li].final || a.name.localeCompare(b.name, 'ar'); });
    return { level: l.title, name: g.passersSheet + ' - ' + l.title, table: { header: ['م', 'الاسم', 'البريد', 'الجنس', 'مجموع ' + l.title],
      rows: list.map(function (s, i) { return [i + 1, s.name, s.email, s.gender, s.levels[li].final]; }) } };
  });
  return {
    levelPassers: levelPassers,
    grades: { header: gradesHeader, rows: gradesRows, levelCols: lvHeader.length },
    passers: passersTable(res.passers, true),
    male: passersTable(res.passers.filter(function (s) { return s.gender === g.maleValue; }), false),
    female: passersTable(res.passers.filter(function (s) { return s.gender === g.femaleValue; }), false),
    unmatched: {
      header: UNMATCHED_HEADERS.slice(),
      rows: res.unmatched.map(function (u) { return [u.source, u.email, u.name, u.score, u.time, u.regName, u.regEmail, u.status, str_(u.note)]; })
    }
  };
}

// ===== GradesRun.gs =====
/**
 * GradesRun.gs — تحميل بيانات ملف برنامج وتشغيل المحرك وكتابة الأوراق.
 * مشترك بين مشروع الدرجات ومشروع البوت (البوت الإداري يشغّل الحساب عن بُعد).
 * يعتمد على: Common.gs + GradesCore.gs + Output.gs
 */

function sheetValues_(ss, name) {
  var sh = name && ss.getSheetByName(name);
  return sh ? sh.getDataRange().getValues() : null;
}

/** يجمع مدخلات المحرك من ملف البرنامج (ومن ملف التسجيل المنفصل) */
function loadInput_(ss) {
  var setSh = ss.getSheetByName(NAMES.SETTINGS);
  if (!setSh) throw new Error('لا توجد ورقة «' + NAMES.SETTINGS + '». شغّل «إنشاء ورقة الإعدادات» أولًا.');
  var cfg = parseSettings(setSh.getDataRange().getValues());
  var g = cfg.general;
  var sheets = {};
  cfg.components.map(function (c) { return c.sheet; }).concat([g.finalSheet]).forEach(function (n) {
    if (n && !sheets[n]) { var v = sheetValues_(ss, n); if (v) sheets[n] = v; }
  });
  var registration = null;
  if (g.regSpreadsheetId) {
    try {
      var rss = SpreadsheetApp.openById(g.regSpreadsheetId);
      var rsh = g.regSheet ? rss.getSheetByName(g.regSheet) : rss.getSheets()[0];
      if (!rsh) cfg.warnings.push('ورقة التسجيل «' + g.regSheet + '» غير موجودة في ملف التسجيل.');
      else registration = rsh.getDataRange().getValues();
    } catch (e) {
      cfg.warnings.push('تعذر فتح ملف التسجيل: ' + e.message);
    }
  }
  return {
    cfg: cfg, sheets: sheets, registration: registration,
    corrections: sheetValues_(ss, NAMES.CORRECTIONS), overrides: sheetValues_(ss, NAMES.OVERRIDES),
    submissions: sheetValues_(ss, NAMES.SUBMISSIONS)
  };
}

/**
 * يحسب درجات برنامج. opts.write = false للحساب في الذاكرة فقط (للملخص والبحث).
 * يعيد { input, res, tables, message }. يرمي خطأ إن كانت الإعدادات غير صالحة.
 */
function calculateForSpreadsheet(ss, opts) {
  opts = opts || {};
  var input = loadInput_(ss);
  var cfg = input.cfg, g = cfg.general;
  if (cfg.errors.length) throw new Error('أخطاء في الإعدادات:\n• ' + cfg.errors.join('\n• '));
  var res = computeGrades(input);
  var t = buildOutputTables(res, cfg);
  if (opts.write !== false) {
    var outNames = [g.gradesSheet, g.passersSheet, g.malePassersSheet, g.femalePassersSheet, g.unmatchedSheet]
      .concat(t.levelPassers.map(function (x) { return x.name; }));
    var inputs = Object.keys(input.sheets).concat([NAMES.SETTINGS, NAMES.CORRECTIONS, NAMES.OVERRIDES, NAMES.SUBMISSIONS]);
    outNames.forEach(function (n) { if (inputs.indexOf(n) >= 0) throw new Error('اسم ورقة الإخراج «' + n + '» هو اسم ورقة مدخلات، غيّره في الإعدادات.'); });
    writeGradesSheet_(ss, g.gradesSheet, t.grades, res.items);
    writeTable_(ss, g.passersSheet, t.passers, {});
    writeTable_(ss, g.malePassersSheet, t.male, {});
    writeTable_(ss, g.femalePassersSheet, t.female, {});
    writeUnmatchedSheet_(ss, g.unmatchedSheet, t.unmatched);
    t.levelPassers.forEach(function (x) { writeTable_(ss, x.name, x.table, { emptyText: 'لا مجتازين في «' + x.level + '» بعد' }); });
  }
  var s = res.stats;
  var lvLine = (res.levels || []).map(function (l, i) {
    return l.title + ': ' + res.students.filter(function (x) { return x.levels[i] && x.levels[i].passed; }).length;
  }).join('، ');
  var message = 'الطلاب في ورقة الدرجات: ' + s.students + '\nالمجتازون: ' + s.passers + (lvLine ? ' (قاعدة «' + g.levelPassRule + '»)\nمجتازو المستويات: ' + lvLine : '') +
    '\nالمسجلون (بعد حذف المكرر): ' + s.registered + (s.regDuplicates ? ' — ردود مكررة: ' + s.regDuplicates : '') +
    '\nمن عبأ المقياس: ' + s.finalCount + '\n' + unmatchedSummary(s, g) +
    (res.warnings.length ? '\n\nتنبيهات:\n• ' + res.warnings.join('\n• ') : '');
  return { input: input, res: res, tables: t, message: message };
}

// ===== GradesSetup.gs =====
/**
 * GradesSetup.gs — (كان Setup.gs في سكربت الدرجات المرتبط بالملف) إنشاء ورقة «الإعدادات» منسقة ومعبأة من قالب العميل،
 * وإنشاء الأوراق المساعدة: تصحيح البريد، درجات يدوية، تسليمات الفعاليات. يعمل مركزيًا على أي ملف بمعرّفه (بلا قائمة ولا واجهة).
 * أسماء الفعاليات الافتراضية تأتي من قالب العميل (tenantConf_().template.activities)، لا من الكود.
 */
var DEFAULT_ACTIVITIES = ['مشاركة', 'واجب', 'نقاش'];
var DEFAULT_BANDS = [[90, 'ممتاز'], [80, 'جيد جدًا'], [70, 'جيد'], [60, 'مقبول']];
var TABLE_ROWS = { COMPONENTS: 15, GROUPS: 6, ACTIVITIES: 12, BANDS: 8, LEVELS: 5 };

/** يتعرف على أوراق الاختبارات (فيها عمود نتيجة وعمود بريد) وورقة المقياس (فيها بريد وجنس بلا نتيجة) */
function detectSheets_(ss) {
  var skip = [NAMES.SETTINGS, NAMES.CORRECTIONS, NAMES.OVERRIDES, NAMES.SUBMISSIONS, NAMES.UNMATCHED];
  try { var un = parseSettings(ss.getSheetByName(NAMES.SETTINGS).getDataRange().getValues()).general.unmatchedSheet; if (un) skip.push(un); } catch (e) { /* لا إعدادات بعد */ }
  var res = { quizzes: [], finalSheet: '', all: [] };
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    res.all.push(name);
    if (skip.indexOf(name) >= 0 || name.indexOf(NAMES.SETTINGS) === 0) return;
    if (typeof isGenerated_ === 'function' && isGenerated_(sh)) return;
    var lastCol = sh.getLastColumn();
    if (!lastCol || sh.getLastRow() < 1) return;
    var h = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    var ei = findColumn(h, 'بريد|e-?mail'), si = findColumn(h, '^(النتيجة|score)$'), gi = findColumn(h, 'الجنس');
    if (ei >= 0 && si >= 0) {
      var max = '';
      if (sh.getLastRow() >= 2) {
        var fmt = sh.getRange(2, si + 1).getNumberFormat();
        var m = String(fmt).match(/\/\s*"?\s*(\d+)/) || String(sh.getRange(2, si + 1).getDisplayValue()).match(/\/\s*(\d+)/);
        if (m) max = Number(m[1]);
      }
      res.quizzes.push({ sheet: name, max: max });
    } else if (ei >= 0 && gi >= 0 && !res.finalSheet) {
      res.finalSheet = name;
    }
  });
  return res;
}

function buildSettingsSheet_(ss, det, tpl) {
  tpl = tpl || {};
  var acts = (tpl.activities && tpl.activities.length) ? tpl.activities : DEFAULT_ACTIVITIES;
  var gen = tpl.general || {};
  var sh = ss.insertSheet(NAMES.SETTINGS, 0);
  sh.setRightToLeft(true);
  var rows = [], marks = { titles: [], headers: [], general: null, tables: {} };
  var W = Math.max.apply(null, [11].concat(Object.keys(TABLE_FIELDS).map(function (k) { return TABLE_FIELDS[k].length; })));
  function pad(a) { while (a.length < W) a.push(''); return a; }

  rows.push(pad(['إعدادات البرنامج — عدّل القيم فقط، ولا تغيّر عناوين الأقسام (الملونة) ولا رؤوس الأعمدة. ترتيب الأعمدة في ورقة الدرجات يتبع عمود «الترتيب».']));
  rows.push(pad([]));
  marks.titles.push(rows.length); rows.push(pad(['▌ ' + SECTIONS.GENERAL]));
  marks.general = { start: rows.length + 1, fields: GENERAL_FIELDS };
  GENERAL_FIELDS.forEach(function (f) {
    var val = f[2];
    if (f[0] === 'finalSheet') val = det.finalSheet;
    if (gen[f[0]] !== undefined) val = gen[f[0]];
    rows.push(pad([f[1], val, f[4]]));
  });

  function table(key, prefill) {
    rows.push(pad([]));
    marks.titles.push(rows.length); rows.push(pad(['▌ ' + SECTIONS[key]]));
    marks.headers.push({ row: rows.length, n: TABLE_FIELDS[key].length });
    rows.push(pad(TABLE_FIELDS[key].map(function (f) { return f[1]; })));
    var start = rows.length + 1;
    var count = Math.max(TABLE_ROWS[key], prefill.length + 3);
    for (var i = 0; i < count; i++) rows.push(pad(prefill[i] ? prefill[i].slice() : []));
    marks.tables[key] = { start: start, count: count };
  }
  var F = function (key) { var o = {}; TABLE_FIELDS[key].forEach(function (f, i) { o[f[0]] = i; }); return o; };
  var cf = F('COMPONENTS');
  table('COMPONENTS', det.quizzes.map(function (q, i) {
    var r = []; r[cf.title] = q.sheet; r[cf.sheet] = q.sheet; r[cf.type] = OPT.BASIC; r[cf.max] = q.max;
    r[cf.attempts] = OPT.FIRST; r[cf.min] = ''; r[cf.group] = ''; r[cf.order] = i + 1;
    r[cf.emailPattern] = 'بريد|e-?mail'; r[cf.scorePattern] = '^(النتيجة|score)$'; r[cf.enabled] = OPT.YES;
    return pad(r.map(function (x) { return x == null ? '' : x; }));
  }));
  table('GROUPS', []);
  var af = F('ACTIVITIES');
  table('ACTIVITIES', acts.map(function (t, i) {
    var r = []; r[af.title] = t; r[af.points] = 1; r[af.maxCount] = ''; r[af.maxPoints] = ''; r[af.type] = OPT.EXTRA;
    r[af.min] = ''; r[af.group] = ''; r[af.order] = 100 + i; r[af.bot] = OPT.YES; r[af.accepts] = OPT.ACC_ANY; r[af.instructions] = '';
    return pad(r.map(function (x) { return x == null ? '' : x; }));
  }));
  table('BANDS', DEFAULT_BANDS.map(function (b) { return pad(b.slice()); }));
  var lf = F('LEVELS');
  table('LEVELS', (tpl.levels || []).map(function (t, i) { // اختياري: فارغ = برنامج بلا مستويات
    var r = []; r[lf.title] = t; r[lf.passMark] = ''; r[lf.order] = i + 1;
    return pad(r.map(function (x) { return x == null ? '' : x; }));
  }));

  sh.getRange(1, 1, rows.length, W).setValues(rows).setFontFamily('Arial').setVerticalAlignment('middle');
  // التنسيق
  sh.getRange(1, 1, 1, W).merge().setFontWeight('bold').setBackground('#fff4d6').setWrap(true);
  sh.setRowHeight(1, 40);
  marks.titles.forEach(function (r) {
    sh.getRange(r, 1, 1, W).setBackground('#1f4e5f').setFontColor('#ffffff').setFontWeight('bold').setFontSize(12);
  });
  marks.headers.forEach(function (h) {
    sh.getRange(h.row, 1, 1, h.n).setBackground('#d9e7ee').setFontWeight('bold').setWrap(true).setHorizontalAlignment('center');
  });
  var gs = marks.general.start;
  sh.getRange(gs, 1, GENERAL_FIELDS.length, 1).setFontWeight('bold').setBackground('#f3f6f8');
  sh.getRange(gs, 2, GENERAL_FIELDS.length, 1).setBackground('#ffffff').setBorder(true, true, true, true, true, true, '#c8d3da', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(gs, 3, GENERAL_FIELDS.length, 1).setFontColor('#6b7780').setFontSize(9);

  // القوائم المنسدلة
  var sheetNames = det.all.filter(function (n) { return n !== NAMES.SETTINGS; });
  function dv(list) {
    return SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false).build();
  }
  function dvLoose(list) {
    return SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build();
  }
  GENERAL_FIELDS.forEach(function (f, i) {
    if (f[3] === 'SHEETS') sh.getRange(gs + i, 2).setDataValidation(dvLoose(sheetNames));
    else if (f[3]) sh.getRange(gs + i, 2).setDataValidation(dv(f[3]));
  });
  var grStart = marks.tables.GROUPS.start, grCount = marks.tables.GROUPS.count;
  var lvRule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(sh.getRange(marks.tables.LEVELS.start, 1, marks.tables.LEVELS.count, 1), true).setAllowInvalid(true).build();
  var groupRule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(sh.getRange(grStart, 1, grCount, 1), true).setAllowInvalid(true).build();
  ['COMPONENTS', 'GROUPS', 'ACTIVITIES', 'BANDS', 'LEVELS'].forEach(function (key) {
    var t = marks.tables[key];
    sh.getRange(t.start, 1, t.count, TABLE_FIELDS[key].length).setBorder(true, true, true, true, true, true, '#c8d3da', SpreadsheetApp.BorderStyle.SOLID)
      .setHorizontalAlignment('center');
    TABLE_FIELDS[key].forEach(function (f, c) {
      var rg = sh.getRange(t.start, c + 1, t.count, 1);
      if (f[2] === 'SHEETS') rg.setDataValidation(dvLoose(sheetNames));
      else if (f[2] === 'GROUPS') rg.setDataValidation(groupRule);
      else if (f[2] === 'LEVELS') rg.setDataValidation(lvRule);
      else if (f[2]) rg.setDataValidation(dv(f[2]));
    });
  });
  // عرض الأعمدة = أكبر عرض مطلوب بين الجداول
  var widths = [260, 230, 260];
  Object.keys(TABLE_FIELDS).forEach(function (k) {
    TABLE_FIELDS[k].forEach(function (f, i) { widths[i] = Math.max(widths[i] || 0, f[3]); });
  });
  widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(1);
  sh.setTabColor('#1f4e5f');
  return sh;
}

/** ينشئ الأوراق المساعدة إن لم تكن موجودة (لا يمس الموجود) */
function ensureAuxSheets_(ss) {
  function ensure(name, headers, widths, color) {
    var sh = ss.getSheetByName(name);
    if (sh) return sh;
    sh = ss.insertSheet(name);
    sh.setRightToLeft(true);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground(color).setFontColor('#ffffff').setWrap(true);
    sh.setFrozenRows(1);
    (widths || []).forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
    return sh;
  }
  ensure(NAMES.CORRECTIONS, CORRECTION_HEADERS, [240, 240, 260], '#8a5a12');
  var ov = ensure(NAMES.OVERRIDES, OVERRIDE_HEADERS, [240, 200, 80, 260], '#6b4e8e');
  var sub = ensure(NAMES.SUBMISSIONS, SUB_HEADERS, [140, 120, 220, 160, 90, 90, 320], '#3d7d4f');
  sub.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sub.getRange('G:G').setWrap(true);
  var statusCol = SUB_HEADERS.indexOf('الحالة') + 1;
  sub.getRange(2, statusCol, sub.getMaxRows() - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['مقبول', 'مرفوض', 'محذوف'], true).setAllowInvalid(true).build());
  // قائمة منسدلة للعناصر في الدرجات اليدوية من ورقة الإعدادات
  try {
    var cfg = parseSettings(ss.getSheetByName(NAMES.SETTINGS).getDataRange().getValues());
    var titles = cfg.components.concat(cfg.groups, cfg.activities).map(function (x) { return x.title; });
    if (titles.length) ov.getRange(2, 2, ov.getMaxRows() - 1, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(titles, true).setAllowInvalid(true).build());
  } catch (e) { /* تجاهل */ }
}

/**
 * يضيف إلى ورقة «الإعدادات» الموجودة بنود القسم العام الجديدة الغائبة (بقيمها الافتراضية) دون المساس بغيرها.
 * تُدرج الصفوف بعد آخر بند عام موجود. آمن للتكرار: لا يضيف بندًا موجودًا.
 */
function upgradeSettingsFor_(ss) {
  var notify_ = function (t, m) { return t + ': ' + m; };
  var sh = ss.getSheetByName(NAMES.SETTINGS);
  if (!sh) return notify_('تحديث ورقة الإعدادات', 'لا توجد ورقة «' + NAMES.SETTINGS + '». شغّل «إنشاء ورقة الإعدادات» أولًا.');
  var plan = missingGeneralRows(sh.getDataRange().getValues());
  if (!plan.hasGeneral) return notify_('تحديث ورقة الإعدادات', 'لم يُعثر على قسم «' + SECTIONS.GENERAL + '» في الورقة.');
  var added = [];
  if (plan.rows.length) added = added.concat(insertGeneralRows_(sh, plan));
  added = added.concat(addLevelParts_(sh));
  added = added.concat(addTableColumns_(sh));
  if (!added.length) return notify_('تحديث ورقة الإعدادات', 'الورقة محدّثة؛ لا بنود ناقصة.');
  return notify_('تحديث ورقة الإعدادات', 'أُضيف:\n• ' + added.join('\n• ') + '\n\nلم تتغير القيم الموجودة. البرنامج بلا مستويات يبقى كما هو ما دام عمود «المستوى» وجدول «المستويات» فارغين.');
}

/** يضيف أعمدة «المستوى» الغائبة وقسم «المستويات» (في آخر الورقة) — لا يمس أي قيمة موجودة */
function addLevelParts_(sh) {
  var parts = missingLevelParts(sh.getDataRange().getValues()), out = [];
  parts.columns.forEach(function (c) {
    sh.getRange(c.row + 1, c.col + 1).setValue(LEVEL_HEADER).setBackground('#d9e7ee').setFontWeight('bold').setHorizontalAlignment('center');
    out.push('عمود «' + LEVEL_HEADER + '» في جدول ' + SECTIONS[c.table]);
  });
  if (parts.addLevelsSection) {
    var start = sh.getLastRow() + 2, F = TABLE_FIELDS.LEVELS, n = TABLE_ROWS.LEVELS;
    sh.getRange(start, 1).setValue('▌ ' + SECTIONS.LEVELS);
    sh.getRange(start, 1, 1, 11).setBackground('#1f4e5f').setFontColor('#ffffff').setFontWeight('bold').setFontSize(12);
    sh.getRange(start + 1, 1, 1, F.length).setValues([F.map(function (f) { return f[1]; })]).setBackground('#d9e7ee').setFontWeight('bold').setWrap(true).setHorizontalAlignment('center');
    sh.getRange(start + 2, 1, n, F.length).setBorder(true, true, true, true, true, true, '#c8d3da', SpreadsheetApp.BorderStyle.SOLID).setHorizontalAlignment('center');
    out.push('جدول «' + SECTIONS.LEVELS + '» في آخر الورقة (اختياري)');
  }
  return out;
}

/** يضيف أعمدة جداول الإعدادات الغائبة (مثل «موقوف من/حتى» في الفعاليات) بعد آخر عمود — لا يمس أي قيمة */
function addTableColumns_(sh) {
  return missingTableColumns(sh.getDataRange().getValues()).map(function (c) {
    sh.getRange(c.row + 1, c.col + 1).setValue(c.header).setBackground('#d9e7ee').setFontWeight('bold').setHorizontalAlignment('center');
    return 'عمود «' + c.header + '» في جدول ' + SECTIONS[c.table];
  });
}

function insertGeneralRows_(sh, plan) {
  sh.insertRowsAfter(plan.afterRow, plan.rows.length);
  var start = plan.afterRow + 1;
  sh.getRange(start, 1, plan.rows.length, 3).setValues(plan.rows);
  sh.getRange(start, 1, plan.rows.length, 1).setFontWeight('bold').setBackground('#f3f6f8');
  sh.getRange(start, 2, plan.rows.length, 1).setBackground('#ffffff');
  sh.getRange(start, 3, plan.rows.length, 1).setFontColor('#6b7780').setFontSize(9);
  plan.fields.forEach(function (f, i) {
    if (f[3] && f[3] !== 'SHEETS') sh.getRange(start + i, 2).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(f[3], true).setAllowInvalid(false).build());
  });
  return plan.rows.map(function (r) { return r[0] + ' = ' + (r[1] === '' ? '(فارغ)' : r[1]); });
}

/** (كان checkSettings في Calc.gs) نص فحص الإعدادات لأي ملف برنامج بمعرّفه — بلا واجهة */
/** يفحص الإعدادات ويعرض الأعمدة التي تعرّف عليها في كل ورقة */
function checkSettingsText_(ss) {
  try {
    var input = loadInput_(ss), cfg = input.cfg, g = cfg.general, lines = [];
    cfg.components.forEach(function (c) {
      var v = input.sheets[c.sheet];
      if (!v) { lines.push('✖ ' + c.title + ': الورقة «' + c.sheet + '» غير موجودة'); return; }
      var h = v[0], ei = findColumn(h, c.emailPattern), si = findColumn(h, c.scorePattern);
      lines.push((ei >= 0 && si >= 0 ? '✔ ' : '✖ ') + c.title + ' ← ' + c.sheet + ' | البريد: ' + (ei >= 0 ? h[ei] : '؟') +
        ' | الدرجة: ' + (si >= 0 ? h[si] : '؟') + ' | الردود: ' + (v.length - 1));
    });
    if (input.registration) {
      var rh = input.registration[0];
      lines.push('✔ التسجيل: ' + (input.registration.length - 1) + ' ردًا | البريد: ' + (rh[findColumn(rh, g.regEmailPattern)] || '؟') +
        ' | الاسم: ' + (rh[findColumn(rh, g.regNamePattern)] || '؟') + ' | الجنس: ' + (rh[findColumn(rh, g.regGenderPattern)] || '؟'));
    } else lines.push('⚠ ملف التسجيل غير مقروء أو غير محدد');
    lines.push('الفعاليات: ' + cfg.activities.map(function (a) {
      return a.title + ' (' + a.points + ' لكل تسليم' + (a.maxCount != null ? '، حتى ' + a.maxCount + ' تسليمات' : '') + (a.maxPoints != null ? '، سقف ' + a.maxPoints : '') + (a.bot ? '' : '، خارج البوت') + ')';
    }).join('، '));
    lines.push('المجموعات: ' + (cfg.groups.map(function (x) { return x.title; }).join('، ') || '—'));
    lines.push('النجاح: ' + g.passMark + ' على أساس «' + g.passBasis + '»' + (g.finalRequired ? ' + اشتراط المقياس' : ''));
    var problems = cfg.errors.concat(cfg.warnings);
    return lines.join('\n') + (problems.length ? '\n\nملاحظات:\n• ' + problems.join('\n• ') : '\n\nلا أخطاء.');
  } catch (e) { return e.message; }
}

/** (كان setupSettingsSheet) ينشئ «الإعدادات» لملف موجود من أوراقه + الأوراق المساعدة؛ القديمة تُحفظ «(قديم)». يعيد ما اكتُشف */
function setupSettingsFor_(ss, tpl) {
  var old = ss.getSheetByName(NAMES.SETTINGS);
  if (old) {
    var bak = ss.getSheetByName(NAMES.SETTINGS + ' (قديم)');
    if (bak) ss.deleteSheet(bak);
    old.setName(NAMES.SETTINGS + ' (قديم)');
  }
  var det = detectSheets_(ss);
  buildSettingsSheet_(ss, det, tpl);
  ensureAuxSheets_(ss);
  return det;
}

// ===== MiniApp.gs =====
/**
 * MiniApp.gs — واجهة التطبيق المصغّر.
 * المسار: POST ?b=app&t=<العميل>&r=student|admin  أو ?b=app&r=platform  جسم text/plain فيه JSON: {initData, action}
 * لا يُوضع سر الويب هوك في الرابط. التحقق بتوقيع initData وتوكن بوت العميل، ومقارنة ثابتة الزمن.
 * الإضافة miniApp موقوفة افتراضيًا، وتُسمح بأمر /addon ثم تُفعَّل من /modules.
 * المرحلة 1: الرئيسية، والبريد، والتسليم النصي، وإكمال الملف في المحادثة، وتسليماتي، ودرجاتي.
 * المرحلة 2: تعديل التسليم وحذفه، والورد (اليوم + 7 أيام)، والأسئلة الشائعة وأسئلتي، وتبديل التذكيرات.
 * المرحلة 3: شاشات المشرف والمالك (المراجعة، والفعاليات، والأسئلة، والإعدادات، والمواعيد، والملخص، والتقرير، والوحدات، والمشرفون).
 * لوحة المنصة: ?b=app&r=platform لمالك المنصة فقط (بوت @AutomatePrBot).
 */
var MINIAPP_MAX_AGE = 86400;
var MINIAPP_MENU_TEXT = '📱 التطبيق';
var MINIAPP_IDEM_TTL = 21600;

function appOut_(obj) { if (obj && obj.ok === false) { var r = String(obj.error || obj.message || 'error'); obj.code = /^E-[0-9A-F]{4}$/.test(String(obj.message || '')) ? String(obj.message) : r; obj.error = miniAppFriendlyError_(r, obj.message); obj.message = obj.error; } return ContentService.createTextOutput(JSON.stringify(obj)); }

/** رابط صفحة التطبيق لهذا العميل والدور (بلا أسرار). فارغ إن لم يُضبط MINIAPP_BASE_URL */
function miniAppUrl_(role) {
  var base = platformProp_('MINIAPP_BASE_URL');
  if (!base || !TENANT_) return '';
  return String(base).replace(/\/+$/, '') + '/?t=' + encodeURIComponent(TENANT_.id) + '&r=' + (role === 'admin' ? 'admin' : 'student');
}

function miniAppHex_(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i];
    if (b < 0) b += 256;
    var h = b.toString(16);
    if (h.length < 2) s += '0';
    s += h;
  }
  return s;
}

/** HMAC_SHA256(key=HMAC_SHA256(key="WebAppData", msg=token), msg=dataCheckString) بالصيغة الست عشرية */
function miniAppHmacHex_(token, dataCheck) {
  var secret = Utilities.computeHmacSha256Signature(Utilities.newBlob(String(token)).getBytes(), Utilities.newBlob('WebAppData').getBytes());
  return miniAppHex_(Utilities.computeHmacSha256Signature(Utilities.newBlob(String(dataCheck)).getBytes(), secret));
}

/** يفك ترميز حقل من initData دون أن يرمي عند % غير صالح (تيليجرام سطح المكتب قد يمرّر القيمة دون ترميز). */
function miniAppDecodeURI_(s) {
  s = String(s == null ? '' : s).replace(/\+/g, ' ');
  try { return decodeURIComponent(s); }
  catch (e) { return s.replace(/%([0-9A-Fa-f]{2})/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); }); }
}

/**
 * يتحقق من توقيع initData وعمره. يعيد {ok, reason, uid, user, name} — reason: 'hash'|'expired'|'bad'
 * now اختياري (ثوانٍ) للاختبار.
 */
function verifyMiniAppInit_(raw, token, now) {
  if (!raw || !token) return { ok: false, reason: 'bad' };
  var fields = [], hash = '', authDate = 0, userRaw = '';
  try {
    String(raw).split('&').forEach(function (p) {
      var eq = p.indexOf('=');
      if (eq < 0) return;
      var k = miniAppDecodeURI_(p.slice(0, eq)), v = miniAppDecodeURI_(p.slice(eq + 1));
      if (k === 'hash') hash = v;
      else if (k === 'r' || k === 't' || k === 'b') { /* معاملات رابط الصفحة، ليست من توقيع تيليجرام */ }
      else {
        fields.push(k + '=' + v); // يُستثنى hash فقط — وsignature داخل في حساب تيليجرام كما ثبت بالقياس
        if (k === 'auth_date') authDate = Number(v);
        if (k === 'user') userRaw = v;
      }
    });
  } catch (e) { return { ok: false, reason: 'bad' }; }
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return { ok: false, reason: 'bad' };
  fields.sort();
  if (!safeEqual_(miniAppHmacHex_(token, fields.join('\n')), hash.toLowerCase())) return { ok: false, reason: 'hash' };
  now = now != null ? Number(now) : Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > MINIAPP_MAX_AGE || authDate > now + 60) return { ok: false, reason: 'expired' };
  var user = null;
  try { user = userRaw ? JSON.parse(userRaw) : null; } catch (e) { return { ok: false, reason: 'bad' }; }
  if (!user || user.id == null) return { ok: false, reason: 'bad' };
  var name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || '';
  return { ok: true, uid: String(user.id), user: user, name: name };
}

/** طلب التطبيق المصغّر بعد خروج الموجّه من مسارات الويب هوك */
function miniAppPost_(e) {
  var p = (e && e.parameter) || {};
  if (p.r === 'platform') return miniAppPlatformPost_(e);
  var tid = String(p.t || '').toLowerCase(), role = p.r === 'admin' ? 'admin' : (p.r === 'student' ? 'student' : (p.r === 'unified' ? 'unified' : ''));
  if (!TENANT_ID_RE.test(tid) || !role) return appOut_({ ok: false, error: 'forbidden' });
  var t = loadTenant_(tid);
  if (!t) return appOut_({ ok: false, error: 'forbidden' });
  enterTenant_(t);
  countUsage_('app');
  if (!licenseState_(t).ok) return appOut_({ ok: false, error: 'paused', message: blockedText_(role) });
  if (!isModuleActive_('miniApp')) return appOut_({ ok: false, error: 'disabled', message: 'التطبيق غير متاح الآن، استعمل المحادثة' });
  BOT_ROLE = role;
  var body = {}, raw = e && e.postData && e.postData.contents;
  try {
    if (raw && String(raw).charAt(0) === '{') body = JSON.parse(raw);
    else body = { initData: raw || '', action: 'bootstrap' };
  } catch (x) { return appOut_({ ok: false, error: 'bad_request' }); }
  var v = verifyMiniAppInit_(body.initData, tokenFor_(role));
  if (!v.ok) return appOut_({ ok: false, error: 'unauthorized' });
  var session = { uid: v.uid, user: v.user, name: v.name, role: 'student' };
  if (role === 'admin') {
    var adm = adminInfo_(v.uid);
    if (!adm) return appOut_({ ok: false, error: 'forbidden', message: '⛔ هذا البوت لمشرفي البرامج فقط.' });
    session.role = adm.owner ? 'owner' : 'admin';
    session.adm = adm;
  }
  try {
    if (role !== 'admin' && isUnifiedTenant_()) { var admU = adminInfo_(v.uid); if (admU) { session.role = admU.owner ? 'owner' : 'admin'; session.adm = admU; } }
    return appOut_(handleMiniApp_(session, body.action || 'bootstrap', body));
  } catch (err) {
    logError_(err, 'app ' + tid + ' ' + role);
    return appOut_({ ok: false, error: 'error' });
  } finally {
    try { flushEvents_(); } catch (x) { /* تجاهل */ }
  }
}

function handleMiniApp_(session, action, body) {
  body = body || {};
  if (action === 'bootstrap') return miniAppBootstrap_(session);
  if (session.role === 'student') {
    if (action === 'setEmail') return miniAppSetEmail_(session, body);
    if (action === 'submitText') return miniAppSubmitText_(session, body);
    if (action === 'startFile') return miniAppStartFile_(session, body);
    if (action === 'subs') return miniAppSubs_(session, body);
    if (action === 'grades') return miniAppGrades_(session, body);
    if (action === 'editText') return miniAppEditText_(session, body);
    if (action === 'startEditFile') return miniAppStartEditFile_(session, body);
    if (action === 'deleteSub') return miniAppDeleteSub_(session, body);
    if (action === 'wird') return miniAppWird_(session);
    if (action === 'ask') return miniAppAsk_(session, body);
    if (action === 'questions') return miniAppQuestions_(session, body);
    if (action === 'reminders') return miniAppReminders_(session, body);
    return { ok: false, error: 'unknown_action' };
  }
  var studentActs = { setEmail: 1, submitText: 1, startFile: 1, subs: 1, grades: 1, editText: 1, startEditFile: 1, deleteSub: 1, wird: 1, ask: 1, questions: 1, reminders: 1 };
  if (studentActs[action]) return { ok: false, error: 'forbidden' };
  return handleMiniAppAdmin_(session, action, body);
}

function miniAppRoleLabel_(role) {
  return role === 'owner' ? 'مالك' : role === 'admin' ? 'مشرف' : 'طالب';
}
function miniAppTheme_() {
  try {
    var raw = prop_('THEME');
    if (!raw) return null;
    var t = JSON.parse(raw);
    var out = {};
    if (t.name) out.name = String(t.name).slice(0, 60);
    if (t.logo && /^https:\/\//.test(String(t.logo))) out.logo = String(t.logo).slice(0, 300);
    if (/^#[0-9a-fA-F]{6}$/.test(t.brand || '')) out.brand = t.brand;
    if (/^#[0-9a-fA-F]{6}$/.test(t.accent || '')) out.accent = t.accent;
    return Object.keys(out).length ? out : null;
  } catch (e) { return null; }
}

function miniAppUserDto_(session) {
  return { id: session.uid, name: session.name, role: session.role, roleLabel: miniAppRoleLabel_(session.role) };
}

function miniAppBootstrap_(session) {
  var out = {
    ok: true,
    tenant: { id: TENANT_.id, name: TENANT_.name, theme: miniAppTheme_() },
    user: miniAppUserDto_(session),
    email: '',
    programs: []
  };
  if (session.role !== 'student') return miniAppAdminBootstrap_(session);
  if (TENANT_.setup !== SETUP_DONE) return { ok: false, error: 'not_ready', message: MSG.notReady, user: out.user };
  out.email = getUserEmail_(session.uid) || '';
  out.programs = getPrograms_().map(function (p) { return miniAppProgramDto_(p, session, out.email); });
  try { out.remindersOff = remIsOff_(session.uid); } catch (e) { out.remindersOff = false; }
  out.wird = isModuleActive_('dailyWird') ? miniAppWirdPayload_(Date.now()) : null;
  out.qa = isModuleActive_('studentQA') ? miniAppQaPayload_(session, out.programs) : null;
  return out;
}

function miniAppProgramDto_(p, session, savedEmail) {
  var dto = { id: p.id, name: p.name, open: !!p.open, levels: [], activities: [], registered: false, registeredName: '',
    regFormUrl: '', showGrades: false, showSubs: false, subsCount: 0, subs: [], gradesText: '' };
  var prog;
  try { prog = loadProgram_(p.id); } catch (e) { dto.error = 'تعذر قراءة البرنامج.'; return dto; }
  if (!prog) return dto;
  dto.name = prog.name;
  dto.levels = (prog.levels || []).slice();
  var opts = studentOptions(prog.general);
  dto.showGrades = !!opts.showGrades;
  dto.showSubs = !!opts.showSubs;
  dto.regFormUrl = str_(prog.general.regFormUrl);
  var email = savedEmail, found = email ? lookupRegistration_(prog, email) : null;
  if (found) { dto.registered = true; dto.registeredName = found.name; email = found.email; }
  var mine = [];
  if (email) {
    mine = mySubmissions(subsValues2_(prog), email).filter(function (x) { return String(x.uid) === String(session.uid); });
    dto.subsCount = mine.length;
    if (opts.showSubs) dto.subs = mine.slice(0, VIEW.LIST).map(function (x) { return miniAppSubDto_(x, prog, session.uid); });
    if (opts.showGrades) {
      try { dto.gradesText = miniAppStandingText_(prog, email); } catch (e) { dto.gradesText = ''; }
    }
  }
  var now = Date.now();
  dto.activities = (prog.activities || []).map(function (a) { return miniAppActivityDto_(a, mine, now); });
  return dto;
}

function miniAppActivityDto_(act, mine, now) {
  var st = miniAppActivityStatus_(act, mine, now);
  return {
    key: act.key || act.title, title: act.title, level: act.level || '', accepts: act.accepts || 'any',
    instructions: act.instructions || '', status: st.status, statusLabel: st.statusLabel, reason: st.reason || ''
  };
}

function miniAppActivityStatus_(act, mine, now) {
  var rel = (mine || []).filter(function (x) {
    return normalizeName_(x.act) === normalizeName_(act.title) && (!act.level || x.level === act.level);
  });
  var rejected = rel.some(function (x) { return x.status === SUB_ST.REJ || SUB_REJECTED.indexOf(x.status) >= 0; });
  var accepted = rel.some(function (x) { return SUB_REJECTED.indexOf(x.status) < 0; });
  if (rejected && !accepted) return { status: 'rejected', statusLabel: 'مرفوضة' };
  if (accepted) return { status: 'submitted', statusLabel: 'سُلّمت' };
  var cs = closedState(act, now);
  if (cs) return { status: 'paused', statusLabel: 'موقوفة', reason: closedMessage(act, cs) };
  return { status: 'open', statusLabel: 'مفتوحة' };
}

function miniAppSubDto_(x, prog, uid) {
  var act = prog ? actForSub_(prog, x) : null;
  var opts = prog ? studentOptions(prog.general) : {};
  var now = Date.now();
  var eb = prog ? modifyBlock(x, act, opts, prog.open, now, uid, 'edit') : '';
  var db = prog ? modifyBlock(x, act, opts, prog.open, now, uid, 'delete') : '';
  return {
    id: x.id, act: x.act, level: x.level || '', n: x.n, type: x.type, text: x.text || '',
    fileName: x.fileName || '', hasFile: !!x.hasFile, status: x.status, statusLabel: statusIcon_(x),
    reason: x.reason || '', time: x.time ? fmtTime(x.time) : '',
    canEdit: !eb, canDelete: !db, editBlock: eb || '', deleteBlock: db || '',
    accepts: act ? (act.accepts || 'any') : 'any'
  };
}

function miniAppStandingText_(prog, email) {
  var key = myKey_(prog.id, email), c = cache_().get(key);
  if (c) return c;
  var snap = standingSnapshot_(prog), subs = subsValues2_(prog);
  var r = computeStanding(snap, email, subs);
  var text = clip(formatStanding({ res: r.res, st: r.st, cfg: r.cfg, counts: acceptedCounts(r.cfg, subs, email), email: email, programName: prog.name, snapAt: snap.t }));
  cache_().put(key, text, VIEW.MY_TTL);
  return text;
}

function miniAppSetEmail_(session, body) {
  if (TENANT_.setup !== SETUP_DONE) return { ok: false, error: 'not_ready', message: MSG.notReady };
  var email = normalizeEmail(body.email);
  if (!isValidEmail(email)) return { ok: false, error: 'bad_email', message: MSG.badEmailFormat };
  var progs = body.pid ? getPrograms_().filter(function (p) { return p.id === body.pid; }) : getPrograms_();
  if (body.pid && !progs.length) return { ok: false, error: 'not_found', message: MSG.noPrograms };
  var hits = [], misses = [];
  progs.forEach(function (p) {
    var prog = loadProgram_(p.id);
    if (!prog) return;
    var found = lookupRegistration_(prog, email);
    if (found) hits.push({ id: prog.id, name: prog.name, email: found.email, nameOnFile: found.name });
    else misses.push({ id: prog.id, name: prog.name, regFormUrl: str_(prog.general.regFormUrl) });
  });
  if (!hits.length) {
    var msg = misses.length === 1 ? MSG.notRegistered(email, misses[0].name) : 'هذا البريد غير موجود في استمارة التسجيل.';
    return { ok: false, error: 'not_registered', message: msg, email: email, programs: misses };
  }
  saveUserEmail_(session.uid, hits[0].email, session.user && session.user.username);
  return { ok: true, email: hits[0].email, name: hits[0].nameOnFile, programs: hits, missed: misses };
}

function miniAppResolve_(session, body, needAccept) {
  if (TENANT_.setup !== SETUP_DONE) return { error: { ok: false, error: 'not_ready', message: MSG.notReady } };
  var prog = loadProgram_(str_(body.pid));
  if (!prog || !prog.open) return { error: { ok: false, error: 'closed', message: MSG.noPrograms } };
  var act = findAct_(prog, str_(body.activity));
  if (!act) return { error: { ok: false, error: 'not_found', message: 'هذه الفعالية لم تعد متاحة.' } };
  if (hasLevels_(prog) && act.level && body.level && act.level !== body.level) {
    return { error: { ok: false, error: 'level', message: 'هذه الفعالية ليست في المستوى المختار.' } };
  }
  var cs = closedState(act, Date.now());
  if (cs) return { error: { ok: false, error: 'paused', message: closedMessage(act, cs) } };
  if (needAccept === 'text' && act.accepts === 'file') return { error: { ok: false, error: 'wrong_type', message: MSG.wrongType.text } };
  if (needAccept === 'file' && act.accepts === 'text') return { error: { ok: false, error: 'wrong_type', message: MSG.wrongType.file } };
  var saved = getUserEmail_(session.uid);
  var email = body.email ? normalizeEmail(body.email) : saved;
  if (email && !isValidEmail(email) && body.email) return { error: { ok: false, error: 'bad_email', message: MSG.badEmailFormat } };
  var found = email ? lookupRegistration_(prog, email) : null;
  if (!found) {
    return { error: { ok: false, error: saved || email ? 'not_registered' : 'need_email',
      message: email ? MSG.notRegistered(email, prog.name) : MSG.askEmail,
      regFormUrl: str_(prog.general.regFormUrl) } };
  }
  if (found.email !== saved) saveUserEmail_(session.uid, found.email, session.user && session.user.username);
  var st = { step: 'content', p: prog.id, a: act.key || act.title, email: found.email, name: found.name };
  if (act.level || body.level) st.lv = act.level || body.level;
  return { prog: prog, act: act, st: st };
}

function miniAppIdemKey_(uid, nonce) { return 'appidem:' + uid + ':' + nonce; }
function miniAppIdemGet_(uid, nonce) {
  if (!nonce) return null;
  var raw = cache_().get(miniAppIdemKey_(uid, nonce));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}
function miniAppIdemPut_(uid, nonce, res) {
  if (nonce) try { cache_().put(miniAppIdemKey_(uid, nonce), JSON.stringify(res), MINIAPP_IDEM_TTL); } catch (e) { /* تجاهل */ }
}

function miniAppConfirmText_(act, st, res) {
  var lines = ['✅ تم استلام مشاركتك في «' + act.title + '»' + (act.level || st.lv ? ' (' + (act.level || st.lv) + ')' : '') + '.',
    'رقم التسليم: ' + res.n, 'الدرجة المضافة: ' + res.points,
    'مجموع درجتك في «' + act.title + '» حتى الآن: ' + res.total];
  if (act.maxCount != null) lines.push('(يُحتسب حتى ' + act.maxCount + ' تسليمات في هذه الفعالية)');
  if (res.points === 0 && res.note) lines.push('⚠️ ' + res.note + '؛ حُفظت مشاركتك دون درجة إضافية.');
  return lines.join('\n');
}

function miniAppFrom_(session) {
  var u = session.user || {};
  return { id: Number(session.uid) || session.uid, first_name: u.first_name || session.name || '', last_name: u.last_name || '', username: u.username || '' };
}

function miniAppSubmitText_(session, body) {
  var nonce = str_(body.nonce);
  if (nonce) {
    var prev = miniAppIdemGet_(session.uid, nonce);
    if (prev) return prev;
  }
  var text = str_(body.text);
  if (!text) return { ok: false, error: 'bad_request', message: 'اكتب نص مشاركتك.' };
  var got = miniAppResolve_(session, body, 'text');
  if (got.error) return got.error;
  var sent = send_(session.uid, '📝 تسليمك في «' + got.act.title + '»:\n' + (text.length > 3500 ? text.slice(0, 3500) + '…' : text));
  if (!sent || !sent.ok || !sent.result) return { ok: false, error: 'send_failed', message: MSG.error };
  var m = { message_id: sent.result.message_id, chat: { id: sent.result.chat ? sent.result.chat.id : session.uid }, from: miniAppFrom_(session), text: text };
  var c = extractContent_(m);
  var res = recordSubmission_(got.prog, got.act, got.st, m, c);
  if (!res) return { ok: false, error: 'duplicate', message: 'هذا التسليم مُسجَّل من قبل.' };
  forwardToReview_(got.prog, got.act, got.st, m, res);
  got.st.step = 'done';
  setState_(session.uid, got.st);
  var confirmation = miniAppConfirmText_(got.act, got.st, res);
  send_(session.uid, confirmation);
  var out = { ok: true, n: res.n, points: res.points, total: res.total, note: res.note || '', subId: res.subId, confirmation: confirmation };
  miniAppIdemPut_(session.uid, nonce, out);
  return out;
}

function miniAppStartFile_(session, body) {
  var got = miniAppResolve_(session, body, 'file');
  if (got.error) return got.error;
  setState_(session.uid, got.st);
  var msg = 'أرسل الصورة أو الملف هنا 👇\n«' + got.act.title + '»' + (got.act.level || got.st.lv ? ' (' + (got.act.level || got.st.lv) + ')' : '') +
    (got.act.instructions ? '\n\n' + got.act.instructions : '') + '\n\n(للإلغاء: /cancel)';
  send_(session.uid, msg);
  return { ok: true, close: true, message: msg };
}

function miniAppNeedEmailOrReg_(session, body, view) {
  var prog = loadProgram_(str_(body.pid));
  if (!prog) return { error: { ok: false, error: 'not_found', message: MSG.noPrograms } };
  var opts = studentOptions(prog.general);
  if (view === 'grades' && !opts.showGrades) return { error: { ok: false, error: 'off', message: VMSG.gradesOff } };
  if (view === 'subs' && !opts.showSubs) return { error: { ok: false, error: 'off', message: VMSG.subsOff } };
  var saved = getUserEmail_(session.uid);
  var found = saved ? lookupRegistration_(prog, saved) : null;
  if (!found) return { error: { ok: false, error: saved ? 'not_registered' : 'need_email',
    message: saved ? MSG.notRegistered(saved, prog.name) : VMSG.askEmail, regFormUrl: str_(prog.general.regFormUrl) } };
  return { prog: prog, email: found.email, name: found.name };
}

function miniAppSubs_(session, body) {
  var got = miniAppNeedEmailOrReg_(session, body, 'subs');
  if (got.error) return got.error;
  var list = mySubmissions(subsValues2_(got.prog), got.email).filter(function (x) { return String(x.uid) === String(session.uid); });
  return { ok: true, pid: got.prog.id, subs: list.map(function (x) { return miniAppSubDto_(x, got.prog, session.uid); }), empty: list.length ? '' : VMSG.noSubs };
}

function miniAppGrades_(session, body) {
  var got = miniAppNeedEmailOrReg_(session, body, 'grades');
  if (got.error) return got.error;
  try {
    return { ok: true, pid: got.prog.id, email: got.email, gradesText: miniAppStandingText_(got.prog, got.email) };
  } catch (e) {
    logError_(e, 'app grades ' + got.prog.id + ' ' + got.email);
    return { ok: false, error: 'error', message: 'تعذر حساب درجاتك الآن (قد تكون الإعدادات قيد التعديل). حاول بعد قليل.' };
  }
}

function sendMiniAppButton_(chat) {
  if (!isModuleActive_('miniApp')) return send_(chat, '⏸ التطبيق غير متاح الآن، استعمل المحادثة.');
  var url = miniAppUrl_(BOT_ROLE);
  if (!url) return send_(chat, '⏸ رابط التطبيق غير مضبوط بعد.');
  return send_(chat, '📱 اضغط لفتح التطبيق:', [[{ text: '📱 فتح التطبيق', web_app: { url: url } }]]);
}

function miniAppOnEnable_() {
  var base = platformProp_('MINIAPP_BASE_URL');
  if (!base) { console.warn('MINIAPP_BASE_URL غير مضبوط، تُخطّى setChatMenuButton'); return; }
  (isUnifiedTenant_() ? ['unified'] : ['student', 'admin']).forEach(function (role) {
    if (!tokenFor_(role)) return;
    var url = miniAppUrl_(role);
    var cmds = (role === 'admin' ? ADMIN_COMMANDS : (role === 'unified' ? UNIFIED_COMMANDS : STUDENT_COMMANDS)).slice();
    cmds.push({ command: 'app', description: 'فتح التطبيق' });
    tgAs_(role, 'setMyCommands', { commands: cmds }, true);
    tgAs_(role, 'setChatMenuButton', { menu_button: { type: 'web_app', text: MINIAPP_MENU_TEXT, web_app: { url: url } } }, true);
  });
}

function miniAppOnDisable_() {
  (isUnifiedTenant_() ? ['unified'] : ['student', 'admin']).forEach(function (role) {
    if (!tokenFor_(role)) return;
    tgAs_(role, 'setChatMenuButton', { menu_button: { type: 'commands' } }, true);
    tgAs_(role, 'setMyCommands', { commands: role === 'admin' ? ADMIN_COMMANDS : (role === 'unified' ? UNIFIED_COMMANDS : STUDENT_COMMANDS) }, true);
  });
}
function miniAppFindSub_(session, body) {
  var got = miniAppNeedEmailOrReg_(session, body, 'subs');
  if (got.error) return got;
  var list = mySubmissions(subsValues2_(got.prog), got.email).filter(function (x) { return String(x.uid) === String(session.uid); });
  var x = list.filter(function (s) { return s.id === str_(body.subId); })[0];
  if (!x) return { error: { ok: false, error: 'not_found', message: 'هذا التسليم لم يعد موجودًا (ربما حُذف).' } };
  return { prog: got.prog, email: got.email, name: got.name, sub: x, act: actForSub_(got.prog, x),
    st: { p: got.prog.id, email: got.email, name: got.name } };
}

function miniAppDeleteSub_(session, body) {
  var got = miniAppFindSub_(session, body);
  if (got.error) return got.error;
  var why = modifyBlock(got.sub, got.act, studentOptions(got.prog.general), got.prog.open, Date.now(), session.uid, 'delete');
  if (why) return { ok: false, error: 'blocked', message: why };
  var r = applyDelete_(got.prog, got.st, got.sub, session.uid);
  if (r.error) return { ok: false, error: 'blocked', message: r.error };
  notifyReviewChange_(got.prog, r.sub, got.st, 'delete');
  var msg = '🗑 حُذف تسليمك ' + subLabel_(r.sub) + '.' + (r.act ? '\nمجموع درجتك في «' + r.act.title + '» الآن: ' + r.total + ' (' + r.count + ' تسليم)' : '');
  send_(session.uid, msg);
  return { ok: true, message: msg, count: r.count, total: r.total };
}

function miniAppEditText_(session, body) {
  var nonce = str_(body.nonce);
  if (nonce) { var prev = miniAppIdemGet_(session.uid, nonce); if (prev) return prev; }
  var text = str_(body.text);
  if (!text) return { ok: false, error: 'bad_request', message: 'اكتب النص الجديد.' };
  var got = miniAppFindSub_(session, body);
  if (got.error) return got.error;
  var why = modifyBlock(got.sub, got.act, studentOptions(got.prog.general), got.prog.open, Date.now(), session.uid, 'edit');
  if (why) return { ok: false, error: 'blocked', message: why };
  if (got.act && got.act.accepts === 'file') return { ok: false, error: 'wrong_type', message: MSG.wrongType.text };
  var sent = send_(session.uid, '✏️ تعديلك لتسليم «' + got.sub.act + '»:\n' + (text.length > 3500 ? text.slice(0, 3500) + '…' : text));
  if (!sent || !sent.ok || !sent.result) return { ok: false, error: 'send_failed', message: MSG.error };
  var m = { message_id: sent.result.message_id, chat: { id: sent.result.chat ? sent.result.chat.id : session.uid }, from: miniAppFrom_(session), text: text };
  var c = extractContent_(m);
  got.st.ed = { id: got.sub.id, a: (got.act && (got.act.key || got.act.title)) || got.sub.act, n: got.sub.n };
  var r = applyEdit_(got.prog, got.act, got.st, m, c, session.uid);
  if (r.dup) return { ok: false, error: 'duplicate', message: 'هذا التعديل مُسجَّل من قبل.' };
  if (r.error) return { ok: false, error: 'blocked', message: r.error };
  notifyReviewChange_(got.prog, r.sub, got.st, 'edit', m, r.wasRejected);
  got.st.step = 'done'; got.st.a = got.st.ed.a; delete got.st.ed; setState_(session.uid, got.st);
  var msg = '✅ عُدّل تسليمك ' + subLabel_(r.sub) + ' وحلّ المحتوى الجديد محل القديم.' + (r.wasRejected ? '\nعاد التسليم مقبولًا وتُحتسب درجته.' : '');
  send_(session.uid, msg);
  var out = { ok: true, message: msg, subId: r.sub.id, wasRejected: !!r.wasRejected };
  miniAppIdemPut_(session.uid, nonce, out);
  return out;
}

function miniAppStartEditFile_(session, body) {
  var got = miniAppFindSub_(session, body);
  if (got.error) return got.error;
  var why = modifyBlock(got.sub, got.act, studentOptions(got.prog.general), got.prog.open, Date.now(), session.uid, 'edit');
  if (why) return { ok: false, error: 'blocked', message: why };
  if (got.act && got.act.accepts === 'text') return { ok: false, error: 'wrong_type', message: MSG.wrongType.file };
  got.st.step = 'edit';
  got.st.ed = { id: got.sub.id, a: (got.act && (got.act.key || got.act.title)) || got.sub.act, n: got.sub.n };
  if (got.act && got.act.level) got.st.lv = got.act.level;
  setState_(session.uid, got.st);
  var what = got.act && got.act.accepts === 'file' ? 'ملفًا' : 'نصًّا أو ملفًا';
  var msg = '✏️ أرسل الآن المحتوى الجديد لتسليمك ' + subLabel_(got.sub) + ' ' + what + ' هنا 👇\nسيحل محل المحتوى السابق. (للإلغاء: /cancel)';
  send_(session.uid, msg);
  return { ok: true, close: true, message: msg };
}

function miniAppDayPlus_(day, n) {
  var p = String(day).split('-');
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n);
  var z = function (x) { return (x < 10 ? '0' : '') + x; };
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
}

/** ورد اليوم والأيام السبعة التالية؛ يُستدعى بعد فحص isModuleActive_ */
function miniAppWirdPayload_(now) {
  var today = dayKey_(now || Date.now()), programs = [];
  getPrograms_().forEach(function (p) {
    var plan;
    try { plan = readWirdPlan_(p.id); } catch (e) { return; }
    if (!plan.length) return;
    var days = [];
    for (var i = 0; i <= 7; i++) {
      var day = miniAppDayPlus_(today, i), pick = pickWird_(plan, day);
      if (pick.skip) { days.push({ day: day, today: i === 0, skipped: true, reason: pick.skip, title: '', html: '', activity: '' }); continue; }
      if (!pick.row) continue;
      var title = str_(pick.row.title).replace(/\s+/g, ' ').trim();
      var head = wirdHtmlEscape_((i === 0 ? '📖 ورد اليوم' : '📖 ' + day) + (title ? ' — ' + title : '') + ' ✨');
      var body = wirdComposeBody_(pick.row);
      days.push({ day: day, today: i === 0, skipped: false, reason: '', title: title,
        html: wirdClipHtml_(head + (body ? '\n\n' + body : ''), 4000), activity: pick.row.act || '' });
    }
    if (days.length) programs.push({ id: p.id, name: p.name, days: days });
  });
  return { programs: programs };
}
function miniAppWird_(session) {
  if (!isModuleActive_('dailyWird')) return { ok: false, error: 'off', message: 'الورد اليومي غير متاح الآن.' };
  return { ok: true, wird: miniAppWirdPayload_(Date.now()) };
}

function miniAppQaPayload_(session, programs) {
  var limit = qaConf_().limit, used = Number(cache_().get(qaCountKey_(session.uid)) || 0);
  var out = { remaining: Math.max(0, limit - used), limit: limit, programs: [] };
  (programs || getPrograms_()).forEach(function (p) {
    var pid = p.id, faq = [];
    try { faq = readFaq_(pid).filter(function (f) { return f.q && f.a; }).map(function (f) { return { q: f.q, a: f.a }; }); } catch (e) { faq = []; }
    out.programs.push({ id: pid, name: p.name, faq: faq, questions: miniAppMyQuestions_(session.uid, pid) });
  });
  return out;
}
function miniAppMyQuestions_(uid, pid) {
  var rows = qaLogValues_();
  return rows.filter(function (r) { return str_(r[QL.UID]) === String(uid) && (!pid || str_(r[QL.PID]) === pid); })
    .map(function (r) {
      var st = str_(r[QL.ST]), answered = st === QS.SENT || st === QS.CUSTOM;
      return { id: str_(r[QL.ID]), pid: str_(r[QL.PID]), question: str_(r[QL.Q]), status: st,
        answer: answered ? str_(r[QL.REPLY]) : '', pending: st === QS.WAIT, at: r[QL.T] ? fmtTime(r[QL.T]) : '' };
    }).reverse();
}
function miniAppAsk_(session, body) {
  if (!isModuleActive_('studentQA')) return { ok: false, error: 'off', message: 'أسئلة الطلاب غير متاحة الآن.' };
  var text = str_(body.text);
  if (!text) return { ok: false, error: 'bad_request', message: 'اكتب سؤالك.' };
  var progs = getOpenPrograms_();
  var pid = str_(body.pid) || (progs.length === 1 ? progs[0].id : '');
  if (!pid || !progs.some(function (p) { return p.id === pid; })) return { ok: false, error: 'not_found', message: 'اختر البرنامج أولًا.' };
  var lim = qaLimit_(session.uid);
  if (lim) return { ok: false, error: 'limit', message: lim };
  qaSubmit_(session.uid, session.uid, miniAppFrom_(session), pid, text);
  return { ok: true, message: '✅ وصل سؤالك، وستصلك الإجابة هنا بعد مراجعة المشرف.', remaining: Math.max(0, qaConf_().limit - Number(cache_().get(qaCountKey_(session.uid)) || 0)) };
}
function miniAppQuestions_(session, body) {
  if (!isModuleActive_('studentQA')) return { ok: false, error: 'off', message: 'أسئلة الطلاب غير متاحة الآن.' };
  return { ok: true, qa: miniAppQaPayload_(session, body.pid ? [{ id: body.pid, name: body.pid }] : getPrograms_()) };
}

function miniAppReminders_(session, body) {
  if (body.off === true || body.off === false) remSetOff_(session.uid, body.off ? 'موقوفة' : 'مفعّلة', 'من التطبيق');
  return { ok: true, off: remIsOff_(session.uid) };
}

// ===== MiniAppAdmin.gs =====
/**
 * MiniAppAdmin.gs — شاشات المشرف والمالك في التطبيق المصغّر (المرحلة 3).
 * الصلاحيات هي نفسها: adminInfo_ ثم canAccess_، والمالك وحده للوحدات والمشرفين.
 * الرفض والتراجع عبر setSubStatus_ (مسار Reject.gs)، مع إشعار الطالب وتحديث أزرار المجموعة بتوكن بوت الطلاب.
 * «روجع» وتعديل الدرجة اليدوي مؤجّلان.
 */
var MINIAPP_REVIEW_N = 40;

function handleMiniAppAdmin_(session, action, body) {
  if (action === 'review') return miniAppAdminReview_(session, body);
  if (action === 'reject') return miniAppAdminReject_(session, body, true);
  if (action === 'unreject') return miniAppAdminReject_(session, body, false);
  if (action === 'sendFile') return miniAppAdminSendFile_(session, body);
  if (action === 'pause') return miniAppAdminPause_(session, body, false);
  if (action === 'resume') return miniAppAdminPause_(session, body, true);
  if (action === 'toggleOpen') return miniAppAdminToggleOpen_(session, body);
  if (action === 'settings') return miniAppAdminSettings_(session, body);
  if (action === 'setSetting') return miniAppAdminSetSetting_(session, body);
  if (action === 'schedule') return miniAppAdminSchedule_(session, body);
  if (action === 'setSchedule') return miniAppAdminSetSchedule_(session, body);
  if (action === 'remindOn') return miniAppAdminRemindOn_(session, body);
  if (action === 'previewRemind') return miniAppAdminPreviewRemind_(session, body);
  if (action === 'summary') return miniAppAdminSummary_(session, body);
  if (action === 'report') return miniAppAdminReport_(session, body);
  if (action === 'qaPending') return miniAppAdminQaPending_(session, body);
  if (action === 'qaAct') return miniAppAdminQaAct_(session, body);
  if (action === 'modules') return miniAppAdminModules_(session);
  if (action === 'toggleModule') return miniAppAdminToggleModule_(session, body);
  if (action === 'admins') return miniAppAdminAdmins_(session);
  if (action === 'addAdmin') return miniAppAdminAddAdmin_(session, body);
  if (action === 'removeAdmin') return miniAppAdminRemoveAdmin_(session, body);
  if (action === 'students') return miniAppAdminStudents_(session, body);
  if (action === 'addStudent') return miniAppAdminAddStudent_(session, body);
  if (action === 'addProgram') return miniAppAdminAddProgram_(session, body);
  if (action === 'wirdMaterials') return miniAppAdminWirdMaterials_(session, body);
  if (action === 'wirdPreview') return miniAppAdminWirdPreview_(session, body);
  if (action === 'wirdGenerate') return miniAppAdminWirdGenerate_(session, body);
  if (action === 'wirdEditDay') return miniAppAdminWirdEditDay_(session, body);
  if (action === 'wirdDeleteMaterial') return miniAppAdminWirdDeleteMaterial_(session, body);
  if (action === 'tawasulChannels') return miniAppAdminTawasulChannels_(session, body);
  if (action === 'tawasulAddChannel') return miniAppAdminTawasulAddChannel_(session, body);
  if (action === 'tawasulToggleChannel') return miniAppAdminTawasulToggleChannel_(session, body);
  if (action === 'tawasulRemoveChannel') return miniAppAdminTawasulRemoveChannel_(session, body);
  if (action === 'tawasulPosts') return miniAppAdminTawasulPosts_(session, body);
  if (action === 'tawasulCreatePost') return miniAppAdminTawasulCreatePost_(session, body);
  if (action === 'tawasulRepost') return miniAppAdminTawasulRepost_(session, body);
  return { ok: false, error: 'unknown_action' };
}

function miniAppAdminBootstrap_(session) {
  if (TENANT_.setup !== SETUP_DONE) return { ok: false, error: 'not_ready', message: MSG.notReady, user: miniAppUserDto_(session) };
  var now = Date.now(), adm = session.adm;
  var programs = getPrograms_().filter(function (p) { return canAccess_(adm, p.id); }).map(function (p) {
    var cfg = parseSettings(settingsValues_(p.id));
    return {
      id: p.id, name: p.name || p.id, open: !!p.open,
      activities: (cfg.activities || []).map(function (a) { return miniAppAdminActDto_(a, now); })
    };
  });
  var out = {
    ok: true,
    tenant: { id: TENANT_.id, name: TENANT_.name, theme: miniAppTheme_() },
    user: miniAppUserDto_(session),
    owner: !!adm.owner,
    adminCreateProgram: !!tenantConf_().adminCreateProgram,
    canReport: miniAppAdminCanReport_(adm),
    reportActive: isModuleActive_('monthlyReport'),
    qaActive: isModuleActive_('studentQA'),
    tawasulActive: isModuleActive_('tawasul'),
    programs: programs,
    qaPending: isModuleActive_('studentQA') ? miniAppAdminQaCount_(adm) : 0
  };
  if (adm.owner) {
    out.modules = miniAppModulesDto_();
    out.admins = cachedAdmins_();
  }
  return out;
}

function miniAppAdminActDto_(a, now) {
  var ps = pauseState(a, now);
  return {
    key: a.key, title: a.title, level: a.level || '', points: a.points, bot: a.bot !== false,
    paused: !!ps, scheduled: !!(a && a.pausedFrom != null && now < a.pausedFrom && !ps),
    pauseLabel: pauseLabel(a, now) || '▶️ متاحة'
  };
}

function miniAppAdminCanReport_(adm) {
  if (!adm) return false;
  if (adm.owner) return true;
  try { return mrState_().admins.indexOf(String(adm.id)) >= 0; } catch (e) { return false; }
}

function miniAppAdminNeed_(session, pid) {
  if (!session.adm) return { error: 'forbidden', message: '⛔ هذا لمشرفي البرامج فقط.' };
  if (TENANT_.setup !== SETUP_DONE) return { error: 'not_ready', message: MSG.notReady };
  if (!pid) return { error: 'missing', message: 'حدد البرنامج.' };
  if (!canAccess_(session.adm, pid)) return { error: 'forbidden', message: '⛔ هذا البرنامج غير متاح لك.' };
  var p = getPrograms_().filter(function (x) { return x.id === pid; })[0];
  if (!p) return { error: 'not_found', message: 'البرنامج غير موجود.' };
  return { ok: true, prog: p, pid: pid };
}

function miniAppAdminOwner_(session) {
  if (!session.adm || !session.adm.owner) return { error: 'forbidden', message: '⛔ للمالك فقط.' };
  return null;
}

function miniAppAsStudent_(fn) {
  var prev = (typeof BOT_ROLE !== 'undefined') ? BOT_ROLE : '';
  BOT_ROLE = 'student';
  try { return fn(); } finally { BOT_ROLE = prev; }
}

/* ───────── قائمة المراجعة ───────── */

function miniAppAdminSubInfo_(pid, subId) {
  var sh = programSpreadsheet_(pid).getSheetByName(NAMES.SUBMISSIONS);
  if (!sh || !subId) return null;
  var values = sh.getDataRange().getValues();
  if (!values || values.length < 2) return null;
  var ix = subIndex_(values[0]), ir = values[0].indexOf(SUB_EXTRA.REASON);
  for (var i = 1; i < values.length; i++) {
    if (str_(values[i][ix['معرف التسليم']]) !== String(subId)) continue;
    var r = values[i];
    return {
      p: pid,
      a: str_(r[ix['الفعالية']]),
      n: r[ix['رقم التسليم']],
      subId: String(subId),
      chat: str_(r[ix['معرف المحادثة']]),
      msg: r[ix['معرف الرسالة']],
      email: str_(r[ix['البريد']]),
      name: str_(r[ix['الاسم']]),
      status: str_(r[ix['الحالة']]) || SUB_ST.OK,
      reason: ir >= 0 ? str_(r[ir]) : '',
      fileId: str_(r[ix['file_id']]),
      fileName: str_(r[ix['اسم الملف']]),
      text: str_(r[ix['النص']]),
      type: str_(r[ix['نوع المحتوى']]),
      time: r[ix['الطابع الزمني']]
    };
  }
  return null;
}

function miniAppAdminReviewDto_(s, level) {
  var st = str_(s.status) || SUB_ST.OK;
  return {
    id: s.subId || s.id, n: s.n, act: s.act || s.a, level: level || '',
    name: s.name, email: s.email, type: s.type, text: s.text || '',
    fileId: s.fileId || '', fileName: s.fileName || '',
    time: s.time ? fmtTime(s.time) : '',
    status: st,
    rejected: SUB_REJECTED.indexOf(st) >= 0,
    deleted: st === SUB_ST.DEL,
    reason: s.reason || '',
    hasFile: !!s.fileId
  };
}

function miniAppAdminReview_(session, body) {
  var acc = miniAppAdminNeed_(session, body.pid);
  if (!acc.ok) return { ok: false, error: acc.error, message: acc.message };
  var values = subsValues_(acc.pid);
  var n = Math.min(Math.max(Number(body.n) || MINIAPP_REVIEW_N, 1), 80);
  var filter = str_(body.filter) || 'all';
  var q = str_(body.q).toLowerCase();
  var ix = values.length ? subIndex_(values[0]) : {};
  var ir = values.length ? values[0].indexOf(SUB_EXTRA.REASON) : -1;
  var il = values.length ? values[0].indexOf(LEVEL_HEADER) : -1;
  var today = dayKey_(Date.now());
  var out = [];
  for (var i = values.length - 1; i >= 1 && out.length < n; i--) {
    var r = values[i];
    var st = str_(r[ix['الحالة']]) || SUB_ST.OK;
    var t = dateValue_(r[ix['الطابع الزمني']]);
    if (filter === 'today' && dayKey_(t) !== today) continue;
    if (filter === 'rejected' && SUB_REJECTED.indexOf(st) < 0) continue;
    if (filter === 'open' && (SUB_REJECTED.indexOf(st) >= 0 || st === SUB_ST.DEL)) continue;
    var email = str_(r[ix['البريد']]), name = str_(r[ix['الاسم']]);
    if (q && email.toLowerCase().indexOf(q) < 0 && name.toLowerCase().indexOf(q) < 0 && str_(r[ix['الفعالية']]).toLowerCase().indexOf(q) < 0) continue;
    out.push(miniAppAdminReviewDto_({
      subId: str_(r[ix['معرف التسليم']]), n: r[ix['رقم التسليم']], act: str_(r[ix['الفعالية']]),
      name: name, email: email, type: str_(r[ix['نوع المحتوى']]), text: str_(r[ix['النص']]),
      fileId: str_(r[ix['file_id']]), fileName: str_(r[ix['اسم الملف']]),
      time: t, status: st, reason: ir >= 0 ? str_(r[ir]) : ''
    }, il >= 0 ? str_(r[il]) : ''));
  }
  return { ok: true, pid: acc.pid, filter: filter, items: out };
}

function miniAppAdminReject_(session, body, reject) {
  var acc = miniAppAdminNeed_(session, body.pid);
  if (!acc.ok) return { ok: false, error: acc.error, message: acc.message };
  var info = miniAppAdminSubInfo_(acc.pid, body.subId);
  if (!info) return { ok: false, error: 'not_found', message: 'لم أجد هذا التسليم.' };
  var reason = reject ? safeText_(body.reason) : '';
  var from = miniAppFrom_(session);
  var r = setSubStatus_(info, !!reject, reason, from);
  if (r.error) return { ok: false, error: 'blocked', message: r.error };
  miniAppAsStudent_(function () {
    var prog = loadProgram_(info.p);
    var msgs = reviewMessagesOf_(info.subId) || [];
    var header = null;
    for (var i = msgs.length - 1; i >= 0; i--) { if (msgs[i].h) { header = msgs[i]; break; } }
    if (!header) header = msgs[0];
    if (header) {
      var kb = reject ? undoKeyboard_() : (rejectKeyboard_(prog) || []);
      tg_('editMessageReplyMarkup', { chat_id: header.g, message_id: header.m, reply_markup: { inline_keyboard: kb } }, true);
    }
    if (studentOptions(prog && prog.general).notifyReject && info.chat) {
      var txt = reject
        ? ('❌ رُفض تسليمك رقم ' + info.n + ' في «' + info.a + '»' + (reason ? '\nالسبب: ' + reason : '') + '\nلا تُحتسب درجته.' +
          (studentOptions(prog.general).allowEdit && studentOptions(prog.general).showSubs ? '\nيمكنك تعديله وإعادة إرساله من /mysubs' : ''))
        : ('↩️ أُلغي رفض تسليمك رقم ' + info.n + ' في «' + info.a + '»، وعادت درجته.');
      tg_('sendMessage', { chat_id: info.chat, text: txt, reply_parameters: info.msg ? { message_id: Number(info.msg), allow_sending_without_reply: true } : undefined }, true);
    }
  });
  return { ok: true, rejected: !!reject, message: reject ? '❌ رُفض التسليم وأُبلغ الطالب حسب إعداد البرنامج.' : '↩️ أُلغي الرفض وعادت الدرجة.' };
}

function miniAppAdminSendFile_(session, body) {
  var acc = miniAppAdminNeed_(session, body.pid);
  if (!acc.ok) return { ok: false, error: acc.error, message: acc.message };
  var info = miniAppAdminSubInfo_(acc.pid, body.subId);
  if (!info || !info.fileId) return { ok: false, error: 'not_found', message: 'لا ملف في هذا التسليم.' };
  var caption = (info.name || '') + ' — «' + info.a + '» رقم ' + info.n;
  var ctx = { chat: session.uid, from: miniAppFrom_(session) };
  var ok = relayFile_(ctx, { fileId: info.fileId, fileName: info.fileName, chatId: info.chat, messageId: info.msg }, caption);
  return ok ? { ok: true, message: 'أُرسل الملف في محادثة البوت الإداري.' } : { ok: false, error: 'send', message: 'تعذر إرسال الملف. افتح بوت الطلاب مرة ثم أعد المحاولة.' };
}

/* ───────── الإيقاف وفتح التسليم ───────── */

function miniAppAdminPause_(session, body, resume) {
  var acc = miniAppAdminNeed_(session, body.pid);
  if (!acc.ok) return { ok: false, error: acc.error, message: acc.message };
  var ref = str_(body.activity);
  var values = settingsValues_(acc.pid, true);
  var act = parseSettings(values).activities.filter(function (a) { return a.key === ref; })[0];
  if (!act) return { ok: false, error: 'not_found', message: 'الفعالية غير موجودة.' };
  var from = '', until = '', label;
  if (resume) {
    from = ''; until = ''; label = '▶️ متاحة الآن';
    if (act.pausedFrom == null && act.pausedUntil == null) return { ok: true, activity: ref, label: label, message: 'ℹ️ الفعالية متاحة أصلًا.' };
  } else if (body.days && Number(body.days) > 0) {
    from = Date.now(); until = from + Number(body.days) * PAUSE_DAY;
    label = '⏸ موقوفة حتى ' + fmtTime(until);
  } else if (str_(body.until) === 'inf' || (!body.until && !body.from && !body.date)) {
    from = Date.now(); until = ''; label = '⏸ موقوفة حتى يعاد تفعيلها';
  } else {
    var raw = str_(body.from || body.date) && str_(body.until) && str_(body.until) !== 'inf'
      ? (str_(body.from || body.date) + ' إلى ' + str_(body.until))
      : str_(body.until || body.date || body.from);
    var pr = parsePauseInput(raw, Date.now());
    if (pr.error) return { ok: false, error: 'invalid', message: pr.error };
    from = pr.from; until = pr.until;
    label = (from > Date.now() + 60000 ? '🗓 إيقاف مجدول من ' + fmtTime(from) + ' ' : '⏸ موقوفة ') + 'حتى ' + fmtTime(until);
  }
  var old = pauseLabel(act, Date.now()) || '▶️ متاحة';
  var lock = tenantLock_();
  lock.waitLock(25000);
  try {
    var sh = programSpreadsheet_(acc.pid).getSheetByName(NAMES.SETTINGS);
    values = sh.getDataRange().getValues();
    var plan = planPause(values, ref, from === '' ? '' : new Date(from), until === '' ? '' : new Date(until));
    var err = validatePlan(values, plan);
    if (err) return { ok: false, error: 'invalid', message: err };
    writePlan_(sh, plan);
    invalidateProgram_(acc.pid);
    logChange_(miniAppFrom_(session), acc.pid, SECTIONS.ACTIVITIES, ref, 'إيقاف مؤقت', old, label);
    return { ok: true, activity: ref, label: label, message: '✅ حُفظ: «' + ref + '» — ' + label };
  } finally { lock.releaseLock(); }
}

function miniAppAdminToggleOpen_(session, body) {
  var acc = miniAppAdminNeed_(session, body.pid);
  if (!acc.ok) return { ok: false, error: acc.error, message: acc.message };
  var want = body.open === true || body.open === 'true' || body.open === OPT.YES || body.open === 1;
  var to = want ? OPT.YES : OPT.NO;
  var lock = tenantLock_();
  lock.waitLock(25000);
  try {
    var pr = programRow_(acc.pid);
    if (!pr) return { ok: false, error: 'not_found', message: 'البرنامج غير موجود.' };
    var now = isYes_(pr.values[3]) ? OPT.YES : OPT.NO;
    if (now === to) return { ok: true, open: want, message: 'ℹ️ البرنامج أصلًا ' + (want ? 'مفتوح 🟢' : 'مغلق ⚪️') };
    pr.sh.getRange(pr.row, 4).setValue(to);
    invalidateProgram_(acc.pid);
    logChange_(miniAppFrom_(session), acc.pid, 'البرامج', acc.pid, 'مفتوح للتسليم', now, to);
    return { ok: true, open: want, message: '✅ البرنامج الآن ' + (want ? 'مفتوح 🟢' : 'مغلق ⚪️') };
  } finally { lock.releaseLock(); }
}

/* ───────── الإعدادات ───────── */

function miniAppSecTitle_(sec) {
  if (typeof SEC_TITLE !== 'undefined' && SEC_TITLE[sec]) return SEC_TITLE[sec];
  return ({ GENERAL: '⚖️ النجاح والسقف', STUDENT: '🎓 خيارات الطلاب', WEEKLY: '📬 التقرير الأسبوعي',
    REMIND: '🔔 التذكيرات', REMTPL: '✍️ نصوص التذكيرات', ACTIVITIES: '🎯 الفعاليات',
    COMPONENTS: '📝 العناصر', GROUPS: '📦 المجموعات', BANDS: '🏅 التقديرات', LEVELS: '🪜 المستويات' })[sec] || sec;
}

function miniAppFieldValue_(raw) {
  if (raw == null || raw === '') return '';
  if (raw instanceof Date) return fmtTime(raw);
  if (typeof raw === 'boolean') return raw ? OPT.YES : OPT.NO;
  return raw;
}

function miniAppThemeSection_() {
  var t = {};
  try { t = JSON.parse(prop_('THEME') || '{}'); } catch (e) { t = {}; }
  function f(key, label, val) { return { key: key, label: label, kind: 'text', choices: null, value: val == null ? '' : String(val) }; }
  return { id: 'THEME', title: '🎨 الهوية', general: true, items: [], fields: [
    f('name', 'اسم الجهة الظاهر في التطبيق', t.name),
    f('logo', 'رابط الشعار (https)', t.logo),
    f('brand', 'اللون الأساسي (مثال #1a1b35)', t.brand),
    f('accent', 'لون التمييز (مثال #d4af37)', t.accent)
  ] };
}
function miniAppSettingsSection_(values, sec, cfg) {
  var fields = editable_()[sec] || [];
  var out = { id: sec, title: miniAppSecTitle_(sec), general: isGen_(sec), fields: [], items: [] };
  if (isGen_(sec)) {
    var g = cfg.general || {};
    out.fields = fields.map(function (f) {
      return { key: f[0], label: fieldLabel(sec, f[0]), kind: f[1], choices: f[2] || null, value: miniAppFieldValue_(g[f[0]]) };
    });
    return out;
  }
  var list = sectionItems(values, sec);
  out.items = list.map(function (it) {
    var ref = sec === 'BANDS' ? it.r : itemRef_(it.data);
    return {
      ref: ref, title: sec === 'BANDS' ? (it.data.min + ' ' + it.data.label) : itemRef_(it.data),
      fields: fields.map(function (f) {
        return { key: f[0], label: fieldLabel(sec, f[0]), kind: f[1], choices: f[2] || null, value: miniAppFieldValue_(it.data[f[0]]) };
      })
    };
  });
  return out;
}

function miniAppAdminSettings_(session, body) {
  var acc = miniAppAdminNeed_(session, body.pid);
  if (!acc.ok) return { ok: false, error: acc.error, message: acc.message };
  var values = settingsValues_(acc.pid, true);
  var cfg = parseSettings(values);
  var secs = body.sec ? [str_(body.sec)] : ['GENERAL', 'STUDENT', 'WEEKLY', 'REMIND', 'REMTPL', 'ACTIVITIES', 'COMPONENTS', 'GROUPS', 'BANDS', 'LEVELS'];
  return { ok: true, pid: acc.pid, sections: (function () { var o = secs.map(function (s) { return miniAppSettingsSection_(values, s, cfg); }); if (!body.sec || body.sec === 'THEME') o.push(miniAppThemeSection_()); return o; })() };
}

function miniAppSetTheme_(key, value) {
  var v = String(value == null ? '' : value).trim();
  if (key === 'brand' || key === 'accent') {
    if (v && !/^#[0-9a-fA-F]{6}$/.test(v)) return { ok: false, error: 'invalid', message: 'اللون يجب أن يكون بصيغة #RRGGBB أو فارغًا.' };
  } else if (key === 'logo') {
    if (v && !/^https:\/\//.test(v)) return { ok: false, error: 'invalid', message: 'رابط الشعار يجب أن يبدأ بـ https:// أو يكون فارغًا.' };
  } else if (key === 'name') {
    v = v.slice(0, 60);
  } else return { ok: false, error: 'invalid', message: 'حقل هوية غير معروف.' };
  var t = {};
  try { t = JSON.parse(prop_('THEME') || '{}'); } catch (e) { t = {}; }
  if (v) t[key] = v; else delete t[key];
  setTenantPropOf_(TENANT_.id, 'THEME', JSON.stringify(t));
  return { ok: true, value: v, message: '✅ حُفظت الهوية، وستظهر في التطبيق عند فتحه من جديد.' };
}
function miniAppAdminSetSetting_(session, body) {
  var acc = miniAppAdminNeed_(session, body.pid);
  if (!acc.ok) return { ok: false, error: acc.error, message: acc.message };
  var sec = str_(body.sec), key = str_(body.key), ref = body.ref == null ? null : body.ref;
    if (sec === 'THEME') return miniAppSetTheme_(key, body.value);
  if (!fieldSpec(sec, key)) return { ok: false, error: 'invalid', message: 'هذا الحقل غير قابل للتعديل.' };
  var values = settingsValues_(acc.pid, true);
  var cfg = parseSettings(values);
  var v = validateInput(sec, key, body.value, {
    levels: (cfg.levels || []).map(function (l) { return l.title; }),
    groups: (cfg.groups || []).map(function (g) { return g.title; })
  });
  if (!v.ok) return { ok: false, error: 'invalid', message: v.error };
  var lock = tenantLock_();
  lock.waitLock(25000);
  try {
    var sh = programSpreadsheet_(acc.pid).getSheetByName(NAMES.SETTINGS);
    values = sh.getDataRange().getValues();
    var plan = planEdit(values, sec, isGen_(sec) ? null : ref, key, v.value);
    if (!plan.error && body.old != null && String(plan.old) !== String(body.old)) {
      invalidateProgram_(acc.pid);
      return { ok: false, error: 'conflict', message: 'تغيّرت القيمة في الورقة منذ عرضها (الآن: ' + display_(plan.old) + '). لم يُحفظ شيء؛ أعد المحاولة.' };
    }
    var err = validatePlan(values, plan);
    if (err) return { ok: false, error: 'invalid', message: err };
    writePlan_(sh, plan);
    invalidateProgram_(acc.pid);
    logChange_(miniAppFrom_(session), acc.pid, SECTIONS[sec] || SECTIONS.GENERAL, isGen_(sec) ? '-' : ref, fieldLabel(sec, key), plan.old, v.value);
    return { ok: true, value: v.value, message: '✅ حُفظ في ورقة الإعدادات، ويستعمله بوت الطلاب فورًا.' };
  } finally { lock.releaseLock(); }
}

/* ───────── المواعيد والتذكيرات ───────── */

function miniAppAdminSchedule_(session, body) {
  var acc = miniAppAdminNeed_(session, body.pid);
  if (!acc.ok) return { ok: false, error: acc.error, message: acc.message };
  var prog = loadProgram_(acc.pid) || {};
  var g = parseSettings(settingsValues_(acc.pid)).general;
  var ro = reminderOptions(g);
  var rows = scheduleRows_(acc.pid).map(function (x) {
    return { row: x.row, key: x.key, start: x.start ? fmtTime(x.start) : '', deadline: x.deadline ? fmtTime(x.deadline) : '', close: !!x.close, link: x.link || '', line: schLine_(x) };
  });
  return {
    ok: true, pid: acc.pid, remindersOn: !!ro.on, options: ro, items: rows,
    warnings: prog.scheduleWarnings || [],
    schedulable: schedulables_(acc.pid)
  };
}

function miniAppAdminSetSchedule_(session, body) {
  var acc = miniAppAdminNeed_(session, body.pid);
  if (!acc.ok) return { ok: false, error: acc.error, message: acc.message };
  var kind = str_(body.kind);
  var lock = tenantLock_();
  lock.waitLock(25000);
  try {
    if (kind === 'add') {
      var items = schedulables_(acc.pid), it = items.filter(function (x) { return x.key === str_(body.key); })[0];
      if (!it) return { ok: false, error: 'not_found', message: 'العنصر غير موجود في الإعدادات.' };
      var s = parseSchDate_(body.start == null ? '-' : body.start, false);
      if (s.error) return { ok: false, error: 'invalid', message: s.error };
      var d = parseSchDate_(body.deadline == null ? '-' : body.deadline, true);
      if (d.error) return { ok: false, error: 'invalid', message: d.error };
      if (s.value == null && d.value == null) return { ok: false, error: 'invalid', message: 'لا بد من تاريخ بدء أو آخر موعد على الأقل.' };
      if (s.value != null && d.value != null && d.value <= s.value) return { ok: false, error: 'invalid', message: 'آخر موعد يجب أن يكون بعد البدء.' };
      var link = str_(body.link);
      if (link && CLEAR_WORDS.indexOf(link) < 0 && !/^https?:\/\/\S+$/.test(link)) return { ok: false, error: 'invalid', message: 'الرابط يبدأ بـ https://' };
      if (CLEAR_WORDS.indexOf(link) >= 0) link = '';
      var sh = scheduleSheet_(acc.pid, true);
      var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(str_), row = [];
      var rec = { item: it.title, level: it.level || '', start: schCell_(s.value, false), deadline: schCell_(d.value, true), close: body.close === false || body.close === OPT.NO || body.close === 'false' ? OPT.NO : OPT.YES, link: link };
      for (var c = 0; c < h.length; c++) { var f = SCHEDULE_FIELDS.filter(function (x) { return x[1] === h[c]; })[0]; row.push(f && rec[f[0]] != null ? rec[f[0]] : ''); }
      sh.appendRow(row);
      logChange_(miniAppFrom_(session), acc.pid, SCHEDULE_SHEET, it.key, 'إضافة', '', [rec.start, rec.deadline, rec.close].join(' | '));
    } else {
      var cur = scheduleRows_(acc.pid).filter(function (y) { return y.row === Number(body.row) && y.key === str_(body.key); })[0];
      if (!cur) { invalidateProgram_(acc.pid); return { ok: false, error: 'conflict', message: 'تغيّرت ورقة المواعيد منذ العرض. لم يُحفظ شيء؛ أعد المحاولة.' }; }
      var sh2 = scheduleSheet_(acc.pid, false);
      if (kind === 'del') {
        sh2.deleteRow(cur.row);
        logChange_(miniAppFrom_(session), acc.pid, SCHEDULE_SHEET, cur.key, 'حذف', schLine_(cur), '');
      } else if (kind === 'set') {
        var field = str_(body.field);
        if (!SCH_LABEL[field]) return { ok: false, error: 'invalid', message: 'حقل غير معروف.' };
        var value = body.value;
        if (field === 'close') value = (value === true || value === OPT.YES || value === 'true') ? OPT.YES : OPT.NO;
        else if (field === 'link') {
          var ls = str_(value);
          if (CLEAR_WORDS.indexOf(ls) >= 0) value = '';
          else if (ls && !/^https?:\/\/\S+$/.test(ls)) return { ok: false, error: 'invalid', message: 'الرابط يبدأ بـ https://' };
          else value = ls;
        } else {
          var pd = parseSchDate_(value, field === 'deadline');
          if (pd.error) return { ok: false, error: 'invalid', message: pd.error };
          value = schCell_(pd.value, field === 'deadline');
        }
        var hh = sh2.getRange(1, 1, 1, sh2.getLastColumn()).getValues()[0].map(str_), col = hh.indexOf(SCHEDULE_FIELDS[schCol_(field)][1]);
        if (col < 0) { col = hh.length; sh2.getRange(1, col + 1).setValue(SCHEDULE_FIELDS[schCol_(field)][1]).setFontWeight('bold'); }
        var old = field === 'link' ? cur.link : (field === 'close' ? (cur.close ? OPT.YES : OPT.NO) : schCell_(field === 'start' ? cur.start : cur.deadline, field === 'deadline'));
        sh2.getRange(cur.row, col + 1).setValue(value);
        logChange_(miniAppFrom_(session), acc.pid, SCHEDULE_SHEET, cur.key, SCH_LABEL[field], old, value);
      } else return { ok: false, error: 'invalid', message: 'إجراء غير معروف.' };
    }
    invalidateProgram_(acc.pid);
    var w = (loadProgram_(acc.pid).scheduleWarnings || []);
    return { ok: true, message: '✅ حُفظ في ورقة «' + SCHEDULE_SHEET + '»، ويستعمله بوت الطلاب فورًا.' + (w.length ? '\n⚠️ ' + w[0] : ''), warnings: w };
  } finally { lock.releaseLock(); }
}

function miniAppAdminRemindOn_(session, body) {
  var acc = miniAppAdminNeed_(session, body.pid);
  if (!acc.ok) return { ok: false, error: acc.error, message: acc.message };
  var on = body.on === true || body.on === 'true' || body.on === OPT.YES || body.on === 1;
  var to = on ? OPT.YES : OPT.NO;
  if (on) {
    try { ensureWeeklyTrigger_(); } catch (e) {
      logError_(e, 'reminders trigger');
      return { ok: false, error: 'trigger', message: 'تعذر إنشاء المشغّل الزمني. افتح مشروع البوت في المحرر ووافق على الصلاحية ثم أعد المحاولة.' };
    }
  }
  var lock = tenantLock_();
  lock.waitLock(25000);
  try {
    var sh = programSpreadsheet_(acc.pid).getSheetByName(NAMES.SETTINGS), values = sh.getDataRange().getValues();
    var g = parseSettings(values).general, ro = reminderOptions(g);
    var old = ro.on ? OPT.YES : OPT.NO;
    if (old === to) return { ok: true, on: on, message: 'ℹ️ التذكيرات أصلًا ' + (on ? 'مفعّلة' : 'موقوفة') };
    var plan = planEdit(values, 'REMIND', null, 'remindersOn', to), err = validatePlan(values, plan);
    if (err) return { ok: false, error: 'invalid', message: err };
    writePlan_(sh, plan);
    invalidateProgram_(acc.pid);
    logChange_(miniAppFrom_(session), acc.pid, SECTIONS.GENERAL, '-', fieldLabel('GENERAL', 'remindersOn'), old, to);
    if (!on) { try { removeWeeklyTriggerIfUnused_(acc.pid); } catch (e) { logError_(e, 'reminders trigger remove'); } }
    return { ok: true, on: on, message: on ? '✅ فُعّلت التذكيرات الآلية.' : '✅ أُوقفت التذكيرات الآلية لهذا البرنامج.' };
  } finally { lock.releaseLock(); }
}

function miniAppAdminPreviewRemind_(session, body) {
  var acc = miniAppAdminNeed_(session, body.pid);
  if (!acc.ok) return { ok: false, error: acc.error, message: acc.message };
  try {
    return { ok: true, text: previewReminders_(loadProgram_(acc.pid), Date.now()) };
  } catch (e) {
    logError_(e, 'app remind preview ' + acc.pid);
    return { ok: false, error: 'error', message: e.message };
  }
}

/* ───────── الملخص والتقرير ───────── */

function miniAppAdminSummary_(session, body) {
  var acc = miniAppAdminNeed_(session, body.pid);
  if (!acc.ok) return { ok: false, error: acc.error, message: acc.message };
  try {
    var out = calculateForSpreadsheet(programSpreadsheet_(acc.pid), { write: false });
    return { ok: true, text: buildProgramSummary(out.res, out.input.submissions, out.input.cfg, acc.prog.name || acc.pid) };
  } catch (e) {
    logError_(e, 'app summary ' + acc.pid);
    return { ok: false, error: 'calc', message: e.message };
  }
}

function miniAppAdminReport_(session, body) {
  if (!isModuleActive_('monthlyReport')) return { ok: false, error: 'off', message: 'التقرير الشهري موقوف. يفعّله المالك من الوحدات.' };
  if (!miniAppAdminCanReport_(session.adm)) return { ok: false, error: 'forbidden', message: '⛔ التقرير الشهري للمالك ومن يسمح لهم المالك من المشرفين.' };
  var key = /^\d{4}-\d{2}$/.test(latinDigits_(str_(body.month))) ? latinDigits_(str_(body.month)) : monthKey_(Date.now());
  var only = str_(body.pid);
  var partial = key >= monthKey_(Date.now());
  var progs = getPrograms_().filter(function (p) { return canAccess_(session.adm, p.id) && (!only || p.id === only); });
  if (!progs.length) return { ok: false, error: 'not_found', message: 'لا برامج في نطاقك.' };
  MR_EVENTS_ = null;
  var prevKey = prevMonthKey_(monthRange_(key).from + DAY_MS), list = [];
  progs.forEach(function (p) {
    try {
      var r = monthlyMetrics_(p.id, key, false), prev = readProgramMonth_(p.id, prevKey);
      if (!partial && session.adm.owner) writeProgramMonth_(p.id, key, r.m);
      list.push({ pid: p.id, name: p.name || p.id, m: r.m, prev: prev });
    } catch (e) {
      logError_(e, 'app report ' + p.id);
      list.push({ pid: p.id, name: (p.name || p.id) + ' ⚠️ ' + e.message, m: MR_FIELDS.reduce(function (o, f) { o[f[0]] = 0; return o; }, {}) });
    }
  });
  return { ok: true, month: key, partial: partial, text: monthlyText_(key, list, partial) };
}

/* ───────── أسئلة الطلاب ───────── */

function miniAppAdminQaCount_(adm) {
  try {
    var rows = qaLogValues_();
    return rows.filter(function (r) { return str_(r[QL.ST]) === QS.WAIT && canAccess_(adm, str_(r[QL.PID])); }).length;
  } catch (e) { return 0; }
}

function miniAppAdminQaDto_(r) {
  return {
    id: str_(r[QL.ID]), pid: str_(r[QL.PID]), name: str_(r[QL.NAME]), q: str_(r[QL.Q]),
    suggested: str_(r[QL.SUG]), status: str_(r[QL.ST]), pending: str_(r[QL.ST]) === QS.WAIT,
    by: str_(r[QL.BY]), reply: str_(r[QL.REPLY]), time: r[QL.T] ? fmtTime(r[QL.T]) : ''
  };
}

function miniAppAdminQaPending_(session, body) {
  if (!isModuleActive_('studentQA')) return { ok: false, error: 'off', message: 'أسئلة الطلاب موقوفة.' };
  if (!session.adm) return { ok: false, error: 'forbidden' };
  var log = qaLogSheet_(), rows = (log && log.getLastRow() > 1) ? log.getRange(2, 1, log.getLastRow() - 1, QA_LOG_HEADERS.length).getValues() : [];
  rows = rows.filter(function (r) { return canAccess_(session.adm, str_(r[QL.PID])); });
  if (str_(body.pid)) rows = rows.filter(function (r) { return str_(r[QL.PID]) === str_(body.pid); });
  var pending = rows.filter(function (r) { return str_(r[QL.ST]) === QS.WAIT; }).reverse();
  return { ok: true, items: pending.map(miniAppAdminQaDto_), total: rows.length };
}

function miniAppAdminQaAct_(session, body) {
  if (!isModuleActive_('studentQA')) return { ok: false, error: 'off', message: 'أسئلة الطلاب موقوفة.' };
  var act = str_(body.act), qid = str_(body.qid);
  var from = miniAppFrom_(session);
  var r = (act === 'c') ? qaCustom_(from, qid, str_(body.text)) : qaAction_(from, act, qid);
  if (r.error) return { ok: false, error: 'blocked', message: r.error };
  return { ok: true, message: r.text };
}

/* ───────── الوحدات والمشرفون (للمالك) ───────── */

function miniAppModulesDto_() {
  var conf = tenantConf_();
  var list = [{ id: 'autoCalc', title: '🧮 الحساب التلقائي كل ساعة', desc: '', ready: true, allowed: true, on: !!conf.autoCalc, locked: false }];
  list.push({ id: 'adminCreateProgram', title: '➕ السماح للمشرفين بإنشاء برامج', desc: '', ready: true, allowed: true, on: !!conf.adminCreateProgram, locked: false });
  Object.keys(MODULES).forEach(function (id) {
    var m = MODULES[id], allowed = isModuleAllowed_(id);
    list.push({ id: id, title: m.title, desc: m.desc || '', ready: !!m.ready, allowed: allowed, on: isModuleActive_(id), locked: !!(m.ready && !allowed) });
  });
  return list;
}

function miniAppAdminModules_(session) {
  var deny = miniAppAdminOwner_(session);
  if (deny) return { ok: false, error: deny.error, message: deny.message };
  return { ok: true, modules: miniAppModulesDto_() };
}

function miniAppAdminToggleModule_(session, body) {
  var deny = miniAppAdminOwner_(session);
  if (deny) return { ok: false, error: deny.error, message: deny.message };
  var id = str_(body.id);
  if (id === 'autoCalc') {
    var c = tenantConf_();
    saveTenantConf_({ autoCalc: !c.autoCalc });
    logChange_(miniAppFrom_(session), '-', 'الوحدات', 'autoCalc', c.autoCalc ? 'إيقاف' : 'تفعيل', '', '');
    return { ok: true, modules: miniAppModulesDto_(), message: '✅ حُفظ.' };
  }
  if (id === 'adminCreateProgram') {
    var c2 = tenantConf_();
    saveTenantConf_({ adminCreateProgram: !c2.adminCreateProgram });
    logChange_(miniAppFrom_(session), '-', 'الوحدات', 'adminCreateProgram', c2.adminCreateProgram ? 'إيقاف' : 'تفعيل', '', '');
    return { ok: true, modules: miniAppModulesDto_(), message: '✅ حُفظ.' };
  }
  var m = MODULES[id];
  if (!m || !m.ready) return { ok: false, error: 'unavailable', message: '⏳ هذه الوحدة غير متاحة بعد.' };
  if (!isModuleAllowed_(id)) return { ok: false, error: 'locked', message: m.title + ': ' + ADDON_LOCKED_TEXT };
  var on = isModuleActive_(id);
  if (on) disableModule_(id);
  else {
    var patch = {}; patch[id] = true; saveTenantConf_({ modules: patch });
    if (m.onEnable) { try { m.onEnable(); } catch (e) { logError_(e, 'module enable ' + id); } }
  }
  logChange_(miniAppFrom_(session), '-', 'الوحدات', id, on ? 'إيقاف' : 'تفعيل', on ? 'مفعّلة' : 'موقوفة', on ? 'موقوفة' : 'مفعّلة');
  return { ok: true, modules: miniAppModulesDto_(), message: '✅ ' + m.title + ': ' + (on ? 'أُوقفت' : 'فُعّلت') + '.' };
}

function miniAppAdminAdmins_(session) {
  var deny = miniAppAdminOwner_(session);
  if (deny) return { ok: false, error: deny.error, message: deny.message };
  return { ok: true, admins: readAdmins_(), programs: getPrograms_().map(function (p) { return { id: p.id, name: p.name || p.id }; }) };
}

function miniAppAdminAddAdmin_(session, body) {
  var deny = miniAppAdminOwner_(session);
  if (deny) return { ok: false, error: deny.error, message: deny.message };
  var uid = str_(body.uid);
  if (!/^\d+$/.test(uid)) return { ok: false, error: 'invalid', message: 'معرّف تيليجرام رقم فقط. اطلب من المشرف /myid في البوت الإداري.' };
  if (uid === String(ownerId_())) return { ok: false, error: 'invalid', message: 'هذا معرّف المالك.' };
  var name = str_(body.name) || uid;
  var all = body.all === true || body.all === 'true';
  var programs = all ? [] : (body.programs || []).map(str_).filter(String);
  if (!all && !programs.length) return { ok: false, error: 'invalid', message: 'اختر برنامجًا واحدًا على الأقل، أو «كل البرامج».' };
  var known = {}; getPrograms_().forEach(function (p) { known[p.id] = 1; });
  if (programs.some(function (id) { return !known[id]; })) return { ok: false, error: 'invalid', message: 'برنامج غير معروف.' };
  var existed = readAdmins_().some(function (a) { return a.id === uid; });
  var lock = tenantLock_();
  lock.waitLock(25000);
  try {
    addAdmin_(uid, name, programs, session.uid);
    logChange_(miniAppFrom_(session), '-', 'المشرفون', uid, existed ? 'تحديث' : 'إضافة', '', name + ' ' + (all ? 'كل البرامج' : programs.join(',')));
    return { ok: true, admins: readAdmins_(), message: '✅ ' + (existed ? 'حُدّث' : 'أُضيف') + ' المشرف ' + name + '.' };
  } finally { lock.releaseLock(); }
}

function miniAppAdminStudents_(session, body) {
  var acc = miniAppAdminNeed_(session, body.pid);
  if (!acc.ok) return { ok: false, error: acc.error, message: acc.message };
  var prog = loadProgram_(acc.pid);
  if (!prog) return { ok: false, error: 'not_found', message: 'البرنامج غير موجود.' };
  var g = prog.general || {};
  if (!g.regSpreadsheetId) return { ok: true, students: [], regFile: false, message: 'لم يُربط ملف تسجيل بهذا البرنامج بعد.' };
  var rsh, values;
  try {
    var rss = openSS_(extractSpreadsheetId(g.regSpreadsheetId));
    rsh = g.regSheet ? rss.getSheetByName(g.regSheet) : rss.getSheets()[0];
    if (!rsh) return { ok: false, error: 'not_found', message: 'ورقة التسجيل غير موجودة في ملف التسجيل.' };
    values = rsh.getDataRange().getValues();
  } catch (e) { return { ok: false, error: 'reg_read', message: 'تعذّر قراءة ملف التسجيل: ' + e.message }; }
  var reg = readRegistration(values, g, getCorrections_(prog));
  var users = {};
  var ush = central_().getSheetByName(BOT.USERS);
  if (ush && ush.getLastRow() > 1) {
    ush.getRange(2, 1, ush.getLastRow() - 1, 2).getValues().forEach(function (r) { if (r[1]) users[normalizeEmail(r[1])] = String(r[0]); });
  }
  var list = Object.keys(reg.map).map(function (e) {
    return { name: reg.map[e].name, email: e, gender: reg.map[e].gender, uid: users[e] || '' };
  });
  return { ok: true, students: list, regFile: true };
}

function miniAppAdminAddStudent_(session, body) {
  var acc = miniAppAdminNeed_(session, body.pid);
  if (!acc.ok) return { ok: false, error: acc.error, message: acc.message };
  var prog = loadProgram_(acc.pid);
  if (!prog) return { ok: false, error: 'not_found', message: 'البرنامج غير موجود.' };
  var g = prog.general || {};
  var ownerDeny = miniAppAdminOwner_(session);
  if (ownerDeny && String(g.adminAddStudent || 'نعم') === 'لا') return { ok: false, error: 'forbidden', message: 'إضافة الطلاب موقوفة للمشرفين في هذا البرنامج (راجع المالك).' };
  var name = str_(body.name).trim();
  if (!name || name.length > 60) return { ok: false, error: 'invalid', message: 'أدخل اسم الطالب (حتى 60 حرفًا).' };
  var email = normalizeEmail(str_(body.email));
  if (!isValidEmail(email)) return { ok: false, error: 'invalid', message: 'البريد غير صالح.' };
  var gender = str_(body.gender);
  if (gender !== 'ذكر' && gender !== 'أنثى') return { ok: false, error: 'invalid', message: 'اختر الجنس: ذكر أو أنثى.' };
  var uid = str_(body.uid);
  if (uid && !/^\d+$/.test(uid)) return { ok: false, error: 'invalid', message: 'معرّف تيليجرام رقم فقط (من الأمر /myid في البوت).' };
  if (!g.regSpreadsheetId) return { ok: false, error: 'no_reg_file', message: 'لم يُربط ملف تسجيل بهذا البرنامج بعد — الصق رابطه في «الإعدادات» أولًا.' };
  var found;
  try { found = lookupRegistration_(prog, email); }
  catch (e) { return { ok: false, error: 'reg_read', message: 'تعذّر قراءة ملف التسجيل: ' + e.message }; }
  var lock = tenantLock_();
  lock.waitLock(25000);
  try {
    if (!found) {
      var rss = openSS_(extractSpreadsheetId(g.regSpreadsheetId));
      var rsh = g.regSheet ? rss.getSheetByName(g.regSheet) : rss.getSheets()[0];
      if (!rsh) return { ok: false, error: 'not_found', message: 'ورقة التسجيل غير موجودة في ملف التسجيل.' };
      var headers = rsh.getRange(1, 1, 1, rsh.getLastColumn()).getValues()[0];
      var ei = findColumn(headers, g.regEmailPattern), ni = findColumn(headers, g.regNamePattern), gi = findColumn(headers, g.regGenderPattern);
      if (ei < 0) return { ok: false, error: 'reg_columns', message: 'لم نعثر على عمود البريد في ملف التسجيل (النمط: ' + g.regEmailPattern + ').' };
      var ti = -1;
      headers.forEach(function (h, i) { if (ti < 0 && /طابع|timestamp/i.test(String(h || ''))) ti = i; });
      var n = Math.max(ei, ni, gi, ti) + 1;
      var row = []; for (var i = 0; i < n; i++) row.push('');
      row[ei] = email; if (ni >= 0) row[ni] = name; if (gi >= 0) row[gi] = gender; if (ti >= 0) row[ti] = new Date();
      rsh.appendRow(row);
      try { getRegMap_(prog, true); } catch (e2) { }
    }
    if (uid) saveUserEmail_(uid, email, '');
    logChange_(miniAppFrom_(session), acc.pid, 'التسجيل', email, found ? 'ربط طالب' : 'إضافة طالب', '', name + (uid ? ' (' + uid + ')' : ''));
    return { ok: true, existed: !!found, message: found ? 'ℹ️ الطالب مسجل أصلًا — ' + (uid ? 'رُبط معرّف تيليجرام ببريده.' : 'لا حاجة لإضافته.') : '✅ أُضيف الطالب ' + name + ' إلى التسجيل.' };
  } finally { lock.releaseLock(); }
}

// مفتاح إنشاء البرامج للمشرفين على نمط autoCalc: مفتاح علوي في tenantConf_()
// (الافتراضي: false = المالك وحده)، يظهر في بطاقة «الوحدات» ويُقلب من هناك.
function miniAppAdminAddProgram_(session, body) {
  var ownerDeny = miniAppAdminOwner_(session);
  if (ownerDeny && !tenantConf_().adminCreateProgram) return { ok: false, error: ownerDeny.error, message: ownerDeny.message };
  var name = str_(body.name).trim();
  if (!name || name.length < 2 || name.length > 60) return { ok: false, error: 'invalid', message: 'أدخل اسم البرنامج (2–60 حرفًا).' };
  var levels = [];
  var lv = str_(body.levels).trim();
  if (lv && lv !== 'بلا مستويات') {
    levels = lv.split(',').map(function (s) { return s.trim(); }).filter(String);
    if (!levels.length || levels.length > 8) return { ok: false, error: 'invalid', message: 'المستويات: 1–8 أسماء مفصولة بفواصل، أو «بلا مستويات».' };
  }
  var reg = resolveRegLink_(str_(body.regLink));
  if (str_(body.regLink).trim() && !reg.ssId && !reg.formUrl) return { ok: false, error: 'invalid', message: 'رابط التسجيل غير مفهوم — الصق رابط ملف ردود التسجيل أو رابط الاستمارة.' };
  var q = quotaError_(); if (q) return { ok: false, error: 'quota', message: q };
  var pid = 'p1', n = 1;
  while (getPrograms_().some(function (p) { return p.id === pid; })) pid = 'p' + (++n);
  var made;
  try { made = createProgramFromTemplate_({ name: name, levels: levels, reviewChatId: tenantConf_().reviewChatId || '', regLink: reg.ssId || '', regFormUrl: reg.formUrl || '', restDays: str_(body.restDays || '') }); }
  catch (e) { logError_(e, 'new program'); return { ok: false, error: 'create_failed', message: '⚠️ تعذّر الإنشاء: ' + e.message }; }
  var r = registerProgram_(pid, name, made.url, false, 'إنشاء برنامج من التطبيق المصغّر');
  if (r && r.error) return { ok: false, error: 'register_failed', message: '⚠️ ' + r.error };
  logChange_(miniAppFrom_(session), pid, 'البرامج', pid, 'إنشاء برنامج من التطبيق', '', made.url);
  return { ok: true, pid: pid, name: name, url: made.url, message: '✅ أُنشئ «' + name + '» (' + pid + ') مغلقًا للتسليم.' + (made.shared && made.shared.length ? '\n👥 شُارك مع: ' + made.shared.join(', ') : '') };
}

// رابط التسجيل: ملف الردود يُحفظ regSpreadsheetId، ورابط الاستمارة يُحفظ
// regFormUrl فقط (لا تحويل تلقائي: FormApp غير مستخدم في المشروع أصلًا).
function resolveRegLink_(link) {
  var out = { formUrl: '', ssId: '' };
  if (!link) return out;
  var s = String(link).trim();
  if (!s) return out;
  if (/\/forms\/d\//.test(s) || /forms\.gle\//.test(s)) { out.formUrl = s; return out; }
  try { var id = extractSpreadsheetId(s); if (id) { var ss = openSS_(id); if (ss) { out.ssId = id; return out; } } } catch (e) {}
  return out;
}
function miniAppAdminRemoveAdmin_(session, body) {
  var deny = miniAppAdminOwner_(session);
  if (deny) return { ok: false, error: deny.error, message: deny.message };
  var uid = str_(body.uid);
  if (!uid || uid === String(ownerId_())) return { ok: false, error: 'invalid', message: 'لا يمكن حذف المالك.' };
  var lock = tenantLock_();
  lock.waitLock(25000);
  try {
    if (!removeAdmin_(uid)) return { ok: false, error: 'not_found', message: 'المشرف غير موجود.' };
    logChange_(miniAppFrom_(session), '-', 'المشرفون', uid, 'حذف', uid, '');
    return { ok: true, admins: readAdmins_(), message: '✅ حُذف المشرف ' + uid + '.' };
  } finally { lock.releaseLock(); }
}

// ===== MiniAppPlatform.gs =====
/**
 * MiniAppPlatform.gs — لوحة مالك المنصة في التطبيق المصغّر (@AutomatePrBot).
 * المسار: POST ?b=app&r=platform  (بلا t وبلا سر؛ التوقيع بتوكن بوت المنصة).
 * لا يدخل سياق عميل، ولا يُشترط isModuleActive_('miniApp').
 * المصرّح له: isPlatformOwner_ فقط (PLATFORM_OWNER_ID)، كما في أوامر البوت.
 */
function miniAppPlatformPost_(e) {
  BOT_ROLE = 'platform';
  var body = {}, raw = e && e.postData && e.postData.contents;
  try {
    if (raw && String(raw).charAt(0) === '{') body = JSON.parse(raw);
    else body = { initData: raw || '', action: 'bootstrap' };
  } catch (x) { return appOut_({ ok: false, error: 'bad_request' }); }
  if (!str_(body.initData)) return appOut_({ ok: false, error: 'unauthorized:empty' });
  if (!platformProp_('PLATFORM_BOT_TOKEN')) return appOut_({ ok: false, error: 'unauthorized:sig' });
  var v;
  try { v = verifyMiniAppInit_(body.initData, platformProp_('PLATFORM_BOT_TOKEN')); }
  catch (err) { logError_(err, 'app platform verify'); return appOut_({ ok: false, error: 'unauthorized:sig' }); }
  if (!v.ok) {
    var why = v.reason === 'expired' ? 'unauthorized:expired' : (v.reason === 'hash' || v.reason === 'bad' ? 'unauthorized:sig' : 'unauthorized:sig');
    return appOut_({ ok: false, error: why });
  }
  if (!isPlatformOwner_(v.uid)) return appOut_({ ok: false, error: 'unauthorized:owner', message: 'غير مصرّح' });
  var session = { uid: v.uid, user: v.user, name: v.name, role: 'platform' };
  try {
    return appOut_(handleMiniAppPlatform_(session, body.action || 'bootstrap', body));
  } catch (err) {
    var code = miniAppOwnerErrorCode_();
    logError_(err, 'app platform ' + code);
    return appOut_({ ok: false, error: 'error', message: code });
  }
}

/** رمز قصير آمن يُعرض للمالك فقط، والرسالة الحقيقية تُكتب في سجل أخطاء المنصة */
function miniAppOwnerErrorCode_() {
  return 'E' + String(Utilities.getUuid()).replace(/-/g, '').toUpperCase().slice(-4);
}

function handleMiniAppPlatform_(session, action, body) {
  body = body || {};
  if (action === 'bootstrap' || action === 'tenants') return miniAppPlatformBootstrap_(session, body);
  if (action === 'tenant') return miniAppPlatformTenant_(session, body);
  if (action === 'addTenant') return miniAppPlatformAddTenant_(session, body);
  if (action === 'extend') return miniAppPlatformExtend_(session, body);
  if (action === 'suspend' || action === 'resume') return miniAppPlatformStatus_(session, body, action === 'suspend');
  if (action === 'addon') return miniAppPlatformAddon_(session, body);
  return { ok: false, error: 'unknown_action' };
}

function miniAppPlatformNeed_(id) {
  var t = loadTenant_(id, true);
  return t ? { ok: true, tenant: t } : { ok: false, error: 'not_found', message: '⚠️ العميل غير موجود.' };
}

function miniAppPlatformLicLabel_(t, now) {
  var lic = licenseState_(t, now);
  if (t.status === TENANT_STATUS.SUSPENDED) return 'suspended';
  if (!lic.ok && lic.reason === 'expired') return 'expired';
  if (lic.grace) return 'grace';
  if (t.status === TENANT_STATUS.TRIAL) return 'trial';
  return 'active';
}

/** مؤشرات استهلاك العميل للوحة المنصة: عدّادات اليوم (من الذاكرة المؤقتة) + آخر يوم نشاط. آخر يوم نشاط هو أحدث يوم فيه أي عدّاد (اليوم أو أمس من الذاكرة المؤقتة، أو ورقة «الاستهلاك» للأيام الأقدم)؛ '' عند غياب أي نشاط مسجّل. */
function miniAppPlatformUsage_(t, now, lastMap) {
 now = now || Date.now();
 var today = dayKey_(now), yday = dayKey_(now - DAY_MS);
 var u = usageSafe_(t.id, today), y = usageSafe_(t.id, yday);
 var last = '';
 if (u.updates || u.ticks || u.app) last = today;
 else if (y.updates || y.ticks || y.app) last = yday;
 var sheetLast = lastMap ? str_(lastMap[t.id] || '') : '';
 if (sheetLast && sheetLast > last) last = sheetLast;
 return { day: today, updates: u.updates, ticks: u.ticks, app: u.app, lastActiveDay: last };
}

function miniAppPlatformTenantDto_(t, now, lastMap) {
  now = now || Date.now();
  var lic = licenseState_(t, now), kind = miniAppPlatformLicLabel_(t, now);
  return {
    id: t.id, name: t.name, status: t.status, kind: kind, license: t.license || '',
    licenseOk: !!lic.ok, grace: !!lic.grace, reason: lic.reason || '',
    expiry: t.expiry != null ? dayKey_(t.expiry) : '',
    graceEnd: lic.graceEnd ? dayKey_(lic.graceEnd) : '',
    quota: t.quota, addons: t.addons || [], setup: t.setup || '',
    ownerId: t.ownerId || '', line: tenantLine_(t), usage: miniAppPlatformUsage_(t, now, lastMap)
  };
}

function miniAppPlatformStats_(list, now, lastMap) {
  now = now || Date.now();
  var soon = now + 7 * DAY_MS, out = { total: list.length, active: 0, trial: 0, grace: 0, expired: 0, suspended: 0, expiringSoon: [] };
  list.forEach(function (t) {
    var kind = miniAppPlatformLicLabel_(t, now);
    out[kind] = (out[kind] || 0) + 1;
    var lic = licenseState_(t, now);
    if (lic.ok && t.expiry != null && t.expiry >= now && t.expiry < soon) out.expiringSoon.push(miniAppPlatformTenantDto_(t, now, lastMap));
  });
  return out;
}

function miniAppPlatformModules_() {
  return Object.keys(MODULES).map(function (id) { return { id: id, title: MODULES[id].title, ready: !!MODULES[id].ready }; });
}

function miniAppPlatformSearch_(list, q) {
  q = str_(q).toLowerCase();
  if (!q) return list;
  return list.filter(function (t) {
    return t.id.indexOf(q) >= 0 || str_(t.name).toLowerCase().indexOf(q) >= 0 || str_(t.status).indexOf(q) >= 0;
  });
}

function miniAppPlatformBootstrap_(session, body) {
  var now = Date.now(), all = listTenants_(), filtered = miniAppPlatformSearch_(all, body.q);
 var lastMap = usageLastDayByTenant_();
  return {
    ok: true,
    user: { id: session.uid, name: session.name, role: 'platform', roleLabel: 'مالك المنصة' },
    stats: miniAppPlatformStats_(all, now, lastMap),
    tenants: filtered.map(function (t) { return miniAppPlatformTenantDto_(t, now, lastMap); }),
    modules: miniAppPlatformModules_()
  };
}

function miniAppPlatformTenant_(session, body) {
  var acc = miniAppPlatformNeed_(body.id);
  if (!acc.ok) return acc;
  var t = acc.tenant, lastMap = usageLastDayByTenant_(), out = miniAppPlatformTenantDto_(t, Date.now(), lastMap);
  out.editors = t.editors || [];
  out.controlUrl = t.controlSsId ? 'https://docs.google.com/spreadsheets/d/' + t.controlSsId + '/edit' : '';
  out.usage = miniAppPlatformUsage_(t, Date.now(), lastMap);
  out.addonsDetail = [];
  var conf = {};
  try {
    withTenant_(t, function () {
      conf = tenantConf_().modules || {};
      try { out.programs = getPrograms_().length; } catch (e) { out.programs = null; }
    });
  } catch (e) { conf = {}; }
  Object.keys(MODULES).forEach(function (id) {
    var m = MODULES[id], allowed = (t.addons || []).indexOf(id) >= 0;
    out.addonsDetail.push({ id: id, title: m.title, ready: !!m.ready, allowed: allowed, on: !!(allowed && conf[id] && m.ready) });
  });
  return { ok: true, tenant: out };
}

function miniAppPlatformAddTenant_(session, body) {
  var id = str_(body.id).toLowerCase(), name = str_(body.name).trim();
  if (!TENANT_ID_RE.test(id) || !name) return { ok: false, error: 'invalid', message: 'المعرّف: حروف لاتينية صغيرة وأرقام (2-20)، مع اسم.' };
  var r = addTenant_(id, name);
  if (r.error) return { ok: false, error: 'conflict', message: r.error };
  return {
    ok: true,
    id: id, name: name, license: r.license, expiry: r.expiry, controlUrl: r.controlUrl,
    tenant: miniAppPlatformTenantDto_(loadTenant_(id, true)),
    message: '✅ أُضيف العميل ' + id + ' («' + name + '») تجريبيًا حتى ' + r.expiry + '، حصة ' + DEFAULT_QUOTA + ' برامج.'
  };
}

function miniAppPlatformExtend_(session, body) {
  var acc = miniAppPlatformNeed_(body.id);
  if (!acc.ok) return acc;
  var r = extendTenant_(acc.tenant, body.value != null ? body.value : body.days);
  if (r.error) return { ok: false, error: 'invalid', message: r.error };
  return { ok: true, tenant: miniAppPlatformTenantDto_(r.tenant), message: '✅ ' + tenantLine_(r.tenant) };
}

function miniAppPlatformStatus_(session, body, suspended) {
  var acc = miniAppPlatformNeed_(body.id);
  if (!acc.ok) return acc;
  var r = setTenantSuspended_(acc.tenant, suspended);
  return { ok: true, tenant: miniAppPlatformTenantDto_(r.tenant), message: (suspended ? '⏸ أُوقف (البيانات محفوظة): ' : '▶️ استُؤنف: ') + tenantLine_(r.tenant) };
}

function miniAppPlatformAddon_(session, body) {
  var acc = miniAppPlatformNeed_(body.id);
  if (!acc.ok) return acc;
  var ops = body.ops;
  if (!ops || !ops.length) {
    if (body.module) ops = [(body.allow === false || body.allow === 'false' ? '-' : '+') + str_(body.module)];
    else return miniAppPlatformTenant_(session, body);
  }
  var r = applyAddonOps_(acc.tenant, ops);
  if (r.error) return { ok: false, error: 'invalid', message: r.error };
  var detail = miniAppPlatformTenant_(session, { id: r.tenant.id });
  return { ok: true, tenant: detail.tenant, message: '✅ حُفظت إضافات ' + r.tenant.id + '.', grants: r.grants, revokes: r.revokes, stopped: r.stopped };
}

// ===== Modules.gs =====
/**
 * Modules.gs — سجل الوحدات الإضافية لكل عميل (كلها موقوفة افتراضيًا).
 *
 * عقد الوحدة:
 *   MODULES[id] = {
 *     title, desc, ready (منفَّذة أم «قريبًا»),
 *     events: [أنواع الأحداث التي تستقبلها],
 *     onEvent(ev)              — يُستدعى بعد كتابة الحدث؛ سريع، لا يرسل للطلاب بكثافة، لا يرمي (يُلف بـ try)
 *     onTick(now, budgetEnd)   — في المشغّل الساعي داخل سياق العميل؛ يحترم budgetEnd (ms)، ويستأنف في التشغيل التالي
 *     onCommand(ctx, text)     — اختياري: أوامر البوت الإداري (/<cmd>)؛ للمالك فقط
 *     command: '/quiz'         — اسم الأمر إن وُجد
 *   }
 *     onEnable()               — اختياري: عند تفعيل العميل للوحدة (بعد الحفظ)
 *     onDisable()              — اختياري: تنظيف عند الإيقاف أو سحب الإذن (لا يحذف بيانات العميل)
 *     admins: true             — أمر الوحدة متاح للمشرفين أيضًا (والوحدة تتحقق من صلاحياتهم بنفسها)
 *     onAdminMessage(ctx, m)   — رسالة غير أمر في البوت الإداري (صورة، رد مكتوب…)؛ undefined = لم تعالجها
 *     onAdminCallback(ctx, d)  — أزرار «MX:<id>:<d>» في البوت الإداري
 *     studentCommand, onStudentCommand(m, uid, text), onStudentMessage(m, uid, st) (حالة الطالب step='mx' و mod=<id>),
 *     onStudentCallback(q, d) («mx:<id>:<d>» في الخاص)، onGroupCallback(q, d)، onGroupReply(m) — بوت الطلاب
 *   كل الخطافات تمر عبر moduleHook_ التي تفحص isModuleActive_ أولًا؛ العميل بلا إضافات لا يتغير عنده شيء.
 * الإعدادات: tenantConf_().modules[id] = true/false، وحالة كل وحدة في خاصية العميل «MOD_<id>» (JSON).
 *
 * الإذن (الاشتراك): الوحدة تعمل فقط إن سمح بها مالك المنصة للعميل (عمود «الإضافات المسموحة» في سجل العملاء،
 * بأمر /addon في بوت المنصة) **و** فعّلها العميل من /modules. الفحص كله في isModuleActive_ وحدها.
 * الإذن يُقرأ من كائن العميل المخزَّن مؤقتًا (ten:<id>، 5 دقائق) ويُبطَل فورًا عند تغييره بـ /addon (updateTenant_).
 */
var MODULES = {
  quizImport: { title: '📥 استيراد نتائج الاختبارات', desc: 'يسحب ردود اختبارات Google Forms من ملفها، ويطابقها بالبريد، ويكتب الدرجات في ورقة الاختبار الصحيحة (والمستوى)، ثم يعيد الحساب.',
    ready: true, events: [], command: '/quiz',
    onTick: function (now, budgetEnd) { return quizImportTick_(now, budgetEnd); },
    onCommand: function (ctx, text) { return quizCommand_(ctx, text); } },
  dailyWird: { title: '📖 الورد اليومي', desc: 'ينشر ورد كل يوم من ورقة «خطة الورد» في قناة البرنامج عبر بوت الطلاب، في الساعة التي تختارها (نص أو صورة ثابتة).',
    ready: true, events: [], command: '/wird',
    onTick: function (now, budgetEnd) { return wirdTick_(now, budgetEnd); },
    onCommand: function (ctx, text) { return wirdCommand_(ctx, text); },
    onAdminMessage: function (ctx, m) { return wirdAdminMessage_(ctx, m); },
    onAdminCallback: function (ctx, data) { return wirdCallback_(ctx, data); } },
  studentQA: { title: '❓ أسئلة الطلاب', desc: 'يسأل الطالب بأمر /ask في بوت الطلاب، فتُقترح إجابة من ورقة «الأسئلة الشائعة» وتصل المشرفين للموافقة. لا يصل الطالبَ شيء قبل موافقة مشرف.',
    ready: true, events: [], command: '/faq', admins: true,
    onCommand: function (ctx, text) { return faqCommand_(ctx, text); },
    onAdminMessage: function (ctx, m) { return qaAdminMessage_(ctx, m); },
    onAdminCallback: function (ctx, data) { return qaAdminCallback_(ctx, data); },
    studentCommand: '/ask', studentHelp: '/ask سؤال للمشرفين',
    onStudentCommand: function (m, uid, text) { return qaStudentCommand_(m, uid, text); },
    onStudentMessage: function (m, uid, st) { return qaStudentMessage_(m, uid, st); },
    onStudentCallback: function (q, data) { return qaStudentCallback_(q, data); },
    onGroupCallback: function (q, data) { return qaGroupCallback_(q, data); },
    onGroupReply: function (m) { return qaGroupReply_(m); } },
  monthlyReport: { title: '📊 التقرير الشهري', desc: 'أول كل شهر (9 صباحًا) يحسب أرقام الشهر السابق لكل برنامج، ويكتبها في ورقة «التقرير الشهري» و«الملخص الشهري»، ويرسل ملخصًا بالمقارنة.',
    ready: true, events: [], command: '/report', admins: true,
    onTick: function (now, budgetEnd) { return monthlyTick_(now, budgetEnd); },
    onCommand: function (ctx, text) { return reportCommand_(ctx, text); },
    onAdminCallback: function (ctx, data) { return reportCallback_(ctx, data); } },
    certificates: { title: 'الشهادات', desc: 'إصدار شهادات PDF يدويًا من قالب Slides للناجحين.', ready: true, events: [], command: '/cert', admins: true, onCommand: function (ctx, text) { return certCommand_(ctx, text); } },
  miniApp: { title: '📱 التطبيق المصغّر', desc: 'يفتح واجهة كاملة داخل تيليجرام للطالب والمشرف: البرامج والتسليمات والدرجات. إضافة مدفوعة. الأمر: /app.',
    ready: true, events: [], studentHelp: '/app فتح التطبيق',
    onEnable: function () { return miniAppOnEnable_(); },
    onDisable: function () { return miniAppOnDisable_(); } },
  tasks: { title: '✅ المهام', desc: 'قريبًا', ready: false, events: [] },
  tawasul: { title: '📣 التواصل', desc: 'يكتب المشرف المنشور مرة واحدة، ويختار القنوات التي يُنشر فيها، فتنشره الوحدة في موعده وتسجّله في جدول تتبع.', ready: true, events: [], onTick: function (now, budgetEnd) { return tawasulTick_(now, budgetEnd); } }
};

var ADDON_LOCKED_TEXT = '🔒 غير مشمولة في اشتراكك — تواصل معنا';
/** هل سمح مالك المنصة بالوحدة لهذا العميل؟ (t اختياري: العميل الحالي افتراضيًا) */
function isModuleAllowed_(id, t) { t = t || TENANT_; return !!(t && MODULES[id] && (t.addons || []).indexOf(id) >= 0); }
/** المكان الوحيد لفحص التشغيل: منفَّذة + مسموحة للعميل + مفعّلة عنده */
function isModuleActive_(id, t) {
  var m = MODULES[id];
  t = t || TENANT_;
  if (!m || !m.ready || !isModuleAllowed_(id, t)) return false;
  if (TENANT_ && TENANT_.id === t.id) return !!tenantConf_().modules[id];
  return !!withTenant_(t, function () { return tenantConf_().modules[id]; });
}
/** يوقف الوحدة عند العميل الحالي (إعداد + onDisable). البيانات (MOD_<id>) تبقى. يعيد true إن كانت مفعّلة */
function disableModule_(id) {
  var m = MODULES[id], was = !!tenantConf_().modules[id], patch = {};
  if (was) { patch[id] = false; saveTenantConf_({ modules: patch }); }
  if (m && m.onDisable) { try { m.onDisable(); } catch (e) { logError_(e, 'module disable ' + id); } }
  return was;
}
function moduleState_(id) { try { return JSON.parse(prop_('MOD_' + id) || '{}'); } catch (e) { return {}; } }
function saveModuleState_(id, st) { setProp_('MOD_' + id, JSON.stringify(st)); }

function dispatchEvent_(ev) {
  Object.keys(MODULES).forEach(function (id) {
    var m = MODULES[id];
    if (!m.onEvent || m.events.indexOf(ev.type) < 0 || !isModuleActive_(id)) return;
    try { m.onEvent(ev); } catch (e) { logError_(e, 'module ' + id + ' ' + ev.type); }
  });
}

function modulesTick_(now, budgetEnd) {
  Object.keys(MODULES).forEach(function (id) {
    var m = MODULES[id];
    if (!m.onTick || !isModuleActive_(id) || Date.now() > budgetEnd) return;
    try { m.onTick(now, budgetEnd); } catch (e) { logError_(e, 'module tick ' + id); }
  });
}

/* ───────── شاشة «🧩 الوحدات» في البوت الإداري (للمالك) ───────── */
function showModules_(ctx, notice) {
  var conf = tenantConf_();
  var lines = [(notice ? notice + '\n\n' : '') + '🧩 الوحدات الإضافية (كلها موقوفة حتى تفعّلها):'];
  var kb = [];
  lines.push('• 🧮 الحساب التلقائي كل ساعة: ' + (conf.autoCalc ? '🟢 مفعّل' : '⚪️ موقوف'));
  kb.push([{ text: (conf.autoCalc ? '⏸ إيقاف' : '▶️ تفعيل') + ' الحساب التلقائي', callback_data: 'MOD:autoCalc' }]);
  Object.keys(MODULES).forEach(function (id) {
    var m = MODULES[id], on = isModuleActive_(id), allowed = isModuleAllowed_(id);
    if (m.ready && !allowed) { lines.push('• ' + m.title + ': ' + ADDON_LOCKED_TEXT); return; }
    lines.push('• ' + m.title + ': ' + (!m.ready ? '⏳ قريبًا' : on ? '🟢 مفعّلة' : '⚪️ موقوفة') + (m.ready ? '\n  ' + m.desc + (m.command ? ' — الأمر: ' + m.command : '') : ''));
    if (m.ready) kb.push([{ text: (on ? '⏸ إيقاف ' : '▶️ تفعيل ') + m.title, callback_data: 'MOD:' + id }]);
  });
  kb.push([{ text: '🏠 القائمة', callback_data: 'L' }]);
  return show_(ctx, lines.join('\n'), kb);
}

function toggleModule_(ctx, id) {
  if (!ctx.adm.owner) return show_(ctx, '⛔ الوحدات للمالك فقط.', [[{ text: '🏠 القائمة', callback_data: 'L' }]]);
  if (id === 'autoCalc') { var c = tenantConf_(); saveTenantConf_({ autoCalc: !c.autoCalc }); logChange_(ctx.from, '-', 'الوحدات', 'autoCalc', c.autoCalc ? 'إيقاف' : 'تفعيل', '', ''); return showModules_(ctx, '✅ حُفظ.'); }
  var m = MODULES[id];
  if (!m || !m.ready) return showModules_(ctx, '⏳ هذه الوحدة غير متاحة بعد.');
  if (!isModuleAllowed_(id)) return showModules_(ctx, m.title + ': ' + ADDON_LOCKED_TEXT);
  var on = isModuleActive_(id);
  if (on) disableModule_(id);
  else {
    var patch = {}; patch[id] = true; saveTenantConf_({ modules: patch });
    if (m.onEnable) { try { m.onEnable(); } catch (e) { logError_(e, 'module enable ' + id); } }
  }
  logChange_(ctx.from, '-', 'الوحدات', id, on ? 'إيقاف' : 'تفعيل', on ? 'مفعّلة' : 'موقوفة', on ? 'موقوفة' : 'مفعّلة');
  return showModules_(ctx, '✅ ' + m.title + ': ' + (on ? 'أُوقفت' : 'فُعّلت') + '.');
}

/** أمر نصي لوحدة (مثل /quiz) — يعيد undefined إن لم يكن لأي وحدة */
function moduleCommand_(ctx, cmd, text) {
  for (var id in MODULES) {
    var m = MODULES[id];
    if (m.command !== cmd || !m.onCommand) continue;
    if (!ctx.adm.owner && !m.admins) return show_(ctx, '⛔ للمالك فقط.', [[{ text: '🏠 القائمة', callback_data: 'L' }]]) || true;
    if (!isModuleAllowed_(id)) return show_(ctx, m.title + ': ' + ADDON_LOCKED_TEXT, [[{ text: '🏠 القائمة', callback_data: 'L' }]]) || true;
    if (!isModuleActive_(id)) return show_(ctx, m.title + ' موقوفة. فعّلها أولًا من /modules', [[{ text: '🧩 الوحدات', callback_data: 'MOD:' }]]) || true;
    return m.onCommand(ctx, text) || true;
  }
  return undefined;
}

/* ───────── خطافات الوحدات في البوتين (كلها تمر بـ isModuleActive_) ───────── */
/** يستدعي خطافًا لكل وحدة نشطة تملكه؛ يعيد أول نتيجة ليست undefined */
function moduleHook_(hook, args, onlyId) {
  if (!TENANT_ || !(TENANT_.addons || []).length) return undefined; // مسار سريع: عميل بلا إضافات
  for (var id in MODULES) {
    if (onlyId && id !== onlyId) continue;
    var m = MODULES[id];
    if (!m[hook] || !isModuleActive_(id)) continue;
    var r = m[hook].apply(null, args);
    if (r !== undefined) return r;
  }
  return undefined;
}
/** «MX:<id>:<d>» في البوت الإداري */
function moduleCallback_(ctx, arg) {
  var id = arg.split(':')[0], rest = arg.slice(id.length + 1), m = MODULES[id];
  if (!m || !isModuleActive_(id)) return show_(ctx, '⏸ هذه الإضافة غير مفعّلة الآن.', [[{ text: '🏠 القائمة', callback_data: 'L' }]]);
  var r = m.onAdminCallback ? m.onAdminCallback(ctx, rest) : undefined;
  return r === undefined ? show_(ctx, 'زر قديم.', [[{ text: '🏠 القائمة', callback_data: 'L' }]]) : r;
}
/** حالة انتظار الوحدات في البوت الإداري (صورة، رد…) — تُمسح مع أي أمر */
function modWait_(uid) { try { return JSON.parse(cache_().get('mw:' + uid) || 'null'); } catch (e) { return null; } }
function setModWait_(uid, w) { if (w) cache_().put('mw:' + uid, JSON.stringify(w), 3600); else cache_().remove('mw:' + uid); }
/** «mx:<id>:<d>» في بوت الطلاب (خاص أو مجموعة) */
function moduleStudentCallback_(q, data, group) {
  var id = data.split(':')[1], rest = data.slice(3 + id.length + 1);
  var r = moduleHook_(group ? 'onGroupCallback' : 'onStudentCallback', [q, rest], id);
  if (r === undefined) return answerCallback_(q.id, '⏸ هذه الخدمة غير متاحة الآن.', true);
  return r;
}
// ====== Certificates ======
// Manual certificates (module 'certificates'). Admin only, via /cert.
// A certificate is a copy of a Slides template. Placeholders {{الاسم}} {{البرنامج}}
// {{المستوى}} {{التاريخ}} {{الدرجة}} are all optional: only placeholders actually
// present in the template are replaced; a present placeholder with no data is
// replaced with an empty string. The copy is exported as PDF, sent to the student
// with the student bot, recorded in the 'سجل الشهادات' sheet of the program grade
// file, and then deleted (this project keeps no generated files, so nothing is kept).
// NOTE (scope): generation uses SlidesApp, which needs the Slides scope
// (https://www.googleapis.com/auth/presentations). That scope is NOT in
// appsscript.json, and it was deliberately NOT added here: adding a scope forces
// reauthorization and would stall the production hourly trigger. Until the owner
// adds that scope and reauthorizes once, /cert send and /cert sendall fail with a
// clear error; settings and status work without it.

var CERT_LOG_SHEET = 'سجل الشهادات';
var CERT_NL = String.fromCharCode(10);

function certState_() {
  var st = moduleState_('certificates');
  if (!st.templateId) st.templateId = '';
  if (!st.text) st.text = 'مبارك! هذه شهادتك.';
  return st;
}

function certSave_(st) { saveModuleState_('certificates', st); }

function certArgs_(text) {
  var t = str_(text);
  var i = t.indexOf('/cert');
  if (i >= 0) t = t.slice(i + 5);
  if (t.charAt(0) === '@') { var sp = t.indexOf(' '); t = sp < 0 ? '' : t.slice(sp + 1); }
  var parts = t.split(' ');
  var out = [];
  for (var k = 0; k < parts.length; k++) { var p = parts[k].trim(); if (p) out.push(p); }
  return out;
}

function certRest_(text, sub) {
  var t = str_(text);
  var i = t.indexOf('/cert');
  if (i >= 0) t = t.slice(i + 5);
  t = t.trim();
  if (t.charAt(0) === '@') { var sp = t.indexOf(' '); t = sp < 0 ? '' : t.slice(sp + 1); t = t.trim(); }
  if (t.indexOf(sub) === 0) t = t.slice(sub.length);
  return t.trim();
}

function certTemplateId_(raw) {
  var s = str_(raw).trim();
  if (!s) return '';
  var d = s.indexOf('/d/');
  if (d >= 0) {
    var rest = s.slice(d + 3);
    var end = rest.indexOf('/');
    if (end >= 0) rest = rest.slice(0, end);
    var q = rest.indexOf('?');
    if (q >= 0) rest = rest.slice(0, q);
    return rest;
  }
  var idp = s.indexOf('id=');
  if (idp >= 0) {
    var r2 = s.slice(idp + 3);
    var amp = r2.indexOf('&');
    if (amp >= 0) r2 = r2.slice(0, amp);
    return r2;
  }
  return s;
}

function certFill_(text, data) {
  var t = str_(text);
  t = t.split('{{الاسم}}').join(data.name || '');
  t = t.split('{{البرنامج}}').join(data.program || '');
  t = t.split('{{المستوى}}').join(data.level || '');
  t = t.split('{{التاريخ}}').join(data.date || '');
  t = t.split('{{الدرجة}}').join(data.grade || '');
  return t;
}

function certLevelText_(s) {
  var titles = [];
  var levels = s.levels || [];
  for (var i = 0; i < levels.length; i++) if (levels[i] && levels[i].passed) titles.push(levels[i].title);
  return titles.join('، ');
}

function certErr_(e) {
  var m = '';
  try { m = String((e && e.message) || e); } catch (e2) { m = 'خطأ غير معروف'; }
  if (m.indexOf('uthoriz') >= 0 || m.indexOf('ermission') >= 0) return 'يلزم تفعيل نطاق Slides واعادة التفويض للمشروع';
  return m.slice(0, 120);
}

function certHelp_(st) {
  var lines = [];
  lines.push('الشهادات');
  lines.push('القالب: ' + (st.templateId ? st.templateId : 'غير محدد'));
  lines.push('النص المرافق: ' + st.text);
  lines.push('الاوامر:');
  lines.push('/cert template <رابط او معرف قالب Slides>');
  lines.push('/cert text <النص المرافق للشهادة>');
  lines.push('/cert send <programId> <البريد الالكتروني للطالب>');
  lines.push('/cert sendall <programId>');
  lines.push('/cert status');
  lines.push('الاصدار يدوي فقط وللناجحين. sendall يتخطى من صدرت له شهادة من قبل.');
  lines.push('ملاحظة: اصدار الشهادة يتطلب نطاق Slides في المشروع قبل اول استخدام.');
  return lines.join(CERT_NL);
}

function certCommand_(ctx, text) {
  var back = nav_('/modules');
  var st = certState_();
  var a = certArgs_(text);
  var cmd = (a[0] || '').toLowerCase();
  if (!cmd || cmd === 'status' || cmd === 'help') return show_(ctx, certHelp_(st), back);
  if (cmd === 'template') {
    var id = certTemplateId_(certRest_(text, 'template'));
    if (!id) return show_(ctx, 'ارسل رابط القالب او معرفه بعد الامر، مثال: /cert template <رابط>', back);
    var oldTemplateId = st.templateId;
    st.templateId = id;
    certSave_(st);
    logChange_(ctx.from, '-', 'الوحدات', 'certificates', 'قالب الشهادة', oldTemplateId, id);
    return show_(ctx, 'تم حفظ قالب الشهادة.' + CERT_NL + 'المعرف: ' + id, back);
  }
  if (cmd === 'text') {
    var msg = certRest_(text, 'text');
    if (!msg) return show_(ctx, 'ارسل النص بعد الامر، مثال: /cert text مبارك! هذه شهادتك.', back);
    var oldText = st.text;
    st.text = msg;
    certSave_(st);
    logChange_(ctx.from, '-', 'الوحدات', 'certificates', 'نص الشهادة', oldText, msg);
    return show_(ctx, 'تم حفظ النص المرافق للشهادة.', back);
  }
  if (cmd === 'send' || cmd === 'sendall') return certIssueCommand_(ctx, a, st, back);
  return show_(ctx, certHelp_(st), back);
}

function certIssueCommand_(ctx, a, st, back) {
  if (!st.templateId) return show_(ctx, 'حدد قالب الشهادة اولا: /cert template <رابط>', back);
  var pid = a[1];
  if (!pid) return show_(ctx, 'حدد البرنامج: /cert send <programId> <البريد> او /cert sendall <programId>', back);
  var prog = loadProgram_(pid);
  if (!prog) return show_(ctx, 'البرنامج غير موجود: ' + pid, back); 
  if (ctx.adm && !canAccess_(ctx.adm, pid)) return show_(ctx, '⛔ هذا البرنامج غير متاح لك.', back);
  var ss = openSS_(prog.ssId);
  var out = calculateForSpreadsheet(ss, { write: false });
  var students = out.res.students || [];
  var reg = {};
  try { reg = getRegMap_(prog, false).map || {}; } catch (e) { reg = {}; }
  var chats = certChatMap_(prog, ss);
  var issued = certIssuedMap_(ss);
  var dateStr = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
  var targets = [];
  if (a[0] === 'send') {
    var singleEmail = normalizeEmail(a[2] || '');
    if (!singleEmail) return show_(ctx, 'حدد البريد الالكتروني للطالب: /cert send <programId> <البريد>', back);
    var found = null;
    for (var i = 0; i < students.length; i++) if (students[i].email === singleEmail) { found = students[i]; break; }
    if (!found) return show_(ctx, 'الطالب غير موجود في كشف درجات البرنامج: ' + singleEmail, back);
    targets.push(found);
  } else {
    for (var j = 0; j < students.length; j++) {
      var s = students[j];
      if (s.passed && !issued[s.email]) targets.push(s);
    }
  }
  var sent = [];
  var skipped = [];
  for (var k = 0; k < targets.length; k++) {
    var stu = targets[k];
    try {
      sent.push(certIssueOne_(prog, ss, st, stu, reg, chats[stu.email], dateStr));
    } catch (err) {
      skipped.push({ email: stu.email, reason: certErr_(err) });
    }
  }
  var lines = [];
  lines.push('الشهادات - ' + prog.name);
  lines.push('تم الارسال: ' + sent.length);
  lines.push('تم التخطي: ' + skipped.length);
  for (var m = 0; m < sent.length; m++) lines.push('تم: ' + sent[m].name + ' (' + sent[m].email + ')');
  for (var n = 0; n < skipped.length; n++) lines.push('تخطي: ' + skipped[n].email + ' - ' + skipped[n].reason);
  return show_(ctx, lines.join(CERT_NL), back);
}

function certIssueOne_(prog, ss, st, s, reg, chat, dateStr) {
  var regRec = reg[s.email];
  var name = (regRec && regRec.name) || s.name || '';
  if (!name) throw new Error('لا يوجد اسم في التسجيل');
  if (!s.passed) throw new Error('لم يجتز');
  if (!chat) throw new Error('لا يوجد معرف محادثة للطالب');
  var level = certLevelText_(s);
  var grade = (s.final === null || s.final === undefined) ? '' : String(Math.round(s.final * 100) / 100);
  var data = { name: name, program: prog.name, level: level, date: dateStr, grade: grade };
  var pdf = certMakePdf_(st.templateId, data);
  var caption = certFill_(st.text, data);
  var r = tgMultipartAs_('student', 'sendDocument', { chat_id: String(chat), caption: caption, document: pdf });
  if (!r || !r.ok) throw new Error('Telegram: ' + ((r && r.description) || 'فشل ارسال المستند'));
  certLog_(ss, { email: s.email, name: name, program: prog.name, level: level, grade: grade, date: dateStr, link: '' });
  return { email: s.email, name: name };
}

function certMakePdf_(templateId, data) {
  var copy = DriveApp.getFileById(templateId).makeCopy('شهادة - ' + data.name);
  try {
    var pres = SlidesApp.openById(copy.getId());
    pres.replaceAllText('{{الاسم}}', data.name || '');
    pres.replaceAllText('{{البرنامج}}', data.program || '');
    pres.replaceAllText('{{المستوى}}', data.level || '');
    pres.replaceAllText('{{التاريخ}}', data.date || '');
    pres.replaceAllText('{{الدرجة}}', data.grade || '');
    pres.saveAndClose();
    var blob = copy.getAs(MimeType.PDF);
    blob.setName('certificate.pdf');
    return blob;
  } finally {
    try { copy.setTrashed(true); } catch (e) { }
  }
}

function certChatMap_(prog, ss) {
  var out = {};
  try {
    var sh = ss.getSheetByName(NAMES.SUBMISSIONS);
    if (sh) {
      var subs = remSubsIndex_(sh.getDataRange().getValues());
      for (var e in subs) if (subs[e] && subs[e].chat) out[e] = subs[e].chat;
    }
  } catch (e1) { }
  try {
    var rows = remValues_(BOT.USERS).slice(1);
    for (var i = 0; i < rows.length; i++) {
      var em = normalizeEmail(rows[i][1]);
      var uid = str_(rows[i][0]);
      if (em && uid && !out[em]) out[em] = uid;
    }
  } catch (e2) { }
  return out;
}

function certIssuedMap_(ss) {
  var out = {};
  var sh = ss.getSheetByName(CERT_LOG_SHEET);
  if (!sh) return out;
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) { var em = normalizeEmail(vals[i][0]); if (em) out[em] = true; }
  return out;
}

function certLog_(ss, rec) {
  var lock = tenantLock_();
  lock.waitLock(30000);
  try {
    var sh = ss.getSheetByName(CERT_LOG_SHEET);
    if (!sh) {
      sh = ss.insertSheet(CERT_LOG_SHEET);
      sh.appendRow(['البريد الإلكتروني', 'الاسم', 'البرنامج', 'المستوى', 'الدرجة', 'التاريخ', 'رابط الملف']);
      sh.setFrozenRows(1);
    }
    sh.appendRow([rec.email, rec.name, rec.program, rec.level, rec.grade, rec.date, rec.link || '']);
  } finally {
    lock.releaseLock();
  }
}

// Editor entry point for the certificates self-check.
function certVerify() { return certSelfCheck_(); }

function certSelfCheck_() {
  var m = MODULES.certificates;
  return { ok: !!(m && m.ready && m.command === '/cert'), command: m ? m.command : '', title: m ? m.title : '' };
}

  

function moduleStudentHelp_() {
  if (!TENANT_ || !(TENANT_.addons || []).length) return '';
  var out = [];
  for (var id in MODULES) if (MODULES[id].studentHelp && isModuleActive_(id)) out.push(MODULES[id].studentHelp);
  return out.length ? '\n' + out.join('\n') : '';
}