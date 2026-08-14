import { addClip, getClips, deleteClip } from './db.js';
import { Recorder, formatClock, extForMime, MIN_MS, MAX_MS, MODES, pageIsLandscape } from './recorder.js';
import { stitchClips } from './stitcher.js';
import { HOTEL_RECIPE, maxMsForShot } from './recipes.js';

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

/* ============ Free / Pro ============ */
// Change APP_NAME once the final name is chosen — it's the free-plan watermark.
const APP_NAME = 'Daily Vlog';
const FREE_STITCH_LIMIT = 15;
const PRO_KEY = 'vlog-pro';

const isPro = () => localStorage.getItem(PRO_KEY) === '1';

function openUpgrade(lead) {
  $('upgrade-lead').textContent = lead;
  $('upgrade-modal').classList.remove('hidden');
}

$('btn-close-upgrade').addEventListener('click', () => $('upgrade-modal').classList.add('hidden'));

$('btn-buy-pro').addEventListener('click', () => {
  // Payment stub: replace with real store billing (Play Billing / StoreKit)
  // when the app ships to a store.
  localStorage.setItem(PRO_KEY, '1');
  $('upgrade-modal').classList.add('hidden');
  toast('Pro unlocked ✨');
  renderClips();
});

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
  resetHint();
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
  btn.addEventListener('click', () => {
    if (btn.dataset.screen !== 'screen-record') exitGuided();
    showScreen(btn.dataset.screen);
  });
});

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.screen === id));
  if (id === 'screen-record') {
    startCamera();
  } else {
    recorder.stopCamera();
    id === 'screen-shoot' ? renderShoot() : renderClips();
  }
}

/* ============ Guided shoot ============ */
// The shot list drives everything: it decides what you film, how long each
// take runs, and what order the clips go back together in. Clips recorded
// here are tagged with their shot so the build can rebuild the planned edit.

const recipe = HOTEL_RECIPE;
const HOOK_KEY = 'vlog-hook';
const MIN_SHOTS_TO_BUILD = 3;

let guidedShotKey = null;

const currentShot = () => recipe.shots.find((s) => s.key === guidedShotKey) || null;

/** Latest clip per shot for this recipe. getClips() is oldest-first, so retakes win. */
function shotMap(clips) {
  const map = new Map();
  for (const clip of clips) {
    if (clip.recipeId === recipe.id && clip.shotKey) map.set(clip.shotKey, clip);
  }
  return map;
}

async function renderShoot() {
  await loadClips();
  const done = shotMap(clipsCache);

  $('recipe-title').textContent = recipe.title;
  $('recipe-subtitle').textContent = recipe.subtitle;
  $('shoot-count').textContent = `${done.size}/${recipe.shots.length}`;
  $('shoot-progress-fill').style.width = `${Math.round((done.size / recipe.shots.length) * 100)}%`;

  const list = $('shot-list');
  list.innerHTML = '';
  recipe.shots.forEach((shot, i) => {
    const clip = done.get(shot.key);
    const card = document.createElement('button');
    card.className = `shot-card${clip ? ' done' : ''}`;

    const index = document.createElement('span');
    index.className = 'shot-index';
    index.textContent = clip ? '✓' : String(i + 1);

    const text = document.createElement('span');
    text.className = 'shot-card-text';
    const title = document.createElement('strong');
    title.textContent = shot.title;
    const direction = document.createElement('span');
    direction.textContent = clip ? 'Tap to retake' : shot.direction;
    text.append(title, direction);

    card.append(index, text);

    if (clip && clip.thumb) {
      const img = document.createElement('img');
      img.className = 'shot-thumb';
      img.src = clip.thumb;
      img.alt = '';
      card.appendChild(img);
    } else {
      const len = document.createElement('span');
      len.className = 'shot-len';
      len.textContent = `${(shot.targetMs / 1000).toFixed(1)}s`;
      card.appendChild(len);
    }

    card.addEventListener('click', () => enterGuided(shot.key));
    list.appendChild(card);
  });

  const plannedMs = recipe.shots
    .filter((s) => done.has(s.key))
    .reduce((sum, s) => sum + s.targetMs, 0);
  const build = $('btn-build');
  build.disabled = done.size < MIN_SHOTS_TO_BUILD;
  build.textContent = done.size
    ? `🎬 Build my video (${done.size} shots · ${(plannedMs / 1000).toFixed(0)}s)`
    : '🎬 Build my video';
  $('btn-reset-shoot').disabled = done.size === 0;
}

function enterGuided(shotKey) {
  guidedShotKey = shotKey;
  // Room tours are rear-camera, vertical, and the vlog clock has no place here.
  recorder.facing = 'environment';
  recorder.mode = 'vertical';
  recorder.showTimestamp = false;
  showScreen('screen-record');
  updateCameraUI();
  updateGuideUI();
}

