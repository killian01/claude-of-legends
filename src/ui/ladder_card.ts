// The ladder card on the home screen: the account's place by hand in
// large (emblem, tier, rating, rank of the placed or the placement's
// count), one line per other way where the account has rated play, and
// the button to the ladder page. Pure DOM over /api/ladder/mine.

import { nextTier, tierOf } from '../net/tiers';
import { el } from './menu';
import { emblem } from './tier_emblem';

const CSS = `
.lc { display: flex; flex-direction: column; gap: 10px; }
.lc-main { display: flex; align-items: center; gap: 14px; }
.lc-tier { font-family: Cinzel, Georgia, serif; font-size: 19px; letter-spacing: 1.2px; color: #e6d7a8; font-weight: 700; }
.lc-rating { font-size: 13px; color: #b9cbe4; font-variant-numeric: tabular-nums; }
.lc-rating b { color: #f3e6bd; font-size: 15px; }
.lc-rank { font-size: 12.5px; color: #93a8c4; margin-top: 2px; }
.lc-rank b { color: #e6d7a8; }
.lc-ways { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #8ba1c0; }
.lc-way { display: flex; align-items: center; gap: 7px; }
.lc-way b { color: #c9d9ee; font-weight: 600; }
.lc-way span { font-variant-numeric: tabular-nums; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

export interface Place {
  rank: number | null;
  rating: number;
  games: number;
  placed: boolean;
  total: number;
}

export type Places = Record<'hand' | 'bot' | 'arena' | 'forge', Place>;

export const WAY_LABELS: Readonly<Record<keyof Places, string>> = {
  hand: 'By hand',
  bot: 'Bots, live',
  arena: 'Arena',
  forge: 'Forge',
};

export const MIN_RATED_GAMES = 3;

// What the place says of the account, in one line; the way named only
// where the line stands alone.
export function placeLine(p: Place, way?: keyof Places): string {
  if (p.placed && p.rank !== null) {
    return `Rank ${p.rank} of ${p.total}${way ? `, ${WAY_LABELS[way].toLowerCase()}` : ''}`;
  }
  if (p.games > 0) return `Placement: ${p.games} of ${MIN_RATED_GAMES} rated matches`;
  return 'Unplaced: three rated matches place you.';
}

export function buildLadderCard(onOpen: () => void): HTMLElement {
  ensureCss();
  const box = el('div', 'lc');
  const main = el('div', 'lc-main');
  main.append(el('span', 'lc-tier', 'Loading your place...'));
  const ways = el('div', 'lc-ways');
  const open = el('button', 'menu-btn primary', 'Open the ladder');
  open.addEventListener('click', onOpen);
  box.append(main, ways, open);

  fetch('/api/ladder/mine', { credentials: 'same-origin' })
    .then((r) => (r.ok ? (r.json() as Promise<Places>) : null))
    .then((places) => {
      main.textContent = '';
      if (!places) {
        main.append(el('span', 'lc-rank', 'Ladder unavailable: the game server is not reachable.'));
        return;
      }
      const hand = places.hand;
      const tier = tierOf(hand.rating);
      const text = el('div', '');
      const rating = el('div', 'lc-rating');
      rating.append(el('b', '', String(hand.rating)));
      const next = nextTier(hand.rating);
      rating.append(
        document.createTextNode(
          next ? `, ${next.min - hand.rating} to ${next.name}` : ', the top tier',
        ),
      );
      text.append(
        el('div', 'lc-tier', tier.name),
        rating,
        el('div', 'lc-rank', placeLine(hand, 'hand')),
      );
      main.append(emblem(tier, 64), text);
      for (const way of ['bot', 'arena', 'forge'] as const) {
        const p = places[way];
        if (!p || p.games <= 0) continue;
        const line = el('div', 'lc-way');
        line.append(
          emblem(tierOf(p.rating), 18),
          el('b', '', WAY_LABELS[way]),
          el('span', '', `${tierOf(p.rating).name} ${p.rating}, ${placeLine(p).toLowerCase()}`),
        );
        ways.append(line);
      }
    })
    .catch(() => {
      main.textContent = '';
      main.append(el('span', 'lc-rank', 'Ladder unavailable: the game server is not reachable.'));
    });
  return box;
}
