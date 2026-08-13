// Pulls a time out of ordinary speech, so "call mum tomorrow at six" becomes a
// task called "Call mum" with a reminder set. Dictating a sentence should be the
// whole interaction — no second screen, no picker.

const WORD_NUMBERS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, sixty: 60,
  couple: 2, few: 3,
};

const NUMBER_WORDS = Object.keys(WORD_NUMBERS).join('|');

const UNIT_MS = {
  min: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
};

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Openers dictation loves to include but nobody wants in their list.
const FILLERS =
  /^\s*(?:hey\s+)?(?:please\s+)?(?:can\s+you\s+)?(?:remind\s+me\s+(?:to|that|about)?|don'?t\s+forget\s+(?:to)?|remember\s+(?:to)?|note\s+(?:to\s+self|that)?|i\s+(?:need|have|want)\s+to|make\s+sure\s+(?:i|to)?|add|new\s+task)\s+/i;

/** Times of day people name instead of a number. */
const DAY_PARTS = {
  morning: [9, 0],
  afternoon: [14, 0],
  evening: [19, 0],
  night: [20, 0],
  noon: [12, 0],
  midday: [12, 0],
  lunchtime: [12, 30],
  bedtime: [22, 0],
};

const num = (token) => {
  if (token == null) return null;
  const digits = Number(token);
  if (!Number.isNaN(digits)) return digits;
  return WORD_NUMBERS[String(token).toLowerCase()] ?? null;
};

/**
 * Resolve an hour spoken without am/pm, using how people actually talk: "at 5"
 * is the evening, "at 9" is the morning. The hour you say is the hour you get —
 * if it has already gone, the caller rolls it to tomorrow rather than flipping
 * it half a day, because a reminder landing at an hour you never said is worse
 * than one landing a day later.
 */
function resolveHour(hour, meridiem) {
  if (meridiem) {
    const h = hour % 12;
    return /^p/i.test(meridiem) ? h + 12 : h;
  }
  if (hour === 0 || hour > 12) return hour; // already spoken in 24-hour terms
  if (hour === 12) return 12; // "at 12" means midday
  return hour <= 6 ? hour + 12 : hour;
}

/** Matches "at 6", "6:30pm". "half seven" is deliberately not supported. */
const TIME_RE = new RegExp(
  String.raw`(?:\bat\s+|\b@\s*)?\b(\d{1,2}|${NUMBER_WORDS})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?:\s*o'?clock)?\b`,
  'i'
);

/**
 * Find a time-of-day in `text`, but only where it's unambiguous — either
 * introduced by "at", or carrying am/pm. A bare number ("buy 2 pints") is left
 * well alone.
 */
function matchTime(text, requireMarker) {
  const re = new RegExp(TIME_RE.source, 'gi');
  let m;
  while ((m = re.exec(text)) !== null) {
    const marked = /^\s*(?:at\s+|@)/i.test(m[0]);
    const hasMeridiem = Boolean(m[3]);
    if (requireMarker && !marked && !hasMeridiem) continue;
    const hour = num(m[1]);
    if (hour === null || hour > 23) continue;
    const minute = m[2] ? Number(m[2]) : 0;
    if (minute > 59) continue;
    return { hour, minute, meridiem: m[3], start: m.index, end: m.index + m[0].length };
  }
  return null;
}

const cut = (text, start, end) => (text.slice(0, start) + ' ' + text.slice(end)).replace(/\s{2,}/g, ' ').trim();

/**
 * @param {string} input  what the user said or typed
 * @param {Date}   [now]  injectable for tests
 * @returns {{text: string, remindAt: number|null, repeat: {freq:'daily'|'weekly', day?:number}|null}}
 */
export function parseWhen(input, now = new Date()) {
  let text = String(input).replace(FILLERS, '').trim();
  let when = null;
  let repeat = null;

  // --- "every day" / "every morning" / "every monday" ----------------------
  // Routines carry a repeat spec; the calendar side turns it into an RRULE so
  // one hand-off covers every future firing.
  const everyRe = new RegExp(
    String.raw`\b(?:every|each)\s+(day|morning|evening|night|week|${DAYS.join('|')})\b`,
    'i'
  );
  const every = text.match(everyRe);
  if (every) {
    const what = every[1].toLowerCase();
    const start = new Date(now);
    start.setSeconds(0, 0);
    if (what === 'day' || what === 'morning') {
      repeat = { freq: 'daily' };
      start.setHours(9, 0, 0, 0);
    } else if (what === 'evening') {
      repeat = { freq: 'daily' };
      start.setHours(19, 0, 0, 0);
    } else if (what === 'night') {
      repeat = { freq: 'daily' };
      start.setHours(20, 0, 0, 0);
    } else if (what === 'week') {
      repeat = { freq: 'weekly', day: start.getDay() };
      start.setHours(9, 0, 0, 0);
      if (start.getTime() <= now.getTime()) start.setDate(start.getDate() + 7);
    } else {
      const day = DAYS.indexOf(what);
      repeat = { freq: 'weekly', day };
      const delta = (day - start.getDay() + 7) % 7;
      start.setDate(start.getDate() + delta);
      start.setHours(9, 0, 0, 0);
    }
    text = cut(text, every.index, every.index + every[0].length);

    // An explicit time in the sentence overrides the default hour.
    const time = matchTime(text, false);
    if (time) {
      start.setHours(resolveHour(time.hour, time.meridiem), time.minute, 0, 0);
      text = cut(text, time.start, time.end);
    }
    // The first firing must be in the future.
    while (start.getTime() <= now.getTime()) {
      start.setDate(start.getDate() + (repeat.freq === 'daily' ? 1 : 7));
    }

    return { text: tidy(text), remindAt: start.getTime(), repeat };
  }

  // --- "in 20 minutes" / "in a couple of hours" ----------------------------
  const relRe = new RegExp(
    // The optional "a"/"an" lets "in a couple of weeks" through; regex
    // backtracking still resolves plain "in an hour" correctly.
    String.raw`\bin\s+(?:an?\s+)?(\d+|${NUMBER_WORDS})\s*(?:of\s+)?(minutes?|mins?|hours?|hrs?|days?|weeks?)\b`,
    'i'
  );
  const rel = text.match(relRe);
  if (rel) {
    const count = num(rel[1]);
    const unit = /^m/i.test(rel[2]) ? 'min' : /^h/i.test(rel[2]) ? 'hour' : /^d/i.test(rel[2]) ? 'day' : 'week';
    if (count !== null) {
      when = new Date(now.getTime() + count * UNIT_MS[unit]);
      when.setSeconds(0, 0);
      text = cut(text, rel.index, rel.index + rel[0].length);
      // A day/week away with no time named is more useful in the morning.
      if (unit === 'day' || unit === 'week') when.setHours(9, 0, 0, 0);
    }
  }

  // --- an anchor day: today / tomorrow / a weekday -------------------------
  let anchor = null;
  if (!when) {
    const dayRe = new RegExp(
      String.raw`\b(today|tonight|tomorrow|(?:next\s+|this\s+|on\s+)?(?:${DAYS.join('|')})|next\s+week)\b`,
      'i'
    );
    const dayMatch = text.match(dayRe);
    if (dayMatch) {
      const phrase = dayMatch[1].toLowerCase();
      anchor = new Date(now);
      anchor.setSeconds(0, 0);

      if (phrase === 'tomorrow') {
        anchor.setDate(anchor.getDate() + 1);
        anchor.setHours(9, 0, 0, 0);
      } else if (phrase === 'next week') {
        anchor.setDate(anchor.getDate() + 7);
        anchor.setHours(9, 0, 0, 0);
      } else if (phrase === 'tonight') {
        anchor.setHours(19, 0, 0, 0);
      } else if (phrase === 'today') {
        anchor.setHours(anchor.getHours() + 1, 0, 0, 0);
      } else {
        const wanted = DAYS.findIndex((d) => phrase.endsWith(d));
        const forceNext = /^next/.test(phrase);
        let delta = (wanted - anchor.getDay() + 7) % 7;
        if (delta === 0 || forceNext) delta = delta === 0 ? 7 : delta;
        anchor.setDate(anchor.getDate() + delta);
        anchor.setHours(9, 0, 0, 0);
      }
      text = cut(text, dayMatch.index, dayMatch.index + dayMatch[0].length);
    }
  }

  // --- a named part of the day: "in the morning", "at lunchtime" ----------
  if (!when) {
    const partRe = new RegExp(
      String.raw`\b(?:in\s+the\s+|this\s+|at\s+|around\s+)?(${Object.keys(DAY_PARTS).join('|')})\b`,
      'i'
    );
    const part = text.match(partRe);
    if (part) {
      const [h, m] = DAY_PARTS[part[1].toLowerCase()];
      const base = anchor || new Date(now);
      base.setHours(h, m, 0, 0);
      // "this evening" once evening has passed means tomorrow evening.
      if (!anchor && base.getTime() <= now.getTime()) base.setDate(base.getDate() + 1);
      when = base;
      anchor = null;
      text = cut(text, part.index, part.index + part[0].length);
    }
  }

  // --- an explicit clock time ---------------------------------------------
  if (!when) {
    // With a day already named, a bare "6" is safe to read as a time.
    const time = matchTime(text, !anchor);
    if (time) {
      const base = anchor || new Date(now);
      const hour = resolveHour(time.hour, time.meridiem);
      base.setHours(hour, time.minute, 0, 0);
      if (!anchor && base.getTime() <= now.getTime()) base.setDate(base.getDate() + 1);
      when = base;
      anchor = null;
      text = cut(text, time.start, time.end);
    }
  }

  if (!when && anchor) when = anchor;

  return {
    text: tidy(text),
    remindAt: when && when.getTime() > now.getTime() ? when.getTime() : null,
    repeat: null,
  };
}

/** Tidy up whatever's left of the sentence once the time words are gone. */
function tidy(text) {
  let t = text
    .replace(/\s+/g, ' ')
    .replace(/^(?:to|and|then|please|by|on|at|for)\s+/i, '')
    .replace(/\s+(?:at|on|by|to|and|then)$/i, '')
    .replace(/[\s,;.]+$/, '')
    .trim();
  if (t) t = t[0].toUpperCase() + t.slice(1);
  return t;
}

/** When a routine is completed, roll its reminder to the next firing. */
export function nextOccurrence(remindAt, repeat, now = new Date()) {
  const next = new Date(remindAt);
  const step = repeat.freq === 'daily' ? 1 : 7;
  do {
    next.setDate(next.getDate() + step);
  } while (next.getTime() <= now.getTime());
  return next.getTime();
}
