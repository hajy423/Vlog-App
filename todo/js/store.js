// Everything lives in localStorage. No account, no server, no sync — the list
// is small enough that a single JSON blob is the right amount of machinery.

const KEY = 'nudge.v1';

const DEFAULTS = {
  tasks: [],
  daily: { enabled: false, hour: 8, minute: 0 },
  seenIntro: false,
};

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULTS),
      ...parsed,
      daily: { ...DEFAULTS.daily, ...(parsed.daily || {}) },
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    };
  } catch {
    // A corrupt blob shouldn't brick the app; start clean rather than throw.
    return structuredClone(DEFAULTS);
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
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
  persist();
  for (const fn of subscribers) fn(state);
}

export function getState() {
  return state;
}

/** Open tasks first (soonest reminder first), then everything undated. */
export function openTasks() {
  return state.tasks
    .filter((t) => !t.done)
    .sort((a, b) => {
      if (a.remindAt && b.remindAt) return a.remindAt - b.remindAt;
      if (a.remindAt) return -1;
      if (b.remindAt) return 1;
      return a.createdAt - b.createdAt;
    });
}

export function doneTasks() {
  return state.tasks.filter((t) => t.done).sort((a, b) => b.doneAt - a.doneAt);
}

/** Open tasks with a reminder that hasn't already passed. */
export function pendingReminders() {
  const now = Date.now();
  return openTasks().filter((t) => t.remindAt && t.remindAt > now);
}

export function addTask(text, remindAt = null) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const task = {
    id: newId(),
    text: trimmed,
    done: false,
    createdAt: Date.now(),
    doneAt: null,
    remindAt,
    // Whether this reminder has been handed to the Calendar app yet.
    armed: false,
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
  Object.assign(task, patch);
  commit();
  return task;
}

export function toggleDone(id) {
  const task = getTask(id);
  if (!task) return null;
  task.done = !task.done;
  task.doneAt = task.done ? Date.now() : null;
  commit();
  return task;
}

export function removeTask(id) {
  state.tasks = state.tasks.filter((t) => t.id !== id);
  commit();
}

export function clearDone() {
  state.tasks = state.tasks.filter((t) => !t.done);
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

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
