import {
  subscribe,
  getState,
  picksToday,
  alsoToday,
  laterTasks,
  staleTasks,
  doneTasks,
  openTasks,
  pendingReminders,
  streakInfo,
  canPickMore,
  isDoneToday,
  addTask,
  getTask,
  updateTask,
  complete,
  uncomplete,
  pick,
  unpick,
  removeTask,
  clearDone,
  keepTask,
  letGo,
  setDaily,
  setSeenIntro,
  setTriaged,
  isTriaged,
  MAX_PICKS,
} from './store.js';
import { taskIcs, dailyIcs, allRemindersIcs, deliverIcs } from './ics.js';
import { parseWhen, nextOccurrence } from './when.js';
import { sassLevel, sassLine, sassyAlert, dailySummary, sweepQuestion } from './sass.js';
import { createVoiceCapture, isSupported as voiceSupported } from './voice.js';
import { burst, celebrate } from './confetti.js';

const $ = (id) => document.getElementById(id);

const el = {
  summary: $('summary'),
  streak: $('streak'),
  streakCount: $('streak-count'),
  addForm: $('add-form'),
  addInput: $('add-input'),
  btnMic: $('btn-mic'),
  btnMicStop: $('btn-mic-stop'),
  listening: $('listening'),
  listeningText: $('listening-text'),
  tabToday: $('tab-today'),
  tabLater: $('tab-later'),
  laterCount: $('later-count'),
  viewToday: $('view-today'),
  viewLater: $('view-later'),
  triage: $('triage'),
  triageTitle: $('triage-title'),
  triageSub: $('triage-sub'),
  triageList: $('triage-list'),
  triageEmpty: $('triage-empty'),
  btnTriageDone: $('btn-triage-done'),
  picksSection: $('picks-section'),
  picksList: $('picks-list'),
  btnPickMore: $('btn-pick-more'),
  dayDone: $('day-done'),
  dayDoneSub: $('day-done-sub'),
  btnOneMore: $('btn-one-more'),
  alsoSection: $('also-section'),
  alsoList: $('also-list'),
  laterList: $('later-list'),
  laterEmpty: $('later-empty'),
  doneSection: $('done-section'),
  doneTitle: $('done-title'),
  doneList: $('done-list'),
  btnClearDone: $('btn-clear-done'),
  btnDaily: $('btn-daily'),
  dailyState: $('daily-state'),
  btnSyncAll: $('btn-sync-all'),
  syncState: $('sync-state'),
  btnHelp: $('btn-help'),
  remindSheet: $('remind-sheet'),
  remindTask: $('remind-task'),
  remindWhen: $('remind-when'),
  quickTimes: $('quick-times'),
  btnRemindSave: $('btn-remind-save'),
  btnRemindClear: $('btn-remind-clear'),
  btnRemindCancel: $('btn-remind-cancel'),
  dailySheet: $('daily-sheet'),
  dailyTime: $('daily-time'),
  btnDailySave: $('btn-daily-save'),
  btnDailyOff: $('btn-daily-off'),
  btnDailyCancel: $('btn-daily-cancel'),
  helpSheet: $('help-sheet'),
  btnHelpClose: $('btn-help-close'),
  toast: $('toast'),
  toastText: $('toast-text'),
  toastAction: $('toast-action'),
};

/** Which task the reminder sheet is currently editing. */
let editingId = null;
/** 'today' | 'later' */
let currentTab = 'today';
/** Suppresses the day-done takeover right after "pick one more". */
let wantsOneMore = false;

// ---------------------------------------------------------------- formatting

const pad = (n) => String(n).padStart(2, '0');

/** "today 19:00" / "Sat 10:00" / "14 Sep 09:00" — short enough for a chip. */
function formatWhen(ts) {
  const date = new Date(ts);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(date) - startOfDay(new Date())) / 86400000);

  if (days === 0) return `today ${time}`;
  if (days === 1) return `tomorrow ${time}`;
  if (days > 1 && days < 7) {
    return `${date.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
  }
  const day = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${day} ${time}`;
}

function repeatLabel(repeat, remindAt) {
  const time = remindAt
    ? ` ${pad(new Date(remindAt).getHours())}:${pad(new Date(remindAt).getMinutes())}`
    : '';
  if (repeat.freq === 'daily') return `every day${time}`;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][repeat.day];
  return `every ${day}${time}`;
}

