// Camera + recording. The wall-clock timestamp (24h HH:MM) is burned into the
// video by piping camera frames through a canvas while recording.

export const MIN_MS = 1000;
export const MAX_MS = 3000;

// Recording modes:
//  vertical            9:16, fills the phone screen
//  horizontal          16:9 framed while holding the phone upright (letterboxed)
//  horizontal-rotated  16:9 recorded while holding the phone sideways
export const MODES = ['vertical', 'horizontal', 'horizontal-rotated'];

const OUTPUT = {
  portrait: { w: 720, h: 1280 },
  landscape: { w: 1280, h: 720 },
};

export const MAX_ZOOM = 5;

export function pageIsLandscape() {
  return window.matchMedia('(orientation: landscape)').matches;
}

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
  const fontSize = Math.max(14, Math.round(Math.min(width, height) * 0.045));
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
    this.mode = 'vertical';
    this.zoom = 1;
    // The HH:MM stamp is a vlog flourish — guided shoots turn it off.
    this.showTimestamp = true;
    // Which way the phone is turned in horizontal-rotated mode:
    // +1 = top of the phone to the left, -1 = top to the right.
    this.rotationDir = 1;
    this._zoomCaps = null;
  }

  get isFrontCamera() {
    return this.facing === 'user';
  }

  /** True when the camera hardware handles zoom (better quality than cropping). */
  get usesNativeZoom() {
    return !!this._zoomCaps;
  }

  /** The crop factor to apply in software when there is no hardware zoom. */
  get digitalZoom() {
    return this.usesNativeZoom ? 1 : this.zoom;
  }

  /**
   * 0 when frames can be used as-is; ±1 when the phone is held sideways while
   * the page itself is still portrait, so frames must be rotated 90°.
   */
  get activeRotation() {
    return this.mode === 'horizontal-rotated' && !pageIsLandscape() ? this.rotationDir : 0;
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

    this._zoomCaps = null;
    const track = this.stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (caps.zoom && typeof caps.zoom.max === 'number' && caps.zoom.max > (caps.zoom.min || 1)) {
      this._zoomCaps = { min: caps.zoom.min || 1, max: caps.zoom.max };
    }
    this._applyNativeZoom();

    await this.videoEl.play().catch(() => {});
  }

  async flip() {
    await this.start(this.isFrontCamera ? 'environment' : 'user');
  }

  /** Clamp and set the zoom level. Returns the applied value. */
  setZoom(z) {
    this.zoom = Math.min(MAX_ZOOM, Math.max(1, z));
    this._applyNativeZoom();
    return this.zoom;
  }

  _applyNativeZoom() {
    if (!this.stream || !this._zoomCaps) return;
    const track = this.stream.getVideoTracks()[0];
    const value = Math.min(this._zoomCaps.max, Math.max(this._zoomCaps.min, this.zoom));
    track.applyConstraints({ advanced: [{ zoom: value }] }).catch(() => {});
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
   * @param {{maxMs?: number}} opts hard cap on clip length (default MAX_MS)
   * @returns {{stop: () => void, done: Promise}}
   */
  record(onTick, opts = {}) {
    if (!this.stream || this.recording) throw new Error('Camera not ready');
    this.recording = true;
    const maxMs = Math.max(MIN_MS, opts.maxMs || MAX_MS);

    const video = this.videoEl;
    const out = this.mode === 'vertical' ? OUTPUT.portrait : OUTPUT.landscape;
    const rot = this.activeRotation;
    const mirror = this.isFrontCamera;

    const canvas = document.createElement('canvas');
    canvas.width = out.w;
    canvas.height = out.h;
    const ctx = canvas.getContext('2d');

    let rafId = 0;
    const paint = () => {
      const vw = video.videoWidth || 1280;
      const vh = video.videoHeight || 720;

      // Center "cover" crop of the source, matching the output aspect —
      // swapped when frames get rotated 90° — then tightened by digital zoom.
      const aw = rot ? out.h : out.w;
      const ah = rot ? out.w : out.h;
      let sw = vw;
      let sh = (vw * ah) / aw;
      if (sh > vh) {
        sh = vh;
        sw = (vh * aw) / ah;
      }
      sw /= this.digitalZoom;
      sh /= this.digitalZoom;
      const sx = (vw - sw) / 2;
      const sy = (vh - sh) / 2;

      ctx.save();
      if (mirror) {
        ctx.translate(out.w, 0);
        ctx.scale(-1, 1);
      }
      if (rot) {
        ctx.translate(out.w / 2, out.h / 2);
        ctx.rotate((-rot * Math.PI) / 2);
        ctx.drawImage(video, sx, sy, sw, sh, -out.h / 2, -out.w / 2, out.h, out.w);
      } else {
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, out.w, out.h);
      }
      ctx.restore();

      if (this.showTimestamp) drawTimestamp(ctx, out.w, out.h, formatClock());
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

    const maxTimer = setTimeout(stop, maxMs);

    const done = new Promise((resolve, reject) => {
      recorder.onerror = (e) => {
        cleanup();
        reject(e.error || new Error('Recording failed'));
      };
      recorder.onstop = () => {
        const duration = Math.min(performance.now() - startedAt, maxMs);
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
