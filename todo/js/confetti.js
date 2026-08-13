// The completion moment. A checkbox that just disappears a row teaches your
// brain nothing; a small physical burst is the dopamine half of the loop.
// Canvas, no libraries, and it gets out of the way for reduced-motion users.

const COLORS = ['#8b5cf6', '#c4b1ff', '#f0b429', '#4ade80', '#38bdf8', '#f4614f'];

let canvas = null;
let ctx = null;
let particles = [];
let raf = null;

const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.style.cssText =
    'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:100';
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
}

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function spawn(x, y, count, spread) {
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
    const speed = 4 + Math.random() * 7;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 4 + Math.random() * 4,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      life: 1,
      decay: 0.012 + Math.random() * 0.012,
    });
  }
}

function tick() {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  particles = particles.filter((p) => p.life > 0);
  for (const p of particles) {
    p.vy += 0.25; // gravity
    p.vx *= 0.99;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    p.life -= p.decay;
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
    ctx.restore();
  }
  if (particles.length) {
    raf = requestAnimationFrame(tick);
  } else {
    raf = null;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }
}

function run() {
  ensureCanvas();
  resize();
  if (!raf) raf = requestAnimationFrame(tick);
}

/** A small pop at a point — one task done. Pass the checkbox's rect. */
export function burst(x, y) {
  if (reducedMotion()) return;
  run();
  spawn(x, y, 18, Math.PI * 0.9);
  navigator.vibrate?.(10);
}

/** The big one — every pick finished. Rains from the top of the screen. */
export function celebrate() {
  if (reducedMotion()) return;
  run();
  const w = window.innerWidth;
  for (let i = 0; i < 5; i++) {
    spawn(w * (0.15 + 0.175 * i), -10, 24, Math.PI * 1.4);
  }
  navigator.vibrate?.([20, 60, 30]);
}