/** Value format required by <input type="datetime-local">, in local time. */
function toLocalInput(date) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

// -------------------------------------------------------------------- render

function render() {
  const picks = picksToday();
  const also = alsoToday();
  const later = laterTasks();
  const stale = new Set(staleTasks().map((t) => t.id));
  const done = doneTasks();
  const state = getState();
  const streak = streakInfo();

  // Header
  renderSummary(picks, later.length + also.length);
  el.streak.classList.toggle('hidden', streak.count === 0);
  el.streakCount.textContent = streak.count;
  el.streak.classList.toggle('streak-safe', streak.doneToday);

  // Tabs
  const laterTotal = later.length;
  el.laterCount.textContent = laterTotal;
  el.laterCount.classList.toggle('hidden', laterTotal === 0);
  el.viewToday.classList.toggle('hidden', currentTab !== 'today');
  el.viewLater.classList.toggle('hidden', currentTab !== 'later');
  el.tabToday.classList.toggle('active', currentTab === 'today');
  el.tabLater.classList.toggle('active', currentTab === 'later');
  el.tabToday.setAttribute('aria-selected', String(currentTab === 'today'));
  el.tabLater.setAttribute('aria-selected', String(currentTab === 'later'));

  // --- Today ---
  const allPicksDone = picks.length > 0 && picks.every((t) => isDoneToday(t));
  const showDayDone = allPicksDone && !wantsOneMore;

  // Triage stays open until three are chosen, something is completed, or the
  // user says "that's enough" — so choosing the day is one gesture, not a tour.
  const showTriage =
    !showDayDone && !isTriaged() && canPickMore() && (later.length > 0 || picks.length === 0);
  el.triage.classList.toggle('hidden', !showTriage);
  if (showTriage) renderTriage(picks, later, also);

  el.picksSection.classList.toggle('hidden', picks.length === 0 || showDayDone);
  if (picks.length > 0 && !showDayDone) {
    renderPicks(picks);
    el.btnPickMore.classList.toggle(
      'hidden',
      showTriage || !canPickMore() || later.length === 0
    );
  }

  el.dayDone.classList.toggle('hidden', !showDayDone);
  if (showDayDone) {
    el.dayDoneSub.textContent =
      streak.count >= 2
        ? `Everything you picked is done. 🔥 ${streak.count} days running. Go be a person.`
        : 'Everything you picked is done. Go be a person.';
    el.btnOneMore.classList.toggle('hidden', later.length === 0);
  }

  el.alsoSection.classList.toggle('hidden', also.length === 0);
  renderList(el.alsoList, also, { stale });

  // --- Later ---
  renderList(el.laterList, later, { stale, pickable: true });
  el.laterEmpty.classList.toggle('hidden', later.length > 0);
  el.doneSection.classList.toggle('hidden', done.length === 0);
  el.doneTitle.textContent = `Done (${done.length})`;
  renderDone(el.doneList, done);

  // Reach bar. These labels sit in a narrow half-width button, so they are kept
  // terse deliberately — anything longer gets ellipsised on a small phone.
  el.dailyState.textContent = state.daily.enabled
    ? `${pad(state.daily.hour)}:${pad(state.daily.minute)} daily`
    : 'Off';
  const pending = pendingReminders();
  const unarmed = pending.filter((t) => !t.armed);
  el.btnSyncAll.disabled = pending.length === 0;
  el.syncState.textContent =
    pending.length === 0 ? 'None set' : unarmed.length > 0 ? `${unarmed.length} to send` : 'All sent';

  updateBadge(openTasks().length);
}

function renderSummary(picks, waiting) {
  const remaining = picks.filter((t) => !isDoneToday(t)).length;
  if (picks.length === 0) {
    el.summary.textContent = waiting === 0 ? 'Nothing on the list' : 'No picks yet today';
    return;
  }
  if (remaining === 0) {
    el.summary.textContent = 'Today is done';
    return;
  }
  const next = pendingReminders()[0];
  el.summary.textContent = next
    ? `${remaining} of ${picks.length} to go · next ${formatWhen(next.remindAt)}`
    : `${remaining} of ${picks.length} to go`;
}

