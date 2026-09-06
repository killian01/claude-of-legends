// The play tiles drawn (ui/home_tiles.ts says what they are): the tile is
// the button, a painted scene fills it, and the title with its one line
// sit on a scrim at the foot. Under the row, the join line: a code typed
// or carried in by an invite link, and Join.

import { normalizeJoinCode } from '../game/invite';
import type { PlayTile } from './home_tiles';
import { tileArtUrl } from './home_tiles';
import { el } from './menu';

// The row: five scenes side by side, all at the full height of it, in the
// order the tiles are declared. Ranked is the widest because it is the
// hero; the other four share the rest evenly. The private lobby and the
// practice match used to be two small squares stacked in a column on the
// right, which made them read as leftovers rather than as two of the five
// ways into a match: a mode is either offered or it is not, and a stacked
// half-height square offers it half-heartedly. Upright is also the shape
// these paintings are composed in, so the crop stops throwing most of
// them away.
const CSS = `
.tiles { display: grid; grid-template-columns: 4fr repeat(4, 3fr); grid-template-rows: 1fr;
  gap: 12px; height: clamp(320px, 50vh, 460px); max-width: 1180px; }
.tile {
  position: relative; overflow: hidden; border-radius: 14px; border: 1px solid #2b3f60;
  padding: 0; text-align: left; cursor: pointer; color: inherit; font: inherit;
  display: block; min-width: 0; background: #0a1120;
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.55);
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}
.tile:hover, .tile:focus-visible {
  transform: translateY(-4px); border-color: #d8b45a; outline: none;
  box-shadow: 0 26px 60px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(216, 180, 90, 0.35),
    0 0 28px rgba(216, 180, 90, 0.18);
}
.tile.hero { border-color: #8a7433; }
/* The wash is the tile's own color, and the whole tile when the painting
   is missing. */
.tile-art { position: absolute; inset: 0; }
.tile-art img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 32%;
  display: block; transition: transform 0.7s ease; }
.tile:hover .tile-art img { transform: scale(1.05); }
.tile-body {
  position: absolute; left: 0; right: 0; bottom: 0; padding: 60px 18px 16px;
  background: linear-gradient(180deg, rgba(4, 7, 16, 0) 0%, rgba(4, 7, 16, 0.8) 46%,
    rgba(4, 7, 16, 0.96) 100%);
}
.tile h3 { font-family: Cinzel, Georgia, serif; font-size: 17px; letter-spacing: 1.6px;
  text-transform: uppercase; margin: 0; color: #e6d7a8; line-height: 1.1; }
.tile p { font-size: 12px; line-height: 1.45; color: #b9cbe4; margin: 5px 0 0; max-width: 46ch; }
.tile.hero .tile-body { padding: 90px 24px 22px; }
.tile.hero h3 { font-size: clamp(26px, 2.6vw, 36px); letter-spacing: 3px; }
.tile.hero p { font-size: 13.5px; }
/* A tall tile reads top to bottom the way the hero does, one step down in
   size: the same foot scrim, deeper than a small tile's because a line and
   a button stand under the title. */
.tile.tall .tile-body { padding: 74px 16px 16px; }
.tile.tall h3 { font-size: 19px; letter-spacing: 2.2px; }
.tile.tall p { font-size: 12px; }
.tile.tall .tile-cta { margin-top: 10px; padding: 7px 16px; font-size: 12.5px; }
/* Both tall paintings carry their subject high, so a portrait crop keeps
   it clear of the foot scrim. */
.tile.tall .tile-art img { object-position: 50% 26%; }
.tile-cta {
  display: inline-block; margin-top: 12px; padding: 7px 18px; border-radius: 6px;
  border: 1px solid #6b7f9e; color: #dceaff; font-weight: 700; font-size: 12.5px;
  letter-spacing: 0.5px; background: rgba(10, 17, 32, 0.6);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.tile:hover .tile-cta { border-color: #9fb8dc; }
.tile.hero .tile-cta {
  margin-top: 14px; padding: 9px 22px; font-size: 14px; font-weight: 800;
  background: linear-gradient(180deg, #e8cc74 0%, #c9a84a 55%, #a07830 100%);
  border-color: #f0deae; color: #241a08; text-shadow: 0 1px 0 rgba(255, 255, 255, 0.25);
}
.tile.hero:hover .tile-cta { box-shadow: 0 0 18px rgba(216, 180, 90, 0.45); }

.home-join { display: flex; align-items: center; gap: 10px; margin-top: 14px;
  font-size: 12.5px; color: #8ba1c0; flex-wrap: wrap; }
.home-join .menu-input { width: 120px; margin: 0; padding: 6px 10px; font-size: 13px;
  letter-spacing: 3px; text-transform: uppercase; text-align: center; font-weight: 700; }
.home-join .menu-btn { width: auto; margin: 0; padding: 6px 16px; font-size: 12.5px; }
.home-join.lit { color: #e6d7a8; }
.home-join.lit .menu-input { border-color: #d8b45a; box-shadow: 0 0 12px rgba(216, 180, 90, 0.3); }

/* Narrow: the row unstacks two at a time, the hero across the top and the
   other four in pairs under it, which is the same reading order. They
   keep their upright shape, taller than wide, so a title, a line and a
   button all hold at a phone's width without clipping any of them. */
@media (max-width: 900px) {
  .tiles { grid-template-columns: repeat(2, 1fr); grid-template-rows: auto; height: auto; gap: 10px; }
  .tile.t-ranked { grid-column: 1 / 3; aspect-ratio: 16 / 9; }
  .tile.tall { aspect-ratio: 3 / 4; }
  .tile.hero .tile-body { padding: 60px 18px 16px; }
  .tile-body { padding: 40px 12px 10px; }
  .tile h3 { font-size: 14px; letter-spacing: 1.2px; }
  .tile p { font-size: 11px; margin-top: 4px; }
  .tile.tall .tile-body { padding: 56px 12px 12px; }
  .tile.tall h3 { font-size: 15px; letter-spacing: 1.6px; }
}
@media (max-width: 480px) {
  .tile.tall p { font-size: 10.5px; }
  .tile.tall .tile-cta { margin-top: 8px; padding: 6px 12px; font-size: 11px; }
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
  onPick: (tile: PlayTile) => void,
): HTMLElement {
  ensureCss();
  const row = el('div', 'tiles');
  for (const t of tiles) {
    const tile = el('button', `tile t-${t.id}${t.hero ? ' hero' : ''}${t.tall ? ' tall' : ''}`);
    tile.type = 'button';
    tile.dataset.tile = t.id;
    const art = el('div', 'tile-art');
    art.style.background = `radial-gradient(ellipse at 50% 34%, ${t.accent}55 0%, #0a1120 78%)`;
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    // A painting that is not there yet leaves the wash, never a broken icon.
    img.addEventListener('error', () => img.remove());
    img.src = tileArtUrl(t.art);
    art.appendChild(img);
    const body = el('div', 'tile-body');
    body.append(el('h3', '', t.title), el('p', '', t.line));
    if (t.cta) body.appendChild(el('span', 'tile-cta', t.cta));
    tile.append(art, body);
    tile.addEventListener('click', () => onPick(t));
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
