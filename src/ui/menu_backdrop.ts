// Animated menu backdrop: a slow, cinematic 2D canvas behind the pre-game
// cards (queue, lobby, select, notices). Deep navy base, drifting aurora
// glows, rising embers, and a faint sweeping beam; procedural, no assets,
// cheap enough to run behind a DOM card. The home screen keeps its 3D
// champion showcase instead. Self-stopping: the loop ends on its own when
// the canvas leaves the document, so screens can just root.remove().

interface Ember {
  x: number;
  y: number;
  r: number;
  speed: number;
  sway: number;
  phase: number;
  alpha: number;
}

const EMBERS = 70;

export function startMenuBackdrop(host: HTMLElement): () => void {
  const canvas = document.createElement('canvas');
  canvas.className = 'menu-backdrop-canvas';
  host.appendChild(canvas);
  const g = canvas.getContext('2d');
  if (!g) {
    canvas.remove();
    return () => undefined;
  }

  let w = 0;
  let h = 0;
  const resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = host.clientWidth || window.innerWidth;
    h = host.clientHeight || window.innerHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  const embers: Ember[] = [];
  for (let i = 0; i < EMBERS; i++) {
    embers.push({
      x: Math.random(),
      y: Math.random(),
      r: 0.6 + Math.random() * 1.7,
      speed: 0.008 + Math.random() * 0.02,
      sway: 6 + Math.random() * 18,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.12 + Math.random() * 0.3,
    });
  }

  // Three aurora blobs orbiting slowly; colors in the menu's blue family.
  const blobs = [
    { c: '46, 93, 168', rx: 0.34, ry: 0.3, ox: 0.28, oy: 0.32, s: 0.9, k: 0.000037 },
    { c: '42, 122, 158', rx: 0.3, ry: 0.34, ox: 0.72, oy: 0.62, s: 0.75, k: 0.000029 },
    { c: '84, 70, 160', rx: 0.36, ry: 0.26, ox: 0.5, oy: 0.85, s: 0.8, k: 0.000047 },
  ];

  let stopped = false;
  let raf = 0;
  let frames = 0;
  const frame = (now: number): void => {
    if (stopped) return;
    // The screens tear down with root.remove() and never call back; when
    // the canvas is gone from the document the loop shuts itself off.
    frames += 1;
    if (frames > 2 && !canvas.isConnected) {
      stop();
      return;
    }

    const base = g.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, '#101b30');
    base.addColorStop(0.6, '#0a1120');
    base.addColorStop(1, '#060b16');
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);

    // Aurora glows: additive, drifting on slow Lissajous paths.
    g.globalCompositeOperation = 'lighter';
    for (const b of blobs) {
      const t = now * b.k;
      const cx = (b.ox + Math.sin(t) * 0.09) * w;
      const cy = (b.oy + Math.cos(t * 1.3) * 0.07) * h;
      const r = Math.max(w, h) * b.rx * (1 + 0.08 * Math.sin(t * 2.1));
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, `rgba(${b.c}, ${(0.16 * b.s).toFixed(3)})`);
      grad.addColorStop(1, `rgba(${b.c}, 0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
    }

    // A faint beam sweeping very slowly across the scene.
    const sweep = Math.sin(now * 0.00004) * 0.5 + 0.5;
    const bx = (0.15 + sweep * 0.7) * w;
    const beam = g.createLinearGradient(bx - w * 0.18, 0, bx + w * 0.18, 0);
    beam.addColorStop(0, 'rgba(120, 170, 230, 0)');
    beam.addColorStop(0.5, 'rgba(120, 170, 230, 0.05)');
    beam.addColorStop(1, 'rgba(120, 170, 230, 0)');
    g.fillStyle = beam;
    g.fillRect(0, 0, w, h);

    // Rising embers with a sinusoidal sway, wrapping at the top.
    for (const e of embers) {
      e.y -= e.speed * 0.016 * 60;
      if (e.y < -0.02) {
        e.y = 1.02;
        e.x = Math.random();
      }
      const px = e.x * w + Math.sin(now * 0.0006 + e.phase) * e.sway;
      const py = e.y * h;
      const tw = 0.7 + 0.3 * Math.sin(now * 0.002 + e.phase * 3);
      g.fillStyle = `rgba(150, 195, 245, ${(e.alpha * tw).toFixed(3)})`;
      g.beginPath();
      g.arc(px, py, e.r, 0, Math.PI * 2);
      g.fill();
    }

    // Corner vignette so the card pops against the motion.
    g.globalCompositeOperation = 'source-over';
    const vig = g.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, Math.max(w, h) * 0.75);
    vig.addColorStop(0.55, 'rgba(3, 6, 14, 0)');
    vig.addColorStop(1, 'rgba(3, 6, 14, 0.55)');
    g.fillStyle = vig;
    g.fillRect(0, 0, w, h);

    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    canvas.remove();
  };
  return stop;
}
