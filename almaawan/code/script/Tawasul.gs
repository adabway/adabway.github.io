/**
 * وحدة «التواصل» — أتمتة النشر (الخطوة 1: تيليجرام) — مسودة كود (Tawasul.gs) — 26 نوفمبر 2026
 * تُنسخ إلى ملف جديد Tawasul.gs في مشروع «Adab SaaS Platform»، ثم تُنشر v42.
 *
 * التصميم (الموحّد المعتمَد، workspace/adabway-server/tawasul-module-design.md):
 * - الناشر تيليجرام أولًا؛ فيسبوك وإنستغرام خطوتان لاحقتان (لا كود لهما هنا).
 * - الاسم «التواصل» مثبَّت بقرار M (رسالة 1078)؛ نافذة الفائت 6 ساعات كالورد اليومي (رسالة 1078).
 * - بوت النشر: بوت الطلاب (المقترح في التصميم §11-2 — لم يُحسم ببوت مستقل، فالافتراضي بوت الطلاب).
 * - الدقة بالساعة في النسخة الدنيا (دورة المشغّل الساعي القائمة)؛ تُذكر للمشرف في الواجهة.
 * - الورقتان في ملف تحكم العميل (central_())، لا في ملف برنامج؛ والبطاقة في «المزيد» (مستوى البرنامج
 *   في الواجهة، والبيانات على مستوى العميل — قرار البناء لما تركه التصميم §5-2 مفتوحًا).
 * - لا يُمسّ dailyWird ولا wirdTick_ ولا الاستيراد؛ test2 فقط؛ adab10 خارج كل تجريب.
 *
 * تصحيحات لمسودة التصميم §10-1 (من القراءة الحرفية للكود الحي v41):
 *  C1) `tokenFor_(tid, 'student')` في المسودة خطأ: tokenFor_ يأخذ (role) فقط، ولا دور 'student'
 *      أصلًا — الدور يسقط على الفرع الافتراضي فيعيد BOT_TOKEN (توكن بوت الطلاب/الموحّد). هنا
 *      تُستدعى `tokenFor_('student')` بوسيط واحد، وبلا tid أصلًا (سياق TENANT_ مضبوط من
 *      withTenant_ في المشغّل ومن موجّه التطبيق المصغّر في الإجراءات).
 *  C2) لا تعديل في centralTick_ نفسها: إدخال `tawasul` في MODULES بـ onTick يكفي —
 *      modulesTick_ (Part2.gs:3757) تستدعيه تلقائيًا لكل عميل مفعّلة عنده الوحدة.
 *  C3) «سجل الأحداث» في التصميم = ورقة «سجل الأحداث» (EVENTS.SHEET) عبر emitEvent_،
 *      و«سجل التعديلات» عبر logChange_ (Part1.gs:2054) — يُستعمل كلاهما في موضعه.
 *  C4) الوسائط في الخطوة 1 بمعرّف file_id يُلصق في النموذج (لا مسار رفع عبر بوت الإدارة بعد —
 *      مؤجَّل)؛ والنص بلا parse_mode (نص عادي) في v1.
 *  C5) لا تغيير في الـWorker: إجراءات الوحدة عبر api() إلى السكربت مباشرة، كـ addStudent والمنسّق
 *      (fastCall محصور في toggleOpen/pause/resume). التنبيهات من مسار المشغّل فقط؛
 *      النشر الفوري يعرض نتائجه في الواجهة مباشرة فلا تنبيه إضافي.
 *
 * تحريرات ملفات قائمة (تُنفذ مع اللصق، في المهمة نفسها):
 *  E-T0) Part2.gs MODULES بعد إدخال tasks: إدخال tawasul (title/desc/ready/onTick).
 *  E-T1) Part3.gs TENANT_CONF_DEFAULTS modules: إضافة `tawasul: false`.
 *  E-T2) Part2.gs handleMiniAppAdmin_ بعد سطر wirdDeleteMaterial: سبعة أسطر توجيه
 *         (tawasulChannels/tawasulAddChannel/tawasulToggleChannel/tawasulRemoveChannel/
 *          tawasulPosts/tawasulCreatePost/tawasulRepost).
 *  E-T3) Part2.gs EVENT_TYPES: إضافة `TAWASUL_POSTED: 'tawasul_posted'`.
 *  E-T4) Part2.gs miniAppAdminBootstrap_: إضافة `tawasulActive: isModuleActive_('tawasul'),`
 *         بعد سطر qaActive (لبوابة البطاقة في الواجهة).
 *  E-T5) التطبيق المصغّر (مواصفات الواجهة في tawasul-build-notes.md): بطاقة «📣 التواصل»
 *         في renderAdminMore بعد بطاقة المنسّق، + `admin.tawasul = null` في bindPid.
 *  E-T6) المنح للعميل التجريبي من بوت المنصة (خطوة حية، بيد M): `/addon test2 +tawasul`
 *         (المنح يفعّل الوحدة تلقائيًا عند العميل — Part4.gs:615).
 */

