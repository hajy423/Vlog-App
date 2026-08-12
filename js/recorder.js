// Camera + recording. The wall-clock timestamp (24h HH:MM) is burned into the
// video by piping camera frames through a canvas while recording.

export const MIN_MS = 1000;
export const MAX_MS = 4000;

export function formatClock(date = new Date()) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function pickMimeType() {
  const candidates = [
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const type of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

export function extForMime(mime) {
  return mime.includes('mp4') ? 'mp4' : 'webm';
}

/** Draw the centered white HH:MM stamp onto a canvas context. */
export function drawTimestamp(ctx, width, height, text) {
  const fontSize = Math.max(14, Math.round(height * 0.035));
  ctx.save();
  ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = fontSize * 0.5;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.fillText(text, width / 2, height / 2);
  ctx.restore();
}

export class Recorder {
  constructor(videoEl) {
    this.videoEl = videoEl;
    this.stream = null;
    this.facing = 'user';
    this.recording = false;
    this._cleanup = null;
  }

  get isFrontCamera() {
    return this.facing === 'user';
  }

  async start(facing = this.facing) {
    this.stopCamera();
    this.facing = facing;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: facing,
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: true,
    });
    this.videoEl.srcObject = this.stream;
    this.videoEl.classList.toggle('mirrored', this.isFrontCamera);
    await this.videoEl.play().catch(() => {});
  }

  async flip() {
    await this.start(this.isFrontCamera ? 'environment' : 'user');
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.videoEl.srcObject = null;
    }
  }

  /**
   * Record a clip with the timestamp burned in.
   * Resolves with {blob, mime, thumb, duration, createdAt} when recording stops.
   * @param {(elapsedMs: number) => void} onTick progress callback
   * @returns {{stop: () => void, done: Promise}}
   */
  record(onTick) {
    if (!this.stream || this.recording) throw new Error('Camera not ready');
    this.recording = true;

    const video = this.videoEl;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    const mirror = this.isFrontCamera;

    let rafId = 0;
    const paint = () => {
      if (mirror) {
        ctx.save();
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        ctx.restore();
      } else {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
      drawTimestamp(ctx, canvas.width, canvas.height, formatClock());
      rafId = requestAnimationFrame(paint);
    };
    paint();

    const canvasStream = canvas.captureStream(30);
    const tracks = [...canvasStream.getVideoTracks()];
    const audioTrack = this.stream.getAudioTracks()[0];
    if (audioTrack) tracks.push(audioTrack);
    const recStream = new MediaStream(tracks);

    const mime = pickMimeType();
    const recorder = new MediaRecorder(recStream, {
      ...(mime ? { mimeType: mime } : {}),
      videoBitsPerSecond: 2_500_000,
    });

    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };

    const createdAt = Date.now();
    const startedAt = performance.now();
    let thumb = '';

    // Grab a thumbnail shortly after start (first frames can be black).
    const thumbTimer = setTimeout(() => {
      const t = document.createElement('canvas');
      const scale = 240 / canvas.width;
      t.width = 240;
      t.height = Math.round(canvas.height * scale);
      t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
      thumb = t.toDataURL('image/jpeg', 0.7);
    }, 300);

    let stopped = false;
    let tickId = 0;
    const tick = () => {
      onTick(performance.now() - startedAt);
      tickId = requestAnimationFrame(tick);
    };
    tick();

    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(maxTimer);
      cancelAnimationFrame(tickId);
      if (recorder.state !== 'inactive') recorder.stop();
    };

    const maxTimer = setTimeout(stop, MAX_MS);

    const done = new Promise((resolve, reject) => {
      recorder.onerror = (e) => {
        cleanup();
        reject(e.error || new Error('Recording failed'));
      };
      recorder.onstop = () => {
        const duration = Math.min(performance.now() - startedAt, MAX_MS);
        cleanup();
        const blob = new Blob(chunks, { type: mime || 'video/webm' });
        resolve({ blob, mime: blob.type, thumb, duration, createdAt });
      };
    });

    const cleanup = () => {
      this.recording = false;
      clearTimeout(thumbTimer);
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(tickId);
      canvasStream.getTracks().forEach((t) => t.stop());
    };

    recorder.start(250);
    return { stop, done };
  }
}
