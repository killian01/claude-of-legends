// The battle royale's quick pick (ADR 0031): one card over the painted
// backdrop, the ten champions of the roster on the left, the one chosen on
// the right with its skins and the two sigils, Random, and the big Play.
// No lanes, no bans, no clock, and nothing taken: duplicates are allowed.
// It opens on the pick last played (ui/royale_pick_rules.ts decides, the
// host remembers it); Back, Escape or the browser's Back leave it with no
// pick. The champion select's own pieces (ui/menu.ts) dress it, so the two
// read as one game.

import { preloadChampionAssets } from '../render/champions';
import { CHAMPION_LIST, CHAMPIONS } from '../sim/content/champions';
import { SIGIL_LIST } from '../sim/content/sigils';
import { SKINS } from '../sim/content/skins';
import type { RoyaleVariant } from '../sim/royale/types';
import { ROLE_COLORS, setPortrait } from './champion_art';
import { describeSigil } from './describe';
import { el, screen } from './menu';
import { planetEmblem } from './planet_emblem';
import { ROYALE_LABEL, royaleMode } from './royale_modes';
import {
  pickReady,
  type RoyalePick,
  randomChampion,
  toggleSigil,
  withChampion,
} from './royale_pick_rules';
import { attachTooltip, hideTooltip } from './tooltips';

