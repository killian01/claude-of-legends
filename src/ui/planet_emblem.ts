// The Wanderseed as an emblem (ADR 0031): the small planet the battle
// royale is played on, drawn in light and shade by the stylesheet alone,
// so it costs no download and is the same planet at every size. Respawn
// wears the lit cap in gold; One life the last point of light in a red
// Dusk. The landing's ways in (ui/landing.ts), the home's tiles
// (ui/royale_tiles.ts) and the quick pick (ui/royale_pick.ts) all wear it.
// Its size is the --planet custom property, 54px unless the host says.

import type { RoyaleVariant } from '../sim/royale/types';

const CSS = `
.planet-emblem { --planet: 54px; position: relative; display: block; flex: none;
  width: var(--planet); height: var(--planet); border-radius: 50%; overflow: hidden;
  background:
    radial-gradient(circle at 34% 30%, #fff6d6 0%, #f0c86a 13%, #b0803a 29%,
      rgba(78, 54, 96, 0.95) 52%, #150d28 74%, #07050f 100%);
  box-shadow: inset calc(var(--planet) * -0.16) calc(var(--planet) * -0.2)
      calc(var(--planet) * 0.33) rgba(0, 0, 0, 0.78),
    0 0 calc(var(--planet) * 0.34) rgba(232, 196, 108, 0.32); }
/* The Dusk's edge: the far side of the planet in shadow. */
.planet-emblem::after { content: ''; position: absolute; inset: 0; border-radius: 50%;
  background: radial-gradient(circle at 74% 80%, rgba(6, 2, 14, 0.66) 0%, rgba(6, 2, 14, 0) 58%); }
/* The light the Dusk leaves: a thin rim where the cap ends. */
.planet-emblem::before { content: ''; position: absolute; inset: 9%; border-radius: 50%;
  border: 1px solid rgba(255, 226, 150, 0.22); border-right-color: transparent;
  border-bottom-color: transparent; transform: rotate(-12deg); }
.planet-emblem.one_life {
  background:
    radial-gradient(circle at 40% 36%, #fff3cf 0%, #f2a65a 7%, #a8402e 19%,
      rgba(74, 20, 38, 0.96) 42%, #14060f 74%, #060208 100%);
  box-shadow: inset calc(var(--planet) * -0.16) calc(var(--planet) * -0.2)
      calc(var(--planet) * 0.33) rgba(0, 0, 0, 0.8),
    0 0 calc(var(--planet) * 0.34) rgba(232, 106, 74, 0.3); }
.planet-emblem.one_life::before { border-color: rgba(255, 170, 130, 0.2);
  border-right-color: transparent; border-bottom-color: transparent; }
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
  return planet;
}
