import { addClip, getClips, deleteClip } from './db.js';
import { Recorder, formatClock, extForMime, MIN_MS, MAX_MS } from './recorder.js';
import { stitchClips } from './stitcher.js';

const $ = (id) => document.getElementById(id);

const previewEl = $('preview');
const liveTimestampEl = $('live-timestamp');
const recordBtn = $('btn-record');
const flipBtn = $('btn-flip');
const recordHint = $('record-hint');
const recIndicator = $('rec-indicator');
const recTimeEl = $('rec-time');
const ringFill = $('progress-ring-fill');
const RING_LEN = 289; // 2 * PI * r(46), matches stroke-dasharray in CSS

const recorder = new Recorder(previewEl);
let activeRecording = null;

/* ============ Live clock overlay ============ */
function tickClock() {
  liveTimestampEl.textContent = formatClock();
}
tickClock();
setInterval(tickClock, 1000);

/* ============ Navigation ============ */
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => showScreen(btn.dataset.screen));
});

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.screen === id));
  if (id === 'screen-record') {
    startCamera();
  } else {
    recorder.stopCamera();
    renderClips();
  }
}

/* ============ Camera ============ */
async function startCamera() {
  $('camera-error').classList.add('hidden');
  try {
    await recorder.start();
  } catch (err) {
    $('camera-error-msg').textContent =
      err && err.name === 'NotAllowedError'
        ? 'Camera access was denied. Allow camera & microphone for this site in your browser settings, then retry.'
        : 'Could not start the camera. Note: the camera only works over HTTPS.';
    $('camera-error').classList.remove('hidden');
  }
}

$('btn-retry-camera').addEventListener('click', startCamera);
flipBtn.addEventListener('click', async () => {
  if (recorder.recording) return;
  try {
    await recorder.flip();
  } catch {
    toast('Could not switch camera');
  }
});

/* ============ Recording ============ */
recordBtn.addEventListener('click', () => {
  if (activeRecording) {
    stopIfAllowed();
  } else {
    beginRecording();
  }
});

let recordingElapsed = 0;

function beginRecording() {
  if (!recorder.stream) {
    startCamera();
    return;
  }
  let rec;
  try {
    rec = recorder.record((elapsed) => {
      recordingElapsed = elapsed;
      recTimeEl.textContent = `${(Math.min(elapsed, MAX_MS) / 1000).toFixed(1)}s`;
      ringFill.style.strokeDashoffset = String(RING_LEN * (1 - Math.min(elapsed / MAX_MS, 1)));
      recordHint.textContent =
        elapsed < MIN_MS ? 'Recording… (1s minimum)' : 'Tap to stop — auto-stops at 4s';
    });
  } catch {
    toast('Recording could not start');
    return;
  }
  activeRecording = rec;
  recordingElapsed = 0;
  recordBtn.classList.add('recording');
  recIndicator.classList.remove('hidden');
  flipBtn.disabled = true;

  rec.done
    .then(async (clip) => {
      await addClip(clip);
      toast('Clip saved ✓');
    })
    .catch(() => toast('Recording failed'))
    .finally(resetRecordUI);
}

function stopIfAllowed() {
  if (!activeRecording) return;
  if (recordingElapsed < MIN_MS) {
    // Enforce the 1 second minimum: finish out the first second, then stop.
    recordHint.textContent = 'Recording… (1s minimum)';
    setTimeout(() => activeRecording && activeRecording.stop(), MIN_MS - recordingElapsed);
  } else {
    activeRecording.stop();
  }
}

function resetRecordUI() {
  activeRecording = null;
  recordBtn.classList.remove('recording');
  recIndicator.classList.add('hidden');
  flipBtn.disabled = false;
  ringFill.style.strokeDashoffset = String(RING_LEN);
  recordHint.textContent = 'Tap to record a 1–4 second clip';
}

/* ============ Clips gallery ============ */
let clipsCache = [];

