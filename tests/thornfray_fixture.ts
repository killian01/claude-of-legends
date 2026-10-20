// What the Thornfray engine's tests share (ADR 0035, docs/plan-thornfray.md
// slice 1): a test-only bout kind that stands one goal of each primitive (a
// circle at the Thornyard's heart, a carrier passed to the seat that last
// hit a champion, a target that moves on the bout's stream) and counts with
// a scorer of its own on the tick's damage events, kinds built from it for
// a test's need, and an eight bot harness that builds a bout's record and
// plays it on the real Wanderseed through buildBoutSim.

import {
  boutRecord,
  buildBoutSim,
  REPLAY_VERSION,
  type ReplayPick,
  type ReplayRecord,
} from '../src/net/replay';
import { ROYALE_BOT_ID } from '../src/sim/content/bots/royale';
import { BOUT_SEATS } from '../src/sim/content/bouts/match';
import type {
  BoutGoal,
  BoutKind,
  BoutScorer,
  BoutView,
  GoalPrimitive,
} from '../src/sim/content/bouts/types';
import type { PendingPrize } from '../src/sim/royale/bouts/ledger';
import { royaleHouseChampions } from '../src/sim/royale/fill';
import { type RegionId, randomAround } from '../src/sim/royale/layout';
import { DROP_S, ROYALE_RULES_VERSION } from '../src/sim/royale/types';
import type { Sim } from '../src/sim/sim';
import { DT } from '../src/sim/types';
import { loadPlanet } from './royale_planet';

// The circle: a fixed ring of 6 m at the Thornyard's heart, held by the
// lowest seat standing in it.
export const circleGoal: BoutGoal = {
  id: 'test_circle',
  start(bout) {
    const slot = bout.goal('test_circle');
    slot.prims = [{ shape: 'circle', at: { ...bout.thornyard.center }, radius: 6, holder: null }];
  },
  step(bout) {
    const p = bout.goal('test_circle').prims[0]!;
    p.holder = null;
    for (let seat = 0; seat < bout.seatCount; seat++) {
      const s = bout.seat(seat);
      if (!s || s.dead || !s.pos) continue;
      const dx = s.pos.x - p.at.x;
      const dy = s.pos.y - p.at.y;
      const dz = s.pos.z - p.at.z;
      if (dx * dx + dy * dy + dz * dz <= p.radius * p.radius) {
        p.holder = seat;
        break;
      }
    }
  },
  primitives: (bout) => bout.goal('test_circle').prims,
};

// The carrier: passed to the seat that last dealt a champion damage, at its
// feet; dropped where it stands when it falls.
export const carrierGoal: BoutGoal = {
  id: 'test_carrier',
  start(bout) {
    const slot = bout.goal('test_carrier');
    slot.prims = [{ shape: 'carrier', at: { ...bout.thornyard.center }, radius: 2, holder: null }];
  },
  step(bout, events) {
    const p = bout.goal('test_carrier').prims[0]!;
    for (const e of events) {
      if (e.type !== 'damage') continue;
      const from = bout.seatOf(e.sourceId);
      if (from !== null && bout.seatOf(e.targetId) !== null && from !== bout.seatOf(e.targetId)) {
        p.holder = from;
      }
    }
    const s = p.holder !== null ? bout.seat(p.holder) : null;
    if (s?.dead) p.holder = null;
    else if (s?.pos) p.at = { ...s.pos };
  },
  primitives: (bout) => bout.goal('test_carrier').prims,
};

// The target: a point drawn inside the Thornyard on the bout's stream,
// drawn again every ten seconds; nums[0] is when it moves next.
export const targetGoal: BoutGoal = {
  id: 'test_target',
  start(bout, rng) {
    const slot = bout.goal('test_target');
    slot.prims = [{ shape: 'target', at: drawTarget(bout, rng.next()), radius: 3, holder: null }];
    slot.nums = [bout.time + 10];
  },
  step(bout) {
    const slot = bout.goal('test_target');
    if (bout.time + 1e-9 < slot.nums[0]!) return;
    slot.prims[0]!.at = drawTarget(bout, bout.rng.next());
    slot.nums[0] = bout.time + 10;
  },
  primitives: (bout) => bout.goal('test_target').prims,
};

function drawTarget(bout: BoutView, share: number): GoalPrimitive['at'] {
  const c = bout.thornyard.center;
  const R = Math.sqrt(c.x * c.x + c.y * c.y + c.z * c.z);
  return randomAround(bout.rng, c, share * 0.5 * bout.thornyard.radius, R);
}

