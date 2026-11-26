// ===== AdminBot.gs =====
/**
 * AdminBot.gs — البوت الإداري (توكن منفصل، الرابط نفسه مع ?role=admin).
 * التنقل بالأزرار: كل زر يعدّل الرسالة نفسها (أسرع وبلا تكرار). كل طلب إدخال يعرض الصيغة ومثالًا،
 * والإدخال الخاطئ يُرد عليه بسبب الخطأ والمثال مرة أخرى. أي أمر (/start …) يلغي الإدخال المعلق.
 * كل تعديل: إدخال ← تحقق ← عرض «قبل ← بعد» ← تأكيد ← كتابة في «الإعدادات» ← سجل التعديلات ← تحديث ذاكرة بوت الطلاب.
 */
var SEC_CODE = { ACT: 'ACTIVITIES', CMP: 'COMPONENTS', GRP: 'GROUPS', BND: 'BANDS', GEN: 'GENERAL', LVL: 'LEVELS', STU: 'STUDENT', WRP: 'WEEKLY', REM: 'REMIND', RTP: 'REMTPL' };
var SEC_TITLE = { ACTIVITIES: '🎯 الفعاليات', COMPONENTS: '📝 الاختبارات', GROUPS: '🧩 المجموعات', BANDS: '🏅 التقديرات', GENERAL: '⚖️ النجاح والسقف', LEVELS: '🪜 المستويات',
  STUDENT: '🎓 خيارات الطلاب', WEEKLY: '🗓 التقرير الأسبوعي', REMIND: '🔔 التذكيرات', REMTPL: '✍️ نصوص التذكيرات' };
var BACK = '↩️ رجوع', CANCEL = '✖ إلغاء';
var ADMIN_STALE_SEC = 900; // رسائل أقدم من 15 دقيقة (متراكمة أثناء تعطل الربط) تُتجاهل

var ADMIN_HELP = 'دليل البوت الإداري:\n' +
  '• /start القائمة الرئيسية (يلغي أي إدخال معلق)\n' +
  '• /cancel إلغاء الإدخال الحالي\n' +
  '• /myid معرّفك في تيليجرام (يرسله المشرف الجديد للمالك)\n' +
  '• /help هذا الدليل\n\n' +
  '📋 «نسخ برنامج» ينشئ ملف درجات لدفعة جديدة من برنامج موجود (الإعدادات بلا بيانات الطلاب) ويضيفه للقائمة.\n' +
  '🆕 «برنامج جديد من القالب» تنشئه الخدمة ملفًا جديدًا. (لا يمكن ربط ملفات موجودة.)\n\n' +
  'كل شيء بالأزرار: اختر البرنامج ← القسم ← العنصر ← الحقل.\n' +
  'عند طلب كتابة قيمة تظهر الصيغة المطلوبة ومثال، وإن أخطأت يخبرك البوت بالسبب.\n' +
  'لا يُحفظ أي تعديل قبل أن تضغط «✅ تأكيد».';

function aState_(uid) { var s = cache_().get('ast:' + uid); return s ? JSON.parse(s) : {}; }
function aSave_(uid, st) { cache_().put('ast:' + uid, JSON.stringify(st), 21600); }

/** يمسح كل إدخال/تأكيد معلق مع إبقاء البرنامج المختار */
function aReset_(st) {
  ['await', 'pending', 'draft', 'addStep', 'choices', 'prompt', 'key'].forEach(function (k) { delete st[k]; });
  return st;
}

/** يعرض شاشة: أول عرض بعد ضغط زر يعدّل رسالة الزر نفسها، وما بعده يُرسل جديدًا */
function show_(ctx, text, kb) {
  var id = ctx.edit; ctx.edit = null;
  return screen_(ctx.chat, id, clip(text), kb);
}

function nav_(back) {
  var row = [];
  if (back) row.push({ text: BACK, callback_data: back });
  row.push({ text: CANCEL, callback_data: 'X' });
  return [row];
}

function handleAdminUpdate_(u) {
  var q = u.callback_query, m = u.message;
  var from = q ? q.from : (m && m.from);
  if (!from) return;
  if (m && (!m.chat || m.chat.type !== 'private')) return;
  if (m && m.date && (Date.now() / 1000 - m.date) > ADMIN_STALE_SEC) return; // رسالة قديمة متراكمة
  var chat = q ? q.message.chat.id : m.chat.id;
  var text = m && m.text ? String(m.text).trim() : '';
  var cmd = text.charAt(0) === '/' ? text.split(/\s+/)[0].replace(/@.*/, '').toLowerCase() : '';
  if (cmd === '/myid') {
    if (q) return;
    var s0 = aState_(String(from.id)); if (s0.await || s0.pending) aSave_(String(from.id), aReset_(s0));
    return send_(chat, 'معرّفك في تيليجرام: ' + from.id + '\n(إن كنت مشرفًا جديدًا فأرسل هذا الرقم لمسؤول البوت)');
  }
  var adm = adminInfo_(from.id);
  if (!adm) {
    if (q) return answerCallback_(q.id, 'غير مصرح لك', true);
    return send_(chat, '⛔ هذا البوت لمشرفي البرامج فقط.\nمعرّفك: ' + from.id + '\nأرسله لمسؤول البوت ليضيفك.');
  }
  var ctx = { chat: chat, from: from, adm: adm, uid: String(from.id), edit: null };
  if (q) {
    answerCallback_(q.id);
    ctx.edit = q.message.message_id;
    return onAdminCallback_(ctx, String(q.data || ''));
  }
  var st = aState_(ctx.uid);
  if (cmd) {
    // أي أمر يلغي الإدخال المعلق أولًا
    aReset_(st); aSave_(ctx.uid, st);
    if (modWait_(ctx.uid)) setModWait_(ctx.uid, null);
    if (cmd === '/start' || cmd === '/programs') { delete st.sec; delete st.ref; aSave_(ctx.uid, st); return home_(ctx, st); }
    if (cmd === '/cancel') return show_(ctx, 'أُلغيت العملية.', [[{ text: '🏠 القائمة', callback_data: st.pid ? 'M' : 'L' }]]);
    if (cmd === '/admins' && adm.owner) return showAdmins_(ctx, st);
    if (cmd === '/modules') return adm.owner ? showModules_(ctx) : show_(ctx, '⛔ الوحدات للمالك فقط.', [[{ text: '🏠 القائمة', callback_data: 'L' }]]);
    if (cmd === '/setup') return show_(ctx, '✅ اكتمل إعداد هذا النظام من قبل. للتغييرات استعمل القائمة.', [[{ text: '🏠 القائمة', callback_data: 'L' }]]);
    if (cmd === '/app') return sendMiniAppButton_(chat);
    var mc = moduleCommand_(ctx, cmd, text);
    if (mc !== undefined) return mc;
    return show_(ctx, ADMIN_HELP, [[{ text: '🏠 القائمة', callback_data: st.pid ? 'M' : 'L' }]]);
  }
  if (modWait_(ctx.uid)) { var mh = moduleHook_('onAdminMessage', [ctx, m]); if (mh !== undefined) return mh; }
  if (st.await) return onAdminText_(ctx, st, text);
  if (st.pending) return send_(chat, 'لديك تعديل ينتظر التأكيد: اضغط «✅ تأكيد» أو «✖ إلغاء» في الرسالة السابقة، أو /start للبدء من جديد.');
  return send_(chat, 'لا أنتظر منك نصًّا الآن. استعمل الأزرار، أو اضغط /start للقائمة، أو /help للدليل.');
}

/* ───────── القوائم ───────── */

function accessiblePrograms_(ctx) { return getPrograms_().filter(function (p) { return canAccess_(ctx.adm, p.id); }); }

/** الشاشة الرئيسية: إن كان للمشرف برنامج واحد فتُفتح قائمته مباشرة */
function home_(ctx, st) {
  var list = accessiblePrograms_(ctx);
  if (list.length === 1 && !ctx.adm.owner) { st.pid = list[0].id; aSave_(ctx.uid, st); return showMain_(ctx, st); }
  return showPrograms_(ctx, st);
}

function showPrograms_(ctx, st) {
  if (st) { delete st.sec; delete st.ref; aSave_(ctx.uid, aReset_(st)); }
  var list = accessiblePrograms_(ctx);
  var kb = list.map(function (p) { return [{ text: (p.open ? '🟢 ' : '⚪️ ') + (p.name || p.id), callback_data: 'P:' + p.id }]; });
  var tools = [];
  if (canCopy_(ctx.adm) && list.length) tools.push({ text: '📋 نسخ برنامج', callback_data: 'CPY' });
  if (tools.length) kb.push(tools);
  if (ctx.adm.owner) kb.push([{ text: '🆕 برنامج جديد من القالب', callback_data: 'NEWP' }]);
  if (ctx.adm.owner) kb.push([{ text: '👥 المشرفون', callback_data: 'ADM' }, { text: '🧩 الوحدات', callback_data: 'MOD:' }]);
  kb.push([{ text: '❓ الدليل', callback_data: 'H' }]);
  return show_(ctx, list.length ? 'اختر البرنامج:\n(🟢 مفتوح للتسليم · ⚪️ مغلق)' : 'لا توجد برامج متاحة لك.', kb);
}

function currentProgram_(ctx, st) {
  if (!st.pid || !canAccess_(ctx.adm, st.pid)) return null;
  return getPrograms_().filter(function (p) { return p.id === st.pid; })[0] || null;
}

function showMain_(ctx, st, notice) {
  var p = currentProgram_(ctx, st);
  if (!p) return showPrograms_(ctx, st);
  aReset_(st); delete st.sec; delete st.ref; aSave_(ctx.uid, st);
  var kb = [
    [{ text: SEC_TITLE.ACTIVITIES, callback_data: 'S:ACT' }, { text: SEC_TITLE.COMPONENTS, callback_data: 'S:CMP' }],
    [{ text: SEC_TITLE.GROUPS, callback_data: 'S:GRP' }, { text: SEC_TITLE.BANDS, callback_data: 'S:BND' }],
    [{ text: SEC_TITLE.GENERAL, callback_data: 'S:GEN' }, { text: SEC_TITLE.LEVELS, callback_data: 'S:LVL' }],
    [{ text: '🧮 حساب الدرجات', callback_data: 'CALC' }, { text: '📊 ملخص', callback_data: 'SUM' }],
    [{ text: '📥 آخر التسليمات', callback_data: 'LAST' }, { text: '🔎 بحث بالبريد', callback_data: 'FIND' }],
    [{ text: SEC_TITLE.STUDENT, callback_data: 'S:STU' }, { text: SEC_TITLE.WEEKLY, callback_data: 'S:WRP' }],
    [{ text: SEC_TITLE.REMIND, callback_data: 'S:REM' }],
    [{ text: p.open ? '🔒 إغلاق التسليم' : '🔓 فتح التسليم', callback_data: 'TOG' }]
  ];
  if (canCopy_(ctx.adm)) kb.push([{ text: '📋 نسخ هذا البرنامج لدفعة جديدة', callback_data: 'CPS:' + p.id }]);
  if (ctx.adm.owner) kb.push([{ text: '👥 المشرفون', callback_data: 'ADM' }]);
  if (ctx.adm.owner || accessiblePrograms_(ctx).length > 1) kb.push([{ text: '🗂 البرامج', callback_data: 'L' }]);
  return show_(ctx, (notice ? notice + '\n\n' : '') + '⚙️ إدارة «' + (p.name || p.id) + '» — ' + (p.open ? '🟢 مفتوح للتسليم' : '⚪️ مغلق') +
    '\nاختر القسم الذي تريد عرضه أو تعديله:', kb);
}

/** قيم ورقة الإعدادات (ذاكرة مؤقتة قصيرة؛ تُمسح بعد أي تعديل من البوت) */
function settingsValues_(pid, fresh) {
  var key = 'svals:' + pid;
  if (!fresh) { var c = getBig_(key); if (c) return c; }
  var v = programSpreadsheet_(pid).getSheetByName(NAMES.SETTINGS).getDataRange().getValues();
  try { putBig_(key, v, TTL.SETTINGS); } catch (e) { /* القيم كبيرة جدًا: بلا ذاكرة */ }
  return v;
}

function showSection_(ctx, st, sec, notice) {
  aReset_(st); st.sec = sec; delete st.ref;
  var values = settingsValues_(st.pid);
  var head = (notice ? notice + '\n\n' : '') + SEC_TITLE[sec];
  if (isGen_(sec)) {
    aSave_(ctx.uid, st);
    var kb = editable_()[sec].map(function (f) { return { text: '✏️ ' + fieldLabel(sec, f[0]), callback_data: 'F:' + f[0] }; });
    var top = [], note = '';
    if (sec === 'WEEKLY') {
      var wo = weeklyOptions(parseSettings(values).general), last = prop_('WR_SENT_' + st.pid);
      head += '\n\nالحالة: ' + (wo.on ? '🟢 مفعّل' : '⚪️ موقوف') + ' — كل ' + WEEK_DAYS_JS[wo.day] + ' الساعة ' + wo.hour + ':00 (القاهرة)' + (last ? '\nآخر إرسال: ' + last : '');
      top = [[{ text: wo.on ? '⏹ إيقاف التقرير الأسبوعي' : '▶️ تفعيل التقرير الأسبوعي', callback_data: 'WRT' }, { text: '📨 التقرير الآن', callback_data: 'WRN' }]];
      note = '\n\nيصل التقرير من هذا البوت: المسجلون، ومن سلّم، وتسليمات الأسبوع لكل فعالية، ونسبة الاجتياز، والمتعثرون، والمرفوض.';
    }
    if (sec === 'REMIND') { var rt = remindSectionTop_(st, values); head += rt.head; top = rt.top; note = rt.note; }
    if (sec === 'REMTPL') note = '\n\nالمتغيرات: {الاسم} {الفعالية} {الموعد} {المتبقي} {المستوى} {التعويض}. السطر الذي فيه متغير بلا قيمة يُحذف تلقائيًا.';
    if (sec === 'STUDENT') note = '\n\n«🗂 تسليماتي» (/mysubs) و«📊 درجاتي» (/mygrades) يظهران للطالب بعد كل تسليم وفي /help. التعديل والحذف للتسليمات المرسلة من حساب الطالب نفسه فقط.\n«مدة السماح بالتعديل والحذف» فارغة (الافتراضي) = بلا حد حتى يُغلق البرنامج؛ أو اكتب عدد ساعات (مثل 48). ويُمنع دائمًا إذا أُغلق البرنامج أو أُوقفت الفعالية أو فات موعدها المغلق في «📅 المواعيد».';
    return show_(ctx, head + '\n\n' + describeItem(values, sec) + note + '\n\nاختر الحقل الذي تريد تعديله:', top.concat(rows_(kb, 2), [[{ text: BACK, callback_data: sec === 'REMTPL' ? 'S:REM' : 'M' }]]));
  }
  var items = sectionItems(values, sec);
  st.items = items.map(function (x) { return sec === 'BANDS' ? x.r : itemRef_(x.data); });
  aSave_(ctx.uid, st);
  var lines = items.map(function (x) { return '• ' + itemSummary_(sec, x.data); });
  var kb2 = items.map(function (x, i) { return { text: sec === 'BANDS' ? x.data.min + ' — ' + x.data.label : itemRef_(x.data), callback_data: 'I:' + i }; });
  var extra = [[{ text: '➕ إضافة', callback_data: 'ADD' }]];
  if (sec === 'COMPONENTS') extra = []; // الاختبارات تُضاف من الورقة لأنها مرتبطة بأوراق ردود
  var hint = items.length ? '\n\nاضغط عنصرًا لتعديله.' : '';
  if (sec === 'COMPONENTS') hint += '\n(تُضاف الاختبارات من ورقة «الإعدادات» لأنها مرتبطة بأوراق الردود.)';
  if (sec === 'LEVELS') {
    var lv = parseSettings(values);
    hint += items.length || lv.levels.length ?
      '\n\nقاعدة النجاح: «' + lv.general.levelPassRule + '» (تعدّلها من «' + SEC_TITLE.GENERAL + '»). ولتحديد مستوى اختبار أو فعالية أو مجموعة: افتح العنصر ← «✏️ المستوى».' :
      '\n\nهذا البرنامج بلا مستويات (يعمل كما هو). لبرنامج له مستويات (مثل برنامج متعدد المراحل): أضف المستويات هنا، ثم حدّد مستوى كل اختبار وفعالية. يختار الطالب المستوى في بوت الطلاب قبل الفعالية.';
  }
  return show_(ctx, head + '\n\n' + (lines.join('\n') || '— لا عناصر —') + hint, rows_(kb2, 2).concat(extra, [[{ text: BACK, callback_data: 'M' }]]));
}

function itemSummary_(sec, d) {
  var v = function (x) { return display_(x); };
  if (sec === 'ACTIVITIES') {
    var pz = pauseLabel({ pausedFrom: dateValue_(d.pausedFrom) || null, pausedUntil: dateValue_(d.pausedUntil) || null }, Date.now());
    return itemRef_(d) + ': ' + v(d.points) + ' لكل تسليم، يُحتسب ' + (str_(d.maxCount) ? d.maxCount : 'بلا حد') + (str_(d.maxPoints) ? '، سقف ' + d.maxPoints : '') + (str_(d.bot) === OPT.NO ? '، خارج البوت' : '') + (pz ? ' — ' + pz : '');
  }
  if (sec === 'COMPONENTS') return itemRef_(d) + ' [' + v(d.sheet) + ']: ' + v(d.type) + '، عظمى ' + v(d.max) + '، المحاولات: ' + v(d.attempts) + (str_(d.group) ? '، مجموعة ' + d.group : '') + (str_(d.enabled) === OPT.NO ? ' — معطّل' : '');
  if (sec === 'GROUPS') return itemRef_(d) + ': ' + v(d.rule) + '، ' + v(d.type) + (str_(d.max) ? '، سقف ' + d.max : '');
  if (sec === 'BANDS') return 'من ' + v(d.min) + ': ' + v(d.label);
  if (sec === 'LEVELS') return d.title + ': درجة النجاح ' + (str_(d.passMark) ? d.passMark : 'العامة');
  return '';
}

function showItem_(ctx, st, notice) {
  aReset_(st);
  var values = settingsValues_(st.pid);
  var desc = describeItem(values, st.sec, st.ref);
  if (desc == null) return showSection_(ctx, st, st.sec, notice);
  aSave_(ctx.uid, st);
  var kb = editable_()[st.sec].map(function (f) { return { text: '✏️ ' + fieldLabel(st.sec, f[0]), callback_data: 'F:' + f[0] }; });
  var extra = st.sec === 'BANDS' ? [[{ text: '🗑 حذف هذا التقدير', callback_data: 'DEL' }]] : [];
  if (st.sec === 'ACTIVITIES') {
    var act = parseSettings(values).activities.filter(function (a) { return a.key === st.ref; })[0];
    var pl = act ? pauseLabel(act, Date.now()) : '';
    if (pl) desc += '\n\n' + pl;
    extra = [[{ text: '⏸ إيقاف مؤقت', callback_data: 'PZ' }].concat(pl ? [{ text: '▶️ تفعيل الآن', callback_data: 'PZN' }] : [])];
  }
  var title = st.sec === 'BANDS' ? 'تقدير' : '«' + st.ref + '»';
  return show_(ctx, (notice ? notice + '\n\n' : '') + SEC_TITLE[st.sec] + ' — ' + title + '\n\n' + desc + '\n\nاختر الحقل الذي تريد تعديله:',
    rows_(kb, 2).concat(extra, [[{ text: BACK, callback_data: 'S:' + codeOf_(st.sec) }]]));
}

function codeOf_(sec) { for (var k in SEC_CODE) if (SEC_CODE[k] === sec) return k; return 'GEN'; }

/** زر الرجوع المناسب لمكان المشرف الحالي */
function backData_(st) {
  if (st.sec && st.ref != null && !isGen_(st.sec)) return 'I:' + Math.max(0, (st.items || []).indexOf(st.ref));
  if (st.sec) return 'S:' + codeOf_(st.sec);
  return st.pid ? 'M' : 'L';
}

/* ───────── طلب إدخال نصي: الصيغة + مثال، والخطأ مع سببه ───────── */

function ask_(ctx, st, kind, p) {
  st.await = kind; st.prompt = p; aSave_(ctx.uid, st);
  return show_(ctx, promptText_(p), nav_(p.back));
}

function promptText_(p) {
  return p.title + '\n\n✍️ الصيغة: ' + p.format + '\n📌 مثال: ' + p.example + (p.note ? '\n\n' + p.note : '') +
    '\n\nاكتب ردك الآن، أو اضغط «إلغاء».';
}

/** إدخال خاطئ: يبقى البوت منتظرًا ويشرح الخطأ ويعيد المثال */
function bad_(ctx, st, error) {
  var p = st.prompt || { title: '', format: '', example: '' };
  aSave_(ctx.uid, st);
  return send_(ctx.chat, '⚠️ ' + error + '\n\n✍️ الصيغة: ' + p.format + '\n📌 مثال: ' + p.example + '\n\nأعد الإرسال، أو اضغط «إلغاء».', nav_(p.back));
}

/* ───────── الأزرار ───────── */

function onAdminCallback_(ctx, data) {
  var st = aState_(ctx.uid);
  var cmd = data.split(':')[0], arg = data.slice(cmd.length + 1);
  if (cmd === 'H') return show_(ctx, ADMIN_HELP, [[{ text: '🏠 القائمة', callback_data: st.pid ? 'M' : 'L' }]]);
  if (cmd === 'X') {
    var back = st.prompt && st.prompt.back || backData_(st);
    if (/^CP/.test(back) || (st.pending && st.pending.kind === 'copyprog')) back = 'CPY'; // المسودة تُمسح مع الإلغاء
    aReset_(st); aSave_(ctx.uid, st);
    return show_(ctx, 'أُلغيت العملية، ولم يُحفظ شيء.', [[{ text: BACK, callback_data: back }, { text: '🏠 القائمة', callback_data: st.pid ? 'M' : 'L' }]]);
  }
  if (cmd === 'L') return showPrograms_(ctx, st);
  if (cmd === 'MX') return moduleCallback_(ctx, arg);
  if (cmd === 'MOD') return arg ? toggleModule_(ctx, arg) : (ctx.adm.owner ? showModules_(ctx) : show_(ctx, '⛔ الوحدات للمالك فقط.', [[{ text: BACK, callback_data: 'L' }]]));
  // ADDP (ربط ملف موجود) أُلغي في نسخة الخدمة: الأزرار القديمة تفتح الإنشاء من القالب
  if ((cmd === 'NEWP' || cmd === 'ADDP') && ctx.adm.owner) {
    var qn = quotaError_(); if (qn) return show_(ctx, qn, [[{ text: BACK, callback_data: 'L' }]]);
    aReset_(st); st.draft = {};
    return ask_(ctx, st, 'newName', { title: '🆕 برنامج جديد من القالب (١/٢): أرسل اسم البرنامج كما يظهر للطلاب.', format: 'نص من 2 إلى 60 حرفًا', example: 'الدورة الثانية', back: 'L' });
  }
  if (cmd === 'NEWNOLV' && ctx.adm.owner && st.draft && st.draft.newName) return newProgramCommit_(ctx, st, []);
  if (cmd === 'P') {
    if (!canAccess_(ctx.adm, arg)) return show_(ctx, '⛔ لا تملك صلاحية هذا البرنامج.', [[{ text: BACK, callback_data: 'L' }]]);
    st = { pid: arg }; aSave_(ctx.uid, st); return showMain_(ctx, st);
  }
  if (cmd === 'ADM' && ctx.adm.owner) return showAdmins_(ctx, st);
  if (cmd === 'ADMADD' && ctx.adm.owner) return askAdmin_(ctx, st);
  if (cmd === 'APT' && ctx.adm.owner) return toggleAdminProgram_(ctx, st, arg);
  if (cmd === 'ADMDEL' && ctx.adm.owner) {
    var a = readAdmins_().filter(function (x) { return x.id === arg; })[0];
    st.pending = { kind: 'admdel', id: arg, label: 'حذف المشرف ' + arg }; aSave_(ctx.uid, st);
    return confirm_(ctx, 'حذف المشرف ' + (a ? a.name + ' (' + arg + ')' : arg) + '؟', 'مشرف', '(محذوف)', 'ADM');
  }
  var cp = onCopyCallback_(ctx, st, cmd, arg);
  if (cp !== undefined) return cp;
  if (cmd === 'OK') return commit_(ctx, st);
  if (cmd === 'NO') { var b = st.pending && st.pending.back || backData_(st); aReset_(st); aSave_(ctx.uid, st); return show_(ctx, 'أُلغي التعديل، ولم يُحفظ شيء.', [[{ text: BACK, callback_data: b }]]); }

  var prog = currentProgram_(ctx, st);
  if (!prog) return showPrograms_(ctx, st);
  switch (cmd) {
    case 'M': return showMain_(ctx, st);
    case 'S': return showSection_(ctx, st, SEC_CODE[arg] || 'GENERAL');
    case 'I': st.ref = (st.items || [])[Number(arg)]; if (st.ref == null) return showSection_(ctx, st, st.sec || 'GENERAL'); return showItem_(ctx, st);
    case 'F': return startEdit_(ctx, st, arg);
    case 'C': {
      var ch = (st.choices || [])[Number(arg)];
      if (ch == null) return show_(ctx, 'انتهت صلاحية هذه الأزرار.', [[{ text: BACK, callback_data: backData_(st) }]]);
      return receiveValue_(ctx, st, ch);
    }
    case 'ADD': return startAdd_(ctx, st);
    case 'DEL': {
      var plan = planClear(settingsValues_(st.pid, true), 'BANDS', st.ref);
      if (plan.error) return show_(ctx, '⚠️ ' + plan.error, [[{ text: BACK, callback_data: backData_(st) }]]);
      st.pending = { kind: 'clear', sec: 'BANDS', ref: st.ref, old: plan.old }; aSave_(ctx.uid, st);
      return confirm_(ctx, 'حذف التقدير', plan.old, '(محذوف)');
    }
    case 'TOG': {
      var to = prog.open ? OPT.NO : OPT.YES;
      st.pending = { kind: 'toggle', old: prog.open ? OPT.YES : OPT.NO, value: to, back: 'M' }; aSave_(ctx.uid, st);
      return confirm_(ctx, 'مفتوح للتسليم', st.pending.old, to, 'M');
    }
    case 'CALC': return runCalc_(ctx, st, prog);
    case 'SUM': return runSummary_(ctx, st, prog);
    case 'LAST': return showLatest_(ctx, st);
    case 'FIND': aReset_(st); return ask_(ctx, st, 'lookup', { title: '🔎 أرسل بريد الطالب لعرض درجاته وتسليماته.', format: 'بريد إلكتروني', example: 'name@gmail.com', back: 'M' });
    case 'V': return viewSubmission_(ctx, st, Number(arg));
    case 'PZ': return arg ? choosePause_(ctx, st, arg) : showPauseMenu_(ctx, st);
    case 'PZN': return preparePause_(ctx, st, '', '', '▶️ متاحة الآن');
    case 'WRT': return toggleWeekly_(ctx, st);
    case 'WRN': return weeklyNow_(ctx, st, prog);
  }
  if (onRemindCallback_(ctx, st, cmd, arg, prog)) return;
  return showMain_(ctx, st);
}