/** The morning ritual: choose the day from what's waiting. */
function renderTriage(picks, later, also) {
  const candidates = later.slice(0, 6);
  const choosing = picks.length > 0;
  el.triageTitle.textContent = choosing
    ? `Pick ${picks.length === 1 ? 'a second?' : 'a third?'}`
    : candidates.length === 0 && also.length > 0
      ? 'Today runs itself'
      : 'What matters today?';
  el.triageSub.classList.toggle('hidden', choosing);
  el.triageEmpty.classList.toggle('hidden', candidates.length > 0 || also.length > 0);
  el.btnTriageDone.classList.toggle('hidden', !choosing);

  el.triageList.replaceChildren();
  for (const task of candidates) {
    const li = document.createElement('li');
    li.className = 'triage-item';

    const label = document.createElement('span');
    label.className = 'triage-text';
    label.textContent = task.text;

    const meta = document.createElement('span');
    meta.className = 'triage-meta';
    meta.textContent = task.remindAt ? formatWhen(task.remindAt) : agoLabel(task);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'triage-pick';
    btn.textContent = '☀ Pick';
    btn.setAttribute('aria-label', `Pick "${task.text}" for today`);
    btn.addEventListener('click', () => {
      const picked = pick(task.id);
      if (!picked) return toast(`Three is the limit. That's the point.`);
      // The third pick is the day decided.
      if (!canPickMore()) setTriaged();
    });

    li.append(label, meta, btn);
    el.triageList.appendChild(li);
  }
}

function agoLabel(task) {
  const days = Math.floor((Date.now() - task.createdAt) / 86400000);
  if (days === 0) return 'new';
  if (days === 1) return '1 day';
  return `${days} days`;
}

/** Today's chosen few. The first is the main thing and looks like it. */
function renderPicks(picks) {
  el.picksList.replaceChildren();
  picks.forEach((task, i) => {
    const doneNow = isDoneToday(task);
    const li = document.createElement('li');
    li.className = `task pick${i === 0 && !doneNow ? ' main-pick' : ''}${doneNow ? ' finished' : ''}`;
    li.dataset.id = task.id;

    const check = makeCheck(task, doneNow);
    const body = document.createElement('div');
    body.className = 'task-body';

    if (i === 0 && !doneNow && picks.length > 1) {
      const tag = document.createElement('span');
      tag.className = 'main-tag';
      tag.textContent = 'The one that matters';
      body.appendChild(tag);
    }

    const text = document.createElement('span');
    text.className = 'task-text';
    text.textContent = task.text;
    body.appendChild(text);
    appendChips(body, task, doneNow);

    li.append(check, body);
    if (!doneNow) li.appendChild(makeActions(task, { unpickable: true }));
    el.picksList.appendChild(li);
  });
}

/** Shared list renderer for "Also today" and Later. */
function renderList(list, tasks, { stale, pickable = false } = {}) {
  list.replaceChildren();
  for (const task of tasks) {
    // The two-week question replaces the row's normal controls entirely.
    if (stale?.has(task.id)) {
      list.appendChild(renderStaleRow(task));
      continue;
    }

    const doneNow = isDoneToday(task);
    const level = doneNow ? 0 : sassLevel(task);
    const li = document.createElement('li');
    li.className = `task${level ? ` sass-${Math.min(level, 2)}` : ''}${doneNow ? ' finished' : ''}`;
    li.dataset.id = task.id;

    const check = makeCheck(task, doneNow);
    const body = document.createElement('div');
    body.className = 'task-body';

    const text = document.createElement('span');
    text.className = 'task-text';
    text.textContent = task.text;
    body.appendChild(text);

    const jab = doneNow || level === 0 ? null : sassLine(task);
    if (jab) {
      const line = document.createElement('span');
      line.className = 'task-sass';
      line.textContent = jab;
      body.appendChild(line);
    }
    appendChips(body, task, doneNow);

    li.append(check, body);
    if (!doneNow) {
      if (pickable) {
        const sun = document.createElement('button');
        sun.type = 'button';
        sun.className = 'task-action';
        sun.textContent = '☀';
        sun.setAttribute('aria-label', `Pick "${task.text}" for today`);
        sun.addEventListener('click', () => {
          if (pick(task.id)) toast(`On today's list ✓`);
          else toast(`Three is the limit. That's the point.`);
        });
        li.appendChild(sun);
      }
      li.appendChild(makeActions(task, {}));
    }
    list.appendChild(li);
  }
}

