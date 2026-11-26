// ===== M3Temp.gs =====
// Temporary measurement helpers for round 3 only. Delete this file before final redeploy.
function m3State() {
  var a = loadTenant_('test2', true);
    var b = loadTenant_('test', true);
      Logger.log('M3STATE test2 status=' + (a && a.status) + ' expiry=' + (a && a.expiry) + ' row=' + (a && a.row));
        Logger.log('M3STATE test status=' + (b && b.status) + ' expiry=' + (b && b.expiry) + ' row=' + (b && b.row));
        }
        function m3Webhook() {
          var tok = platformProp_('PLATFORM_BOT_TOKEN');
            if (!tok) { Logger.log('M3WEBHOOK no token'); return; }
              var r = UrlFetchApp.fetch('https://api.telegram.org/bot' + tok + '/getWebhookInfo', {muteHttpExceptions: true});
                var j = JSON.parse(r.getContentText());
                  Logger.log('M3WEBHOOK code=' + r.getResponseCode() + ' ok=' + j.ok);
                    if (j.result) {
                        Logger.log('M3WEBHOOK url=' + j.result.url);
                            Logger.log('M3WEBHOOK pending=' + j.result.pending_update_count + ' maxConn=' + j.result.max_connections + ' lastErr=' + j.result.last_error_message + ' lastErrDate=' + j.result.last_error_date);
                              } else { Logger.log('M3WEBHOOK body=' + r.getContentText().slice(0, 500)); }
                              }
                              function m3Exec() {
                                Logger.log('M3EXEC webAppUrl=' + webAppUrl_());
                                  Logger.log('M3EXEC workerTenants=' + platformProp_('WORKER_TENANTS'));
                                  }

                                  function m3WebhookUrl_() {
                                  var tok = platformProp_('PLATFORM_BOT_TOKEN');
                                  if (!tok) return '';
                                  var r = UrlFetchApp.fetch('https://api.telegram.org/bot' + tok + '/getWebhookInfo', {muteHttpExceptions: true});
                                  var j = JSON.parse(r.getContentText());
                                  return (j.result && j.result.url) || '';
                                  }
                                  function m3Poll_(t0, expect) {
                                  var secret = platformProp_('WORKER_SYNC_SECRET');
                                  var execUrl = webAppUrl_() + '?b=worker&k=' + encodeURIComponent(secret);
                                  for (var i = 0; i < 20; i++) {
                                  var r = UrlFetchApp.fetch(execUrl, {method: 'post', contentType: 'application/json', payload: JSON.stringify({action: 'exportTenants', ids: ['test2']}), muteHttpExceptions: true});
                                  var j = null;
                                  try { j = JSON.parse(r.getContentText()); } catch (e) {}
                                  var st = (j && j.tenants && j.tenants[0]) ? j.tenants[0].status : 'ERR' + r.getResponseCode();
                                  var elapsed = Date.now() - t0;
                                  Logger.log('M3POLL i=' + i + ' elapsed=' + elapsed + ' status=' + st);
                                  if (st === expect) return elapsed;
                                  Utilities.sleep(250);
                                  }
                                  return -1;
                                  }
                                  function m3Check() {
                                  var p = PropertiesService.getScriptProperties();
                                  var t0 = Number(p.getProperty('M3_T0') || 0);
                                  var expect = p.getProperty('M3_EXPECT') || '';
                                  var a = loadTenant_('test2', true);
                                  Logger.log('M3CHECK elapsed=' + (t0 ? (Date.now() - t0) : -1) + ' status=' + (a && a.status) + ' expect=' + expect);
                                  }
                                  function m3Post(cmd) {
                                  var url = m3WebhookUrl_();
                                  if (!url) { Logger.log('M3POST no webhook url'); return; }
                                  var owner = Number(platformProp_('PLATFORM_OWNER_ID'));
                                  var seq = Date.now();
                                  var upd = {update_id: 900000000 + (seq % 100000000), message: {message_id: seq % 1000000, from: {id: owner, is_bot: false, first_name: 'Owner'}, chat: {id: owner, type: 'private'}, date: Math.floor(seq / 1000), text: cmd + ' test2'}};
                                  var expect = (cmd === '/suspend') ? 'suspended' : 'active';
                                  var t0 = Date.now();
                                  var resp = UrlFetchApp.fetch(url, {method: 'post', contentType: 'application/json', payload: JSON.stringify(upd), muteHttpExceptions: true});
                                  var postMs = Date.now() - t0;
                                  Logger.log('M3POST cmd=' + cmd + ' postMs=' + postMs + ' code=' + resp.getResponseCode() + ' body=' + resp.getContentText().slice(0, 200));
                                  var p = PropertiesService.getScriptProperties();
                                  p.setProperty('M3_T0', String(t0));
                                  p.setProperty('M3_EXPECT', expect);
                                  p.setProperty('M3_CMD', cmd);
                                  var flipMs = m3Poll_(t0, expect);
                                  Logger.log('M3POST DONE cmd=' + cmd + ' postMs=' + postMs + ' flipMs=' + flipMs);
                                  }
                                  function m3Direct(cmd) {
                                  BOT_ROLE = 'platform';
                                  var owner = Number(platformProp_('PLATFORM_OWNER_ID'));
                                  var seq = Date.now();
                                  var upd = {update_id: 800000000 + (seq % 100000000), message: {message_id: seq % 1000000, from: {id: owner, is_bot: false, first_name: 'Owner'}, chat: {id: owner, type: 'private'}, date: Math.floor(seq / 1000), text: cmd + ' test2'}};
                                  var e = {postData: {contents: JSON.stringify(upd)}, parameter: {}};
                                  var tL0 = Date.now();
                                  var pre = loadTenantTest2Fast_('test2');
                                  Logger.log('M3DIRECT pre status=' + (pre && pre.status) + ' loadMs=' + (Date.now() - tL0));
                                  var t0 = Date.now();
                                  var out = platformPost_(e);
                                  Logger.log('M3DIRECT cmd=' + cmd + ' totalMs=' + (Date.now() - t0) + ' out=' + (out && out.getContent ? out.getContent() : String(out)));
                                  var post = loadTenant_('test2', true);
                                  Logger.log('M3DIRECT post status=' + (post && post.status));
                                  }
                                  function m3Restore() {
                                  var t = loadTenant_('test2', true);
                                  Logger.log('M3RESTORE before status=' + (t && t.status) + ' expiry=' + (t && t.expiry));
                                  updateTenant_('test2', {STATUS: 'trial', EXPIRY: new Date(1796594400000)});
                                  var a = loadTenant_('test2', true);
                                  Logger.log('M3RESTORE after status=' + (a && a.status) + ' expiry=' + (a && a.expiry));
                                  }

                                  function m3Suspend() { m3Post('/suspend'); }
                                  function m3Resume() { m3Post('/resume'); }
                                  function m3DirectSuspend() { m3Direct('/suspend'); }
                                  function m3DirectResume() { m3Direct('/resume'); }

                                  function m3Keys() {
                                  var ks = PropertiesService.getScriptProperties().getKeys();
                                  Logger.log('M3KEYS ' + ks.join(','));
                                  }
                                  function m3OwnerCheck() {
                                  var o = platformProp_('PLATFORM_OWNER_ID');
                                  Logger.log('M3OWNER len=' + String(o).length + ' digits=' + /^\d+$/.test(String(o)));
                                  var secret = platformProp_('WORKER_SYNC_SECRET');
                                  var execUrl = webAppUrl_() + '?b=worker&k=' + encodeURIComponent(secret);
                                  var r = UrlFetchApp.fetch(execUrl, {method: 'post', contentType: 'application/json', payload: JSON.stringify({action: 'exportTenants', ids: ['test2']}), muteHttpExceptions: true});
                                  var j = JSON.parse(r.getContentText());
                                  Logger.log('M3OWNER exportLen=' + String(j.platformOwnerId).length + ' match=' + (String(j.platformOwnerId) === String(o)) + ' tenant=' + JSON.stringify(j.tenants && j.tenants[0]));
                                  }

                                  function m3Probe() {
                                  var url0 = m3WebhookUrl_();
                                  var owner = Number(platformProp_('PLATFORM_OWNER_ID'));
                                  var psecret = platformProp_('PLATFORM_SECRET');
                                  var wsecret = platformProp_('WORKER_SYNC_SECRET');
                                  var base = Date.now();
                                  var variants = [
                                  {name: 'A-secretHeader', url: url0, headers: {'X-Telegram-Bot-Api-Secret-Token': psecret}},
                                  {name: 'B-queryK', url: url0 + '?k=' + encodeURIComponent(psecret), headers: {}},
                                  {name: 'C-both', url: url0 + '?k=' + encodeURIComponent(psecret), headers: {'X-Telegram-Bot-Api-Secret-Token': psecret}},
                                  {name: 'D-workerSecretHeader', url: url0, headers: {'X-Telegram-Bot-Api-Secret-Token': wsecret}},
                                  {name: 'E-uaSecret', url: url0, headers: {'User-Agent': 'TelegramBot (like TwitterBot)', 'X-Telegram-Bot-Api-Secret-Token': psecret}},
                                  {name: 'F-realisticSecret', url: url0, headers: {'X-Telegram-Bot-Api-Secret-Token': psecret}, realistic: true}
                                  ];
                                  for (var vi = 0; vi < variants.length; vi++) {
                                  var v = variants[vi];
                                  var seq = base + vi * 1000;
                                  var msg = {message_id: 1000 + vi, from: {id: owner, is_bot: false, first_name: 'Owner'}, chat: {id: owner, type: 'private'}, date: Math.floor(seq / 1000), text: '/suspend test2'};
                                  if (v.realistic) { msg.from.username = 'owner'; msg.chat.first_name = 'Owner'; msg.entities = [{offset: 0, length: 8, type: 'bot_command'}]; }
                                  var upd = {update_id: 910000000 + vi * 1000 + (seq % 1000), message: msg};
                                  var t0 = Date.now();
                                  var resp = UrlFetchApp.fetch(v.url, {method: 'post', contentType: 'application/json', payload: JSON.stringify(upd), headers: v.headers, muteHttpExceptions: true});
                                  var postMs = Date.now() - t0;
                                  Logger.log('M3PROBE ' + v.name + ' postMs=' + postMs + ' code=' + resp.getResponseCode() + ' body=' + resp.getContentText().slice(0, 200));
                                  if (resp.getResponseCode() === 200) {
                                  var p = PropertiesService.getScriptProperties();
                                  p.setProperty('M3_T0', String(t0));
                                  p.setProperty('M3_EXPECT', 'suspended');
                                  var flipMs = m3Poll_(t0, 'suspended');
                                  Logger.log('M3PROBE DONE ' + v.name + ' postMs=' + postMs + ' flipMs=' + flipMs);
                                  if (flipMs >= 0) return;
                                  }
                                  }
                                  Logger.log('M3PROBE all variants failed');
                                  }
                                  
                                  function m3Probe2() {
                                  var url0 = m3WebhookUrl_();
                                  var owner = Number(platformProp_('PLATFORM_OWNER_ID'));
                                  var base = Date.now();
                                  var r1 = UrlFetchApp.fetch(url0, {method: 'get', muteHttpExceptions: true});
                                  Logger.log('M3P2 GETtelegram code=' + r1.getResponseCode() + ' body=' + r1.getContentText().slice(0, 200));
                                  var root = url0.replace('/telegram', '/');
                                  var r0 = UrlFetchApp.fetch(root, {method: 'get', muteHttpExceptions: true});
                                  Logger.log('M3P2 GETroot code=' + r0.getResponseCode() + ' body=' + r0.getContentText().slice(0, 200));
                                  var texts = ['hello', '/start', '/myid'];
                                  for (var i = 0; i < texts.length; i++) {
                                  var seq = base + i * 1000;
                                  var upd = {update_id: 920000000 + i * 1000 + (seq % 1000), message: {message_id: 2000 + i, from: {id: owner, is_bot: false, first_name: 'Owner'}, chat: {id: owner, type: 'private'}, date: Math.floor(seq / 1000), text: texts[i]}};
                                  var t0 = Date.now();
                                  var resp = UrlFetchApp.fetch(url0, {method: 'post', contentType: 'application/json', payload: JSON.stringify(upd), muteHttpExceptions: true});
                                  Logger.log('M3P2 text=' + texts[i] + ' postMs=' + (Date.now() - t0) + ' code=' + resp.getResponseCode() + ' body=' + resp.getContentText().slice(0, 200));
                                  }
                                  var seq2 = base + 9000;
                                  var upd2 = {update_id: 920009000 + (seq2 % 1000), message: {message_id: 2999, from: {id: 111111111, is_bot: false, first_name: 'Stranger'}, chat: {id: 111111111, type: 'private'}, date: Math.floor(seq2 / 1000), text: '/suspend test2'}};
                                  var resp2 = UrlFetchApp.fetch(url0, {method: 'post', contentType: 'application/json', payload: JSON.stringify(upd2), muteHttpExceptions: true});
                                  Logger.log('M3P2 strangerSuspend code=' + resp2.getResponseCode() + ' body=' + resp2.getContentText().slice(0, 200));
                                  }

                                  function m3Probe3() {
                                  var url0 = m3WebhookUrl_();
                                  var owner = Number(platformProp_('PLATFORM_OWNER_ID'));
                                  var tok = platformProp_('PLATFORM_BOT_TOKEN');
                                  var psecret = platformProp_('PLATFORM_SECRET');
                                  var wsecret = platformProp_('WORKER_SYNC_SECRET');
                                  var t2secret = tenantPropOf('test2', 'SECRET');
                                  var base = Date.now();
                                  var variants = [
                                  {name: 'G-botTokenHeader', headers: {'X-Telegram-Bot-Api-Secret-Token': tok}},
                                  {name: 'H-t2SecretHeader', headers: {'X-Telegram-Bot-Api-Secret-Token': t2secret}},
                                  {name: 'I-workerKeyHeader', headers: {'X-Worker-Secret': wsecret}},
                                  {name: 'J-bearerWorker', headers: {'Authorization': 'Bearer ' + wsecret}},
                                  {name: 'K-bearerPlatform', headers: {'Authorization': 'Bearer ' + psecret}},
                                  {name: 'L-secretTokenPlain', headers: {'Secret-Token': psecret}}
                                  ];
                                  for (var vi = 0; vi < variants.length; vi++) {
                                  var v = variants[vi];
                                  var seq = base + vi * 1000;
                                  var upd = {update_id: 930000000 + vi * 1000 + (seq % 1000), message: {message_id: 3000 + vi, from: {id: owner, is_bot: false, first_name: 'Owner'}, chat: {id: owner, type: 'private'}, date: Math.floor(seq / 1000), text: '/suspend test2'}};
                                  var t0 = Date.now();
                                  var resp = UrlFetchApp.fetch(url0, {method: 'post', contentType: 'application/json', payload: JSON.stringify(upd), headers: v.headers, muteHttpExceptions: true});
                                  var postMs = Date.now() - t0;
                                  Logger.log('M3P3 ' + v.name + ' postMs=' + postMs + ' code=' + resp.getResponseCode() + ' body=' + resp.getContentText().slice(0, 200));
                                  if (resp.getResponseCode() === 200) {
                                  var p = PropertiesService.getScriptProperties();
                                  p.setProperty('M3_T0', String(t0));
                                  p.setProperty('M3_EXPECT', 'suspended');
                                  var flipMs = m3Poll_(t0, 'suspended');
                                  Logger.log('M3P3 DONE ' + v.name + ' postMs=' + postMs + ' flipMs=' + flipMs);
                                  if (flipMs >= 0) return;
                                  }
                                  }
                                  Logger.log('M3P3 all variants failed');
                                  }

                                  function m3Probe3b() {
                                  var url0 = m3WebhookUrl_();
                                  var owner = Number(platformProp_('PLATFORM_OWNER_ID'));
                                  var tok = platformProp_('PLATFORM_BOT_TOKEN');
                                  var psecret = platformProp_('PLATFORM_SECRET');
                                  var wsecret = platformProp_('WORKER_SYNC_SECRET');
                                  var t2secret = tenantPropOf_('test2', 'SECRET');
                                  var base = Date.now();
                                  var variants = [
                                  {name: 'G-botTokenHeader', headers: {'X-Telegram-Bot-Api-Secret-Token': tok}},
                                  {name: 'H-t2SecretHeader', headers: {'X-Telegram-Bot-Api-Secret-Token': t2secret}},
                                  {name: 'I-workerKeyHeader', headers: {'X-Worker-Secret': wsecret}},
                                  {name: 'J-bearerWorker', headers: {'Authorization': 'Bearer ' + wsecret}},
                                  {name: 'K-bearerPlatform', headers: {'Authorization': 'Bearer ' + psecret}},
                                  {name: 'L-secretTokenPlain', headers: {'Secret-Token': psecret}}
                                  ];
                                  for (var vi = 0; vi < variants.length; vi++) {
                                  var v = variants[vi];
                                  var seq = base + vi * 1000;
                                  var upd = {update_id: 930000000 + vi * 1000 + (seq % 1000), message: {message_id: 3000 + vi, from: {id: owner, is_bot: false, first_name: 'Owner'}, chat: {id: owner, type: 'private'}, date: Math.floor(seq / 1000), text: '/suspend test2'}};
                                  var t0 = Date.now();
                                  var resp = UrlFetchApp.fetch(url0, {method: 'post', contentType: 'application/json', payload: JSON.stringify(upd), headers: v.headers, muteHttpExceptions: true});
                                  var postMs = Date.now() - t0;
                                  Logger.log('M3P3B ' + v.name + ' postMs=' + postMs + ' code=' + resp.getResponseCode() + ' body=' + resp.getContentText().slice(0, 200));
                                  if (resp.getResponseCode() === 200) {
                                  var p = PropertiesService.getScriptProperties();
                                  p.setProperty('M3_T0', String(t0));
                                  p.setProperty('M3_EXPECT', 'suspended');
                                  var flipMs = m3Poll_(t0, 'suspended');
                                  Logger.log('M3P3B DONE ' + v.name + ' postMs=' + postMs + ' flipMs=' + flipMs);
                                  if (flipMs >= 0) return;
                                  }
                                  }
                                  Logger.log('M3P3B all variants failed');
                                  }

                                  function m3Direct2(cmd) {
                                  BOT_ROLE = 'platform';
                                  var owner = Number(platformProp_('PLATFORM_OWNER_ID'));
                                  var seq = Date.now();
                                  var upd = {update_id: 700000000 + (seq % 100000000), message: {message_id: seq % 1000000, from: {id: owner, is_bot: false, first_name: 'Owner'}, chat: {id: owner, type: 'private'}, date: Math.floor(seq / 1000), text: cmd + ' test2'}};
                                  var e = {postData: {contents: JSON.stringify(upd)}, parameter: {b: 'platform', k: platformProp_('PLATFORM_SECRET')}};
                                  var tL0 = Date.now();
                                  var pre1 = loadTenantTest2Fast_('test2');
                                  var loadColdMs = Date.now() - tL0;
                                  var tL1 = Date.now();
                                  var pre2 = loadTenantTest2Fast_('test2');
                                  var loadWarmMs = Date.now() - tL1;
                                  Logger.log('M3D2 pre status=' + (pre1 && pre1.status) + ' loadColdMs=' + loadColdMs + ' loadWarmMs=' + loadWarmMs);
                                  var t0 = Date.now();
                                  var out = platformPost_(e);
                                  Logger.log('M3D2 cmd=' + cmd + ' totalMs=' + (Date.now() - t0) + ' out=' + (out && out.getContent ? out.getContent() : String(out)));
                                  var post = loadTenant_('test2', true);
                                  Logger.log('M3D2 post status=' + (post && post.status));
                                  }
                                  function m3Direct2Suspend() { m3Direct2('/suspend'); }
                                  function m3Direct2Resume() { m3Direct2('/resume'); }
                                  