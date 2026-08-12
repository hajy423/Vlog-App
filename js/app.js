import { addClip, getClips, deleteClip } from './db.js';
import { Recorder, formatClock, extForMime, MIN_MS, MAX_MS, MODES, pageIsLandscape } from './recorder.js';
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

/* ============ Mode (aspect / orientation) ============ */
const MODE_LABELS = {
  vertical: '9:16',
  horizontal: '16:9',
  'horizontal-rotated': '16:9 ⟲',
};
const MODE_HINTS = {
  vertical: 'Tap to record a 1–3 second clip',
  horizontal: 'Horizontal video — hold your phone upright',
  'horizontal-rotated': 'Turn your phone sideways — the time stamp shows which way is up',
};

recorder.mode = MODES.includes(localStorage.getItem('vlog-mode'))
  ? localStorage.getItem('vlog-mode')
  : 'vertical';

$('btn-mode').addEventListener('click', () => {
  if (recorder.recording) return;
  const next = MODES[(MODES.indexOf(recorder.mode) + 1) % MODES.length];
  recorder.mode = next;
  localStorage.setItem('vlog-mode', next);
  updateCameraUI();
});

$('btn-rot-dir').addEventListener('click', () => {
  if (recorder.recording) return;
  recorder.rotationDir *= -1;
  updateCameraUI();
});

window.matchMedia('(orientation: landscape)').addEventListener('change', updateCameraUI);

function updateCameraUI() {
  const wrap = $('camera-wrap');
  wrap.classList.remove('mode-vertical', 'mode-horizontal', 'mode-horizontal-rotated');
  // Rotated mode uses the full screen like vertical; only plain horizontal letterboxes.
  const letterbox = recorder.mode === 'horizontal' && !pageIsLandscape();
  wrap.classList.add(letterbox ? 'mode-horizontal' : 'mode-vertical');

  $('btn-mode').textContent = MODE_LABELS[recorder.mode];
  recordHint.textContent = MODE_HINTS[recorder.mode];
  $('btn-rot-dir').classList.toggle('hidden', recorder.activeRotation === 0);
  liveTimestampEl.style.transform = `translate(-50%, -50%) rotate(${recorder.activeRotation * 90}deg)`;
  updatePreviewTransform();
}

/* ============ Zoom ============ */
function updatePreviewTransform() {
  const t = [];
  if (recorder.isFrontCamera) {
    // A selfie mirror flips along what the user perceives as horizontal,
    // which is the screen's vertical axis when the phone is held sideways.
    t.push(recorder.activeRotation ? 'scaleY(-1)' : 'scaleX(-1)');
  }
  if (recorder.digitalZoom > 1) t.push(`scale(${recorder.digitalZoom})`);
  previewEl.style.transform = t.join(' ');
}

function setZoom(z) {
  recorder.setZoom(z);
  $('zoom-label').textContent = `${recorder.zoom.toFixed(1)}×`;
  updatePreviewTransform();
}

$('btn-zoom-in').addEventListener('click', () => setZoom(recorder.zoom + 0.5));
$('btn-zoom-out').addEventListener('click', () => setZoom(recorder.zoom - 0.5));

// Pinch to zoom on the preview.
const pinchPointers = new Map();
let pinchStart = null;
const previewBox = $('preview-box');

function pinchDist() {
  const [a, b] = [...pinchPointers.values()];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

previewBox.addEventListener('pointerdown', (e) => {
  pinchPointers.set(e.pointerId, e);
  if (pinchPointers.size === 2) {
    pinchStart = { dist: pinchDist(), zoom: recorder.zoom };
  }
});
previewBox.addEventListener('pointermove', (e) => {
  if (!pinchPointers.has(e.pointerId)) return;
  pinchPointers.set(e.pointerId, e);
  if (pinchStart && pinchPointers.size === 2) {
    setZoom(pinchStart.zoom * (pinchDist() / pinchStart.dist));
  }
});
for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
  previewBox.addEventListener(type, (e) => {
    pinchPointers.delete(e.pointerId);
    if (pinchPointers.size < 2) pinchStart = null;
  });
}

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
    setZoom(recorder.zoom);
    updateCameraUI();
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
    updateCameraUI();
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
        elapsed < MIN_MS ? 'Recording… (1s minimum)' : 'Tap to stop — auto-stops at 3s';
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
  $('btn-mode').disabled = true;

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
  $('btn-mode').disabled = false;
  ringFill.style.strokeDashoffset = String(RING_LEN);
  recordHint.textContent = MODE_HINTS[recorder.mode];
}

