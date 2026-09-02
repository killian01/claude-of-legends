// Fills a match's empty seats with house bots (game definition: bots
// backfill; ADR 0002 phase 1) on the fill (src/sim/fill.ts): each team's
// roster lanes completed by role around the seats it holds, drawn from the
// match seed, no duplicate inside a team. Bots get negative client ids;
// Match never registers them as players.

import { DEFAULT_BOT_ID } from '../src/sim/content/bots';
import { CHAMPIONS } from '../src/sim/content/champions';
import { fillTeam, TEAM_SIZE } from '../src/sim/fill';
import { Rng } from '../src/sim/rng';
import type { TeamId } from '../src/sim/types';
import type { MatchPick } from './match';

export { TEAM_SIZE };

export function fillWithBots(
  picks: readonly MatchPick[],
  seed = 1,
  teamSize = TEAM_SIZE,
): MatchPick[] {
  const out: MatchPick[] = [...picks];
  const rng = new Rng(seed);
  let botClientId = -1;
  for (const team of [0, 1] as const satisfies readonly TeamId[]) {
    const held = out
      .filter((p) => p.team === team)
      .map((p) => ({ championId: p.championId, role: p.forged?.role ?? null }));
    let count = held.length;
    for (const championId of fillTeam(held, rng, teamSize)) {
      const c = CHAMPIONS[championId];
      if (!c) continue;
      out.push({
        clientId: botClientId--,
        name: `${c.name.split(',')[0]} (bot)`,
        team,
        championId,
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