var TAWASUL = {
  CHANNELS: 'قنوات النشر',
  POSTS: 'سجل منشورات التواصل',
  LATE_HOURS: 6,            // نافذة الفائت (قرار M، رسالة 1078) — كـ WIRD.LATE_H
  TEXT: 4096,               // حد نص تيليجرام
  CAPTION: 1024,            // حد التعليق على الوسائط
  VERIFY_STALE_DAYS: 7,     // إعادة التحقق من إشراف البوت إن مرّت هذه المدة
  POSTS_LIST_N: 20           // عدد المنشورات المعروضة في البطاقة
};
var TAWASUL_CHANNEL_HEADERS = ['المنصة', 'معرّف القناة', 'الاسم', 'اسم المستخدم', 'أضافها', 'أُضيفت في', 'نشطة', 'آخر تحقق'];
var TAWASUL_POST_HEADERS = ['معرّف المنشور', 'أنشأه', 'أُنشئ في', 'البرنامج', 'النص', 'نوع الوسائط', 'معرّف الوسائط', 'الوجهات', 'موعد النشر', 'الحالة', 'النتائج', 'المنشور الأصل'];
var TAWASUL_STATUS = { SCHEDULED: 'مجدول', PARTIAL: 'نُشر جزئيًا', PUBLISHED: 'نُشر', FAILED: 'فشل', MISSED: 'فائت' };

/* ───────── استدعاء Bot API بتوكن بوت الطلاب ───────── */
// إعادة المحاولة عند 429 مرة واحدة فقط كحدّ أقصى — يوقفها العدّاد attempt.
// (C1: بلا tid؛ السياق TENANT_ مضبوط من المتصل. النوم مقيّد بـ 60 ثانية حتى لا تتجاوز
//  دورة المشغّل ميزانيتها مهما كان retry_after.)
function tawasulTg_(method, payload, attempt) {
  attempt = attempt || 0;
  var token = tokenFor_('student'); // الفرع الافتراضي: BOT_TOKEN للعميل الحالي
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  var out;
  try { out = JSON.parse(res.getContentText()); }
  catch (e) { return { ok: false, description: 'رد غير مفهوم من تيليجرام' }; }
  if (!out.ok && out.parameters && out.parameters.retry_after && attempt < 1) {
    Utilities.sleep(Math.min(Number(out.parameters.retry_after) || 1, 60) * 1000);
    return tawasulTg_(method, payload, attempt + 1); // إعادة واحدة فقط، ثم يُسجَّل الفشل
  }
  return out;
}

/** تنبيه مالك العميل من بوت الإدارة (مسار المشغّل فقط) */
function tawasulAlert_(text) {
  if (!ownerId_()) return;
  try { tgAs_('admin', 'sendMessage', { chat_id: ownerId_(), text: text, disable_web_page_preview: true }, true); } catch (e) { logError_(e, 'tawasul alert'); }
}

/* ───────── الورقتان (ملف تحكم العميل — إنشاء كسول كـ wirdLog_) ───────── */
function tawasulChannelsSheet_() {
  var ss = central_(), sh = ss.getSheetByName(TAWASUL.CHANNELS);
  if (!sh) {
    sh = ss.insertSheet(TAWASUL.CHANNELS);
    sh.getRange(1, 1, 1, TAWASUL_CHANNEL_HEADERS.length).setValues([TAWASUL_CHANNEL_HEADERS]);
    try { sh.setFrozenRows(1); sh.setRightToLeft(true); } catch (e) { /* تجاهل */ }
  }
  return sh;
}
function tawasulPostsSheet_() {
  var ss = central_(), sh = ss.getSheetByName(TAWASUL.POSTS);
  if (!sh) {
    sh = ss.insertSheet(TAWASUL.POSTS);
    sh.getRange(1, 1, 1, TAWASUL_POST_HEADERS.length).setValues([TAWASUL_POST_HEADERS]);
    try { sh.setFrozenRows(1); sh.setRightToLeft(true); } catch (e) { /* تجاهل */ }
  }
  return sh;
}

/** قنوات العميل: [{row, platform, channelId, title, username, addedBy, addedAt, active, verifiedAt}] */
function tawasulReadChannels_() {
  var sh = tawasulChannelsSheet_();
  if (sh.getLastRow() < 2) return [];
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, TAWASUL_CHANNEL_HEADERS.length).getValues(), out = [];
  vals.forEach(function (r, i) {
    if (!str_(r[1])) return;
    out.push({ row: i + 2, platform: str_(r[0]) || 'telegram', channelId: str_(r[1]), title: str_(r[2]), username: str_(r[3]), addedBy: str_(r[4]), addedAt: r[5], active: isYes_(r[6]), verifiedAt: r[7] });
  });
  return out;
}

/** منشورات العميل: [{row, id, createdBy, createdAt, programId, text, mediaType, mediaFileId, destinations[], scheduledAt, status, results[], sourcePost}] */
function tawasulReadPosts_() {
  var sh = tawasulPostsSheet_();
  if (sh.getLastRow() < 2) return [];
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, TAWASUL_POST_HEADERS.length).getValues(), out = [];
  vals.forEach(function (r, i) {
    if (!str_(r[0])) return;
    var dests = [], results = [], src = null;
    try { dests = JSON.parse(str_(r[7]) || '[]'); } catch (e) { dests = []; }
    try { results = JSON.parse(str_(r[10]) || '[]'); } catch (e) { results = []; }
    try { src = JSON.parse(str_(r[11]) || 'null'); } catch (e) { src = null; }
    if (!Array.isArray(dests)) dests = [];
    if (!Array.isArray(results)) results = [];
    out.push({ row: i + 2, id: str_(r[0]), createdBy: str_(r[1]), createdAt: r[2], programId: str_(r[3]), text: str_(r[4]), mediaType: str_(r[5]), mediaFileId: str_(r[6]), destinations: dests, scheduledAt: r[8], status: str_(r[9]), results: results, sourcePost: src });
  });
  return out;
}

