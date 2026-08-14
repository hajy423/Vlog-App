# Vlog 📹

A mobile-first vlogging PWA. Record **1–3 second** video clips with the current time
(24-hour `HH:MM`) burned into the center of the frame in small white text, then
**stitch every clip together** into one video, oldest to newest.

Everything stays **on your phone** — clips are stored locally in the browser
(IndexedDB), no account, no server, works offline once installed.

## Features

- 🎬 **Guided shoots** — pick a shot-list recipe and the app directs the whole
  video: what to film, how to frame it, how long to hold each take, and what
  order it all goes back together in. See [Shoot mode](#shoot-mode) below.
- 🎥 **Record screen** — tap the button to record; recording auto-stops at 3 s and
  can't be stopped before 1 s, so every clip is 1–3 seconds long.
- 🕐 **Burned-in timestamp** — the time of recording (24-hour clock, `HH:MM`, no
  seconds/milliseconds, no date) is rendered into the video itself: small, white,
  dead-center.
- 🔄 **Front/back camera** flip.
- 🖼️ **Clips library** — thumbnail grid with recording time and duration; tap to
  play, delete what you don't want.
- ✨ **Stitch** — combines all clips chronologically (oldest first) into one video,
  right on the device. Originals are kept. Save the result or share it with the
  system share sheet.
- 📲 **Installable PWA** — add it to your home screen and it opens full-screen like
  a native app, offline included.

## Shoot mode

The **Shoot** tab runs a *recipe* — an ordered shot list with a target length for
each shot. Tapping a shot opens the camera with that shot's direction on screen,
a framing guide (rule-of-thirds, or a centre cross for the shots that have to be
level), and the record ring set to that shot's length. After each take it moves
itself to the next unshot shot.

**Build my video** then reassembles the take: clips in shot-list order rather than
recording order, each trimmed to its target length so the edit keeps its planned
rhythm even when you over-recorded, your hook burned over the opening 2.5 s, and
optional music looping underneath — ducked automatically under the shots whose own
sound is the point.

Guided shoots force vertical 9:16, default to the rear camera, and drop the
`HH:MM` vlog stamp. Freeform recording on the **Record** tab is unchanged.

The shipped recipe is the faceless hotel-room video specified in
[`docs/hotel-video-playbook.md`](docs/hotel-video-playbook.md) — 11 shots, 18
seconds. Recipes are plain data in [`js/recipes.js`](js/recipes.js); adding
another is a matter of adding an entry to `RECIPES`.

## Running it

The camera API requires a **secure context (HTTPS)** — plain `file://` or HTTP
won't get camera access (localhost is the one exception).

### Quick local test

```bash
npx serve .
# open http://localhost:3000 (localhost counts as secure)
```

To test on your phone from a dev machine, use an HTTPS tunnel such as
`npx ngrok http 3000`, or deploy it (below).

### Deploy (recommended: GitHub Pages)

The app is static files — any static host works (GitHub Pages, Netlify, Vercel…).
For GitHub Pages: repository **Settings → Pages → Deploy from branch**, pick the
branch and `/ (root)`. Then open the Pages URL on your phone and use your
browser's **Add to Home Screen**.

## How it works

- **Recording** (`js/recorder.js`): camera frames are drawn to a canvas each frame
  with the `HH:MM` stamp painted on top, and `canvas.captureStream()` + the mic
  audio track feed a `MediaRecorder`. The timestamp is therefore part of the video
  file itself, not an overlay.
- **Storage** (`js/db.js`): clip blobs, thumbnails, and metadata live in IndexedDB.
  Guided takes carry a `recipeId` + `shotKey` so the build can find them again.
- **Recipes** (`js/recipes.js`): pure data — each shot's title, direction, framing
  guide, target length, and whether music ducks under it.
- **Stitching** (`js/stitcher.js`): clips are replayed in order onto a canvas while
  their audio is routed through the Web Audio API, and the combined stream is
  re-recorded into a single file. Per-clip `trimMs` cuts a shot short; a looping
  `AudioBuffer` provides music, with a gain node ducking it on flagged clips. It
  runs in real time — with 1–4 s clips that stays quick — and needs no external
  libraries.
- Output format is whatever the device's `MediaRecorder` supports best: MP4 on
  iOS Safari, WebM on Android Chrome.

## Browser support

- **Android Chrome / Edge / Samsung Internet** — full support.
- **iOS Safari 14.5+** — full support (records MP4).
- Desktop browsers work too; it's just laid out for phones.
