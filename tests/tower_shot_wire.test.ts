// A tower's shot on the wire: an online client can only draw the authored
// tower missile (src/render/renderer.ts crownFlight) when it knows which
// unit the bolt homes on, so the snapshot ships the bolt's victim, and
// only when the recipient's team can see that unit.

import { describe, expect, it } from 'vitest';
import { Match } from '../server/match';
import { starOrchard } from '../server/star_orchard';
import { ClientWorld } from '../src/net/client_world';

function towerDuel(): {
  match: Match;
  aliceId: number;
  carlId: number;
  towerId: number;
} {
  const match = new Match(11, [
    { clientId: 1, name: 'alice', team: 0, championId: 'korrath', sigils: ['riftstep', 'mend'] },
    { clientId: 2, name: 'bob', team: 1, championId: 'fenn', sigils: ['zephyr', 'sear'] },
    { clientId: 3, name: 'carl', team: 0, championId: 'dain', sigils: ['riftstep', 'mend'] },
  ]);
  const aliceId = match.players.get(1)!.unitId;
  const carlId = match.players.get(3)!.unitId;
  const alice = match.sim.units.get(aliceId)!;
  const tower = [...match.sim.units.values()]
    .filter((u) => u.kind === 'tower' && u.team === 1)
    .sort((a, b) => a.pos.x - b.pos.x)[0]!;
  // Alice stands in the enemy tower's reach and will not die of it.
  alice.pos = { x: tower.pos.x + 4, z: tower.pos.z };
  alice.maxHp = 1e6;
  alice.hp = 1e6;
  return { match, aliceId, carlId, towerId: tower.id };
}

describe("a tower's shot on the wire", () => {
  it('ships the victim of a visible bolt, and the client mirrors it', () => {
    const { match, aliceId, towerId } = towerDuel();
    let bolt: { id: number; homingTargetId: number | null } | undefined;
    for (let i = 0; i < 200 && !bolt; i++) {
      match.tick();
      bolt = [...match.sim.projectiles.values()].find((p) => p.sourceId === towerId);
    }
    expect(bolt?.homingTargetId).toBe(aliceId);
    const snap = match.buildSnapshotFor(1);
    if (snap?.t !== 'snap') throw new Error('expected a snap message');
    const rec = snap.projectiles.find((p) => p.i === bolt?.id);
    expect(rec?.s).toBe(towerId);
    expect(rec?.h).toBe(aliceId);

    const client = new ClientWorld(() => undefined, starOrchard().map);
    client.applyServer({ t: 'match_start', selfUnitId: aliceId, team: 0 });
    client.applyServer(snap);
    expect(client.projectiles.get(bolt?.id ?? -1)?.homingTargetId).toBe(aliceId);
  });

  it('never names a victim the recipient cannot see', () => {
    const { match, carlId, towerId } = towerDuel();
    let bolt: { id: number; homingTargetId: number | null } | undefined;
    for (let i = 0; i < 200 && !bolt; i++) {
      match.tick();
      bolt = [...match.sim.projectiles.values()].find((p) => p.sourceId === towerId);
    }
    if (!bolt) throw new Error('the tower never fired');
    // Carl stands in his own fountain, out of the tower team's sight.
    expect(match.sim.isVisible(1, carlId)).toBe(false);
    bolt.homingTargetId = carlId;
    const snap = match.buildSnapshotFor(2);
    if (snap?.t !== 'snap') throw new Error('expected a snap message');
    const rec = snap.projectiles.find((p) => p.i === bolt?.id);
    expect(rec).toBeDefined();
    expect(rec?.h).toBeUndefined();
  });
});