/** كتابة الحالة والنتائج في صف منشور (العمودان 10 و11) — تُستدعى بعد كل وجهة (منع التكرار) */
function tawasulWritePostResult_(post) {
  var sh = tawasulPostsSheet_();
  sh.getRange(post.row, 10, 1, 2).setValues([[post.status, JSON.stringify(post.results || [])]]);
}

/** رابط المنشور المنشور (للعرض في البطاقة) */
function tawasulPostLink_(username, channelId, messageId) {
  if (!messageId) return '';
  if (username) return 'https://t.me/' + String(username).replace(/^@/, '') + '/' + messageId;
  var id = String(channelId || '');
  if (id.indexOf('-100') === 0) return 'https://t.me/c/' + id.slice(4) + '/' + messageId;
  return '';
}

/* ───────── تحليل مدخلات القنوات والروابط ───────── */
/** يقبل: -100... أو رقمًا داخليًا مجردًا (من رابط t.me/c/) أو @اسم أو رابط t.me/اسم أو t.me/c/داخلي — يعيد ما يُمرَّر لـ getChat (رقم أو @اسم) */
function tawasulResolveChatRef_(input) {
  var s = str_(input);
  if (!s) return null;
  var m = s.match(/t\.me\/c\/(\d+)/);
  if (m) return '-100' + m[1]; // قناة خاصة: معرّفها الكامل سالب بـ -100
  m = s.match(/t\.me\/([A-Za-z0-9_]+)/);
  if (m) {
    if (/^\d+$/.test(m[1])) return '-100' + m[1]; // t.me/رقم داخلي
    return m[1].charAt(0) === '@' ? m[1] : '@' + m[1];
  }
  if (/^-\d+$/.test(s)) return s; // معرّف كامل -100…
  if (/^\d+$/.test(s)) return '-100' + s; // رقم داخلي مجرد — معرّف القناة الكامل سالب بـ -100 (الرقم الموجب وحده عند تيليجرام معرّف مستخدم، لا قناة)
  if (/^@?[A-Za-z0-9_]{5,}$/.test(s)) return s.charAt(0) === '@' ? s : '@' + s;
  return null;
}
/** رابط منشور t.me/c/<داخلي>/<رقم> أو t.me/<اسم>/<رقم> → {chatId, messageId} */
function tawasulParsePostLink_(link) {
  var s = str_(link);
  var m = s.match(/t\.me\/c\/(\d+)\/(\d+)/);
  if (m) return { chatId: '-100' + m[1], messageId: Number(m[2]) };
  m = s.match(/t\.me\/([A-Za-z0-9_]+)\/(\d+)/);
  if (m) return { chatId: '@' + m[1], messageId: Number(m[2]) };
  return null;
}

/* ───────── معرّف الوسائط (file_id) ───────── */
/** استخراج معرّف الوسائط من رسالة: صورة (أكبر مقاس) أو فيديو أو ملف — يعيد {kind, fileId} أو null */
function tawasulMediaFileId_(m) {
  if (!m) return null;
  if (m.photo && m.photo.length) {
    var ph = m.photo[m.photo.length - 1];
    return { kind: 'صورة', fileId: ph.file_id };
  }
  if (m.video) return { kind: 'فيديو', fileId: m.video.file_id };
  if (m.document) return { kind: 'ملف', fileId: m.document.file_id };
  return null;
}

/**
 * إن كانت رسالة المشرف تحمل وسائط (صورة/فيديو/ملف): ردّ بمعرّفها في كتلة <pre>
 * (زر نسخ) للصقه في حقل «معرّف الوسائط» ببطاقة التواصل. يعيد true إن عالج الرسالة.
 * يعمل فقط عندما يكون البوت الحالي هو بوت النشر نفسه (الدور unified) — لأن المعرّف
 * خاص بكل بوت، فمعرّف بوت آخر لا يصلح للنشر به.
 */
function tawasulEchoMediaFileId_(ctx, m) {
  if (!m || !ctx || !ctx.chat || typeof BOT_ROLE === 'undefined' || BOT_ROLE !== 'unified') return false;
  var f = tawasulMediaFileId_(m);
  if (!f) return false;
  var label = '📎 معرّف الوسائط (' + f.kind + ') — انسخه من الكتلة التالية والصقه في حقل «معرّف الوسائط file_id» في بطاقة «📣 التواصل»:\n<pre>' + f.fileId + '</pre>\n(هذا المعرّف خاص بهذا البوت، ويعمل للنشر به فقط.)';
  tg_('sendMessage', { chat_id: ctx.chat, text: label, parse_mode: 'HTML' });
  return true;
}

/* ───────── القنوات ───────── */
/** التحقق الفوري: القناة موجودة والبوت مشرف فيها بصلاحية النشر. يعيد {ok, id, title, username} أو {ok:false, error} */
function tawasulVerifyAdmin_(chatRef) {
  var chat = tawasulTg_('getChat', { chat_id: chatRef });
  if (!chat.ok) return { ok: false, permanent: tawasulIsPermanentError_(chat), error: 'القناة أو المجموعة غير موجودة أو البوت ليس عضوًا فيها' + (chat.description ? ' (' + chat.description + ')' : '') };
  var me = tawasulTg_('getMe', {});
  if (!me.ok) return { ok: false, permanent: false, error: 'تعذّر معرفة معرّف البوت (getMe)' };
  var member = tawasulTg_('getChatMember', { chat_id: chat.result.id, user_id: me.result.id });
  if (!member.ok) return { ok: false, permanent: tawasulIsPermanentError_(member), error: 'تعذّر التحقق من إشراف البوت' + (member.description ? ' (' + member.description + ')' : '') };
  if (member.result.status !== 'administrator' || member.result.can_post_messages === false)
    return { ok: false, permanent: true, error: 'البوت ليس مشرفًا بصلاحية النشر في القناة أو المجموعة — أضفه مشرفًا بصلاحية النشر أولًا' };
  return { ok: true, id: String(chat.result.id), title: str_(chat.result.title), username: str_(chat.result.username) };
}

