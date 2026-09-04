// The home's bar (CONTEXT.md: Home) filled in: the sections that are
// pages of their own, Live with the count of matches running, and at the
// right the account's own block, its place by hand beside its name, which
// opens the account drawer. Pure DOM over /api/ladder/mine for the place.

import { tierOf } from '../net/tiers';
import type { Places } from './ladder_card';
import { el } from './menu';
import type { Bar } from './page';
import { emblem } from './tier_emblem';

const CSS = `
.pg-bar-live { display: inline-flex; align-items: center; gap: 7px; }
.pg-bar-live i { width: 7px; height: 7px; border-radius: 50%; background: #3b4d66;
  display: inline-block; transition: background 0.2s ease; }
.pg-bar-live.on i { background: #6ad07a; box-shadow: 0 0 8px #6ad07a; }
.pg-bar-live b { color: #c9d9ee; font-variant-numeric: tabular-nums; }
.pg-bar .pg-account {
  display: inline-flex; align-items: center; gap: 10px; text-transform: none; letter-spacing: 0;
  padding: 4px 8px 4px 4px; border-radius: 8px; border: 1px solid transparent;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.pg-bar .pg-account:hover { border-color: #2b3f60; background: rgba(8, 12, 22, 0.6); }
.pg-place { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.15; }
.pg-place b { font-family: Cinzel, Georgia, serif; font-size: 12px; letter-spacing: 1px; color: #e6d7a8; }
.pg-place span { font-size: 11px; color: #8ba1c0; font-variant-numeric: tabular-nums; }
@media (max-width: 720px) { .pg-place { display: none; } }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

export interface HomeSection {
  label: string;
  open: () => void;
}

export interface HomeBarOptions {
  name: string;
  sections: readonly HomeSection[];
  onLive: () => void;
  onAccount: () => void;
}

export interface HomeBar {
  setLiveCount(n: number): void;
}

export function mountHomeBar(bar: Bar, o: HomeBarOptions): HomeBar {
  ensureCss();
  for (const s of o.sections) {
    const b = el('button', '', s.label);
    b.type = 'button';
    b.addEventListener('click', s.open);
    bar.links.appendChild(b);
  }
  const live = el('button', 'pg-bar-live');
  live.type = 'button';
  const count = el('b', '');
  live.append(el('i', ''), document.createTextNode('Live'), count);
  live.addEventListener('click', o.onLive);
  bar.links.appendChild(live);

  const account = el('button', 'pg-account');
  account.type = 'button';
  const place = el('span', 'pg-place');
  account.append(place, el('span', 'pg-who', o.name));
  account.addEventListener('click', o.onAccount);
  bar.right.appendChild(account);

  // The place by hand; the other ways live in the drawer and on the ladder.
  fetch('/api/ladder/mine', { credentials: 'same-origin' })
    .then((r) => (r.ok ? (r.json() as Promise<Places>) : null))
    .then((places) => {
      if (!places || !account.isConnected) return;
      const hand = places.hand;
      const tier = tierOf(hand.rating);
      place.append(el('b', '', tier.name), el('span', '', String(hand.rating)));
      account.prepend(emblem(tier, 30));
    })
    .catch(() => {});

  return {
    setLiveCount(n: number): void {
      count.textContent = n > 0 ? String(n) : '';
      live.classList.toggle('on', n > 0);
    },
  };
}