/** 14 days untouched: the row becomes a decision. */
function renderStaleRow(task) {
  const li = document.createElement('li');
  li.className = 'task stale';
  li.dataset.id = task.id;

  const body = document.createElement('div');
  body.className = 'task-body';

  const text = document.createElement('span');
  text.className = 'task-text';
  text.textContent = task.text;

  const q = document.createElement('span');
  q.className = 'stale-question';
  q.textContent = sweepQuestion(task);

  const actions = document.createElement('div');
  actions.className = 'stale-actions';

  const keep = document.createElement('button');
  keep.type = 'button';
  keep.className = 'stale-btn keep';
  keep.textContent = 'Still matters';
  keep.addEventListener('click', () => {
    keepTask(task.id);
    toast('Kept — clock reset');
  });

  const drop = document.createElement('button');
  drop.type = 'button';
  drop.className = 'stale-btn letgo';
  drop.textContent = 'Let it go';
  drop.addEventListener('click', () => {
    letGo(task.id);
    toast('Gone. Lighter already.');
  });

  actions.append(keep, drop);
  body.append(text, q, actions);
  li.appendChild(body);
  return li;
}

function renderDone(list, tasks) {
  list.replaceChildren();
  for (const task of tasks) {
    const li = document.createElement('li');
    li.className = 'task';
    li.dataset.id = task.id;

    const check = document.createElement('button');
    check.className = 'task-check';
    check.type = 'button';
    check.setAttribute('aria-label', 'Mark as not done');
    check.addEventListener('click', () => updateTask(task.id, { done: false, doneAt: null }));

    const body = document.createElement('div');
    body.className = 'task-body';
    const text = document.createElement('span');
    text.className = 'task-text';
    text.textContent = task.text;
    body.appendChild(text);

    const del = document.createElement('button');
    del.className = 'task-action';
    del.type = 'button';
    del.textContent = '✕';
    del.setAttribute('aria-label', `Delete "${task.text}"`);
    del.addEventListener('click', () => removeTask(task.id));

    li.append(check, body, del);
    list.appendChild(li);
  }
}

// ------------------------------------------------------------ row components

function makeCheck(task, doneNow) {
  const check = document.createElement('button');
  check.className = `task-check${doneNow ? ' checked' : ''}`;
  check.type = 'button';
  check.setAttribute('aria-label', doneNow ? 'Done today' : `Mark "${task.text}" done`);
  if (doneNow) {
    check.disabled = Boolean(task.repeat); // routines un-tick at midnight, not by hand
    return check;
  }
  check.addEventListener('click', (e) => completeTask(task, e.currentTarget));
  return check;
}

function appendChips(body, task, doneNow) {
  if (doneNow) return;
  const now = Date.now();
  if (task.repeat) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'task-when routine';
    chip.textContent = `↻ ${repeatLabel(task.repeat, task.remindAt)}`;
    chip.addEventListener('click', () => openRemindSheet(task.id));
    body.appendChild(chip);
    return;
  }
  if (!task.remindAt) return;
  const chip = document.createElement('button');
  chip.type = 'button';
  const overdue = task.remindAt <= now;
  chip.className = `task-when${overdue ? ' overdue' : ''}${task.armed ? '' : ' unarmed'}`;
  const label = formatWhen(task.remindAt);
  chip.textContent = overdue ? `⏰ ${label}` : task.armed ? `🔔 ${label}` : `⚠︎ ${label} — not sent`;
  chip.addEventListener('click', () => openRemindSheet(task.id));
  body.appendChild(chip);
}

function makeActions(task, { unpickable = false }) {
  const frag = document.createDocumentFragment();
  if (unpickable) {
    const back = document.createElement('button');
    back.className = 'task-action';
    back.type = 'button';
    back.textContent = '↩';
    back.setAttribute('aria-label', `Move "${task.text}" back to Later`);
    back.addEventListener('click', () => unpick(task.id));
    frag.appendChild(back);
  }
  const bell = document.createElement('button');
  bell.className = `task-action${task.remindAt ? ' active' : ''}`;
  bell.type = 'button';
  bell.textContent = '🔔';
  bell.setAttribute('aria-label', `Set a reminder for "${task.text}"`);
  bell.addEventListener('click', () => openRemindSheet(task.id));
  frag.appendChild(bell);
  return frag;
}

