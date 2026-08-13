# Nudge ✓

A to-do app designed around one question: **why does everyone abandon to-do
apps?** Every mechanic in Nudge is an answer to a specific way these apps fail.
No account, no server, no subscription — everything stays on your phone.

## The five failure modes, and what Nudge does about them

**1. The list becomes a guilt museum.** Items pile up, opening the app feels
bad, so you stop opening it. This kills more to-do apps than any missing
feature. So in Nudge, *nothing rots*: an item untouched for two weeks stops
being a task and becomes a question — **"Still matters?" / "Let it go"** — and
either answer makes the list lighter. (Before that, stale items just collect a
dry remark or two. The wit is capped; the question is the point.)

**2. Forty visible tasks means acting on none.** Psychologists call it choice
overload; you know it as scrolling your own list feeling tired. So Nudge's
Today view is **capped at three picks**. Try to pick a fourth and it refuses:
*"Three is the limit. That's the point."* Everything else waits in **Later**,
out of sight. The first pick is styled as **the one that matters** — if you do
one thing, it's that one.

**3. Adding a task costs too much effort, so it never gets captured.** An open
loop you didn't write down follows you around all day (the Zeigarnik effect).
So capture is near-zero friction: type it, or tap 🎙 and *say* it — the parser
pulls the time out of the sentence, so **"call mum tomorrow at six"** arrives
scheduled. **"gym every monday at 7am"** becomes a repeating routine. "Hey
Siri, add to Nudge" works with the phone still in your pocket (setup below).

**4. Finishing is never rewarded — there's always more list.** In Nudge,
completing anything pops confetti, and completing all your picks **closes the
day**: *"That's the list. Go be a person."* Permission to stop is the reward.
The 🔥 streak counts consecutive days you finished *something* — a bar low
enough to protect, which is the only kind of streak that works. It turns green
once today's win is banked.

**5. The app only works if you remember to open it.** Nudge assumes you won't.
Timed tasks are handed to your phone's **Calendar**, which raises the alert on
your lock screen with the task as the text — app closed, no push server, no
subscription. Routines go over once with a repeat rule. The Home Screen icon
carries a badge with the open count. And one **daily nudge** alert carries your
list summary and your streak to the lock screen every morning.

## The shape of a day

1. **Morning**: the daily nudge fires. You open Nudge to a short question —
   *"What matters today?"* — and pick up to three from Later. One tap each.
2. **During the day**: reminders arrive from Calendar at the times you said.
   Routines ("every day at 9pm") sit in an "Also today" section.
3. **Anytime a thought strikes**: say it. It lands in Later, not in your face.
4. **When the third pick is done**: confetti, day closed, streak extended.
   Yesterday's unfinished picks quietly return to Later — tomorrow starts
   clean. (The fresh-start effect is real; rollover guilt is how apps die.)

## Talking instead of typing

