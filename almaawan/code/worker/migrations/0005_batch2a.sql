-- 0005_batch2a.sql — batch 2a: tenant-bot /mysubs + /mygrades via the Worker.
-- Additive only. Applied with: cf d1 migrations apply adab-platform (or cf d1 query --sql "$(cat 0005_batch2a.sql)").
-- bot_hooks: per-role bot tokens + webhook URLs, AES-GCM-encrypted (same HKDF(SYNC_SECRET) key as app_keys).
--   hook_url_enc = the script webhook URL (forward target, constant).
--   orig_hook_url_enc = getWebhookInfo.url at pull time (rollback target for bot-point?to=script).
-- student_views: cached plain views per (tenant, uid, view) from exportStudentViews; dirty=1 after a forward until re-pulled.
-- student_view_serving: in-flight studentViewServed marker per (tenant, uid); forwards for that uid wait ≤10 s on it.
-- tg_processed: dedup for locally handled tenant-bot updates, scoped per bot (tid:role) — update_ids repeat across bots.

CREATE TABLE bot_hooks (
  tenant_id TEXT NOT NULL,
  role TEXT NOT NULL,                    -- 'admin' | 'student' | 'unified'
  token_enc TEXT NOT NULL,               -- base64(iv | ciphertext) of the bot token
  hook_url_enc TEXT NOT NULL,            -- base64(iv | ciphertext) of the script webhook URL
  orig_hook_url_enc TEXT,                -- base64(iv | ciphertext) of getWebhookInfo.url at pull time
  orig_allowed_updates TEXT,             -- JSON array from getWebhookInfo
  orig_max_connections INTEGER,
  fail_count INTEGER NOT NULL DEFAULT 0, -- consecutive failed forwards (self-heal at 3, or at once on 'forbidden')
  last_fail_ms INTEGER,
  fetched_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, role)
);

CREATE TABLE student_views (
  tenant_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  view TEXT NOT NULL,                    -- 'subs' | 'grades'
  kind TEXT NOT NULL,                    -- 'view' | 'other' (only 'view' is ever answered locally)
  text TEXT NOT NULL,
  kb_json TEXT,                          -- inline_keyboard JSON or NULL
  built_ms INTEGER NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, uid, view)
);

CREATE TABLE student_view_serving (
  tenant_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  serving_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, uid)
);

CREATE TABLE tg_processed (
  scope TEXT NOT NULL,                   -- 'tid:role'
  update_id INTEGER NOT NULL,
  at_ms INTEGER NOT NULL,
  PRIMARY KEY (scope, update_id)
);
