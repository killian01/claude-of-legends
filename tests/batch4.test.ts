// Batch 4 gate: the correctness fixes from the review hold.

import { describe, expect, it } from 'vitest';
import { Match } from '../server/match';
import { healFactor, isRecalling, isRooted } from '../src/sim/combat/status';
import { Sim } from '../src/sim/sim';

describe('self-cast preference', () => {
  it('mend aimed at yourself heals YOU even next to a full-hp ally', () => {
    const sim = new Sim(23);
    const me = sim.addChampion(0, { x: 75, z: 75 });
    const ally = sim.addChampion(0, { x: 76.5, z: 75 });
    me.hp = 100;
    expect(sim.castSigil(me.id, 1, { x: me.pos.x, z: me.pos.z })).toBe(true);
    expect(me.hp).toBeCloseTo(320, 0);
    expect(ally.hp).toBe(ally.maxHp);
  });
});

describe('structures are immune to crowd control', () => {
  it('a taunt burst never retargets a tower and a stun skillshot leaves none', () => {
    const sim = new Sim(23);
    // Torv next to the enemy OUTER mid tower (vulnerable).
    const torv = sim.addChampion(0, { x: 91, z: 93 }, 'torv');
    torv.level = 6;
    const tower = [...sim.units.values()].find(
      (u) =>
        u.kind === 'tower' && u.team === 1 && u.structure?.lane === 'mid' && u.structure.tier === 1,
    )!;
    sim.tick();
    expect(sim.castAbility(torv.id, 'W', { x: torv.pos.x, z: torv.pos.z })).toBe(true);
    expect(sim.castAbility(torv.id, 'R', { x: tower.pos.x, z: tower.pos.z })).toBe(true);
    for (let i = 0; i < 30; i++) sim.tick();
    expect(tower.statuses).toHaveLength(0);
  });
});

describe('roots block dashes', () => {
  it('a rooted champion cannot riftstep or dash', () => {
    const sim = new Sim(23);
    const fenn = sim.addChampion(0, { x: 75, z: 75 }, 'fenn');
    fenn.statuses.push({ kind: 'root', until: sim.time + 5 });
    expect(isRooted(fenn, sim.time)).toBe(true);
    expect(sim.castSigil(fenn.id, 0, { x: 80, z: 75 })).toBe(false); // riftstep
    expect(sim.castAbility(fenn.id, 'Q', { x: 80, z: 75 })).toBe(false); // lunge
    expect(fenn.pos.x).toBe(75);
  });
});

describe('stealth drops auto-attackers', () => {
  it('an attacker loses its order when the target stealths', () => {
    const sim = new Sim(23);
    const attacker = sim.addChampion(0, { x: 75, z: 75 });
    const fenn = sim.addChampion(1, { x: 78, z: 75 }, 'fenn');
    sim.tick();
    sim.orderAttack(attacker.id, fenn.id);
    sim.tick();
    expect(attacker.attackTargetId).toBe(fenn.id);
    sim.castAbility(fenn.id, 'E', { x: fenn.pos.x, z: fenn.pos.z }); // smoke veil
    sim.tick();
    expect(attacker.attackTargetId).toBeNull();
  });
});

describe('death economics', () => {
  it('does not refresh ability cooldowns', () => {
    const sim = new Sim(23);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    sim.castAbility(a.id, 'Q', { x: 80, z: 75 });
    const cd = a.cooldowns.Q ?? 0;
    expect(cd).toBeGreaterThan(0);
    a.hp = 0;
    a.dead = true;
    a.respawnAt = sim.time + 0.1;
    for (let i = 0; i < 10; i++) sim.tick();
    expect(a.dead).toBe(false);
    expect(a.cooldowns.Q).toBe(cd);
  });
});

describe('grievous wounds', () => {
  it('cut shields as well as heals', () => {
    const sim = new Sim(23);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    a.statuses.push({ kind: 'grievous', until: sim.time + 10, factor: 0.4 });
    expect(healFactor(a, sim.time)).toBeCloseTo(0.6, 5);
    sim.castAbility(a.id, 'E', { x: a.pos.x, z: a.pos.z }); // Verdant Shell, base 70
    const shield = a.statuses.find((s) => s.kind === 'shield');
    expect(shield?.kind === 'shield' && Math.round(shield.remaining)).toBe(42);
  });
});

describe('fog scoping of projectiles and zones on the wire', () => {
  it('an enemy zone cast in the fog never reaches the wire', () => {
    const match = new Match(7, [
      { clientId: 1, name: 'alice', team: 0, championId: 'sylra', sigils: ['riftstep', 'mend'] },
      { clientId: 2, name: 'bob', team: 1, championId: 'sylra', sigils: ['riftstep', 'mend'] },
    ]);
    const bobId = match.players.get(2)!.unitId;
    // Bob drops his W at his own fountain, far outside alice's vision.
    match.sim.castAbility(bobId, 'W', { x: 140, z: 140 });
    match.tick();
    const aliceSnap = match.buildSnapshotFor(1);
    const bobSnap = match.buildSnapshotFor(2);
    expect(aliceSnap?.t === 'snap' && aliceSnap.zones).toHaveLength(0);
    expect(bobSnap?.t === 'snap' && bobSnap.zones.length).toBeGreaterThan(0);
  });
});

describe('recall interactions', () => {
  it('attack-move cancels a recall', () => {
    const sim = new Sim(23);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    sim.startRecall(a.id);
    expect(isRecalling(a, sim.time)).toBe(true);
    sim.orderAttackMove(a.id, 90, 75);
    expect(isRecalling(a, sim.time)).toBe(false);
  });
});
