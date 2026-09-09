// The home's panels (CONTEXT.md: Home): what stands under the play tiles.
// The reader's own numbers, the top of the ladder by hand, the top bots,
// and the latest champions out of the Forge, each a way into the section
// that holds the rest of it. Pure DOM over /api/home, one request for the
// four; each panel says what it has, and a panel with nothing to show says
// so rather than standing empty.

import { nextTier, tierOf } from '../net/tiers';
import { CHAMPIONS, type ChampionRole } from '../sim/content/champions';
import { openBotPage } from './bot_page';
import { ROLE_COLORS, setPortrait } from './champion_art';
import { kdaPerMatch } from './kda_text';
import { myBots, type WatchReplay } from './ladder_bots';
import { MIN_RATED_GAMES, type Place, placeLine, WAY_LABELS } from './ladder_card';
import type { Way } from './ladder_page';
import { el } from './menu';
import { emblem } from './tier_emblem';

// The wire shape (server/home_page.ts).
type Result = 'W' | 'L';

interface Row {
  rank: number;
  id: string | number;
  accountId: number;
  owner?: string | null;
  name: string;
  rating: number;
  ratedGames: number;
  wins: number;
  losses: number;
  form: Result[];
  mine: boolean;
  championId?: string | null;
}

interface ForgedCard {
  id: string;
  name: string;
  title: string;
  role: string;
  creator: string;
  splash: string | null;
  likes: number;
  updatedAt: number;
  mine: boolean;
}

interface Career {
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  favorite: { championId: string; games: number } | null;
  lastAt: number | null;
}

interface HomePage {
  ladder: { way: 'hand'; total: number; rows: Row[] };
  bots: { way: 'arena' | 'bot'; total: number; rows: Row[] };
  forged: ForgedCard[];
  me: {
    places: Record<Way, Place>;
    career: Career;
    bots: { total: number; ranked: number };
    forged: number;
  };
}

export interface HomePanelsOptions {
  name: string;
  openLadder: (way: Way) => void;
  openAcademy: () => void;
  openForge: () => void;
  openGallery: (pick?: string) => void;
  // The account's own drawer: the career in full.
  openCareer: () => void;
  onWatch: WatchReplay;
}

export interface HomePanels {
  root: HTMLElement;
  // Asked again after a section closes: the Forge may have sealed a
  // champion, the ladder may have played an Arena match.
  refresh(): void;
}

