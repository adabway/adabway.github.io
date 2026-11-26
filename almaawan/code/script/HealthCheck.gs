// HealthCheck.gs - periodic self health-check for the Adab SaaS Platform.
// Runs every 6 hours via a time-based trigger (see healthCheckInstall_).
// Silent when every check passes; on any failure it sends ONE Telegram
// message to the platform owner via the platform bot, listing the failures.
// It never writes to the error log, and never includes bot tokens, webhook
// URLs (they carry secrets) or Script Property values in any message.

function healthCheck_() {
  try { backupEnsure_(); } catch (e) { try { logError_('backupEnsure', e); } catch (x) {} }
  var failures = [];
  var results = [];
  var tenants = null; // listTenantsFromSheet_() result, shared by checks 2 and 3.

  function record(label, ok, detail) {
    results.push({ label: label, ok: !!ok, detail: detail || '' });
    if (!ok) failures.push({ label: label, detail: detail || '' });
  }
  function run(label, fn) {
    try {
      var r = fn();
      if (r === true) record(label, true, '');
      else record(label, false, typeof r === 'string' ? r : 'failed');
    } catch (e) {
      record(label, false, String((e && e.message) || e));
    }
  }

  // 1. Mini-app signature self-test: build a fake Telegram WebApp initData
  // for the platform bot and run it through verifyMiniAppInit_.
  run('التوقيع', function () {
    var token = tokenFor_('platform');
    if (!token) return 'PLATFORM_BOT_TOKEN is not set';
    var authDate = Math.floor(Date.now() / 1000);
    var userJson = JSON.stringify({ id: 999999001, first_name: 'Health', last_name: 'Check', username: 'healthcheck' });
    // Data-check-string exactly as Telegram builds it: decoded
    // key=value pairs, sorted by key, joined with '\n', hash excluded.
    var dataCheck = 'auth_date=' + authDate + '\nuser=' + userJson;
    // HMAC exactly as Telegram specifies, computed here independently
    // (not via miniAppHmacHex_) so a bug in the verifier's own helper is
    // caught instead of masked: secret = HMAC_SHA256(key='WebAppData',
    // message=bot token); hash = HMAC_SHA256(key=secret, message=dataCheck).
    var secret = Utilities.computeHmacSha256Signature(
      Utilities.newBlob(String(token)).getBytes(),
      Utilities.newBlob('WebAppData').getBytes());
    var hashBytes = Utilities.computeHmacSha256Signature(
      Utilities.newBlob(dataCheck).getBytes(), secret);
    var hash = healthCheckHex_(hashBytes);
    var raw = 'auth_date=' + authDate + '&hash=' + hash +
      '&user=' + encodeURIComponent(userJson);
    var res = verifyMiniAppInit_(raw, token);
    if (!res || !res.ok) return 'verification rejected: ' + (res && res.reason ? res.reason : 'unknown');
    if (String(res.uid) !== '999999001') return 'unexpected uid';
    return true;
  });

  // 2. Registry readable, straight from the sheet (not the cache).
  run('سجل العملاء', function () {
    tenants = listTenantsFromSheet_();
    if (!Array.isArray(tenants)) return 'tenants list is not an array';
    return true;
  });

  // 3. Webhooks: platform bot plus every tenant's admin and student bots.
  // getWebhookInfo goes through tgAs_(..., true) (quiet), so a failure
  // here never writes to the error log. Webhook URLs carry secrets, so
  // they are never put in a failure detail - only the bot label and reason.
  (function () {
    var base;
    try { base = webAppUrl_(); } catch (e) { base = ''; }
    function webhookEntry(label, role, expectedParam, tenant) {
      run(label, function () {
        if (!base) return 'web app URL is not set or invalid';
        var j;
        if (tenant) {
          j = withTenant_(tenant, function () { return tgAs_(role, 'getWebhookInfo', {}, true); });
        } else {
          j = tgAs_(role, 'getWebhookInfo', {}, true);
        }
        if (!j || !j.ok) return 'getWebhookInfo failed' + (j && j.description ? ': ' + j.description : '');
        var info = j.result || {};
        var url = info.url || '';
        if (!url) return 'webhook URL is empty';
        if (url.indexOf(base) !== 0) return 'webhook URL does not start with the web app URL';
        if (url.indexOf(expectedParam) < 0) return 'webhook URL is missing ' + expectedParam;
        var pending = Number(info.pending_update_count || 0);
        if (pending > 100) return 'pending updates: ' + pending;
        return true;
      });
    }
    webhookEntry('ويبهوك بوت المنصة', 'platform', 'b=platform', null);
    if (!Array.isArray(tenants)) {
      // The registry could not be read: that failure is already reported
      // above, so tenant webhooks are skipped rather than double-reported.
      console.info('healthCheck_: tenant webhooks skipped, tenants list unavailable.');
    } else {
      tenants.forEach(function (t) {
        var id = t && t.id;
        if (!id) return;
        webhookEntry('ويبهوك الإداري (' + id + ')', 'admin', 't=' + id + '&b=admin', t);
        webhookEntry('ويبهوك الطلاب (' + id + ')', 'student', 't=' + id + '&b=student', t);
      });
    }
  })();

  // 4. Mini-app page alive: fetch MINIAPP_BASE_URL, expect HTTP 200.
  run('صفحة التطبيق المصغّر', function () {
    var base = platformProp_('MINIAPP_BASE_URL');
    if (!base) return 'MINIAPP_BASE_URL is not set';
    var res = UrlFetchApp.fetch(String(base), { muteHttpExceptions: true, followRedirects: true });
    var code = res.getResponseCode();
    if (code !== 200) return 'HTTP ' + code;
    return true;
  });

  if (failures.length === 0) {
    console.info('healthCheck_: all ' + results.length + ' checks passed.');
    return { ok: true, results: results, failures: [] };
  }

  var lines = failures.map(function (f) {
    var d = f.detail ? ' — ' + String(f.detail).slice(0, 140) : '';
    return '• ' + f.label + d;
  });
  var text = '🩺 فحص الصحة: فشل ' + failures.length + ':\n' + lines.join('\n');
  var owner = platformProp_('PLATFORM_OWNER_ID');
  if (!owner) {
    console.warn('healthCheck_: ' + failures.length + ' failures, PLATFORM_OWNER_ID is not set; alert not sent.');
  } else {
    try {
      var sent = tgAs_('platform', 'sendMessage',
        { chat_id: owner, text: text, disable_web_page_preview: true }, true);
      console.warn('healthCheck_: ' + failures.length + ' failures; owner alert sent: ' + !!(sent && sent.ok));
    } catch (e) {
      console.warn('healthCheck_: ' + failures.length + ' failures; owner alert failed: ' + String((e && e.message) || e));
    }
  }
  return { ok: false, results: results, failures: failures };
}

// Lowercase hex encoding for a byte array (kept local so the signature
// self-test does not depend on the verifier's own hex helper).
function healthCheckHex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] & 0xff;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

// Idempotent installer: creates a time-based trigger for healthCheck_
// every 6 hours, only if no trigger with that handler already exists.
function healthCheckInstall_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'healthCheck_') {
      console.info('healthCheckInstall_: a healthCheck_ trigger already exists; nothing created.');
      return false;
    }
  }
  ScriptApp.newTrigger('healthCheck_').timeBased().everyHours(6).create();
  console.info('healthCheckInstall_: created a time-based trigger for healthCheck_ every 6 hours.');
  return true;
}