/** خطأ تيليجرام دائم (القناة محذوفة/البوت مطرود) أم عابر (شبكة/حدّ/عطل)؟ العابر لا يوقف القناة أبدًا. */
function tawasulIsPermanentError_(out) {
  if (!out) return false;
  var code = Number(out.error_code || 0);
  if (code === 400 || code === 403) return true;
  if (code === 429 || code >= 500) return false;
  var d = String(out.description || '').toLowerCase();
  if (/chat not found|bot was kicked|bot is not a member|forbidden|user not found|chat_id is empty/i.test(d)) return true;
  return false;
}

/** إضافة قناة (أو تحديثها إن كانت موجودة): تحقق ثم إلحاق/تحديث صف. يعيد {ok, channel, existed} أو {ok:false, error} */
function tawasulAddChannel_(chatInput, addedBy) {
  var ref = tawasulResolveChatRef_(chatInput);
  if (!ref) return { ok: false, error: 'معرّف القناة غير مفهوم — الصق رقمها (-100…) أو اسمها (@…) أو رابطها.' };
  var v = tawasulVerifyAdmin_(ref);
  if (!v.ok && /^\d+$/.test(str_(chatInput))) {
    // الرقم المجرّد قد يكون مجموعة عادية (معرّفها سالب بلا -100) لا قناة/مجموعة خارقة
    var v2 = tawasulVerifyAdmin_('-' + str_(chatInput));
    if (v2.ok) v = v2;
  }
  if (!v.ok) return v;
  var sh = tawasulChannelsSheet_(), chans = tawasulReadChannels_(), now = new Date();
  for (var i = 0; i < chans.length; i++) {
    if (chans[i].channelId === v.id) {
      sh.getRange(chans[i].row, 1, 1, 8).setValues([['telegram', v.id, v.title, v.username, str_(addedBy), chans[i].addedAt || now, 'نعم', now]]);
      return { ok: true, existed: true, channel: { channelId: v.id, title: v.title, username: v.username, active: true } };
    }
  }
  sh.appendRow(['telegram', v.id, v.title, v.username, str_(addedBy), now, 'نعم', now]);
  return { ok: true, existed: false, channel: { channelId: v.id, title: v.title, username: v.username, active: true } };
}

/** تفعيل/إيقاف قناة (مالك العميل وحده — يُفحص في الإجراء) */
function tawasulSetChannelActive_(channelId, active) {
  var chans = tawasulReadChannels_();
  for (var i = 0; i < chans.length; i++) {
    if (chans[i].channelId === String(channelId)) {
      tawasulChannelsSheet_().getRange(chans[i].row, 7, 1, 1).setValues([[active ? 'نعم' : 'لا']]);
      return { ok: true, channel: chans[i] };
    }
  }
  return { ok: false, error: 'القناة غير موجودة في القائمة.' };
}

/** حذف قناة من القائمة (لا يحذف منشوراتها المنشورة) */
function tawasulRemoveChannel_(channelId) {
  var chans = tawasulReadChannels_();
  for (var i = 0; i < chans.length; i++) {
    if (chans[i].channelId === String(channelId)) {
      tawasulChannelsSheet_().deleteRow(chans[i].row);
      return { ok: true, channel: chans[i] };
    }
  }
  return { ok: false, error: 'القناة غير موجودة في القائمة.' };
}

/** إعادة التحقق الكسول: إن مرّت VERIFY_STALE_DAYS على آخر تحقق ناجح، يُعاد فحص الإشراف قبل النشر فيها */
function tawasulEnsureChannelVerified_(ch) {
  var last = dateValue_(ch.verifiedAt);
  if (last && Date.now() - last < TAWASUL.VERIFY_STALE_DAYS * 86400000) return { ok: true };
  var v = tawasulVerifyAdmin_(ch.channelId);
  var sh = tawasulChannelsSheet_();
  if (v.ok) {
    sh.getRange(ch.row, 3, 1, 2).setValues([[v.title, v.username]]);
    sh.getRange(ch.row, 8, 1, 1).setValues([[new Date()]]);
    ch.title = v.title; ch.username = v.username; ch.verifiedAt = new Date();
    return { ok: true };
  }
  if (v.permanent) {
    sh.getRange(ch.row, 7, 1, 1).setValues([['لا']]);
    ch.active = false;
  }
  return { ok: false, error: v.error };
}

