// ===== WorkerBatch3.gs =====
/**
 * WorkerBatch3.gs — batch 2a of the Cloudflare Worker fast path (WORKER_TENANTS only, today test2).
 * New ?b=worker actions only; no existing function is changed. Dispatched from workerBatch1_
 * (WorkerBatch1.gs) — add the three action names to its list and the three dispatch lines.
 *  - exportBotHook      {tid, role}                 → {ok, token, hookUrl, role}
 *  - exportStudentViews {tid, uids?}                → {ok, views:[{uid, subs:{kind,text,kb}|null, grades:{kind,text,kb}|null}]}
 *  - studentViewServed  {tid, uid, chat, view, kind, msgId, text, kb, via}
 *                                                   → {ok, view:{kind, text, kb}}
 *
 * The Worker answers /mysubs, /mygrades, ms/my locally from the cached view and then calls
 * studentViewServed so the script runs the SAME state transition it would have run itself
 * (onCommand_: keep {step:'done', p, email, name, lv} then clearState_; onCallback_: current state),
 * then setState_ (ml) and countUsage_. The Sheet stays the source of truth; every read below is
 * the same read openView_ makes. Nothing here sends a message except the take-over path.
 * All functions run inside withTenant_ (TENANT_ context), like exportActivities.
 */
function workerExportBotHook_(t, body) {
  var role = String(body.role || 'unified');
  if (role !== 'admin' && role !== 'student' && role !== 'unified') return { ok: false, error: 'bad role' };
  var token = tokenFor_(role); // Part3.gs: unified → prop_('BOT_TOKEN'); admin → ADMIN_BOT_TOKEN or unified fallback
  if (!token) return { ok: false, error: 'no token for role ' + role };
  // tenantHookUrl_ (Part3.gs): webAppUrl_() + '?t=' + tid + '&b=' + role + '&k=' + tenantPropOf_(tid, 'SECRET')
  return { ok: true, token: token, hookUrl: tenantHookUrl_(t.id, role), role: role };
}

/**
 * State-free copy of openView_ + viewForProgram_ + showMySubs_/showMyGrades_ (Part3.gs).
 * `st` is the starting state: the kept state for a command, the current state for a callback.
 * Returns {kind:'view', text, kb, st} — st is the final state the script should store —
 * or {kind:'other', reason} when this is not a plain view (no/several programs, closed program,
 * grades/subs off, email needed, no submissions, grades error). Never sends, never writes state.
 */
function workerPlanViewFrom_(uid, st, view) {
  st = st || {};
  var progs = getOpenPrograms_();
  var p = st.p && progs.filter(function (x) { return x.id === st.p; })[0];
  if (!p && progs.length === 1) p = progs[0];
  if (!p) return { kind: 'other', reason: !progs.length ? 'noPrograms' : 'several' };
  var prog = loadProgram_(p.id);
  if (!prog || !prog.open) return { kind: 'other', reason: 'closed' };
  var opts = studentOptions(prog.general);
  if (view === 'grades' && !opts.showGrades) return { kind: 'other', reason: 'gradesOff' };
  if (view === 'subs' && !opts.showSubs) return { kind: 'other', reason: 'subsOff' };
  if (st.p !== prog.id) st = { p: prog.id };
  if (!st.email) {
    var saved = getUserEmail_(uid), f = saved && lookupRegistration_(prog, saved);
    if (f) { st.email = f.email; st.name = f.name; }
  }
  if (!st.email) return { kind: 'other', reason: 'email' };
  if (!st.step || st.step === 'email' || st.step === 'confirmEmail' || st.step === 'program') st.step = 'done';
  delete st.after;
  if (view === 'grades') return workerPlanGrades_(uid, st, prog);
  return workerPlanSubs_(uid, st, prog);
}

/** Copy of showMySubs_ (Part3.gs, lines 1415–1427) returning {text, kb} instead of sending. */
function workerPlanSubs_(uid, st, prog) {
  // Privacy: only submissions sent from this Telegram account (email alone is not enough).
  var list = mySubmissions(subsValues2_(prog), st.email).filter(function (x) { return String(x.uid) === String(uid); }).slice(0, VIEW.LIST);
  if (!list.length) return { kind: 'other', reason: 'noSubs' };
  st.ml = list.map(function (x) { return x.id; });
  var lines = list.map(function (x, i) {
    var body = x.text ? '«' + clip(x.text, 60).replace(/\n/g, ' ') + '»' : (x.fileName || x.type);
    return (i + 1) + ') ' + subLabel_(x) + ' — ' + fmtTime(x.time) + ' — ' + statusIcon_(x) + (x.edited ? ' ✏️' : '') + '\n  ' + body;
  });
  var kb = rows_(list.map(function (x, i) { return { text: String(i + 1), callback_data: 'sv:' + i }; }), 5);
  kb.push([{ text: '📋 تسليم جديد', callback_data: 'menu' }].concat(studentOptions(prog.general).showGrades ? [{ text: '📊 درجاتي', callback_data: 'my' }] : []));
  return { kind: 'view', text: 'تسليماتك في «' + prog.name + '» (آخر ' + list.length + '):\n\n' + lines.join('\n') + '\n\nاضغط رقمًا لعرض التسليم وتعديله أو حذفه.', kb: kb, st: st };
}