/* ============ Clips gallery ============ */
let clipsCache = [];
let selectMode = false;
const selected = new Set();

async function renderClips() {
  clipsCache = await getClips();
  // Drop selections for clips that no longer exist.
  const ids = new Set(clipsCache.map((c) => c.id));
  for (const id of selected) if (!ids.has(id)) selected.delete(id);
  if (!clipsCache.length) selectMode = false;

  const grid = $('clip-grid');
  grid.innerHTML = '';
  $('clip-count').textContent = clipsCache.length
    ? `${clipsCache.length} clip${clipsCache.length === 1 ? '' : 's'}`
    : '';
  $('clips-empty').classList.toggle('hidden', clipsCache.length > 0);
  $('btn-select').classList.toggle('hidden', !clipsCache.length);
  $('btn-select').textContent = selectMode ? 'Cancel' : 'Select';
  $('btn-select-all').classList.toggle('hidden', !selectMode);
  $('btn-select-all').textContent = selected.size === clipsCache.length ? 'None' : 'Select all';

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
    if (selectMode) {
      tile.classList.toggle('selected', selected.has(clip.id));
      const badge = document.createElement('span');
      badge.className = 'sel-badge';
      badge.textContent = selected.has(clip.id) ? '✓' : '';
      tile.appendChild(badge);
      tile.addEventListener('click', () => {
        selected.has(clip.id) ? selected.delete(clip.id) : selected.add(clip.id);
        tile.classList.toggle('selected', selected.has(clip.id));
        badge.textContent = selected.has(clip.id) ? '✓' : '';
        updateClipActions();
      });
    } else {
      tile.addEventListener('click', () => openPlayer(clip));
    }
    grid.appendChild(tile);
  });

  updateClipActions();
}

function updateClipActions() {
  const stitchBtn = $('btn-stitch');
  const deleteBtn = $('btn-delete-selected');
  if (selectMode) {
    stitchBtn.textContent = `✨ Stitch ${selected.size} selected`;
    stitchBtn.disabled = selected.size < 1;
    deleteBtn.textContent = `Delete ${selected.size}`;
    deleteBtn.disabled = selected.size < 1;
    deleteBtn.classList.remove('hidden');
  } else {
    stitchBtn.textContent = '✨ Stitch all into one video';
    stitchBtn.disabled = clipsCache.length < 1;
    deleteBtn.classList.add('hidden');
  }
  $('btn-select-all').textContent =
    selectMode && selected.size === clipsCache.length ? 'None' : 'Select all';
}

$('btn-select').addEventListener('click', () => {
  selectMode = !selectMode;
  selected.clear();
  renderClips();
});

$('btn-select-all').addEventListener('click', () => {
  if (selected.size === clipsCache.length) {
    selected.clear();
  } else {
    clipsCache.forEach((c) => selected.add(c.id));
  }
  renderClips();
});

$('btn-delete-selected').addEventListener('click', async () => {
  if (!selected.size) return;
  const n = selected.size;
  if (!confirm(`Delete ${n} clip${n === 1 ? '' : 's'}? This can't be undone.`)) return;
  for (const id of selected) await deleteClip(id);
  selected.clear();
  selectMode = false;
  toast(`${n} clip${n === 1 ? '' : 's'} deleted`);
  renderClips();
});

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
  const toStitch = selectMode ? clipsCache.filter((c) => selected.has(c.id)) : clipsCache;
  if (!toStitch.length) return;

  $('stitch-modal').classList.remove('hidden');
  $('stitch-progress-wrap').classList.remove('hidden');
  $('stitch-result-wrap').classList.add('hidden');
  setStitchProgress(0, 'Preparing…');

  stitchAbort = new AbortController();
  try {
    const { blob, mime } = await stitchClips(toStitch, setStitchProgress, {
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

updateCameraUI();
startCamera();
