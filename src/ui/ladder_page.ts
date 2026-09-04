// The ladder page (CONTEXT.md: Ladder): a full page from the home screen,
// one tab per way. At the top the reader's own place (emblem, tier,
// rating, rank or placement, the climb to the next tier, the form) and
// the button to the match that moves this ladder; then the podium, the
// table of the placed with their rated play, the reader pinned under it
// when beyond the top, and the accounts still placing. Pure DOM over
// /api/ladder/page; the Arena tab adds the pool.

import { nextTier, TIERS, tierOf } from '../net/tiers';
import { CHAMPIONS } from '../sim/content/champions';
import { openBotPage } from './bot_page';
import { setPortrait } from './champion_art';
import { type BotChip, botChips, buildPool, type WatchReplay } from './ladder_bots';
import { MIN_RATED_GAMES, placeLine, WAY_LABELS } from './ladder_card';
import { el } from './menu';
import { startMenuBackdrop } from './menu_backdrop';
import { buildPublicProfilePanel } from './profile_panel';
import { emblem } from './tier_emblem';

export type Way = 'hand' | 'bot' | 'arena' | 'forge';
type Result = 'W' | 'L';

interface Favorite {
  championId: string;
  games: number;
  forged?: { name: string; splash: string | null };
}

interface Row {
  rank: number;
  // The subject: an account id by hand and in the Forge, a bot id on the
  // two bot ways (ADR 0016).
  id: string | number;
  accountId: number;
  // The owner's name, on the bot ways.
  owner?: string | null;
  name: string;
  rating: number;
  ratedGames: number;
  wins: number;
  losses: number;
  form: Result[];
  favorite: Favorite | null;
  bots?: BotChip[];
}

interface PlacingRow {
  id: string | number;
  accountId: number;
  owner?: string | null;
  name: string;
  ratedGames: number;
}

interface Me {
  rank: number | null;
  rating: number;
  ratedGames: number;
  placed: boolean;
  wins: number;
  losses: number;
  form: Result[];
  pinned?: Row;
}

interface Page {
  way: Way;
  total: number;
  rows: Row[];
  placing: PlacingRow[];
  me: Me;
}

interface MyBot {
  id: string;
  name: string;
  championId: string;
  deposited: boolean;
}

export interface LadderPageOptions {
  // The match that moves the ladder: the public queue, or the Forge's.
  onPlay: (mode: 'queue' | 'forge-queue') => void;
  onWatch: WatchReplay;
  openAcademy: () => void;
}

const WAYS: readonly { way: Way; sub: string; empty: string }[] = [
  {
    way: 'hand',
    sub: 'People at the keyboard. A queued match with a human on each side moves this rating.',
    empty: 'Nobody has placed yet. Three rated matches place you.',
  },
  {
    way: 'bot',
    sub: 'Your bot in a live match, seated in place of a house bot, coached by you.',
    empty: 'No bot has placed yet. Queue with a bot; three rated matches place it.',
  },
  {
    way: 'arena',
    sub: 'Ranked bots against each other, on the hour and on demand, nobody present.',
    empty: 'The Arena has not placed anyone yet.',
  },
  {
    way: 'forge',
    sub: 'The Forge queue: by hand, with forged champions, on its own rating.',
    empty: 'Nobody has placed in the Forge queue yet.',
  },
];

