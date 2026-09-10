// The cosmetic vfx tag: projectiles and zones remember the ability that
// spawned them ('championId_KEY' or 'sigil_id'), champion auto bolts carry
// 'championId_A' so renderers can author per-champion tracers, minion and
// tower bolts stay untagged, the tag rides the team-scoped snapshot, and
// the client mirror materializes it. Cosmetic only: the Policy observation
// has no projectile or zone channel, so the contract is untouched.

import { describe, expect, it } from 'vitest';
import { Match } from '../server/match';
import { starOrchard } from '../server/star_orchard';
import { ClientWorld } from '../src/net/client_world';
import { Sim } from '../src/sim/sim';

describe('ability vfx tags in the sim', () => {
  it('tags skillshot projectiles and zones with champion and key', () => {
    const sim = new Sim(11);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    a.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    expect(sim.castAbility(a.id, 'Q', { x: 85, z: 75 })).toBe(true);
    expect([...sim.projectiles.values()][0]?.vfx).toBe('sylra_Q');
    expect(sim.castAbility(a.id, 'W', { x: 80, z: 75 })).toBe(true);
    expect([...sim.zones.values()][0]?.vfx).toBe('sylra_W');
  });

  it('tags champion auto bolts with the champion and A', () => {
    const sim = new Sim(11);
    const a = sim.addChampion(0, { x: 75, z: 75 }, 'vesk');
    a.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    const b = sim.addChampion(1, { x: 78, z: 75 });
    b.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    sim.orderAttack(a.id, b.id);
    for (let i = 0; i < 20 && sim.projectiles.size === 0; i++) sim.tick();
    expect(sim.projectiles.size).toBeGreaterThan(0);
    expect([...sim.projectiles.values()][0]?.vfx).toBe('vesk_A');
  });
});

describe('ability vfx tags on the wire', () => {
  it('ships the tag in snapshots and the client mirror keeps it', () => {
    const match = new Match(7, [
      { clientId: 1, name: 'alice', team: 0, championId: 'sylra', sigils: ['riftstep', 'mend'] },
      { clientId: 2, name: 'bob', team: 1, championId: 'fenn', sigils: ['zephyr', 'sear'] },
    ]);
    const a = new ClientWorld((msg) => match.handleCommand(1, msg), starOrchard().map);
    a.applyServer({ t: 'match_start', selfUnitId: match.players.get(1)!.unitId, team: 0 });
    const aliceId = match.players.get(1)!.unitId;
    match.sim.units.get(aliceId)!.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    match.sim.castAbility(aliceId, 'W', { x: 20, z: 20 });
    match.tick();
    const snap = match.buildSnapshotFor(1);
    if (snap?.t !== 'snap') throw new Error('expected a snap message');
    expect(snap.zones[0]?.v).toBe('sylra_W');
    a.applyServer(snap);
    expect([...a.zones.values()][0]?.vfx).toBe('sylra_W');
  });
});
