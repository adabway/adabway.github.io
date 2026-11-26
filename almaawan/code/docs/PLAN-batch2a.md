# Batch 2 (a): تسليماتي/درجاتي on the Worker for test2's bot — design (paused 2026-11-24 19:30 Cairo, budget)

Nothing has been deployed for this item, and test2's bot webhook was never touched.

## Findings from the script (v37)
- test2 is unified. In handleTenantPost_, admins and the owner go to the admin handler (adminInfo_), so the Worker must forward their updates. A real tap to test the student path needs a non-admin test student account. Ahmed's own account is the owner.
- /mysubs and /mygrades (onCommand_):
  - The command reads the conversation state from CacheService, keeps {p,email,name,lv}, then clearState_.
  - It then runs openView_ → viewForProgram_ → showMySubs_/showMyGrades_.
  - Those set the state {step:'done',p,email,name,ml}, and the sv:N buttons depend on that state.
- The ms/my callbacks (onCallback_) run ackAndClear_ (answerCallbackQuery + editMessageReplyMarkup), then openView_ with the current state.
- The text forms «تسليماتي»/«درجاتي» depend on st.step (content/edit/mx) and rjpu, so they must be forwarded.
- send_ = sendMessage {chat_id,text,disable_web_page_preview:true,reply_markup:{inline_keyboard}}.
- Webhook URL = tenantHookUrl_(tid,'unified') = WEBAPP_URL?t=&b=unified&k=SECRET. The script answers with HtmlService 200. Dedup goes through cache 'upd:role:update_id'.

## Design
1. Script: new file WorkerBatch3.js, routed from workerBatch1_ and gated to WORKER_TENANTS.
   - exportBotHook → {token, hookUrl, role}. The Worker stores these AES-GCM-encrypted in D1 and never logs them.
   - exportStudentViews {uids?} → per uid, subs and grades {kind:'view'|'other', text, kb}. It uses workerPlanView_, a state-free copy of openView_ + viewForProgram_ + showMy*.
   - studentViewServed {uid,chat,view,kind,msgId,text,kb}. It runs the same state transition as the script (cmd: keep + clear; cb: current state) and setState_ (ml) on it, then countUsage_.
     - If the fresh text or kb differs, it calls editMessageText.
     - If the case is not a plain view (email needed, closed, several programs), it deletes the Worker's message and runs openView_ itself.
2. Worker:
   - POST /tg/<tid>/<role>, with secret_token = HMAC(SYNC_SECRET,'tg-hook:tid:role').
   - It answers locally only for private, non-admin /mysubs, /mygrades and ms/my, and only when all of these hold:
     - the view is fresh (built after any dirty mark, ≤15 min);
     - exactly 1 open program;
     - license and setup are OK.
   - Everything else, and every error, is forwarded. The forward is awaited, with a 55 s timeout; on failure the Worker returns 502 so Telegram retries, and the script dedups. A persistent "forbidden" or HTTP failure → self-heal by calling setWebhook back to the original URL.
   - After a forward, the Worker marks views dirty and re-pulls them: per uid for a private chat, all views for groups or admins. Forwards for a uid wait while that uid's studentViewServed is in flight (≤10 s).
   - Admin endpoints: bot-pull (also records the original getWebhookInfo, encrypted), bot-state, bot-point?to=worker|script, bot-sim (dry run).
3. Rollback: bot-point?to=script → setWebhook(original url, allowed_updates [message,callback_query], max_connections 20, no secret_token).
