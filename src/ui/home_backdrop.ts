// The art behind every pre-game screen: one still image, full bleed, with
// a scrim over it so a card can sit on top and stay readable.
//
// This used to be a cinematic that played once per page load and then held
// on its final frame. The video is gone (it carried a generator watermark)
// and the final frame is now the whole thing, which is no loss worth
// mourning: every path through the old module already ended on this exact
// composition, and the page is 8 MB lighter for it.

const ART = '/art/home_end.jpg';

// The module owns its own styles rather than borrowing menu.ts's sheet:
// the landing page never opens a menu card, so anything living over there
// would simply never be installed.
//
// Fixed, not absolute: on the landing page the backdrop sits inside a
// scrolling container, and absolute would scroll away with the content.
// On the screens that do not scroll, fixed and absolute are the same
// thing, so one rule covers both.
const CSS = `
.menu-backdrop-art { position: fixed; inset: 0; z-index: 0; background: #0a1120; }
.menu-backdrop-art img {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
}
.menu-backdrop-scrim {
  position: absolute; inset: 0;
  background:
    linear-gradient(90deg, rgba(4, 7, 16, 0.78) 0%, rgba(4, 7, 16, 0.42) 42%, transparent 68%),
    linear-gradient(180deg, rgba(4, 7, 16, 0.5) 0%, rgba(4, 7, 16, 0.26) 34%, rgba(4, 7, 16, 0.92) 90%),
    radial-gradient(ellipse at 55% 38%, transparent 34%, rgba(4, 7, 16, 0.5) 100%);
}
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

// Mounts the backdrop into `root`, behind everything already in it.
// Returns a stop() that tears the layer down when the screen resolves.
export function startBackdrop(root: HTMLElement, before?: HTMLElement): () => void {
  ensureCss();
  const layer = document.createElement('div');
  layer.className = 'menu-backdrop-art';
  const img = document.createElement('img');
  img.src = ART;
  // Decorative: the page says what it is in text, so a screen reader has
  // nothing to gain from this.
  img.alt = '';
  layer.appendChild(img);
  const scrim = document.createElement('div');
  scrim.className = 'menu-backdrop-scrim';
  layer.appendChild(scrim);
  if (before) root.insertBefore(layer, before);
  else root.insertBefore(layer, root.firstChild);
  return () => layer.remove();
}

// Preloaded from the entry point so the first screen does not flash its
// background colour before the art arrives.
export function preloadBackdrop(): void {
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'image';
  link.href = ART;
  document.head.appendChild(link);
}