function backTo_(ctx, st, notice) {
  if (st.sec && st.ref != null && !isGen_(st.sec)) return showItem_(ctx, st, notice);
  if (st.sec) return showSection_(ctx, st, st.sec, notice);
  return showMain_(ctx, st, notice);
}

/* ───────── التعديل ───────── */

function startEdit_(ctx, st, key) {
  var spec = fieldSpec(st.sec, key);
  if (!spec) return show_(ctx, 'حقل غير معروف.', [[{ text: BACK, callback_data: backData_(st) }]]);
  aReset_(st); st.key = key;
  var values = settingsValues_(st.pid);
  var plan = planEdit(values, st.sec, st.ref, key, '');
  if (plan.error) return show_(ctx, '⚠️ ' + plan.error, [[{ text: BACK, callback_data: backData_(st) }]]);
  var label = fieldLabel(st.sec, key), cur = display_(plan.old);
  var choices = null;
  if (spec[1] === 'choice') choices = spec[2];
  if (spec[1] === 'yesno') choices = [OPT.YES, OPT.NO];
  if (spec[1] === 'group') { var itG = findItem_(settingsLayout(values), st.sec, st.ref); choices = groupTitles(values, itG ? str_(itG.data.level) : undefined).concat(['بلا مجموعة']); }
  if (spec[1] === 'level') {
    var lvs = levelTitles(values);
    if (!lvs.length) return show_(ctx, 'لا توجد مستويات في هذا البرنامج بعد.\nأضفها أولًا من «' + SEC_TITLE.LEVELS + '» ثم ارجع لتحديد مستوى العنصر.', [[{ text: SEC_TITLE.LEVELS, callback_data: 'S:LVL' }, { text: BACK, callback_data: backData_(st) }]]);
    choices = lvs.concat([OPT_NO_LEVEL]);
  }
  if (choices) {
    st.choices = choices; aSave_(ctx.uid, st);
    return show_(ctx, '«' + label + '» — القيمة الحالية: ' + cur + '\nاختر القيمة الجديدة:',
      rows_(choices.map(function (c, i) { return { text: (String(c) === String(plan.old) ? '• ' : '') + c, callback_data: 'C:' + i }; }), 2).concat(nav_(backData_(st))));
  }
  var f = fieldFormat(st.sec, key);
  return ask_(ctx, st, 'value', { title: '✏️ «' + label + '»\nالقيمة الحالية: ' + cur + '\nأرسل القيمة الجديدة.', format: f.format, example: f.example, back: backData_(st) });
}

function receiveValue_(ctx, st, raw) {
  // خطوات إضافة مجموعة (طريقة الحساب ثم النوع) تأتي من أزرار الاختيار نفسها
  if (st.addStep === 'level') {
    delete st.addStep; st.draft.level = raw === OPT_NO_LEVEL ? '' : raw;
    var refN = refWithLevel_(st.draft.title, st.draft.level);
    if (sectionItems(settingsValues_(st.pid), st.sec).some(function (x) { return itemRef_(x.data) === refN; }))
      return show_(ctx, '⚠️ «' + refN + '» موجود من قبل. اختر اسمًا أو مستوى آخر.', nav_(backData_(st)));
    return afterTitle_(ctx, st);
  }
  if (st.addStep === 'rule') {
    st.draft.rule = raw; st.addStep = 'type'; st.choices = [OPT.EXTRA, OPT.BASIC]; aSave_(ctx.uid, st);
    return show_(ctx, 'إضافة مجموعة «' + st.draft.title + '» — نوع المجموعة:', [st.choices.map(function (c, i) { return { text: c, callback_data: 'C:' + i }; })].concat(nav_(backData_(st))));
  }
  if (st.addStep === 'type') {
    delete st.addStep;
    var d = { title: st.draft.title, rule: st.draft.rule, type: raw, max: '', min: '', order: '' };
    if (st.draft.level) d.level = st.draft.level;
    return preparePlanAdd_(ctx, st, d, d.title + ': ' + d.rule + '، ' + d.type);
  }
  var values = settingsValues_(st.pid);
  var v = validateInput(st.sec, st.key, raw, { groups: groupTitles(values), levels: levelTitles(values) });
  if (!v.ok) return st.await ? bad_(ctx, st, v.error) : show_(ctx, '⚠️ ' + v.error, nav_(backData_(st)));
  var plan = planEdit(values, st.sec, st.ref, st.key, v.value);
  var err = validatePlan(values, plan);
  if (!err && st.key === 'level' && !plan.error) { var nr = refWithLevel_(st.ref, v.value); if (nr !== st.ref && sectionItems(values, st.sec).some(function (x) { return itemRef_(x.data) === nr; })) err = '«' + nr + '» موجود من قبل.'; }
  if (err) return st.await ? bad_(ctx, st, 'لا يمكن حفظ هذه القيمة:\n' + err) : show_(ctx, '⚠️ لا يمكن حفظ هذا التعديل:\n' + err, nav_(backData_(st)));
  if (String(plan.old) === String(v.value)) { aReset_(st); aSave_(ctx.uid, st); return backTo_(ctx, st, 'ℹ️ القيمة لم تتغير.'); }
  st.pending = { kind: 'set', sec: st.sec, ref: st.ref, key: st.key, value: v.value, old: plan.old };
  delete st.await; delete st.prompt; aSave_(ctx.uid, st);
  return confirm_(ctx, (isGen_(st.sec) ? '' : (st.sec === 'BANDS' ? 'تقدير' : '«' + st.ref + '»') + ' ← ') + fieldLabel(st.sec, st.key), plan.old, v.value);
}

function confirm_(ctx, label, oldV, newV, back) {
  return show_(ctx, 'تأكيد التعديل (راجع ثم اضغط ✅ تأكيد):\n' + label + '\nقبل: ' + display_(oldV) + '\nبعد: ' + display_(newV),
    [[{ text: '✅ تأكيد', callback_data: 'OK' }, { text: CANCEL, callback_data: 'NO' }]]);
}

/** إضافة عنصر: أسئلة متتابعة ثم تأكيد */
function startAdd_(ctx, st) {
  aReset_(st); st.draft = {};
  var back = backData_(st);
  if (st.sec === 'BANDS') return ask_(ctx, st, 'band', { title: '➕ تقدير جديد: أرسل الحد الأدنى ثم اسم التقدير.', format: '<رقم> <اسم التقدير>', example: '85 جيد مرتفع', back: back });
  if (st.sec === 'LEVELS') return ask_(ctx, st, 'newTitle', { title: '➕ مستوى جديد: أرسل اسمه.', format: 'نص حتى 40 حرفًا', example: 'المستوى الأول', back: back,
    note: 'درجة نجاحه = درجة النجاح العامة، ويمكنك تعديلها بعد الإضافة.' });
  if (st.sec === 'GROUPS') return ask_(ctx, st, 'newTitle', { title: '➕ مجموعة جديدة (١/٣): أرسل اسمها.', format: 'نص حتى 60 حرفًا', example: 'الاختبارات القصيرة', back: back });
  return ask_(ctx, st, 'newTitle', { title: '➕ فعالية جديدة (١/٣): أرسل اسمها.', format: 'نص حتى 60 حرفًا', example: 'مطارحة', back: back });
}

function onAdminText_(ctx, st, text) {
  var a = st.await;
  if (!text) return bad_(ctx, st, 'أرسل ردك نصًّا (لا صورة ولا ملف).');
  if (a === 'value') return receiveValue_(ctx, st, text);
  if (a === 'pauseDate') return pauseDateText_(ctx, st, text);
  if (/^sch/.test(a)) return scheduleText_(ctx, st, text);
  if (a === 'lookup') {
    var em = normalizeEmail(text);
    if (!isValidEmail(em)) return bad_(ctx, st, '«' + clip(text, 60) + '» ليس بريدًا إلكترونيًا صحيحًا.');
    aReset_(st); aSave_(ctx.uid, st); return runLookup_(ctx, st, em);
  }
  if (a === 'progId' || a === 'progLink') { aReset_(st); aSave_(ctx.uid, st); return show_(ctx, 'ربط ملف موجود غير متاح؛ البرامج تُنشأ من الخدمة فقط.', [[{ text: '🆕 برنامج جديد من القالب', callback_data: 'NEWP' }], [{ text: BACK, callback_data: 'L' }]]); }
  if (a === 'newName' || a === 'newLevels') return newProgramStep_(ctx, st, text);
  if (/^cp/.test(a)) return onCopyText_(ctx, st, text);
  if (a === 'admin') return addAdminStep_(ctx, st, text);
  if (a === 'band') {
    var m = latinDigits_(text).match(/^\s*(\d+(?:[.,٫]\d+)?)\s*[-–:،,]?\s*(.+)$/);
    if (!m) return bad_(ctx, st, 'ابدأ برقم الحد الأدنى ثم مسافة ثم اسم التقدير.');
    var min = Number(m[1].replace(/[,٫]/, '.')), label = m[2].trim();
    if (min > 1000) return bad_(ctx, st, 'الحد الأدنى ' + min + ' كبير جدًا.');
    if (label.length > 60) return bad_(ctx, st, 'اسم التقدير أطول من 60 حرفًا.');
    return preparePlanAdd_(ctx, st, { min: min, label: label }, min + ' — ' + label);
  }
  if (a === 'newTitle') {
    var t = str_(text);
    if (t.length > (st.sec === 'LEVELS' ? 40 : 60)) return bad_(ctx, st, 'الاسم أطول من ' + (st.sec === 'LEVELS' ? 40 : 60) + ' حرفًا (' + t.length + ').');
    if (/[()]/.test(t)) return bad_(ctx, st, 'لا تستعمل الأقواس في الاسم (تُستعمل لإظهار المستوى).');
    var vals0 = settingsValues_(st.pid), lvls = st.sec === 'LEVELS' ? [] : levelTitles(vals0);
    if (st.sec === 'LEVELS') {
      if (levelTitles(vals0).some(function (x) { return normKey_(x) === normKey_(t); })) return bad_(ctx, st, 'المستوى «' + t + '» موجود من قبل.');
      var nOrd = sectionItems(vals0, 'LEVELS').length + 1;
      return preparePlanAdd_(ctx, st, { title: t, passMark: '', order: nOrd }, t + ' (درجة النجاح: العامة)');
    }
    st.draft = { title: t };
    if (lvls.length) {
      // برنامج بمستويات: يُختار المستوى أولًا، والتكرار يُفحص داخل المستوى
      delete st.await; delete st.prompt; st.addStep = 'level'; st.choices = lvls.concat([OPT_NO_LEVEL]); aSave_(ctx.uid, st);
      return show_(ctx, '«' + t + '» — في أي مستوى؟\n(«' + OPT_NO_LEVEL + '» = ' + (st.sec === 'ACTIVITIES' ? 'تظهر في كل المستويات وتُحسب في المجموع الكلي' : 'تُحسب في المجموع الكلي فقط') + ')',
        rows_(st.choices.map(function (c, i) { return { text: c, callback_data: 'C:' + i }; }), 2).concat(nav_(backData_(st))));
    }
    var exists = sectionItems(vals0, st.sec).some(function (x) { return normKey_(itemRef_(x.data)) === normKey_(t); });
    if (exists) return bad_(ctx, st, '«' + t + '» موجود من قبل. اختر اسمًا آخر.');
    return afterTitle_(ctx, st);
  }
  if (a === 'newPoints') {
    var p = validateInput('ACTIVITIES', 'points', text);
    if (!p.ok) return bad_(ctx, st, p.error);
    st.draft.points = p.value;
    return ask_(ctx, st, 'newMax', { title: '➕ «' + st.draft.title + '» (٣/٣): أقصى عدد تسليمات تُحتسب؟', format: 'عدد صحيح، أو «-» بلا حد', example: '4', back: st.prompt.back });
  }
  if (a === 'newMax') {
    var mx = validateInput('ACTIVITIES', 'maxCount', text);
    if (!mx.ok) return bad_(ctx, st, mx.error);
    var values = settingsValues_(st.pid);
    var orders = sectionItems(values, 'ACTIVITIES').map(function (x) { return num_(x.data.order) || 0; });
    var d = { title: st.draft.title, points: st.draft.points, maxCount: mx.value, maxPoints: '', type: OPT.EXTRA, min: '', group: '',
      order: (orders.length ? Math.max.apply(null, orders) : 99) + 1, bot: OPT.YES, accepts: OPT.ACC_ANY, instructions: '' };
    if (st.draft.level) d.level = st.draft.level;
    return preparePlanAdd_(ctx, st, d, d.title + ': ' + d.points + ' لكل تسليم، يُحتسب ' + (d.maxCount === '' ? 'بلا حد' : d.maxCount) + '، متاحة في البوت');
  }
  aReset_(st); aSave_(ctx.uid, st);
  return send_(ctx.chat, 'انتهت هذه الخطوة. اضغط /start للقائمة.');
}

function preparePlanAdd_(ctx, st, obj, label) {
  var values = settingsValues_(st.pid);
  var plan = planAdd(values, st.sec, obj);
  var err = validatePlan(values, plan);
  if (err) return st.await ? bad_(ctx, st, 'لا يمكن الإضافة:\n' + err) : show_(ctx, '⚠️ لا يمكن الإضافة:\n' + err, nav_(backData_(st)));
  st.pending = { kind: 'add', sec: st.sec, obj: obj, label: label };
  delete st.await; delete st.prompt; aSave_(ctx.uid, st);
  return confirm_(ctx, 'إضافة إلى ' + SEC_TITLE[st.sec], '(جديد)', label + (obj.level ? ' — ' + obj.level : ''));
}

/** تنفيذ التعديل المؤكد: يعيد التحقق على الورقة الحالية ثم يكتب ويسجل ويحدّث الذاكرة */
function commit_(ctx, st) {
  var pd = st.pending;
  if (!pd) return show_(ctx, 'لا يوجد تعديل معلق (ربما أُكّد أو أُلغي من قبل).', [[{ text: '🏠 القائمة', callback_data: st.pid ? 'M' : 'L' }]]);
  delete st.pending; aSave_(ctx.uid, st);
  if (pd.kind === 'copyprog') return canCopy_(ctx.adm) ? commitCopy_(ctx, st) : show_(ctx, '⛔ لا تملك صلاحية النسخ.', [[{ text: BACK, callback_data: 'L' }]]);
  if (pd.kind === 'remsend') return currentProgram_(ctx, st) ? commitManualSend_(ctx, st, pd) : showPrograms_(ctx, st); // خارج القفل: الإرسال قد يطول
  var lock = tenantLock_();
  lock.waitLock(25000);
  try {
    if (pd.kind === 'admdel') {
      removeAdmin_(pd.id); logChange_(ctx.from, '-', 'المشرفون', pd.id, 'حذف', pd.id, '');
      return showAdmins_(ctx, st, '✅ حُذف المشرف ' + pd.id + '.');
    }
    if (pd.kind === 'admadd') {
      if (!pd.all && !pd.programs.length) { st.pending = pd; aSave_(ctx.uid, st); return showAdminDraft_(ctx, st, '⚠️ اختر برنامجًا واحدًا على الأقل، أو «كل البرامج».'); }
      addAdmin_(pd.id, pd.name, pd.all ? [] : pd.programs, ctx.from.id);
      logChange_(ctx.from, '-', 'المشرفون', pd.id, pd.replace ? 'تحديث' : 'إضافة', '', pd.name + ' ' + (pd.all ? 'كل البرامج' : pd.programs.join(',')));
      return showAdmins_(ctx, st, '✅ ' + (pd.replace ? 'حُدّث' : 'أُضيف') + ' المشرف:\n• الاسم: ' + pd.name + '\n• المعرّف: ' + pd.id +
        '\n• البرامج: ' + programsLabel_(pd) + '\nيستطيع الآن فتح هذا البوت وإرسال /start.');
    }
    if (!currentProgram_(ctx, st)) return showPrograms_(ctx, st);
    if (pd.kind === 'pause') return commitPause_(ctx, st, pd);
    if (pd.kind === 'weekly') return commitWeekly_(ctx, st, pd);
    if (pd.kind === 'remind') return commitReminders_(ctx, st, pd);
    if (/^sch/.test(pd.kind)) return commitSchedule_(ctx, st, pd);
    if (pd.kind === 'toggle') {
      var pr = programRow_(st.pid);
      var now = isYes_(pr.values[3]) ? OPT.YES : OPT.NO;
      if (now !== pd.old) return showMain_(ctx, st, '⚠️ تغيّرت الحالة في الورقة منذ العرض، أعد المحاولة.');
      pr.sh.getRange(pr.row, 4).setValue(pd.value);
      invalidateProgram_(st.pid); logChange_(ctx.from, st.pid, 'البرامج', st.pid, 'مفتوح للتسليم', pd.old, pd.value);
      return showMain_(ctx, st, '✅ تم: البرنامج الآن ' + (pd.value === OPT.YES ? 'مفتوح 🟢' : 'مغلق ⚪️'));
    }
    var sh = programSpreadsheet_(st.pid).getSheetByName(NAMES.SETTINGS);
    var values = sh.getDataRange().getValues();
    var plan;
    if (pd.kind === 'set') {
      plan = planEdit(values, pd.sec, pd.ref, pd.key, pd.value);
      if (!plan.error && String(plan.old) !== String(pd.old)) { invalidateProgram_(st.pid); return backTo_(ctx, st, '⚠️ تغيّرت القيمة في الورقة منذ عرضها (الآن: ' + display_(plan.old) + '). لم يُحفظ شيء؛ أعد المحاولة.'); }
    } else if (pd.kind === 'add') plan = planAdd(values, pd.sec, pd.obj);
    else if (pd.kind === 'clear') {
      plan = planClear(values, pd.sec, pd.ref);
      if (!plan.error && plan.old !== pd.old) { invalidateProgram_(st.pid); return backTo_(ctx, st, '⚠️ تغيّر الصف في الورقة منذ عرضه. لم يُحفظ شيء؛ أعد المحاولة.'); }
    }
    var err = validatePlan(values, plan);
    if (err) return backTo_(ctx, st, '⚠️ لم يُحفظ:\n' + err);
    writePlan_(sh, plan);
    invalidateProgram_(st.pid);
    var item = isGen_(pd.sec) ? '-' : (pd.sec === 'BANDS' ? (pd.old || (pd.obj && pd.obj.min + ' ' + pd.obj.label)) : (pd.ref || (pd.obj && pd.obj.title)));
    if (pd.kind === 'set') logChange_(ctx.from, st.pid, SECTIONS[pd.sec] || SECTIONS.GENERAL, item, fieldLabel(pd.sec, pd.key), pd.old, pd.value);
    if (pd.kind === 'add') logChange_(ctx.from, st.pid, SECTIONS[pd.sec], item, 'إضافة', '', pd.label);
    if (pd.kind === 'clear') logChange_(ctx.from, st.pid, SECTIONS[pd.sec], item, 'حذف', pd.old, '');
    if (pd.kind === 'add' && pd.sec !== 'BANDS') st.ref = itemRef_(pd.obj);
    if (pd.kind === 'set' && pd.key === 'level') st.ref = refWithLevel_(pd.ref, pd.value);
    if (pd.kind === 'add' && pd.sec === 'BANDS') delete st.ref;
    if (pd.kind === 'clear') delete st.ref;
    return backTo_(ctx, st, '✅ حُفظ في ورقة الإعدادات، ويستعمله بوت الطلاب فورًا.\n(لتحديث أوراق الدرجات اضغط «🧮 حساب الدرجات» من القائمة)');
  } finally {
    lock.releaseLock();
  }
}

function writePlan_(sh, plan) {
  if (plan.type === 'multi') { plan.plans.forEach(function (p) { writePlan_(sh, p); }); return; }
  if (plan.type === 'insGen') {
    // بند عام جديد: صف يُدرج بعد آخر بند عام (الجداول تحته تنزل صفًّا، وكل القراءة بالعناوين)
    sh.insertRowsAfter(plan.row, 1);
    sh.getRange(plan.row + 1, 1, 1, 3).setValues([plan.rowValues]);
    try {
      sh.getRange(plan.row + 1, 1).setFontWeight('bold').setBackground('#f3f6f8');
      sh.getRange(plan.row + 1, 3).setFontColor('#6b7780').setFontSize(9);
      if (plan.choices && plan.choices !== 'SHEETS') sh.getRange(plan.row + 1, 2).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(plan.choices, true).setAllowInvalid(false).build());
    } catch (e) { /* التنسيق اختياري */ }
    return;
  }
  if (plan.type === 'set' && plan.header) sh.getRange(plan.header.row + 1, plan.header.col + 1).setValue(plan.header.value).setFontWeight('bold').setBackground('#d9e7ee');
  if (plan.type === 'section') {
    var w = Math.max.apply(null, plan.rows.map(function (r) { return r.length || 1; }));
    sh.getRange(plan.row + 1, 1, plan.rows.length, w).setValues(plan.rows.map(function (r) { r = r.slice(); while (r.length < w) r.push(''); return r; }));
    sh.getRange(plan.row + 2, 1, 1, 11).setBackground('#1f4e5f').setFontColor('#ffffff').setFontWeight('bold');
    sh.getRange(plan.row + 3, 1, 1, w).setBackground('#d9e7ee').setFontWeight('bold');
  }
  if (plan.type === 'set') sh.getRange(plan.row + 1, plan.col + 1).setValue(plan.value);
  else if (plan.type === 'add') {
    if (plan.insert) sh.insertRowBefore(plan.row + 1);
    sh.getRange(plan.row + 1, 1, 1, plan.rowValues.length).setValues([plan.rowValues]);
  } else if (plan.type === 'clear') sh.getRange(plan.row + 1, 1, 1, plan.width).clearContent();
}

/* ───────── البرامج والمشرفون ───────── */

function showAdmins_(ctx, st, notice) {
  if (st) { aReset_(st); aSave_(ctx.uid, st); }
  var names = {}; getPrograms_().forEach(function (p) { names[p.id] = p.name || p.id; });
  var list = readAdmins_();
  var lines = [(notice ? notice + '\n\n' : '') + '👥 المشرفون', '• المالك: ' + ownerId_() + ' (كل الصلاحيات)'].concat(list.map(function (a) {
    return '• ' + a.name + ' (' + a.id + ') — ' + (a.programs.length ? a.programs.map(function (x) { return names[x] || x; }).join('، ') : 'كل البرامج');
  }));
  if (!list.length) lines.push('— لا مشرفين بعد —');
  var kb = [[{ text: '➕ إضافة مشرف', callback_data: 'ADMADD' }]];
  list.forEach(function (a) { kb.push([{ text: '🗑 حذف ' + (a.name || a.id), callback_data: 'ADMDEL:' + a.id }]); });
  kb.push([{ text: BACK, callback_data: st && st.pid ? 'M' : 'L' }]);
  return show_(ctx, lines.join('\n'), kb);
}

function askAdmin_(ctx, st) {
  aReset_(st);
  var cur = currentProgram_(ctx, st);
  return ask_(ctx, st, 'admin', {
    title: '➕ إضافة مشرف: أرسل معرّفه الرقمي ثم اسمه في رسالة واحدة.',
    format: '<المعرّف> <الاسم>', example: '469340718 خديجة', back: 'ADM',
    note: 'يحصل المشرف على معرّفه بإرسال /myid إلى هذا البوت.\nالبرامج تختارها بالأزرار في الخطوة التالية' + (cur ? ' (المختار مبدئيًا: «' + (cur.name || cur.id) + '»)' : '') +
      '، ويمكنك أيضًا كتابة اسم البرنامج في آخر الرسالة، مثل: 469340718 خديجة ' + ((getPrograms_()[0] || {}).name || 'البرنامج الأول')
  });
}