/** Copy of showMyGrades_ (Part3.gs, lines 1399–1413) returning {text, kb} instead of sending. */
function workerPlanGrades_(uid, st, prog) {
  var kb = [[{ text: '📋 تسليم جديد', callback_data: 'menu' }].concat(studentOptions(prog.general).showSubs ? [{ text: '🗂 تسليماتي', callback_data: 'ms' }] : [])];
  var key = myKey_(prog.id, st.email), c = cache_().get(key);
  if (c) return { kind: 'view', text: c, kb: kb, st: st };
  var text;
  try {
    var snap = standingSnapshot_(prog), subs = subsValues2_(prog);
    var r = computeStanding(snap, st.email, subs);
    text = clip(formatStanding({ res: r.res, st: r.st, cfg: r.cfg, counts: acceptedCounts(r.cfg, subs, st.email), email: st.email, programName: prog.name, snapAt: snap.t }));
    cache_().put(key, text, VIEW.MY_TTL);
  } catch (e) {
    logError_(e, 'mygrades ' + prog.id + ' ' + st.email);
    return { kind: 'other', reason: 'gradesError' };
  }
  return { kind: 'view', text: text, kb: kb, st: st };
}

function workerExportStudentViews_(t, body) {
  var uids = body.uids;
  if (!uids) uids = workerStudentUids_(t); // all registered students (groups/admins re-pull)
  var views = [];
  (uids || []).forEach(function (uid) {
    uid = String(uid);
    // The cache answers a future /mysubs or /mygrades, whose script path starts from the
    // kept state (onCommand_: keep {step:'done', p, email, name, lv} when p+email exist).
    var cur = getState_(uid) || {};
    var keep = cur.p && cur.email ? { step: 'done', p: cur.p, email: cur.email, name: cur.name, lv: cur.lv } : {};
    var subs = workerPlanViewFrom_(uid, keep, 'subs');
    var grades = workerPlanViewFrom_(uid, keep, 'grades');
    views.push({ uid: uid,
      subs: subs.kind === 'view' ? { kind: 'view', text: subs.text, kb: subs.kb } : { kind: 'other', text: null, kb: null },
      grades: grades.kind === 'view' ? { kind: 'view', text: grades.text, kb: grades.kb } : { kind: 'other', text: null, kb: null } });
  });
  return { ok: true, views: views };
}

/**
 * All Telegram uids with a saved email (central «المستخدمون» sheet, BOT.USERS) — exactly the
 * users who can have a plain view (without a saved email the plan returns 'other'/'email').
 * There is no single uid+email enumerator in the project (verified 2026-11-25): the registration
 * file gives email → name only, and «المستخدمون» gives uid → saved email only; they are joined
 * only in remContext_. This reads the same sheet remContext_ reads (remValues_(BOT.USERS)),
 * without its registration/stopped filters — an unregistered uid simply plans to 'other'.
 */
function workerStudentUids_(t) {
  var out = [], seen = {};
  try {
    remValues_(BOT.USERS).slice(1).forEach(function (r) {
      var uid = str_(r[0]), e = normalizeEmail(r[1]);
      if (!uid || !e || seen[uid]) return;
      seen[uid] = 1; out.push(uid);
    });
  } catch (e) { logError_(e, 'workerStudentUids ' + t.id); }
  return out;
}

function workerStudentViewServed_(t, body) {
  var uid = String(body.uid), view = String(body.view || 'subs'), via = String(body.via || 'cmd');
  var chat = body.chat, msgId = body.msgId;
  // 1) The same state transition the script would have run for this command/callback.
  var start;
  if (via === 'cmd') {
    var cur = getState_(uid) || {};
    start = cur.p && cur.email ? { step: 'done', p: cur.p, email: cur.email, name: cur.name, lv: cur.lv } : {};
    clearState_(uid);
  } else {
    start = getState_(uid) || {};
  }
  // 2) Fresh plan from that starting state.
  var plan = workerPlanViewFrom_(uid, start, view);
  // 3) Store the resulting state (mirrors viewForProgram_ + showMySubs_ setState_ calls).
  if (plan.kind === 'view' && plan.st) setState_(uid, plan.st);
  // 4) Usage counter (doPost counts every tenant update).
  countUsage_();
  // 5) Reconcile with the message the Worker already sent.
  if (plan.kind !== 'view') {
    // Not a plain view any more: delete the Worker's message and run the real flow instead.
    try { if (msgId) tg_('deleteMessage', { chat_id: chat, message_id: msgId }, true); } catch (e) { /* ignore */ }
    openView_(chat, uid, start, view, null);
    return { ok: true, view: { kind: 'other', text: null, kb: null } };
  }
  var sameText = plan.text === body.text;
  var sameKb = JSON.stringify(plan.kb || null) === JSON.stringify(body.kb || null);
  if (msgId && (!sameText || !sameKb)) {
    // Edit in place (screen_ pattern: quiet, 'not modified' counts as success, no resend fallback).
    try {
      var p = { chat_id: chat, message_id: msgId, text: plan.text, disable_web_page_preview: true };
      if (plan.kb) p.reply_markup = { inline_keyboard: plan.kb };
      var r = tg_('editMessageText', p, true);
      if (!r.ok && !/not modified/i.test(String(r.description || ''))) logError_(new Error('Telegram editMessageText: ' + r.description), 'studentViewServed');
    } catch (e) { logError_(e, 'studentViewServed edit ' + uid + ' ' + view); }
  }
  return { ok: true, view: { kind: 'view', text: plan.text, kb: plan.kb || null } };
}
