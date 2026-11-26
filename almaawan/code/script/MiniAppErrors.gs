// MiniAppErrors.gs - friendly Arabic text for mini-app errors.
// The mini-app page shows `message || error`, so a raw code such as
// "unauthorized:sig" would reach the user. appOut_ (Part2.gs) maps every
// failed response through miniAppFriendlyError_ and keeps the raw code in
// the `code` field (and in the server error log); it is never shown.
function miniAppFriendlyError_(raw, existingMessage) {
  var code = String(raw || '').toLowerCase();
  var msg = String(existingMessage || '');
  var hasArabic = /[\u0600-\u06FF]/.test(msg);
  if (code.indexOf('unauthorized') === 0 || code.indexOf('auth') >= 0 || code === 'sig') {
    return 'انتهت جلسة الدخول الآمنة. أغلق التطبيق وافتحه من جديد من داخل تيليجرام.';
  }
  if (code === 'paused') {
    return hasArabic ? msg : '⏸ اشتراك هذا النظام متوقف أو منتهٍ، والبيانات محفوظة كما هي. تواصل مع مزوّد الخدمة لتجديد الاشتراك.';
  }
  if (hasArabic) return msg;
  if (code.indexOf('license') >= 0 || code.indexOf('suspend') >= 0) {
    return '⏸ اشتراك هذا النظام متوقف أو منتهٍ، والبيانات محفوظة كما هي. تواصل مع مزوّد الخدمة لتجديد الاشتراك.';
  }
  if (code.indexOf('module') >= 0 || code === 'disabled' || code.indexOf('inactive') >= 0 || code.indexOf('not_active') >= 0 || code.indexOf('app_unavailable') >= 0) {
    return '⏸ التطبيق غير متاح الآن، استعمل المحادثة.';
  }
  if (code.indexOf('not_found') >= 0 || code.indexOf('tenant') >= 0 || code === 'forbidden' || code.indexOf('not_setup') >= 0 || code.indexOf('no_tenant') >= 0) {
    return 'هذا النظام غير مهيأ بعد. أكمل الإعداد أولًا.';
  }
  if (code.indexOf('unknown') >= 0 || code.indexOf('bad_request') >= 0 || code.indexOf('bad') >= 0 || code.indexOf('invalid') >= 0) {
    return 'طلب غير مفهوم. حدّث التطبيق وحاول مجددًا.';
  }
  return 'حدثت مشكلة غير متوقعة. حاول مرة أخرى بعد قليل.';
}