function addAdminStep_(ctx, st, text) {
  var progs = getPrograms_();
  var r = parseAdminInput(text, progs, ownerId_());
  if (r.error) return bad_(ctx, st, r.error);
  var programs = r.programs, all = !!r.all;
  if (!programs) {
    var cur = currentProgram_(ctx, st);
    programs = cur ? [cur.id] : (progs.length === 1 ? [progs[0].id] : []);
  }
  var existing = readAdmins_().some(function (a) { return a.id === r.id; });
  st.pending = { kind: 'admadd', id: r.id, name: r.name, programs: programs, all: all, replace: existing, back: 'ADM' };
  delete st.await; delete st.prompt; aSave_(ctx.uid, st);
  return showAdminDraft_(ctx, st, existing ? 'ℹ️ هذا المعرّف مشرف من قبل؛ التأكيد يحدّث اسمه وبرامجه.' : '');
}

function programsLabel_(pd) {
  if (pd.all) return 'كل البرامج (ومنها القادمة)';
  var names = {}; getPrograms_().forEach(function (p) { names[p.id] = p.name || p.id; });
  return pd.programs.length ? pd.programs.map(function (x) { return names[x] || x; }).join('، ') : '— لم يُختر —';
}

/** شاشة مراجعة المشرف الجديد: البرامج أزرار تُفعَّل وتُلغى، ثم «تأكيد» */
function showAdminDraft_(ctx, st, notice) {
  var pd = st.pending;
  var kb = getPrograms_().map(function (p) {
    var on = !pd.all && pd.programs.indexOf(p.id) >= 0;
    return [{ text: (on ? '✅ ' : '⬜ ') + (p.name || p.id), callback_data: 'APT:' + p.id }];
  });
  kb.push([{ text: (pd.all ? '✅ ' : '⬜ ') + '🌐 كل البرامج', callback_data: 'APT:*' }]);
  kb.push([{ text: '✅ تأكيد الإضافة', callback_data: 'OK' }, { text: CANCEL, callback_data: 'NO' }]);
  return show_(ctx, (notice ? notice + '\n\n' : '') + '➕ مراجعة المشرف قبل الحفظ:\n• الاسم: ' + pd.name + '\n• المعرّف: ' + pd.id +
    '\n• البرامج المسموحة: ' + programsLabel_(pd) + '\n\nاضغط على برنامج لإضافته أو إزالته، ثم «✅ تأكيد الإضافة».', kb);
}

function toggleAdminProgram_(ctx, st, pid) {
  var pd = st.pending;
  if (!pd || pd.kind !== 'admadd') return show_(ctx, 'انتهت هذه الخطوة. ابدأ من جديد.', [[{ text: '👥 المشرفون', callback_data: 'ADM' }]]);
  if (pid === '*') pd.all = !pd.all;
  else {
    pd.all = false;
    var i = pd.programs.indexOf(pid);
    if (i >= 0) pd.programs.splice(i, 1); else pd.programs.push(pid);
  }
  aSave_(ctx.uid, st);
  return showAdminDraft_(ctx, st);
}

/* ───────── الإجراءات ───────── */

function runCalc_(ctx, st, prog) {
  show_(ctx, '⏳ جارٍ حساب درجات «' + (prog.name || prog.id) + '»… (قد يستغرق دقيقة)');
  var lock = tenantLock_();
  lock.waitLock(25000);
  try {
    var out = calculateForSpreadsheet(programSpreadsheet_(st.pid), { write: true });
    try { putStandingSnapshot_(st.pid, out); } catch (e) { logError_(e, 'snapshot ' + st.pid); }
    emitEvent_(EVENT_TYPES.GRADE_UPDATED, st.pid, { source: 'admin', students: out.res.stats.students, passers: out.res.stats.passers }, ctx.uid); clearDirty_(st.pid);
    logChange_(ctx.from, st.pid, 'إجراء', 'حساب الدرجات', '', '', out.res.stats.passers + ' مجتاز');
    send_(ctx.chat, clip('✅ حُسبت الدرجات وكُتبت الأوراق.\n\n' + out.message), [[{ text: '⚙️ القائمة', callback_data: 'M' }]]);
  } catch (e) {
    logError_(e, 'calc ' + st.pid);
    send_(ctx.chat, '⚠️ تعذر الحساب:\n' + e.message, [[{ text: '⚙️ القائمة', callback_data: 'M' }]]);
  } finally { lock.releaseLock(); }
}

function runSummary_(ctx, st, prog) {
  try {
    var out = calculateForSpreadsheet(programSpreadsheet_(st.pid), { write: false });
    show_(ctx, buildProgramSummary(out.res, out.input.submissions, out.input.cfg, prog.name || prog.id), [[{ text: '⚙️ القائمة', callback_data: 'M' }]]);
  } catch (e) { logError_(e, 'summary ' + st.pid); show_(ctx, '⚠️ ' + e.message, [[{ text: '⚙️ القائمة', callback_data: 'M' }]]); }
}

function runLookup_(ctx, st, text) {
  try {
    var out = calculateForSpreadsheet(programSpreadsheet_(st.pid), { write: false });
    var r = studentReport(out.res, out.input.submissions, text, out.input.corrections);
    var kb = (r.submissions || []).slice(-6).reverse().map(function (x) {
      return [{ text: (x.fileId ? '📎 ' : '📝 ') + x.act + ' #' + x.n + (SUB_REJECTED.indexOf(x.status) >= 0 ? ' (مرفوض)' : ''), callback_data: 'V:' + x.row }];
    });
    kb.push([{ text: '🔎 بحث آخر', callback_data: 'FIND' }, { text: '⚙️ القائمة', callback_data: 'M' }]);
    show_(ctx, r.text, kb);
  } catch (e) { logError_(e, 'lookup ' + st.pid); show_(ctx, '⚠️ ' + e.message, [[{ text: '⚙️ القائمة', callback_data: 'M' }]]); }
}

function subsValues_(pid) {
  var sh = programSpreadsheet_(pid).getSheetByName(NAMES.SUBMISSIONS);
  return sh ? sh.getDataRange().getValues() : [];
}

function showLatest_(ctx, st) {
  var list = latestSubmissions(subsValues_(st.pid), 10);
  if (!list.length) return show_(ctx, 'لا توجد تسليمات بعد.', [[{ text: '⚙️ القائمة', callback_data: 'M' }]]);
  var lines = list.map(function (s, i) {
    return (i + 1) + ') ' + s.act + ' #' + s.n + ' — ' + (s.name || s.email) + ' — ' + s.type + (s.points !== '' ? ' (+' + s.points + ')' : '') +
      (SUB_REJECTED.indexOf(s.status) >= 0 ? ' ❌' : '') + (s.text ? '\n   «' + clip(s.text, 120).replace(/\n/g, ' ') + '»' : '');
  });
  var kb = rows_(list.map(function (s, i) { return { text: (s.fileId ? '📎 ' : '📝 ') + (i + 1), callback_data: 'V:' + s.row }; }), 5);
  kb.push([{ text: '⚙️ القائمة', callback_data: 'M' }]);
  return show_(ctx, '📥 آخر التسليمات:\n\n' + lines.join('\n') + '\n\nاضغط رقمًا لعرض التسليم كاملًا.', kb);
}

/** يعرض تسليمًا: النص كاملًا، والملف عبر نقله من بوت الطلاب إلى البوت الإداري (بلا درايف) */
function viewSubmission_(ctx, st, row) {
  var values = subsValues_(st.pid);
  if (!values[row - 1] || row < 2) return send_(ctx.chat, 'التسليم غير موجود.');
  var s = latestSubmissions([values[0], values[row - 1]], 1)[0];
  var head = s.act + ' #' + s.n + ' — ' + (s.name || '') + ' <' + s.email + '>';
  if (s.text) send_(ctx.chat, clip(head + '\n\n' + s.text));
  if (s.fileId) relayFile_(ctx, s, head);
  else if (!s.text) send_(ctx.chat, head + '\n(لا يوجد محتوى)');
}

/**
 * معرّف الملف (file_id) خاص ببوت الطلاب، فلا يستطيع البوت الإداري إرساله مباشرة.
 * لذلك: ينزّل بوت الطلاب الملف مؤقتًا (حتى 20MB) ويرفعه البوت الإداري — لا شيء يُحفظ في درايف.
 * وإن تعذر: ينسخ بوت الطلاب الرسالة الأصلية إلى المشرف (يلزم أن يكون المشرف ضغط /start في بوت الطلاب).
 */
function relayFile_(ctx, s, caption) {
  try {
    var f = tgAs_('student', 'getFile', { file_id: s.fileId }, true); // الملف الكبير يفشل هنا عادةً فننتقل للبديل
    if (f.ok && f.result && f.result.file_path) {
      var blob = UrlFetchApp.fetch('https://api.telegram.org/file/bot' + tokenFor_('student') + '/' + f.result.file_path).getBlob();
      blob.setName(s.fileName || String(f.result.file_path).split('/').pop());
      var r = tgMultipartAs_('admin', 'sendDocument', { chat_id: String(ctx.chat), caption: clip(caption, 1000), document: blob });
      if (r.ok) return true;
    }
  } catch (e) { logError_(e, 'relayFile'); }
  var c = tgAs_('student', 'copyMessage', { chat_id: ctx.from.id, from_chat_id: s.chatId, message_id: Number(s.messageId) });
  if (c.ok) { send_(ctx.chat, 'الملف كبير على النقل، فأُرسل إليك عبر بوت الطلاب.'); return true; }
  send_(ctx.chat, '⚠️ تعذر إرسال الملف (الحد 20MB للنقل). لاستلامه عبر بوت الطلاب افتح بوت الطلاب واضغط /start مرة واحدة ثم أعد المحاولة.');
  return false;
}

/** خطوة ما بعد الاسم (والمستوى) في إضافة مجموعة أو فعالية */
function afterTitle_(ctx, st) {
  var t = st.draft.title, lv = st.draft.level ? ' — ' + st.draft.level : '';
  if (st.sec === 'GROUPS') {
    delete st.await; delete st.prompt; st.addStep = 'rule'; st.choices = [OPT.G_MAX, OPT.G_SUM, OPT.G_AVG]; aSave_(ctx.uid, st);
    return show_(ctx, 'إضافة مجموعة «' + t + '»' + lv + ' (٢/٣) — طريقة الحساب:', [st.choices.map(function (c, i) { return { text: c, callback_data: 'C:' + i }; })].concat(nav_(backData_(st))));
  }
  return ask_(ctx, st, 'newPoints', { title: '➕ «' + t + '»' + lv + ' (٢/٣): كم درجة لكل تسليم؟', format: 'رقم موجب', example: '1', back: backData_(st) });
}

/** المرجع بعد تغيير المستوى: «العنوان (المستوى)» */
function refWithLevel_(ref, level) { var t = String(ref).replace(/ \([^()]*\)$/, ''); return t + (level ? ' (' + level + ')' : ''); }

/* ───────── (متعدد العملاء) برنامج جديد من قالب العميل: ملف تنشئه الخدمة بلا سكربت ───────── */
function newProgramStep_(ctx, st, text) {
  if (!ctx.adm.owner) { aReset_(st); aSave_(ctx.uid, st); return; }
  if (st.await === 'newName') {
    var name = str_(text).replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 60) return bad_(ctx, st, 'اكتب اسمًا من 2 إلى 60 حرفًا.');
    st.draft = { newName: name };
    st.await = 'newLevels';
    st.prompt = { title: '🆕 «' + name + '» (٢/٢): أسماء المستويات مفصولة بفاصلة، أو اضغط «بلا مستويات».', format: 'من 1 إلى 8 أسماء', example: 'المستوى الأول، المستوى الثاني', back: 'L' };
    aSave_(ctx.uid, st);
    return show_(ctx, promptText_(st.prompt), [[{ text: '➖ بلا مستويات', callback_data: 'NEWNOLV' }]].concat(nav_('L')));
  }
  var lv = text.split(/[,،\n]+/).map(function (s) { return str_(s).replace(/\s+/g, ' '); }).filter(String);
  if (!lv.length || lv.length > 8) return bad_(ctx, st, 'من 1 إلى 8 مستويات.');
  return newProgramCommit_(ctx, st, lv);
}

function newProgramCommit_(ctx, st, levels) {
  var name = st.draft.newName;
  var q = quotaError_(); if (q) { aReset_(st); aSave_(ctx.uid, st); return show_(ctx, q, [[{ text: BACK, callback_data: 'L' }]]); }
  var pid = 'p1', n = 1;
  while (getPrograms_().some(function (p) { return p.id === pid; })) pid = 'p' + (++n);
  show_(ctx, '⏳ جارٍ إنشاء ملف «' + name + '»…');
  var made;
  try { made = createProgramFromTemplate_({ name: name, levels: levels, reviewChatId: tenantConf_().reviewChatId || '' }); }
  catch (e) { logError_(e, 'new program'); return send_(ctx.chat, '⚠️ تعذر الإنشاء: ' + e.message, [[{ text: BACK, callback_data: 'L' }]]); }
  var reg = registerProgram_(pid, name, made.url, false, 'أُنشئ من القالب بالبوت الإداري');
  if (reg.error) return send_(ctx.chat, '⚠️ ' + reg.error, [[{ text: BACK, callback_data: 'L' }]]);
  logChange_(ctx.from, pid, 'البرامج', pid, 'إنشاء برنامج من القالب', '', made.url);
  st = { pid: pid }; aSave_(ctx.uid, st);
  return showMain_(ctx, st, '✅ أُنشئ «' + name + '» (' + pid + ') مغلقًا للتسليم.\n📄 ' + made.url + (made.shared.length ? '\nشُورك مع: ' + made.shared.join('، ') : '') + '\nالصق رابط ملف التسجيل في الإعدادات العامة ثم افتح التسليم.');
}

// ===== AdminCopy.gs =====
/**
 * AdminCopy.gs — «📋 نسخ برنامج» في البوت الإداري.
 * المصدر ← معرّف جديد ← الاسم ← ملف التسجيل ← مجموعة المراجعة (اختياري) ← مراجعة وتأكيد ← إنشاء.
 * للمالك وللمشرفين الذين صلاحيتهم «كل البرامج» (لأن البرنامج الجديد خارج قائمة المشرف المقيّد).
 * كل خطوة: الصيغة + مثال، وزرّا «رجوع» (للخطوة السابقة مع إبقاء ما أُدخل) و«إلغاء».
 */
var COPY_STEPS = ['id', 'name', 'reg', 'review'];

function canCopy_(adm) { return !!adm && (adm.owner || !adm.programs.length); }

/** يقترح التالي: prog1 ← prog2، «الدورة 1» ← «الدورة 2» */
function nextNumbered_(s, fallback) {
  var m = String(s || '').match(/^(.*?)(\d+)(\D*)$/);
  return m ? m[1] + (Number(m[2]) + 1) + m[3] : fallback;
}

function showCopySources_(ctx, st) {
  aReset_(st); delete st.sec; delete st.ref; aSave_(ctx.uid, st);
  var list = accessiblePrograms_(ctx);
  if (!list.length) return show_(ctx, 'لا توجد برامج لنسخها.', [[{ text: BACK, callback_data: 'L' }]]);
  var kb = list.map(function (p) { return [{ text: '📋 ' + (p.name || p.id), callback_data: 'CPS:' + p.id }]; });
  kb.push([{ text: BACK, callback_data: 'L' }]);
  return show_(ctx, '📋 نسخ برنامج\nيُنشأ ملف درجات جديد من برنامج موجود: الإعدادات كلها (الفعاليات والاختبارات والمجموعات والتقديرات ودرجة النجاح)، بلا أي بيانات طلاب. الحساب يتم مركزيًا في الخدمة، فلا سكربت في الملف.\n\nاختر البرنامج الذي تنسخ منه:', kb);
}

function startCopy_(ctx, st, pid) {
  var qc = quotaError_(); if (qc) return show_(ctx, qc, [[{ text: BACK, callback_data: 'L' }]]);
  var src = getPrograms_().filter(function (p) { return p.id === pid; })[0];
  if (!src || !canAccess_(ctx.adm, pid)) return show_(ctx, '⛔ البرنامج غير موجود أو لا تملك صلاحيته.', [[{ text: BACK, callback_data: 'CPY' }]]);
  aReset_(st); st.draft = { src: src.id, srcName: src.name || src.id, open: true };
  return askCopyStep_(ctx, st, 'id');
}

function askCopyStep_(ctx, st, step) {
  var d = st.draft || {};
  delete st.pending; delete st.choices;
  var i = COPY_STEPS.indexOf(step), back = i > 0 ? 'CPB:' + COPY_STEPS[i - 1] : 'CPY';
  var head = '📋 نسخ «' + d.srcName + '» (' + (i + 1) + '/4): ';
  if (step === 'id') return ask_(ctx, st, 'cpId', { title: head + 'أرسل معرّفًا قصيرًا للبرنامج الجديد.', format: 'حروف لاتينية وأرقام و _ بلا مسافات (من 2 إلى 30)',
    example: nextNumbered_(d.src, d.src + '2'), back: back, note: 'يُستعمل داخليًّا وفي أمر المجموعة /linkreview، ولا يتكرر بين البرامج.' });
  if (step === 'name') return ask_(ctx, st, 'cpName', { title: head + 'أرسل اسم البرنامج الجديد كما يظهر للطلاب.', format: 'نص من 2 إلى 60 حرفًا',
    example: nextNumbered_(d.srcName, d.srcName + ' 2'), back: back, note: 'المعرّف: ' + d.id + '\nسيُسمّى الملف «درجات <الاسم>».' });
  if (step === 'reg') return ask_(ctx, st, 'cpReg', { title: head + 'أرسل رابط ملف ردود استمارة التسجيل للدفعة الجديدة.', format: 'رابط Google Sheets (أو معرّف الملف)',
    example: 'https://docs.google.com/spreadsheets/d/1AbCdEf…/edit', back: back,
    note: 'هو ملف الردود (جدول البيانات) لا رابط النموذج نفسه. يجب أن يكون مشاركًا مع حساب الخدمة ' + serviceEmail_() + '، وفيه عمود بريد.' });
  st.await = 'cpReview';
  st.prompt = { title: head + 'معرّف مجموعة مراجعة التسليمات (اختياري).', format: 'رقم سالب كما هو: المجموعة العادية بلا -100، والكبرى (supergroup) تبدأ بـ -100',
    example: '-1001234567890', back: back,
    note: 'يجب أن يكون بوت الطلاب عضوًا فيها. الأسهل أن تتخطى الآن ثم ترسل داخل المجموعة: /linkreview ' + d.id };
  aSave_(ctx.uid, st);
  return show_(ctx, promptText_(st.prompt), [[{ text: '⏭ تخطي (أربطها لاحقًا)', callback_data: 'CPSKIP' }]].concat(nav_(back)));
}

function onCopyText_(ctx, st, text) {
  var d = st.draft || {};
  if (!d.src) { aReset_(st); aSave_(ctx.uid, st); return send_(ctx.chat, 'انتهت هذه الخطوة. اضغط /start للقائمة.'); }
  var a = st.await;
  if (a === 'cpId') {
    var id = latinDigits_(str_(text)).replace(/[\u200B-\u200F\u061C]/g, '');
    if (/\s/.test(id)) return bad_(ctx, st, 'المعرّف بلا مسافات. اكتب «' + id.replace(/\s+/g, '_') + '» مثلًا.');
    if (!/^[A-Za-z0-9_]{2,30}$/.test(id)) return bad_(ctx, st, '«' + clip(id, 40) + '» غير صالح: المعرّف يُكتب بحروف لاتينية وأرقام و _ فقط (من 2 إلى 30).');
    var taken = getPrograms_().filter(function (p) { return p.id.toLowerCase() === id.toLowerCase(); })[0];
    if (taken) return bad_(ctx, st, 'المعرّف «' + id + '» مستعمل لبرنامج «' + (taken.name || taken.id) + '». اختر معرّفًا آخر.');
    d.id = id; st.draft = d;
    return askCopyStep_(ctx, st, 'name');
  }
  if (a === 'cpName') {
    var name = str_(text).replace(/\s+/g, ' ');
    if (name.length < 2) return bad_(ctx, st, 'الاسم قصير جدًا.');
    if (name.length > 60) return bad_(ctx, st, 'الاسم أطول من 60 حرفًا (' + name.length + ').');
    var dup = getPrograms_().filter(function (p) { return normKey_(p.name) === normKey_(name); })[0];
    if (dup) return bad_(ctx, st, 'الاسم «' + name + '» مستعمل لبرنامج «' + dup.id + '». اختر اسمًا آخر (مثلًا برقم الدفعة).');
    d.name = name; st.draft = d;
    return askCopyStep_(ctx, st, 'reg');
  }
  if (a === 'cpReg') {
    var rawId = extractSpreadsheetId(text);
    if (/docs\.google\.com\/forms/i.test(text)) return bad_(ctx, st, 'هذا رابط النموذج نفسه. أرسل رابط ملف ردوده: من النموذج ← «الردود» ← «عرض في جداول البيانات».');
    var progs = getPrograms_(), asGrades = progs.filter(function (p) { return p.ssId === rawId; })[0];
    if (asGrades) return bad_(ctx, st, 'هذا ملف درجات برنامج «' + (asGrades.name || asGrades.id) + '»، لا ملف تسجيل.');
    var g = {};
    try { var srcCfg = loadProgram_(d.src); if (srcCfg) g = srcCfg.general; } catch (e) { g = {}; }
    var reg = inspectRegistration(text, g.regSheet, g);
    if (reg.error) return bad_(ctx, st, reg.error);
    var notes = [];
    if (extractSpreadsheetId(g.regSpreadsheetId) === reg.id) notes.push('⚠️ هذا ملف تسجيل «' + d.srcName + '» نفسه؛ سيُقبل طلاب الدفعة السابقة في البرنامج الجديد.');
    if (reg.sheetChanged) notes.push('ℹ️ لا توجد ورقة «' + g.regSheet + '» في الملف، فستُستعمل ورقة «' + reg.sheet + '».');
    if (reg.warning) notes.push('⚠️ ' + reg.warning);
    d.regId = reg.id; d.regTitle = reg.title; d.regSheet = reg.sheet; d.regRows = reg.rows; d.regNotes = notes; st.draft = d;
    return askCopyStep_(ctx, st, 'review');
  }
  if (a === 'cpReview') {
    var v = latinDigits_(str_(text)).replace(/[\u200B-\u200F\u061C\s]/g, '').replace(/^[−–]/, '-');
    if (/^\d{5,}$/.test(v)) return bad_(ctx, st, 'معرّف المجموعة يبدأ بعلامة السالب. جرّب: -' + v);
    if (!/^-\d{5,}$/.test(v)) return bad_(ctx, st, '«' + clip(text, 40) + '» ليس معرّف مجموعة. المعرّف رقم سالب طويل.');
    var chk = tgAs_('student', 'getChat', { chat_id: v }, true);
    if (!chk.ok) {
      var alt = /^-100/.test(v) ? '-' + v.slice(4) : '-100' + v.slice(1);
      return bad_(ctx, st, 'بوت الطلاب لا يجد هذه المجموعة (' + clip(String(chk.description || 'chat not found'), 80) + ').\nتأكد أنه عضو فيها، أو جرّب ' + alt + '، أو اضغط «تخطي» واربطها لاحقًا بـ /linkreview داخل المجموعة.');
    }
    d.review = v; d.reviewTitle = chk.result && chk.result.title ? String(chk.result.title) : ''; st.draft = d;
    return showCopyConfirm_(ctx, st);
  }
  aReset_(st); aSave_(ctx.uid, st);
  return send_(ctx.chat, 'انتهت هذه الخطوة. اضغط /start للقائمة.');
}

function showCopyConfirm_(ctx, st, notice) {
  var d = st.draft;
  delete st.await; delete st.prompt;
  st.pending = { kind: 'copyprog', back: 'L' };
  aSave_(ctx.uid, st);
  var openOthers = getPrograms_().filter(function (p) { return p.open; }).length;
  var lines = [(notice ? notice + '\n\n' : '') + '📋 مراجعة النسخ قبل الإنشاء:',
    '• المصدر: «' + d.srcName + '»',
    '• المعرّف الجديد: ' + d.id,
    '• الاسم: ' + d.name,
    '• ملف التسجيل: «' + d.regTitle + '» — ورقة «' + d.regSheet + '» (' + d.regRows + ' ردًّا الآن)',
    '• مجموعة المراجعة: ' + (d.review ? d.review + (d.reviewTitle ? ' «' + d.reviewTitle + '»' : '') : 'لا شيء الآن (اربطها لاحقًا بـ /linkreview ' + d.id + ')'),
    '• التسليم: ' + (d.open ? '🟢 مفتوح فور الإنشاء' : '⚪️ مغلق (تفتحه لاحقًا بزر «🔓 فتح التسليم»)')];
  (d.regNotes || []).forEach(function (n) { lines.push(n); });
  if (d.open && openOthers) lines.push('ℹ️ مع وجود أكثر من برنامج مفتوح، يختار الطالب البرنامج أولًا في بوت الطلاب.');
  lines.push('', 'سيُنشأ ملف «درجات ' + d.name + '» في مجلد ملف المصدر بنسخة من الإعدادات والسكربت، وتُفرَّغ أوراق الطلاب (التسليمات، Grades، المجتازين، ردود الاختبارات، البريد غير المطابق…).');
  return show_(ctx, lines.join('\n'), [
    [{ text: '✅ إنشاء النسخة', callback_data: 'OK' }, { text: CANCEL, callback_data: 'NO' }],
    [{ text: d.open ? '⚪️ اجعله مغلقًا عند الإنشاء' : '🟢 اجعله مفتوحًا عند الإنشاء', callback_data: 'CPO' }],
    [{ text: BACK, callback_data: 'CPB:review' }]
  ]);
}