// --------------------------------------------------------------- completing

function completeTask(task, checkEl) {
  const rect = checkEl.getBoundingClientRect();
  const next = task.repeat ? nextOccurrence(task.remindAt, task.repeat) : null;
  const result = complete(task.id, new Date(), next);
  if (!result) return;

  // Doing beats choosing: once something's done, stop offering the triage.
  setTriaged();

  burst(rect.left + rect.width / 2, rect.top + rect.height / 2);

  if (result.dayComplete) {
    wantsOneMore = false;
    // The big moment gets a beat of its own after the row settles.
    setTimeout(celebrate, 250);
  }

  toast(pickCompletionLine(result), 5000, {
    label: 'Undo',
    fn: () => uncomplete(task.id, result.undo),
  });
}

function pickCompletionLine(result) {
  if (result.dayComplete) return "That's everything. Day closed. 🎉";
  if (result.streakMoved) {
    const { count } = streakInfo();
    return count >= 2 ? `Done ✓ 🔥 ${count} days running` : 'Done ✓ streak started 🔥';
  }
  return 'Done ✓';
}

// --------------------------------------------------------------------- badge

/**
 * The home-screen icon's red count. On an installed iOS PWA this survives after
 * the app is closed, which makes it the one always-visible part of the list.
 */
async function updateBadge(count) {
  try {
    if (count > 0) await navigator.setAppBadge?.(count);
    else await navigator.clearAppBadge?.();
  } catch {
    // Not supported (or not installed) — nothing to do, and nothing to warn about.
  }
}

// -------------------------------------------------------------------- sheets

function openSheet(sheet) {
  sheet.classList.remove('hidden');
  document.body.classList.add('sheet-open');
}

function closeSheet(sheet) {
  sheet.classList.add('hidden');
  document.body.classList.remove('sheet-open');
}

function openRemindSheet(id) {
  const task = getTask(id);
  if (!task) return;
  editingId = id;
  el.remindTask.textContent = task.repeat
    ? `${task.text} · ${repeatLabel(task.repeat, task.remindAt)}`
    : task.text;
  el.remindWhen.value = toLocalInput(new Date(task.remindAt || defaultRemindTime()));
  el.btnRemindClear.classList.toggle('hidden', !task.remindAt);
  el.btnRemindSave.textContent = task.remindAt ? 'Update reminder' : 'Set reminder';
  openSheet(el.remindSheet);
}

/** Next round hour, at least 30 minutes out — a sane starting point. */
function defaultRemindTime() {
  const d = new Date(Date.now() + 30 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.getTime();
}

function quickTime(kind) {
  const d = new Date();
  switch (kind) {
    case '1h':
      d.setTime(d.getTime() + 60 * 60 * 1000);
      d.setSeconds(0, 0);
      return d;
    case 'tonight':
      d.setHours(19, 0, 0, 0);
      if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
      return d;
    case 'tomorrow':
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    case 'weekend': {
      // Next Saturday; if it's already Saturday, jump a week rather than
      // silently setting a reminder for a time that's gone.
      const daysToSat = (6 - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + daysToSat);
      d.setHours(10, 0, 0, 0);
      return d;
    }
    default:
      return new Date(defaultRemindTime());
  }
}

// ---------------------------------------------------------------- ics hand-off

/** Deliver an .ics and tell the user what just happened. */
async function handOff(ics, filename, successMessage) {
  try {
    const how = await deliverIcs(ics, filename);
    toast(how === 'shared' ? successMessage : `${successMessage} — tap the downloaded file to add it`, 5000);
    return true;
  } catch (err) {
    if (err?.name === 'AbortError') return false; // user backed out
    console.error(err);
    toast("Couldn't open the calendar file", 4000);
    return false;
  }
}

/**
 * The alert text is generated at send time, so a reminder armed for something
 * ancient arrives on the lock screen with the tone it has earned. Routines
 * carry an RRULE, so one hand-off covers every future firing.
 */
async function sendTaskToCalendar(task) {
  const ok = await handOff(
    taskIcs({ ...task, text: task.repeat ? task.text : sassyAlert(task) }),
    `nudge-${task.id.slice(0, 8)}.ics`,
    'Reminder sent to Calendar'
  );
  if (ok) updateTask(task.id, { armed: true });
}

// ------------------------------------------------------------------- events

/**
 * The single way anything gets onto the list, whether typed, spoken, or handed
 * over by Siri. Runs the words through the time parser first, so saying the
 * deadline out loud is enough to set the reminder — and "every monday" is
 * enough to make it a routine.
 *
 * @returns {object|null} the new task
 */
function capture(raw) {
  const { text, remindAt, repeat } = parseWhen(raw);
  if (!text) return null;
  return addTask(text, remindAt, repeat);
}

el.addForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const task = capture(el.addInput.value);
  if (!task) return;
  el.addInput.value = '';
  if (task.repeat) toast(`Routine: ${repeatLabel(task.repeat, task.remindAt)} — tap ↻ to arm it`, 4000);
  else if (task.remindAt) toast(`Reminder ${formatWhen(task.remindAt)} — tap 🔔 to arm it`, 4000);
  // Keep the keyboard up: adding several things in a row is the common case.
  el.addInput.focus();
});

