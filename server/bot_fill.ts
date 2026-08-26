// Fills a match's empty seats with Policy bots (game definition: bots
// backfill; ADR 0002 phase 1). Deterministic champion assignment: first
// unused champion per team in roster order, no duplicates within a team.
// Bots get negative client ids; Match never registers them as players.

import { DEFAULT_BOT_ID } from '../src/sim/content/bots';
import { CHAMPION_LIST } from '../src/sim/content/champions';
import type { TeamId } from '../src/sim/types';
import type { MatchPick } from './match';

export const TEAM_SIZE = 5;

export function fillWithBots(picks: readonly MatchPick[], teamSize = TEAM_SIZE): MatchPick[] {
  const out: MatchPick[] = [...picks];
  let botClientId = -1;
  for (const team of [0, 1] as const satisfies readonly TeamId[]) {
    const used = new Set(out.filter((p) => p.team === team).map((p) => p.championId));
    let count = out.filter((p) => p.team === team).length;
    for (const c of CHAMPION_LIST) {
      if (count >= teamSize) break;
      if (used.has(c.id)) continue;
      used.add(c.id);
      out.push({
        clientId: botClientId--,
        name: `${c.name.split(',')[0]} (bot)`,
        team,
        championId: c.id,
        sigils: ['riftstep', 'mend'],
        // Deterministic cosmetic variety; the sim clamps out-of-range picks.
        skin: (count + team) % 3,
        bot: DEFAULT_BOT_ID,
      });
      count++;
    }
  }
  return out;
}