// The same glass as the landing's cards (ui/page.ts): a panel is a card
// that reads rather than one that asks.
const CSS = `
.home-panels { display: grid; gap: 14px; margin-top: 26px;
  grid-template-columns: minmax(0, 5fr) minmax(0, 4fr) minmax(0, 4fr); align-items: stretch; }
.hp {
  min-width: 0; display: flex; flex-direction: column; gap: 10px;
  background: rgba(8, 12, 22, 0.86); backdrop-filter: blur(7px);
  border: 1px solid #2b3f60; border-radius: 14px; padding: 16px 18px 18px;
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.55);
}
.hp.gold { border-color: #6b5a2e; }
.hp-head { display: flex; align-items: baseline; gap: 10px; }
.hp-head h3 { font-family: Cinzel, Georgia, serif; font-size: 13px; letter-spacing: 2.2px;
  text-transform: uppercase; color: #e6d7a8; margin: 0; white-space: nowrap; }
.hp-sub { font-size: 11.5px; color: #8ba1c0; min-width: 0; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.hp-more {
  margin-left: auto; background: none; border: 0; padding: 0; cursor: pointer; font: inherit;
  font-size: 11px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase;
  color: #9fb8dc; white-space: nowrap; transition: color 0.15s ease;
}
.hp-more:hover { color: #dceaff; }
.hp-body { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.hp-empty { font-size: 12.5px; line-height: 1.5; color: #8ba1c0; margin: 0; }
.hp-row {
  display: grid; grid-template-columns: 22px 24px minmax(0, 1fr) auto; align-items: center;
  gap: 8px; padding: 5px 6px; margin: 0 -6px; border-radius: 7px; border: 0;
  background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
  transition: background 0.15s ease;
}
.hp-row:hover { background: rgba(201, 168, 74, 0.08); }
.hp-row.me { background: rgba(201, 168, 74, 0.14); }
.hp-rank { color: #c9a84a; font-weight: 800; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.hp-row img { width: 24px; height: 24px; border-radius: 5px; object-fit: cover; object-position: top;
  border: 1px solid #2b3f60; background: #0a1120; display: block; }
.hp-name { min-width: 0; display: flex; flex-direction: column; line-height: 1.2; }
.hp-name b { font-weight: 600; color: #e8e0c8; font-size: 13px; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.hp-name span { font-size: 11px; color: #8ba1c0; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; }
.hp-num { text-align: right; line-height: 1.2; font-variant-numeric: tabular-nums; }
.hp-num b { display: block; color: #f3e6bd; font-size: 13.5px; font-weight: 800; }
.hp-num span { font-size: 10.5px; color: #8ba1c0; }

/* The reader: the place by hand in large, then one cell per number the
   account has earned, and none for what it has not. */
.hp-you-main { display: flex; align-items: center; gap: 14px; }
.hp-you-text { min-width: 0; line-height: 1.25; }
.hp-you-tier { font-family: Cinzel, Georgia, serif; font-size: 18px; letter-spacing: 1.2px;
  color: #e6d7a8; font-weight: 700; }
.hp-you-rating { font-size: 12.5px; color: #b9cbe4; font-variant-numeric: tabular-nums; }
.hp-you-rating b { color: #f3e6bd; font-size: 15px; }
.hp-you-place { font-size: 12px; color: #93a8c4; margin-top: 2px; }
.hp-cells { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px;
  margin-top: 4px; }
.hp-cell { border: 1px solid #1f2f4a; border-radius: 8px; padding: 8px 10px;
  background: rgba(10, 17, 32, 0.6); min-width: 0; }
/* A value three numbers long takes two cells' room rather than an ellipsis. */
.hp-cell.wide { grid-column: span 2; }
.hp-cell b { display: block; font-size: 16px; font-weight: 800; color: #e6d7a8; line-height: 1.15;
  font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hp-cell span { display: block; font-size: 10px; color: #8ba1c0; letter-spacing: 0.8px;
  text-transform: uppercase; margin-top: 3px; line-height: 1.25; }
.hp-ways { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #8ba1c0;
  margin-top: 2px; }
.hp-way { display: flex; align-items: center; gap: 7px; min-width: 0; }
.hp-way b { color: #c9d9ee; font-weight: 600; white-space: nowrap; }
.hp-way span { font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; }

/* The strip: six cards the gallery's shape, across the whole column. */
.hp-forged { grid-column: 1 / -1; }
.hp-cards { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; }
.hp-card {
  position: relative; overflow: hidden; aspect-ratio: 4 / 5; padding: 0; border-radius: 10px;
  border: 1px solid #28405e; background: #0f1930; color: inherit; font: inherit; text-align: left;
  cursor: pointer; display: block; min-width: 0;
  transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}
.hp-card:hover { transform: translateY(-3px); border-color: #d8b45a;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.5); }
.hp-card img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
  display: block; }
.hp-mono {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  padding-bottom: 30px; font-size: 42px; font-weight: 800; color: #b9a8e8;
  background: radial-gradient(circle at 50% 38%, #3a2d63 0%, #0a1120 90%);
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.6);
}
.hp-likes {
  position: absolute; top: 8px; right: 8px; padding: 2px 8px; border-radius: 20px;
  background: rgba(3, 6, 14, 0.75); border: 1px solid #2e4468;
  font-size: 10.5px; font-weight: 700; color: #e8dfae;
}
.hp-mine {
  position: absolute; top: 8px; left: 8px; padding: 2px 7px; border-radius: 4px;
  border: 1px solid #6b5a2e; background: rgba(3, 6, 14, 0.75);
  font-size: 10px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: #e6d7a8;
}
.hp-card-body {
  position: absolute; left: 0; right: 0; bottom: 0; padding: 28px 10px 9px; min-width: 0;
  background: linear-gradient(180deg, rgba(3, 6, 14, 0) 0%, rgba(3, 6, 14, 0.92) 62%);
}
.hp-card-name { font-weight: 800; font-size: 13.5px; color: #f3e6bd; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.hp-card-meta { font-size: 10.5px; color: #8ba1c0; margin-top: 2px; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.hp-card-meta b { font-weight: 700; }

@media (max-width: 1120px) {
  .home-panels { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .hp-you { grid-column: 1 / -1; }
  .hp-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 720px) {
  .home-panels { grid-template-columns: minmax(0, 1fr); }
  .hp-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
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

const UNREACHABLE = 'Unavailable: the game server is not reachable.';

function champName(id: string): string {
  return (CHAMPIONS[id]?.name ?? id).split(',')[0] ?? id;
}

// The champion's illustration, at a thumbnail's size; the procedural
// figure only when the file is missing. The procedural one is drawn on a
// WebGL canvas, which a browser without one refuses by throwing, and a
// thumbnail must never take the panel down with it.
function portrait(img: HTMLImageElement, championId: string): void {
  img.addEventListener(
    'error',
    () => {
      try {
        setPortrait(img, championId, 0x8ba1c0);
      } catch {
        img.remove();
      }
    },
    { once: true },
  );
  img.src = `/portraits/${championId}.webp`;
}

function winPct(wins: number, losses: number): string | null {
  const games = wins + losses;
  return games > 0 ? `${Math.round((100 * wins) / games)}% won` : null;
}

interface Panel {
  root: HTMLElement;
  sub: HTMLElement;
  more: HTMLButtonElement;
  body: HTMLElement;
}

function panel(cls: string, title: string): Panel {
  const root = el('section', `hp ${cls}`);
  const head = el('div', 'hp-head');
  const sub = el('span', 'hp-sub');
  const more = el('button', 'hp-more');
  more.type = 'button';
  head.append(el('h3', '', title), sub, more);
  const body = el('div', 'hp-body');
  body.append(el('p', 'hp-empty', 'Loading...'));
  root.append(head, body);
  return { root, sub, more, body };
}

function setMore(p: Panel, label: string, go: () => void): void {
  const fresh = el('button', 'hp-more', label);
  fresh.type = 'button';
  fresh.addEventListener('click', go);
  p.more.replaceWith(fresh);
  p.more = fresh;
}

function rowEl(r: Row, art: HTMLElement, sub: string | null, num: string | null): HTMLElement {
  const row = el('button', `hp-row${r.mine ? ' me' : ''}`);
  row.type = 'button';
  const name = el('div', 'hp-name');
  name.append(el('b', '', r.name));
  if (sub) name.append(el('span', '', sub));
  const val = el('div', 'hp-num');
  val.append(el('b', '', String(r.rating)));
  if (num) val.append(el('span', '', num));
  row.append(el('span', 'hp-rank', String(r.rank)), art, name, val);
  return row;
}

function cell(value: string, label: string, wide = false): HTMLElement {
  const c = el('div', `hp-cell${wide ? ' wide' : ''}`);
  c.append(el('b', '', value), el('span', '', label));
  return c;
}

export function buildHomePanels(o: HomePanelsOptions): HomePanels {
  ensureCss();
  const root = el('section', 'home-panels');
  const you = panel('hp-you gold', o.name);
  const ladder = panel('hp-ladder', 'The ladder');
  const bots = panel('hp-bots', 'Top bots');
  const forged = panel('hp-forged', 'Latest from the Forge');
  root.append(you.root, ladder.root, bots.root, forged.root);

  const renderYou = (page: HomePage): void => {
    const me = page.me;
    you.sub.textContent = 'Your place';
    setMore(you, 'Career', o.openCareer);
    you.body.textContent = '';
    const hand = me.places.hand;
    const tier = tierOf(hand.rating);
    const main = el('div', 'hp-you-main');
    const text = el('div', 'hp-you-text');
    const rating = el('div', 'hp-you-rating');
    rating.append(el('b', '', String(hand.rating)));
    const next = nextTier(hand.rating);
    rating.append(
      document.createTextNode(
        next ? `, ${next.min - hand.rating} to ${next.name}` : ', the top tier',
      ),
    );
    text.append(
      el('div', 'hp-you-tier', tier.name),
      rating,
      el('div', 'hp-you-place', placeLine(hand, 'hand')),
    );
    main.append(emblem(tier, 56), text);
    you.body.append(main);

    // One cell per number the account has; a fresh account has none and
    // reads the way in instead of a row of zeros.
    const cells = el('div', 'hp-cells');
    const c = me.career;
    if (c.games > 0) {
      cells.append(
        cell(String(c.games), c.games === 1 ? 'match' : 'matches'),
        cell(`${Math.round((100 * c.wins) / c.games)}%`, 'won'),
      );
      if (c.favorite) {
        const n = c.favorite.games;
        cells.append(
          cell(
            champName(c.favorite.championId),
            `most played, ${n} ${n === 1 ? 'match' : 'matches'}`,
          ),
        );
      }
      cells.append(
        cell(kdaPerMatch(c.kills, c.deaths, c.assists, c.games), 'K/D/A per match', true),
      );
    }
    if (me.bots.total > 0) {
      cells.append(
        cell(
          String(me.bots.total),
          `${me.bots.total === 1 ? 'bot' : 'bots'}, ${me.bots.ranked} ranked`,
        ),
      );
    }
    if (me.forged > 0) cells.append(cell(String(me.forged), 'forged'));
    if (cells.childElementCount > 0) you.body.append(cells);
    else {
      you.body.append(
        el('p', 'hp-empty', 'No online match yet. Play online to start your career.'),
      );
    }

    // The other ways the account has rated play on, one line each.
    const ways = el('div', 'hp-ways');
    for (const way of ['bot', 'arena', 'forge'] as const) {
      const p = me.places[way];
      if (!p || p.games <= 0) continue;
      const line = el('div', 'hp-way');
      line.append(
        emblem(tierOf(p.rating), 18),
        el('b', '', WAY_LABELS[way]),
        el('span', '', `${tierOf(p.rating).name} ${p.rating}, ${placeLine(p).toLowerCase()}`),
      );
      ways.append(line);
    }
    if (ways.childElementCount > 0) you.body.append(ways);
  };

  const renderLadder = (page: HomePage): void => {
    const l = page.ladder;
    ladder.sub.textContent = l.total > 0 ? `By hand, ${l.total} placed` : 'By hand';
    setMore(ladder, 'Open', () => o.openLadder('hand'));
    ladder.body.textContent = '';
    if (l.rows.length === 0) {
      ladder.body.append(
        el('p', 'hp-empty', `Nobody has placed yet. ${MIN_RATED_GAMES} rated matches place you.`),
      );
      return;
    }
    for (const r of l.rows) {
      const tier = tierOf(r.rating);
      const row = rowEl(r, emblem(tier, 22), tier.name, winPct(r.wins, r.losses));
      row.addEventListener('click', () => o.openLadder('hand'));
      ladder.body.append(row);
    }
  };

  const renderBots = (page: HomePage): void => {
    const b = page.bots;
    const where = b.way === 'arena' ? 'The Arena' : 'Live';
    bots.sub.textContent = b.total > 0 ? `${where}, ${b.total} placed` : where;
    bots.body.textContent = '';
    if (b.rows.length === 0) {
      setMore(bots, 'Academy', o.openAcademy);
      bots.body.append(
        el(
          'p',
          'hp-empty',
          'No bot has placed in the Arena yet. Write one in the Academy, mark it Ranked, and the Arena plays it on the hour.',
        ),
      );
      return;
    }
    setMore(bots, 'Ladder', () => o.openLadder(b.way));
    for (const r of b.rows) {
      const img = document.createElement('img');
      img.alt = '';
      if (r.championId && CHAMPIONS[r.championId]) portrait(img, r.championId);
      const sub = [r.championId ? champName(r.championId) : null, r.owner ?? null]
        .filter((s): s is string => s !== null)
        .join(', ');
      const row = rowEl(r, img, sub || null, winPct(r.wins, r.losses));
      const botId = r.id;
      if (typeof botId === 'string') {
        row.addEventListener('click', () => {
          void myBots().then((mine) => {
            openBotPage(document.body, botId, { myBots: mine, onWatch: o.onWatch });
          });
        });
      }
      bots.body.append(row);
    }
  };

  const renderForged = (page: HomePage): void => {
    forged.body.textContent = '';
    if (page.forged.length === 0) {
      forged.sub.textContent = 'Champions sealed in the Forge';
      setMore(forged, 'Forge', o.openForge);
      forged.body.append(
        el('p', 'hp-empty', 'Nothing forged yet. Build a champion in the Forge and seal it.'),
      );
      return;
    }
    forged.sub.textContent = 'The newest champions sealed, from every creator';
    setMore(forged, 'Gallery', () => o.openGallery());
    const cards = el('div', 'hp-cards');
    for (const f of page.forged) {
      const card = el('button', 'hp-card');
      card.type = 'button';
      card.title = f.title ? `${f.name}, ${f.title}` : f.name;
      if (f.splash) {
        const img = document.createElement('img');
        img.src = `/api/forge/asset/${f.splash}`;
        img.alt = '';
        img.decoding = 'async';
        card.append(img);
      } else {
        card.append(el('div', 'hp-mono', (f.name[0] ?? '?').toUpperCase()));
      }
      if (f.mine) card.append(el('span', 'hp-mine', 'Yours'));
      card.append(el('span', 'hp-likes', `${f.likes} ${f.likes === 1 ? 'like' : 'likes'}`));
      const body = el('div', 'hp-card-body');
      const meta = el('div', 'hp-card-meta');
      const role = el('b', '', f.role);
      role.style.color = ROLE_COLORS[f.role as ChampionRole] ?? '#c9d8ae';
      meta.append(role, document.createTextNode(`, by ${f.creator}`));
      body.append(el('div', 'hp-card-name', f.name), meta);
      card.append(body);
      card.addEventListener('click', () => o.openGallery(f.id));
      cards.append(card);
    }
    forged.body.append(cards);
  };

  const say = (p: Panel, text: string): void => {
    p.body.textContent = '';
    p.body.append(el('p', 'hp-empty', text));
  };
  const fail = (): void => {
    for (const p of [you, ladder, bots, forged]) say(p, UNREACHABLE);
  };
  // Each panel draws on its own: one that cannot be drawn says so and
  // leaves the other three standing.
  const draw = (p: Panel, render: () => void): void => {
    try {
      render();
    } catch {
      say(p, 'This panel could not be drawn.');
    }
  };

  const refresh = (): void => {
    fetch('/api/home', { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<HomePage>) : null))
      .then((page) => {
        if (!root.isConnected) return;
        if (!page) {
          fail();
          return;
        }
        draw(you, () => renderYou(page));
        draw(ladder, () => renderLadder(page));
        draw(bots, () => renderBots(page));
        draw(forged, () => renderForged(page));
      })
      .catch(() => {
        if (root.isConnected) fail();
      });
  };
  refresh();
  return { root, refresh };
}
