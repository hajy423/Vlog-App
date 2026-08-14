// Stitches clips into one video by replaying them in order onto a canvas
// and re-recording the canvas + audio. Pure browser APIs, no dependencies.
// Runs in real time, which stays quick because every clip is 1–4 seconds.
//
// Guided shoots pass extra per-clip direction: `trimMs` caps how long a clip
// plays (so the edit keeps its planned rhythm even if you over-recorded), and
// `duck` drops the music under a clip whose own sound is the point.

import { pickMimeType } from './recorder.js';

/** How far music drops under a ducked clip, as a fraction of its normal level. */
const DUCK_FACTOR = 0.3;

/**
 * @param {Array<{blob: Blob, duration: number, trimMs?: number, duck?: boolean}>} clips
 *   in playback order
 * @param {(fraction: number, label: string) => void} onProgress
 * @param {{
 *   signal?: AbortSignal,
 *   watermark?: string,
 *   music?: AudioBuffer,
 *   musicLevel?: number,
 *   overlayText?: string,
 *   overlayMs?: number,
 * }} opts watermark text is drawn in the bottom corner of the output (free
 *   plan); overlayText is the hook, burned over the opening of the video
 * @returns {Promise<{blob: Blob, mime: string}>}
 */
export async function stitchClips(clips, onProgress, opts = {}) {
  const {
    signal,
    watermark,
    music = null,
    musicLevel = 0.28,
    overlayText = '',
    overlayMs = 2500,
  } = opts;
  const throwIfAborted = () => {
    if (signal && signal.aborted) throw new DOMException('Stitch cancelled', 'AbortError');
  };

  // Prepare a video element per clip. Doing this inside the user's tap
  // (before any await) keeps iOS Safari happy about programmatic playback.
  const urls = [];
  const primed = [];
  const videos = clips.map((clip) => {
    const url = URL.createObjectURL(clip.blob);
    urls.push(url);
    const v = document.createElement('video');
    v.src = url;
    v.playsInline = true;
    v.preload = 'auto';
    // Prime playback permission while still in the gesture.
    v.muted = true;
    primed.push(v.play().then(() => v.pause()).catch(() => {}));
    return v;
  });

  const releaseUrls = () => urls.forEach((u) => URL.revokeObjectURL(u));

  try {
    onProgress(0, 'Loading clips…');
    await Promise.all(videos.map((v) => waitForMetadata(v, signal)));
    // Wait for the priming play/pause to settle so a late pause() can't
    // freeze a clip once real playback starts.
    await Promise.all(primed);
    throwIfAborted();

    // Output orientation: whichever most clips use; the rest get letterboxed.
    const landscapeCount = videos.filter((v) => (v.videoWidth || 0) >= (v.videoHeight || 1)).length;
    const useLandscape = landscapeCount >= videos.length / 2;
    const width = useLandscape ? 1280 : 720;
    const height = useLandscape ? 720 : 1280;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    // Route each clip's audio into the recording.
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    await audioCtx.resume().catch(() => {});
    const dest = audioCtx.createMediaStreamDestination();
    videos.forEach((v) => {
      v.muted = false;
      v.volume = 1;
      try {
        audioCtx.createMediaElementSource(v).connect(dest);
      } catch {
        // Clip without usable audio — video still gets stitched.
      }
    });

    // Music sits under the clip audio and loops for as long as the edit runs.
    let musicSource = null;
    let musicGain = null;
    if (music) {
      musicSource = audioCtx.createBufferSource();
      musicSource.buffer = music;
      musicSource.loop = true;
      musicGain = audioCtx.createGain();
      musicGain.gain.value = musicLevel;
      musicSource.connect(musicGain).connect(dest);
    }

    const canvasStream = canvas.captureStream(30);
    const recStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);

    const mime = pickMimeType();
    const recorder = new MediaRecorder(recStream, {
      ...(mime ? { mimeType: mime } : {}),
      videoBitsPerSecond: 2_500_000,
    });
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    const recorded = new Promise((resolve, reject) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mime || 'video/webm' }));
      recorder.onerror = (e) => reject(e.error || new Error('Stitching failed'));
    });

    recorder.start(250);
    if (musicSource) musicSource.start();
    const videoStartedAt = performance.now();

    // The hook is burned over the opening frames, wherever that lands.
    const drawOverlay = overlayText
      ? (c) => {
          if (performance.now() - videoStartedAt > overlayMs) return;
          drawHook(c, width, height, overlayText);
        }
      : null;

    const totalMs = clips.reduce((sum, c) => sum + clipMs(c), 0);
    let elapsedBefore = 0;

    for (let i = 0; i < videos.length; i++) {
      throwIfAborted();
      const v = videos[i];
      if (musicGain) {
        const target = clips[i].duck ? musicLevel * DUCK_FACTOR : musicLevel;
        musicGain.gain.setTargetAtTime(target, audioCtx.currentTime, 0.08);
      }
      onProgress(elapsedBefore / totalMs, `Shot ${i + 1} of ${videos.length}`);
      await playThrough(v, ctx, width, height, {
        signal,
        watermark,
        drawOverlay,
        limitMs: clips[i].trimMs || 0,
        onClipProgress: (ms) => {
          onProgress(Math.min(1, (elapsedBefore + ms) / totalMs), `Shot ${i + 1} of ${videos.length}`);
        },
      });
      elapsedBefore += clipMs(clips[i], v);
    }

    onProgress(1, 'Finalizing…');
    recorder.stop();
    const blob = await recorded;
    if (musicSource) {
      try {
        musicSource.stop();
      } catch {
        // Already stopped — nothing to do.
      }
    }
    audioCtx.close().catch(() => {});
    canvasStream.getTracks().forEach((t) => t.stop());
    return { blob, mime: blob.type };
  } finally {
    videos.forEach((v) => {
      v.pause();
      v.removeAttribute('src');
      v.load();
    });
    releaseUrls();
  }
}

