# Adab platform — full operation inventory (typed commands, buttons, messages, doPost routes)

Source: `/workspace/adab-worker/apply/` (= `script-snapshot/` + Version 35 WorkerSync), read 2026-11-24 14:4x Cairo.
Mini-app actions (platform 7 / owner 23 / student 13) were listed in group msg 143 and are repeated at the end for completeness.

**Legend**
- **R/W**: R = read only. W = writes a Sheet, Script Properties or Telegram state. C = cache only (CacheService, no Sheet).
- **Sheets**:
  - **REG** = platform registry file (العملاء, سجل أخطاء المنصة, الاستهلاك).
  - **CTL** = tenant control file «ملف التحكم» (البرامج, المستخدمون, المشرفون, سجل التعديلات, سجل الأحداث, رسائل المراجعة, سجل الورد, سجل الأسئلة, الملخص الشهري).
  - **PRG** = program file (الإعدادات, تسليمات الفعاليات, تصحيح البريد, درجات يدوية, بريد غير مطابق, المواعيد, خطة الورد, التقرير الشهري, الأسئلة الشائعة, سجل الشهادات). REGSRC = the program's external registration sheet.
  - **PROPS** = Script Properties.
- **Freq** (estimate per active tenant): **H** = many per day (students), **M** = daily (admins), **L** = weekly or rarer (setup or owner).
- Every tenant webhook also does `countUsage_` (cache only). Writes also append to سجل التعديلات (logChange_) and/or سجل الأحداث (flushEvents_) in CTL.

## 0. HTTP entry points (`doPost`, Part3:554)
| # | Route | What | R/W | Sheets | Freq |
|---|---|---|---|---|---|
| 1 | `?b=platform&k=` | platform bot webhook (now via the Worker; `/suspend`/`/resume test2` handled in the Worker) | mixed | REG, PROPS | L |
| 2 | `?b=worker` `exportTenants` | Worker pull (WORKER_TENANTS only) | R | REG | every 5 min (cron) |
| 3 | `?b=worker` `syncTenantStatus` | Worker push of suspend/resume | W | REG | per op |
| 4 | `?b=app&r=platform` | platform mini-app (7 actions, §6) | mixed | REG, CTL | L–M |
| 5 | `?b=app&t=&r=admin\|student\|unified` | tenant mini-apps (owner 23 / student 13, §6) | mixed | CTL, PRG | H |
| 6 | `?b=admin\|student\|unified&t=&k=` | tenant bot webhooks → `handleTenantPost_` (dedup by update_id, license check, then wizard/admin/student/group routers, §2–§5) | mixed | all | H |
| 7 | `doGet` | returns `ok` (health) | R | — | L |
| — | Time triggers (not doPost) | hourly tick: module onTick (wird publish, quiz import, monthly report), reminders, backups, health check | W | CTL, PRG | hourly |

## 1. Platform bot (@AutomatePrBot), `platformPost_` / `onPlatformMessage_` / `ownerCommand_` (Part4:380–715)
| # | Command | Who | What | R/W | Sheets | Freq |
|---|---|---|---|---|---|---|
| 1 | `/myid` | anyone | show id | R | — | L |
| 2 | `/cancel` | anyone | clear activation step | C | — | L |
| 3 | `/app` | owner | send platform mini-app button | R | PROPS | M |
| 4 | `/activate` + steps `lic` → `mode` (1/2) → `tok` or `atok`→`stok` | client owner | license check, save bot tokens, set webhooks, register owner | W | REG (العملاء: STOK/ATOK/SETUP/OWNER), PROPS (T:id:*_TOKEN), Telegram setWebhook | L |
| 5 | `/status` | client owner | setup status | R | REG | L |
| 6 | (any other text) | anyone | help text | R | — | L |
| 7 | `/addtenant id name` | owner | create client (license, control file, row) | W | REG, Drive (copies template), PROPS | L |
| 8 | `/tenants` | owner | list clients | R | REG (+usage cache) | M |
| 9 | `/tenant id` | owner | one client detail | R | REG | M |
| 10 | `/extend id days` | owner | extend expiry | W | REG | L |
| 11 | `/suspend id` | owner | suspend (**Worker-local for test2**) | W | REG | L |
| 12 | `/resume id` | owner | resume (**Worker-local for test2**) | W | REG | L |
| 13 | `/quota id n` | owner | program quota | W | REG | L |
| 14 | `/owner id uid` | owner | set client owner | W | REG | L |
| 15 | `/rotate id` | owner | new webhook secret + re-set webhooks | W | PROPS, Telegram | L |
| 16 | `/webhooks id` | owner | re-set webhooks | W | Telegram | L |
| 17 | `/addon id module on\|off` | owner | allow/deny add-on | W | REG (الإضافات) | L |
| 18 | `/setmsg role text\|reset` | owner | blocked-client message | W | PROPS | L |
| 19 | `/stats` | owner | platform stats | R | REG, usage cache | L |
| — | callback_query | — | answered and ignored | — | — | — |
**Platform bot: 19 operations** (11 W, 7 R, 1 C).

