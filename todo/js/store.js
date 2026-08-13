// Everything lives in localStorage. No account, no server, no sync — the list
// is small enough that a single JSON blob is the right amount of machinery.
//
// The shape of the data is the product's opinion:
//  - "Today" is a *chosen* set, capped at three. Choice is the commitment device.
//  - Everything unchosen lives in Later, out of sight, so the list can't become
//    a wall of guilt.
//  - Picks don't roll over. A new day starts clean (the fresh-start effect);
//    yesterday's unfinished picks simply return to Later, no ceremony.
//  - Items untouched for two weeks stop being displayed as tasks and become a
//    question — keep or let go — so the graveyard problem can't happen.
//  - The streak counts days you completed *anything*. A streak you can protect
//    with one small win keeps working; one that demands perfection breaks and
//    takes your motivation with it.

const KEY = 'nudge.v2';
const V1_KEY = 'nudge.v1';

export const MAX_PICKS = 3;
export const STALE_AFTER = 14 * 86_400_000;

const DEFAULTS = {
  tasks: [],
  daily: { enabled: false, hour: 8, minute: 0 },
  streak: { count: 0, last: null, best: 0 },
  seenIntro: false,
  // The day the user finished choosing (picked three, completed something, or
  // said "that's enough") — after which the triage prompt stays out of the way.
  triagedOn: null,
};

export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const yesterdayKey = (now = new Date()) => {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return dayKey(d);
};

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalise(JSON.parse(raw));
    const v1 = localStorage.getItem(V1_KEY);
    if (v1) return migrateV1(JSON.parse(v1));
    return structuredClone(DEFAULTS);
  } catch {
    // A corrupt blob shouldn't brick the app; start clean rather than throw.
    return structuredClone(DEFAULTS);
  }
}

function normalise(parsed) {
  const s = {
    ...structuredClone(DEFAULTS),
    ...parsed,
    daily: { ...DEFAULTS.daily, ...(parsed.daily || {}) },
    streak: { ...DEFAULTS.streak, ...(parsed.streak || {}) },
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
  };
  for (const t of s.tasks) {
    t.lastTouched ??= t.createdAt;
    t.repeat ??= null;
    t.doneOn ??= null;
    t.pickedFor ??= null;
    t.pickOrder ??= 0;
    t.archived ??= false;
  }
  return s;
}

function migrateV1(v1) {
  const s = normalise({
    tasks: (v1.tasks || []).map((t) => ({ ...t })),
    daily: v1.daily,
    seenIntro: v1.seenIntro,
  });
  persistTo(s);
  return s;
}

function persistTo(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (err) {
    console.warn('Could not save your list:', err);
  }
}

const subscribers = new Set();

/** Register a render callback. Returns an unsubscribe function. */
export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function commit() {
  persistTo(state);
  for (const fn of subscribers) fn(state);
}

export function getState() {
  return state;
}

// ------------------------------------------------------------------ queries

const isOpen = (t) => !t.done && !t.archived;
const endOfToday = (now) => {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
};

/** A routine is due today unless it fires on another weekday. */
function routineDueToday(t, now) {
  if (t.repeat.freq === 'daily') return true;
  return t.repeat.day === now.getDay();
}

/**
 * Today's chosen tasks, in the order they were picked. #1 is the main thing.
 * Completed picks stay in the list — watching 2 of 3 turn green is what gets
 * the third one done.
 */
export function picksToday(now = new Date()) {
  const today = dayKey(now);
  return state.tasks
    .filter((t) => !t.archived && t.pickedFor === today)
    .sort((a, b) => a.pickOrder - b.pickOrder);
}

/** Routines due today plus anything with a reminder that lands (or landed) today. */
export function alsoToday(now = new Date()) {
  const today = dayKey(now);
  return state.tasks
    .filter((t) => {
      if (!isOpen(t) || t.pickedFor === today) return false;
      if (t.repeat) return routineDueToday(t, now);
      return t.remindAt && t.remindAt <= endOfToday(now);
    })
    .sort((a, b) => (a.remindAt || 0) - (b.remindAt || 0));
}

/** Everything else that's open: the shelf, deliberately out of the way. */
export function laterTasks(now = new Date()) {
  const today = dayKey(now);
  const showing = new Set([...picksToday(now), ...alsoToday(now)].map((t) => t.id));
  return state.tasks
    .filter((t) => isOpen(t) && !showing.has(t.id) && t.pickedFor !== today)
    .sort((a, b) => {
      if (a.remindAt && b.remindAt) return a.remindAt - b.remindAt;
      if (a.remindAt) return -1;
      if (b.remindAt) return 1;
      return a.createdAt - b.createdAt;
    });
}

/** Open, untouched for a fortnight, not a routine: time to decide, not to nag. */
export function staleTasks(now = new Date()) {
  const cutoff = now.getTime() - STALE_AFTER;
  return state.tasks.filter(
    (t) => isOpen(t) && !t.repeat && t.pickedFor !== dayKey(now) && t.lastTouched <= cutoff
  );
}

export function doneTasks() {
  return state.tasks.filter((t) => t.done && !t.archived).sort((a, b) => b.doneAt - a.doneAt);
}

