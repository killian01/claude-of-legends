// The Grafts where they meet the contract (CONTEXT.md: Graft; ADR 0032):
// the offer and the Grafts in the seat's observation and on the wire, the
// pick free (no decision token) and taken the same live and replayed, and
// nothing of it in the 5v5. The rules themselves are tests/royale_grafts.
// test.ts. Owned by tranche 2's grafts worktree (T2-B).

import { describe, expect, it } from 'vitest';
import { applySimCommand } from '../src/net/replay';
import { dispatchAction } from '../src/sim/action_dispatch';
import { GRAFT_DROP_LAND_S } from '../src/sim/content/grafts';
import { buildObservation } from '../src/sim/observe';
import { DROP_S } from '../src/sim/royale/types';
import { Sim } from '../src/sim/sim';
import { fakeSnap, landed } from './royale_contract_fixture';

describe('the Grafts on the contract', () => {
  it('shows the seat its open offer and its Grafts', () => {
    const { sim, unitIds } = landed();
    const r = buildObservation(sim, unitIds[0]!)!.royale!;
    expect(r.offer).not.toBeNull();
    expect(r.offer!.grade).toBe('bough');
    expect(r.offer!.cards).toHaveLength(3);
    expect(r.offer!.until).toBeCloseTo(DROP_S + GRAFT_DROP_LAND_S, 6);
    expect(r.grafts).toEqual([]);
  });

  it('sends the open offer every snapshot, and the Grafts held when they change', () => {
    const { sim, self, snap } = fakeSnap();
    expect(snap().royale).not.toHaveProperty('offer');
    expect(snap().royale).not.toHaveProperty('gr');
    sim.royale.offers.set(self.id, [
      {
        grade: 'heartwood',
        cards: ['chainsap', 'rootbound', 'overgrowth'],
        offeredAt: 0,
        until: 9.5,
      },
    ]);
    expect(snap().royale!.offer).toEqual({
      g: 'heartwood',
      c: ['chainsap', 'rootbound', 'overgrowth'],
      u: 9.5,
    });
    expect(snap().royale!.offer).toBeDefined();
    sim.royale.grafts.set(self.id, ['keen_edge']);
    expect(snap().royale!.gr).toEqual(['keen_edge']);
    expect(snap().royale).not.toHaveProperty('gr');
    sim.royale.grafts.get(self.id)!.push('stoneblood');
    expect(snap().royale!.gr).toEqual(['keen_edge', 'stoneblood']);
  });

  it('carries a Heartwood on the champion, for everyone who sees it', () => {
    const { sim, self, snap } = fakeSnap();
    sim.royale.stage = 'play';
    const other = [...sim.units.values()].find((u) => u.id !== self.id)!;
    other.pos = { ...self.pos };
    other.grafts = ['quick_sap', 'chainsap'];
    const rec = snap().units.find((u) => u.i === other.id);
    expect(rec?.hw).toBe('chainsap');
    expect(snap().units.find((u) => u.i === self.id)).not.toHaveProperty('hw');
  });

  it('takes the graft action free, and refuses a card out of range', () => {
    const { sim, unitIds } = landed();
    const u = sim.units.get(unitIds[0]!)!;
    const tokens = u.decisionTokens;
    const card = sim.royale!.offers.get(u.id)![0]!.cards[2]!;
    expect(dispatchAction(sim, u.id, { kind: 'graft', pick: 3 as 0 })).toBe(false);
    expect(dispatchAction(sim, u.id, { kind: 'graft', pick: 2 })).toBe(true);
    expect(u.grafts).toEqual([card]);
    expect(u.decisionTokens).toBe(tokens);
  });

  it('changes nothing in the 5v5', () => {
    const sim = new Sim(31);
    const u = sim.addChampion(0);
    sim.tick();
    const before = { checksum: sim.checksum(), rng: sim.rng.state, tokens: u.decisionTokens };
    expect(dispatchAction(sim, u.id, { kind: 'graft', pick: 0 })).toBe(true);
    expect(sim.pickGraft(u.id, 0)).toBe(false);
    applySimCommand(sim, 0, u.id, { t: 'graft', pick: 1 });
    expect({ checksum: sim.checksum(), rng: sim.rng.state, tokens: u.decisionTokens }).toEqual(
      before,
    );
    expect(u.grafts).toEqual([]);
  });

  it('replays a graft command as the live pick', () => {
    const a = landed();
    const b = landed();
    const id = a.unitIds[1]!;
    dispatchAction(a.sim, id, { kind: 'graft', pick: 1 });
    applySimCommand(b.sim, 1, id, { t: 'graft', pick: 1 });
    expect(b.sim.units.get(id)!.grafts).toEqual(a.sim.units.get(id)!.grafts);
    expect(b.sim.royale!.grafts).toEqual(a.sim.royale!.grafts);
    expect(b.sim.checksum()).toBe(a.sim.checksum());
  });
});
