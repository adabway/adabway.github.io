/* ErrorSanitize.gs — sanitizing of error text before it is written to any
   error-log sheet, plus a throttled owner alert for platform-level errors.
   Used only from logError_ (Part3.gs); no call sites were changed. */

function sanitizeLogText_(s) {
  var t = String(s == null ? '' : s);
  // 1) Telegram bot token inside an api.telegram.org URL.
  t = t.replace(/api\.telegram\.org\/bot[^\s\/'"]+/g, 'api.telegram.org/bot<…>');
  // 2) Secret values in URL query parameters (k= / key= / token= / secret=).
  t = t.replace(/([?&](?:k|key|token|secret)=)[^&\s'"<>]+/gi, '$1<…>');
  // 3) A standalone token-shaped string: digits, a colon, then 30+ token chars.
  t = t.replace(/\b\d+:[A-Za-z0-9_-]{30,}/g, '<…>');
  return t;
}

var ERROR_ALERTING_ = false;

function alertPlatformError_(context, message) {
  if (ERROR_ALERTING_) return;
  ERROR_ALERTING_ = true;
  try {
    var ownerId = platformProp_('PLATFORM_OWNER_ID');
    if (!ownerId) return;
    var firstLine = String(message || '').split('\n')[0].slice(0, 500);
    var keyBase = String(context || '') + '|' + firstLine;
    var digest = '';
    try {
      var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, keyBase, Utilities.Charset.UTF_8);
      for (var i = 0; i < bytes.length; i++) {
        var v = (bytes[i] + 256) % 256;
        digest += ('0' + v.toString(16)).slice(-2);
      }
    } catch (e2) {
      digest = String(keyBase.length) + '-' + keyBase.slice(0, 40);
    }
    var cache = nsCache_('erralert:');
    if (cache.get('hour')) return;
    if (cache.get('seen:' + digest)) return;
    var text = '⚠️ خطأ جديد في منصة أدب\nالسياق: ' + String(context || '') + '\n' + firstLine;
    var res = tgAs_('platform', 'sendMessage', { chat_id: ownerId, text: text, disable_web_page_preview: true }, true);
    if (res && res.ok) {
      cache.put('hour', '1', 3600);
      cache.put('seen:' + digest, '1', 86400);
    }
  } catch (e) {
    // The alert must never break logging or recurse into it: swallow silently.
  } finally {
    ERROR_ALERTING_ = false;
  }
}