async function renderClips() {
  clipsCache = await getClips();
  const grid = $('clip-grid');
  grid.innerHTML = '';
  $('clip-count').textContent = clipsCache.length
    ? `${clipsCache.length} clip${clipsCache.length === 1 ? '' : 's'}`
    : '';
  $('clips-empty').classList.toggle('hidden', clipsCache.length > 0);
  $('btn-stitch').disabled = clipsCache.length < 1;

  // Newest first in the grid; stitching still runs oldest first.
  [...clipsCache].reverse().forEach((clip) => {
    const tile = document.createElement('button');
    tile.className = 'clip-tile';
    const img = document.createElement('img');
    img.src = clip.thumb || '';
    img.alt = 'Clip thumbnail';
    const meta = document.createElement('div');
    meta.className = 'clip-meta';
    const when = new Date(clip.createdAt);
    meta.innerHTML = `<span>${formatClock(when)}</span><span>${(clip.duration / 1000).toFixed(1)}s</span>`;
    tile.append(img, meta);
    tile.addEventListener('click', () => openPlayer(clip));
    grid.appendChild(tile);
  });
}

/* ============ Player modal ============ */
let playerUrl = null;
let playerClipId = null;

function openPlayer(clip) {
  closePlayer();
  playerClipId = clip.id;
  playerUrl = URL.createObjectURL(clip.blob);
  const video = $('player-video');
  video.src = playerUrl;
  $('player-modal').classList.remove('hidden');
  video.play().catch(() => {});
}

function closePlayer() {
  const video = $('player-video');
  video.pause();
  video.removeAttribute('src');
  if (playerUrl) URL.revokeObjectURL(playerUrl);
  playerUrl = null;
  playerClipId = null;
  $('player-modal').classList.add('hidden');
}

$('btn-close-player').addEventListener('click', closePlayer);
$('btn-delete-clip').addEventListener('click', async () => {
  if (playerClipId == null) return;
  await deleteClip(playerClipId);
  closePlayer();
  toast('Clip deleted');
  renderClips();
});

/* ============ Stitching ============ */
let stitchAbort = null;
let stitchUrl = null;

$('btn-stitch').addEventListener('click', async () => {
  if (!clipsCache.length) return;

  $('stitch-modal').classList.remove('hidden');
  $('stitch-progress-wrap').classList.remove('hidden');
  $('stitch-result-wrap').classList.add('hidden');
  setStitchProgress(0, 'Preparing…');

  stitchAbort = new AbortController();
  try {
    const { blob, mime } = await stitchClips(clipsCache, setStitchProgress, {
      signal: stitchAbort.signal,
    });
    showStitchResult(blob, mime);
  } catch (err) {
    closeStitchModal();
    if (!(err && err.name === 'AbortError')) toast('Stitching failed — please try again');
  }
});

function setStitchProgress(fraction, label) {
  $('stitch-progress').style.width = `${Math.round(fraction * 100)}%`;
  $('stitch-status').textContent = label;
}

function showStitchResult(blob, mime) {
  if (stitchUrl) URL.revokeObjectURL(stitchUrl);
  stitchUrl = URL.createObjectURL(blob);

  const video = $('stitch-video');
  video.src = stitchUrl;

  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const filename = `vlog-${stamp}.${extForMime(mime)}`;

  const dl = $('btn-download-stitch');
  dl.href = stitchUrl;
  dl.download = filename;

  const shareBtn = $('btn-share-stitch');
  const file = new File([blob], filename, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    shareBtn.classList.remove('hidden');
    shareBtn.onclick = () => navigator.share({ files: [file] }).catch(() => {});
  } else {
    shareBtn.classList.add('hidden');
  }

  $('stitch-progress-wrap').classList.add('hidden');
  $('stitch-result-wrap').classList.remove('hidden');
}

function closeStitchModal() {
  const video = $('stitch-video');
  video.pause();
  video.removeAttribute('src');
  if (stitchUrl) URL.revokeObjectURL(stitchUrl);
  stitchUrl = null;
  $('stitch-modal').classList.add('hidden');
}

$('btn-cancel-stitch').addEventListener('click', () => {
  if (stitchAbort) stitchAbort.abort();
  closeStitchModal();
});
$('btn-close-stitch').addEventListener('click', closeStitchModal);

/* ============ Toast ============ */
let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}

/* ============ Boot ============ */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

startCamera();
