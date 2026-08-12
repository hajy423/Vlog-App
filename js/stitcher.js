// Stitches clips into one video by replaying them in order onto a canvas
// and re-recording the canvas + audio. Pure browser APIs, no dependencies.
// Runs in real time, which stays quick because every clip is 1–3 seconds.

import { pickMimeType } from './recorder.js';

/**
 * @param {Array<{blob: Blob, duration: number}>} clips oldest-first
 * @param {(fraction: number, label: string) => void} onProgress
 * @param {{signal?: AbortSignal}} opts
 * @returns {Promise<{blob: Blob, mime: string}>}
 */
export async function stitchClips(clips, onProgress, opts = {}) {
  const { signal } = opts;
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

    const totalMs = clips.reduce((sum, c) => sum + (c.duration || 2000), 0);
    let elapsedBefore = 0;

    for (let i = 0; i < videos.length; i++) {
      throwIfAborted();
      const v = videos[i];
      onProgress(elapsedBefore / totalMs, `Clip ${i + 1} of ${videos.length}`);
      await playThrough(v, ctx, width, height, signal, (clipMs) => {
        onProgress(
          Math.min(1, (elapsedBefore + clipMs) / totalMs),
          `Clip ${i + 1} of ${videos.length}`
        );
      });
      elapsedBefore += clips[i].duration || v.duration * 1000 || 2000;
    }

    onProgress(1, 'Finalizing…');
    recorder.stop();
    const blob = await recorded;
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

function waitForMetadata(video, signal) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1 && (video.videoWidth || video.duration)) return resolve();
    const onAbort = () => reject(new DOMException('Stitch cancelled', 'AbortError'));
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error('Could not load a clip')), { once: true });
  });
}

/** Play one clip to the end while painting its frames (letterboxed) onto the canvas. */
function playThrough(video, ctx, width, height, signal, onClipProgress) {
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
      onClipProgress(performance.now() - started);
      if (video.ended) return finish();
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