## 2. Setup wizard (tenant admin or unified bot before setup is done), `handleWizardUpdate_` / `wzCallback_` / `wzText_` (Part3:2329–2480)
| # | Operation | R/W | Sheets | Freq |
|---|---|---|---|---|
| 1 | `/myid` | R | — | L |
| 2 | `/setup` / `/start` (start wizard) | C | — | L |
| 3 | `/cancel` or button `WZ:X` | C | — | L |
| 4 | text step `license` | R | REG | L |
| 5 | button `WZ:OWN` (confirm owner) | C | — | L |
| 6 | text step `review` (review group) / `WZ:SKIPR` | C | — | L |
| 7 | text step `emails` / `WZ:SKIPE` | C | — | L |
| 8 | text step `pname` (first program name) | C | — | L |
| 9 | text step `levels` / `WZ:NOLV` | C | — | L |
| 10 | button `WZ:GO` → `wzFinish_` (creates control and program files, shares, writes owner, setup=done) | W | REG, CTL, PRG, Drive | L |
**Wizard: 10 operations** (2 W).

## 3. Program admin bot (`b=admin`, or unified bot for admins), `handleAdminUpdate_` / `onAdminCallback_` / `onAdminText_` / `commit_` (Part1:47–700)
### 3a. Typed commands
| # | Command | What | R/W | Sheets | Freq |
|---|---|---|---|---|---|
| 1 | `/myid` | id | R | — | L |
| 2 | `/start`, `/programs` | home / programs list | R | CTL (البرامج, المشرفون) | M |
| 3 | `/cancel` | cancel pending | C | — | M |
| 4 | `/admins` (owner) | admins screen | R | CTL المشرفون | L |
| 5 | `/modules` (owner) | add-ons screen | R | PROPS | L |
| 6 | `/setup` | "already set up" | R | — | L |
| 7 | `/app` | mini-app button | R | — | M |
| 8 | `/help` / unknown | help | R | — | L |
| 9 | `/quiz` [list \| add pid\|test\|link \| del \| run] (quizImport) | quiz import sources and run | W | PROPS (MOD_quizImport), PRG (درجات/الإعدادات), source Forms sheets | L |
| 10 | `/wird` [pid on\|off\|channel\|hour\|text\|photo\|format\|friday\|holiday\|pause\|resume\|skip\|schedule\|import\|test\|stop] (dailyWird) | daily wird config and test post | W | PRG خطة الورد, PROPS, CTL سجل الورد | L |
| 11 | `/faq` [pending \| limit n \| list] (studentQA) | FAQ and pending questions | R/W | PRG الأسئلة الشائعة, CTL سجل الأسئلة | M |
| 12 | `/report` [on\|off \| admins \| details \| help \| run] (monthlyReport) | monthly report | W | PRG التقرير الشهري, CTL الملخص الشهري, PROPS | L |
| 13 | `/cert` [status\|help \| template \| text \| send \| sendall] (certificates) | PDF certificates | W | PRG سجل الشهادات, Drive/Slides, PROPS | L |
### 3b. Buttons (callback_data)
| # | Button | What | R/W | Sheets | Freq |
|---|---|---|---|---|---|
| 14 | `H` | help | R | — | L |
| 15 | `X` | cancel input | C | — | M |
| 16 | `L` | programs list | R | CTL البرامج | M |
| 17 | `P:pid` | open program main | R | CTL, PRG الإعدادات | M |
| 18 | `M` | program main | R | PRG الإعدادات | M |
| 19 | `S:sec` | settings section (GEN/COMP/GRP/ACT/BANDS/LEVELS) | R | PRG الإعدادات | M |
| 20 | `I:n` | settings item | R | PRG الإعدادات | M |
| 21 | `F:key` | start editing a field | R | PRG الإعدادات | M |
| 22 | `C:n` | pick a choice value | C | — | M |
| 23 | `ADD` | add item (band/level/group/activity) | C | — | L |
| 24 | `DEL` | delete band (asks confirm) | R | PRG | L |
| 25 | `TOG` | open/close program for submissions (confirm) | R | CTL البرامج | L–M |
| 26 | `OK` → `commit_` kinds: set, add, clear, toggle, **pause**, admadd, admdel, copyprog, remind, remsend, weekly, level, BANDS | **the write step for all confirmed edits** | W | PRG الإعدادات / CTL البرامج / CTL المشرفون / PRG المواعيد + CTL سجل التعديلات | M |
| 27 | `NO` | cancel pending edit | C | — | M |
| 28 | `CALC` | recompute grades | W | PRG (درجات, التقديرات) | M |
| 29 | `SUM` | program summary | R | PRG تسليمات/درجات | M |
| 30 | `LAST` | latest submissions | R | PRG تسليمات الفعاليات | M |
| 31 | `FIND` | lookup student by email (asks text) | R | PRG, REGSRC | M |
| 32 | `V:row` | view one submission | R | PRG تسليمات الفعاليات | M |
| 33 | `PZ` | activity pause menu (يوم / 3 أيام / أسبوع / حتى تاريخ / حتى أعيد تفعيلها) | R | PRG الإعدادات | M |
| 34 | `PZ:1\|3\|7\|inf` | choose pause length → confirm → `OK` writes | W (via OK) | PRG الإعدادات (pausedFrom/pausedUntil) | M |
| 35 | `PZ:date` | pause until a date (asks text `pauseDate`) | W (via OK) | PRG الإعدادات | L |
| 36 | `PZN` | activate now (resume) → confirm | W (via OK) | PRG الإعدادات | M |
| 37 | `WRT` | weekly report toggle | W | PROPS/PRG | L |
| 38 | `WRN` | weekly report now | R+send | PRG | L |
| 39 | `NEWP`/`ADDP` (owner) | new program from template (asks name) | W | Drive, CTL البرامج, REG quota | L |
| 40 | `NEWNOLV` | create program without levels | W | Drive, CTL | L |
| 41 | `ADM` | admins list | R | CTL المشرفون | L |
| 42 | `ADMADD` | add admin (asks text) | W (via OK) | CTL المشرفون | L |
| 43 | `APT:id:pid` | toggle admin's program access | W | CTL المشرفون | L |
| 44 | `ADMDEL:id` | delete admin (confirm) | W (via OK) | CTL المشرفون | L |
| 45 | `CPY` / `CPS` / `CPB` / `CPSKIP` / `CPO` | copy-program wizard (5 buttons + text steps) | W (via OK copyprog) | Drive, CTL البرامج, PRG | L |
| 46 | `MOD` / `MOD:id` | add-ons list / toggle add-on | W | PROPS (tenant conf) | L |
| 47 | `MX:id:…` | module buttons: `dailyWird imp`, `studentQA s\|c\|i\|f:qid`, `monthlyReport ra:uid` | W | PRG خطة الورد / CTL سجل الأسئلة / PROPS | M |
| 48 | `RMT` / `RMP` / `RMN` / `RMI:n` | reminders: toggle / preview / manual menu / manual send | W/R | PRG المواعيد, CTL المستخدمون, PROPS | M |
| 49 | `SCH` / `SCA` / `SCP` / `SCC` / `SCI` / `SCF` / `SCV` / `SCD` | schedule (المواعيد): show / add / pick / close / item / field / value / delete | W (via OK) | PRG المواعيد | L |
### 3c. Text inputs (`st.await`) and module waits
| # | Input | R/W | Sheets | Freq |
|---|---|---|---|---|
| 50 | `value` / `band` / `newTitle` / `newName` / `newLevels` / `newMax` / `newPoints` / `progId` / `progLink` (validated, then confirm → OK) | C→W | PRG الإعدادات, CTL البرامج | M |
| 51 | `lookup` (student email) | R | PRG, REGSRC | M |
| 52 | `pauseDate` | C→W | PRG الإعدادات | L |
| 53 | `admin` (id + name) | C→W | CTL المشرفون | L |
| 54 | copy steps `cp*` (`onCopyText_`) | C→W | Drive, CTL | L |
| 55 | module waits: wird channel/photo; studentQA written reply | W | PROPS, CTL سجل الأسئلة + Telegram send to student | M |
**Admin bot: 55 inventory lines** (13 commands, 36 button groups (#14–#49), 6 text-input kinds). Counted button by button: **50 callback codes** (H X L P M S I F C ADD DEL TOG OK NO CALC SUM LAST FIND V PZ PZN WRT WRN NEWP(=ADDP) NEWNOLV ADM ADMADD APT ADMDEL, CP×5, MOD, MX×3 module actions, RM×4, SC×8).

## 4. Student bot, private chat (`b=student` / unified for non-admins), `handleUpdate_` / `onCommand_` / `onCallback_` (Part1:2169–2400)
| # | Operation | What | R/W | Sheets | Freq |
|---|---|---|---|---|---|
| 1 | `/start [pid]` | programs / welcome / activities | R | CTL البرامج, PRG الإعدادات | H |
| 2 | `/mysubs` | my submissions | R | PRG تسليمات, CTL المستخدمون | H |
| 3 | `/mygrades` | my grades | R | PRG درجات/تسليمات, REGSRC | H |
| 4 | `/email` | forget saved email | W | CTL المستخدمون | L |
| 5 | `/cancel` | cancel (+ pending reject reason) | C | — | M |
| 6 | `/myid` | id | R | — | L |
| 7 | `/reminders` | reminders on/off screen | R | CTL المستخدمون/PROPS | L |
| 8 | `/app` | mini-app button | R | — | M |
| 9 | `/help` / unknown | help | R | — | M |
| 10 | `/ask text` (studentQA) | question → FAQ suggestion or to admins | W | PRG الأسئلة الشائعة, CTL سجل الأسئلة, group post | M |
| 11 | btn `p:pid` | choose program | R | PRG | H |
| 12 | btn `l:n` / `lv` | choose / change level | C | PRG (cached) | H |
| 13 | btn `a:n` | choose activity → ask email or content | R | CTL المستخدمون, PRG | H |
| 14 | btn `e:keep` / `e:new` | use saved email / new email | R/C | REGSRC | H |
| 15 | text: email (`email`/`confirmEmail`, or outside the flow) | registration lookup + save email | W | REGSRC (R), CTL المستخدمون (W) | H |
| 16 | message: content (text/photo/file/album) `onContent_` | **submission**: append row, post to review group, events | W | PRG تسليمات الفعاليات, CTL رسائل المراجعة, CTL سجل الأحداث | **H (core)** |
| 17 | btn `again` | submit again | R | PRG | H |
| 18 | btn `menu` | back to activities | R | PRG | H |
| 19 | btn `ms` / `my` / `pv:kind:pid` | open subs / grades (per program) | R | PRG, REGSRC | H |
| 20 | btn `go:…` | go submit from a view | R | PRG | M |
| 21 | btn `sv:n` / `se:n` / `sd:n` / `sdy:n` | view / edit / ask delete / confirm delete a submission | R / W (se, sdy) | PRG تسليمات الفعاليات, CTL رسائل المراجعة | M |
| 22 | message in edit step `onEditContent_` | replace submission content | W | PRG تسليمات, group message edit | M |
| 23 | btn `rm:on` / `rm:off` | reminders on/off | W | CTL المستخدمون / PROPS | L |
| 24 | text "تسليماتي" / "درجاتي" | open views | R | PRG | M |
| 25 | btn `mx:studentQA:p:pid` + QA text step | QA choose program / question text | W | CTL سجل الأسئلة | M |
| 26 | private text from an admin = reject reason (`onRejectReasonPrivate_`) | reject with reason | W | PRG تسليمات, notify student | M |
**Student private: 26 operations** (9 commands, 1 module command, 12 button groups, 4 message kinds).

## 5. Student bot in groups (review groups), `onGroupMessage_` / `onGroupCommand_` / `onGroupCallback_` (Part3:310–480, Part4:1257–1310)
| # | Operation | R/W | Sheets | Freq |
|---|---|---|---|---|
| 1 | `/help` / `/start` | R | — | L |
| 2 | `/linkreview [pid]` (+ btn `gl:pid`) | W | PRG الإعدادات (review chat id) | L |
| 3 | `/unlinkreview` (+ btn `gu:pid`) | W | PRG الإعدادات | L |
| 4 | btn `rj` (reject) / `rn` / `ru` (unreject) on a submission | W | PRG تسليمات الفعاليات, CTL رسائل المراجعة, notify student | **H** |
| 5 | reply to a submission = grade / feedback (`onReviewReply_`) | W | PRG تسليمات (ملاحظات المشرف/درجة), CTL رسائل المراجعة | **H** |
| 6 | reply to the "reject reason" prompt (`onRejectReasonInGroup_`) | W | PRG تسليمات | M |
| 7 | btn `mx:studentQA:[s\|c\|i\|f]:qid` (send suggestion / write reply / ignore / to FAQ) | W | CTL سجل الأسئلة, PRG الأسئلة الشائعة | M |
| 8 | reply to a student question (`qaGroupReply_`) | W | CTL سجل الأسئلة + send to student | M |
| 9 | group migrated to supergroup (`migrate_to/from_chat_id`) | W | PRG الإعدادات (all programs) | L |
| — | anything else | ignored, no read | — | — |
**Groups: 9 operations** (7 W).

## 6. Mini-app actions (from group msg 143, `?b=app`)
- **Platform (7):** bootstrap/tenants, tenant, addTenant, extend, suspend, resume, addon. Suspend/resume are Worker-fast for test2.
- **Owner/admin panel (23):** bootstrap, review, reject, unreject, sendFile, **pause**, **resume**, toggleOpen, settings, setSetting, schedule, setSchedule, remindOn, previewRemind, summary, report, qaPending, qaAct, modules, toggleModule, admins, addAdmin, removeAdmin.
- **Student panel (13):** bootstrap, setEmail, submitText, startFile, subs, grades, editText, startEditFile, deleteSub, wird, ask, questions, reminders.

## Totals
| Surface | Operations |
|---|---|
| doPost / HTTP routes | 7 (+ hourly triggers) |
| Platform bot typed | 19 |
| Setup wizard | 10 |
| Admin bot | 13 commands + 50 callback codes + 6 text-input kinds = **69** (55 lines above) |
| Student bot private | 26 |
| Student bot in groups | 9 |
| **Bots total (typed + buttons + messages)** | **133** (19 + 10 + 69 + 26 + 9; table lines 119) |
| Mini-app actions | 43 (7 + 23 + 13) |

**Hot paths by frequency** (where speed matters most):
1. Student submission flow: `/start` → `p:` / `l:` / `a:` → email → content.
2. Group review: reply grading and `rj`/`ru`.
3. Mini-app bootstraps: the 3 panels.
4. Admin navigation `P/M/S/I` + `OK` writes, especially activity pause/resume.
5. `/mysubs`, `/mygrades`.

Platform-owner operations are rare.
