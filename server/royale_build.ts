// The battle royale's sim as the server's service takes it
// (server/royale_sim.ts): buildRoyaleSim (src/net/replay.ts), the one place
// a match's sim is built, on the Wanderseed this process read
// (server/planet.ts); the server's seats turned into the builder's picks,
// every bot seat on the mode's bot (src/sim/content/bots/royale.ts) with the
// skill the builder deals it, and a seat a person leaves handed back to
// that bot.

import { buildRoyaleSim, type ReplayPick, type RoyalePlanet } from '../src/net/replay';
import { attachRoyaleBot, ROYALE_BOT_ID } from '../src/sim/content/bots/royale';
import { ROYALE_RULES_VERSION, type RoyaleState } from '../src/sim/royale/types';
import type { Sim } from '../src/sim/sim';
import type { RoyaleSim, RoyaleSimFactory } from './royale_sim';

// A sim built for a battle royale always holds its mode: what the service
// reads, checked once here rather than at every read.
export function royaleSimOf(sim: Sim): RoyaleSim {
  const rest: Omit<RoyaleSim, 'royale'> = sim;
  if (sim.royale === null) throw new Error('not a battle royale sim');
  return rest as Omit<RoyaleSim, 'royale'> & { readonly royale: RoyaleState };
}

export function royaleFactory(planet: () => RoyalePlanet): RoyaleSimFactory {
  return (seed, variant, picks) => {
    const guestsOnly = picks.some((p) => p.bot?.softened === true);
    const replayPicks: ReplayPick[] = picks.map((p) => ({
      name: p.name,
      team: p.team,
      championId: p.championId,
      sigils: [p.sigils[0], p.sigils[1]],
      skin: p.skin,
      ...(p.bot ? { bot: ROYALE_BOT_ID } : {}),
    }));
    // The newcomers' seats, recorded so a replay deals the same escorts.
    const newcomers: number[] = [];
    picks.forEach((p, i) => {
      if (p.newcomer) newcomers.push(i);
    });
    const { sim, unitIds } = buildRoyaleSim(planet(), seed, replayPicks, variant, {
      guestsOnly,
      newcomers,
    });
    return {
      sim: royaleSimOf(sim),
      unitIds,
      replay: {
        picks: replayPicks,
        royale: {
          variant,
          guestsOnly,
          rules: ROYALE_RULES_VERSION,
          ...(newcomers.length > 0 ? { newcomers } : {}),
        },
      },
      standIn: (unitId) => attachRoyaleBot(sim, unitId),
    };
  };
}