/** Everything open (routines included) — feeds counts and the daily nudge. */
export function openTasks() {
  return state.tasks.filter(isOpen);
}

/** Open tasks with a reminder still ahead of them, for the calendar hand-off. */
export function pendingReminders(now = Date.now()) {
  return openTasks()
    .filter((t) => t.remindAt && t.remindAt > now)
    .sort((a, b) => a.remindAt - b.remindAt);
}

/** The streak, honestly: it only counts if it reaches yesterday or today. */
export function streakInfo(now = new Date()) {
  const { count, last, best } = state.streak;
  const alive = last === dayKey(now) || last === yesterdayKey(now);
  return { count: alive ? count : 0, best, doneToday: last === dayKey(now) };
}

export function canPickMore(now = new Date()) {
  const unfinished = picksToday(now).filter((t) => !isDoneToday(t, now));
  return unfinished.length < MAX_PICKS;
}

export function isDoneToday(task, now = new Date()) {
  if (task.repeat) return task.doneOn === dayKey(now);
  return task.done;
}

// ------------------------------------------------------------------ actions

export function addTask(text, remindAt = null, repeat = null) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const nowMs = Date.now();
  const task = {
    id: newId(),
    text: trimmed,
    done: false,
    createdAt: nowMs,
    lastTouched: nowMs,
    doneAt: null,
    doneOn: null,
    remindAt,
    repeat,
    // Whether this reminder has been handed to the Calendar app yet.
    armed: false,
    pickedFor: null,
    pickOrder: 0,
    archived: false,
  };
  state.tasks.push(task);
  commit();
  return task;
}

export function getTask(id) {
  return state.tasks.find((t) => t.id === id) || null;
}

export function updateTask(id, patch) {
  const task = getTask(id);
  if (!task) return null;
  Object.assign(task, patch, { lastTouched: Date.now() });
  commit();
  return task;
}

export function pick(id, now = new Date()) {
  const task = getTask(id);
  if (!task || !canPickMore(now)) return null;
  task.pickedFor = dayKey(now);
  task.pickOrder = Math.max(0, ...picksToday(now).map((t) => t.pickOrder)) + 1;
  task.lastTouched = Date.now();
  commit();
  return task;
}

export function unpick(id) {
  const task = getTask(id);
  if (!task) return null;
  task.pickedFor = null;
  commit();
  return task;
}

/**
 * Complete a task. Routines are marked done for today and roll their reminder
 * forward (`nextRemindAt` supplied by the caller, which owns the recurrence
 * maths); everything else is simply done. Returns what the moment deserves:
 * whether the streak moved, and whether today's picks are now all finished.
 */
export function complete(id, now = new Date(), nextRemindAt = null) {
  const task = getTask(id);
  if (!task) return null;

  const undo = {
    done: task.done,
    doneAt: task.doneAt,
    doneOn: task.doneOn,
    remindAt: task.remindAt,
    streak: { ...state.streak },
  };

  if (task.repeat) {
    task.doneOn = dayKey(now);
    if (nextRemindAt) task.remindAt = nextRemindAt;
  } else {
    task.done = true;
    task.doneAt = now.getTime();
  }
  task.lastTouched = Date.now();

  const today = dayKey(now);
  let streakMoved = false;
  if (state.streak.last !== today) {
    state.streak.count = state.streak.last === yesterdayKey(now) ? state.streak.count + 1 : 1;
    state.streak.last = today;
    state.streak.best = Math.max(state.streak.best, state.streak.count);
    streakMoved = true;
  }

  const picks = picksToday(now);
  const dayComplete = picks.length > 0 && picks.every((t) => isDoneToday(t, now));

  commit();
  return { task, streakMoved, dayComplete, undo };
}

/** Reverse a completion (the toast's Undo), including the streak it earned. */
export function uncomplete(id, undo) {
  const task = getTask(id);
  if (!task) return;
  Object.assign(task, {
    done: undo.done,
    doneAt: undo.doneAt,
    doneOn: undo.doneOn,
    remindAt: undo.remindAt,
  });
  state.streak = undo.streak;
  commit();
}

export function removeTask(id) {
  state.tasks = state.tasks.filter((t) => t.id !== id);
  commit();
}

export function clearDone() {
  state.tasks = state.tasks.filter((t) => !t.done);
  commit();
}

/** The two-week question, answered "still matters". Resets the clock. */
export function keepTask(id) {
  return updateTask(id, {});
}

/** The two-week question, answered "let it go". Archived, invisible, unmourned. */
export function letGo(id) {
  const task = getTask(id);
  if (!task) return;
  task.archived = true;
  commit();
}

export function setDaily(patch) {
  state.daily = { ...state.daily, ...patch };
  commit();
}

export function setSeenIntro(value) {
  state.seenIntro = value;
  commit();
}

/** Mark today's choosing as finished, so triage stops offering. */
export function setTriaged(now = new Date()) {
  if (state.triagedOn === dayKey(now)) return;
  state.triagedOn = dayKey(now);
  commit();
}

export function isTriaged(now = new Date()) {
  return state.triagedOn === dayKey(now);
}

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
