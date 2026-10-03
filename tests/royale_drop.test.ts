// The company at the landing (src/sim/royale/drop.ts, mode.ts stepDrop):
// one house bot beside each person in One life and two in Respawn, a
// normal one first so the first fight is a three-way, the gentle first
// only for a newcomer (a person who never banked a battle royale award),
// and a replay that records the newcomers seats the same escorts; and who
// is a newcomer (server/royale_join.ts).

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isRoyaleNewcomer, RoyaleVeterans } from '../server/royale_join';
import {
  buildRoyaleSim,
  loadRoyaleReplay,
  REPLAY_VERSION,
  type ReplayPick,
} from '../src/net/replay';
import { dist } from '../src/sim/geo';
import { dealEscorts, ESCORT_MAX_M, ESCORTS } from '../src/sim/royale/drop';
import { ESCORT_ORDER, NEWCOMER_ESCORT_ORDER } from '../src/sim/royale/mode';
import { DROP_S, ROYALE_RULES_VERSION, type RoyaleVariant } from '../src/sim/royale/types';
import type { Sim } from '../src/sim/sim';
import { loadPlanet } from './royale_planet';

const PERSON = 4;

// Ten seats, the house bots on every seat but the person's.
function picks(n = 10): ReplayPick[] {
  const ids = ['dain', 'vesk', 'sylra', 'korrath', 'maera'];
  return Array.from({ length: n }, (_, i) => ({
    name: `seat${i}`,
    team: i,
    championId: ids[i % ids.length]!,
    sigils: ['riftstep', 'mend'] as [string, string],
    ...(i === PERSON ? {} : { bot: 'royale' }),
  }));
}

function land(sim: Sim): void {
  while (sim.time < DROP_S + 0.2) sim.tick();
}

// The bots the mode deals the person, as its rule reads: the order's
// skills first, then the lowest id.
function expected(sim: Sim, unitIds: number[], order: readonly string[], count: number) {
  const mode = sim.royaleMode!;
  const rank = (id: number) => order.indexOf(mode.skillOf(id));
  return unitIds
    .filter((id) => id !== unitIds[PERSON])
    .sort((a, b) => rank(a) - rank(b) || a - b)
    .slice(0, count);
}

function escortsOf(variant: RoyaleVariant, newcomer: boolean, seed = 3) {
  const built = buildRoyaleSim(loadPlanet(), seed, picks(), variant, {
    ...(newcomer ? { newcomers: [PERSON] } : {}),
  });
  land(built.sim);
  return built;
}

describe('the escorts', () => {
  it('deals each person its count from the pool, in the order it asks, each bot once', () => {
    const groups = dealEscorts([1, 2], [10, 11, 12, 13, 14], 2, (person) =>
      person === 1 ? (a, b) => b - a : (a, b) => a - b,
    );
    expect(groups).toEqual([
      { person: 1, bots: [14, 13] },
      { person: 2, bots: [10, 11] },
    ]);
    expect(dealEscorts([1], [10], 2, () => (a, b) => a - b)).toEqual([{ person: 1, bots: [10] }]);
  });

  it('brings one down in One life and two in Respawn, a normal bot first', () => {
    expect(ESCORTS).toEqual({ one_life: 1, respawn: 2 });
    expect(ESCORT_ORDER[0]).toBe('normal');
    for (const variant of ['one_life', 'respawn'] as const) {
      const { sim, unitIds } = escortsOf(variant, false);
      const me = sim.units.get(unitIds[PERSON]!)!;
      const escorts = expected(sim, unitIds, ESCORT_ORDER, ESCORTS[variant]);
      expect(escorts).toHaveLength(ESCORTS[variant]);
      expect(sim.royaleMode!.skillOf(escorts[0]!)).toBe('normal');
      for (const id of escorts) {
        expect(dist(sim.units.get(id)!.pos, me.pos)).toBeLessThanOrEqual(ESCORT_MAX_M + 2);
      }
    }
  });

  it('brings a newcomer the gentle ones first', () => {
    expect(NEWCOMER_ESCORT_ORDER[0]).toBe('gentle');
    for (const variant of ['one_life', 'respawn'] as const) {
      const { sim, unitIds } = escortsOf(variant, true);
      const me = sim.units.get(unitIds[PERSON]!)!;
      const escorts = expected(sim, unitIds, NEWCOMER_ESCORT_ORDER, ESCORTS[variant]);
      for (const id of escorts) {
        expect(sim.royaleMode!.skillOf(id)).toBe('gentle');
        expect(dist(sim.units.get(id)!.pos, me.pos)).toBeLessThanOrEqual(ESCORT_MAX_M + 2);
      }
    }
  });

  it('seats the same escorts when a replay with newcomers is played back', () => {
    const live = escortsOf('respawn', true);
    const record = {
      version: REPLAY_VERSION,
      seed: 3,
      picks: picks(),
      royale: { variant: 'respawn' as const, rules: ROYALE_RULES_VERSION, newcomers: [PERSON] },
    };
    const replay = loadRoyaleReplay(loadPlanet(), record)!;
    land(replay.sim);
    expect(replay.sim.checksum()).toBe(live.sim.checksum());
    const plain = escortsOf('respawn', false);
    expect(plain.sim.checksum()).not.toBe(live.sim.checksum());
  });
});

describe('the newcomers', () => {
  it('is everyone who never banked a battle royale award, kept on disk', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'veterans-')), 'royale_veterans.json');
    const veterans = RoyaleVeterans.atFile(file);
    expect(isRoyaleNewcomer(veterans, 7)).toBe(true);
    veterans.noteBanked(7);
    veterans.noteBanked(-3);
    veterans.noteBanked(7);
    expect(isRoyaleNewcomer(veterans, 7)).toBe(false);
    expect(isRoyaleNewcomer(veterans, 8)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([-3, 7]);
    const again = RoyaleVeterans.atFile(file);
    expect(isRoyaleNewcomer(again, -3)).toBe(false);
    expect(isRoyaleNewcomer(RoyaleVeterans.atFile(`${file}.missing`), 7)).toBe(true);
  });
});
