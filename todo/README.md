# Nudge ✓

A to-do list built around a specific problem: **you don't open apps, and you don't
read your notes.** So the list doesn't wait to be opened — it comes to you.

No account, no server, no subscription. Everything is stored on your phone.

## The trick

A website can't send a notification to a closed iPhone unless someone is running
a push server. Nudge doesn't have one, so it borrows the notifier your phone
already runs around the clock: **Calendar**.

Give a to-do a time and Nudge writes a calendar file with an alarm attached, and
hands it to iOS. From then on Calendar raises the alert — on your lock screen, at
the right moment, whether or not Nudge is installed, open, or online. The alert
text is the task itself, so **"Call the dentist" appears on your lock screen** and
you never have to open anything to find out what you were supposed to do.

Three layers, in order of how hard they are to ignore:

| Layer | What it does | Needs |
|---|---|---|
| **Per-task reminders** | A lock-screen alert naming the task, at a time you pick | Adding the event to Calendar once |
| **Daily nudge** | One repeating alert every day, the backstop for undated items | Adding the event to Calendar once |
| **Icon badge** | A red count on the Home Screen icon, visible every time you unlock | Added to Home Screen, iOS 16.4+ |

Getting things *in* is the other half of the problem — see
**[Talking instead of typing](#talking-instead-of-typing)** and
**["Hey Siri, add to Nudge"](#hey-siri-add-to-nudge)** below.

## Talking instead of typing

Typing is friction, and friction is why things never make it onto the list. So
there are three ways in, and only one of them involves a keyboard.

**Tap the 🎙 button.** It keeps listening, so you can reel off four things in a
row without touching the phone again. Each pause becomes its own to-do.

**Say the deadline out loud.** The words are parsed for a time, so one sentence
does the whole job:

| You say | You get |
|---|---|
| "call the dentist tomorrow at six" | *Call the dentist* — tomorrow 18:00 |
| "take the bins out in 20 minutes" | *Take the bins out* — in 20 minutes |
| "remind me to pay rent on Monday at 9am" | *Pay rent* — Monday 09:00 |
| "water the plants in three days" | *Water the plants* — in 3 days, 9am |
| "book the table tonight" | *Book the table* — 19:00 |
| "buy 2 pints of milk" | *Buy 2 pints of milk* — no time (numbers that aren't times are left alone) |

"Remind me to", "don't forget to" and "I need to" are stripped, because dictation
always includes them.

A bare hour follows how people actually speak: **1–6 means the evening, 7–11 means
the morning.** "At five" is 17:00. If the hour has already gone today it rolls to
tomorrow rather than flipping to a time you never said.

## "Hey Siri, add to Nudge"

The zero-friction version — phone in your pocket, never open anything. It takes
one five-minute setup in the **Shortcuts** app.

1. Open **Shortcuts** → **+** (new shortcut).
2. Add action: search **"Dictate Text"**. (Set *Stop Listening* → **After Pause**.)
3. Add action: search **"URL Encode"**, and set its input to the **Dictated Text**
   variable. This matters — without it, anything you say containing `&` or `#`
   gets truncated.
4. Add action: search **"Text"**. Type your app's address followed by `?add=`, then
   insert the **URL Encoded Text** variable, so it reads:
   `https://YOUR-PAGES-URL/todo/?add=`**[URL Encoded Text]**
5. Add action: search **"Open URLs"**, with the **Text** from step 4 as its input.
6. Tap the shortcut's name at the top, rename it to **"Add to Nudge"**, and tap
   **Done**.

Now say **"Hey Siri, Add to Nudge"**. Siri asks what to add, you speak, and it
lands on the list — with the reminder already set if you said a time.

Two honest notes: the phrase has to match the shortcut name, so pick something you
can say without thinking. And it does flash the app open for a second — iOS gives a
web app no way to receive data in the background. The *capture* is hands-free; the
app blinking past is the cost.

## Things left too long get commented on

Anything sitting on the list starts attracting remarks, and they get worse the
longer you leave it:

| Age | What the app says |
|---|---|
| Under a day | Nothing. It's fine. |
| 1–2 days | *"Still here."* |
| 3–6 days | *"It isn't going to do itself. Allegedly."* |
| 1–2 weeks | *"9 days. It lives here now."* |
| 2 weeks+ | *"It's been here so long it has opinions."* |

Letting a reminder ring and swiping it away costs you a level immediately —
*"You swiped that one away, didn't you."* The row's border climbs from purple to
amber to red as it rots, so stale things stop blending into the list.

**The tone follows the reminder onto your lock screen.** The calendar alert is
written at the moment you send it, so an alarm armed for something ancient arrives
as `CALL THE DENTIST — day 16.` rather than a polite `Call the dentist`. The daily
nudge names and shames your worst offender too.

## Setting it up on an iPhone

1. Open the app in **Safari** (it must be Safari — Chrome on iOS can't install web apps).
2. Tap **Share → Add to Home Screen**. Put the icon in your dock, beside the apps
   you actually open.
3. Open it from the Home Screen icon, not from Safari — the badge only works there.
4. Add a to-do, tap 🔔, pick a time, tap **Set reminder**.
5. iOS downloads a small `.ics` file. Tap it (Safari shows it in Downloads, or find
   it in **Files → Downloads**) and Calendar offers to add it. Tap **Add All**.

Step 5 is a few taps the first time. After that the alert is entirely out of your
hands — it fires whether or not you ever open Nudge again.

**Tip:** set several reminders first, then use **Send all** to hand them over in one
go instead of one file at a time.

## Things worth knowing

- **Completing a task doesn't delete its calendar alert.** Nudge writes the event
  and lets go of it; there's no way for a static site to reach back into your
  calendar. If a reminder fires for something you've already done, dismiss it. To
  stop it in advance, delete the event in Calendar.
- The same goes for the daily nudge: turning it off in Nudge stops Nudge tracking
  it, but you delete the repeating event in Calendar to actually silence it.
- Reminders use **floating time** — 9am stays 9am if you change time zone.
- Re-sending a reminder for the same task updates the existing calendar event
  rather than creating a duplicate (the events carry stable UIDs).
- An amber `⚠︎ … not sent` chip means the time is saved in Nudge but never made it
  to Calendar — so nothing will actually alert you. Tap it to send it.
- Your list lives in this browser's local storage on this device. Clearing Safari's
  website data erases it, and there's no sync or backup.

## Running it

Static files, no build step, no dependencies.

```bash
npx serve .
# then open http://localhost:3000/todo/
```

To deploy, any static host works. For GitHub Pages: **Settings → Pages → Deploy
from branch**, pick the branch and `/ (root)`, then visit `<pages-url>/todo/`.

## How it's put together

- `js/store.js` — the list, in `localStorage`, with a subscribe/render loop.
- `js/ics.js` — iCalendar (RFC 5545) generation: escaping, 75-octet line folding
  that won't split an emoji in half, `VALARM` blocks, and the hand-off to iOS via
  the share sheet with a download fallback.
- `js/when.js` — pulls a time out of ordinary speech, and leaves numbers that
  aren't times alone.
- `js/voice.js` — speech capture, including restarting the engine when iOS Safari
  drops the session every few seconds so one tap feels like one long listen.
- `js/sass.js` — the escalation ladder: how stale a task is, what to say about it,
  and how that reads on a lock screen.
- `js/app.js` — rendering, the reminder sheets, and the Home Screen badge.
- `sw.js` — caches the shell so it opens instantly and works offline.

Typed input, voice input and the Siri hand-off all converge on one `capture()`
function, so they can't drift apart in behaviour.

## Browser support

- **iOS Safari 16.4+** — everything, once added to the Home Screen. Voice needs
  14.5+ and asks for microphone permission the first time.
- **Android Chrome** — everything; Calendar hand-off goes through the share sheet.
- **Desktop** — works, and the `.ics` files import into any calendar app.
- Where speech recognition is missing, the 🎙 button hides itself and typing is
  unaffected.
