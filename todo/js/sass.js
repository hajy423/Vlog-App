// The longer something sits, the more the app has to say about it. This exists
// so stale items stop blending into the list — and because a to-do that gets
// visibly annoyed is harder to keep scrolling past than one that waits politely.

const DAY = 86_400_000;

/** Stale-ness bands, in days. Index = level. */
const BANDS = [0, 1, 3, 7, 14];

/**
 * 0 = fresh and left alone, 4 = full drama. Age drives it; a reminder you let
 * ring and ignored costs you a level.
 */
export function sassLevel(task, now = Date.now()) {
  const days = Math.floor((now - task.createdAt) / DAY);
  let level = 0;
  for (let i = BANDS.length - 1; i >= 0; i--) {
    if (days >= BANDS[i]) {
      level = i;
      break;
    }
  }
  const ignoredAlarm = task.remindAt && task.remindAt < now;
  if (ignoredAlarm) level = Math.min(4, Math.max(1, level + 1));
  return level;
}

export function ageInDays(task, now = Date.now()) {
  return Math.max(0, Math.floor((now - task.createdAt) / DAY));
}

// {n} is replaced with the age in days.
const LINES = [
  [],
  ['Day {n}. Just noting it.', 'Still here.', 'No rush. Obviously.'],
  [
    '{n} days now.',
    "We're both ignoring this.",
    "It isn't going to do itself. Allegedly.",
    'Still on the list. Bold of it.',
  ],
  [
    '{n} days. It lives here now.',
    'This has outlived most of your other plans.',
    'A week. A whole week.',
    'At this point it counts as furniture.',
  ],
  [
    '{n} days. Shall I just quietly delete it?',
    "This isn't a task any more, it's a tenant.",
    "It's been here so long it has opinions.",
    "{n} days. I've stopped counting. (I haven't.)",
  ],
];

/** Said instead of the usual line when an alarm was raised and swiped away. */
const IGNORED_ALARM = [
  'The alarm went off. We both know it did.',
  'You swiped that one away, didn’t you.',
  'That reminder came and went.',
  'Your phone did its bit.',
];

/**
 * Deterministic pick, so a line doesn't shuffle on every re-render — but two
 * tasks at the same level still say different things.
 */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function pick(pool, seed) {
  return pool[hash(seed) % pool.length];
}

/** The jab shown under a task, or null while it's still young enough to escape. */
export function sassLine(task, now = Date.now()) {
  const level = sassLevel(task, now);
  if (level === 0) return null;

  const ignoredAlarm = task.remindAt && task.remindAt < now;
  const pool = ignoredAlarm ? IGNORED_ALARM : LINES[level];
  if (!pool.length) return null;

  // Level is in the seed so the line changes as the task escalates.
  return pick(pool, task.id + ':' + level).replace('{n}', ageInDays(task, now));
}

/**
 * The text that goes on the lock screen. Short — this is a notification, not a
 * monologue — but it escalates, so an alert for something ancient reads
 * differently from a fresh one.
 */
export function sassyAlert(task, now = Date.now()) {
  const level = sassLevel(task, now);
  const days = ageInDays(task, now);
  switch (level) {
    case 0:
    case 1:
      return task.text;
    case 2:
      return `${task.text} (day ${days})`;
    case 3:
      return `Still: ${task.text}`;
    default:
      return `${task.text.toUpperCase()} — day ${days}.`;
  }
}

/**
 * Summary for the daily calendar nudge. Names the worst offender, so the
 * repeating alert says something different as things rot — and carries the
 * streak, because a number you're protecting belongs on the lock screen.
 */
export function dailySummary(openTasks, streak = 0, now = Date.now()) {
  const flame = streak >= 2 ? ` · 🔥 ${streak} days` : '';
  const count = openTasks.length;
  if (count === 0) return `Your list is empty. Suspicious.${flame}`;

  const worst = openTasks.reduce((a, b) => (sassLevel(b, now) > sassLevel(a, now) ? b : a));
  const level = sassLevel(worst, now);
  const things = `${count} thing${count === 1 ? '' : 's'} open`;

  if (level <= 1) return `Your list — ${things}${flame}`;
  if (level === 2) return `Your list — ${things}, oldest is ${ageInDays(worst, now)} days${flame}`;
  if (level === 3) return `Your list — ${things}. "${worst.text}" is getting comfortable.${flame}`;
  return `Your list — ${things}. "${worst.text}" has been there ${ageInDays(worst, now)} days.${flame}`;
}

/** What the two-week question asks, in the app's voice. */
export function sweepQuestion(task, now = Date.now()) {
  const days = ageInDays(task, now);
  return `${days} days untouched. Does this still matter?`;
}
