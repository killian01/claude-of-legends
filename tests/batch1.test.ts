// Batch 1 gate: the online death flow works end to end, statuses and combat
// notes ride the wire, and personal gold events stay personal.

import { describe, expect, it } from 'vitest';
import { Match } from '../server/match';
import { ClientWorld } from '../src/net/client_world';
import { Sim } from '../src/sim/sim';

function wire() {
  const match = new Match(7, [
    { clientId: 1, name: 'alice', team: 0, championId: 'sylra', sigils: ['riftstep', 'mend'] },
    { clientId: 2, name: 'bob', team: 1, championId: 'fenn', sigils: ['zephyr', 'sear'] },
  ]);
  const a = new ClientWorld((msg) => match.handleCommand(1, msg));
  const b = new ClientWorld((msg) => match.handleCommand(2, msg));
  a.applyServer({ t: 'match_start', selfUnitId: match.players.get(1)!.unitId, team: 0 });
  b.applyServer({ t: 'match_start', selfUnitId: match.players.get(2)!.unitId, team: 1 });
  const aSnaps: ReturnType<Match['buildSnapshotFor']>[] = [];
  const step = (n: number) => {
    const collected = { a: [] as typeof aSnaps, b: [] as typeof aSnaps };
    for (let i = 0; i < n; i++) {
      match.tick();
      const sa = match.buildSnapshotFor(1);
      const sb = match.buildSnapshotFor(2);
      if (sa) {
        a.applyServer(sa);
        collected.a.push(sa);
      }
      if (sb) {
        b.applyServer(sb);
        collected.b.push(sb);
      }
    }
    return collected;
  };
  return { match, a, b, step };
}

describe('online death flow', () => {
  it('keeps a dead champion in its own snapshot with the dead flag', () => {
    const sim = new Sim(9);
    const own = sim.addChampion(0, { x: 75, z: 75 });
    own.dead = true;
    const enemyView = sim.addChampion(1, { x: 90, z: 90 });
    enemyView.dead = true;
    sim.tick();
    // Own team sees its dead champion; the enemy team does not.
    expect(sim.isVisible(0, own.id)).toBe(true);
    expect(sim.isVisible(1, own.id)).toBe(false);
  });

  it('mirrors the death and the self state through the wire', () => {
    const { match, a, step } = wire();
    step(1);
    const selfId = a.selfUnitId;
    const selfUnit = match.sim.units.get(selfId)!;
    const bobUnit = match.sim.units.get(match.players.get(2)!.unitId)!;
    // Duel on open ground (away from fountain regen), and let one tick pass
    // so team vision catches up before the attack order is validated.
    selfUnit.pos = { x: 75, z: 75 };
    bobUnit.pos = { x: 77, z: 75 };
    step(1);
    selfUnit.hp = 1;
    match.handleCommand(2, { t: 'attack', targetId: selfId });
    let sawDead = false;
    for (let i = 0; i < 100 && !sawDead; i++) {
      step(1);
      const mirrored = a.units.get(selfId);
      if (mirrored?.dead) sawDead = true;
    }
    expect(sawDead, 'the dead self stays in the mirror world').toBe(true);
    const mirrored = a.units.get(selfId)!;
    expect(mirrored.dead).toBe(true);
    expect(mirrored.respawnAt).toBeGreaterThan(a.time);
  });
});

describe('statuses on the wire', () => {
  it('sends the self status list and world crowd control chips', () => {
    const { match, a, step } = wire();
    step(1);
    const selfId = a.selfUnitId;
    match.sim.units.get(selfId)!.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    match.sim.castAbility(selfId, 'E', { x: 75, z: 75 }); // Verdant Shell on self
    step(2);
    const self = a.units.get(selfId)!;
    expect(self.statuses.some((s) => s.kind === 'shield' && s.remaining > 0)).toBe(true);
  });
});

describe('combat notes on the wire', () => {
  it('delivers gold events only to the killer', () => {
    const { match, a, step } = wire();
    step(1);
    const selfId = a.selfUnitId;
    // Give alice a guaranteed last hit on open ground.
    match.sim.units.get(selfId)!.pos = { x: 75, z: 75 };
    const victim = match.sim.addChampion(1, { x: 77, z: 75 });
    step(1);
    victim.hp = 1;
    match.handleCommand(1, { t: 'attack', targetId: victim.id });
    const collected = { aGold: 0, bGold: 0 };
    for (let i = 0; i < 80; i++) {
      const snaps = step(1);
      for (const s of snaps.a) {
        if (s && s.t === 'snap') {
          for (const e of s.events) if (e.e === 'gold') collected.aGold += e.amount;
        }
      }
      for (const s of snaps.b) {
        if (s && s.t === 'snap') {
          for (const e of s.events) if (e.e === 'gold') collected.bGold += e.amount;
        }
      }
    }
    expect(collected.aGold).toBeGreaterThan(0);
    expect(collected.bGold).toBe(0);
  });

  it('scopes cast events by team vision', () => {
    const { match, step } = wire();
    step(1);
    // Bob casts at his own fountain, far outside alice's vision.
    const bobId = match.players.get(2)!.unitId;
    match.sim.units.get(bobId)!.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    match.sim.castAbility(bobId, 'W', { x: 140, z: 140 });
    const snaps = step(1);
    for (const s of snaps.a) {
      if (s && s.t === 'snap') {
        expect(s.events.some((e) => e.e === 'cast' && e.unitId === bobId)).toBe(false);
      }
    }
    let bobSawIt = false;
    for (const s of snaps.b) {
      if (s && s.t === 'snap') {
        if (s.events.some((e) => e.e === 'cast' && e.unitId === bobId)) bobSawIt = true;
      }
    }
    expect(bobSawIt).toBe(true);
  });
});
