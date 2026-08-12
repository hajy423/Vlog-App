# Vlog 📹

A mobile-first vlogging PWA. Record **1–3 second** video clips with the current time
(24-hour `HH:MM`) burned into the center of the frame in small white text, then
**stitch every clip together** into one video, oldest to newest.

Everything stays **on your phone** — clips are stored locally in the browser
(IndexedDB), no account, no server, works offline once installed.

## Features

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
- **Stitching** (`js/stitcher.js`): clips are replayed in chronological order onto
  a canvas while their audio is routed through the Web Audio API, and the combined
  stream is re-recorded into a single file. It runs in real time — with 1–3 s
  clips, stitching a whole day stays quick — and needs no external libraries.
- Output format is whatever the device's `MediaRecorder` supports best: MP4 on
  iOS Safari, WebM on Android Chrome.

## Browser support

- **Android Chrome / Edge / Samsung Internet** — full support.
- **iOS Safari 14.5+** — full support (records MP4).
- Desktop browsers work too; it's just laid out for phones.
