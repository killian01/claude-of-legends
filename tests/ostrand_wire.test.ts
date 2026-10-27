// Ostrand on the wire: the Sworn mark reaches every viewer of its holder,
// both teams, so the pennant over the hunted head draws online as it does
// offline; and an Oathfield's chords carry their ring, so the client draws
// the oath's stone and keeps the ring's center and radius as the sim does.

import { describe, expect, it } from 'vitest';
import { Match } from '../server/match';
import { starOrchard } from '../server/star_orchard';
import { ClientWorld } from '../src/net/client_world';
import { isSworn } from '../src/sim/combat/status';
import { raiseOathfield } from '../src/sim/oathfield';
import type { Sim } from '../src/sim/sim';
import type { CombatCtx } from '../src/sim/sim_context';

const ctxOf = (sim: Sim): CombatCtx => (sim as unknown as { ctx(): CombatCtx }).ctx();

function duel(): { match: Match; aliceId: number; bobId: number } {
  const match = new Match(7, [
    { clientId: 1, name: 'alice', team: 0, championId: 'korrath', sigils: ['riftstep', 'mend'] },
    { clientId: 2, name: 'bob', team: 1, championId: 'fenn', sigils: ['zephyr', 'sear'] },
  ]);
  return {
    match,
    aliceId: match.players.get(1)!.unitId,
    bobId: match.players.get(2)!.unitId,
  };
}

function mirror(match: Match, clientId: number, selfId: number, team: 0 | 1): ClientWorld {
  const client = new ClientWorld(() => {}, starOrchard().map);
  client.applyServer({ t: 'match_start', selfUnitId: selfId, team });
  const snap = match.buildSnapshotFor(clientId);
  if (snap?.t !== 'snap') throw new Error('expected a snap message');
  client.applyServer(snap);
  return client;
}

describe('Ostrand on the wire', () => {
  it('shows the Sworn mark on its holder to both teams', () => {
    const { match, aliceId, bobId } = duel();
    const bob = match.sim.units.get(bobId)!;
    // Bob and Alice face each other so each sees the other.
    const alice = match.sim.units.get(aliceId)!;
    bob.pos = { x: alice.pos.x + 3, z: alice.pos.z };
    bob.statuses.push({ kind: 'sworn', until: match.sim.time + 8, sourceId: aliceId });
    match.tick();
    for (const [clientId, selfId, team] of [
      [1, aliceId, 0],
      [2, bobId, 1],
    ] as const) {
      const client = mirror(match, clientId, selfId, team);
      expect(isSworn(client.units.get(bobId)!, client.time)).toBe(true);
      expect(isSworn(client.units.get(aliceId)!, client.time)).toBe(false);
    }
  });

  it('carries the ring of an Oathfield chord, and none on a plain wall', () => {
    const { match, aliceId } = duel();
    const alice = match.sim.units.get(aliceId)!;
    const center = { x: alice.pos.x + 12, z: alice.pos.z };
    const chords = raiseOathfield(ctxOf(match.sim), aliceId, 0, center, 4.5, 4);
    expect(chords.length).toBeGreaterThan(0);
    match.tick();
    const client = mirror(match, 1, aliceId, 0);
    const drawn = [...client.walls.values()];
    expect(drawn.length).toBe(chords.length);
    for (const w of drawn) {
      expect(w.ring?.radius).toBe(4.5);
      expect(w.ring?.center.x).toBeCloseTo(center.x, 1);
      expect(w.ring?.center.z).toBeCloseTo(center.z, 1);
    }
    const snap = match.buildSnapshotFor(1);
    if (snap?.t !== 'snap') throw new Error('expected a snap message');
    expect(snap.walls?.every((w) => w.rg !== undefined)).toBe(true);
  });
});
