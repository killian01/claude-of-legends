// The Wanderseed as an emblem (ADR 0031): the small planet the battle
// royale is played on, as its own render shows it from orbit
// (public/art/royale/, ui/royale_modes.ts royaleArtUrl). Respawn wears the
// globe in daylight; One life the same globe fallen into the Dusk. A
// Thornfray (ADR 0035) wears the globe in the Dusk with one Thornyard
// still lit: the daylight globe inside a cap, its rim burning where the
// Dusk begins and its next closing a thin gold ring inside, as the Lull's
// globe shows a bout's Thornyard. Until the pictures land, or if they never
// do, the stylesheet's drawn planet stands in their place (and the rings
// over it), so the emblem is never an empty hole. The landing's ways in and
// its banner (ui/landing.ts), the home's tiles (ui/royale_tiles.ts), the
// quick pick (ui/royale_pick.ts) and the gathering (ui/thornfray_gather.ts)
// all wear it. Its size is the --planet custom property, 54px unless the
// host says.

import type { RoyaleVariant } from '../sim/royale/types';
import { globeArt, type RoyaleArt, royaleArtUrl } from './royale_modes';

// What an emblem stands for: a rule set of the battle royale, or a
// Thornfray.
export type PlanetEmblemKind = RoyaleVariant | 'thornfray';

// The Thornyard on the Thornfray's globe, in parts of the emblem's width:
// its heart on the round plaza of the globe's picture, below and left of
// the middle, as a bout's Thornyard stands around a region's heart, and
// its radius.
export const THORNYARD_EMBLEM = { x: 0.4, y: 0.62, r: 0.27 } as const;
// The next closing's ring inside it, in parts of the Thornyard's radius.
export const THORNYARD_EMBLEM_CLOSE = 0.45;

const pct = (n: number): string => `${Math.round(n * 1000) / 10}%`;
const YARD = THORNYARD_EMBLEM;
const CLOSE_R = YARD.r * THORNYARD_EMBLEM_CLOSE;

const CSS = `
.planet-emblem { --planet: 54px; position: relative; display: block; flex: none;
  width: var(--planet); height: var(--planet); border-radius: 50%;
  background:
    radial-gradient(circle at 34% 30%, #fff6d6 0%, #f0c86a 13%, #b0803a 29%,
      rgba(78, 54, 96, 0.95) 52%, #150d28 74%, #07050f 100%);
  box-shadow: 0 0 calc(var(--planet) * 0.3) rgba(232, 196, 108, 0.34),
    0 0 0 1px rgba(232, 196, 108, 0.18); }
.planet-emblem.one_life, .planet-emblem.thornfray {
  background:
    radial-gradient(circle at 40% 36%, #fff3cf 0%, #f2a65a 7%, #a8402e 19%,
      rgba(74, 20, 38, 0.96) 42%, #14060f 74%, #060208 100%);
  box-shadow: 0 0 calc(var(--planet) * 0.3) rgba(232, 106, 74, 0.34),
    0 0 0 1px rgba(232, 106, 74, 0.2); }
.planet-emblem.thornfray {
  box-shadow: 0 0 calc(var(--planet) * 0.3) rgba(240, 150, 76, 0.36),
    0 0 0 1px rgba(240, 150, 76, 0.24); }
.planet-emblem img { position: absolute; inset: 0; width: 100%; height: 100%; display: block;
  border-radius: 50%; }
.planet-emblem .pe-yard { clip-path: circle(${pct(YARD.r)} at ${pct(YARD.x)} ${pct(YARD.y)}); }
.planet-emblem .pe-rim, .planet-emblem .pe-close { position: absolute; border-radius: 50%;
  box-sizing: border-box; pointer-events: none; }
.planet-emblem .pe-rim { left: ${pct(YARD.x - YARD.r)}; top: ${pct(YARD.y - YARD.r)};
  width: ${pct(2 * YARD.r)}; height: ${pct(2 * YARD.r)};
  border: max(1.5px, calc(var(--planet) * 0.03)) solid #f6b25e;
  box-shadow: 0 0 calc(var(--planet) * 0.09) rgba(246, 140, 64, 0.95),
    inset 0 0 calc(var(--planet) * 0.07) rgba(246, 140, 64, 0.7); }
.planet-emblem .pe-close { left: ${pct(YARD.x - CLOSE_R)}; top: ${pct(YARD.y - CLOSE_R)};
  width: ${pct(2 * CLOSE_R)}; height: ${pct(2 * CLOSE_R)};
  border: max(1px, calc(var(--planet) * 0.012)) solid rgba(246, 222, 120, 0.9); }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

// The pictures an emblem stacks, the bottom first: a Thornfray's globe in
// the Dusk, then the daylight globe its Thornyard cuts out of it.
export function emblemArt(kind: PlanetEmblemKind): RoyaleArt[] {
  return kind === 'thornfray' ? ['globe_dusk', 'globe'] : [globeArt(kind)];
}

function picture(art: RoyaleArt, className: string): HTMLImageElement {
  const img = document.createElement('img');
  img.alt = '';
  img.decoding = 'async';
  img.draggable = false;
  if (className) img.className = className;
  // A picture that is not there leaves the drawn planet, never a broken icon.
  img.addEventListener('error', () => img.remove());
  img.src = royaleArtUrl(art);
  return img;
}

function ring(className: string): HTMLElement {
  const span = document.createElement('span');
  span.className = className;
  return span;
}

export function planetEmblem(kind: PlanetEmblemKind, className = ''): HTMLElement {
  ensureCss();
  const planet = document.createElement('span');
  planet.className = `planet-emblem ${kind}${className ? ` ${className}` : ''}`;
  planet.setAttribute('aria-hidden', 'true');
  const art = emblemArt(kind);
  art.forEach((a, i) => {
    planet.appendChild(picture(a, kind === 'thornfray' && i === 1 ? 'pe-yard' : ''));
  });
  if (kind === 'thornfray') planet.append(ring('pe-rim'), ring('pe-close'));
  return planet;
}