/** النسخ خارج القفل، والتسجيل في «البرامج» داخل قفل قصير */
function commitCopy_(ctx, st) {
  var d = st.draft;
  if (!d || !d.src || !d.id || !d.regId) return show_(ctx, 'انتهت هذه الخطوة. ابدأ النسخ من جديد.', [[{ text: '🗂 البرامج', callback_data: 'L' }]]);
  cache_().remove('progs');
  var progs = getPrograms_();
  if (progs.some(function (p) { return p.id.toLowerCase() === d.id.toLowerCase(); })) {
    send_(ctx.chat, '⚠️ أُضيف برنامج بالمعرّف «' + d.id + '» قبل قليل. اختر معرّفًا آخر.');
    ctx.edit = null; delete d.id;
    return askCopyStep_(ctx, st, 'id');
  }
  var src = progs.filter(function (p) { return p.id === d.src; })[0];
  if (!src) return show_(ctx, '⚠️ البرنامج المصدر لم يعد موجودًا.', [[{ text: '🗂 البرامج', callback_data: 'L' }]]);
  show_(ctx, '⏳ جارٍ إنشاء نسخة «' + d.name + '» من «' + d.srcName + '»… (قد يستغرق نصف دقيقة)');
  var res;
  try {
    res = copyProgramSpreadsheet(src.ssId, { name: d.name, regId: d.regId, regSheet: d.regSheet, reviewChatId: d.review || '' });
  } catch (e) {
    logError_(e, 'copy ' + d.src + ' → ' + d.id);
    var auth = /authoriz|permission|DriveApp|صلاحي|تفويض/i.test(String(e.message));
    st.pending = { kind: 'copyprog', back: 'L' }; aSave_(ctx.uid, st);
    return send_(ctx.chat, '⚠️ تعذر إنشاء النسخة ولم يُسجَّل أي برنامج:\n' + clip(e.message, 600) +
      (auth ? '\n\nيبدو أن حساب الخدمة لم يُفوَّض لدرايف بعد: على مزوّد الخدمة تشغيل الدالة authorizeDrive مرة واحدة في المشروع المركزي، ثم اضغط «✅ إنشاء النسخة» مجددًا.' : '\n\nيمكنك المحاولة مرة أخرى.'),
      [[{ text: '🔁 إعادة المحاولة', callback_data: 'OK' }, { text: CANCEL, callback_data: 'NO' }]]);
  }
  // التسجيل في «البرامج» داخل قفل قصير (النسخ نفسه خارجه حتى لا تنتظر تسليمات الطلاب)
  var lock = tenantLock_();
  lock.waitLock(25000);
  try {
    cache_().remove('progs');
    var qx = quotaError_();
    if (qx) { logError_(new Error('copy: quota reached after copy'), d.id + ' ' + res.url); return send_(ctx.chat, qx + '\n(أُنشئ الملف ' + res.url + ' ولم يُسجَّل.)', [[{ text: '🗂 البرامج', callback_data: 'L' }]]); }
    if (getPrograms_().some(function (p) { return p.id.toLowerCase() === d.id.toLowerCase(); })) {
      logError_(new Error('copy: id taken after copy'), d.id + ' ' + res.url);
      return send_(ctx.chat, '⚠️ أُنشئ الملف ' + res.url + ' لكن المعرّف «' + d.id + '» أُضيف لبرنامج آخر أثناء النسخ، فلم يُسجَّل. احذف هذا الملف ثم أعد النسخ بمعرّف آخر.', [[{ text: '🗂 البرامج', callback_data: 'L' }]]);
    }
    central_().getSheetByName(BOT.PROGRAMS).appendRow([d.id, d.name, res.url, d.open ? OPT.YES : OPT.NO, 'نُسخ من ' + d.src + ' بالبوت الإداري']);
    invalidateProgram_(d.id);
    logChange_(ctx.from, d.id, 'البرامج', d.id, 'نسخ برنامج', d.src, res.url);
  } finally { lock.releaseLock(); }
  var name = d.name, id = d.id, review = d.review;
  st = {}; aSave_(ctx.uid, st);
  var msg = ['✅ أُنشئ البرنامج «' + name + '» (' + id + ') ' + (d.open ? '🟢 مفتوحًا للتسليم' : '⚪️ مغلقًا') + '.',
    '📄 الملف: ' + res.url, '📁 المجلد: ' + res.folder, ''].concat(copySummaryLines(res));
  res.warnings.forEach(function (w) { msg.push('⚠️ ' + w); });
  if (res.shared && res.shared.length) msg.push('👥 شُورك مع: ' + res.shared.join('، '));
  msg.push('', 'الخطوات التالية:',
    '1) راجع الاختبارات في «الإعدادات»: اربط نماذج اختبارات الدفعة الجديدة بالملف (أو استعمل وحدة 📥 استيراد النتائج)، وبقية الإعدادات تعدّلها من هنا بزر «⚙️ إدارة».',
    '2) مجموعة المراجعة: ' + (review ? 'مربوطة بـ ' + review + '.' : 'أرسل داخل المجموعة: /linkreview ' + id),
    '3) الحساب يتم مركزيًا: زر «🧮 احسب الآن» أو تلقائيًا كل ساعة إن كان «الحساب التلقائي» مفعّلًا في 🧩 الوحدات.');
  return send_(ctx.chat, clip(msg.join('\n')), [[{ text: '⚙️ إدارة «' + name + '»', callback_data: 'P:' + id }], [{ text: '🗂 البرامج', callback_data: 'L' }]]);
}

/** أزرار النسخ (قبل التحقق من البرنامج الحالي) — يعيد undefined إن لم يكن الزر للنسخ */
function onCopyCallback_(ctx, st, cmd, arg) {
  if (['CPY', 'CPS', 'CPB', 'CPSKIP', 'CPO'].indexOf(cmd) < 0) return undefined;
  if (!canCopy_(ctx.adm)) return show_(ctx, '⛔ نسخ البرامج للمالك وللمشرفين الذين صلاحيتهم «كل البرامج».', [[{ text: BACK, callback_data: st.pid ? 'M' : 'L' }]]) || true;
  if (cmd === 'CPY') return showCopySources_(ctx, st) || true;
  if (cmd === 'CPS') return startCopy_(ctx, st, arg) || true;
  if (!st.draft || !st.draft.src) return show_(ctx, 'انتهت هذه الخطوة. ابدأ النسخ من جديد.', [[{ text: '📋 نسخ برنامج', callback_data: 'CPY' }]]) || true;
  if (cmd === 'CPB') return askCopyStep_(ctx, st, COPY_STEPS.indexOf(arg) >= 0 ? arg : 'id') || true;
  if (cmd === 'CPSKIP') { delete st.draft.review; delete st.draft.reviewTitle; return showCopyConfirm_(ctx, st) || true; }
  if (cmd === 'CPO') { st.draft.open = !st.draft.open; return showCopyConfirm_(ctx, st) || true; }
  return true;
}

// ===== AdminCore.gs =====
/**
 * AdminCore.gs — منطق خالص (بلا خدمات Google) للبوت الإداري:
 * مواضع الخلايا في ورقة «الإعدادات»، والتحقق من القيم، وخطط التعديل/الإضافة/الحذف،
 * ونصوص الملخص والبحث عن طالب.
 */

/**
 * الحقول القابلة للتعديل: [المفتاح، النوع، الخيارات].
 * تُبنى عند أول استعمال (لا عند التحميل) لأن Apps Script يحمّل الملفات بترتيب غير مضمون و OPT معرّف في Common.gs.
 */
var EDITABLE_CACHE_ = null;
function editable_() {
  if (EDITABLE_CACHE_) return EDITABLE_CACHE_;
  EDITABLE_CACHE_ = {
  GENERAL: [
    ['passMark', 'num'], ['passBasis', 'choice', [OPT.BASIS_TOTAL, OPT.BASIS_BASIC]], ['finalRequired', 'yesno'],
    ['extrasCap', 'numOpt'], ['finalCap', 'numOpt'],
    ['studentBase', 'choice', [OPT.BASE_ACTIVE, OPT.BASE_ALL, OPT.BASE_FINAL]],
    ['programName', 'text'], ['botWelcome', 'textOpt'], ['reviewChatId', 'textOpt'],
    ['regSpreadsheetId', 'textOpt'], ['regSheet', 'textOpt'], ['regFormUrl', 'textOpt'], ['restDays', 'textOpt'],
    ['levelPassRule', 'choice', [OPT.LV_BOTH, OPT.LV_EACH, OPT.LV_TOTAL]], ['overallPassMark', 'numOpt'], ['levelPassers', 'yesno']
  ],
  ACTIVITIES: [
    ['points', 'num'], ['maxCount', 'intOpt'], ['maxPoints', 'numOpt'], ['bot', 'yesno'],
    ['accepts', 'choice', [OPT.ACC_ANY, OPT.ACC_TEXT, OPT.ACC_FILE]], ['instructions', 'textOpt'],
    ['type', 'choice', [OPT.EXTRA, OPT.BASIC]], ['min', 'numOpt'], ['group', 'group'], ['order', 'numOpt'], ['level', 'level']
  ],
  COMPONENTS: [
    ['attempts', 'choice', [OPT.FIRST, OPT.HIGHEST, OPT.LAST]], ['group', 'group'],
    ['type', 'choice', [OPT.BASIC, OPT.EXTRA]], ['max', 'numOpt'], ['min', 'numOpt'], ['order', 'numOpt'], ['enabled', 'yesno'], ['level', 'level']
  ],
  GROUPS: [
    ['rule', 'choice', [OPT.G_MAX, OPT.G_SUM, OPT.G_AVG]], ['type', 'choice', [OPT.BASIC, OPT.EXTRA]],
    ['max', 'numOpt'], ['min', 'numOpt'], ['order', 'numOpt'], ['level', 'level']
  ],
  BANDS: [['min', 'num'], ['label', 'text']],
  LEVELS: [['passMark', 'numOpt'], ['order', 'numOpt']],
  // صفحتان من القسم العام نفسه (v6): خيارات الطلاب والتقرير الأسبوعي
  STUDENT: [['showSubs', 'yesno'], ['allowEdit', 'yesno'], ['allowDelete', 'yesno'], ['editWindow', 'numOpt'],
    ['showGrades', 'yesno'], ['adminAddStudent', 'yesno'], ['rejectButtons', 'yesno'], ['notifyReject', 'yesno']],
  WEEKLY: [['weeklyDay', 'choice', WEEK_DAYS_JS.slice(6).concat(WEEK_DAYS_JS.slice(0, 6))], ['weeklyHour', 'hour'],
    ['weeklyTo', 'choice', ['المالك', 'المالك والمشرفون']], ['weeklyLow', 'int0']],
  // التذكيرات الآلية (v7): الخيارات والنصوص (المفتاح العام «remindersOn» يُفعَّل بزره الخاص لأنه ينشئ المشغّل)
  REMIND: [['remOpen', 'yesno'], ['remBefore', 'yesno'], ['remOffsets', 'offsets'], ['remMissed', 'yesno'],
    ['remRisk', 'yesno'], ['remRiskAt', 'pct'], ['remRiskGap', 'num'], ['remIdle', 'yesno'], ['remIdleDays', 'int1'],
    ['remHour', 'hour'], ['remQuiet', 'quiet'], ['remSummary', 'choice', ['المالك', 'المالك والمشرفون', 'لا أحد']],
    ['programStart', 'date'], ['programEnd', 'date']],
  REMTPL: [['tplOpen', 'template'], ['tplBefore', 'template'], ['tplMissed', 'template'], ['tplRisk', 'template'], ['tplIdle', 'template'], ['tplManual', 'template']]
  };
  return EDITABLE_CACHE_;
}

var CLEAR_WORDS = ['-', 'فارغ', 'بدون', 'حذف', 'لا شيء', 'لايوجد', 'لا يوجد'];

/** أقسام تُكتب في القسم العام من الورقة (عمودا البند والقيمة) */
function isGen_(sec) { return sec === 'GENERAL' || sec === 'STUDENT' || sec === 'WEEKLY' || sec === 'REMIND' || sec === 'REMTPL'; }

/** أعمدة جداول تُضاف رؤوسها عند أول تعديل إن غابت من ورقة قديمة */
var LAZY_COLUMNS = ['level', 'pausedFrom', 'pausedUntil'];

function fieldSpec(sec, key) {
  return (editable_()[sec] || []).filter(function (f) { return f[0] === key; })[0] || null;
}

function fieldLabel(sec, key) {
  var src = isGen_(sec) ? GENERAL_FIELDS.map(function (f) { return [f[0], f[1]]; }) : TABLE_FIELDS[sec];
  var f = (src || []).filter(function (x) { return x[0] === key; })[0];
  return f ? f[1] : key;
}

/** مواضع الأقسام والصفوف في ورقة الإعدادات (فهارس تبدأ من 0) */
function settingsLayout(values) {
  var L = { general: {}, tables: {} }, sec = null;
  for (var r = 0; r < values.length; r++) {
    var row = values[r] || [];
    var k = sectionKeyOf_(row[0]);
    if (k) {
      sec = k;
      if (k !== 'GENERAL') {
        var hdr = values[r + 1] || [], cm = {};
        TABLE_FIELDS[k].forEach(function (f) {
          for (var c = 0; c < hdr.length; c++) if (str_(hdr[c]) === f[1]) { cm[f[0]] = c; break; }
        });
        L.tables[k] = { titleRow: r, headerRow: r + 1, colMap: cm, rows: [], blanks: [], width: TABLE_FIELDS[k].length };
        r++;
      }
      continue;
    }
    if (!sec) continue;
    if (sec === 'GENERAL') {
      GENERAL_FIELDS.forEach(function (f) { if (f[1] === str_(row[0])) L.general[f[0]] = r; });
      continue;
    }
    var T = L.tables[sec];
    if (row.every(isBlank_)) { T.blanks.push(r); continue; }
    var d = {};
    Object.keys(T.colMap).forEach(function (key) { d[key] = row[T.colMap[key]]; });
    T.rows.push({ r: r, data: d });
  }
  return L;
}

/** مرجع عنصر في البوت: العنوان، ومعه المستوى إن وُجد (العنوان نفسه قد يتكرر في مستويين) */
function itemRef_(data) { var l = str_(data.level); return str_(data.title) + (l ? ' (' + l + ')' : ''); }

/** عناصر قسم كما هي في الورقة (مع المعطّل) */
function sectionItems(values, sec) {
  var T = settingsLayout(values).tables[sec];
  if (!T) return [];
  return T.rows.filter(function (x) {
    return sec === 'BANDS' ? (num_(x.data.min) != null || str_(x.data.label)) : str_(x.data.title);
  });
}

function findItem_(L, sec, ref) {
  var T = L.tables[sec];
  if (!T) return null;
  return T.rows.filter(function (x) { return sec === 'BANDS' ? x.r === ref : itemRef_(x.data) === ref; })[0] || null;
}

/** يتحقق من قيمة أدخلها المشرف ويحولها للقيمة التي تُكتب في الورقة */
function validateInput(sec, key, raw, ctx) {
  var spec = fieldSpec(sec, key);
  if (!spec) return { ok: false, error: 'هذا الحقل غير قابل للتعديل.' };
  var kind = spec[1], s = str_(raw);
  var clear = CLEAR_WORDS.indexOf(s) >= 0 || s === '';
  function bad(m) { return { ok: false, error: m }; }
  switch (kind) {
    case 'num': {
      var n = num_(s);
      if (n == null || n < 0 || !/^[\s\d٠-٩۰-۹.,٫]+$/.test(s)) return bad('أدخل رقمًا موجبًا، مثل 1 أو 2.5');
      return { ok: true, value: n };
    }
    case 'numOpt': case 'intOpt': {
      if (clear) return { ok: true, value: '' };
      var m = num_(s);
      if (m == null || m < 0 || !/^[\s\d٠-٩۰-۹.,٫]+$/.test(s)) return bad('أدخل رقمًا موجبًا، أو «-» لترك الحقل فارغًا (بلا حد).');
      if (kind === 'intOpt' && (m < 1 || Math.floor(m) !== m)) return bad('أدخل عددًا صحيحًا 1 أو أكثر، أو «-» لبلا حد.');
      return { ok: true, value: m };
    }
    case 'text':
      if (clear) return bad('هذا الحقل لا يكون فارغًا.');
      if (s.length > (key === 'label' || key === 'title' ? 60 : 1500)) return bad('النص أطول من المسموح.');
      return { ok: true, value: s };
    case 'textOpt':
      if (s.length > 1500) return bad('النص أطول من المسموح (1500 حرف).');
      return { ok: true, value: clear ? '' : s };
    case 'hour': {
      var hv = num_(s);
      if (hv == null || !/^\s*[\d٠-٩۰-۹]{1,2}\s*$/.test(s) || hv > 23) return bad('أدخل ساعة من 0 إلى 23 بنظام 24 ساعة، مثل 20 للثامنة مساءً.');
      return { ok: true, value: hv };
    }
    case 'int0': {
      var iv = num_(s);
      if (iv == null || !/^\s*[\d٠-٩۰-۹]+\s*$/.test(s)) return bad('أدخل عددًا صحيحًا 0 أو أكثر، مثل 1.');
      return { ok: true, value: iv };
    }
    case 'yesno':
      if (s !== OPT.YES && s !== OPT.NO) return bad('القيمة يجب أن تكون نعم أو لا.');
      return { ok: true, value: s };
    case 'choice':
      if (spec[2].indexOf(s) < 0) return bad('اختر إحدى القيم: ' + spec[2].join('، '));
      return { ok: true, value: s };
    case 'level': {
      if (clear || s === OPT_NO_LEVEL) return { ok: true, value: '' };
      var lv = (ctx && ctx.levels) || [];
      if (lv.indexOf(s) < 0) return bad('المستوى «' + s + '» غير معرّف. المستويات: ' + (lv.join('، ') || '— (أضفها أولًا من «🪜 المستويات»)'));
      return { ok: true, value: s };
    }
    case 'offsets': {
      var po = parseOffsets(s);
      if (po.error) return bad(po.error);
      return { ok: true, value: clear ? '-' : po.map(function (o) { return o.label; }).join('، ') };
    }
    case 'quiet': {
      var pq = parseQuiet(s);
      if (pq && pq.error) return bad(pq.error);
      return { ok: true, value: pq ? pq.from + ' إلى ' + pq.to : '-' }; // لا «23-8»: قد تحوّله الورقة إلى تاريخ
    }
    case 'date': {
      if (clear) return { ok: true, value: '' };
      var dv = dateValue_(s);
      if (dv == null || dv === undefined) return bad('التاريخ غير مفهوم. اكتب سنة-شهر-يوم وساعة اختيارية، مثل 2026-11-20 أو 2026-11-20 18:00، أو «-» لتركه فارغًا.');
      var ft = fmtTime(dv);
      return { ok: true, value: /00:00$/.test(ft) ? ft.slice(0, 10) : ft };
    }
    case 'template': {
      var raw2 = String(raw == null ? '' : raw).replace(/\r/g, '').trim();
      var te = checkTemplate(raw2);
      if (te) return bad(te);
      return { ok: true, value: raw2 };
    }
    case 'pct': {
      var pv = num_(s);
      if (pv == null || pv < 1 || pv > 100 || !/^[\s\d٠-٩۰-۹.,٫%٪]+$/.test(s)) return bad('أدخل نسبة من 1 إلى 100، مثل 50 (أي بعد منتصف مدة البرنامج).');
      return { ok: true, value: pv };
    }
    case 'int1': {
      var i1 = num_(s);
      if (i1 == null || i1 < 1 || Math.floor(i1) !== i1 || !/^\s*[\d٠-٩۰-۹]+\s*$/.test(s)) return bad('أدخل عددًا صحيحًا 1 أو أكثر، مثل 7.');
      return { ok: true, value: i1 };
    }
    case 'group': {
      if (clear || s === 'بلا مجموعة') return { ok: true, value: '' };
      var groups = (ctx && ctx.groups) || [];
      if (groups.indexOf(s) < 0) return bad('المجموعة غير معرّفة. المجموعات: ' + (groups.join('، ') || '—'));
      return { ok: true, value: s };
    }
  }
  return bad('نوع حقل غير معروف.');
}

/** خطة تعديل خلية واحدة */
function planEdit(values, sec, ref, key, value) {
  var L = settingsLayout(values);
  if (isGen_(sec)) {
    var r = L.general[key];
    if (r == null) {
      // بند جديد غائب من ورقة قديمة: يُدرج صفه بعد آخر بند عام (لا يمس غيره). القيمة الفعلية الآن = الافتراضية.
      var gf = GENERAL_FIELDS.filter(function (f) { return f[0] === key; })[0], mg = missingGeneralRows(values);
      if (!gf || !mg.hasGeneral) return { error: 'البند «' + fieldLabel(sec, key) + '» غير موجود في ورقة الإعدادات.' };
      return { type: 'insGen', row: mg.afterRow, rowValues: [gf[1], value, gf[4]], old: gf[2], value: value, choices: gf[3] };
    }
    return { type: 'set', row: r, col: 1, old: valueOrBlank_(values[r][1]), value: value };
  }
  var it = findItem_(L, sec, ref);
  if (!it) return { error: 'العنصر غير موجود (ربما عُدّلت الورقة). حدّث القائمة.' };
  var T = L.tables[sec], col = T.colMap[key];
  if (col == null && LAZY_COLUMNS.indexOf(key) >= 0 && TABLE_FIELDS[sec].some(function (f) { return f[0] === key; })) {
    // ورقة أقدم بلا هذا العمود («المستوى» أو «موقوف من/حتى»): يُضاف رأسه في أول عمود بعد رؤوس الجدول
    var w = 0; Object.keys(T.colMap).forEach(function (k) { w = Math.max(w, T.colMap[k] + 1); });
    return { type: 'set', row: it.r, col: w, old: '', value: value, header: { row: T.headerRow, col: w, value: fieldLabel(sec, key) } };
  }
  if (col == null) return { error: 'عمود «' + fieldLabel(sec, key) + '» غير موجود في جدول ' + SECTIONS[sec] + '. اختر «تحديث ورقة الإعدادات» من قائمة «أدوات الدرجات» في ملف البرنامج.' };
  return { type: 'set', row: it.r, col: col, old: valueOrBlank_(values[it.r][col]), value: value };
}

/** خطة إضافة صف إلى جدول (في أول صف فارغ داخل القسم، أو بإدراج صف) */
function planAdd(values, sec, obj) {
  var L = settingsLayout(values), T = L.tables[sec];
  if (!T && sec === 'LEVELS') {
    // ورقة أقدم بلا جدول «المستويات»: يُضاف القسم في آخر الورقة (عنوان + رؤوس + الصف الجديد)
    var F = TABLE_FIELDS.LEVELS, rv = F.map(function (f) { return obj[f[0]] == null ? '' : obj[f[0]]; });
    return { type: 'section', row: values.length, rows: [[], ['▌ ' + SECTIONS.LEVELS], F.map(function (f) { return f[1]; }), rv] };
  }
  if (!T) return { error: 'القسم ' + SECTIONS[sec] + ' غير موجود في الورقة.' };
  var width = 0;
  Object.keys(T.colMap).forEach(function (k) { width = Math.max(width, T.colMap[k] + 1); });
  var rowValues = [];
  for (var c = 0; c < width; c++) rowValues.push('');
  Object.keys(obj).forEach(function (k) { if (T.colMap[k] != null) rowValues[T.colMap[k]] = obj[k]; });
  var lastData = T.rows.length ? T.rows[T.rows.length - 1].r : T.headerRow;
  var blank = T.blanks.filter(function (b) { return b > lastData; })[0];
  if (blank != null) return { type: 'add', row: blank, insert: false, rowValues: rowValues };
  return { type: 'add', row: lastData + 1, insert: true, rowValues: rowValues };
}

/** خطة حذف صف (للتقديرات): يُفرّغ الصف */
function planClear(values, sec, ref) {
  var L = settingsLayout(values), it = findItem_(L, sec, ref);
  if (!it) return { error: 'العنصر غير موجود (ربما عُدّلت الورقة).' };
  var w = 0; Object.keys(L.tables[sec].colMap).forEach(function (k) { w = Math.max(w, L.tables[sec].colMap[k] + 1); });
  return { type: 'clear', row: it.r, width: w, old: (values[it.r] || []).slice(0, w).join(' | ') };
}

function valueOrBlank_(v) { return v == null ? '' : v; }

/** يطبق الخطة على نسخة من القيم (للتحقق قبل الكتابة) */
function applyPlanToValues(values, plan) {
  var v = values.map(function (r) { return (r || []).slice(); });
  if (plan.type === 'set') {
    while (v[plan.row].length <= plan.col) v[plan.row].push('');
    v[plan.row][plan.col] = plan.value;
    if (plan.header) { while (v[plan.header.row].length <= plan.header.col) v[plan.header.row].push(''); v[plan.header.row][plan.header.col] = plan.header.value; }
  }
  else if (plan.type === 'insGen') v.splice(plan.row, 0, plan.rowValues.slice());
  else if (plan.type === 'multi') return plan.plans.reduce(function (acc, p) { return applyPlanToValues(acc, p); }, v);
  else if (plan.type === 'section') plan.rows.forEach(function (r) { v.push(r.slice()); });
  else if (plan.type === 'add') {
    if (plan.insert) v.splice(plan.row, 0, plan.rowValues.slice());
    else plan.rowValues.forEach(function (x, c) { v[plan.row][c] = x; });
  } else if (plan.type === 'clear') { for (var c = 0; c < plan.width; c++) v[plan.row][c] = ''; }
  return v;
}

