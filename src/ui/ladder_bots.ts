// The bots under a ladder: an account's ranked bots as chips, each a Bot
// page (CONTEXT.md: Bot page), and the Arena's pool, every ranked bot on
// the server. Shared by the ladder page's bot ways; pure DOM over
// /api/account/:id and /api/bots/pool.

import { tierOf } from '../net/tiers';
import { openBotPage } from './bot_page';

const CSS = `
.lb-bots { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; }
.lb-bot {
  padding: 4px 9px; border-radius: 6px; border: 1px solid #3d3520; background: #1a1708;
  color: #e6d7a8; cursor: pointer; font-size: 11.5px; font-family: inherit;
}
.lb-bot:hover { border-color: #c9a84a; }
.lb-bot small { color: #8ba1c0; margin-left: 4px; }
.lb-pool { margin: 4px 0 10px; }
.lb-sub { color: #8ba1c0; margin: 4px 0; font-size: 12px; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

export interface BotChip {
  id: string;
  name: string;
  championId: string;
  tally: { wins: number; losses: number };
}

export type WatchReplay = (replayId: number, follow?: number) => void;

// The reader's own bots, for a challenge from a bot's page.
export async function myBots(): Promise<{ id: string; name: string; championId: string }[]> {
  try {
    const res = await fetch('/api/bots', { credentials: 'same-origin' });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      ok?: boolean;
      bots?: { id: string; name: string; championId: string }[];
    };
    return body.ok && body.bots ? body.bots : [];
  } catch {
    return [];
  }
}

function openPage(botId: string, onWatch: WatchReplay): void {
  void myBots().then((mine) => {
    openBotPage(document.body, botId, { myBots: mine, onWatch });
  });
}

// One chip per bot: name, tally, the page on click.
export function botChips(bots: readonly BotChip[], onWatch: WatchReplay): HTMLElement {
  ensureCss();
  const box = document.createElement('div');
  box.className = 'lb-bots';
  for (const b of bots) {
    const btn = document.createElement('button');
    btn.className = 'lb-bot';
    btn.textContent = b.name;
    const small = document.createElement('small');
    small.textContent = `${b.tally.wins}-${b.tally.losses}`;
    btn.appendChild(small);
    btn.title = "The bot's page: its record, its replays, its playbook when open, a challenge";
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openPage(b.id, onWatch);
    });
    box.appendChild(btn);
  }
  return box;
}

// The account's ranked bots, fetched: a chip each.
export function buildRankedBots(accountId: number, onWatch: WatchReplay): HTMLElement {
  ensureCss();
  const box = document.createElement('div');
  fetch(`/api/account/${accountId}`)
    .then((r) => (r.ok ? (r.json() as Promise<{ bots?: BotChip[] }>) : null))
    .then((data) => {
      const bots = data?.bots ?? [];
      if (bots.length > 0) box.appendChild(botChips(bots, onWatch));
    })
    .catch(() => undefined);
  return box;
}

// The pool: the ranked bots of every account, by Arena rating, each a
// button to its page.
export function buildPool(onWatch: WatchReplay): HTMLElement {
  ensureCss();
  const box = document.createElement('div');
  box.className = 'lb-pool';
  fetch('/api/bots/pool', { credentials: 'same-origin' })
    .then((r) =>
      r.ok
        ? (r.json() as Promise<{
            ok?: boolean;
            bots?: {
              id: string;
              name: string;
              championId: string;
              owner: string | null;
              mine: boolean;
              tally: { wins: number; losses: number };
              arena: number;
            }[];
          }>)
        : null,
    )
    .then((data) => {
      const bots = (data?.bots ?? []).sort((a, b) => b.arena - a.arena);
      const title = document.createElement('div');
      title.className = 'lb-sub';
      title.textContent =
        bots.length === 0
          ? 'No ranked bot yet: mark one Ranked in the Academy.'
          : `The pool: ${bots.length} ranked bot${bots.length > 1 ? 's' : ''}. Open one to read it, and to challenge it with yours.`;
      box.appendChild(title);
      const row = document.createElement('div');
      row.className = 'lb-bots';
      for (const b of bots) {
        const btn = document.createElement('button');
        btn.className = 'lb-bot';
        btn.textContent = `${b.name}`;
        const small = document.createElement('small');
        small.textContent = `${b.owner ?? '?'} · ${tierOf(b.arena).name} · ${b.tally.wins}-${b.tally.losses}`;
        btn.appendChild(small);
        btn.addEventListener('click', () => openPage(b.id, onWatch));
        row.appendChild(btn);
      }
      box.appendChild(row);
    })
    .catch(() => undefined);
  return box;
}