function exitGuided() {
  if (!guidedShotKey) return;
  guidedShotKey = null;
  recorder.showTimestamp = true;
  updateGuideUI();
}

function updateGuideUI() {
  const shot = currentShot();
  const guide = $('shot-guide');

  $('shot-banner').classList.toggle('hidden', !shot);
  $('btn-mode').classList.toggle('hidden', !!shot);
  liveTimestampEl.classList.toggle('hidden', !!shot);
  guide.className = 'shot-guide';

  if (!shot) {
    guide.classList.add('hidden');
    resetHint();
    return;
  }

  const step = recipe.shots.indexOf(shot) + 1;
  $('shot-step').textContent = `Shot ${step} of ${recipe.shots.length}`;
  $('shot-title').textContent = shot.title;
  $('shot-direction').textContent = shot.direction;
  $('shot-why').textContent = shot.why;
  guide.classList.toggle('hidden', shot.guide === 'none');
  if (shot.guide !== 'none') guide.classList.add(shot.guide);
  resetHint();
}

/** Save a guided take, replacing any previous take of the same shot. */
async function saveShotClip(shot, clip) {
  for (const existing of await getClips()) {
    if (existing.recipeId === recipe.id && existing.shotKey === shot.key) {
      await deleteClip(existing.id);
    }
  }
  await addClip({ ...clip, recipeId: recipe.id, shotKey: shot.key });
}

/** Move to the next shot that still has no take, wrapping to the start. */
async function advanceGuided(shot) {
  const done = shotMap(await getClips());
  const at = recipe.shots.indexOf(shot);
  const rest = [...recipe.shots.slice(at + 1), ...recipe.shots.slice(0, at)];
  const next = rest.find((s) => !done.has(s.key));

  if (!next) {
    exitGuided();
    showScreen('screen-shoot');
    toast('Every shot is in the can 🎬');
    return;
  }
  guidedShotKey = next.key;
  updateGuideUI();
  toast(`Saved ✓  Next: ${next.title}`);
}

$('btn-exit-guide').addEventListener('click', () => {
  exitGuided();
  showScreen('screen-shoot');
});

$('btn-reset-shoot').addEventListener('click', async () => {
  const shots = shotMap(clipsCache);
  if (!shots.size) return;
  if (!confirm(`Delete all ${shots.size} shots and start this video over?`)) return;
  for (const clip of shots.values()) await deleteClip(clip.id);
  toast('Shot list cleared');
  renderShoot();
});

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

/** The idle hint under the record button: shot direction when guided, mode hint otherwise. */
function resetHint() {
  const shot = currentShot();
  recordHint.textContent = shot
    ? `Hold about ${(shot.targetMs / 1000).toFixed(1)}s — anything extra gets trimmed`
    : MODE_HINTS[recorder.mode];
}