/** يرفض الخطة إن أنشأت أخطاء جديدة في الإعدادات */
function validatePlan(values, plan) {
  if (plan.error) return plan.error;
  if (plan.type === 'multi') { var pe = plan.plans.filter(function (p) { return p.error; })[0]; if (pe) return pe.error; }
  var before = parseSettings(values).errors;
  var after = parseSettings(applyPlanToValues(values, plan)).errors;
  var added = after.filter(function (e) { return before.indexOf(e) < 0; });
  return added.length ? added.join('\n') : null;
}

/** قائمة المجموعات المعرفة (لقوائم الاختيار)؛ level (اختياري) = مجموعات هذا المستوى فقط */
/**
 * إيقاف فعالية مؤقتًا أو إعادة تفعيلها: خطة تكتب «موقوف من» و«موقوف حتى» معًا (وتضيف رأسيهما إن غابا).
 * from/until: Date أو '' — كلاهما '' = متاحة الآن.
 */
function planPause(values, ref, from, until) {
  var p1 = planEdit(values, 'ACTIVITIES', ref, 'pausedFrom', from);
  if (p1.error) return p1;
  var p2 = planEdit(applyPlanToValues(values, p1), 'ACTIVITIES', ref, 'pausedUntil', until);
  if (p2.error) return p2;
  return { type: 'multi', plans: [p1, p2], old: [p1.old, p2.old] };
}

/** وصف حالة الإيقاف لعرضها للمشرف أو للطالب */
function pauseLabel(a, now) {
  var ps = pauseState(a, now);
  if (ps) return '⏸ موقوفة ' + (ps.until ? 'حتى ' + fmtTime(ps.until) : 'حتى يعاد تفعيلها');
  if (a && a.pausedFrom != null && now < a.pausedFrom) return '🗓 إيقاف مجدول من ' + fmtTime(a.pausedFrom) + (a.pausedUntil != null ? ' حتى ' + fmtTime(a.pausedUntil) : '');
  return '';
}

/**
 * يحلل تاريخ الإيقاف الذي يكتبه المشرف: «2026-11-20» أو «2026-11-20 18:00» أو «20/11/2026»،
 * أو مدى «2026-11-20 إلى 2026-11-25» لجدولة الإيقاف مقدمًا. يعيد {from, until} (ms) أو {error}.
 */