const CSS = `
.lp, .lp * { box-sizing: border-box; }
.lp {
  position: absolute; inset: 0; z-index: 30; display: flex; flex-direction: column;
  background: radial-gradient(ellipse at top, #1d1a10 0%, #0a1120 70%);
  font-family: system-ui, sans-serif; color: #c9d9ee; font-size: 13px;
}
.lp *::-webkit-scrollbar { width: 10px; }
.lp *::-webkit-scrollbar-track { background: #0a0d14; }
.lp *::-webkit-scrollbar-thumb { background: #3d3520; border-radius: 5px; }
.lp-head { position: relative; z-index: 1; display: flex; align-items: baseline; gap: 14px; padding: 20px 32px 10px; flex-wrap: wrap; }
.lp-title {
  font-family: Cinzel, Georgia, serif; font-size: 30px; letter-spacing: 3px; text-transform: uppercase; margin: 0;
  background: linear-gradient(180deg, #f9ecc0 0%, #dcb85e 52%, #9d7429 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.lp-sub { font-size: 13px; color: #8ba1c0; }
.lp-owner { margin-left: 8px; font-size: 11.5px; color: #8ba1c0; }
.lp-back {
  margin-left: auto; padding: 9px 20px; border-radius: 6px; border: 1px solid #6b5a2e;
  background: #1a1708; color: #e6d7a8; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit;
}
.lp-back:hover { border-color: #c9a84a; }
.lp-tabs { position: relative; z-index: 1; display: flex; gap: 8px; padding: 0 32px 12px; flex-wrap: wrap; }
.lp-tab {
  padding: 7px 16px; border-radius: 6px; border: 1px solid #3d3520; background: #15130b;
  color: #a89a72; cursor: pointer; font-family: Cinzel, Georgia, serif; font-size: 13px; letter-spacing: 1px;
}
.lp-tab.on { color: #f3e6bd; border-color: #c9a84a; background: #2a2412; }
.lp-body { position: relative; z-index: 1; flex: 1; min-height: 0; overflow-y: auto; padding: 0 32px 30px; }
.lp-lead { font-size: 12.5px; color: #8ba1c0; margin: 0 0 12px; }
.lp-you {
  display: grid; grid-template-columns: auto 1fr auto; gap: 24px; align-items: center;
  padding: 18px 22px; border: 1px solid #6b5a2e; border-radius: 12px; background: rgba(8, 12, 22, 0.86); margin-bottom: 18px;
}
.lp-you-tier { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 120px; }
.lp-tier-name { font-family: Cinzel, Georgia, serif; font-size: 20px; letter-spacing: 1.5px; color: #e6d7a8; font-weight: 700; }
.lp-you-rating { font-size: 28px; font-weight: 800; color: #f3e6bd; font-variant-numeric: tabular-nums; line-height: 1.1; }
.lp-you-line { font-size: 13px; color: #b9cbe4; margin: 4px 0; }
.lp-you-line b { color: #e6d7a8; }
.lp-bar { height: 8px; border-radius: 4px; background: #1c1a12; border: 1px solid #3d3520; overflow: hidden; margin: 6px 0; max-width: 380px; }
.lp-bar i { display: block; height: 100%; background: linear-gradient(90deg, #9d7429, #f9ecc0); }
.lp-form { display: inline-flex; gap: 3px; vertical-align: middle; }
.lp-form i {
  width: 15px; height: 15px; border-radius: 3px; display: inline-block; font-style: normal;
  font-size: 9px; line-height: 15px; text-align: center; font-weight: 800;
}
.lp-form .w { background: #2f6a3a; color: #bfe8c6; }
.lp-form .l { background: #6a2f2f; color: #f0b8b0; }
.lp-cta { display: flex; flex-direction: column; gap: 8px; align-items: stretch; min-width: 220px; max-width: 280px; }
.lp-btn {
  padding: 10px 16px; border-radius: 6px; border: 1px solid #6b5a2e; background: #1a1708;
  color: #e6d7a8; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit;
}
.lp-btn.primary { background: linear-gradient(180deg, #f9ecc0 0%, #dcb85e 52%, #9d7429 100%); color: #1a1408; border-color: #f3e6bd; }
.lp-btn:hover { border-color: #c9a84a; }
.lp-btn:disabled { opacity: 0.4; cursor: default; }
.lp-select { padding: 7px 8px; border-radius: 6px; border: 1px solid #3d3520; background: #0f0d06; color: #e6d7a8; font-size: 12px; font-family: inherit; }
.lp-status { font-size: 12px; color: #e0c070; min-height: 16px; }
.lp-status.bad { color: #f09090; }
.lp-hint { font-size: 11.5px; color: #8ba1c0; line-height: 1.4; }
.lp-section { font-family: Cinzel, Georgia, serif; font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase; color: #c9a84a; margin: 18px 0 8px; }
.lp-podium { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 8px; }
.lp-pod {
  position: relative; overflow: hidden; border-radius: 10px; border: 1px solid #3d3520; background: #0f0d06;
  min-height: 160px; padding: 14px; display: flex; flex-direction: column; justify-content: flex-end; gap: 4px;
  cursor: pointer; text-align: left; color: inherit; font-family: inherit;
}
.lp-pod:hover { border-color: #c9a84a; }
.lp-pod.first { border-color: #c9a84a; box-shadow: 0 0 24px rgba(201, 168, 74, 0.18); }
.lp-pod img.bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top; opacity: 0.32; }
.lp-pod > * { position: relative; }
.lp-pod-rank { position: absolute; top: 10px; left: 12px; font-family: Cinzel, Georgia, serif; font-size: 24px; font-weight: 800; color: #f3e6bd; }
.lp-pod-name { font-size: 17px; font-weight: 700; color: #f3e6bd; display: flex; align-items: center; gap: 8px; }
.lp-pod-line { font-size: 12px; color: #b9cbe4; }
.lp-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.lp-table th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.8px; color: #8ba1c0; padding: 6px 8px; border-bottom: 1px solid #3d3520; font-weight: 600; }
.lp-table th.num { text-align: right; }
.lp-table td { padding: 7px 8px; border-bottom: 1px solid #1c1a12; vertical-align: middle; }
.lp-table tr.row { cursor: pointer; }
.lp-table tr.row:hover td { background: rgba(201, 168, 74, 0.06); }
.lp-table tr.me td { background: rgba(201, 168, 74, 0.13); }
.lp-table td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.lp-rank { color: #c9a84a; font-weight: 800; width: 44px; }
.lp-name { font-weight: 600; color: #e8e0c8; }
.lp-name-line { display: flex; align-items: center; gap: 8px; }
.lp-name .tier { color: #8ba1c0; font-weight: 400; font-size: 11.5px; }
.lp-fav { display: flex; align-items: center; gap: 7px; color: #b9cbe4; font-size: 12px; white-space: nowrap; }
.lp-fav img { width: 28px; height: 28px; border-radius: 5px; object-fit: cover; object-position: top; border: 1px solid #3d3520; background: #0f0d06; }
.lp-forged { display: inline-block; padding: 1px 6px; border-radius: 4px; border: 1px solid #6b5a2e; color: #e6d7a8; font-size: 10.5px; }
.lp-gap td { text-align: center; color: #6b5a2e; padding: 2px; letter-spacing: 4px; }
.lp-detail td { padding: 6px 8px 12px 52px; background: rgba(8, 12, 22, 0.6); }
.lp-placing { display: flex; flex-wrap: wrap; gap: 8px; }
.lp-placing span { padding: 4px 10px; border-radius: 6px; border: 1px dashed #3d3520; color: #8ba1c0; font-size: 12px; }
.lp-empty { color: #8ba1c0; font-size: 13px; padding: 8px 0; }
@media (max-width: 900px) {
  .lp-you { grid-template-columns: 1fr; }
  .lp-podium { grid-template-columns: 1fr; }
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

type Outcome<T> = ({ ok: true } & T) | { ok: false; error: string };

async function post<T>(path: string, body: unknown): Promise<Outcome<T>> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as Outcome<T>;
  } catch {
    return { ok: false, error: 'the server did not answer' };
  }
}

function champName(id: string): string {
  return CHAMPIONS[id]?.name.split(',')[0] ?? id;
}

function formEl(form: readonly Result[]): HTMLElement {
  const box = el('span', 'lp-form');
  for (const r of form) box.append(el('i', r === 'W' ? 'w' : 'l', r));
  return box;
}

function winPct(wins: number, losses: number): string {
  const games = wins + losses;
  return games > 0 ? `${Math.round((100 * wins) / games)}%` : '';
}

function favoriteEl(fav: Favorite | null): HTMLElement {
  const box = el('span', 'lp-fav');
  if (!fav) return box;
  if (fav.forged) {
    if (fav.forged.splash) {
      const img = document.createElement('img');
      img.src = `/api/forge/asset/${fav.forged.splash}`;
      img.alt = '';
      box.append(img);
    }
    box.append(document.createTextNode(fav.forged.name), el('span', 'lp-forged', 'Forged'));
    return box;
  }
  if (CHAMPIONS[fav.championId]) {
    const img = document.createElement('img');
    img.alt = '';
    setPortrait(img, fav.championId, 0x8ba1c0);
    box.append(img);
  }
  box.append(document.createTextNode(champName(fav.championId)));
  return box;
}

// The climb inside the tier: how far the rating sits between the tier's
// floor and the next one's. The Recruit has no floor: its band is read as
// one step of the same width under the base.
function climb(rating: number): { pct: number; text: string } {
  const tier = tierOf(rating);
  const next = nextTier(rating);
  if (!next) return { pct: 1, text: 'The top tier.' };
  const step = TIERS[2]!.min - TIERS[1]!.min;
  const floor = Number.isFinite(tier.min) ? tier.min : next.min - step;
  const pct = Math.max(0, Math.min(1, (rating - floor) / (next.min - floor)));
  return { pct, text: `${next.min - rating} to ${next.name}` };
}

export function openLadderPage(
  container: HTMLElement,
  opts: LadderPageOptions,
  startWay: Way = 'hand',
): () => void {
  ensureCss();
  const root = el('div', 'lp');
  const stopBackdrop = startMenuBackdrop(root);
  const close = (): void => {
    window.removeEventListener('keydown', onKey);
    stopBackdrop();
    root.remove();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !document.querySelector('.bp-back')) close();
  };
  window.addEventListener('keydown', onKey);

  const head = el('div', 'lp-head');
  const back = el('button', 'lp-back', 'Back');
  back.addEventListener('click', close);
  head.append(
    el('h1', 'lp-title', 'The Ladder'),
    el(
      'span',
      'lp-sub',
      'Four ways to place: by hand, your bot live, your bot in the Arena, the Forge queue.',
    ),
    back,
  );

  const tabs = el('div', 'lp-tabs');
  const body = el('div', 'lp-body');
  const tabButtons = new Map<Way, HTMLButtonElement>();
  let current: Way = startWay;
  let mine: MyBot[] | null = null;

  const myBotsOnce = async (): Promise<MyBot[]> => {
    if (mine) return mine;
    try {
      const res = await fetch('/api/bots', { credentials: 'same-origin' });
      const data = res.ok ? ((await res.json()) as { ok?: boolean; bots?: MyBot[] }) : null;
      mine = data?.ok && data.bots ? data.bots : [];
    } catch {
      mine = [];
    }
    return mine;
  };

  const leaveFor = (fn: () => void): void => {
    close();
    fn();
  };

  // The button that moves this ladder, one per way.
  const buildCta = async (way: Way): Promise<HTMLElement> => {
    const box = el('div', 'lp-cta');
    if (way === 'hand') {
      const btn = el('button', 'lp-btn primary', 'Play online');
      btn.addEventListener('click', () => leaveFor(() => opts.onPlay('queue')));
      box.append(
        btn,
        el('div', 'lp-hint', 'Only queued matches with a human on each side move this rating.'),
      );
      return box;
    }
    if (way === 'forge') {
      const btn = el('button', 'lp-btn primary', 'Forge queue');
      btn.addEventListener('click', () => leaveFor(() => opts.onPlay('forge-queue')));
      box.append(
        btn,
        el('div', 'lp-hint', 'The public queue of forged champions, rated on its own.'),
      );
      return box;
    }
    const bots = await myBotsOnce();
    if (way === 'bot') {
      if (bots.length === 0) {
        const btn = el('button', 'lp-btn', 'Open the Academy');
        btn.addEventListener('click', () => leaveFor(opts.openAcademy));
        box.append(btn, el('div', 'lp-hint', 'Write a bot first; then queue with it.'));
        return box;
      }
      const btn = el('button', 'lp-btn primary', 'Play online with your bot');
      btn.addEventListener('click', () => leaveFor(() => opts.onPlay('queue')));
      box.append(
        btn,
        el('div', 'lp-hint', 'Pick your bot at champion select: it plays, you coach.'),
      );
      return box;
    }
    // The Arena: play now with a ranked bot, from the daily allowance.
    const ranked = bots.filter((b) => b.deposited);
    if (ranked.length === 0) {
      const btn = el('button', 'lp-btn', 'Open the Academy');
      btn.addEventListener('click', () => leaveFor(opts.openAcademy));
      box.append(
        btn,
        el('div', 'lp-hint', 'Mark a bot Ranked in the Academy; the Arena plays it on the hour.'),
      );
      return box;
    }
    const sel = el('select', 'lp-select');
    for (const b of ranked) {
      const o = document.createElement('option');
      o.value = b.id;
      o.textContent = `${b.name} (${champName(b.championId)})`;
      sel.append(o);
    }
    const go = el('button', 'lp-btn primary', 'Play now, ranked');
    const status = el('div', 'lp-status');
    go.addEventListener('click', () => {
      go.disabled = true;
      status.className = 'lp-status';
      status.textContent = 'Playing in the Arena...';
      void post<{
        winner: 0 | 1 | null;
        ticks: number;
        rated: boolean;
        replayId?: number;
        seats: { botId: string; delta: number; rating: number }[];
      }>('/api/bots/playnow', { id: sel.value }).then((r) => {
        go.disabled = false;
        if (!r.ok) {
          status.className = 'lp-status bad';
          status.textContent = r.error;
          return;
        }
        const seat = r.seats.find((s) => s.botId === sel.value);
        status.textContent =
          (r.winner === 0 ? 'Won' : r.winner === 1 ? 'Lost' : 'No winner') +
          (r.rated && seat
            ? `, ${seat.delta >= 0 ? '+' : ''}${seat.delta} (now ${seat.rating}).`
            : ', unrated.');
        if (r.replayId !== undefined) {
          const id = r.replayId;
          const watch = el('button', 'lp-btn', 'Watch');
          watch.addEventListener('click', () => leaveFor(() => opts.onWatch(id)));
          status.append(document.createTextNode(' '), watch);
        }
        // The ladder moved: read it again, the status kept.
        void load(current, status);
      });
    });
    box.append(
      sel,
      go,
      status,
      el('div', 'lp-hint', 'One rated match now, from the daily allowance.'),
    );
    return box;
  };

  const buildYou = (page: Page, cta: HTMLElement): HTMLElement => {
    const me = page.me;
    const tier = tierOf(me.rating);
    const box = el('div', 'lp-you');
    const left = el('div', 'lp-you-tier');
    left.append(emblem(tier, 96), el('span', 'lp-tier-name', tier.name));
    const mid = el('div', '');
    mid.append(el('div', 'lp-you-rating', String(me.rating)));
    const place = el('div', 'lp-you-line');
    place.append(
      el(
        'b',
        '',
        placeLine(
          {
            rank: me.rank,
            rating: me.rating,
            games: me.ratedGames,
            placed: me.placed,
            total: page.total,
          },
          page.way,
        ),
      ),
    );
    mid.append(place);
    const c = climb(me.rating);
    const bar = el('div', 'lp-bar');
    const fill = el('i', '');
    fill.style.width = `${Math.round(c.pct * 100)}%`;
    bar.append(fill);
    mid.append(bar, el('div', 'lp-you-line', c.text));
    const record = el('div', 'lp-you-line');
    if (me.wins + me.losses > 0) {
      record.append(
        el('b', '', `${me.wins} won, ${me.losses} lost`),
        document.createTextNode(`, ${winPct(me.wins, me.losses)}. Form: `),
        formEl(me.form),
      );
    } else record.textContent = 'No rated match on this way yet.';
    mid.append(record);
    box.append(left, mid, cta);
    return box;
  };

  const rowEl = (r: Row, way: Way, isMe: boolean): HTMLElement[] => {
    const tr = el('tr', `row${isMe ? ' me' : ''}`);
    const tier = tierOf(r.rating);
    tr.append(el('td', 'lp-rank', String(r.rank)));
    const name = el('td', 'lp-name');
    const line = el('div', 'lp-name-line');
    line.append(emblem(tier, 20), document.createTextNode(r.name), el('span', 'tier', tier.name));
    name.append(line);
    // A bot row names whose bot it is; by hand the name is the account's
    // own and there is nothing to add.
    if (r.owner) name.append(el('span', 'lp-owner', r.owner));
    if (r.bots && r.bots.length > 0) name.append(botChips(r.bots, opts.onWatch));
    tr.append(name);
    tr.append(
      el('td', 'num', String(r.rating)),
      el('td', 'num', String(r.ratedGames)),
      el('td', 'num', winPct(r.wins, r.losses)),
    );
    const form = el('td', '');
    form.append(formEl(r.form));
    const fav = el('td', '');
    fav.append(favoriteEl(r.favorite));
    tr.append(form, fav);
    const out: HTMLElement[] = [tr];
    // By hand, a row opens on the account's career; on the bot ways the
    // bots themselves are the detail, a page each.
    if (way === 'hand' || way === 'forge') {
      const detail = el('tr', 'lp-detail');
      const cell = el('td', '');
      cell.colSpan = 7;
      detail.append(cell);
      detail.style.display = 'none';
      let built = false;
      tr.addEventListener('click', () => {
        const open = detail.style.display === 'none';
        detail.style.display = open ? '' : 'none';
        if (open && !built) {
          built = true;
          cell.append(buildPublicProfilePanel(r.accountId));
        }
      });
      out.push(detail);
    } else if (typeof r.id === 'string') {
      // The row is the bot itself now, so it opens the bot's page.
      const botId = r.id;
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () =>
        openBotPage(document.body, botId, { onWatch: opts.onWatch }),
      );
    }
    return out;
  };

  const podium = (rows: readonly Row[], table: HTMLElement): HTMLElement => {
    const box = el('div', 'lp-podium');
    rows.slice(0, 3).forEach((r, i) => {
      const card = el('button', `lp-pod${i === 0 ? ' first' : ''}`);
      const fav = r.favorite;
      if (fav && !fav.forged && CHAMPIONS[fav.championId]) {
        const img = document.createElement('img');
        img.className = 'bg';
        img.alt = '';
        setPortrait(img, fav.championId, 0x8ba1c0);
        card.append(img);
      }
      const tier = tierOf(r.rating);
      const name = el('div', 'lp-pod-name');
      name.append(emblem(tier, 26), document.createTextNode(r.name));
      const games = r.wins + r.losses;
      card.append(
        el('span', 'lp-pod-rank', String(r.rank)),
        name,
        el(
          'div',
          'lp-pod-line',
          `${tier.name} ${r.rating}` +
            (games > 0 ? `, ${winPct(r.wins, r.losses)} of ${games}` : '') +
            (fav ? `, ${fav.forged ? fav.forged.name : champName(fav.championId)}` : ''),
        ),
      );
      card.addEventListener('click', () => {
        const tr = table.querySelectorAll('tr.row')[i] as HTMLElement | undefined;
        tr?.click();
        tr?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      box.append(card);
    });
    return box;
  };

  const render = (page: Page, cta: HTMLElement, keep?: HTMLElement): void => {
    body.textContent = '';
    const meta = WAYS.find((w) => w.way === page.way)!;
    body.append(el('p', 'lp-lead', meta.sub));
    if (keep) cta.append(keep);
    body.append(buildYou(page, cta));
    if (page.rows.length === 0) {
      body.append(el('div', 'lp-empty', meta.empty));
    } else {
      const table = el('table', 'lp-table');
      const hr = el('tr', '');
      // The column names its subject: a person by hand and in the Forge,
      // a bot on the two bot ways (ADR 0016).
      const subject = page.way === 'bot' || page.way === 'arena' ? 'Bot' : 'Player';
      for (const [h, cls] of [
        ['#', ''],
        [subject, ''],
        ['Rating', 'num'],
        ['Rated', 'num'],
        ['Wins', 'num'],
        ['Form', ''],
        ['Most played', ''],
      ] as const) {
        hr.append(el('th', cls, h));
      }
      table.append(hr);
      for (const r of page.rows) {
        for (const e of rowEl(r, page.way, page.me.placed && page.me.rank === r.rank))
          table.append(e);
      }
      if (page.me.pinned) {
        const gap = el('tr', 'lp-gap');
        const cell = el('td', '', '...');
        cell.colSpan = 7;
        gap.append(cell);
        table.append(gap);
        for (const e of rowEl(page.me.pinned, page.way, true)) table.append(e);
      }
      body.append(el('div', 'lp-section', 'The podium'), podium(page.rows, table));
      body.append(el('div', 'lp-section', `The ladder, ${page.total} placed`), table);
    }
    if (page.placing.length > 0) {
      body.append(el('div', 'lp-section', 'Placing'));
      const list = el('div', 'lp-placing');
      for (const p of page.placing) {
        list.append(el('span', '', `${p.name}, ${p.ratedGames} of ${MIN_RATED_GAMES}`));
      }
      body.append(list);
    }
    if (page.way === 'arena') {
      body.append(el('div', 'lp-section', 'The pool'), buildPool(opts.onWatch));
    }
  };

  const load = async (way: Way, keep?: HTMLElement): Promise<void> => {
    current = way;
    for (const [w, b] of tabButtons) b.classList.toggle('on', w === way);
    if (!keep) body.textContent = 'Loading the ladder...';
    let page: Page | null = null;
    try {
      const res = await fetch(`/api/ladder/page?way=${way}`, { credentials: 'same-origin' });
      if (res.ok) page = (await res.json()) as Page;
    } catch {
      page = null;
    }
    if (current !== way) return;
    if (!page) {
      body.textContent = 'Ladder unavailable: the game server is not reachable.';
      return;
    }
    const cta = await buildCta(way);
    if (current !== way) return;
    render(page, cta, keep);
  };

  for (const w of WAYS) {
    const b = el('button', 'lp-tab', WAY_LABELS[w.way]);
    b.addEventListener('click', () => void load(w.way));
    tabButtons.set(w.way, b);
    tabs.append(b);
  }
  root.append(head, tabs, body);
  container.appendChild(root);
  void load(startWay);
  return close;
}
