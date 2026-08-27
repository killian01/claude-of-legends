// The spell presentation wire: cast events carry their ability key, and a
// champion charging a windup cast ships the pending spell (key, aim,
// resolve time) with its snapshot record, so every client that can see the
// caster can draw the telegraph. Cosmetic only: the Policy observation is
// untouched.

import { describe, expect, it } from 'vitest';
import { Match } from '../server/match';
import { ClientWorld } from '../src/net/client_world';

function veskMatch(): { match: Match; veskId: number } {
  const match = new Match(7, [
    { clientId: 1, name: 'alice', team: 0, championId: 'vesk', sigils: ['riftstep', 'mend'] },
    { clientId: 2, name: 'bob', team: 1, championId: 'fenn', sigils: ['zephyr', 'sear'] },
  ]);
  const veskId = match.players.get(1)!.unitId;
  const vesk = match.sim.units.get(veskId)!;
  vesk.level = 6;
  vesk.abilityRanks = { Q: 1, W: 1, E: 1, R: 1 };
  return { match, veskId };
}

describe('spell wire', () => {
  it('cast events carry the ability key', () => {
    const { match, veskId } = veskMatch();
    expect(match.sim.castAbility(veskId, 'Q', { x: 40, z: 40 })).toBe(true);
    match.tick();
    const snap = match.buildSnapshotFor(1);
    if (snap?.t !== 'snap') throw new Error('expected a snap message');
    const cast = snap.events.find((e) => e.e === 'cast');
    expect(cast).toBeDefined();
    if (cast?.e === 'cast') {
      expect(cast.unitId).toBe(veskId);
      expect(cast.k).toBe('Q');
    }
  });

  it('a windup rides the wire with key, aim, and resolve time, then clears', () => {
    const { match, veskId } = veskMatch();
    expect(match.sim.castAbility(veskId, 'R', { x: 40, z: 44 })).toBe(true);
    match.tick();
    const snap = match.buildSnapshotFor(1);
    if (snap?.t !== 'snap') throw new Error('expected a snap message');
    const rec = snap.units.find((u) => u.i === veskId);
    expect(rec?.w).toBeDefined();
    expect(rec?.w?.k).toBe('R');
    expect(rec?.w?.x).toBeCloseTo(40, 1);
    expect(rec?.w?.z).toBeCloseTo(44, 1);
    expect(rec?.w?.u).toBeGreaterThan(snap.time);

    // The client mirror materializes the pending spell for the renderer.
    const client = new ClientWorld(() => undefined);
    client.applyServer({ t: 'match_start', selfUnitId: veskId, team: 0 });
    client.applyServer(snap);
    const mirrored = client.units.get(veskId);
    expect(mirrored?.pendingSpell?.key).toBe('R');
    expect(mirrored?.pendingSpell?.aim.x).toBeCloseTo(40, 1);

    // Past the 0.6 s windup the telegraph leaves the wire and the mirror.
    for (let i = 0; i < 14; i++) match.tick();
    const later = match.buildSnapshotFor(1);
    if (later?.t !== 'snap') throw new Error('expected a snap message');
    expect(later.units.find((u) => u.i === veskId)?.w).toBeUndefined();
    client.applyServer(later);
    expect(client.units.get(veskId)?.pendingSpell).toBeNull();
  });

  it('sigil casts relay as keyless cast events', () => {
    const { match, veskId } = veskMatch();
    expect(match.sim.castSigil(veskId, 1, { x: 40, z: 40 })).toBe(true);
    match.tick();
    const snap = match.buildSnapshotFor(1);
    if (snap?.t !== 'snap') throw new Error('expected a snap message');
    const cast = snap.events.find((e) => e.e === 'cast');
    expect(cast).toBeDefined();
    if (cast?.e === 'cast') {
      expect(cast.unitId).toBe(veskId);
      expect(cast.k).toBeUndefined();
    }
  });
});
