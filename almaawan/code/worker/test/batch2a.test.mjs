// Batch 2a unit tests — run: node --test test/batch2a.test.mjs
// Mocks: D1 over node:sqlite (real SQLite), fetch (Telegram + script), env.
// Covers: parseTenantUpdate, tgSecret, sealText round-trip, local /mysubs answer,
// gate fallback → forward, admin → forward, wrong secret → 401.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { parseTenantUpdate, tgSecret, sealText, openText, handleTenantTelegram, botPull } from '../batch2a.js';

const SYNC_SECRET = 'test-sync-secret';

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT, status TEXT, expiry_ms INTEGER, quota REAL, setup TEXT, sheet_row INTEGER, sheet_updated_ms INTEGER, pulled_ms INTEGER, dirty INTEGER NOT NULL DEFAULT 0, pending_sync INTEGER NOT NULL DEFAULT 0, pending_op TEXT, last_sync_ms INTEGER, last_sync_error TEXT);
  CREATE TABLE tenant_app_meta (tenant_id TEXT PRIMARY KEY, owner_id TEXT, unified INTEGER NOT NULL DEFAULT 0, mini_app INTEGER NOT NULL DEFAULT 0, license_ok INTEGER NOT NULL DEFAULT 0, setup TEXT, pulled_ms INTEGER);
  CREATE TABLE tenant_admins (tenant_id TEXT NOT NULL, uid TEXT NOT NULL, name TEXT, programs_csv TEXT NOT NULL DEFAULT '', pulled_ms INTEGER, PRIMARY KEY (tenant_id, uid));
  CREATE TABLE programs (tenant_id TEXT NOT NULL, pid TEXT NOT NULL, name TEXT, open INTEGER NOT NULL DEFAULT 0, pulled_ms INTEGER, updated_ms INTEGER, pending_op TEXT, last_sync_error TEXT, PRIMARY KEY (tenant_id, pid));
  CREATE TABLE platform_meta (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE bot_hooks (tenant_id TEXT NOT NULL, role TEXT NOT NULL, token_enc TEXT NOT NULL, hook_url_enc TEXT NOT NULL, orig_hook_url_enc TEXT, orig_allowed_updates TEXT, orig_max_connections INTEGER, fail_count INTEGER NOT NULL DEFAULT 0, last_fail_ms INTEGER, fetched_ms INTEGER NOT NULL, PRIMARY KEY (tenant_id, role));
  CREATE TABLE student_views (tenant_id TEXT NOT NULL, uid TEXT NOT NULL, view TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, kb_json TEXT, built_ms INTEGER NOT NULL, dirty INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (tenant_id, uid, view));
  CREATE TABLE student_view_serving (tenant_id TEXT NOT NULL, uid TEXT NOT NULL, serving_ms INTEGER NOT NULL, PRIMARY KEY (tenant_id, uid));
  CREATE TABLE tg_processed (scope TEXT NOT NULL, update_id INTEGER NOT NULL, at_ms INTEGER NOT NULL, PRIMARY KEY (scope, update_id));`);
  return db;
}

// Minimal D1-compatible wrapper over node:sqlite.
function makeD1(db) {
  const wrap = (stmt) => {
    const bound = (...args) => ({
      all: () => ({ results: stmt.all(...args) }),
      first: () => stmt.get(...args) ?? null,
      run: () => {
        const r = stmt.run(...args);
        return { meta: { changes: r.changes, last_row_id: r.lastInsertRowid } };
      },
    });
    return { bind: bound, all: () => bound().all(), first: () => bound().first(), run: () => bound().run() };
  };
  return {
    prepare: (sql) => wrap(db.prepare(sql)),
    batch: async (stmts) => { for (const s of stmts) await s.run(); return []; },
  };
}

async function seed(env) {
  const now = Date.now();
  const db = env.__db;
  db.prepare("INSERT INTO tenants(id,status,expiry_ms,pulled_ms,dirty,pending_sync) VALUES ('test2','trial',?, ?,0,0)").run(now + 30 * 86400000, now);
  db.prepare("INSERT INTO tenant_app_meta(tenant_id,owner_id,license_ok,setup,pulled_ms) VALUES ('test2','999',1,'done',?)").run(now);
  db.prepare("INSERT INTO platform_meta(key,value) VALUES ('owner_id','1'), ('grace_days','3')").run();
  db.prepare("INSERT INTO programs(tenant_id,pid,name,open,pulled_ms) VALUES ('test2','p1','برنامج',1,?)").run(now);
  db.prepare("INSERT INTO student_views(tenant_id,uid,view,kind,text,kb_json,built_ms,dirty) VALUES ('test2','111','subs','view','تسليماتك: واجب 1 ✓','[[{\"text\":\"عرض\",\"callback_data\":\"ms\"}]]',?,0)").run(now);
  const tokenEnc = await sealText(env, '123:TESTTOKEN');
  const hookEnc = await sealText(env, 'https://script.google.com/macros/s/FAKE/exec?t=test2&b=unified&k=SECRET');
  const origEnc = await sealText(env, 'https://script.google.com/macros/s/FAKE/exec?t=test2&b=unified&k=SECRET');
  db.prepare("INSERT INTO bot_hooks(tenant_id,role,token_enc,hook_url_enc,orig_hook_url_enc,fetched_ms) VALUES ('test2','unified',?,?,?,?)").run(tokenEnc, hookEnc, origEnc, now);
}

function makeEnv() {
  const db = makeDb();
  const calls = { telegram: [], script: [] };
  const env = {
    __db: db, DB: makeD1(db), SYNC_SECRET, ALLOWLIST: 'test2',
    SCRIPT_EXEC_URL: 'https://script.google.com/macros/s/FAKE/exec', MAX_STALE_MS: 1800000,
    TG_FORWARD_TIMEOUT_MS: 55000,
  };
  // fetch mock: Telegram API + script exec (?b=worker actions)
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://api.telegram.org/bot123:TESTTOKEN/')) {
      const method = u.split('/').pop();
      const body = JSON.parse(opts.body || '{}');
      calls.telegram.push({ method, body });
      if (method === 'sendMessage') return Response.json({ ok: true, result: { message_id: 42 } });
      if (method === 'answerCallbackQuery' || method === 'editMessageText' || method === 'getWebhookInfo' || method === 'setWebhook') return Response.json({ ok: true, result: method === 'getWebhookInfo' ? { url: 'https://script.example/exec' } : true });
      return Response.json({ ok: true, result: {} });
    }
    if (u.startsWith('https://script.google.com/macros/s/FAKE/exec')) {
      const body = JSON.parse(opts.body || '{}');
      calls.script.push(body);
      if (body.action === 'studentViewServed') return Response.json({ ok: true, view: { kind: 'view', text: 'تسليماتك: واجب 1 ✓ (محدّثة)', kb: null } });
      if (body.action === 'exportStudentViews') return Response.json({ ok: true, views: [] });
      if (body.action === 'exportBotHook') return Response.json({ ok: true, token: '123:TESTTOKEN', hookUrl: 'https://script.google.com/macros/s/FAKE/exec?t=test2&b=unified&k=SECRET', role: body.role });
      return Response.json({ ok: true });
    }
    return Response.json({ ok: true, result: {} });
  };
  return { env, calls };
}

async function secret(env) { return tgSecret(env, 'test2', 'unified'); }

function req(update, sec) {
  return new Request('https://worker.example/tg/test2/unified', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': sec }, body: JSON.stringify(update),
  });
}

test('parseTenantUpdate classifies commands, callbacks, view text, groups', () => {
  assert.equal(parseTenantUpdate({ update_id: 1, message: { chat: { type: 'private' }, from: { id: 5 }, text: '/mysubs' } }).kind, 'cmd');
  assert.equal(parseTenantUpdate({ update_id: 2, callback_query: { id: 'c', data: 'ms', from: { id: 5 }, message: { chat: { id: 5 }, message_id: 9 } } }).kind, 'cb');
  assert.equal(parseTenantUpdate({ update_id: 3, message: { chat: { type: 'private' }, from: { id: 5 }, text: 'تسليماتي' } }).kind, 'viewtext');
  assert.equal(parseTenantUpdate({ update_id: 4, message: { chat: { type: 'group' }, from: { id: 5 }, text: '/mysubs' } }).kind, 'other');
  assert.equal(parseTenantUpdate({ update_id: 5, message: { chat: { type: 'private' }, from: { id: 5 }, text: '/start' } }).kind, 'other');
});

test('tgSecret is HMAC(SYNC_SECRET, tg-hook:tid:role)', async () => {
  const { env } = makeEnv();
  const got = await tgSecret(env, 'test2', 'unified');
  const want = createHmac('sha256', SYNC_SECRET).update('tg-hook:test2:unified').digest('hex');
  assert.equal(got, want);
});

test('sealText/openText round-trip', async () => {
  const { env } = makeEnv();
  const sealed = await sealText(env, '123:ABC-DEF_secret');
  assert.equal(await openText(env, sealed), '123:ABC-DEF_secret');
});

test('local /mysubs answer: sends cached view, serves state in background, updates cache', async () => {
  const { env, calls } = makeEnv();
  await seed(env);
  let bg;
  const ctx = { waitUntil: (p) => { bg = p; return p; } };
  const res = await handleTenantTelegram(req({ update_id: 10, message: { chat: { type: 'private', id: 111 }, from: { id: 111 }, text: '/mysubs' } }, await secret(env)), env, ctx, new URL('https://worker.example/tg/test2/unified'));
  assert.equal(res.status, 200);
  assert.equal(calls.telegram.length, 1);
  assert.equal(calls.telegram[0].method, 'sendMessage');
  assert.equal(calls.telegram[0].body.text, 'تسليماتك: واجب 1 ✓');
  assert.equal(calls.telegram[0].body.chat_id, 111);
  // studentViewServed was called in the background and refreshed the cache
  await bg;
  assert.equal(calls.script.length, 1);
  assert.equal(calls.script[0].action, 'studentViewServed');
  assert.equal(calls.script[0].via, 'cmd');
  const row = env.__db.prepare("SELECT text FROM student_views WHERE uid='111' AND view='subs'").get();
  assert.equal(row.text, 'تسليماتك: واجب 1 ✓ (محدّثة)');
});

test('stale view falls back to forward', async () => {
  const { env, calls } = makeEnv();
  await seed(env);
  env.__db.prepare("UPDATE student_views SET built_ms = ? WHERE uid='111'").run(Date.now() - 20 * 60 * 1000);
  const ctx = { waitUntil: (p) => p };
  const res = await handleTenantTelegram(req({ update_id: 11, message: { chat: { type: 'private', id: 111 }, from: { id: 111 }, text: '/mygrades' } }, await secret(env)), env, ctx, new URL('https://worker.example/tg/test2/unified'));
  assert.equal(res.status, 200);
  assert.equal(calls.telegram.length, 0); // nothing answered locally
  assert.ok(calls.script.length >= 1); // forward reached the script (exportStudentViews re-pull after forward)
});

test('admin sender is forwarded, not answered locally', async () => {
  const { env, calls } = makeEnv();
  await seed(env);
  const ctx = { waitUntil: (p) => p };
  const res = await handleTenantTelegram(req({ update_id: 12, message: { chat: { type: 'private', id: 999 }, from: { id: 999 }, text: '/mysubs' } }, await secret(env)), env, ctx, new URL('https://worker.example/tg/test2/unified'));
  assert.equal(res.status, 200);
  assert.equal(calls.telegram.filter((c) => c.method === 'sendMessage').length, 0);
});

test('wrong secret → 401', async () => {
  const { env } = makeEnv();
  await seed(env);
  const res = await handleTenantTelegram(req({ update_id: 13, message: { chat: { type: 'private', id: 111 }, from: { id: 111 }, text: '/mysubs' } }, 'deadbeef'), env, { waitUntil: (p) => p }, new URL('https://worker.example/tg/test2/unified'));
  assert.equal(res.status, 401);
});

test('botPull pulls all three roles and stores them (bind-count regression)', async () => {
  const { env, calls } = makeEnv();
  const res = await botPull(env, 'test2');
  assert.equal(res.ok, true);
  assert.deepEqual(res.roles, ['admin', 'student', 'unified']);
  assert.deepEqual(res.failures, []);
  assert.equal(calls.script.filter((c) => c.action === 'exportBotHook').length, 3);
  const rows = env.__db.prepare("SELECT role, fail_count FROM bot_hooks WHERE tenant_id='test2' ORDER BY role").all();
  assert.deepEqual(rows.map((r) => r.role), ['admin', 'student', 'unified']);
  assert.ok(rows.every((r) => r.fail_count === 0));
});
