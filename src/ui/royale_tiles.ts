// The home's battle royale row (ADR 0031): its two rule sets side by side
// over the 5v5's tiles, Respawn the wider and in gold since it is what Play
// now launches, and the Thornfray (ADR 0035) under them across the row, a
// band rather than a third column, which would have squeezed every name.
// A tile is the button: a view of the Wanderseed's ground behind it,
// fading into the words on the left, the globe from orbit at its right
// (ui/planet_emblem.ts), the name, the line that says the rules
// (ui/royale_modes.ts, ui/bout_text.ts) and the pill. Same frame as the
// play tiles (ui/play_tiles.ts), so the two rows read as one section.
// Respawn's card greets an account that has played before with its level,
// read off the line's points the home's answer carries
// (ui/royale_goal_lines.ts).

import { getSettings } from '../game/settings';
import type { RoyaleVariant } from '../sim/royale/types';
import { THORNFRAY_CALL, THORNFRAY_LINE, THORNFRAY_TITLE } from './bout_text';
import type { HomeLine } from './home_panels';
import { el } from './menu';
import { planetEmblem } from './planet_emblem';
import { type GoalLineView, goalLineView } from './royale_goal_line';
import { type GoalLine, goalWelcome, WELCOME_BACK } from './royale_goal_lines';
import { ROYALE_MODES, royaleArtUrl, viewArt } from './royale_modes';

