// Embers over the landing: a few dozen motes of gold that drift up the
// page behind the cards, the one thing on the front door that moves
// before anyone touches it. The whole effect is CSS; this module only
// decides where each ember starts and how it travels, and it decides that
// deterministically, so the layout is the same on every load and a test
// can read it without a browser. Not sim code, so Math.random would be
// allowed; it is avoided anyway because a page that looks different every
// reload is harder to reason about in a screenshot diff.

export interface EmberSpec {
  // Where it starts, as a fraction of the page width.
  x: number;
  // Diameter in CSS pixels.
  size: number;
  // Seconds before the first pass, and seconds one pass takes.
  delay: number;
  duration: number;
  // Sideways travel over one pass, in CSS pixels, either direction.
  drift: number;
  // Peak opacity: the small ones are fainter, as far things are.
  opacity: number;
}

// The golden angle spreads points evenly with no two in a column, which
// is what makes a deterministic scatter read as a scatter. The other
// dimensions ride on a second and third irrational stride so they do not
// line up with the first.
const PHI = 0.618033988749895;
const STRIDE_B = 0.414213562373095;
const STRIDE_C = 0.732050807568877;
const frac = (v: number): number => v - Math.floor(v);

export function emberSpecs(count: number): EmberSpec[] {
  const out: EmberSpec[] = [];
  for (let i = 0; i < count; i++) {
    const a = frac(0.37 + i * PHI);
    const b = frac(0.11 + i * STRIDE_B);
    const c = frac(0.59 + i * STRIDE_C);
    const size = 2 + Math.round(b * 4 * 10) / 10;
    out.push({
      x: Math.round(a * 1000) / 10,
      size,
      delay: Math.round(c * 180) / 10,
      duration: Math.round((14 + b * 12) * 10) / 10,
      drift: Math.round((c - 0.5) * 160),
      opacity: Math.round((0.35 + (size - 2) * 0.14) * 100) / 100,
    });
  }
  return out;
}

const CSS = `
.land-embers { position: fixed; inset: 0; z-index: 1; overflow: hidden; pointer-events: none; }
.land-ember { position: absolute; bottom: -12px; left: var(--x); width: var(--s); height: var(--s);
  border-radius: 50%; opacity: 0; will-change: transform, opacity;
  background: radial-gradient(circle, #fff3c4 0%, #f0b95a 40%, rgba(240, 185, 90, 0) 72%);
  box-shadow: 0 0 6px rgba(240, 185, 90, 0.7);
  animation: land-ember var(--d) linear var(--delay) infinite; }
@keyframes land-ember {
  0% { transform: translate3d(0, 0, 0) scale(1); opacity: 0; }
  8% { opacity: var(--o); }
  85% { opacity: var(--o); }
  100% { transform: translate3d(var(--dx), -105vh, 0) scale(0.35); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) { .land-embers { display: none; } }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

// Mounts the layer into `root` just after the backdrop, so it sits over
// the art and under the page. Returns the teardown.
export function mountEmbers(root: HTMLElement, count = 28): () => void {
  ensureCss();
  const layer = document.createElement('div');
  layer.className = 'land-embers';
  layer.setAttribute('aria-hidden', 'true');
  for (const s of emberSpecs(count)) {
    const e = document.createElement('span');
    e.className = 'land-ember';
    e.style.setProperty('--x', `${s.x}%`);
    e.style.setProperty('--s', `${s.size}px`);
    e.style.setProperty('--delay', `${s.delay}s`);
    e.style.setProperty('--d', `${s.duration}s`);
    e.style.setProperty('--dx', `${s.drift}px`);
    e.style.setProperty('--o', String(s.opacity));
    layer.appendChild(e);
  }
  const backdrop = root.querySelector('.menu-backdrop-art');
  if (backdrop?.nextSibling) root.insertBefore(layer, backdrop.nextSibling);
  else root.appendChild(layer);
  return () => layer.remove();
}