/** How long a clip will actually run: its length, capped by any trim. */
function clipMs(clip, video) {
  const natural = clip.duration || (video && video.duration * 1000) || 2000;
  return clip.trimMs ? Math.min(natural, clip.trimMs) : natural;
}

function waitForMetadata(video, signal) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1 && (video.videoWidth || video.duration)) return resolve();
    const onAbort = () => reject(new DOMException('Stitch cancelled', 'AbortError'));
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error('Could not load a clip')), { once: true });
  });
}

function drawWatermark(ctx, width, height, text) {
  const fontSize = Math.max(12, Math.round(Math.min(width, height) * 0.032));
  ctx.save();
  ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = fontSize * 0.4;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.fillText(text, width - fontSize, height - fontSize * 0.75);
  ctx.restore();
}

/** The hook line, centered in the upper third and clear of the platform UI. */
function drawHook(ctx, width, height, text) {
  const fontSize = Math.round(Math.min(width, height) * 0.075);
  const font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  ctx.save();
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lines = wrapLines(ctx, text, width * 0.82);
  const lineHeight = fontSize * 1.22;
  let y = height * 0.22 - ((lines.length - 1) * lineHeight) / 2;

  for (const line of lines) {
    ctx.lineWidth = fontSize * 0.16;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineJoin = 'round';
    ctx.strokeText(line, width / 2, y);
    ctx.fillStyle = '#fff';
    ctx.fillText(line, width / 2, y);
    y += lineHeight;
  }
  ctx.restore();
}

function wrapLines(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of text.trim().split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

/**
 * Play one clip while painting its frames (letterboxed) onto the canvas,
 * stopping early at `limitMs` when the shot is longer than the edit needs.
 */
function playThrough(video, ctx, width, height, opts) {
  const { signal, watermark, drawOverlay, limitMs, onClipProgress } = opts;
  return new Promise((resolve, reject) => {
    const vw = video.videoWidth || width;
    const vh = video.videoHeight || height;
    const scale = Math.min(width / vw, height / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    const dx = (width - dw) / 2;
    const dy = (height - dh) / 2;

    let rafId = 0;
    const started = performance.now();

    const finish = (err) => {
      cancelAnimationFrame(rafId);
      video.pause();
      if (signal) signal.removeEventListener('abort', onAbort);
      err ? reject(err) : resolve();
    };
    const onAbort = () => finish(new DOMException('Stitch cancelled', 'AbortError'));
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    const paint = () => {
      if (vw !== width || vh !== height) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(video, dx, dy, dw, dh);
      if (drawOverlay) drawOverlay(ctx);
      if (watermark) drawWatermark(ctx, width, height, watermark);
      const elapsed = performance.now() - started;
      onClipProgress(elapsed);
      if (video.ended || (limitMs && elapsed >= limitMs)) return finish();
      rafId = requestAnimationFrame(paint);
    };

    video.currentTime = 0;
    video
      .play()
      .then(() => {
        rafId = requestAnimationFrame(paint);
      })
      .catch((err) => finish(err));
  });
}