| You say | You get |
|---|---|
| "call the dentist tomorrow at six" | *Call the dentist* — tomorrow 18:00 |
| "take the bins out in 20 minutes" | *Take the bins out* — in 20 minutes |
| "remind me to pay rent on Monday at 9am" | *Pay rent* — Monday 09:00 |
| "take pills every day at 9pm" | *Take pills* — routine, daily 21:00 |
| "gym every monday at 7am" | *Gym* — routine, Mondays 07:00 |
| "buy 2 pints of milk" | *Buy 2 pints of milk* — no time (numbers that aren't times are left alone) |

Dictation fillers ("remind me to", "don't forget to", "I need to") are
stripped. A bare hour follows how people speak: **1–6 means evening, 7–11
means morning** — "at five" is 17:00. An hour that's already gone rolls to
tomorrow rather than flipping to a time you never said.

The mic keeps listening between sentences, so you can reel off several things
in one go. iOS Safari drops the speech session every few seconds; Nudge
restarts it underneath so one tap feels like one long listen.

## "Hey Siri, add to Nudge"

One five-minute setup in the **Shortcuts** app:

1. Open **Shortcuts** → **+** (new shortcut).
2. Add action **"Dictate Text"** (set *Stop Listening* → **After Pause**).
3. Add action **"URL Encode"** with **Dictated Text** as its input — without
   this, anything you say containing `&` or `#` gets truncated.
4. Add action **"Text"**: your app's address plus `?add=`, then the
   **URL Encoded Text** variable:
   `https://YOUR-PAGES-URL/todo/?add=`**[URL Encoded Text]**
5. Add action **"Open URLs"** with that Text as input.
6. Rename the shortcut **"Add to Nudge"**, tap **Done**.

Say "Hey Siri, Add to Nudge", speak, done — reminder included if you said a
time. Honest note: the app flashes open for a second (iOS gives a web app no
background channel); the *capture* is hands-free.

## Setting it up on an iPhone

1. Open the app in **Safari** (Chrome on iOS can't install web apps).
2. **Share → Add to Home Screen.** Put it in your dock.
3. Open it from the icon — the badge only works from the Home Screen app.
4. When you set a reminder, iOS downloads a small `.ics` file. Tap it (in
   Downloads or Files) and Calendar offers **Add All**. That's the hand-off:
   from then on the alert fires with the app closed, forever.
5. **Send all** hands over every pending reminder in one file — set a few, then
   do one trip to Calendar.

## Things worth knowing

- **Completing a task doesn't remove its calendar alert** — a static site
  can't reach into your calendar. Dismiss the alert, or delete the event in
  Calendar. Same for routines and the daily nudge: turning them off in Nudge
  stops Nudge tracking them; deleting the calendar event silences them.
- An amber `⚠︎ … not sent` chip means a time is saved in Nudge but was never
  handed to Calendar — nothing will actually ring. Tap it to send it.
- "Let it go" archives (nothing is truly deleted except via the Done list),
  but there's deliberately no browsing UI for the archive. It's gone. That's
  the feature.
- Reminders use floating local time — 9am stays 9am across time zones.
- Stable calendar UIDs mean re-sending a reminder updates the existing event
  instead of duplicating it.
- Your list lives in this browser's local storage. Clearing Safari website
  data erases it; there's no sync or backup.

## Running it

Static files, no build step, no dependencies.

```bash
npx serve .
# then open http://localhost:3000/todo/
```

Deploy on any static host. GitHub Pages: **Settings → Pages → Deploy from
branch**, pick the branch and `/ (root)`, then visit `<pages-url>/todo/`.

## How it's put together

- `js/store.js` — the data model *is* the product opinion: picks capped at
  three, the two-week staleness clock, streak rules, fresh-start day
  boundaries, v1→v2 migration.
- `js/when.js` — natural-language times and routines from ordinary speech.
- `js/voice.js` — continuous speech capture with iOS session-restart.
- `js/ics.js` — RFC 5545 generation: escaping, 75-octet folding that won't
  split an emoji, `VALARM` blocks, `RRULE` for routines, share-sheet hand-off
  with download fallback.
- `js/sass.js` — the (capped) commentary and the lock-screen alert tone.
- `js/confetti.js` — the completion dopamine, canvas-only, respects
  `prefers-reduced-motion`.
- `js/app.js` — rendering, triage, sheets, badge, Siri URL capture.
- `sw.js` — offline shell cache.

Typed input, voice input, and the Siri hand-off all converge on one
`capture()` function, so they can't drift apart in behaviour.

## Browser support

- **iOS Safari 16.4+** — everything, once added to the Home Screen. Voice
  needs 14.5+ and asks for mic permission once.
- **Android Chrome** — everything; Calendar hand-off via the share sheet.
- **Desktop** — works; the `.ics` files import into any calendar app.
- Where speech recognition is missing the 🎙 hides itself; typing is
  unaffected.