function parsePauseInput(text, now) {
  var s = latinDigits_(str_(text)).replace(/\s+/g, ' ');
  var parts = s.split(/\s*(?:إلى|الى|حتى|->|—)\s*/);
  if (parts.length > 2) return { error: 'اكتب تاريخًا واحدًا، أو تاريخين بينهما «إلى».' };
  var a = dateValue_(parts[0]), b = parts.length === 2 ? dateValue_(parts[1]) : null;
  if (a == null || a === undefined || (parts.length === 2 && (b == null || b === undefined))) return { error: 'لم أفهم التاريخ «' + clip(text, 40) + '».' };
  if (parts.length === 1) {
    if (a <= now) return { error: 'التاريخ ' + fmtTime(a) + ' مضى. اكتب تاريخًا قادمًا.' };
    return { from: now, until: a };
  }
  if (b <= a) return { error: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية.' };
  if (b <= now) return { error: 'تاريخ النهاية ' + fmtTime(b) + ' مضى.' };
  return { from: Math.max(a, now), until: b };
}

function groupTitles(values, level) {
  return sectionItems(values, 'GROUPS').filter(function (x) { return level === undefined || str_(x.data.level) === str_(level); })
    .map(function (x) { return str_(x.data.title); });
}

var OPT_NO_LEVEL = 'بلا مستوى';

/** المستويات المعرّفة (من جدول «المستويات» ومن عمود «المستوى») بالترتيب */
function levelTitles(values) { return parseSettings(values).levels.map(function (l) { return l.title; }); }

function display_(v) { return v === '' || v == null ? '—' : String(v); }

/** نص يعرض عنصرًا بكل حقوله القابلة للتعديل */
function describeItem(values, sec, ref) {
  if (isGen_(sec)) {
    var L = settingsLayout(values);
    return editable_()[sec].map(function (f) {
      var r = L.general[f[0]], gf = GENERAL_FIELDS.filter(function (x) { return x[0] === f[0]; })[0];
      return '• ' + fieldLabel(sec, f[0]) + ': ' + (r == null ? display_(gf ? gf[2] : '') + ' (افتراضي)' : display_(values[r][1]));
    }).join('\n');
  }
  var it = findItem_(settingsLayout(values), sec, ref);
  if (!it) return null;
  return editable_()[sec].map(function (f) { return '• ' + fieldLabel(sec, f[0]) + ': ' + display_(it.data[f[0]]); }).join('\n');
}

/* ───────── أعمدة سجل التسليمات ───────── */
function subIndex_(header) {
  var ix = {};
  SUB_HEADERS.forEach(function (h) { ix[h] = header.indexOf(h); });
  return ix;
}

/** ملخص البرنامج من نتيجة المحرك وسجل التسليمات */
function buildProgramSummary(res, submissions, cfg, programName) {
  var lines = ['📊 ملخص «' + programName + '»', ''];
  var s = res.stats;
  lines.push('المسجلون: ' + s.registered + (s.regDuplicates ? ' (ردود مكررة: ' + s.regDuplicates + ')' : ''));
  lines.push('في ورقة الدرجات: ' + s.students + ' — عبأ المقياس: ' + s.finalCount);
  var g = cfg.general;
  lines.push(unmatchedSummary(s, g));
  var male = res.passers.filter(function (x) { return x.gender === g.maleValue; }).length;
  var female = res.passers.filter(function (x) { return x.gender === g.femaleValue; }).length;
  lines.push('المجتازون: ' + res.passers.length + ' (ذكور ' + male + '، إناث ' + female +
    (res.passers.length - male - female ? '، غير محدد ' + (res.passers.length - male - female) : '') + ')');
  var dist = {};
  res.passers.forEach(function (p) { dist[p.rating || 'بلا تقدير'] = (dist[p.rating || 'بلا تقدير'] || 0) + 1; });
  var order = cfg.bands.map(function (b) { return b.label; }).concat(['بلا تقدير']);
  var dl = order.filter(function (k) { return dist[k]; }).map(function (k) { return k + ' ' + dist[k]; });
  if (dl.length) lines.push('التقديرات: ' + dl.join('، '));
  lines.push('', '📥 التسليمات حسب الفعالية:');
  var per = {};
  cfg.activities.forEach(function (a) { per[a.key || a.title] = { ids: {}, students: {}, rejected: 0 }; });
  if (submissions && submissions.length > 1) {
    var ix = subIndex_(submissions[0]), il = submissions[0].indexOf(LEVEL_HEADER);
    submissions.slice(1).forEach(function (r, k) {
      var t = str_(r[ix['الفعالية']]), lv = il >= 0 ? str_(r[il]) : '';
      var a = (lv && per[t + ' (' + lv + ')']) || per[t]; if (!a) return;
      if (SUB_REJECTED.indexOf(str_(r[ix['الحالة']])) >= 0) { a.rejected++; return; }
      a.ids[str_(r[ix['معرف التسليم']]) || 'row' + k] = 1;
      a.students[normalizeEmail(r[ix['البريد']])] = 1;
    });
  }
  cfg.activities.forEach(function (a) {
    var p = per[a.key || a.title];
    lines.push('• ' + (a.key || a.title) + ': ' + Object.keys(p.ids).length + ' تسليم من ' + Object.keys(p.students).length + ' طالب' +
      (p.rejected ? ' (مرفوض ' + p.rejected + ')' : '') + (a.bot ? '' : ' — خارج البوت'));
  });
  if (res.warnings.length) lines.push('', '⚠️ ' + res.warnings.join('\n⚠️ '));
  return lines.join('\n');
}

/** تقرير طالب: درجاته وتسليماته */
function studentReport(res, submissions, rawEmail, corrections) {
  var email = applyCorrection(buildCorrections(corrections), normalizeEmail(rawEmail));
  var st = res.students.filter(function (x) { return x.email === email; })[0];
  var subs = [];
  if (submissions && submissions.length > 1) {
    var ix = subIndex_(submissions[0]), il = submissions[0].indexOf(LEVEL_HEADER);
    submissions.forEach(function (r, i) {
      if (i && normalizeEmail(r[ix['البريد']]) === email) subs.push({ row: i + 1, act: str_(r[ix['الفعالية']]) + (il >= 0 && str_(r[il]) ? ' (' + str_(r[il]) + ')' : ''), n: r[ix['رقم التسليم']], points: r[ix['الدرجة المضافة']], status: str_(r[ix['الحالة']]), fileId: str_(r[ix['file_id']]), type: str_(r[ix['نوع المحتوى']]) });
    });
  }
  if (!st && !subs.length) return { found: false, email: email, text: 'لا يوجد طالب بالبريد ' + email + ' في ورقة الدرجات ولا في التسليمات.' };
  var lines = ['🔎 ' + email];
  if (st) {
    lines.push('الاسم: ' + (st.name || '—') + ' | الجنس: ' + (st.gender || '—'), '');
    res.items.forEach(function (it) { var k = it.key || it.title, v = st.values[k]; lines.push('• ' + k + ': ' + (v == null ? '-' : v)); });
    (st.levels || []).forEach(function (l) { lines.push('🪜 ' + l.title + ': ' + l.final + (l.passMark != null ? ' من ' + l.passMark : '') + ' — ' + (l.passed ? 'مجتاز ✅' : 'لم يجتز ❌')); });
    lines.push('', 'الأساسية: ' + st.basic + ' | الإضافية: ' + st.extra + ' | ' + ((st.levels || []).length ? 'المجموع الكلي' : 'النهائية') + ': ' + st.final + (st.overallMark != null ? ' (المطلوب ' + st.overallMark + ')' : ''));
    lines.push('النتيجة: ' + (st.passed ? 'ناجح ✅' + (st.rating ? ' — ' + st.rating : '') : 'لم يجتز ❌'));
    var notes = st.reasons.concat(st.notes);
    if (notes.length) lines.push('ملاحظات: ' + notes.join(' • '));
  } else lines.push('(ليس ضمن ورقة الدرجات حسب الإعدادات الحالية)');
  if (subs.length) {
    var byAct = {};
    subs.forEach(function (x) { byAct[x.act] = (byAct[x.act] || 0) + 1; });
    lines.push('', 'تسليمات البوت: ' + Object.keys(byAct).map(function (k) { return k + ' ' + byAct[k]; }).join('، '));
  }
  return { found: true, email: email, text: lines.join('\n'), submissions: subs };
}

/** آخر N تسليمات من السجل (الأحدث أولًا) */
function latestSubmissions(values, n) {
  if (!values || values.length < 2) return [];
  var ix = subIndex_(values[0]), out = [];
  for (var i = values.length - 1; i >= 1 && out.length < n; i--) {
    var r = values[i];
    out.push({
      row: i + 1, time: r[ix['الطابع الزمني']], email: str_(r[ix['البريد']]), name: str_(r[ix['الاسم']]),
      act: str_(r[ix['الفعالية']]), type: str_(r[ix['نوع المحتوى']]), text: str_(r[ix['النص']]),
      fileId: str_(r[ix['file_id']]), fileName: str_(r[ix['اسم الملف']]), mime: str_(r[ix['نوع الملف (MIME)']]),
      size: num_(r[ix['حجم الملف (بايت)']]), chatId: str_(r[ix['معرف المحادثة']]), messageId: r[ix['معرف الرسالة']],
      n: r[ix['رقم التسليم']], points: r[ix['الدرجة المضافة']], status: str_(r[ix['الحالة']])
    });
  }
  return out;
}

/* ───────── التقرير الأسبوعي (خالص) ───────── */

/** عدد التسليمات المقبولة لكل بريد، وإحصاءات فترة (من since) — معرّف التسليم الفريد، والمرفوض/المحذوف خارج العد */
function submissionStats(values, since) {
  var out = { perEmail: {}, week: {}, weekTotal: 0, rejected: 0, rejectedWeek: 0, deletedWeek: 0, editedWeek: 0 };
  if (!values || values.length < 2) return out;
  var ix = subIndex_(values[0]), il = values[0].indexOf(LEVEL_HEADER), ie = values[0].indexOf(SUB_EXTRA.EDITED);
  var seen = {}, wk = {};
  values.slice(1).forEach(function (r, k) {
    var id = str_(r[ix['معرف التسليم']]) || 'row' + k, st = str_(r[ix['الحالة']]);
    var t = dateValue_(r[ix['الطابع الزمني']]);
    var inWeek = t != null && t !== undefined && t >= since;
    var ed = ie >= 0 ? dateValue_(r[ie]) : null, edWeek = ed != null && ed !== undefined && ed >= since;
    if (seen[id]) return; seen[id] = 1;
    if (st === SUB_ST.DEL) { if (edWeek) out.deletedWeek++; return; }
    if (SUB_REJECTED.indexOf(st) >= 0) { out.rejected++; if (inWeek || edWeek) out.rejectedWeek++; return; }
    if (edWeek) out.editedWeek++;
    var e = normalizeEmail(r[ix['البريد']]);
    out.perEmail[e] = (out.perEmail[e] || 0) + 1;
    if (inWeek) {
      var a = str_(r[ix['الفعالية']]) + (il >= 0 && str_(r[il]) ? ' (' + str_(r[il]) + ')' : '');
      wk[a] = (wk[a] || 0) + 1; out.weekTotal++;
    }
  });
  out.week = wk;
  return out;
}

/**
 * نص التقرير الأسبوعي لبرنامج. o = { name, res (computeGrades), submissions, reg ({بريد: {name}}), cfg, now, low, cap }
 */
function buildWeeklyReport(o) {
  var now = o.now, since = now - 7 * 86400000, st = submissionStats(o.submissions, since);
  var regEmails = Object.keys(o.reg || {}), registered = regEmails.length || o.res.stats.registered;
  var active = regEmails.length ? regEmails.filter(function (e) { return st.perEmail[e]; }).length : Object.keys(st.perEmail).length;
  var pct = function (a, b) { return b ? Math.round(a * 1000 / b) / 10 + '%' : '—'; };
  var L = ['🗓 التقرير الأسبوعي — «' + o.name + '»', 'من ' + fmtTime(since) + ' إلى ' + fmtTime(now), ''];
  L.push('👥 المسجلون: ' + registered);
  L.push('📤 سلّم شيئًا (منذ البداية): ' + active + ' (' + pct(active, registered) + ')');
  L.push('✅ المجتازون الآن: ' + o.res.passers.length + ' — نسبة الاجتياز ' + pct(o.res.passers.length, registered) + ' من المسجلين');
  (o.res.levels || []).forEach(function (l, i) {
    L.push('   🪜 ' + l.title + ': ' + o.res.students.filter(function (x) { return x.levels[i] && x.levels[i].passed; }).length);
  });
  L.push('', '📥 تسليمات هذا الأسبوع: ' + st.weekTotal);
  (o.cfg.activities || []).forEach(function (a) { var k = a.key || a.title; L.push('• ' + k + ': ' + (st.week[k] || 0)); });
  Object.keys(st.week).forEach(function (k) { if (!(o.cfg.activities || []).some(function (a) { return (a.key || a.title) === k; })) L.push('• ' + k + ' (غير معرّفة): ' + st.week[k]); });
  L.push('', '❌ المرفوضة: ' + st.rejected + ' (هذا الأسبوع ' + st.rejectedWeek + ')' + (st.editedWeek || st.deletedWeek ? ' | ✏️ عُدّل ' + st.editedWeek + ' | 🗑 حُذف ' + st.deletedWeek : ''));
  if (regEmails.length) {
    var low = o.low == null ? 1 : o.low, cap = o.cap || 20;
    var weak = regEmails.filter(function (e) { return (st.perEmail[e] || 0) <= low; })
      .sort(function (a, b) { return (st.perEmail[a] || 0) - (st.perEmail[b] || 0) || str_(o.reg[a].name).localeCompare(str_(o.reg[b].name), 'ar'); });
    var none = regEmails.filter(function (e) { return !st.perEmail[e]; }).length;
    L.push('', '⚠️ المتعثرون (' + low + ' تسليم أو أقل): ' + weak.length + ' — منهم بلا أي تسليم: ' + none);
    weak.slice(0, cap).forEach(function (e, i) { L.push((i + 1) + ') ' + (str_(o.reg[e].name) || '—') + ' <' + e + '> — ' + (st.perEmail[e] || 0)); });
    if (weak.length > cap) L.push('… و' + (weak.length - cap) + ' آخرون (ابحث بالبريد في البوت الإداري)');
  }
  var rm = o.reminders;
  if (rm && rm.sent + rm.failed + rm.blocked > 0) {
    var labels = typeof RTYPE_LABEL === 'undefined' ? {} : RTYPE_LABEL;
    L.push('', '🔔 التذكيرات هذا الأسبوع: أُرسل ' + rm.sent + ' | فشل ' + rm.failed + ' | أوقفوا البوت ' + rm.blocked);
    var bt = Object.keys(rm.byType).map(function (t) { return (labels[t] || t) + ' ' + rm.byType[t]; }).join('، ');
    if (bt) L.push('   ' + bt);
    if (rm.followBase) L.push('   📈 سلّم بعد التذكير: ' + rm.followed + ' من ' + rm.followBase + ' (' + pct(rm.followed, rm.followBase) + ')');
  }
  if (o.res.warnings && o.res.warnings.length) L.push('', 'ℹ️ تنبيهات الإعدادات: ' + o.res.warnings.length);
  return L.join('\n');
}

/** يقص النص ليناسب حد رسالة تيليجرام */
function clip(s, n) { s = String(s || ''); n = n || 3900; return s.length > n ? s.slice(0, n) + '\n…' : s; }

/* ───────── إدخال المشرف: «المعرّف الاسم [البرامج]» ───────── */

/** توحيد للمطابقة مع إبقاء الأرقام (بخلاف normalizeName_) */
function normKey_(v) {
  var s = latinDigits_(str_(v));
  if (s.normalize) s = s.normalize('NFKC');
  return s.replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[^\u0621-\u064Aa-zA-Z0-9_ ]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * يحلل رسالة إضافة مشرف. يقبل الأرقام العربية والمسافات الزائدة والفواصل،
 * وأسماء البرامج أو معرفاتها في أي موضع بعد المعرّف.
 * programs: [{id, name}] — يعيد {id, name, programs: [ids] أو null إن لم يُذكر برنامج} أو {error}
 */
function parseAdminInput(text, programs, ownerId) {
  var raw = latinDigits_(String(text || '')).replace(/[\u200B-\u200F\u061C\u00A0]/g, ' ');
  var all = /(^|\s)(كل|جميع)\s+(ال)?برامج(\s|$)|(^|\s)all(\s|$)/i.test(raw);
  if (all) raw = raw.replace(/(^|\s)(كل|جميع)\s+(ال)?برامج(?=\s|$)|(^|\s)all(?=\s|$)/gi, ' ');
  var tokens = raw.split(/[\s,،;:؛\-–—=<>()\[\]«»"']+/).filter(String);
  if (!tokens.length) return { error: 'الرسالة فارغة.' };
  var keys = tokens.map(normKey_);
  var used = tokens.map(function () { return false; });
  // البرامج: أطول عبارة أولًا حتى لا يطابق «الدورة 1» داخل «الدورة 10»
  var phrases = [];
  (programs || []).forEach(function (p) {
    [p.name, p.id].forEach(function (x) {
      var k = normKey_(x);
      if (k) phrases.push({ id: p.id, words: k.split(' ') });
    });
  });
  phrases.sort(function (a, b) { return b.words.length - a.words.length; });
  var found = [];
  phrases.forEach(function (ph) {
    for (var i = 0; i + ph.words.length <= keys.length; i++) {
      var ok = true;
      for (var j = 0; j < ph.words.length; j++) if (used[i + j] || keys[i + j] !== ph.words[j]) { ok = false; break; }
      if (!ok) continue;
      for (var j2 = 0; j2 < ph.words.length; j2++) used[i + j2] = true;
      if (found.indexOf(ph.id) < 0) found.push(ph.id);
    }
  });
  var ids = [], nameParts = [], shortNums = [];
  tokens.forEach(function (t, i) {
    if (used[i]) return;
    if (/^\d+$/.test(t)) { if (t.length >= 5 && t.length <= 15) ids.push(t); else shortNums.push(t); return; }
    nameParts.push(t);
  });
  if (!ids.length) {
    if (shortNums.length) return { error: 'الرقم «' + shortNums[0] + '» قصير على أن يكون معرّف تيليجرام؛ المعرّف من 5 إلى 15 رقمًا.' };
    return { error: 'لم أجد المعرّف الرقمي في رسالتك. ابدأ الرسالة برقم المعرّف (أرقام فقط).' };
  }
  if (ids.length > 1) return { error: 'في الرسالة أكثر من رقم معرّف (' + ids.join('، ') + '). أرسل مشرفًا واحدًا في كل رسالة.' };
  if (ownerId && ids[0] === String(ownerId)) return { error: 'هذا معرّف المالك، وله كل الصلاحيات أصلًا.' };
  if (shortNums.length) return { error: 'لم أتعرف على «' + shortNums.join(' ') + '». إن كان جزءًا من اسم برنامج فاكتب الاسم كما هو في قائمة البرامج، أو احذفه واختر البرنامج من الأزرار.' };
  var name = nameParts.join(' ').trim();
  if (!name) return { error: 'اكتب اسم المشرف بعد المعرّف.' };
  if (name.length > 60) return { error: 'الاسم أطول من 60 حرفًا.' };
  return { id: ids[0], name: name, programs: all ? [] : (found.length ? found : null), all: all };
}

/** أمثلة وصيغ لحقول الإدخال الحر (تظهر مع كل طلب إدخال ومع كل خطأ) */
var FIELD_EXAMPLES = {
  passMark: '60', overallPassMark: '120', points: '1', min: '85', label: 'جيد مرتفع', programName: 'الدورة الأولى', extrasCap: '20', finalCap: '100',
  maxCount: '4', maxPoints: '10', order: '3', max: '10', instructions: 'أرسل مشاركتك نصًّا لا يقل عن 5 أسطر',
  botWelcome: 'أهلًا بك في تسليمات البرنامج 🌿', reviewChatId: '-1001234567890', editWindow: '48 (أو «-» = بلا حد حتى يُغلق البرنامج)', weeklyHour: '20', weeklyLow: '1',
  regSpreadsheetId: 'https://docs.google.com/spreadsheets/d/…/edit', regSheet: 'ردود النموذج 1',
  remOffsets: '3ي، 1ي، 3س', remQuiet: '23 إلى 8', remHour: '19', remRiskAt: '50', remRiskGap: '20', remIdleDays: '7',
  programStart: '2026-11-20', programEnd: '2027-01-31',
  tplBefore: '⏰ تذكير يا {الاسم}: بقي {المتبقي} على موعد «{الفعالية}» ({الموعد}).'
};

function fieldFormat(sec, key) {
  var spec = fieldSpec(sec, key) || [key, 'text'];
  var ex = FIELD_EXAMPLES[key];
  switch (spec[1]) {
    case 'num': return { format: 'رقم موجب (يقبل الأرقام العربية والكسور)', example: ex || '2' };
    case 'numOpt': return { format: 'رقم موجب، أو «-» لترك الحقل فارغًا (بلا حد)', example: ex || '10' };
    case 'intOpt': return { format: 'عدد صحيح 1 أو أكثر، أو «-» لبلا حد', example: ex || '4' };
    case 'text': return { format: 'نص (حتى ' + (key === 'label' || key === 'title' ? 60 : 1500) + ' حرف)', example: ex || 'ممتاز' };
    case 'textOpt': return { format: 'نص، أو «-» لترك الحقل فارغًا', example: ex || 'نص قصير' };
    case 'hour': return { format: 'ساعة من 0 إلى 23 (بتوقيت القاهرة)', example: ex || '20' };
    case 'int0': return { format: 'عدد صحيح 0 أو أكثر', example: ex || '1' };
    case 'offsets': return { format: 'أعداد متبوعة بـ «ي» (أيام) أو «س» (ساعات) قبل الموعد، بينها فاصلة؛ أو «-» لبلا تذكير', example: ex || '3ي، 1ي، 3س' };
    case 'quiet': return { format: 'ساعتان من 0 إلى 23: بداية الهدوء ثم نهايته (لا يُرسل فيها شيء)، أو «-» لبلا هدوء', example: ex || '23 إلى 8' };
    case 'date': return { format: 'تاريخ سنة-شهر-يوم وساعة اختيارية (بتوقيت القاهرة)، أو «-» لتركه فارغًا', example: ex || '2026-11-20' };
    case 'template': return { format: 'نص الرسالة (يجوز أكثر من سطر). المتغيرات: ' + TEMPLATE_VARS.map(function (v) { return '{' + v + '}'; }).join(' ') + '\nالسطر الذي فيه متغير بلا قيمة يُحذف تلقائيًا.', example: ex || 'السلام عليكم {الاسم}، تذكير بموعد «{الفعالية}»: {الموعد}' };
    case 'pct': return { format: 'نسبة من 1 إلى 100 من مدة البرنامج', example: ex || '50' };
    case 'int1': return { format: 'عدد صحيح 1 أو أكثر', example: ex || '7' };
  }
  return { format: 'قيمة', example: ex || '' };
}

// ===== AdminPause.gs =====
/**
 * AdminPause.gs — «⏸ إيقاف مؤقت» لفعالية من البوت الإداري (v6).
 * يكتب عمودي «موقوف من» و«موقوف حتى» في جدول الفعاليات (ويضيف رأسيهما إن غابا).
 * بوت الطلاب يحسب الحالة عند كل قراءة: لا حاجة لمشغّل لإعادة التفعيل.
 */
var PAUSE_DAY = 86400000;

function pauseAct_(st) {
  if (st.sec !== 'ACTIVITIES' || st.ref == null) return null;
  return parseSettings(settingsValues_(st.pid)).activities.filter(function (a) { return a.key === st.ref; })[0] || null;
}

function showPauseMenu_(ctx, st) {
  var act = pauseAct_(st);
  if (!act) return show_(ctx, 'افتح الفعالية أولًا من «' + SEC_TITLE.ACTIVITIES + '».', [[{ text: BACK, callback_data: 'S:ACT' }]]);
  aReset_(st); aSave_(ctx.uid, st);
  var cur = pauseLabel(act, Date.now());
  return show_(ctx, '⏸ إيقاف «' + st.ref + '» مؤقتًا' + (cur ? '\nالحالة الآن: ' + cur : '') +
    '\n\nلا تظهر الفعالية للطلاب أثناء الإيقاف، ومن يضغط زرًّا قديمًا لها يُبلَّغ بلطف. تعود متاحة تلقائيًّا في الموعد.\nاختر المدة:',
    [[{ text: 'يوم', callback_data: 'PZ:1' }, { text: '3 أيام', callback_data: 'PZ:3' }, { text: 'أسبوع', callback_data: 'PZ:7' }],
     [{ text: '📅 حتى تاريخ محدد', callback_data: 'PZ:date' }, { text: '♾ حتى أعيد تفعيلها', callback_data: 'PZ:inf' }]]
      .concat(cur ? [[{ text: '▶️ تفعيل الآن', callback_data: 'PZN' }]] : [], nav_(backData_(st))));
}

function choosePause_(ctx, st, arg) {
  var now = Date.now();
  if (!pauseAct_(st)) return showPauseMenu_(ctx, st);
  if (arg === 'inf') return preparePause_(ctx, st, now, '', '⏸ موقوفة حتى يعاد تفعيلها');
  if (arg === 'date') {
    aReset_(st);
    return ask_(ctx, st, 'pauseDate', { title: '📅 إيقاف «' + st.ref + '» حتى تاريخ محدد (بتوقيت القاهرة).', format: 'تاريخ (وساعة اختيارًا)، أو «من … إلى …» لجدولة إيقاف قادم',
      example: '2026-11-20 18:00', back: 'PZ', note: 'أمثلة أخرى: 20/11/2026 — أو: 2026-11-20 إلى 2026-11-25 (يبدأ الإيقاف في التاريخ الأول). بلا ساعة = بداية اليوم 00:00.' });
  }
  var d = Number(arg);
  if (!(d > 0)) return showPauseMenu_(ctx, st);
  var until = now + d * PAUSE_DAY;
  return preparePause_(ctx, st, now, until, '⏸ موقوفة حتى ' + fmtTime(until));
}

function pauseDateText_(ctx, st, text) {
  var r = parsePauseInput(text, Date.now());
  if (r.error) return bad_(ctx, st, r.error);
  var label = (r.from > Date.now() + 60000 ? '🗓 إيقاف مجدول من ' + fmtTime(r.from) + ' ' : '⏸ موقوفة ') + 'حتى ' + fmtTime(r.until);
  return preparePause_(ctx, st, r.from, r.until, label);
}

/** from/until: ms أو '' — كلاهما '' = متاحة الآن */
function preparePause_(ctx, st, from, until, label) {
  var act = pauseAct_(st);
  if (!act) return showPauseMenu_(ctx, st);
  var old = pauseLabel(act, Date.now()) || '▶️ متاحة';
  if (from === '' && until === '' && act.pausedFrom == null && act.pausedUntil == null) return showItem_(ctx, st, 'ℹ️ الفعالية متاحة أصلًا.');
  aReset_(st);
  st.pending = { kind: 'pause', ref: st.ref, from: from, until: until, label: label, old: old, back: backData_(st) };
  aSave_(ctx.uid, st);
  return confirm_(ctx, '«' + st.ref + '» ← الإيقاف المؤقت', old, label);
}

function commitPause_(ctx, st, pd) {
  var sh = programSpreadsheet_(st.pid).getSheetByName(NAMES.SETTINGS);
  var values = sh.getDataRange().getValues();
  var plan = planPause(values, pd.ref, pd.from === '' ? '' : new Date(pd.from), pd.until === '' ? '' : new Date(pd.until));
  var err = validatePlan(values, plan);
  st.ref = pd.ref;
  if (err) return backTo_(ctx, st, '⚠️ لم يُحفظ:\n' + err);
  writePlan_(sh, plan);
  invalidateProgram_(st.pid);
  logChange_(ctx.from, st.pid, SECTIONS.ACTIVITIES, pd.ref, 'إيقاف مؤقت', pd.old, pd.label);
  return backTo_(ctx, st, '✅ حُفظ: «' + pd.ref + '» — ' + pd.label + '\nيطبّقه بوت الطلاب فورًا.');
}

// ===== AdminRemind.gs =====
/**
 * AdminRemind.gs — شاشات التذكيرات في البوت الإداري (v7):
 * «🔔 التذكيرات» (الخيارات + التفعيل)، «✍️ نصوص التذكيرات»، «📅 المواعيد» (ورقة «المواعيد» في ملف البرنامج)،
 * «👀 معاينة الغد»، «📣 أرسل تذكيرًا الآن» (مع تأكيد العدد).
 */
var SCH_LABEL = { start: 'يبدأ في', deadline: 'آخر موعد', close: 'إغلاق بعد الموعد', link: 'رابط الاختبار' };

/** رأس قسم «🔔 التذكيرات» وأزراره (يُستدعى من showSection_) */
function remindSectionTop_(st, values) {
  var g = parseSettings(values).general, ro = reminderOptions(g), prog = loadProgram_(st.pid) || {};
  var types = ['open', 'before', 'missed', 'risk', 'idle'].filter(function (t) { return ro[t]; }).map(function (t) { return RTYPE_LABEL[t]; });
  var head = '\n\nالحالة: ' + (ro.on ? '🟢 مفعّلة' : '⚪️ موقوفة') + ' — الأنواع المفعّلة: ' + (types.join('، ') || 'لا شيء') +
    '\nالمواعيد المسجلة: ' + (prog.schedule || []).length + ((prog.scheduleWarnings || []).length ? ' (⚠️ ' + prog.scheduleWarnings.length + ' صف فيه خطأ)' : '');
  var top = [
    [{ text: ro.on ? '⏹ إيقاف التذكيرات (البرنامج كله)' : '▶️ تفعيل التذكيرات', callback_data: 'RMT' }],
    [{ text: '📅 المواعيد', callback_data: 'SCH' }, { text: '✍️ نصوص التذكيرات', callback_data: 'S:RTP' }],
    [{ text: '👀 معاينة الغد', callback_data: 'RMP' }, { text: '📣 أرسل تذكيرًا الآن', callback_data: 'RMN' }]
  ];
  var note = '\n\nتُرسل التذكيرات من بوت الطلاب لمن ربط بريده بالبوت فقط، ولا تصل لمن سلّم أو أوقفها بزر «🔕». ساعات الهدوء لا يُرسل فيها شيء. كل رسالة تُرسل مرة واحدة فقط.';
  return { head: head, top: top, note: note };
}

/* ───────── التفعيل العام ───────── */
function toggleReminders_(ctx, st) {
  var g = parseSettings(settingsValues_(st.pid, true)).general, ro = reminderOptions(g);
  aReset_(st); st.sec = 'REMIND';
  st.pending = { kind: 'remind', value: ro.on ? OPT.NO : OPT.YES, old: ro.on ? OPT.YES : OPT.NO, back: 'S:REM' };
  aSave_(ctx.uid, st);
  var warn = '';
  if (!ro.on) {
    var types = ['open', 'before', 'missed', 'risk', 'idle'].filter(function (t) { return ro[t]; });
    if (!types.length) warn = '\n\n⚠️ لا يوجد نوع تذكير مفعّل بعد؛ فعّل الأنواع من الأزرار «✏️ تذكير: …».';
    else if (!(loadProgram_(st.pid).schedule || []).length && types.some(function (t) { return t !== 'risk' && t !== 'idle'; })) warn = '\n\n⚠️ لا مواعيد في «📅 المواعيد» بعد؛ تذكيرات الفتح والموعد تحتاجها.';
  }
  return show_(ctx, 'تأكيد التعديل (راجع ثم اضغط ✅ تأكيد):\n🔔 التذكيرات الآلية\nقبل: ' + (ro.on ? 'مفعّلة' : 'موقوفة') + '\nبعد: ' + (ro.on ? 'موقوفة' : 'مفعّلة') + warn,
    [[{ text: '✅ تأكيد', callback_data: 'OK' }, { text: CANCEL, callback_data: 'NO' }]]);
}

function commitReminders_(ctx, st, pd) {
  st.sec = 'REMIND';
  if (pd.value === OPT.YES) {
    try { ensureWeeklyTrigger_(); } catch (e) {
      logError_(e, 'reminders trigger');
      return showSection_(ctx, st, 'REMIND', '⚠️ لم تُفعَّل: تعذر إنشاء المشغّل الزمني لأن المشروع يحتاج تفويضًا جديدًا.\nالحل (مرة واحدة): افتح مشروع البوت في المحرر ← اختر الدالة authorizeTriggers ← تشغيل ← وافق على الصلاحية، ثم اضغط «تفعيل» هنا مرة أخرى.');
    }
  }
  var sh = programSpreadsheet_(st.pid).getSheetByName(NAMES.SETTINGS), values = sh.getDataRange().getValues();
  var plan = planEdit(values, 'REMIND', null, 'remindersOn', pd.value), err = validatePlan(values, plan);
  if (err) return showSection_(ctx, st, 'REMIND', '⚠️ لم يُحفظ:\n' + err);
  writePlan_(sh, plan);
  invalidateProgram_(st.pid);
  logChange_(ctx.from, st.pid, SECTIONS.GENERAL, '-', fieldLabel('GENERAL', 'remindersOn'), pd.old, pd.value);
  if (pd.value === OPT.NO) { try { removeWeeklyTriggerIfUnused_(st.pid); } catch (e) { logError_(e, 'reminders trigger remove'); } }
  return showSection_(ctx, st, 'REMIND', pd.value === OPT.YES ? '✅ فُعّلت التذكيرات الآلية (أول دفعة في التشغيل الساعي القادم).' : '✅ أُوقفت التذكيرات الآلية لهذا البرنامج.');
}

/* ───────── ورقة «المواعيد» ───────── */
function scheduleSheet_(pid, create) {
  var ss = programSpreadsheet_(pid), sh = ss.getSheetByName(SCHEDULE_SHEET);
  if (!sh && create) {
    sh = ss.insertSheet(SCHEDULE_SHEET);
    sh.getRange(1, 1, 1, SCHEDULE_FIELDS.length).setValues([SCHEDULE_FIELDS.map(function (f) { return f[1]; })]);
    try {
      sh.getRange(1, 1, 1, SCHEDULE_FIELDS.length).setFontWeight('bold').setBackground('#d9e7ee');
      sh.setFrozenRows(1); sh.setRightToLeft(true);
      SCHEDULE_FIELDS.forEach(function (f, i) { sh.setColumnWidth(i + 1, f[2]); });
    } catch (e) { /* التنسيق اختياري */ }
  }
  return sh;
}
function schCol_(field) { for (var i = 0; i < SCHEDULE_FIELDS.length; i++) if (SCHEDULE_FIELDS[i][0] === field) return i; return -1; }

/** صفوف الورقة الخام (للعرض والتعديل) */
function scheduleRows_(pid) {
  var sh = scheduleSheet_(pid, false);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues(), h = v[0].map(str_), out = [];
  var ix = {}; SCHEDULE_FIELDS.forEach(function (f) { ix[f[0]] = h.indexOf(f[1]); });
  for (var r = 1; r < v.length; r++) {
    var g = function (k) { return ix[k] >= 0 ? v[r][ix[k]] : ''; };
    if (!str_(g('item'))) continue;
    var lv = str_(g('level'));
    out.push({ row: r + 1, key: lv ? str_(g('item')) + ' (' + lv + ')' : str_(g('item')), start: dateValue_(g('start')), deadline: deadlineValue_(g('deadline')), close: isYes_(g('close')), link: str_(g('link')) });
  }
  return out;
}

function schLine_(x) {
  return x.key + ': ' + (x.start ? 'من ' + fmtTime(x.start) + ' ' : '') + (x.deadline ? 'حتى ' + fmtTime(x.deadline) : '(بلا موعد نهائي)') + (x.close ? ' — يُغلق بعده' : '');
}

function showSchedule_(ctx, st, notice) {
  aReset_(st); st.sec = 'REMIND'; delete st.schRow;
  var rows = scheduleRows_(st.pid), prog = loadProgram_(st.pid) || {};
  st.schRows = rows.map(function (x) { return [x.row, x.key]; }); aSave_(ctx.uid, st);
  var warn = (prog.scheduleWarnings || []).length ? '\n\n⚠️ صفوف لم تُقرأ:\n' + prog.scheduleWarnings.slice(0, 5).join('\n') : '';
  var kb = rows.map(function (x, i) { return { text: x.key + (x.deadline ? ' — ' + fmtTime(x.deadline).slice(5, 10) : ''), callback_data: 'SCI:' + i }; });
  return show_(ctx, (notice ? notice + '\n\n' : '') + '📅 المواعيد (ورقة «' + SCHEDULE_SHEET + '» في ملف البرنامج)\n\n' +
    (rows.map(function (x) { return '• ' + schLine_(x); }).join('\n') || '— لا مواعيد بعد —') + warn +
    '\n\n«إغلاق بعد الموعد = نعم» يُخفي الفعالية عن الطلاب بعد آخر موعد (وقبل «يبدأ في»)، ويمنع تعديل تسليماتها وحذفها.',
    rows_(kb, 1).concat([[{ text: '➕ إضافة موعد', callback_data: 'SCA' }], [{ text: BACK, callback_data: 'S:REM' }]]));
}

/** العناصر التي يمكن جدولتها: الفعاليات (كلها) والاختبارات */
function schedulables_(pid) {
  var cfg = parseSettings(settingsValues_(pid));
  return cfg.activities.map(function (a) { return { key: a.key, title: a.title, level: a.level || '', kind: 'activity' }; })
    .concat(cfg.components.map(function (c) { return { key: c.key, title: c.title, level: c.level || '', kind: 'component' }; }));
}

function scheduleAdd_(ctx, st) {
  var items = schedulables_(st.pid);
  aReset_(st); st.sec = 'REMIND'; st.choices = items.map(function (x) { return x.key; }); aSave_(ctx.uid, st);
  if (!items.length) return show_(ctx, 'لا فعاليات ولا اختبارات في الإعدادات بعد.', [[{ text: BACK, callback_data: 'SCH' }]]);
  return show_(ctx, '➕ موعد جديد (١/٤): اختر العنصر:\n(🎯 فعالية · 📝 اختبار)',
    rows_(items.map(function (x, i) { return { text: (x.kind === 'activity' ? '🎯 ' : '📝 ') + x.key, callback_data: 'SCP:' + i }; }), 2).concat(nav_('SCH')));
}

var SCH_DATE_NOTE = 'أمثلة: 2026-11-20 — أو 2026-11-20 18:00 — أو 20/11/2026. بلا ساعة: «يبدأ في» = أول اليوم، و«آخر موعد» = نهاية اليوم 23:59.';

function schedulePick_(ctx, st, i) {
  var key = (st.choices || [])[i], it = schedulables_(st.pid).filter(function (x) { return x.key === key; })[0];
  if (!it) return scheduleAdd_(ctx, st);
  aReset_(st); st.draft = { key: it.key, title: it.title, level: it.level, kind: it.kind };
  return ask_(ctx, st, 'schStart', { title: '➕ موعد «' + it.key + '» (٢/٤): متى يبدأ التسليم؟', format: 'تاريخ (وساعة اختيارًا) بتوقيت القاهرة، أو «-» إن كان مفتوحًا من الآن', example: '2026-11-20 18:00', back: 'SCH', note: SCH_DATE_NOTE });
}

function parseSchDate_(text, isEnd) {
  var s = str_(text);
  if (CLEAR_WORDS.indexOf(s) >= 0) return { value: null };
  var v = isEnd ? deadlineValue_(s) : dateValue_(s);
  if (v == null || v === undefined) return { error: '«' + clip(s, 40) + '» ليس تاريخًا مفهومًا.' };
  return { value: v };
}
function schCell_(t, isEnd) { if (t == null) return ''; var f = fmtTime(t); return isEnd && /23:59$/.test(f) ? f.slice(0, 10) : (/00:00$/.test(f) ? f.slice(0, 10) : f); }

function scheduleText_(ctx, st, text) {
  var a = st.await, d = st.draft || {};
  if (a === 'schStart' || a === 'schEnd') {
    var r = parseSchDate_(text, a === 'schEnd');
    if (r.error) return bad_(ctx, st, r.error);
    if (a === 'schStart') {
      d.s = r.value; st.draft = d;
      return ask_(ctx, st, 'schEnd', { title: '➕ موعد «' + d.key + '» (٣/٤): ما آخر موعد للتسليم؟', format: 'تاريخ (وساعة اختيارًا)، أو «-» لبلا موعد نهائي', example: '2026-11-27', back: 'SCH', note: SCH_DATE_NOTE });
    }
    if (r.value == null && d.s == null) return bad_(ctx, st, 'لا بد من تاريخ بدء أو آخر موعد على الأقل.');
    if (r.value != null && d.s != null && r.value <= d.s) return bad_(ctx, st, 'آخر موعد (' + fmtTime(r.value) + ') يجب أن يكون بعد البدء (' + fmtTime(d.s) + ').');
    d.d = r.value; st.draft = d; delete st.await; delete st.prompt; st.addStep = 'schClose'; aSave_(ctx.uid, st);
    return show_(ctx, '➕ موعد «' + d.key + '» (٤/٤): هل تُغلق الفعالية للطلاب بعد آخر موعد (وقبل البدء)؟', [[{ text: 'نعم، تُغلق', callback_data: 'SCC:1' }, { text: 'لا، تبقى مفتوحة', callback_data: 'SCC:0' }]].concat(nav_('SCH')));
  }
  if (a === 'schLink') {
    var s = str_(text);
    if (CLEAR_WORDS.indexOf(s) < 0 && !/^https?:\/\/\S+$/.test(s)) return bad_(ctx, st, 'الرابط يبدأ بـ https://');
    d.link = CLEAR_WORDS.indexOf(s) >= 0 ? '' : s; st.draft = d;
    return prepareScheduleAdd_(ctx, st);
  }
  if (a === 'schField') {
    var f = st.draft.field, row = st.draft;
    if (f === 'link') {
      var l = str_(text);
      if (CLEAR_WORDS.indexOf(l) < 0 && !/^https?:\/\/\S+$/.test(l)) return bad_(ctx, st, 'الرابط يبدأ بـ https://');
      return prepareScheduleSet_(ctx, st, CLEAR_WORDS.indexOf(l) >= 0 ? '' : l);
    }
    var p = parseSchDate_(text, f === 'deadline');
    if (p.error) return bad_(ctx, st, p.error);
    var s2 = f === 'start' ? p.value : row.s, d2 = f === 'deadline' ? p.value : row.d;
    if (s2 == null && d2 == null) return bad_(ctx, st, 'لا بد من تاريخ بدء أو آخر موعد على الأقل.');
    if (s2 != null && d2 != null && d2 <= s2) return bad_(ctx, st, 'آخر موعد يجب أن يكون بعد تاريخ البدء.');
    return prepareScheduleSet_(ctx, st, schCell_(p.value, f === 'deadline'));
  }
}

function scheduleClose_(ctx, st, yes) {
  var d = st.draft;
  if (!d || st.addStep !== 'schClose') return showSchedule_(ctx, st);
  delete st.addStep; d.c = yes;
  if (d.kind === 'component') return ask_(ctx, st, 'schLink', { title: '«' + d.key + '» اختبار: رابط نموذج الاختبار (لزر «📤 سلّم الآن» في التذكير)؟', format: 'رابط https://، أو «-» بلا رابط', example: 'https://forms.gle/…', back: 'SCH' });
  return prepareScheduleAdd_(ctx, st);
}

function prepareScheduleAdd_(ctx, st) {
  var d = st.draft;
  st.pending = { kind: 'schadd', row: { item: d.title, level: d.level, start: schCell_(d.s), deadline: schCell_(d.d, true), close: d.c ? OPT.YES : OPT.NO, link: d.link || '' }, key: d.key, back: 'SCH' };
  delete st.await; delete st.prompt; aSave_(ctx.uid, st);
  return confirm_(ctx, 'إضافة إلى 📅 المواعيد', '(جديد)', schLine_({ key: d.key, start: d.s, deadline: d.d, close: d.c }) + (d.link ? '\nالرابط: ' + d.link : ''));
}

function scheduleItem_(ctx, st, i, notice) {
  var ref = (st.schRows || [])[i];
  var x = ref && scheduleRows_(st.pid).filter(function (y) { return y.row === ref[0] && y.key === ref[1]; })[0];
  if (!x) return showSchedule_(ctx, st, '⚠️ تغيّرت ورقة المواعيد؛ هذه القائمة المحدّثة.');
  aReset_(st); st.schRow = i; aSave_(ctx.uid, st);
  var kb = [[{ text: '✏️ يبدأ في', callback_data: 'SCF:start' }, { text: '✏️ آخر موعد', callback_data: 'SCF:deadline' }],
    [{ text: '✏️ ' + SCH_LABEL.close, callback_data: 'SCF:close' }, { text: '✏️ ' + SCH_LABEL.link, callback_data: 'SCF:link' }],
    [{ text: '🗑 حذف هذا الموعد', callback_data: 'SCD' }], [{ text: BACK, callback_data: 'SCH' }]];
  return show_(ctx, (notice ? notice + '\n\n' : '') + '📅 ' + schLine_(x) + (x.link ? '\nالرابط: ' + x.link : '') + '\n\nاختر ما تريد تعديله:', kb);
}

function schCurrent_(st) {
  var ref = (st.schRows || [])[st.schRow];
  return ref && scheduleRows_(st.pid).filter(function (y) { return y.row === ref[0] && y.key === ref[1]; })[0];
}

function scheduleField_(ctx, st, field) {
  var x = schCurrent_(st);
  if (!x || !SCH_LABEL[field]) return showSchedule_(ctx, st);
  aReset_(st); st.draft = { field: field, s: x.start, d: x.deadline, row: x.row, key: x.key };
  if (field === 'close') {
    st.choices = [OPT.YES, OPT.NO]; aSave_(ctx.uid, st);
    return show_(ctx, '«' + SCH_LABEL.close + '» — الحالية: ' + (x.close ? OPT.YES : OPT.NO), [[{ text: OPT.YES, callback_data: 'SCV:1' }, { text: OPT.NO, callback_data: 'SCV:0' }]].concat(nav_('SCI:' + st.schRow)));
  }
  var cur = field === 'link' ? x.link : fmtTime(field === 'start' ? x.start : x.deadline);
  return ask_(ctx, st, 'schField', { title: '✏️ «' + SCH_LABEL[field] + '» لـ«' + x.key + '»\nالحالية: ' + (cur || '—'),
    format: field === 'link' ? 'رابط https://، أو «-» لحذفه' : 'تاريخ (وساعة اختيارًا)، أو «-» لتركه فارغًا', example: field === 'link' ? 'https://forms.gle/…' : '2026-11-27 23:00', back: 'SCI:' + st.schRow, note: field === 'link' ? '' : SCH_DATE_NOTE });
}

function prepareScheduleSet_(ctx, st, value) {
  var d = st.draft, x = schCurrent_(st);
  if (!x) return showSchedule_(ctx, st);
  var old = d.field === 'link' ? x.link : (d.field === 'close' ? (x.close ? OPT.YES : OPT.NO) : schCell_(d.field === 'start' ? x.start : x.deadline, d.field === 'deadline'));
  st.pending = { kind: 'schset', row: x.row, key: x.key, field: d.field, value: value, old: old, back: 'SCI:' + st.schRow };
  delete st.await; delete st.prompt; aSave_(ctx.uid, st);
  return confirm_(ctx, '📅 «' + x.key + '» ← ' + SCH_LABEL[d.field], old, value);
}

function scheduleDelete_(ctx, st) {
  var x = schCurrent_(st);
  if (!x) return showSchedule_(ctx, st);
  st.pending = { kind: 'schdel', row: x.row, key: x.key, back: 'SCH' }; aSave_(ctx.uid, st);
  return confirm_(ctx, 'حذف موعد من 📅 المواعيد', schLine_(x), '(محذوف)');
}

/** تنفيذ تعديلات المواعيد (داخل قفل commit_) مع التحقق من أن الصف لم يتغير */
function commitSchedule_(ctx, st, pd) {
  var sh = scheduleSheet_(st.pid, pd.kind === 'schadd');
  if (pd.kind === 'schadd') {
    var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(str_), row = [];
    for (var c = 0; c < h.length; c++) { var f = SCHEDULE_FIELDS.filter(function (x) { return x[1] === h[c]; })[0]; row.push(f && pd.row[f[0]] != null ? pd.row[f[0]] : ''); }
    sh.appendRow(row);
    logChange_(ctx.from, st.pid, SCHEDULE_SHEET, pd.key, 'إضافة', '', [pd.row.start, pd.row.deadline, pd.row.close].join(' | '));
  } else {
    var cur = scheduleRows_(st.pid).filter(function (y) { return y.row === pd.row && y.key === pd.key; })[0];
    if (!cur) { invalidateProgram_(st.pid); return showSchedule_(ctx, st, '⚠️ تغيّرت ورقة المواعيد منذ العرض. لم يُحفظ شيء؛ أعد المحاولة.'); }
    if (pd.kind === 'schdel') { sh.deleteRow(pd.row); logChange_(ctx.from, st.pid, SCHEDULE_SHEET, pd.key, 'حذف', schLine_(cur), ''); }
    else {
      var hh = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(str_), col = hh.indexOf(SCHEDULE_FIELDS[schCol_(pd.field)][1]);
      if (col < 0) { col = hh.length; sh.getRange(1, col + 1).setValue(SCHEDULE_FIELDS[schCol_(pd.field)][1]).setFontWeight('bold'); }
      sh.getRange(pd.row, col + 1).setValue(pd.value);
      logChange_(ctx.from, st.pid, SCHEDULE_SHEET, pd.key, SCH_LABEL[pd.field], pd.old, pd.value);
    }
  }
  invalidateProgram_(st.pid);
  var w = (loadProgram_(st.pid).scheduleWarnings || []);
  return showSchedule_(ctx, st, '✅ حُفظ في ورقة «' + SCHEDULE_SHEET + '»، ويستعمله بوت الطلاب فورًا.' + (w.length ? '\n⚠️ ' + w[0] : ''));
}

/* ───────── المعاينة والإرسال اليدوي ───────── */
function remPreview_(ctx, st, prog) {
  show_(ctx, '⏳ جارٍ إعداد المعاينة…');
  try { send_(ctx.chat, previewReminders_(loadProgram_(prog.id), Date.now()), [[{ text: SEC_TITLE.REMIND, callback_data: 'S:REM' }, { text: '⚙️ القائمة', callback_data: 'M' }]]); }
  catch (e) { logError_(e, 'reminder preview ' + prog.id); send_(ctx.chat, '⚠️ تعذرت المعاينة:\n' + e.message, [[{ text: BACK, callback_data: 'S:REM' }]]); }
}

/** عناصر الإرسال اليدوي: المواعيد المسجلة ثم الفعاليات والاختبارات غير المجدولة */
function manualItems_(prog) {
  var items = (prog.schedule || []).slice(), keys = {};
  items.forEach(function (x) { keys[x.key] = 1; });
  (prog.activities || []).forEach(function (a) { if (!keys[a.key]) items.push({ key: a.key, title: a.title, level: a.level || '', kind: 'activity', s: null, d: null, c: false, link: '', id: a.key + '@-' }); });
  return items;
}

function manualMenu_(ctx, st, prog) {
  var p = loadProgram_(prog.id), items = manualItems_(p), now = Date.now();
  aReset_(st); st.sec = 'REMIND'; st.choices = items.map(function (x) { return x.id; }); aSave_(ctx.uid, st);
  if (!items.length) return show_(ctx, 'لا عناصر للتذكير بها.', [[{ text: BACK, callback_data: 'S:REM' }]]);
  return show_(ctx, '📣 أرسل تذكيرًا الآن: اختر العنصر. يصل التذكير لمن لم يسلّم فيه (من المرتبطين بالبوت)، وستظهر لك قبل الإرسال عدد المستلمين.',
    rows_(items.map(function (x, i) { return { text: x.key + (x.d ? ' — ' + (x.d < now ? 'انتهى ' : '') + fmtTime(x.d).slice(5, 10) : ''), callback_data: 'RMI:' + i }; }), 1).concat(nav_('S:REM')));
}

function manualPick_(ctx, st, prog, i) {
  var id = (st.choices || [])[i], p = loadProgram_(prog.id);
  var it = manualItems_(p).filter(function (x) { return x.id === id; })[0];
  if (!it) return manualMenu_(ctx, st, prog);
  show_(ctx, '⏳ جارٍ حساب المستلمين…');
  var ctx2 = remContext_(p, Date.now()), list = manualRecipients(Object.assign({ opts: reminderOptions(p.general) }, ctx2), it);
  aReset_(st);
  if (!list.length) { aSave_(ctx.uid, st); return send_(ctx.chat, 'لا أحد يحتاج تذكيرًا في «' + it.key + '»: الكل سلّم، أو لا أحد مرتبط بالبوت.', [[{ text: BACK, callback_data: 'RMN' }]]); }
  st.pending = { kind: 'remsend', item: it, count: list.length, back: 'S:REM' }; aSave_(ctx.uid, st);
  return send_(ctx.chat, '📣 تأكيد الإرسال:\nالعنصر: «' + it.key + '»\nالمستلمون: ' + list.length + ' طالب لم يسلّم\n\nنص الرسالة (مثال):\n«' + list[0].text + '»\n\nاضغط ✅ للإرسال الآن.',
    [[{ text: '✅ أرسل إلى ' + list.length, callback_data: 'OK' }, { text: CANCEL, callback_data: 'NO' }]]);
}

/** الإرسال اليدوي (خارج قفل commit_ حتى لا تتأخر تسليمات الطلاب) */
function commitManualSend_(ctx, st, pd) {
  var p = loadProgram_(st.pid);
  if (!p || !p.open) return showMain_(ctx, st, '⚠️ البرنامج مغلق للتسليم؛ لم يُرسل شيء.');
  var job = { id: 'm' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36), pid: st.pid, itemId: pd.item.id, item: pd.item, t: Date.now(), by: String(ctx.from.id) };
  show_(ctx, '⏳ جارٍ الإرسال إلى ' + pd.count + '…');
  if (!remClaim_(st.pid)) {
    remSaveJobs_(remJobs_().concat([job]));
    return send_(ctx.chat, '⏳ دفعة تذكيرات أخرى تعمل الآن لهذا البرنامج؛ سيُرسل تذكيرك في التشغيل الساعي القادم.', [[{ text: BACK, callback_data: 'S:REM' }]]);
  }
  var r;
  try { r = runRemindersFor_(p, { now: Date.now(), budgetEnd: Date.now() + REM.MANUAL_BUDGET_MS, jobs: [job], manualNow: true, onlyManual: true }); }
  finally { remRelease_(st.pid); }
  if (r.left) remSaveJobs_(remJobs_().concat([job]));
  logChange_(ctx.from, st.pid, REMIND_LOG, pd.item.key, 'تذكير يدوي', '', 'أُرسل ' + r.sent + '، فشل ' + r.failed + '، محظور ' + r.blocked);
  return send_(ctx.chat, '📣 «' + pd.item.key + '»: ✅ أُرسل ' + r.sent + ' | ⚠️ فشل ' + r.failed + ' | 🚫 أوقفوا البوت ' + r.blocked +
    (r.left ? '\n⏳ الباقي (' + r.left + ') يُكمل تلقائيًا في التشغيل الساعي القادم.' : ''), [[{ text: SEC_TITLE.REMIND, callback_data: 'S:REM' }, { text: '⚙️ القائمة', callback_data: 'M' }]]);
}

/** أزرار البوت الإداري الخاصة بالتذكيرات؛ يعيد false إن لم يكن الأمر منها */
var REMIND_CMDS = ['RMT', 'RMP', 'RMN', 'RMI', 'SCH', 'SCA', 'SCP', 'SCC', 'SCI', 'SCF', 'SCV', 'SCD'];
function onRemindCallback_(ctx, st, cmd, arg, prog) {
  if (REMIND_CMDS.indexOf(cmd) < 0) return false;
  remindDispatch_(ctx, st, cmd, arg, prog);
  return true;
}
function remindDispatch_(ctx, st, cmd, arg, prog) {
  switch (cmd) {
    case 'RMT': return toggleReminders_(ctx, st);
    case 'RMP': return remPreview_(ctx, st, prog);
    case 'RMN': return manualMenu_(ctx, st, prog);
    case 'RMI': return manualPick_(ctx, st, prog, Number(arg));
    case 'SCH': return showSchedule_(ctx, st);
    case 'SCA': return scheduleAdd_(ctx, st);
    case 'SCP': return schedulePick_(ctx, st, Number(arg));
    case 'SCC': return scheduleClose_(ctx, st, arg === '1');
    case 'SCI': return scheduleItem_(ctx, st, Number(arg));
    case 'SCF': return scheduleField_(ctx, st, arg);
    case 'SCV': { if (!st.draft || st.draft.field !== 'close') return showSchedule_(ctx, st); return prepareScheduleSet_(ctx, st, arg === '1' ? OPT.YES : OPT.NO); }
    case 'SCD': return scheduleDelete_(ctx, st);
  }
  return undefined;
}

// ===== AdminStore.gs =====
/**
 * AdminStore.gs — المشرفون والصلاحيات وسجل التعديلات وورقة البرامج.
 * المالك: «معرّف المالك» في صف العميل بسجل العملاء (له كل الصلاحيات وإدارة المشرفين).
 * المشرفون: ورقة «المشرفون» في ملف البوت؛ عمود «البرامج» فارغ = كل البرامج، أو معرفات مفصولة بفاصلة.
 */
var ADMIN_SHEETS = { ADMINS: 'المشرفون', CHANGES: 'سجل التعديلات' };
var ADMIN_HEADERS = ['معرف المستخدم', 'الاسم', 'البرامج (فارغ = الكل)', 'أضافه', 'التاريخ'];
var CHANGE_HEADERS = ['الوقت', 'معرف المشرف', 'اسم المشرف', 'البرنامج', 'القسم', 'العنصر', 'الحقل', 'القيمة القديمة', 'القيمة الجديدة'];

function ownerId_() { return TENANT_ ? str_(TENANT_.ownerId) : ''; }

function readAdmins_() {
  var sh = central_().getSheetByName(ADMIN_SHEETS.ADMINS);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().filter(function (r) { return str_(r[0]); }).map(function (r) {
    var scope = str_(r[2]).split(/[,،\s]+/).filter(String);
    return { id: str_(r[0]), name: str_(r[1]), programs: scope };
  });
}

/** يعيد صلاحيات المستخدم أو null */
function adminInfo_(uid) {
  uid = String(uid);
  if (ownerId_() && uid === ownerId_()) return { id: uid, owner: true, programs: [] };
  var c = cache_().get('admins');
  var list = c ? JSON.parse(c) : readAdmins_();
  if (!c) cache_().put('admins', JSON.stringify(list), TTL.ADMINS);
  var a = list.filter(function (x) { return x.id === uid; })[0];
  return a ? { id: uid, owner: false, programs: a.programs, name: a.name } : null;
}
function cachedAdmins_() { var c = cache_().get('admins'); if (c) return JSON.parse(c); var a = readAdmins_(); cache_().put('admins', JSON.stringify(a), TTL.ADMINS); return a; }

function canAccess_(adm, pid) { return !!adm && (adm.owner || !adm.programs.length || adm.programs.indexOf(pid) >= 0); }

function addAdmin_(uid, name, programs, by) {
  var sh = central_().getSheetByName(ADMIN_SHEETS.ADMINS);
  removeAdmin_(uid);
  sh.appendRow([String(uid), name || '', (programs || []).join(', '), String(by), new Date()]);
  cache_().remove('admins');
}

function removeAdmin_(uid) {
  var sh = central_().getSheetByName(ADMIN_SHEETS.ADMINS);
  if (!sh || sh.getLastRow() < 2) return false;
  var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (str_(ids[i][0]) === String(uid)) { sh.deleteRow(i + 2); cache_().remove('admins'); return true; }
  return false;
}

function logChange_(from, pid, section, item, field, oldV, newV) {
  var sh = central_().getSheetByName(ADMIN_SHEETS.CHANGES);
  if (!sh) return;
  var name = [from.first_name, from.last_name].filter(Boolean).join(' ') + (from.username ? ' @' + from.username : '');
  sh.appendRow([new Date(), String(from.id), name, pid, section, item, field, String(oldV == null ? '' : oldV), String(newV == null ? '' : newV)]);
}

/** يمسح الذاكرة المؤقتة لبرنامج حتى يقرأ بوت الطلاب الإعدادات الجديدة فورًا */
function invalidateProgram_(pid) {
  cache_().removeAll(['progs', 'pcfg:' + pid, 'corr:' + pid, 'reg:' + pid + ':n', 'svals:' + pid + ':n', 'snap:' + pid + ':n']);
}

/** صف البرنامج في ورقة «البرامج» (رقم الصف 1-based) */
function programRow_(pid) {
  var sh = central_().getSheetByName(BOT.PROGRAMS);
  if (!sh || sh.getLastRow() < 2) return null;
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  for (var i = 0; i < v.length; i++) if (str_(v[i][0]) === pid) return { sh: sh, row: i + 2, values: v[i] };
  return null;
}

function programSpreadsheet_(pid) {
  var p = getPrograms_().filter(function (x) { return x.id === pid; })[0];
  if (!p) throw new Error('البرنامج غير موجود: ' + pid);
  return openSS_(p.ssId);
}

// ===== BotMain.gs =====
/**
 * BotMain.gs — نقطة دخول البوت (Webhook) ومنطق المحادثة.
 * الخطوات: /start ← اختيار البرنامج (يُتخطى إن كان واحدًا) ← اختيار الفعالية ← البريد ← إرسال المشاركة ← تأكيد.
 */
var MSG = {
  noPrograms: 'لا يوجد حاليًا برنامج مفتوح لاستقبال التسليمات.',
  choosePrograms: 'اختر البرنامج الذي تريد التسليم فيه:',
  chooseActivity: 'اختر نوع المشاركة التي تريد تسليمها:',
  chooseLevel: 'اختر مستواك في البرنامج:',
  noLevelActivities: function (lv) { return 'لا توجد فعاليات متاحة للتسليم في «' + lv + '» حاليًا. اختر مستوى آخر:'; },
  noActivities: 'لا توجد فعاليات متاحة للتسليم في هذا البرنامج حاليًا.',
  askEmail: 'اكتب بريدك الإلكتروني الذي سجلت به في البرنامج:',
  badEmailFormat: 'هذا لا يبدو بريدًا إلكترونيًا صحيحًا. اكتبه مرة أخرى، مثل: name@gmail.com',
  notRegistered: function (email, prog) {
    return 'عذرًا، البريد ' + email + ' غير مقبول ❌\n' +
      'هذا البريد غير موجود في استمارة التسجيل في برنامج «' + prog + '».\n' +
      'يجب أن تكتب البريد الإلكتروني نفسه الذي سجلت به. اكتب بريدك الصحيح:';
  },
  useSaved: function (email) { return 'سأستخدم بريدك المحفوظ:\n' + email; },
  wrongType: { text: 'هذه الفعالية تقبل النصوص فقط. اكتب مشاركتك نصًا.', file: 'هذه الفعالية تقبل الملفات فقط (مستند أو صورة أو صوت أو فيديو).' },
  unsupported: 'هذا النوع من الرسائل غير مدعوم. أرسل نصًا أو ملفًا.',
  idle: 'مرحبًا 👋\nاضغط /start لتسليم مشاركة، أو /help لطريقة التسليم.',
  emailNoFlow: 'لتسليم مشاركة اضغط /start واختر البرنامج ثم نوع المشاركة، وسيُطلب منك بريدك بعدها.',
  notRegisteredIdle: function (email, prog) {
    return 'عذرًا، البريد ' + email + ' غير مقبول ❌\n' +
      'هذا البريد غير موجود في استمارة التسجيل في برنامج «' + prog + '».\n' +
      'يجب أن تستعمل البريد الإلكتروني نفسه الذي سجلت به. اضغط /start ثم اكتب بريدك الصحيح.';
  },
  emailInContent: function (email) {
    return 'يبدو أنك أرسلت بريدًا إلكترونيًا لا مشاركة.\nبريدك المعتمد الآن: ' + email +
      '\nأرسل مشاركتك، أو /email لتغيير البريد، أو /cancel للإلغاء.';
  },
  cancelled: 'تم الإلغاء. اضغط /start للبدء من جديد.',
  help: 'طريقة التسليم:\n١) اضغط /start\n٢) اختر نوع المشاركة\n٣) اكتب بريدك الذي سجلت به في البرنامج\n٤) أرسل مشاركتك نصًا أو ملفًا\n\nأوامر:\n/start بدء تسليم جديد\n/email تغيير البريد المحفوظ\n/mysubs تسليماتي (عرضها وتعديلها وحذفها)\n/mygrades درجاتي (إن أتاحها البرنامج)\n/reminders إيقاف التذكيرات أو تشغيلها\n/cancel إلغاء العملية الحالية\n/help هذه التعليمات',
  paused: function (a, ps) { return (ps.kind && ps.kind !== 'pause' ? closedMessage(a, ps) : 'فعالية «' + a.title + '» موقوفة مؤقتًا' + (ps.until ? ' حتى ' + fmtTime(ps.until) : '') + '، فلا يمكن التسليم فيها الآن.') + ' اختر فعالية أخرى:'; },
  allPaused: 'كل الفعاليات موقوفة مؤقتًا الآن. حاول لاحقًا، أو اضغط /mysubs لعرض تسليماتك.',
  error: 'حدث خطأ مؤقت أثناء المعالجة، حاول مرة أخرى بعد قليل. إن تكرر الخطأ تواصل مع إدارة البرنامج.',
  notReady: 'البوت قيد التجهيز الآن، وسيُفتح التسليم قريبًا بإذن الله 🌿'
};

/** ردّ الويب هوك: HtmlService يُرجع 200 مباشرة. ContentService يُرجع 302 (تحويل) فيعدّه تيليجرام فشلًا ويعيد الإرسال ويتأخر. */
function out_(t) { return HtmlService.createHtmlOutput(t || ''); }

/**
 * معالجة تحديث لعميل بعد أن تحقق الموجّه (Router.gs) من العميل والمفتاح السري والترخيص.
 * role: 'student' | 'admin'. doPost/doGet نفسهما في Router.gs.
 */
function handleTenantPost_(e, role) {
  var chatId = null;
  try {
    BOT_ROLE = role;
    var update = JSON.parse(e.postData.contents);
    if (update.update_id != null) {
      var uk = 'upd:' + role + ':' + update.update_id;
      if (cache_().get(uk)) return out_('dup'); // إعادة إرسال من تيليجرام لتحديث عولج
      cache_().put(uk, '1', 21600);
    }
    var src = update.message || (update.callback_query && update.callback_query.message);
    chatId = src && src.chat && src.chat.id;
    var effRole = role;
    if (role === 'unified') {
      var fromU = (update.message && update.message.from) || (update.callback_query && update.callback_query.from);
      var uidU = fromU && fromU.id ? String(fromU.id) : '';
      var privU = !!(src && src.chat && src.chat.type === 'private');
      if (TENANT_.setup !== SETUP_DONE) effRole = (privU && uidU && (!TENANT_.ownerId || TENANT_.ownerId === uidU)) ? 'admin' : 'student';
      else effRole = (privU && uidU && adminInfo_(uidU)) ? 'admin' : 'student';
    }
      if (effRole === 'admin') {
      if (TENANT_.setup !== SETUP_DONE) 
      Update_(update);
      else handleAdminUpdate_(update);
    } else if (TENANT_.setup !== SETUP_DONE) {
      if (update.message && update.message.chat && update.message.chat.type === 'private') send_(update.message.chat.id, MSG.notReady);
    } else handleUpdate_(update);
  } catch (err) {
    logError_(err, role + ' ' + String(e && e.postData && e.postData.contents).slice(0, 1500));
    if (chatId) try { send_(chatId, role === 'admin' ? '⚠️ خطأ: ' + err.message + '\nاضغط /start للمتابعة.' : MSG.error); } catch (x) { /* تجاهل */ }
  } finally {
    try { flushEvents_(); } catch (x) { /* تجاهل */ }
  }
  return out_('ok');
}

/** نص هو بريد إلكتروني فقط؟ */
function looksLikeEmail_(text) {
  return !!text && text.indexOf('@') > 0 && !/\s/.test(text.replace(/[\u00A0\u200B-\u200F\u061C\uFEFF]/g, '')) && isValidEmail(normalizeEmail(text));
}

function handleUpdate_(u) {
  var q = u.callback_query;
  if (q) return q.message && isGroupChat_(q.message.chat) ? onGroupCallback_(q) : onCallback_(q);
  var m = u.message;
  if (m && isGroupChat_(m.chat)) return onGroupMessage_(m); // المجموعات: ربط المراجعة والرد على التسليمات فقط
  if (!m || !m.chat || m.chat.type !== 'private' || !m.from) return;
  var uid = String(m.from.id), text = m.text ? String(m.text).trim() : '';
  if (text.charAt(0) === '/') return onCommand_(m, uid, text);
  if (onRejectReasonPrivate_(m, uid, text)) return; // مشرف يرسل سبب رفض في الخاص
  var st = getState_(uid);
  if (st && st.step === 'mx') { var mr = moduleHook_('onStudentMessage', [m, uid, st], st.mod); if (mr !== undefined) return mr; clearState_(uid); st = null; }
  if (st && st.step === 'edit') return onEditContent_(m, uid, st);
  if (m.media_group_id && cache_().get('mgx:' + m.media_group_id)) return; // بقية ألبوم أُرسل في خطوة تعديل
  if ((!st || st.step !== 'content') && (text === 'تسليماتي' || text === 'درجاتي')) return openView_(m.chat.id, uid, st || {}, text === 'تسليماتي' ? 'subs' : 'grades', m.from);
  // بقية أجزاء ألبوم أُرسل للتو تُضم إلى التسليم نفسه
  if (m.media_group_id && st && st.a && st.email && cache_().get('mg:' + m.media_group_id)) return onContent_(m, uid, st);
  var isEmail = looksLikeEmail_(text);
  if (!st) return isEmail ? emailOutsideFlow_(m, uid, null, text) : send_(m.chat.id, MSG.idle);
  switch (st.step) {
    case 'email': case 'confirmEmail': return onEmailText_(m, uid, st, text);
    case 'content':
      if (isEmail) return send_(m.chat.id, MSG.emailInContent(st.email));
      return onContent_(m, uid, st);
    default:
      if (isEmail) return emailOutsideFlow_(m, uid, st, text);
      return send_(m.chat.id, 'اختر من الأزرار أعلاه، أو اضغط /start للبدء من جديد.');
  }
}

/**
 * كتب الطالب بريده في غير موضعه (قبل /start أو قبل اختيار الفعالية): يُتحقق منه فورًا،
 * فإن لم يكن مسجلًا نبّهناه، وإن كان مسجلًا حفظناه وعرضنا الفعاليات.
 */
function emailOutsideFlow_(m, uid, st, text) {
  var chat = m.chat.id, progId = st && st.p;
  if (!progId) {
    var open = getOpenPrograms_();
    if (!open.length) return send_(chat, MSG.noPrograms);
    if (open.length > 1) return send_(chat, MSG.emailNoFlow);
    progId = open[0].id;
  }
  var prog = loadProgram_(progId);
  if (!prog || !prog.open) return send_(chat, MSG.noPrograms);
  var email = normalizeEmail(text);
  var found = lookupRegistration_(prog, email);
  if (!found) return send_(chat, MSG.notRegisteredIdle(email, prog.name));
  saveUserEmail_(uid, found.email, m.from.username);
  if (!prog.activities.length) return send_(chat, MSG.noActivities);
  var st0 = { step: 'activity', p: prog.id, email: found.email, name: found.name };
  if (hasLevels_(prog)) { st0.step = 'level'; setState_(uid, st0); return send_(chat, 'تم التحقق من بريدك ✅ أهلًا ' + found.name + '\n\n' + MSG.chooseLevel, levelButtons_(prog)); }
  setState_(uid, st0);
  return send_(chat, 'تم التحقق من بريدك ✅ أهلًا ' + found.name + '\n\n' + MSG.chooseActivity, activityButtons_(prog));
}

function hasLevels_(prog) { return !!(prog.levels && prog.levels.length); }

/** أزرار الفعاليات؛ في برنامج بمستويات: فعاليات المستوى المختار والفعاليات المشتركة (بلا مستوى) فقط */
function activityButtons_(prog, level) {
  var list = [], now = Date.now(); // الموقوفة مؤقتًا لا تظهر (الفهارس ثابتة)
  prog.activities.forEach(function (a, i) { if ((!level || !a.level || a.level === level) && !closedState(a, now)) list.push({ text: a.title, callback_data: 'a:' + i }); });
  var kb = rows_(list, 2);
  if (level) kb.push([{ text: '🪜 تغيير المستوى (' + level + ')', callback_data: 'lv' }]);
  return kb;
}

function levelButtons_(prog) {
  return rows_(prog.levels.map(function (l, i) { return { text: l, callback_data: 'l:' + i }; }), 1);
}

function levelHasActivities_(prog, level) { var now = Date.now(); return prog.activities.some(function (a) { return (!a.level || a.level === level) && !closedState(a, now); }); }

function anyOpenActivity_(prog) { var now = Date.now(); return prog.activities.some(function (a) { return !closedState(a, now); }); }

/** بعد اختيار المستوى: فعالياته (مع إبقاء البريد المتحقق منه في الجلسة) */
function showLevelActivities_(chat, uid, st, prog, level) {
  if (!levelHasActivities_(prog, level)) { st.step = 'level'; setState_(uid, st); return send_(chat, MSG.noLevelActivities(level), levelButtons_(prog)); }
  st.lv = level; st.step = 'activity'; delete st.a; setState_(uid, st);
  return send_(chat, '«' + level + '» — ' + MSG.chooseActivity, activityButtons_(prog, level));
}

function onCommand_(m, uid, text) {
  var parts = text.split(/\s+/), cmd = parts[0].replace(/@.*/, '').toLowerCase();
  var chat = m.chat.id;
  if (cmd === '/mysubs' || cmd === '/mygrades') {
    var cur = getState_(uid) || {};
    var keep = cur.p && cur.email ? { step: 'done', p: cur.p, email: cur.email, name: cur.name, lv: cur.lv } : {};
    clearState_(uid);
    return openView_(chat, uid, keep, cmd === '/mysubs' ? 'subs' : 'grades', m.from);
  }
  if (cmd === '/cancel') cache_().remove('rjpu:' + uid); // إلغاء سبب رفض معلّق (للمشرفين)
  if (cmd === '/email') {
    saveUserEmail_(uid, '', m.from.username);
    var st = getState_(uid);
    if (st && st.a) { st.step = 'email'; delete st.email; setState_(uid, st); return send_(chat, MSG.askEmail); }
    clearState_(uid);
    return send_(chat, 'حُذف البريد المحفوظ. سيُطلب منك بريدك عند التسليم القادم. اضغط /start.');
  }
  clearState_(uid); // أي أمر آخر يلغي الخطوة المعلقة أولًا
  if (cmd === '/start') return startFlow_(chat, uid, parts[1]);
  if (cmd === '/cancel') return send_(chat, MSG.cancelled);
  if (cmd === '/myid') return send_(chat, 'معرّفك في تيليجرام: ' + uid);
  if (cmd === '/reminders') return showReminderToggle_(chat, uid);
  if (cmd === '/app') return sendMiniAppButton_(chat);
  for (var mid in MODULES) if (MODULES[mid].studentCommand === cmd) { var mr = moduleHook_('onStudentCommand', [m, uid, text], mid); if (mr !== undefined) return mr; }
  return send_(chat, MSG.help + moduleStudentHelp_()); // /help وأي أمر غير معروف
}

function startFlow_(chat, uid, payload) {
  var progs = getOpenPrograms_();
  if (payload) {
    var p = progs.filter(function (x) { return x.id === payload; })[0];
    if (p) return selectProgram_(chat, uid, p.id);
  }
  if (!progs.length) return send_(chat, MSG.noPrograms);
  if (progs.length === 1) return selectProgram_(chat, uid, progs[0].id);
  setState_(uid, { step: 'program' });
  return send_(chat, MSG.choosePrograms, rows_(progs.map(function (p) {
    return { text: p.name || p.id, callback_data: 'p:' + p.id };
  }), 1));
}

function selectProgram_(chat, uid, progId) {
  var prog = loadProgram_(progId);
  if (!prog || !prog.open) return send_(chat, MSG.noPrograms);
  if (!prog.activities.length) return send_(chat, MSG.noActivities);
  if (!anyOpenActivity_(prog)) { setState_(uid, { step: 'activity', p: prog.id }); return send_(chat, MSG.allPaused, viewButtons_(prog)); }
  var welcome = prog.general.botWelcome || ('أهلًا بك في تسليمات «' + prog.name + '» 🌿');
  if (hasLevels_(prog)) { setState_(uid, { step: 'level', p: prog.id }); return send_(chat, welcome + '\n\n' + MSG.chooseLevel, levelButtons_(prog)); }
  setState_(uid, { step: 'activity', p: prog.id });
  return send_(chat, welcome + '\n\n' + MSG.chooseActivity, activityButtons_(prog));
}

function onCallback_(q) {
  ackAndClear_(q); // الرد على الزر وإزالة أزراره في رحلة شبكة واحدة
  var uid = String(q.from.id), chat = q.message.chat.id, data = String(q.data || '');
  var st = getState_(uid) || {};
  if (data.indexOf('mx:') === 0) return moduleStudentCallback_(q, data, false);
  if (data.indexOf('p:') === 0) return selectProgram_(chat, uid, data.slice(2));
  if (data.indexOf('pv:') === 0) { var pv = data.split(':'); return viewForProgram_(chat, uid, {}, pv.slice(2).join(':'), pv[1], q.from); }
  if (data === 'ms' || data === 'my') return openView_(chat, uid, st, data === 'ms' ? 'subs' : 'grades', q.from);
  if (data.indexOf('go:') === 0) return goSubmit_(chat, uid, data, q.from);
  if (data === 'rm:off' || data === 'rm:on') return setReminders_(chat, uid, data === 'rm:off');
  if (!st.p) return send_(chat, 'انتهت الجلسة. اضغط /start للبدء من جديد.');
  var prog = loadProgram_(st.p);
  if (!prog || !prog.open) { clearState_(uid); return send_(chat, MSG.noPrograms); }
  if (data.indexOf('l:') === 0) {
    var lv = (prog.levels || [])[Number(data.slice(2))];
    if (!lv) return selectProgram_(chat, uid, prog.id);
    return showLevelActivities_(chat, uid, st, prog, lv);
  }
  if (data === 'lv' && hasLevels_(prog)) { st.step = 'level'; delete st.a; setState_(uid, st); return send_(chat, MSG.chooseLevel, levelButtons_(prog)); }
  if (data.indexOf('a:') === 0) {
    var act = prog.activities[Number(data.slice(2))];
    if (!act) return selectProgram_(chat, uid, prog.id);
    if (hasLevels_(prog) && (!st.lv || prog.levels.indexOf(st.lv) < 0)) return selectProgram_(chat, uid, prog.id);
    if (act.level && st.lv && act.level !== st.lv) return showLevelActivities_(chat, uid, st, prog, st.lv);
    var ps = closedState(act, Date.now());
    if (ps) return send_(chat, MSG.paused(act, ps), activityButtons_(prog, hasLevels_(prog) ? st.lv : null));
    st.a = act.key || act.title;
    return askEmail_(chat, uid, st, q.from);
  }
  if (data === 'e:keep') return acceptEmail_(chat, uid, st, st.pending, q.from);
  if (data === 'e:new') { st.step = 'email'; setState_(uid, st); return send_(chat, MSG.askEmail); }
  if (data === 'again') {
    var aa = findAct_(prog, st.a), pz = aa && closedState(aa, Date.now());
    if (pz) return send_(chat, MSG.paused(aa, pz), activityButtons_(prog, hasLevels_(prog) ? st.lv : null));
    st.step = 'content'; setState_(uid, st); return promptContent_(chat, prog, aa);
  }
  if (data === 'menu') return hasLevels_(prog) && st.lv ? showLevelActivities_(chat, uid, st, prog, st.lv) : selectProgram_(chat, uid, prog.id);
  // تسليماتي: عرض / تعديل / حذف (الفهرس في قائمة الجلسة)
  var sm = data.match(/^(sv|se|sd|sdy):(\d+)$/);
  if (sm) {
    if (!st.email || !st.ml) return send_(chat, VMSG.expired);
    if (sm[1] === 'sv') return showSub_(chat, uid, st, prog, sm[2]);
    if (sm[1] === 'se') return startEditSub_(chat, uid, st, prog, sm[2]);
    if (sm[1] === 'sd') return askDelete_(chat, uid, st, prog, sm[2]);
    return doDelete_(chat, uid, st, prog, sm[2]);
  }
  return send_(chat, VMSG.stale); // زر غير معروف (من نسخة أقدم أو رسالة قديمة)
}

function findAct_(prog, key) { return prog.activities.filter(function (a) { return (a.key || a.title) === key; })[0]; }

function askEmail_(chat, uid, st, from) {
  if (st.email) return acceptEmail_(chat, uid, st, st.email, from); // بريد تحقق منه في هذه الجلسة
  var saved = getUserEmail_(uid);
  if (saved) {
    st.step = 'confirmEmail'; st.pending = saved; setState_(uid, st);
    return send_(chat, MSG.useSaved(saved), [[{ text: '✅ متابعة', callback_data: 'e:keep' }, { text: '✏️ بريد آخر', callback_data: 'e:new' }]]);
  }
  st.step = 'email'; setState_(uid, st);
  return send_(chat, MSG.askEmail);
}

function onEmailText_(m, uid, st, text) {
  var email = normalizeEmail(text);
  if (!isValidEmail(email)) return send_(m.chat.id, MSG.badEmailFormat);
  return acceptEmail_(m.chat.id, uid, st, email, m.from);
}

function acceptEmail_(chat, uid, st, email, from) {
  var prog = loadProgram_(st.p);
  var found = lookupRegistration_(prog, email);
  if (!found) {
    st.step = 'email'; delete st.email; setState_(uid, st);
    return send_(chat, MSG.notRegistered(email, prog.name));
  }
  saveUserEmail_(uid, found.email, from && from.username);
  st.email = found.email; st.name = found.name; st.step = 'content'; delete st.pending;
  if (st.after) { var view = st.after; delete st.after; st.step = 'done'; setState_(uid, st); return viewForProgram_(chat, uid, st, prog.id, view, from); }
  setState_(uid, st);
  return promptContent_(chat, prog, findAct_(prog, st.a), found.name);
}

function promptContent_(chat, prog, act, name) {
  if (!act) return send_(chat, 'هذه الفعالية لم تعد متاحة. اضغط /start.');
  var what = act.accepts === 'text' ? 'نصًّا' : (act.accepts === 'file' ? 'ملفًا (مستند أو صورة أو صوت أو فيديو)' : 'نصًّا أو ملفًا');
  return send_(chat, (name ? 'أهلًا ' + name + ' 🌿\n' : '') +
    'أرسل الآن مشاركتك في «' + act.title + '»' + (act.level ? ' (' + act.level + ')' : '') + ' ' + what + '.' + (act.instructions ? '\n\n' + act.instructions : '') +
    '\n\n(للإلغاء: /cancel)');
}

function onContent_(m, uid, st) {
  var prog = loadProgram_(st.p);
  var act = prog && findAct_(prog, st.a);
  if (!act || !prog.open) { clearState_(uid); return send_(m.chat.id, 'هذه الفعالية لم تعد متاحة. اضغط /start.'); }
  var ps = closedState(act, Date.now());
  if (ps && !(m.media_group_id && cache_().get('mg:' + m.media_group_id))) { st.step = 'activity'; delete st.a; setState_(uid, st); return send_(m.chat.id, '⚠️ لم تُسجَّل مشاركتك: ' + MSG.paused(act, ps), activityButtons_(prog, hasLevels_(prog) ? st.lv : null)); }
  var c = extractContent_(m);
  if (!c) return send_(m.chat.id, MSG.unsupported);
  if (act.accepts === 'text' && c.type !== 'نص') return send_(m.chat.id, MSG.wrongType.text);
  if (act.accepts === 'file' && !c.file) return send_(m.chat.id, MSG.wrongType.file);
  var res = recordSubmission_(prog, act, st, m, c);
  if (!res) return; // مكرر
  forwardToReview_(prog, act, st, m, res);
  if (res.albumPart) return;
  st.step = 'done'; setState_(uid, st);
  var lines = ['✅ تم استلام مشاركتك في «' + act.title + '»' + (act.level || st.lv ? ' (' + (act.level || st.lv) + ')' : '') + '.', 'رقم التسليم: ' + res.n, 'الدرجة المضافة: ' + res.points,
    'مجموع درجتك في «' + act.title + '» حتى الآن: ' + res.total];
  if (act.maxCount != null) lines.push('(يُحتسب حتى ' + act.maxCount + ' تسليمات في هذه الفعالية)');
  if (res.points === 0 && res.note) lines.push('⚠️ ' + res.note + '؛ حُفظت مشاركتك دون درجة إضافية.');
  return send_(m.chat.id, lines.join('\n'), [
    [{ text: '➕ تسليم آخر في «' + act.title + '»', callback_data: 'again' }],
    [{ text: '📋 اختيار فعالية أخرى', callback_data: 'menu' }]
  ].concat(viewButtons_(prog)));
}

/* ───────── التذكيرات (v7): «📤 سلّم الآن» و«🔕 إيقاف التذكيرات» ───────── */

/** زر «📤 سلّم الآن» في رسالة تذكير: go:<البرنامج>:<رقم الفعالية>:<رقم المستوى أو ->:<بصمة الفعالية> */
function goSubmit_(chat, uid, data, from) {
  var g = data.split(':'), pid = g[1];
  var prog = loadProgram_(pid);
  if (!prog || !prog.open) { clearState_(uid); return send_(chat, MSG.noPrograms); }
  var act = prog.activities[Number(g[2])];
  if (!act || (g[4] && shortHash_(act.key || act.title) !== g[4])) return selectProgram_(chat, uid, pid); // تغيّرت الفعاليات منذ الإرسال
  var st = { step: 'activity', p: pid };
  if (hasLevels_(prog)) {
    var lv = act.level || (g[3] && g[3] !== '-' ? prog.levels[Number(g[3])] : null);
    if (!lv || prog.levels.indexOf(lv) < 0) return selectProgram_(chat, uid, pid);
    st.lv = lv;
  }
  var cs = closedState(act, Date.now());
  if (cs) { setState_(uid, st); return send_(chat, MSG.paused(act, cs), activityButtons_(prog, hasLevels_(prog) ? st.lv : null)); }
  st.a = act.key || act.title;
  var saved = getUserEmail_(uid);
  if (saved) return acceptEmail_(chat, uid, st, saved, from); // البريد المحفوظ يُتحقق منه مباشرة
  return askEmail_(chat, uid, st, from);
}

function setReminders_(chat, uid, off) {
  remSetOff_(uid, off ? 'موقوفة' : 'مفعّلة', 'من الطالب');
  return send_(chat, off ? '🔕 أُوقفت التذكيرات. لن تصلك تذكيرات المواعيد من هذا البوت.\nلإعادتها: /reminders' : '🔔 أُعيد تشغيل التذكيرات.',
    [[{ text: off ? '🔔 تشغيل التذكيرات' : '🔕 إيقاف التذكيرات', callback_data: off ? 'rm:on' : 'rm:off' }]]);
}

function showReminderToggle_(chat, uid) {
  var off = remIsOff_(uid);
  return send_(chat, off ? '🔕 التذكيرات موقوفة لك الآن.' : '🔔 التذكيرات مفعّلة لك (تصلك عند اقتراب المواعيد إن فعّلها البرنامج).',
    [[{ text: off ? '🔔 تشغيل التذكيرات' : '🔕 إيقاف التذكيرات', callback_data: off ? 'rm:on' : 'rm:off' }]]);
}

// ===== CentralTick.gs =====
/**
 * CentralTick.gs — المشغّل الزمني المركزي الوحيد (كل ساعة) لكل العملاء.
 * يحل محل: مشغّل البوت الساعي القديم + «الحساب التلقائي كل ساعة» و onOpen في سكربت الدرجات المرتبط بكل ملف.
 * لكل عميل (فعّال/تجريبي غير منتهٍ، أُكمل إعداده) وبالتناوب: التقرير الأسبوعي والتذكيرات ← الحساب التلقائي للبرامج «المتسخة» أو المتغيّرة
 *   ← اكتشاف نهاية البرامج (program_ended) ← مهام الوحدات المفعّلة ← كتابة الأحداث.
 * الميزانية: CENTRAL.BUDGET_MS من بداية التشغيل (حد Apps Script 6 دقائق). إن نفدت حُفظ موضع العميل التالي
 * وجُدول تشغيل استئناف بعد دقيقة (centralTickContinue).
 */
var CENTRAL = { BUDGET_MS: 270000, CONT_HANDLER: 'centralTickContinue', CONT_AFTER_MS: 60000 };

/** اسم المشغّل محفوظ (weeklyReportTick) للتوافق مع مشغّلات v6/v7؛ e رقم (ms) في الاختبارات فقط */
function weeklyReportTick(e) { return centralTick_(typeof e === 'number' ? e : Date.now()); }

function centralTickContinue() {
  try { ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === CENTRAL.CONT_HANDLER) ScriptApp.deleteTrigger(t); }); } catch (e) { /* تجاهل */ }
  return centralTick_(Date.now(), true);
}