function beginRecording() {
  if (!recorder.stream) {
    startCamera();
    return;
  }
  const shot = currentShot();
  const capMs = shot ? maxMsForShot(shot) : MAX_MS;
  let rec;
  try {
    rec = recorder.record((elapsed) => {
      recordingElapsed = elapsed;
      recTimeEl.textContent = `${(Math.min(elapsed, capMs) / 1000).toFixed(1)}s`;
      ringFill.style.strokeDashoffset = String(RING_LEN * (1 - Math.min(elapsed / capMs, 1)));
      if (elapsed < MIN_MS) {
        recordHint.textContent = 'Recording… (1s minimum)';
      } else {
        recordHint.textContent = shot
          ? `Target ${(shot.targetMs / 1000).toFixed(1)}s — tap to stop`
          : 'Tap to stop — auto-stops at 3s';
      }
    }, { maxMs: capMs });
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
      if (shot) {
        await saveShotClip(shot, clip);
        await advanceGuided(shot);
      } else {
        await addClip(clip);
        toast('Clip saved ✓');
      }
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
  resetHint();
}

/* ============ Clips gallery ============ */
let clipsCache = [];
let selectMode = false;
const selected = new Set();

async function loadClips() {
  clipsCache = await getClips();
  // Drop selections for clips that no longer exist.
  const ids = new Set(clipsCache.map((c) => c.id));
  for (const id of selected) if (!ids.has(id)) selected.delete(id);
  if (!clipsCache.length) selectMode = false;
  return clipsCache;
}

async function renderClips() {
  await loadClips();

  const grid = $('clip-grid');
  grid.innerHTML = '';
  $('clip-count').textContent = clipsCache.length
    ? `${clipsCache.length} clip${clipsCache.length === 1 ? '' : 's'}`
    : '';
  $('clips-empty').classList.toggle('hidden', clipsCache.length > 0);
  $('btn-pro').classList.toggle('hidden', isPro());
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
    const shotIndex = clip.shotKey ? recipe.shots.findIndex((s) => s.key === clip.shotKey) : -1;
    const label = shotIndex >= 0 ? `Shot ${shotIndex + 1}` : formatClock(new Date(clip.createdAt));
    meta.innerHTML = `<span>${label}</span><span>${(clip.duration / 1000).toFixed(1)}s</span>`;
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
  // Vertical video fills the whole screen; horizontal keeps bars top/bottom.
  video.onloadedmetadata = () => {
    video.classList.toggle('cover', video.videoHeight > video.videoWidth);
  };
  video.src = playerUrl;
  $('player-modal').classList.remove('hidden');
  video.play().catch(() => {});
}

function closePlayer() {
  const video = $('player-video');
  video.pause();
  video.classList.remove('cover');
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

$('btn-pro').addEventListener('click', () =>
  openUpgrade(`Everything in ${APP_NAME} is free — Pro removes the watermark and lets you stitch your whole archive at once.`)
);

$('btn-stitch').addEventListener('click', async () => {
  const toStitch = selectMode ? clipsCache.filter((c) => selected.has(c.id)) : clipsCache;
  if (!toStitch.length) return;

  if (!isPro() && toStitch.length > FREE_STITCH_LIMIT) {
    openUpgrade(
      `That's ${toStitch.length} clips — quite the streak! The free plan stitches up to ${FREE_STITCH_LIMIT} clips at a time. Go Pro to stitch them all in one video, or select ${FREE_STITCH_LIMIT} or fewer.`
    );
    return;
  }

  $('stitch-modal').classList.remove('hidden');
  $('stitch-progress-wrap').classList.remove('hidden');
  $('stitch-result-wrap').classList.add('hidden');
  setStitchProgress(0, 'Preparing…');

  stitchAbort = new AbortController();
  try {
    const { blob, mime } = await stitchClips(toStitch, setStitchProgress, {
      signal: stitchAbort.signal,
      watermark: isPro() ? null : APP_NAME,
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

/* ============ Build (guided shoot → finished video) ============ */
// Rebuilds the planned edit: clips in shot-list order, each trimmed to its
// target length, the hook burned over the opening, music underneath.

let musicBuffer = null;

const musicLevel = () => Number($('music-level').value) / 100;

$('btn-build').addEventListener('click', () => {
  $('hook-input').value = localStorage.getItem(HOOK_KEY) || '';
  $('hook-input').placeholder = recipe.hookPlaceholder;
  $('hook-help').textContent = recipe.hookHelp;
  $('build-modal').classList.remove('hidden');
});

$('btn-close-build').addEventListener('click', () => $('build-modal').classList.add('hidden'));

$('music-level').addEventListener('input', () => {
  $('music-level-value').textContent = `${$('music-level').value}%`;
});

$('music-input').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  musicBuffer = null;
  $('music-level-row').classList.add('hidden');
  if (!file) {
    $('music-name').textContent = 'Sits under your clip audio, and ducks under the keycard and the curtain pull.';
    return;
  }
  $('music-name').textContent = 'Reading audio…';
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    musicBuffer = await ctx.decodeAudioData(await file.arrayBuffer());
    ctx.close().catch(() => {});
    $('music-name').textContent = `${file.name} — loops under your clips, ducks on the keycard and curtain.`;
    $('music-level-row').classList.remove('hidden');
  } catch {
    $('music-input').value = '';
    $('music-name').textContent = 'Could not read that file. Try an m4a, mp3 or wav.';
  }
});

$('btn-build-go').addEventListener('click', async () => {
  // Build the plan synchronously so clip playback is still primed by this tap.
  const done = shotMap(clipsCache);
  const plan = recipe.shots
    .filter((s) => done.has(s.key))
    .map((s) => ({ ...done.get(s.key), trimMs: s.targetMs, duck: !!s.duck }));
  if (!plan.length) return;

  const hook = $('hook-input').value.trim();
  localStorage.setItem(HOOK_KEY, hook);

  $('build-modal').classList.add('hidden');
  $('stitch-modal').classList.remove('hidden');
  $('stitch-progress-wrap').classList.remove('hidden');
  $('stitch-result-wrap').classList.add('hidden');
  setStitchProgress(0, 'Preparing…');

  stitchAbort = new AbortController();
  try {
    const { blob, mime } = await stitchClips(plan, setStitchProgress, {
      signal: stitchAbort.signal,
      watermark: isPro() ? null : APP_NAME,
      music: musicBuffer,
      musicLevel: musicLevel(),
      overlayText: hook,
      overlayMs: 2500,
    });
    showStitchResult(blob, mime);
  } catch (err) {
    closeStitchModal();
    if (!(err && err.name === 'AbortError')) toast('Building failed — please try again');
  }
});

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

// Opens on the shot list, not the camera — the plan comes before the filming.
updateCameraUI();
renderShoot();
