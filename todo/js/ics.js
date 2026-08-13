// Builds iCalendar (RFC 5545) files so the phone's own Calendar app fires the
// reminders. This is the whole point of Nudge: a static site can't push
// notifications to a closed iPhone, but Calendar already runs in the background
// and will happily raise a lock-screen alert on our behalf.

const PRODID = '-//Nudge//To-do reminders//EN';

/** Escape a value for a TEXT-typed iCalendar property. */
function esc(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Fold a content line to 75 octets, per RFC 5545 §3.1. Continuations start with
 * a single space. We count UTF-8 bytes, not characters, so emoji in a task
 * title can't push a line over the limit or get split mid-codepoint.
 */
function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const decoder = new TextDecoder();
  const out = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Don't split inside a multi-byte character: continuation bytes are 10xxxxxx.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push(decoder.decode(bytes.slice(start, end)));
    start = end;
    limit = 74; // continuation lines lose one octet to the leading space
  }
  return out.join('\r\n ');
}

const pad = (n) => String(n).padStart(2, '0');

/** Floating local date-time: 20260814T080000 (no zone — fires at that wall clock). */
function localStamp(date) {
  return (
    date.getFullYear() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    'T' +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    '00'
  );
}

/** UTC stamp with the trailing Z, used for DTSTAMP. */
function utcStamp(date) {
  return (
    date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    'T' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z'
  );
}

/**
 * One VEVENT carrying a display alarm at its own start time.
 *
 * @param {object} opts
 * @param {string} opts.uid          stable identifier (re-importing replaces, not duplicates)
 * @param {Date}   opts.start        when the alert should fire
 * @param {string} opts.summary      the text shown on the lock screen
 * @param {string} [opts.description]
 * @param {string} [opts.rrule]      e.g. 'FREQ=DAILY' for the recurring nudge
 * @param {Date}   [opts.stamp]      DTSTAMP, defaults to now
 */
function vevent({ uid, start, summary, description, rrule, stamp }) {
  const end = new Date(start.getTime() + 5 * 60 * 1000);
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utcStamp(stamp || new Date())}`,
    `DTSTART:${localStamp(start)}`,
    `DTEND:${localStamp(end)}`,
    `SUMMARY:${esc(summary)}`,
  ];
  if (description) lines.push(`DESCRIPTION:${esc(description)}`);
  if (rrule) lines.push(`RRULE:${rrule}`);
  lines.push(
    'TRANSP:TRANSPARENT', // a reminder shouldn't make you look busy
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(summary)}`,
    'TRIGGER:-PT0M', // at the moment the event starts
    'END:VALARM',
    'END:VEVENT'
  );
  return lines;
}

/** Wrap events in a VCALENDAR and serialise with CRLF line endings. */
function calendar(eventLines) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Nudge',
    ...eventLines,
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** RRULE for a routine, so one hand-off covers every future firing. */
function repeatRule(repeat) {
  if (!repeat) return undefined;
  return repeat.freq === 'daily' ? 'FREQ=DAILY' : 'FREQ=WEEKLY';
}

/** A single task's reminder — the alert text is the task itself. */
export function taskIcs(task) {
  return calendar(
    vevent({
      uid: `nudge-task-${task.id}@nudge.local`,
      start: new Date(task.remindAt),
      summary: task.text,
      description: 'From your Nudge list.',
      rrule: repeatRule(task.repeat),
    })
  );
}

/**
 * The daily check-in: one recurring event that re-fires forever, so the list
 * gets in front of you even when nothing on it has its own alarm. The caller
 * supplies the summary, which is how the escalating tone reaches the lock
 * screen rather than staying trapped in the app.
 */
export function dailyIcs(hour, minute, summary) {
  const start = new Date();
  start.setHours(hour, minute, 0, 0);
  if (start.getTime() <= Date.now()) start.setDate(start.getDate() + 1);
  return calendar(
    vevent({
      uid: 'nudge-daily@nudge.local', // stable: re-importing updates the same event
      start,
      summary,
      description: 'Daily check-in from Nudge.',
      rrule: 'FREQ=DAILY',
    })
  );
}

/** Every pending reminder in one file, for a single trip to the Calendar app. */
export function allRemindersIcs(tasks) {
  const stamp = new Date();
  const events = tasks.flatMap((task) =>
    vevent({
      uid: `nudge-task-${task.id}@nudge.local`,
      start: new Date(task.remindAt),
      summary: task.text,
      description: 'From your Nudge list.',
      rrule: repeatRule(task.repeat),
      stamp,
    })
  );
  return calendar(events);
}

/**
 * Hand the file to iOS. The share sheet is the nicer route when it accepts
 * files (tap → Calendar), and a download is the dependable fallback: it lands
 * in Files, and tapping it opens Calendar's "Add All" prompt.
 *
 * @returns {Promise<'shared'|'downloaded'>} how it was delivered
 */
export async function deliverIcs(ics, filename) {
  const file = new File([ics], filename, { type: 'text/calendar' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (err) {
      // AbortError means the user dismissed the sheet on purpose — respect that
      // rather than shoving a download at them.
      if (err?.name === 'AbortError') throw err;
      // Anything else: fall through to the download route.
    }
  }

  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}
