// The Wanderseed as an emblem (ADR 0031): the small planet the battle
// royale is played on, as its own render shows it from orbit
// (public/art/royale/, ui/royale_modes.ts royaleArtUrl). Respawn wears the
// globe in daylight; One life the same globe fallen into the Dusk. Until
// the picture lands, or if it never does, the stylesheet's drawn planet
// stands in its place, so the emblem is never an empty hole. The landing's
// ways in and its banner (ui/landing.ts), the home's tiles
// (ui/royale_tiles.ts) and the quick pick (ui/royale_pick.ts) all wear it.
// Its size is the --planet custom property, 54px unless the host says.

import type { RoyaleVariant } from '../sim/royale/types';
import { globeArt, royaleArtUrl } from './royale_modes';

const CSS = `
.planet-emblem { --planet: 54px; position: relative; display: block; flex: none;
  width: var(--planet); height: var(--planet); border-radius: 50%;
  background:
    radial-gradient(circle at 34% 30%, #fff6d6 0%, #f0c86a 13%, #b0803a 29%,
      rgba(78, 54, 96, 0.95) 52%, #150d28 74%, #07050f 100%);
  box-shadow: 0 0 calc(var(--planet) * 0.3) rgba(232, 196, 108, 0.34),
    0 0 0 1px rgba(232, 196, 108, 0.18); }
.planet-emblem.one_life {
  background:
    radial-gradient(circle at 40% 36%, #fff3cf 0%, #f2a65a 7%, #a8402e 19%,
      rgba(74, 20, 38, 0.96) 42%, #14060f 74%, #060208 100%);
  box-shadow: 0 0 calc(var(--planet) * 0.3) rgba(232, 106, 74, 0.34),
    0 0 0 1px rgba(232, 106, 74, 0.2); }
.planet-emblem img { position: absolute; inset: 0; width: 100%; height: 100%; display: block;
  border-radius: 50%; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

export function planetEmblem(variant: RoyaleVariant, className = ''): HTMLElement {
  ensureCss();
  const planet = document.createElement('span');
  planet.className = `planet-emblem ${variant}${className ? ` ${className}` : ''}`;
  planet.setAttribute('aria-hidden', 'true');
  const img = document.createElement('img');
  img.alt = '';
  img.decoding = 'async';
  img.draggable = false;
  // A picture that is not there leaves the drawn planet, never a broken icon.
  img.addEventListener('error', () => img.remove());
  img.src = royaleArtUrl(globeArt(variant));
  planet.appendChild(img);
  return planet;
}
