// The Risings and the hunted on the wire (server/royale_snapshot_blocks.ts):
// the ri block (each Rising called or standing, its body's health in steps)
// and the mk block (each mark, its last point shown and when), both sent
// when they change; Respawn's rank and gap every snapshot of the play,
// matching the ranking at the end; and one MARK_SHOWN_S for the score
// leader's point in the observation and on the wire.

import { describe, expect, it } from 'vitest';
import { type RankedSeat, rankAndGap, royaleRanking } from '../server/royale_ranking';
import { RISING_HP_STEP } from '../server/royale_snapshot_blocks';
import { buildRoyaleSim } from '../src/net/replay';
import { buildObservation } from '../src/sim/observe';
import { DROP_S, MARK_SHOWN_S } from '../src/sim/royale/types';
import { fakeSnap, picks } from './royale_contract_fixture';
import { spot } from './royale_fake';
import { loadPlanet } from './royale_planet';

function playing() {
  const f = fakeSnap();
  f.sim.royale.stage = 'play';
  f.sim.time = 300;
  return f;
}

describe('the ri block', () => {
  it('sends each Rising when the list changes, its health in steps', () => {
    const { sim, snap } = playing();
    const body = sim.addCreature(spot(3, 4));
    sim.royale.risings.push(
      { kind: 'pyrefang', pos: { x: 1, y: 2, z: 3 }, risesAt: 320, up: false, unitId: null },
      { kind: 'warden', pos: { x: 4, y: 5, z: 6 }, risesAt: 290, up: true, unitId: body.id },
    );
    body.hp = body.maxHp * 0.505;
    expect(snap().royale?.ri).toEqual([
      ['pyrefang', 1, 2, 3, 320, 0, 1],
      ['warden', 4, 5, 6, 290, 1, 0.52],
    ]);
    // Unchanged: off the wire, the client keeps the last.
    expect(snap().royale?.ri).toBeUndefined();
    body.hp = body.maxHp * 0.5;
    expect(snap().royale?.ri?.[1]?.[6]).toBe(0.5);
    expect(RISING_HP_STEP).toBe(0.02);
    sim.royale.risings.length = 0;
    expect(snap().royale?.ri).toEqual([]);
  });
});

describe('the mk block', () => {
  it('sends each mark when the list changes', () => {
    const { sim, snap } = playing();
    sim.royale.marks.push({
      unitId: 3,
      kind: 'ablaze',
      streak: 4,
      at: { x: 1.234, y: 2, z: 3 },
      shownAt: 299.5,
    });
    expect(snap().royale?.mk).toEqual([[3, 'ablaze', 1.23, 2, 3, 299.5]]);
    expect(snap().royale?.mk).toBeUndefined();
    sim.royale.marks[0]!.shownAt = 314.5;
    expect(snap().royale?.mk).toEqual([[3, 'ablaze', 1.23, 2, 3, 314.5]]);
  });
});

describe('the rank and the gap', () => {
  it('match the Respawn ranking: the seat above, or the lead when first', () => {
    const { sim, self, snap } = playing();
    const ids = [...sim.units.keys()];
    sim.royale.scores.set(ids[1]!, 6);
    sim.royale.scores.set(ids[2]!, 4);
    sim.royale.scores.set(self.id, 3);
    const seats: RankedSeat[] = ids.map((id) => ({
      unitId: id,
      name: '',
      championId: '',
      bot: false,
      deaths: sim.units.get(id)!.deaths,
    }));
    const r = snap().royale!;
    const ranking = royaleRanking(sim.royale, seats);
    expect(r.rk).toBe(ranking.indexOf(self.id) + 1);
    expect({ rank: r.rk, gap: r.gap }).toEqual(rankAndGap(sim.royale, seats, self.id));
    expect(r.rk).toBe(3);
    expect(r.gap).toBe(1);
    sim.royale.scores.set(self.id, 9);
    sim.tickCount++;
    expect(snap().royale).toMatchObject({ rk: 1, gap: 3 });
    // Level with the seat above: a gap of nothing, fewer deaths first.
    sim.royale.scores.set(self.id, 6);
    sim.units.get(ids[1]!)!.deaths = 2;
    sim.tickCount++;
    expect(snap().royale).toMatchObject({ rk: 1, gap: 0 });
  });

  it('is not sent in One life, nor before the play', () => {
    const f = fakeSnap();
    expect(f.snap().royale).not.toHaveProperty('rk');
    expect(f.snap().royale).not.toHaveProperty('gap');
    const { sim, snap } = playing();
    expect(snap().royale).toHaveProperty('rk');
    sim.royale.variant = 'one_life';
    sim.tickCount++;
    expect(snap().royale).not.toHaveProperty('rk');
  });
});

describe('one show length', () => {
  it('shows the leader for MARK_SHOWN_S on the wire', () => {
    const { sim, snap } = playing();
    const leader = [...sim.units.values()][2]!;
    sim.royale.leaderId = leader.id;
    sim.royale.scores.set(leader.id, 6);
    sim.royale.leaderShownAt = sim.time - MARK_SHOWN_S;
    expect(snap().royale?.leader?.at).toBeDefined();
    sim.royale.leaderShownAt = sim.time - MARK_SHOWN_S - 0.05;
    expect(snap().royale?.leader?.at).toBeUndefined();
  });

  it('shows the leader for MARK_SHOWN_S in the observation', () => {
    const { sim, unitIds } = buildRoyaleSim(loadPlanet(), 4, picks(3), 'respawn');
    while (sim.time < DROP_S + 10) sim.tick();
    const r = sim.royale!;
    r.leaderId = unitIds[0]!;
    r.leaderShownAt = sim.time - MARK_SHOWN_S;
    expect(buildObservation(sim, unitIds[1]!)!.royale!.leader?.at).toBeDefined();
    r.leaderShownAt = sim.time - MARK_SHOWN_S - 0.05;
    expect(buildObservation(sim, unitIds[1]!)!.royale!.leader?.at).toBeUndefined();
  });
});