const CSS = `
.royale-tiles { display: grid; grid-template-columns: 5fr 4fr; gap: 12px; max-width: 1180px;
  margin: 0 0 22px; }
.royale-tile { position: relative; overflow: hidden; display: flex; align-items: center; gap: 18px;
  min-height: 176px; padding: 20px 22px; border-radius: 14px; border: 1px solid #2b3f60;
  text-align: left; cursor: pointer; color: inherit; font: inherit; min-width: 0;
  background:
    radial-gradient(ellipse at 82% 50%, rgba(232, 196, 108, 0.14) 0%, rgba(232, 196, 108, 0) 46%),
    linear-gradient(160deg, #0d1426 0%, #070b16 100%);
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.55);
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease; }
.royale-tile:hover, .royale-tile:focus-visible { transform: translateY(-3px); border-color: #d8b45a;
  outline: none; box-shadow: 0 26px 60px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(216, 180, 90, 0.35),
    0 0 28px rgba(216, 180, 90, 0.18); }
.royale-tile.lead { border-color: #8a7433; }
.royale-tile.one_life { background:
    radial-gradient(ellipse at 82% 50%, rgba(232, 106, 74, 0.14) 0%, rgba(232, 106, 74, 0) 46%),
    linear-gradient(160deg, #120d1c 0%, #08060d 100%); }
.royale-tile.thornfray { grid-column: 1 / -1; min-height: 0; padding: 14px 22px; background:
    radial-gradient(ellipse at 88% 50%, rgba(240, 150, 76, 0.16) 0%, rgba(240, 150, 76, 0) 40%),
    linear-gradient(160deg, #120f1c 0%, #08070d 100%); }
.royale-tile.thornfray::before { background-position: 50% 78%; }
.royale-tile.thornfray .planet-emblem { --planet: 92px; }
.royale-tile.thornfray h3 { font-size: 22px; }
.royale-tile.thornfray p { max-width: 74ch; }
.royale-tile::before { content: ''; position: absolute; inset: 0;
  background: var(--view) 50% 45% / cover no-repeat; opacity: 0.55;
  transition: transform 0.7s ease; }
.royale-tile::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg,
  rgba(6, 10, 20, 0.95) 0%, rgba(6, 10, 20, 0.82) 48%, rgba(6, 10, 20, 0.35) 100%); }
.royale-tile:hover::before { transform: scale(1.05); }
.royale-tile > * { position: relative; z-index: 1; }
.royale-tile-words { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.royale-tile h3 { margin: 0; font-family: Cinzel, Georgia, serif; font-size: 26px;
  letter-spacing: 2.4px; text-transform: uppercase; color: #f0dca0; line-height: 1.05; }
.royale-tile p { margin: 0; font-size: 13px; line-height: 1.5; color: #b9cbe4; max-width: 46ch; }
.royale-tile-cta { align-self: flex-start; margin-top: 6px; padding: 8px 20px; border-radius: 6px;
  border: 1px solid #6b7f9e; color: #dceaff; font-weight: 700; font-size: 13px;
  letter-spacing: 0.5px; background: rgba(10, 17, 32, 0.6); }
.royale-tile.lead .royale-tile-cta { font-weight: 800; color: #241a08; border-color: #f0deae;
  background: linear-gradient(180deg, #e8cc74 0%, #c9a84a 55%, #a07830 100%);
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.25); }
.royale-tile .planet-emblem { --planet: 128px; transition: transform 0.7s ease; }
.royale-tile .goal-line.royale-tile-back { font-size: 13px; }
.royale-tile .goal-line.royale-tile-back.wait { visibility: hidden; }
.royale-tile:hover .planet-emblem { transform: scale(1.06) rotate(-6deg); }
@media (max-width: 900px) {
  .royale-tiles { grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
  .royale-tile { min-height: 0; padding: 14px; gap: 10px; }
  .royale-tile h3 { font-size: 18px; letter-spacing: 1.6px; }
  .royale-tile p { font-size: 11.5px; line-height: 1.4; }
  .royale-tile-cta { padding: 6px 14px; font-size: 12px; }
  .royale-tile .goal-line.royale-tile-back { font-size: 11.5px; }
  .royale-tile .planet-emblem { --planet: 72px; }
  .royale-tile.thornfray { padding: 12px 14px; }
  .royale-tile.thornfray h3 { font-size: 18px; }
  .royale-tile.thornfray .planet-emblem { --planet: 60px; }
}
@media (max-width: 560px) {
  .royale-tiles { grid-template-columns: 1fr; }
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

// What a tile of the row plays: a rule set of the battle royale, or a
// Thornfray.
export type RoyaleWay = RoyaleVariant | 'thornfray';

export interface RoyaleTiles {
  root: HTMLElement;
  // The account's line as the home's answer carries it (ui/home_panels.ts),
  // null when none came: what Respawn's greeting says, or that it goes.
  showLine(line: HomeLine | null): void;
}

// Whether the greeting is said for a line: points or a best on it, or a
// quick pick this browser keeps from a battle royale played here.
function welcomeOf(points: number, best: number): GoalLine | null {
  return goalWelcome({ points, best, picked: getSettings().royalePick !== null });
}

export function buildRoyaleTiles(onPick: (way: RoyaleWay) => void): RoyaleTiles {
  ensureCss();
  const row = el('div', 'royale-tiles');
  // Respawn's greeting, and where it stands in the card.
  let greet: { line: GoalLineView; words: HTMLElement; cta: HTMLElement } | null = null;
  for (const mode of ROYALE_MODES) {
    const lead = mode.variant === 'respawn';
    const tile = el('button', `royale-tile ${mode.variant}${lead ? ' lead' : ''}`);
    tile.type = 'button';
    tile.dataset.royale = mode.variant;
    tile.style.setProperty('--view', `url(${royaleArtUrl(viewArt(mode.variant))})`);
    const words = el('div', 'royale-tile-words');
    // The section's heading says Battle royale over both (ui/home_screen.ts).
    words.append(el('h3', '', mode.title), el('p', '', mode.line));
    const cta = el('span', 'royale-tile-cta', mode.call);
    if (lead) {
      // The browser's copy of the line (game/settings.ts) only holds the
      // greeting's place, unseen, so the card keeps its height when the
      // line's own points come to fill it.
      const line = goalLineView('royale-tile-back wraps wait', WELCOME_BACK);
      greet = { line, words, cta };
      const s = getSettings();
      const cached = welcomeOf(s.royaleGoal, s.royaleBest);
      if (cached) {
        line.draw(cached);
        words.appendChild(line.root);
      }
    }
    words.appendChild(cta);
    tile.append(words, planetEmblem(mode.variant));
    tile.addEventListener('click', () => onPick(mode.variant));
    row.appendChild(tile);
  }
  // The Thornfray, across the row under the two: the daylight ground behind
  // it, its globe in the Dusk with one Thornyard lit.
  const thornfray = el('button', 'royale-tile thornfray');
  thornfray.type = 'button';
  thornfray.dataset.royale = 'thornfray';
  thornfray.style.setProperty('--view', `url(${royaleArtUrl(viewArt('respawn'))})`);
  const tfWords = el('div', 'royale-tile-words');
  tfWords.append(
    el('h3', '', THORNFRAY_TITLE),
    el('p', '', THORNFRAY_LINE),
    el('span', 'royale-tile-cta', THORNFRAY_CALL),
  );
  thornfray.append(tfWords, planetEmblem('thornfray'));
  thornfray.addEventListener('click', () => onPick('thornfray'));
  row.appendChild(thornfray);
  return {
    root: row,
    showLine(line) {
      if (!greet) return;
      const back = line ? welcomeOf(line.points, line.best) : null;
      if (!back) {
        greet.line.root.remove();
        return;
      }
      greet.line.draw(back);
      if (!greet.line.root.isConnected) greet.words.insertBefore(greet.line.root, greet.cta);
      greet.line.root.classList.remove('wait');
    },
  };
}