const CSS = `
.menu-card.br-pick { width: min(1160px, 96vw); max-height: 96vh; padding: 20px 24px 22px;
  display: flex; flex-direction: column; }
.br-pick-head { display: flex; align-items: center; gap: 14px; margin: 0 0 14px; }
.br-pick-head .planet-emblem { --planet: 46px; }
.br-pick-head small { display: block; font-size: 10.5px; font-weight: 800; letter-spacing: 1.6px;
  text-transform: uppercase; color: #c9a84a; }
.br-pick-head .menu-title { margin: 1px 0 2px; }
.br-pick-head p { margin: 0; font-size: 12.5px; line-height: 1.45; color: #a9b9cf; max-width: 70ch; }
.br-pick-body { display: flex; gap: 20px; align-items: stretch; min-height: 0; flex: 1; }
.br-pick-grid { flex: 1; min-width: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px; align-content: start; }
.br-pick-grid .menu-champ { aspect-ratio: 3 / 4; }
.br-pick-side { width: 290px; flex: none; display: flex; flex-direction: column; min-height: 0; }
.br-pick-name { font-family: Cinzel, Georgia, serif; font-size: 22px; font-weight: 700;
  letter-spacing: 1.6px; color: #f0dca0; text-transform: uppercase; line-height: 1.1; }
.br-pick-role { font-size: 11px; font-weight: 800; letter-spacing: 1px; margin-top: 2px; }
.br-pick-blurb { font-size: 12px; line-height: 1.45; color: #a9b9cf; margin: 6px 0 2px; }
.br-pick-side .menu-sigils { flex-wrap: wrap; }
.br-pick-side .menu-sigil { flex: 1 1 40%; }
.br-pick-actions { margin-top: auto; padding-top: 10px; display: flex; flex-direction: column; gap: 0; }
.br-pick-actions .menu-btn { min-height: 44px; }
.br-pick-play.menu-btn.primary { padding: 14px 10px; font-size: 16px; letter-spacing: 1.4px;
  text-transform: uppercase; }
.br-pick-row { display: flex; gap: 8px; }
.br-pick-row .menu-btn { flex: 1; }
@media (max-width: 900px) {
  .br-pick-body { flex-direction: column; }
  .br-pick-side { width: 100%; }
  .br-pick-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
}
@media (max-width: 560px) {
  .br-pick-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
/* A phone held sideways (844x390): the head is one line, the cards sit
   in two rows of five on the left, the rail beside them with Play pinned
   to its foot, nothing to scroll for. */
@media (orientation: landscape) and (max-height: 500px) {
  .menu-card.br-pick { height: 96vh; padding: 8px 12px 10px; overflow: hidden; }
  .br-pick-head { margin: 0 0 6px; gap: 10px; }
  .br-pick-head .planet-emblem { --planet: 26px; }
  .br-pick-head .menu-title { font-size: 16px; margin: 0; }
  .br-pick-head small, .br-pick-head p { display: none; }
  .br-pick-body { flex-direction: row; gap: 10px; }
  .br-pick-grid { gap: 5px; grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .br-pick-grid .menu-champ { aspect-ratio: auto; height: calc((96vh - 66px) / 2); }
  .br-pick-grid .menu-champ-body { padding: 14px 5px 4px; }
  .br-pick-grid .menu-champ-name { font-size: 11px; }
  .br-pick-grid .menu-champ-role { font-size: 9px; }
  .br-pick-grid .menu-champ-blurb { display: none; }
  .br-pick-side { width: 236px; overflow-y: auto; }
  .br-pick-name { font-size: 15px; }
  .br-pick-blurb { display: none; }
  .br-pick-side .menu-label { margin: 4px 0 2px; }
  .br-pick-side .menu-skins, .br-pick-side .menu-sigils { margin: 2px 0 2px; gap: 4px; }
  .br-pick-side .menu-skin { padding: 4px 7px 4px 22px; font-size: 10px; }
  .br-pick-side .menu-sigil { padding: 5px 2px; font-size: 10px; min-height: 30px; }
  .br-pick-actions { padding-top: 4px; }
  .br-pick-actions .menu-btn { margin-top: 4px; padding: 6px; font-size: 12px; }
  .br-pick-play.menu-btn.primary { padding: 8px 6px; font-size: 14px; }
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

export interface RoyalePickOptions {
  variant: RoyaleVariant;
  initial: RoyalePick;
  onPlay: (pick: RoyalePick) => void;
  onBack: () => void;
}

export interface RoyalePickController {
  remove(): void;
}

// The tint the portraits are drawn on: nobody's team, the card's gold.
const TINT = 0x6b5a2e;

export function showRoyalePick(
  container: HTMLElement,
  opts: RoyalePickOptions,
): RoyalePickController {
  ensureCss();
  // The models download while the person picks, as at champion select.
  preloadChampionAssets();
  const { root, card } = screen(container);
  card.classList.add('br-pick');
  let pick: RoyalePick = { ...opts.initial, sigils: [...opts.initial.sigils] };
  let sigils: string[] = [...pick.sigils];

  const mode = royaleMode(opts.variant);
  const head = el('div', 'br-pick-head');
  const words = el('div', '');
  words.append(
    el('small', '', ROYALE_LABEL),
    el('h1', 'menu-title', mode.title),
    el('p', '', mode.line),
  );
  head.append(planetEmblem(opts.variant), words);

  const grid = el('div', 'br-pick-grid');
  const cards = new Map<string, HTMLButtonElement>();
  for (const c of CHAMPION_LIST) {
    const btn = el('button', 'menu-champ') as HTMLButtonElement;
    btn.type = 'button';
    btn.dataset.champion = c.id;
    const portrait = el('img', 'menu-champ-portrait');
    portrait.alt = '';
    setPortrait(portrait, c.id, TINT);
    const body = el('div', 'menu-champ-body');
    const role = el('div', 'menu-champ-role', c.role);
    role.style.color = ROLE_COLORS[c.role] ?? '#c9d8ae';
    body.append(el('div', 'menu-champ-name', c.name.split(',')[0] ?? c.name), role);
    btn.append(portrait, body);
    btn.addEventListener('click', () => {
      pick = withChampion(pick, c.id);
      render();
    });
    cards.set(c.id, btn);
    grid.appendChild(btn);
  }

  const side = el('div', 'br-pick-side');
  const name = el('div', 'br-pick-name');
  const roleLine = el('div', 'br-pick-role');
  const blurb = el('div', 'br-pick-blurb');
  const skinRow = el('div', 'menu-skins');
  const sigilRow = el('div', 'menu-sigils');
  const sigilButtons = new Map<string, HTMLButtonElement>();
  for (const s of SIGIL_LIST) {
    const btn = el('button', 'menu-sigil', s.name) as HTMLButtonElement;
    btn.type = 'button';
    attachTooltip(btn, () => describeSigil(s));
    btn.addEventListener('click', () => {
      sigils = toggleSigil(sigils, s.id);
      render();
    });
    sigilButtons.set(s.id, btn);
    sigilRow.appendChild(btn);
  }
  const random = el('button', 'menu-btn', 'Random') as HTMLButtonElement;
  random.type = 'button';
  random.addEventListener('click', () => {
    const ids = CHAMPION_LIST.map((c) => c.id);
    pick = withChampion(pick, randomChampion(ids, pick.championId, Math.random()));
    render();
  });
  const back = el('button', 'menu-btn', 'Back') as HTMLButtonElement;
  back.type = 'button';
  const play = el('button', 'menu-btn primary br-pick-play', 'Play') as HTMLButtonElement;
  play.type = 'button';
  const row = el('div', 'br-pick-row');
  row.append(random, back);
  const actions = el('div', 'br-pick-actions');
  actions.append(play, row);
  side.append(
    name,
    roleLine,
    blurb,
    el('div', 'menu-label', 'Skin'),
    skinRow,
    el('div', 'menu-label', 'Sigils, two'),
    sigilRow,
    actions,
  );

  const body = el('div', 'br-pick-body');
  body.append(grid, side);
  card.append(head, body);

  function render(): void {
    const def = CHAMPIONS[pick.championId];
    for (const [id, b] of cards) b.classList.toggle('picked', id === pick.championId);
    name.textContent = def ? (def.name.split(',')[0] ?? def.name) : pick.championId;
    roleLine.textContent = def?.role ?? '';
    roleLine.style.color = def ? (ROLE_COLORS[def.role] ?? '#c9d8ae') : '';
    blurb.textContent = def?.blurb ?? '';
    skinRow.textContent = '';
    for (const [i, s] of (SKINS[pick.championId] ?? []).entries()) {
      const btn = el('button', 'menu-skin', s.name) as HTMLButtonElement;
      btn.type = 'button';
      btn.classList.toggle('picked', i === pick.skin);
      const swatch = el('span', 'menu-skin-swatch');
      const bodyColor = s.body === null ? '#b8963f' : `#${s.body.toString(16).padStart(6, '0')}`;
      const accent = `#${s.accent.toString(16).padStart(6, '0')}`;
      swatch.style.background = `linear-gradient(135deg, ${bodyColor} 55%, ${accent} 55%)`;
      btn.appendChild(swatch);
      btn.addEventListener('click', () => {
        pick = { ...pick, skin: i };
        render();
      });
      skinRow.appendChild(btn);
    }
    for (const [id, b] of sigilButtons) b.classList.toggle('picked', sigils.includes(id));
    play.disabled = !pickReady(sigils);
  }
  render();

  let gone = false;
  const remove = (): void => {
    if (gone) return;
    gone = true;
    hideTooltip();
    window.removeEventListener('keydown', onKey);
    root.remove();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      opts.onBack();
    } else if (e.key === 'Enter' && !play.disabled) {
      e.preventDefault();
      play.click();
    }
  };
  window.addEventListener('keydown', onKey);
  back.addEventListener('click', () => opts.onBack());
  play.addEventListener('click', () => {
    if (!pickReady(sigils)) return;
    opts.onPlay({ ...pick, sigils: [sigils[0]!, sigils[1]!] });
  });
  return { remove };
}

