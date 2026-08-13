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
- `js/app.js` — rendering, the reminder sheets, and the Home Screen badge.
- `sw.js` — caches the shell so it opens instantly and works offline.

## Browser support

- **iOS Safari 16.4+** — everything, once added to the Home Screen.
- **Android Chrome** — everything; Calendar hand-off goes through the share sheet.
- **Desktop** — works, and the `.ics` files import into any calendar app.