function centralTick_(now, isCont) {
  var prev = TENANT_;
  resetMemo_(); leaveTenant_();
  var t0 = Date.now(), budgetEnd = t0 + CENTRAL.BUDGET_MS, res = { tenants: 0, done: [], stopped: false };
  var sl = LockService.getScriptLock();
  if (!sl.tryLock(5000)) return res;
  var busy;
  try { busy = rawCache_().get('ptick:run'); if (!busy) rawCache_().put('ptick:run', String(t0), 360); } finally { sl.releaseLock(); }
  if (busy) return res;
  try {
    try { rollUsage_(now); } catch (e) { logError_(e, 'usage roll'); }
    var list = listTenants_().filter(function (t) { return licenseState_(t, now).ok && t.setup === SETUP_DONE && t.controlSsId; });
    res.tenants = list.length;
    if (!list.length) return res;
    var start = Number(platformProp_('TICK_CURSOR') || 0) % list.length;
    for (var i = 0; i < list.length; i++) {
      var t = list[(start + i) % list.length];
      if (Date.now() > budgetEnd - 20000) {
        res.stopped = true;
        setPlatformProp_('TICK_CURSOR', String((start + i) % list.length));
        scheduleContinuation_();
        break;
      }
      withTenant_(t, function () {
        try {
          countUsage_('tick');
          graceWarnTick_(t, now); expiryRemindTick_(t, now);
          tenantTick_(now, t0);
          autoCalcTick_(now, budgetEnd);
          programEndTick_(now);
          modulesTick_(now, budgetEnd);
        } catch (err) { logError_(err, 'central tick ' + t.id); }
        finally { try { flushEvents_(); } catch (x) { /* تجاهل */ } }
      });
      res.done.push(t.id);
    }
    if (!res.stopped) setPlatformProp_('TICK_CURSOR', String((start + 1) % list.length));
    return res;
  } finally {
    rawCache_().remove('ptick:run');
    if (prev) enterTenant_(prev);
  }
}