// Tabs
el.tabToday.addEventListener('click', () => {
  currentTab = 'today';
  render();
});
el.tabLater.addEventListener('click', () => {
  currentTab = 'later';
  render();
});

el.btnPickMore.addEventListener('click', () => {
  currentTab = 'later';
  render();
});

el.btnTriageDone.addEventListener('click', () => setTriaged());

el.btnOneMore.addEventListener('click', () => {
  wantsOneMore = true;
  currentTab = 'later';
  render();
});

// ------------------------------------------------------------------- voice

const voice = createVoiceCapture({
  onStart() {
    el.listening.classList.remove('hidden');
    el.btnMic.classList.add('active');
    el.btnMic.setAttribute('aria-pressed', 'true');
    el.listeningText.textContent = 'Listening… say the thing.';
  },
  onInterim(text) {
    el.listeningText.textContent = text || 'Listening… say the thing.';
  },
  onResult(text) {
    const task = capture(text);
    if (task) {
      el.listeningText.textContent = task.repeat
        ? `✓ ${task.text} — ${repeatLabel(task.repeat, task.remindAt)}`
        : task.remindAt
          ? `✓ ${task.text} — ${formatWhen(task.remindAt)}`
          : `✓ ${task.text}`;
    } else {
      el.listeningText.textContent = "Didn't catch that.";
    }
  },
  onStop() {
    el.listening.classList.add('hidden');
    el.btnMic.classList.remove('active');
    el.btnMic.setAttribute('aria-pressed', 'false');
  },
  onError(reason) {
    el.listening.classList.add('hidden');
    el.btnMic.classList.remove('active');
    el.btnMic.setAttribute('aria-pressed', 'false');
    toast(reason, 5000);
  },
});

if (voice) {
  el.btnMic.classList.remove('hidden');
  el.btnMic.addEventListener('click', () => voice.toggle());
  el.btnMicStop.addEventListener('click', () => voice.stop());
  // Listening in the background is a battery and privacy problem, and iOS kills
  // it anyway — so drop the mic the moment the app is no longer in front.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && voice.listening) voice.stop();
  });
}

el.btnClearDone.addEventListener('click', () => {
  clearDone();
  toast('Cleared');
});

el.btnHelp.addEventListener('click', () => openSheet(el.helpSheet));
el.btnHelpClose.addEventListener('click', () => {
  closeSheet(el.helpSheet);
  setSeenIntro(true);
});

// --- reminder sheet ---

el.quickTimes.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-quick]');
  if (!btn) return;
  el.remindWhen.value = toLocalInput(quickTime(btn.dataset.quick));
  for (const chip of el.quickTimes.querySelectorAll('.chip')) {
    chip.classList.toggle('selected', chip === btn);
  }
});

el.remindWhen.addEventListener('input', () => {
  for (const chip of el.quickTimes.querySelectorAll('.chip')) chip.classList.remove('selected');
});

el.btnRemindSave.addEventListener('click', async () => {
  const task = getTask(editingId);
  if (!task) return closeSheet(el.remindSheet);

  const when = new Date(el.remindWhen.value);
  if (Number.isNaN(when.getTime())) return toast('Pick a time first');
  if (when.getTime() <= Date.now()) return toast('That time has already passed');

  // Retiming a routine also moves which weekday it repeats on.
  const patch = { remindAt: when.getTime(), armed: false };
  if (task.repeat?.freq === 'weekly') patch.repeat = { freq: 'weekly', day: when.getDay() };
  const updated = updateTask(task.id, patch);
  closeSheet(el.remindSheet);
  await sendTaskToCalendar(updated);
});

