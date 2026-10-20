// The battle royale's sim as the server's service takes it
// (server/royale_sim.ts): buildRoyaleSim (src/net/replay.ts), the one place
// a match's sim is built, on the Wanderseed this process read
// (server/planet.ts); the server's seats turned into the builder's picks,
// every bot seat on the mode's bot (src/sim/content/bots/royale.ts) with the
// skill the builder deals it, and a seat a person leaves handed back to
// that bot. A Thornfray's bout (ADR 0035) is built by buildBoutSim beside
// it, its record stamped with its kind's versions (boutRecord), and read
// back through the bout's own modules (src/sim/royale/bouts/).

import {
  boutRecord,
  buildBoutSim,
  buildRoyaleSim,
  type ReplayPick,
  type RoyalePlanet,
  type RoyaleRecord,
} from '../src/net/replay';
import { attachRoyaleBot, ROYALE_BOT_ID } from '../src/sim/content/bots/royale';
import { BOUT_KINDS, boutKindOf } from '../src/sim/content/bouts';
import type { BoutKind } from '../src/sim/content/bouts/types';
import { boutRanking, boutResult } from '../src/sim/royale/bouts/end';
import { boutPrimitives } from '../src/sim/royale/bouts/goals';
import { ROYALE_RULES_VERSION, type RoyaleState } from '../src/sim/royale/types';
import type { Sim } from '../src/sim/sim';
import type {
  BoutHost,
  RoyaleBoutArgs,
  RoyaleBuild,
  RoyaleSim,
  RoyaleSimFactory,
} from './royale_sim';

// A sim built for a battle royale always holds its mode: what the service
// reads, checked once here rather than at every read.
export function royaleSimOf(sim: Sim): RoyaleSim {
  const rest: Omit<RoyaleSim, 'royale'> = sim;
  if (sim.royale === null) throw new Error('not a battle royale sim');
  return rest as Omit<RoyaleSim, 'royale'> & { readonly royale: RoyaleState };
}

// `kinds`: the bout kinds a bout's record may name (every registered one).
export function royaleFactory(
  planet: () => RoyalePlanet,
  kinds: readonly BoutKind[] = BOUT_KINDS,
): RoyaleSimFactory {
  return (seed, variant, picks, crew = 1, bout) => {
    const guestsOnly = bout ? bout.guestsOnly : picks.some((p) => p.bot?.softened === true);
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
    if (bout) return buildBout(planet(), seed, replayPicks, newcomers, bout, kinds);
    const { sim, unitIds } = buildRoyaleSim(planet(), seed, replayPicks, variant, {
      guestsOnly,
      newcomers,
      crew,
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
          ...(crew !== 1 ? { crew } : {}),
        },
      },
      standIn: (unitId) => attachRoyaleBot(sim, unitId),
    };
  };
}

// A bout's build: its record (the kind's versions stamped on it), its sim
// by the one construction, and what the server reads of it.
function buildBout(
  planet: RoyalePlanet,
  seed: number,
  picks: readonly ReplayPick[],
  newcomers: readonly number[],
  bout: RoyaleBoutArgs,
  kinds: readonly BoutKind[],
): RoyaleBuild {
  const kind = boutKindOf(bout.kind, kinds);
  if (!kind) throw new Error(`no bout kind ${bout.kind}`);
  const royale: RoyaleRecord = {
    variant: kind.base,
    guestsOnly: bout.guestsOnly,
    rules: ROYALE_RULES_VERSION,
    ...(newcomers.length > 0 ? { newcomers: [...newcomers] } : {}),
    bout: boutRecord(kind, {
      matchSeed: bout.matchSeed,
      index: bout.index,
      thornyard: bout.region,
      ...(bout.prize !== null ? { prize: bout.prize } : {}),
      ...(bout.pendingPrize.length > 0
        ? { pendingPrize: bout.pendingPrize.map((p) => ({ seat: p.seat, cards: [...p.cards] })) }
        : {}),
      ...(bout.grafts.some((g) => g.length > 0) ? { grafts: bout.grafts.map((g) => [...g]) } : {}),
    }),
  };
  const { sim, unitIds } = buildBoutSim(planet, { seed, picks: [...picks], royale }, kinds);
  const mode = sim.royaleMode!;
  const host: BoutHost = {
    ranking: () => boutRanking(mode, sim),
    primitives: () => boutPrimitives(mode),
    result: () => boutResult(mode, sim),
    seedfalls: kind.seedfalls ?? null,
  };
  return {
    sim: royaleSimOf(sim),
    unitIds,
    replay: { picks, royale },
    standIn: (unitId) => attachRoyaleBot(sim, unitId),
    bout: host,
  };
}
