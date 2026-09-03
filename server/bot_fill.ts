// Fills a match's empty seats (game definition: bots backfill; ADR 0002
// phase 1). Ranked bots first (docs/design/bots.md, the ladder alive):
// the pool's bots seated from the match seed, no duplicate champion inside
// a team and one bot per account in the match, each an owned seat rated
// on its account's live way and written to its Record at the end. Then
// house bots on the fill (src/sim/fill.ts): each team's roster lanes
// completed by role around the seats it holds, drawn from the same seed,
// each on a house style drawn from it too (src/sim/content/bots/house.ts),
// named by their style. Bots get negative client ids; Match never
// registers them as players.

import { houseName, houseSeats } from '../src/sim/content/bots/house';
import { CHAMPIONS } from '../src/sim/content/champions';
import { TEAM_SIZE } from '../src/sim/fill';
import { Rng } from '../src/sim/rng';
import type { TeamId } from '../src/sim/types';
import type { BotRow } from './bot_store';
import type { MatchPick } from './match';

export { TEAM_SIZE };

// A ranked bot the fill may seat, with its owner's name (the seat's public
// identity, "owner (Bot)").
export interface PoolSeat {
  bot: BotRow;
  owner: string;
}

// A seeded shuffle, so the same seed and pool seat the same bots.
function shuffled<T>(list: readonly T[], rng: Rng): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = out[i]!;
    out[i] = out[j]!;
    out[j] = t;
  }
  return out;
}

export function fillWithBots(
  picks: readonly MatchPick[],
  seed = 1,
  teamSize = TEAM_SIZE,
  pool: readonly PoolSeat[] = [],
): MatchPick[] {
  const out: MatchPick[] = [...picks];
  const rng = new Rng(seed);
  let botClientId = -1;
  // The pool first, on both teams, in one seeded order: a bot takes a seat
  // when its champion is not on that team and its account holds no other
  // seat in the match.
  const candidates = shuffled(pool, rng);
  const seatedAccounts = new Set<number>();
  for (const p of picks) if (p.ownerId !== undefined) seatedAccounts.add(p.ownerId);
  for (const team of [0, 1] as const satisfies readonly TeamId[]) {
    const onTeam = () => out.filter((p) => p.team === team);
    for (const seat of candidates) {
      if (onTeam().length >= teamSize) break;
      if (seatedAccounts.has(seat.bot.accountId)) continue;
      if (onTeam().some((p) => p.championId === seat.bot.championId)) continue;
      if (!CHAMPIONS[seat.bot.championId]) continue;
      seatedAccounts.add(seat.bot.accountId);
      out.push({
        clientId: botClientId--,
        name: `${seat.owner} (${seat.bot.name})`,
        team,
        championId: seat.bot.championId,
        sigils: seat.bot.sigils,
        skin: seat.bot.skin,
        playbook: seat.bot.playbook,
        botId: seat.bot.id,
        botVersion: seat.bot.version,
        ownerId: seat.bot.accountId,
      });
    }
  }
  // House bots on what is left, by the roster's lanes.
  for (const team of [0, 1] as const satisfies readonly TeamId[]) {
    const held = out
      .filter((p) => p.team === team)
      .map((p) => ({ championId: p.championId, role: p.forged?.role ?? null }));
    let count = held.length;
    for (const seat of houseSeats(held, rng, teamSize)) {
      const c = CHAMPIONS[seat.championId];
      if (!c) continue;
      out.push({
        clientId: botClientId--,
        name: houseName(seat.bot),
        team,
        championId: seat.championId,
        sigils: ['riftstep', 'mend'],
        // Deterministic cosmetic variety; the sim clamps out-of-range picks.
        skin: (count + team) % 3,
        bot: seat.bot,
      });
      count++;
    }
  }
  return out;
}