/* ───────── المنشورات ───────── */
function tawasulNewPostId_() {
  return 'tw-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

/** التحقق من نص المنشور قبل أي إرسال (في الإنشاء وفي النشر — دفاع مزدوج) */
function tawasulCheckText_(text, mediaType) {
  var limit = mediaType ? TAWASUL.CAPTION : TAWASUL.TEXT;
  if (!str_(text)) return { ok: false, error: 'نص المنشور فارغ.' };
  if (str_(text).length > limit) return { ok: false, error: 'النص أطول من الحد المسموح (' + limit + ' حرفًا) — قصّره قبل النشر.' };
  return { ok: true };
}

/** إنشاء صف منشور (إلحاق فقط، لا استبدال). o: {text, mediaType, mediaFileId, destIds[], scheduledAt(ms|null), programId, createdBy, sourcePost} */
function tawasulCreatePost_(o) {
  var chk = tawasulCheckText_(o.text, o.mediaType);
  if (!chk.ok) return chk;
  var mt = str_(o.mediaType || '');
  if (mt && ['photo', 'video', 'document'].indexOf(mt) < 0) return { ok: false, error: 'نوع الوسائط غير معروف.' };
  if (mt && !str_(o.mediaFileId)) return { ok: false, error: 'نوع الوسائط محدد بلا معرّف ملف (file_id).' };
  if (!o.destIds || !o.destIds.length) return { ok: false, error: 'اختر قناة واحدة على الأقل.' };
  var chans = tawasulReadChannels_(), byId = {};
  chans.forEach(function (c) { byId[c.channelId] = c; });
  var dests = [], seen = {};
  for (var i = 0; i < o.destIds.length; i++) {
    var c = byId[String(o.destIds[i])];
    if (!c) return { ok: false, error: 'قناة غير موجودة في القائمة: ' + o.destIds[i] };
    if (!c.active) return { ok: false, error: 'القناة «' + (c.title || c.channelId) + '» موقوفة — فعّلها أولًا.' };
    if (seen[c.channelId]) continue; // وجهة مكررة — تُحفظ مرة واحدة
    seen[c.channelId] = true;
    dests.push({ platform: 'telegram', channel_id: c.channelId });
  }
  var sched = o.scheduledAt ? new Date(o.scheduledAt) : null;
  if (sched && isNaN(sched.getTime())) return { ok: false, error: 'موعد النشر غير مفهوم.' };
  var id = tawasulNewPostId_(), now = new Date();
  var row = [id, str_(o.createdBy), now, str_(o.programId || ''), str_(o.text), mt, str_(o.mediaFileId || ''), JSON.stringify(dests), sched || '', TAWASUL_STATUS.SCHEDULED, '[]', o.sourcePost ? JSON.stringify(o.sourcePost) : ''];
  tawasulPostsSheet_().appendRow(row);
  var posts = tawasulReadPosts_(), post = null;
  posts.forEach(function (p) { if (p.id === id) post = p; });
  if (!post) return { ok: false, error: 'تعذّر قراءة المنشور بعد إنشائه.' };
  return { ok: true, post: post };
}

/** نشر منشور في قناة واحدة (لا يكتب في الورقة — المتصل يكتب النتيجة فورًا). يعيد {channel_id, status, message_id?, error?} */
function tawasulPublishOne_(post, channelId) {
  var chk = tawasulCheckText_(post.text, post.mediaType);
  if (!chk.ok) return { channel_id: String(channelId), status: 'فشل', error: chk.error };
  var payload = { chat_id: channelId };
  var method = 'sendMessage';
  if (post.mediaType === 'photo') { method = 'sendPhoto'; payload.photo = post.mediaFileId; payload.caption = post.text; }
  else if (post.mediaType === 'video') { method = 'sendVideo'; payload.video = post.mediaFileId; payload.caption = post.text; }
  else if (post.mediaType === 'document') { method = 'sendDocument'; payload.document = post.mediaFileId; payload.caption = post.text; }
  else { payload.text = post.text; }
  var out = tawasulTg_(method, payload);
  return out.ok
    ? { channel_id: String(channelId), status: 'نُشر', message_id: out.result.message_id, published_at: new Date().toISOString() }
    : { channel_id: String(channelId), status: 'فشل', error: (out.description || 'خطأ غير معروف') };
}

/** حالة المنشور الإجمالية من نتائج وجهاته — تُقاس بالوجهات الفريدة (فالمكررة لا تُبقي المنشور جزئيًا). */
function tawasulAggregateStatus_(results, dests) {
  if (!results.length) return TAWASUL_STATUS.SCHEDULED;
  var uniqDests = {}, uniqDone = {};
  dests.forEach(function (d) { uniqDests[String(d.channel_id)] = 1; });
  results.forEach(function (r) { if (r.status === 'نُشر') uniqDone[String(r.channel_id)] = 1; });
  var nDest = Object.keys(uniqDests).length, nDone = Object.keys(uniqDone).length;
  if (nDest > 0 && nDone === nDest) return TAWASUL_STATUS.PUBLISHED;
  if (nDone > 0) return TAWASUL_STATUS.PARTIAL;
  return TAWASUL_STATUS.FAILED;
}

/**
 * نشر منشور في وجهاته غير المنشورة، مع كتابة كل نتيجة فور نجاحها (منع التكرار عند إعادة التشغيل).
 * يعيد المنشور بعد تحديث حالته ونتائجه في الورقة.
 */
function tawasulPublishPost_(post) {
  var chans = tawasulReadChannels_(), byId = {};
  chans.forEach(function (c) { byId[c.channelId] = c; });
  var doneIds = {};
  (post.results || []).forEach(function (r) { if (r.status === 'نُشر') doneIds[String(r.channel_id)] = 1; });
  post.destinations.forEach(function (d) {
    if (doneIds[String(d.channel_id)]) return; // نُشرت من قبل — لا إعادة
    var ch = byId[String(d.channel_id)];
    if (!ch || !ch.active) {
      post.results.push({ platform: d.platform, channel_id: String(d.channel_id), status: 'فشل', error: 'القناة غير موجودة أو موقوفة.' });
    } else {
      var v = tawasulEnsureChannelVerified_(ch);
      if (!v.ok) {
        post.results.push({ platform: d.platform, channel_id: String(d.channel_id), status: 'فشل', error: v.error });
      } else {
        post.results.push(tawasulPublishOne_(post, d.channel_id));
      }
    }
    post.status = tawasulAggregateStatus_(post.results, post.destinations);
    tawasulWritePostResult_(post); // كتابة فورية بعد كل وجهة
  });
  post.status = tawasulAggregateStatus_(post.results, post.destinations);
  tawasulWritePostResult_(post);
  return post;
}

/** تحويل/نسخ منشور سابق إلى قنوات أخرى (يعمل مع منشورات الوحدة وغيرها). */
function tawasulRepost_(srcChatId, srcMessageId, destChannelIds, asCopy) {
  return destChannelIds.map(function (destId) {
    var out = tawasulTg_(asCopy ? 'copyMessage' : 'forwardMessage',
      { chat_id: destId, from_chat_id: srcChatId, message_id: srcMessageId });
    return out.ok
      ? { channel_id: String(destId), status: 'نُشر', message_id: out.result.message_id, published_at: new Date().toISOString() }
      : { channel_id: String(destId), status: 'فشل', error: out.description || 'خطأ غير معروف' };
  });
}

/** نشر منشور محوَّل فورًا وتسجيله كمنشور جديد بحقل source_post */
function tawasulCreateRepost_(o) {
  var dests = (o.destIds || []).map(function (id) { return { platform: 'telegram', channel_id: String(id) }; });
  if (!dests.length) return { ok: false, error: 'اختر قناة واحدة على الأقل.' };
  var chans = tawasulReadChannels_(), byId = {};
  chans.forEach(function (c) { byId[c.channelId] = c; });
  for (var i = 0; i < dests.length; i++) {
    var c = byId[dests[i].channel_id];
    if (!c) return { ok: false, error: 'قناة غير موجودة في القائمة: ' + dests[i].channel_id };
    if (!c.active) return { ok: false, error: 'القناة «' + (c.title || c.channel_id) + '» موقوفة — فعّلها أولًا.' };
  }
  var created = tawasulCreatePost_({ text: '↩️ منشور محوَّل', mediaType: '', mediaFileId: '', destIds: o.destIds, scheduledAt: null, programId: o.programId, createdBy: o.createdBy, sourcePost: { chat_id: String(o.srcChatId), message_id: o.srcMessageId } });
  if (!created.ok) return created;
  var post = created.post;
  post.results = tawasulRepost_(o.srcChatId, o.srcMessageId, o.destIds, o.asCopy !== false);
  post.status = tawasulAggregateStatus_(post.results, post.destinations);
  tawasulWritePostResult_(post);
  return { ok: true, post: post };
}

/* ───────── المشغّل الساعي (يُستدعى من modulesTick_ عبر MODULES.tawasul.onTick) ───────── */
/**
 * ينشر ما حان موعده من المنشورات المجدولة؛ وما فات موعده أكثر من LATE_HOURS يُسجَّل «فائت»
 * ولا يُنشر أبدًا (قرار M). التنبيه للمالك مرة واحدة عند كل انتقال (فائت/فشل/نشر جزئي).
 * القفل يمنع النشر المزدوج إن تداخلت دورتان؛ والكتابة الفورية بعد كل وجهة تمنع التكرار
 * إن أُعيد التشغيل في منتصف النشر.
 */
function tawasulTick_(now, budgetEnd) {
  var posts = tawasulReadPosts_().filter(function (p) { return p.status === TAWASUL_STATUS.SCHEDULED && p.scheduledAt; });
  if (!posts.length) return [];
  posts.sort(function (a, b) { return dateValue_(a.scheduledAt) - dateValue_(b.scheduledAt); });
  var lock = tenantLock_();
  if (!lock.tryLock(5000)) return [];
  var out = [];
  try {
    posts = tawasulReadPosts_().filter(function (p) { return p.status === TAWASUL_STATUS.SCHEDULED && p.scheduledAt; });
    posts.sort(function (a, b) { return dateValue_(a.scheduledAt) - dateValue_(b.scheduledAt); });
    for (var i = 0; i < posts.length; i++) {
      if (Date.now() > budgetEnd - 15000) { out.push('budget'); break; }
      var post = posts[i], at = dateValue_(post.scheduledAt);
      if (at == null || at === undefined) continue;
      if (now < at) continue; // لم يحن موعده بعد (الدقة بالساعة: يُنشر في أول دورة بعد موعده)
      if (now - at > TAWASUL.LATE_HOURS * 3600000) {
        post.status = TAWASUL_STATUS.MISSED;
        tawasulWritePostResult_(post);
        tawasulAlert_('⚠️ فات موعد منشور التواصل «' + (post.text || '').slice(0, 60) + '» بأكثر من ' + TAWASUL.LATE_HOURS + ' ساعات — سُجّل «فائت» ولم يُنشر.');
        out.push(post.id + ':missed');
        continue;
      }
      try {
        var before = post.results.length;
        tawasulPublishPost_(post);
        if (post.status === TAWASUL_STATUS.PUBLISHED || post.status === TAWASUL_STATUS.PARTIAL) {
          emitEvent_(EVENT_TYPES.TAWASUL_POSTED, post.programId, { post: post.id, status: post.status, channels: post.results.filter(function (r) { return r.status === 'نُشر'; }).map(function (r) { return { ch: r.channel_id, mid: r.message_id }; }) }, 'tick');
        }
        if (post.status === TAWASUL_STATUS.FAILED || post.status === TAWASUL_STATUS.PARTIAL) {
          var fails = post.results.filter(function (r) { return r.status === 'فشل'; }).map(function (r) { return r.channel_id + ': ' + (r.error || ''); }).join('؛ ');
          tawasulAlert_('⚠️ تعذّر نشر منشور التواصل «' + (post.text || '').slice(0, 60) + '» كاملًا (' + post.status + '): ' + fails);
        }
        out.push(post.id + ':' + post.status);
      } catch (e) {
        logError_(e, 'tawasul tick ' + post.id);
        out.push(post.id + ':error');
      }
    }
    return out;
  } finally { lock.releaseLock(); }
}

/* ───────── إجراءات التطبيق المصغّر (مشرف) ───────── */
/** بوابة الوحدة: مفعّلة ومسموحة للعميل، وإلا رسالة ودّية (البطاقة مخفية أصلًا حين تكون موقوفة) */
function tawasulGuard_() {
  if (!isModuleActive_('tawasul')) return { ok: false, error: 'module_off', message: 'وحدة «التواصل» موقوفة — فعّلها من «🧩 الوحدات» أولًا.' };
  return { ok: true };
}

/** عرض البطاقة: القنوات + آخر المنشورات (مع روابط المنشورات المنشورة) */
function miniAppAdminTawasulChannels_(session, body) {
  var g = tawasulGuard_(); if (!g.ok) return g;
  var acc = miniAppAdminNeed_(session, body.pid);
  if (!acc.ok) return { ok: false, error: acc.error, message: acc.message };
  var chans = tawasulReadChannels_().map(function (c) {
    return { channelId: c.channelId, title: c.title, username: c.username, active: c.active, verifiedAt: c.verifiedAt ? fmtTime(c.verifiedAt) : '' };
  });
  var posts = tawasulReadPosts_().slice(-TAWASUL.POSTS_LIST_N).reverse().map(function (p) {
    return {
      id: p.id, text: (p.text || '').slice(0, 200), programId: p.programId, status: p.status,
      scheduledAt: p.scheduledAt ? fmtTime(p.scheduledAt) : '', createdAt: p.createdAt ? fmtTime(p.createdAt) : '',
      sourcePost: p.sourcePost,
      destinations: p.destinations.map(function (d) {
        var r = null;
        (p.results || []).forEach(function (x) { if (String(x.channel_id) === String(d.channel_id)) r = x; });
        var ch = null;
        chans.forEach(function (c) { if (c.channelId === String(d.channel_id)) ch = c; });
        return { channelId: String(d.channel_id), title: ch ? ch.title : String(d.channel_id), status: r ? r.status : 'بانتظار النشر', messageId: r ? r.message_id : null, error: r ? r.error : '', link: r ? tawasulPostLink_(ch ? ch.username : '', d.channel_id, r.message_id) : '' };
      })
    };
  });
  return { ok: true, pid: acc.pid, owner: !!session.adm.owner, channels: chans, posts: posts };
}

/** إضافة قناة (مالك العميل وحده) */
function miniAppAdminTawasulAddChannel_(session, body) {
  var g = tawasulGuard_(); if (!g.ok) return g;
  var deny = miniAppAdminOwner_(session);
  if (deny) return { ok: false, error: deny.error, message: deny.message };
  var acc = miniAppAdminNeed_(session, body.pid);
  if (!acc.ok) return { ok: false, error: acc.error, message: acc.message };
  var lock = tenantLock_();
  lock.waitLock(25000);
  try {
    var r = tawasulAddChannel_(body.channel, session.uid);
    if (!r.ok) return { ok: false, error: 'add_failed', message: '⚠️ ' + r.error };
    logChange_(miniAppFrom_(session), acc.pid, 'التواصل', r.channel.channelId, r.existed ? 'تحديث قناة' : 'إضافة قناة', '', r.channel.title || r.channel.channelId);
    return { ok: true, channel: r.channel, message: r.existed ? 'ℹ️ القناة موجودة أصلًا — حُدّث تحققها وفُعّلت.' : '✅ أُضيفت القناة «' + (r.channel.title || r.channel.channelId) + '».' };
  } finally { lock.releaseLock(); }
}

/** تفعيل/إيقاف قناة (مالك العميل وحده) */
function miniAppAdminTawasulToggleChannel_(session, body) {
  var g = tawasulGuard_(); if (!g.ok) return g;
  var deny = miniAppAdminOwner_(session);
  if (deny) return { ok: false, error: deny.error, message: deny.message };
  var acc = miniAppAdminNeed_(session, body.pid);
  if (!acc.ok) return { ok: false, error: acc.error, message: acc.message };
  var lock = tenantLock_();
  lock.waitLock(25000);
  try {
    var r = tawasulSetChannelActive_(body.channelId, body.active !== false && body.active !== 'لا');
    if (!r.ok) return { ok: false, error: 'not_found', message: r.error };
    logChange_(miniAppFrom_(session), acc.pid, 'التواصل', String(body.channelId), body.active !== false && body.active !== 'لا' ? 'تفعيل قناة' : 'إيقاف قناة', '', r.channel.title || String(body.channelId));
    return { ok: true, message: '✅ حُفظ.' };
  } finally { lock.releaseLock(); }
}

/** حذف قناة من القائمة (مالك العميل وحده؛ لا يحذف منشوراتها المنشورة) */
function miniAppAdminTawasulRemoveChannel_(session, body) {
  var g = tawasulGuard_(); if (!g.ok) return g;
  var deny = miniAppAdminOwner_(session);
  if (deny) return { ok: false, error: deny.error, message: deny.message };
  var acc = miniAppAdminNeed_(session, body.pid);
  if (!acc.ok) return { ok: false, error: acc.error, message: acc.message };
  var lock = tenantLock_();
  lock.waitLock(25000);
  try {
    var r = tawasulRemoveChannel_(body.channelId);
    if (!r.ok) return { ok: false, error: 'not_found', message: r.error };
    logChange_(miniAppFrom_(session), acc.pid, 'التواصل', String(body.channelId), 'حذف قناة', '', r.channel.title || String(body.channelId));
    return { ok: true, message: '✅ حُذفت القناة من القائمة.' };
  } finally { lock.releaseLock(); }
}

/** عرض سجل المنشورات وحده (للتحديث بعد النشر) */
function miniAppAdminTawasulPosts_(session, body) {
  return miniAppAdminTawasulChannels_(session, body);
}

/** إنشاء منشور ونشره فورًا أو جدولته (المشرفون ضمن برامجهم) */
function miniAppAdminTawasulCreatePost_(session, body) {
  var g = tawasulGuard_(); if (!g.ok) return g;
  var acc = miniAppAdminNeed_(session, body.pid);
  if (!acc.ok) return { ok: false, error: acc.error, message: acc.message };
  var sched = null;
  if (str_(body.scheduledAt)) {
    var t = dateValue_(body.scheduledAt);
    if (t == null || t === undefined) return { ok: false, error: 'invalid', message: 'موعد النشر غير مفهوم.' };
    if (t < Date.now()) return { ok: false, error: 'invalid', message: 'موعد النشر في الماضي.' };
    sched = t;
  }
  var destIds = (body.destIds || body.channels || []);
  if (typeof destIds === 'string') { try { destIds = JSON.parse(destIds); } catch (e) { destIds = [destIds]; } }
  var lock = tenantLock_();
  lock.waitLock(25000);
  try {
    var created = tawasulCreatePost_({ text: body.text, mediaType: body.mediaType, mediaFileId: body.mediaFileId, destIds: destIds, scheduledAt: sched, programId: acc.pid, createdBy: session.uid });
    if (!created.ok) return { ok: false, error: 'create_failed', message: '⚠️ ' + created.error };
    var post = created.post;
    if (!sched) {
      tawasulPublishPost_(post);
      logChange_(miniAppFrom_(session), acc.pid, 'التواصل', post.id, 'نشر فوري', '', post.status);
      if (post.status === TAWASUL_STATUS.PUBLISHED) emitEvent_(EVENT_TYPES.TAWASUL_POSTED, acc.pid, { post: post.id, status: post.status, channels: post.results.filter(function (r) { return r.status === 'نُشر'; }).map(function (r) { return { ch: r.channel_id, mid: r.message_id }; }) }, String(session.uid));
      var msg = post.status === TAWASUL_STATUS.PUBLISHED ? '✅ نُشر في كل القنوات.'
        : post.status === TAWASUL_STATUS.PARTIAL ? '⚠️ نُشر جزئيًا — راجع سجل المنشورات لمعرفة القناة التي فشلت.'
        : '⚠️ تعذّر النشر — راجع سجل المنشورات (السبب مسجّل لكل قناة).';
      return { ok: post.status !== TAWASUL_STATUS.FAILED, postId: post.id, status: post.status, results: post.results, message: msg };
    }
    logChange_(miniAppFrom_(session), acc.pid, 'التواصل', post.id, 'جدولة منشور', '', fmtTime(sched));
    return { ok: true, postId: post.id, status: post.status, message: '✅ جُدول المنشور — يُنشر خلال الساعة المحددة (' + fmtTime(sched) + ').' };
  } finally { lock.releaseLock(); }
}

/** تحويل/نسخ منشور سابق إلى قنوات أخرى (المشرفون ضمن برامجهم) */
function miniAppAdminTawasulRepost_(session, body) {
  var g = tawasulGuard_(); if (!g.ok) return g;
  var acc = miniAppAdminNeed_(session, body.pid);
  if (!acc.ok) return { ok: false, error: acc.error, message: acc.message };
  var src = null;
  if (str_(body.link)) src = tawasulParsePostLink_(body.link);
  else if (body.chatId && body.messageId) src = { chatId: String(body.chatId), messageId: Number(body.messageId) };
  if (!src || !src.messageId) return { ok: false, error: 'invalid', message: 'رابط المنشور غير مفهوم — الصق رابط t.me/… الكامل.' };
  var destIds = (body.destIds || body.channels || []);
  if (typeof destIds === 'string') { try { destIds = JSON.parse(destIds); } catch (e) { destIds = [destIds]; } }
  var lock = tenantLock_();
  lock.waitLock(25000);
  try {
    var r = tawasulCreateRepost_({ srcChatId: src.chatId, srcMessageId: src.messageId, destIds: destIds, asCopy: body.asCopy !== false, programId: acc.pid, createdBy: session.uid });
    if (!r.ok) return { ok: false, error: 'repost_failed', message: '⚠️ ' + r.error };
    logChange_(miniAppFrom_(session), acc.pid, 'التواصل', r.post.id, body.asCopy !== false ? 'نسخ منشور' : 'تحويل منشور', '', r.post.status);
    var msg = r.post.status === TAWASUL_STATUS.PUBLISHED ? '✅ نُسخ المنشور إلى كل القنوات.'
      : r.post.status === TAWASUL_STATUS.PARTIAL ? '⚠️ نُسخ جزئيًا — راجع سجل المنشورات.'
      : '⚠️ تعذّر النسخ — راجع سجل المنشورات (السبب مسجّل لكل قناة).';
    return { ok: r.post.status !== TAWASUL_STATUS.FAILED, postId: r.post.id, status: r.post.status, results: r.post.results, message: msg };
  } finally { lock.releaseLock(); }
}