el.btnRemindClear.addEventListener('click', () => {
  if (!editingId) return;
  // Clearing a routine's reminder turns it back into an ordinary task.
  updateTask(editingId, { remindAt: null, armed: false, repeat: null });
  closeSheet(el.remindSheet);
  toast('Reminder removed here — delete it in Calendar too', 5000);
});

el.btnRemindCancel.addEventListener('click', () => closeSheet(el.remindSheet));

// --- daily nudge ---

el.btnDaily.addEventListener('click', () => {
  const { daily } = getState();
  el.dailyTime.value = `${pad(daily.hour)}:${pad(daily.minute)}`;
  el.btnDailyOff.classList.toggle('hidden', !daily.enabled);
  openSheet(el.dailySheet);
});

el.btnDailySave.addEventListener('click', async () => {
  const [hour, minute] = el.dailyTime.value.split(':').map(Number);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return toast('Pick a time first');
  closeSheet(el.dailySheet);
  const ok = await handOff(
    dailyIcs(hour, minute, dailySummary(openTasks(), streakInfo().count)),
    'nudge-daily.ics',
    'Daily nudge sent to Calendar'
  );
  if (ok) setDaily({ enabled: true, hour, minute });
});

el.btnDailyOff.addEventListener('click', () => {
  setDaily({ enabled: false });
  closeSheet(el.dailySheet);
  toast('Delete the repeating event in Calendar to stop the alerts', 5000);
});

el.btnDailyCancel.addEventListener('click', () => closeSheet(el.dailySheet));

// --- send everything at once ---

el.btnSyncAll.addEventListener('click', async () => {
  const pending = pendingReminders();
  if (pending.length === 0) return;
  const ok = await handOff(
    allRemindersIcs(pending.map((t) => (t.repeat ? t : { ...t, text: sassyAlert(t) }))),
    'nudge-reminders.ics',
    `${pending.length} reminder${pending.length === 1 ? '' : 's'} sent to Calendar`
  );
  if (ok) for (const task of pending) updateTask(task.id, { armed: true });
});

// Tapping the dimmed backdrop closes a sheet.
for (const sheet of [el.remindSheet, el.dailySheet, el.helpSheet]) {
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) closeSheet(sheet);
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  for (const sheet of [el.remindSheet, el.dailySheet, el.helpSheet]) {
    if (!sheet.classList.contains('hidden')) closeSheet(sheet);
  }
});

// Overdue chips and the day boundary both need re-evaluating as time passes,
// and the badge should be right when the app is re-opened from the background.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) render();
});
setInterval(render, 60 * 1000);

// ------------------------------------------------------------------- toast

let toastTimer = null;

function toast(message, ms = 2600, action = null) {
  el.toastText.textContent = message;
  el.toastAction.classList.toggle('hidden', !action);
  if (action) {
    el.toastAction.textContent = action.label;
    el.toastAction.onclick = () => {
      el.toast.classList.add('hidden');
      action.fn();
    };
  }
  el.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), ms);
}

// -------------------------------------------------------------------- start

/**
 * Tasks handed over by the Siri Shortcut arrive as ?add=… on the URL. The
 * parameter is stripped immediately afterwards so a refresh — or iOS restoring
 * the tab later — can't quietly add the same thing twice.
 */
function captureFromUrl() {
  const params = new URLSearchParams(location.search);
  const spoken = params.get('add');
  if (!spoken) return;

  history.replaceState(null, '', location.pathname);

  const task = capture(spoken);
  if (task) {
    toast(
      task.remindAt ? `Got it — reminder ${formatWhen(task.remindAt)}` : `Got it: ${task.text}`,
      4000
    );
  } else {
    toast("Nothing to add — didn't catch any words", 4000);
  }
}

subscribe(render);
captureFromUrl();
render();

// Something arriving by Siri is proof the app works; don't greet them with a
// wall of instructions on top of it.
if (!getState().seenIntro && !getState().tasks.length) openSheet(el.helpSheet);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW failed:', err));
  });
}
