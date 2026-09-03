// The scoreboard table: the head row and one team's worth of rows, built
// once and used by both screens that show a scoreboard. It lives here rather
// than in the HUD because the end screen used to carry a second, thinner
// version of the same table, so a column added to one never reached the
// other; the playtest complaint was that the match ended and the build you
// had spent the whole game assembling vanished from the summary.

import { ITEMS } from '../sim/content/items';
import { INVENTORY_SLOTS } from '../sim/sim';
import type { ScoreRow, TeamId } from '../sim/types';
import { describeItem, statLabel } from './describe';
import { itemIconUrl } from './icons';
import { attachTooltip } from './tooltips';

const COLUMNS: readonly (readonly [string, string])[] = [
  ['hud-score-player', 'Player'],
  ['hud-score-champ', 'Champion'],
  ['hud-score-kda', 'K / D / A'],
  ['hud-score-cs', 'CS'],
  ['hud-score-build', 'Build'],
];

function span(className: string, text?: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = className;
  if (text !== undefined) s.textContent = text;
  return s;
}

// A build as a row of item icons, six slots wide so a full inventory and an
// empty one read as the same shape; the Academy's summaries and the Record
// draw the same row the scoreboard does.
export function buildIcons(items: readonly string[] | undefined, size = 30): HTMLElement {
  const build = document.createElement('div');
  build.className = 'hud-score-build';
  const owned = items ?? [];
  for (let i = 0; i < INVENTORY_SLOTS; i++) {
    const id = owned[i];
    const item = id ? ITEMS[id] : undefined;
    if (!item) {
      const slot = span('slot');
      slot.style.width = `${size}px`;
      slot.style.height = `${size}px`;
      build.appendChild(slot);
      continue;
    }
    const img = document.createElement('img');
    img.src = itemIconUrl(item);
    img.width = size;
    img.height = size;
    img.alt = item.name;
    attachTooltip(img, () => describeItem(item, statLabel(item.stats)));
    build.appendChild(img);
  }
  return build;
}

export function scoreboardHead(): HTMLElement {
  const head = document.createElement('div');
  head.className = 'hud-score-row head';
  for (const [cls, label] of COLUMNS) head.appendChild(span(cls, label));
  return head;
}

// One team's rows, head included, appended into `box` (which is cleared).
export function renderScoreboardTeam(
  box: HTMLElement,
  rows: readonly ScoreRow[],
  team: TeamId,
  selfId: number,
): void {
  box.textContent = '';
  box.appendChild(scoreboardHead());
  for (const r of rows.filter((x) => x.team === team)) {
    const row = document.createElement('div');
    row.className = r.unitId === selfId ? 'hud-score-row self' : 'hud-score-row';
    // Player and champion are two different facts and get two columns:
    // offline nobody is named, so the seat says what it is.
    const player = span('hud-score-player', r.player ?? (r.unitId === selfId ? 'You' : 'Bot'));
    const champ = span('hud-score-champ');
    champ.append(document.createTextNode(r.name), span('lv', ` Lv ${r.level}`));
    const kda = span('hud-score-kda', `${r.kills} / ${r.deaths} / ${r.assists ?? 0}`);
    const cs = span('hud-score-cs', String(r.cs ?? 0));
    row.append(player, champ, kda, cs, buildIcons(r.items));
    box.appendChild(row);
  }
}
