// The play tiles drawn (ui/home_tiles.ts says what they are): the tile is
// the button, an illustration fills it, and the title and its one line
// sit on a scrim at the foot. Under the row, the join line: a code typed
// or carried in by an invite link, and Join.

import { normalizeJoinCode } from '../game/invite';
import type { PlayMode, PlayTile } from './home_tiles';
import { portraitUrl } from './home_tiles';
import { el } from './menu';

const CSS = `
.tiles { display: grid; grid-template-columns: 1.55fr 1fr 1fr 1fr; gap: 14px;
  height: clamp(300px, 48vh, 440px); max-width: 1180px; }
.tile {
  position: relative; overflow: hidden; border-radius: 14px; border: 1px solid #2b3f60;
  background: #0a1120; padding: 0; text-align: left; cursor: pointer; color: inherit;
  font: inherit; display: block; min-width: 0;
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.55);
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}
.tile:hover, .tile:focus-visible {
  transform: translateY(-4px); border-color: #d8b45a; outline: none;
  box-shadow: 0 26px 60px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(216, 180, 90, 0.35),
    0 0 28px rgba(216, 180, 90, 0.18);
}
.tile.hero { border-color: #8a7433; }
.tile-art { position: absolute; inset: 0; display: grid; grid-auto-flow: column;
  grid-auto-columns: 1fr;
  background: radial-gradient(circle at 50% 38%, #1d3a63 0%, #0a1120 90%); }
.tile-art img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 18%;
  display: block; transition: transform 0.7s ease; }
.tile:hover .tile-art img { transform: scale(1.05); }
.tile-body {
  position: absolute; left: 0; right: 0; bottom: 0; padding: 70px 18px 16px;
  background: linear-gradient(180deg, rgba(4, 7, 16, 0) 0%, rgba(4, 7, 16, 0.82) 48%,
    rgba(4, 7, 16, 0.97) 100%);
}
.tile h3 { font-family: Cinzel, Georgia, serif; font-size: 20px; letter-spacing: 1.8px;
  text-transform: uppercase; margin: 0; color: #e6d7a8; line-height: 1.1; }
.tile p { font-size: 12.5px; line-height: 1.45; color: #b9cbe4; margin: 6px 0 0; max-width: 42ch; }
.tile.hero .tile-body { padding: 90px 24px 22px; }
.tile.hero h3 { font-size: clamp(26px, 2.6vw, 36px); letter-spacing: 3px; }
.tile.hero p { font-size: 13.5px; }
.tile-cta {
  display: inline-block; margin-top: 14px; padding: 9px 22px; border-radius: 6px;
  background: linear-gradient(180deg, #e8cc74 0%, #c9a84a 55%, #a07830 100%);
  border: 1px solid #f0deae; color: #241a08; font-weight: 800; font-size: 14px;
  letter-spacing: 0.5px; text-shadow: 0 1px 0 rgba(255, 255, 255, 0.25);
  transition: box-shadow 0.15s ease;
}
.tile.hero:hover .tile-cta { box-shadow: 0 0 18px rgba(216, 180, 90, 0.45); }

.home-join { display: flex; align-items: center; gap: 10px; margin-top: 14px;
  font-size: 12.5px; color: #8ba1c0; flex-wrap: wrap; }
.home-join .menu-input { width: 120px; margin: 0; padding: 6px 10px; font-size: 13px;
  letter-spacing: 3px; text-transform: uppercase; text-align: center; font-weight: 700; }
.home-join .menu-btn { width: auto; margin: 0; padding: 6px 16px; font-size: 12.5px; }
.home-join.lit { color: #e6d7a8; }
.home-join.lit .menu-input { border-color: #d8b45a; box-shadow: 0 0 12px rgba(216, 180, 90, 0.3); }

/* Narrow: the hero across the top, the three small tiles in one row
   under it, each a portrait; below a phone's width the small tiles keep
   their title and drop the line. */
@media (max-width: 900px) {
  .tiles { grid-template-columns: repeat(3, 1fr); height: auto; gap: 10px; }
  .tile { aspect-ratio: 3 / 4; }
  .tile.hero { grid-column: 1 / -1; aspect-ratio: 16 / 9; }
  .tile.hero .tile-body { padding: 60px 18px 16px; }
  .tile-body { padding: 40px 12px 10px; }
  .tile h3 { font-size: 15px; letter-spacing: 1.2px; }
  .tile p { font-size: 11px; margin-top: 4px; }
  .tile-art img { object-position: 50% 12%; }
}
@media (max-width: 480px) {
  .tile:not(.hero) p { display: none; }
  .tile:not(.hero) h3 { font-size: 13px; }
  .tile.hero h3 { font-size: 24px; }
  .tile.hero p { font-size: 12px; }
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

export function buildPlayTiles(
  tiles: readonly PlayTile[],
  onPick: (mode: PlayMode) => void,
): HTMLElement {
  ensureCss();
  const row = el('div', 'tiles');
  for (const t of tiles) {
    const tile = el('button', t.hero ? 'tile hero' : 'tile');
    tile.type = 'button';
    tile.dataset.mode = t.mode;
    const art = el('div', 'tile-art');
    for (const id of t.art) {
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      img.decoding = 'async';
      // A face that fails to load leaves the gradient, never a broken icon.
      img.addEventListener('error', () => img.remove());
      img.src = portraitUrl(id);
      art.appendChild(img);
    }
    const body = el('div', 'tile-body');
    body.append(el('h3', '', t.title), el('p', '', t.line));
    if (t.cta) body.appendChild(el('span', 'tile-cta', t.cta));
    tile.append(art, body);
    tile.addEventListener('click', () => onPick(t.mode));
    row.appendChild(tile);
  }
  return row;
}

// The join line. A code carried in by an invite link lights it up and
// takes the focus, so Enter is all that is left to press.
export function buildJoinLine(
  prefill: string | undefined,
  onJoin: (code: string) => void,
): HTMLElement {
  ensureCss();
  const line = el('div', 'home-join');
  const label = el('label', '', 'Have a code?');
  const code = el('input', 'menu-input');
  code.id = 'home-join-code';
  label.htmlFor = code.id;
  code.placeholder = 'CODE';
  code.maxLength = 5;
  code.autocomplete = 'off';
  code.spellcheck = false;
  code.setAttribute('autocapitalize', 'characters');
  const join = el('button', 'menu-btn', 'Join');
  join.type = 'button';
  const submit = (): void => {
    const normalized = normalizeJoinCode(code.value);
    if (normalized) onJoin(normalized);
  };
  join.addEventListener('click', submit);
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  if (prefill) {
    code.value = prefill;
    line.classList.add('lit');
    join.classList.add('primary');
    // The line is not in the document yet; focus once it is.
    queueMicrotask(() => code.focus());
  }
  line.append(label, code, join);
  return line;
}