// The moment between Play and the planet: the server finds a battle royale
// that takes people, or starts one (ADR 0025's drop in), and the drop
// begins with the first snapshot. One card, the same dress, a way out.
const JOIN_CSS = `
.menu-card.br-join { width: min(440px, 92vw); text-align: center; }
.br-join .planet-emblem { --planet: 64px; margin: 2px auto 12px;
  animation: br-join-turn 6s linear infinite; }
@keyframes br-join-turn { to { transform: rotate(360deg); } }
.br-join .menu-progress i { width: 40%; animation: br-join-sweep 1.4s ease-in-out infinite alternate; }
@keyframes br-join-sweep { from { margin-left: 0; } to { margin-left: 60%; } }
.menu.br-join-over { z-index: 45; }
@media (prefers-reduced-motion: reduce) {
  .br-join .planet-emblem, .br-join .menu-progress i { animation: none; }
}
`;

let joinCssInstalled = false;

// The joining card, which can also stay over the match it found until the
// match's first frame is drawn (game/first_frame.ts).
export interface RoyaleJoiningController extends RoyalePickController {
  // The match is built under the card: the card rises over the match's
  // HUD, its pause menu and end screen included, until it is removed.
  overMatch(): void;
}

export function showRoyaleJoining(
  container: HTMLElement,
  variant: RoyaleVariant,
  onCancel: () => void,
): RoyaleJoiningController {
  if (!joinCssInstalled) {
    joinCssInstalled = true;
    const style = document.createElement('style');
    style.textContent = JOIN_CSS;
    document.head.appendChild(style);
  }
  const { root, card } = screen(container);
  card.classList.add('br-join');
  const bar = el('div', 'menu-progress');
  bar.appendChild(el('i', ''));
  const cancel = el('button', 'menu-btn', 'Cancel') as HTMLButtonElement;
  cancel.type = 'button';
  cancel.addEventListener('click', onCancel);
  card.append(
    planetEmblem(variant),
    el('h1', 'menu-title', royaleMode(variant).title),
    el('p', 'menu-sub', 'Finding fifty seats on the planet, bots in the empty ones.'),
    bar,
    cancel,
  );
  return {
    remove: () => root.remove(),
    overMatch: () => root.classList.add('br-join-over'),
  };
}
