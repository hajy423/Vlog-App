import {
  subscribe,
  getState,
  openTasks,
  doneTasks,
  pendingReminders,
  addTask,
  getTask,
  updateTask,
  toggleDone,
  removeTask,
  clearDone,
  setDaily,
  setSeenIntro,
} from './store.js';
import { taskIcs, dailyIcs, allRemindersIcs, deliverIcs } from './ics.js';
import { parseWhen } from './when.js';
import { sassLevel, sassLine, sassyAlert, dailySummary } from './sass.js';
import { createVoiceCapture, isSupported as voiceSupported } from './voice.js';

const $ = (id) => document.getElementById(id);

const el = {
  summary: $('summary'),
  addForm: $('add-form'),
  addInput: $('add-input'),
  btnMic: $('btn-mic'),
  btnMicStop: $('btn-mic-stop'),
  listening: $('listening'),
  listeningText: $('listening-text'),
  openList: $('open-list'),
  emptyState: $('empty-state'),
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
};

/** Which task the reminder sheet is currently editing. */
let editingId = null;

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

/** Value format required by <input type="datetime-local">, in local time. */
function toLocalInput(date) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

// -------------------------------------------------------------------- render

function render() {
  const open = openTasks();
  const done = doneTasks();
  const state = getState();

  renderSummary(open.length);
  renderList(el.openList, open, false);

  el.emptyState.classList.toggle('hidden', open.length > 0);

  el.doneSection.classList.toggle('hidden', done.length === 0);
  el.doneTitle.textContent = `Done (${done.length})`;
  renderList(el.doneList, done, true);

  // Daily nudge status. These labels sit in a narrow half-width button, so they
  // are kept terse deliberately — anything longer gets ellipsised on a small phone.
  el.dailyState.textContent = state.daily.enabled
    ? `${pad(state.daily.hour)}:${pad(state.daily.minute)} daily`
    : 'Off';

  // "Send all" reflects how many reminders haven't been handed over yet.
  const pending = pendingReminders();
  const unarmed = pending.filter((t) => !t.armed);
  el.btnSyncAll.disabled = pending.length === 0;
  if (pending.length === 0) {
    el.syncState.textContent = 'None set';
  } else if (unarmed.length > 0) {
    el.syncState.textContent = `${unarmed.length} to send`;
  } else {
    el.syncState.textContent = 'All sent';
  }

  updateBadge(open.length);
}

function renderSummary(count) {
  if (count === 0) {
    el.summary.textContent = 'Nothing on the list';
    return;
  }
  const next = pendingReminders()[0];
  el.summary.textContent = next
    ? `${count} open · next ${formatWhen(next.remindAt)}`
    : `${count} open · no reminders set`;
}

function renderList(list, tasks, isDone) {
  list.replaceChildren();
  const now = Date.now();

  for (const task of tasks) {
    const level = isDone ? 0 : sassLevel(task, now);
    const li = document.createElement('li');
    li.className = `task${level ? ` sass-${level}` : ''}`;
    li.dataset.id = task.id;

    const check = document.createElement('button');
    check.className = 'task-check';
    check.type = 'button';
    check.setAttribute('aria-label', isDone ? 'Mark as not done' : 'Mark as done');
    check.setAttribute('aria-pressed', String(isDone));
    check.addEventListener('click', () => {
      toggleDone(task.id);
      if (!isDone) toast('Done ✓');
    });

    const body = document.createElement('div');
    body.className = 'task-body';

    const text = document.createElement('span');
    text.className = 'task-text';
    text.textContent = task.text;
    body.appendChild(text);

    const jab = isDone ? null : sassLine(task, now);
    if (jab) {
      const line = document.createElement('span');
      line.className = 'task-sass';
      line.textContent = jab;
      body.appendChild(line);
    }

    if (task.remindAt && !isDone) {
      const chip = document.createElement('button');
      chip.type = 'button';
      const overdue = task.remindAt <= now;
      chip.className = `task-when${overdue ? ' overdue' : ''}${task.armed ? '' : ' unarmed'}`;
      const label = formatWhen(task.remindAt);
      chip.textContent = overdue ? `⏰ ${label}` : task.armed ? `🔔 ${label}` : `⚠︎ ${label} — not sent`;
      chip.addEventListener('click', () => openRemindSheet(task.id));
      body.appendChild(chip);
    }

    li.append(check, body);

    if (isDone) {
      const del = document.createElement('button');
      del.className = 'task-action';
      del.type = 'button';
      del.textContent = '✕';
      del.setAttribute('aria-label', `Delete "${task.text}"`);
      del.addEventListener('click', () => removeTask(task.id));
      li.appendChild(del);
    } else {
      const bell = document.createElement('button');
      bell.className = `task-action${task.remindAt ? ' active' : ''}`;
      bell.type = 'button';
      bell.textContent = '🔔';
      bell.setAttribute('aria-label', `Set a reminder for "${task.text}"`);
      bell.addEventListener('click', () => openRemindSheet(task.id));
      li.appendChild(bell);
    }

    list.appendChild(li);
  }
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
  el.remindTask.textContent = task.text;
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
 * ancient arrives on the lock screen with the tone it has earned.
 */
async function sendTaskToCalendar(task) {
  const ok = await handOff(
    taskIcs({ ...task, text: sassyAlert(task) }),
    `nudge-${task.id.slice(0, 8)}.ics`,
    'Reminder sent to Calendar'
  );
  if (ok) updateTask(task.id, { armed: true });
}

// ------------------------------------------------------------------- events

/**
 * The single way anything gets onto the list, whether typed, spoken, or handed
 * over by Siri. Runs the words through the time parser first, so saying the
 * deadline out loud is enough to set the reminder.
 *
 * @returns {object|null} the new task
 */
function capture(raw) {
  const { text, remindAt } = parseWhen(raw);
  if (!text) return null;
  return addTask(text, remindAt);
}

el.addForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const task = capture(el.addInput.value);
  if (!task) return;
  el.addInput.value = '';
  if (task.remindAt) toast(`Reminder ${formatWhen(task.remindAt)} — tap 📅 to arm it`, 4000);
  // Keep the keyboard up: adding several things in a row is the common case.
  el.addInput.focus();
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
      el.listeningText.textContent = task.remindAt
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
  if (when.getTime() <= Date.now()) return toast("That time has already passed");

  const updated = updateTask(task.id, { remindAt: when.getTime(), armed: false });
  closeSheet(el.remindSheet);
  await sendTaskToCalendar(updated);
});

el.btnRemindClear.addEventListener('click', () => {
  if (!editingId) return;
  updateTask(editingId, { remindAt: null, armed: false });
  closeSheet(el.remindSheet);
  toast('Reminder removed here — delete it in Calendar too', 5000);
});

el.btnRemindCancel.addEventListener('click', () => closeSheet(el.remindSheet));

// --- daily check-in ---

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
    dailyIcs(hour, minute, dailySummary(openTasks())),
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
    allRemindersIcs(pending.map((t) => ({ ...t, text: sassyAlert(t) }))),
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

// Overdue chips need to flip over as time passes, and the badge should be right
// when the app is re-opened from the background.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) render();
});
setInterval(render, 60 * 1000);

// ------------------------------------------------------------------- toast

let toastTimer = null;

function toast(message, ms = 2600) {
  el.toast.textContent = message;
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