function scheduleContinuation_() {
  try {
    if (ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === CENTRAL.CONT_HANDLER; })) return;
    ScriptApp.newTrigger(CENTRAL.CONT_HANDLER).timeBased().after(CENTRAL.CONT_AFTER_MS).create();
  } catch (e) { logError_(e, 'continuation trigger'); }
}

/* ───────── الحساب المركزي للدرجات ───────── */

/** توقيع رخيص لمدخلات الحساب (عدد صفوف الأوراق المؤثرة) */
function calcSignature_(ss) {
  var cfg = parseSettings(ss.getSheetByName(NAMES.SETTINGS).getDataRange().getValues()), g = cfg.general, parts = [];
  var names = [NAMES.SETTINGS, NAMES.SUBMISSIONS, NAMES.CORRECTIONS, NAMES.OVERRIDES, g.finalSheet].concat(cfg.components.map(function (c) { return c.sheet; }));
  names.forEach(function (n) { if (!n) return; var sh = ss.getSheetByName(n); parts.push(n + ':' + (sh ? sh.getLastRow() : '-')); });
  return parts.join('|');
}

/**
 * يعيد حساب برنامج ويكتب أوراقه (مركزيًا بمعرّف الملف، داخل قفل العميل). يعيد {passers} أو {error}
 * يطلق grade_updated.
 */
function recalcProgram_(pid, source) {
  var lock = tenantLock_();
  if (!lock.tryLock(20000)) return { error: 'مشغول؛ سيُعاد لاحقًا' };
  try {
    var ss = programSpreadsheet_(pid);
    var out = calculateForSpreadsheet(ss, { write: true });
    try { putStandingSnapshot_(pid, out); } catch (e) { /* اختياري */ }
    clearDirty_(pid);
    var sigs = {}; try { sigs = JSON.parse(prop_('CALC_SIG') || '{}'); } catch (e) { sigs = {}; }
    try { sigs[pid] = calcSignature_(ss); setProp_('CALC_SIG', JSON.stringify(sigs)); } catch (e) { /* تجاهل */ }
    var s = out.res.stats;
    emitEvent_(EVENT_TYPES.GRADE_UPDATED, pid, { source: source || 'auto', students: s.students, passers: s.passers }, source || 'auto');
    return { passers: s.passers, students: s.students };
  } catch (e) {
    logError_(e, 'recalc ' + pid);
    return { error: e.message };
  } finally { lock.releaseLock(); }
}

/** الحساب التلقائي: البرامج المتسخة (بأحداث التسليم) أو التي تغيّر توقيع مدخلاتها */
function autoCalcTick_(now, budgetEnd) {
  if (!tenantConf_().autoCalc) return [];
  var sigs = {}; try { sigs = JSON.parse(prop_('CALC_SIG') || '{}'); } catch (e) { sigs = {}; }
  var done = [];
  getPrograms_().forEach(function (p) {
    if (Date.now() > budgetEnd - 30000) return;
    try {
      var dirty = isDirty_(p.id);
      if (!dirty && !p.open) return; // البرامج المغلقة لا تُفحص إلا إن تغيّرت بالبوت
      if (!dirty && sigs[p.id] && sigs[p.id] === calcSignature_(programSpreadsheet_(p.id))) return;
      var r = recalcProgram_(p.id, 'auto');
      if (!r.error) done.push(p.id);
    } catch (e) { logError_(e, 'auto calc ' + p.id); }
  });
  return done;
}

/** program_ended: مرة واحدة لكل برنامج بعد «تاريخ نهاية البرنامج» */
function programEndTick_(now) {
  var ended = {}; try { ended = JSON.parse(prop_('ENDED') || '{}'); } catch (e) { ended = {}; }
  var changed = false;
  getPrograms_().forEach(function (p) {
    if (ended[p.id]) return;
    try {
      var g = loadProgram_(p.id).general, en = deadlineValue_(g.programEnd);
      if (en == null || now <= en) return;
      ended[p.id] = dayKey_(now); changed = true;
      emitEvent_(EVENT_TYPES.PROGRAM_ENDED, p.id, { programEnd: str_(g.programEnd), name: p.name || p.id }, 'tick');
    } catch (e) { logError_(e, 'program end ' + p.id); }
  });
  if (changed) setProp_('ENDED', JSON.stringify(ended));
}

/** يرحّل عدادات الأمس إلى ورقة «الاستهلاك» في ملف السجل مرة يوميًا */
function rollUsage_(now) {
  var y = dayKey_(now - DAY_MS);
  if (platformProp_('USAGE_LAST') === y) return;
  var sh = registrySS_().getSheetByName(REGISTRY.USAGE);
  if (!sh) { sh = registrySS_().insertSheet(REGISTRY.USAGE); sh.appendRow(['اليوم', 'العميل', 'التحديثات', 'تشغيلات المشغّل']); }
  listTenants_().forEach(function (t) { var u = usageOf_(t.id, y); if (u.updates || u.ticks) sh.appendRow([y, t.id, u.updates, u.ticks]); });
  setPlatformProp_('USAGE_LAST', y);
}

/* ───────── مهلة ما بعد الانتهاء ───────── */
/** أثناء المهلة: تنبيه واحد يوميًا لمالك العميل في البوت الإداري (البوتات تعمل عاديًا) */
function graceWarnTick_(t, now) {
  var lic = licenseState_(t, now);
  if (!lic.grace || !t.ownerId) return false;
  var day = dayKey_(now);
  if (prop_('GRACE_WARNED') === day) return false;
  var left = Math.max(1, Math.ceil((lic.graceEnd - now) / 86400000));
  var text = '⏰ انتهى اشتراك هذا النظام في ' + dayKey_(t.expiry) + '. البوتات تعمل عاديًا خلال مهلة تنتهي ' + dayKey_(lic.graceEnd) +
    ' (بقي ' + left + ' ' + (left === 1 ? 'يوم' : 'أيام') + ')، ثم تتوقف مؤقتًا مع بقاء كل البيانات محفوظة.\nتواصل مع مزوّد الخدمة للتجديد.';
  var r = null;
  try { r = tgAs_('admin', 'sendMessage', { chat_id: t.ownerId, text: text }, true); } catch (e) { logError_(e, 'grace warn'); }
  setProp_('GRACE_WARNED', day);
  return !!(r && r.ok !== false);
}

/* ───────── تذكير قبل انتهاء الاشتراك ───────── */
/** قبل انتهاء الاشتراك: تذكير واحد لمالك العميل في البوت الإداري قبل ٣ أيام وقبل يوم واحد لكل تاريخ انتهاء */
function expiryRemindTick_(t, now) {
  try {
    var lic = licenseState_(t, now);
    if (!lic || !lic.ok || lic.grace || !t || !t.ownerId || !t.expiry) return false;
    var expiryDay = dayKey_(t.expiry);
    var todayDay = dayKey_(now);
    var daysLeft = Math.round((Date.UTC(+expiryDay.slice(0, 4), +expiryDay.slice(5, 7) - 1, +expiryDay.slice(8, 10)) - Date.UTC(+todayDay.slice(0, 4), +todayDay.slice(5, 7) - 1, +todayDay.slice(8, 10))) / 86400000);
    if (daysLeft !== 3 && daysLeft !== 1) return false;
    var key = 'EXP_REMIND:' + String(t.id).toLowerCase() + ':' + expiryDay + ':' + daysLeft;
    if (platformProp_(key)) return false;
    var when = daysLeft === 3 ? 'بعد ٣ أيام' : 'غدًا';
    var text = '⏰ ينتهي اشتراك هذا النظام في ' + expiryDay + ' (' + when + '). تواصل مع مزوّد الخدمة للتجديد.';
    var r = null;
    try { r = tgAs_('admin', 'sendMessage', { chat_id: t.ownerId, text: text }, true); } catch (e) { logError_(e, 'expiry reminder'); }
    if (r && r.ok !== false) setPlatformProp_(key, '1');
    return !!(r && r.ok !== false);
  } catch (e) { logError_(e, 'expiry reminder'); return false; }
}