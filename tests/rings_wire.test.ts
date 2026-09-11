// The rings on the wire (ADR 0022): a server snapshot carries the rings'
// clocks, a creature's identity and aspect in its identity block, and both
// teams' favors in the self block; the client mirror reads them back into
// the same IWorld doors the offline sim answers, so the HUD, the minimap
// and the renderer read one shape on every host.

import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../server/snapshot';
import { starOrchard } from '../server/star_orchard';
import { ClientWorld } from '../src/net/client_world';
import { NO_FAVORS } from '../src/sim/favors';
import { Sim } from '../src/sim/sim';
import { TerrainNavGrid } from '../src/sim/terrain_nav';

const TICKS_PER_S = 20;

function orchardSim(seed = 11): Sim {
  const orchard = starOrchard();
  return new Sim(seed, {
    map: orchard.map,
    nav: new TerrainNavGrid(orchard.navigation),
    strictNavigation: true,
  });
}

function mirror(sim: Sim, team: 0 | 1, selfUnitId: number): ClientWorld {
  const client = new ClientWorld(() => undefined, starOrchard().map);
  client.applyServer({ t: 'match_start', selfUnitId, team });
  client.applyServer(buildSnapshot(sim, team, selfUnitId, new Set(), []));
  return client;
}

describe('the rings on the wire', () => {
  it('carries the clocks, and nothing about favors nobody holds', () => {
    const sim = orchardSim();
    const me = sim.addChampion(0);
    sim.tick();
    const snap = buildSnapshot(sim, 0, me.id, new Set(), []);
    expect(snap.t).toBe('snap');
    if (snap.t !== 'snap') return;
    expect(snap.rings?.map((r) => [r.r, r.u, r.at, r.a])).toEqual([
      ['top', null, 390, 'bulwark'],
      ['bot', null, 240, 'might'],
    ]);
    expect(snap.self?.favors).toBeUndefined();
    expect(snap.self?.enemyFavors).toBeUndefined();
    const client = mirror(sim, 0, me.id);
    expect(client.ringClocks()).toEqual(sim.ringClocks());
    expect(client.teamFavors(0)).toEqual(NO_FAVORS);
    expect(client.teamFavors(1)).toEqual(NO_FAVORS);
  });

  it("mirrors a live creature, its aspect, and both teams' favors", () => {
    const sim = orchardSim();
    const me = sim.addChampion(0);
    const foe = sim.addChampion(1);
    const state = sim.ringStates.find((s) => s.ring === 'bot')!;
    state.nextRiseAt = sim.time;
    for (let i = 0; i < 2 * TICKS_PER_S; i++) sim.tick();
    sim.grantFavor(0, 'might');
    sim.grantFavor(0, 'might');
    sim.grantFavor(1, 'bulwark');
    sim.tick();
    const creature = [...sim.units.values()].find((u) => u.kind === 'creature')!;
    expect(creature).toBeDefined();

    const mine = mirror(sim, 0, me.id);
    expect(mine.ringClocks()).toEqual(sim.ringClocks());
    expect(mine.ringClocks().find((c) => c.ring === 'bot')?.unitId).toBe(creature.id);
    expect(mine.teamFavors(0)).toEqual({ ...NO_FAVORS, might: 2 });
    expect(mine.teamFavors(1)).toEqual({ ...NO_FAVORS, bulwark: 1 });
    const seen = mine.units.get(creature.id)!;
    expect(seen).toBeDefined();
    expect(seen.kind).toBe('creature');
    expect(seen.neutral).toBe(true);
    expect(seen.creatureId).toBe('pyrefang');
    expect(seen.aspect).toBe('might');
    expect(mine.isVisible(0, creature.id)).toBe(true);

    // The other side reads its own favors as its own, and the enemy's as
    // the enemy's.
    const theirs = mirror(sim, 1, foe.id);
    expect(theirs.teamFavors(1)).toEqual({ ...NO_FAVORS, bulwark: 1 });
    expect(theirs.teamFavors(0)).toEqual({ ...NO_FAVORS, might: 2 });
    expect(theirs.units.get(creature.id)?.aspect).toBe('might');
  });
});