// The test kind's own count: the damage each seat dealt to another seat's
// champion.
export const damageScorer: BoutScorer = {
  id: 'test_damage',
  onEvents(events, bout) {
    for (const e of events) {
      if (e.type !== 'damage') continue;
      const from = bout.seatOf(e.sourceId);
      const to = bout.seatOf(e.targetId);
      if (from === null || to === null || from === to) continue;
      bout.counts[from] = bout.counts[from]! + e.amount;
    }
  },
};

// The test kind: Respawn's death, a 90 s clock, one closing, caches that
// come back, two bursts of three Seedfalls, the three goals, the damage
// count.
export const TEST_BOUT: BoutKind = {
  id: 'testbout',
  name: 'Testbout',
  rule: 'Most damage dealt wins',
  card: ['Most damage dealt wins', 'A test of the bout engine'],
  version: 1,
  released: false,
  base: 'respawn',
  playS: 90,
  thornyard: { radius: 40 },
  dusk: {
    closings: [{ radius: 26, closeFrom: 45, closeTo: 60, holdTo: 90, burn: 0.06 }],
    edgeSpeed: 1.1,
    burnBefore: 0.04,
    lightOutS: 90,
  },
  systems: {},
  caches: { count: 18, backS: 30 },
  seedfalls: { at: [30, 60], seeds: 3, warnS: 12, forecastS: 15, apartM: 18, depthM: 8 },
  goals: [circleGoal, carrierGoal, targetGoal],
  count: damageScorer,
  ties: ['falls', 'reached', 'seat'],
  bots: { errand: null, floor: 0.4, reach: 40, duskMargin: 0.5, cornered: 8, pace: null },
  hud: { word: 'dealt', place: false },
};

// A kind built from the test kind for one test's need.
export function testKind(over: Partial<BoutKind> = {}): BoutKind {
  return { ...TEST_BOUT, ...over };
}

// The kinds a test's replays may name.
export const TEST_KINDS: readonly BoutKind[] = [TEST_BOUT];

// Eight house seats, champions dealt from the match's seed.
export function boutPicks(matchSeed: number, seats = BOUT_SEATS): ReplayPick[] {
  return royaleHouseChampions(matchSeed, seats).map((championId, i) => ({
    name: `house${i}`,
    team: i,
    championId,
    sigils: ['riftstep', 'mend'] as [string, string],
    bot: ROYALE_BOT_ID,
  }));
}

export interface BoutArgs {
  kind?: BoutKind;
  matchSeed?: number;
  seed?: number;
  index?: number;
  region?: RegionId;
  prize?: number;
  pendingPrize?: PendingPrize[];
  grafts?: string[][];
  picks?: ReplayPick[];
}

// A bout's record, stamped with its kind's versions.
export function boutReplay(
  args: BoutArgs = {},
): Pick<ReplayRecord, 'version' | 'seed' | 'picks' | 'royale'> {
  const kind = args.kind ?? TEST_BOUT;
  const matchSeed = args.matchSeed ?? 1;
  return {
    version: REPLAY_VERSION,
    seed: args.seed ?? 11,
    picks: args.picks ?? boutPicks(matchSeed),
    royale: {
      variant: kind.base,
      rules: ROYALE_RULES_VERSION,
      bout: boutRecord(kind, {
        matchSeed,
        index: args.index ?? 0,
        thornyard: args.region ?? 'ruins',
        ...(args.prize !== undefined ? { prize: args.prize } : {}),
        ...(args.pendingPrize ? { pendingPrize: args.pendingPrize } : {}),
        ...(args.grafts ? { grafts: args.grafts } : {}),
      }),
    },
  };
}

// A bout built from its args, its kind among the test's.
export function buildBout(args: BoutArgs = {}): { sim: Sim; unitIds: number[] } {
  const kind = args.kind ?? TEST_BOUT;
  const kinds = kind === TEST_BOUT ? TEST_KINDS : [kind, TEST_BOUT];
  return buildBoutSim(loadPlanet(), boutReplay(args), kinds);
}

// Ticks until every seat has landed.
export function land(sim: Sim): void {
  while (sim.royale!.stage === 'drop') sim.tick();
}

// A whole bout played to its end (or the cap), the checksum noted every
// ten seconds.
export function playOut(sim: Sim, capS = 200): { checks: number[]; ticks: number } {
  const checks: number[] = [];
  const cap = Math.round((DROP_S + capS) / DT);
  while (sim.royale!.stage !== 'over' && sim.tickCount < cap) {
    sim.tick();
    if (sim.tickCount % 200 === 0) checks.push(sim.checksum());
  }
  return { checks, ticks: sim.tickCount };
}
