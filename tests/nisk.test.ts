// Nisk, the Hushdart, end to end through the Sim: the fumble Pepper Dart
// lands, the charges the Sourpods are cast from, the pods hidden from
// every enemy that does not stand close (people and bots alike, one rule),
// the lurk of Lie Low, the poison Bittertip renews and Hightail's stride.

import { describe, expect, it } from 'vitest';
import { chargesOf, rechargeSeconds } from '../src/sim/combat/charges';
import { applyEffects } from '../src/sim/combat/effects';
import {
  addStatus,
  attackSpeedBonusPct,
  isFumbled,
  isStealthed,
  slowPct,
} from '../src/sim/combat/status';
import { CHAMPIONS } from '../src/sim/content/champions';
import { HIGHTAIL_MS_BASE, HIGHTAIL_MS_PER_RANK } from '../src/sim/content/champions/nisk';
import { dist } from '../src/sim/geo';
import { buildObservation } from '../src/sim/observe';
import { Sim } from '../src/sim/sim';
import { DT, type TeamId, type Vec2 } from '../src/sim/types';
import { createMinion, type Unit } from '../src/sim/unit';
import { HOME, offGround, planetSim } from './sphere_world';

function arena(
  bChampion: string,
  aPos: Vec2,
  bPos: Vec2,
  seed = 31,
): { sim: Sim; a: Unit; b: Unit } {
  const sim = new Sim(seed);
  const a = sim.addChampion(0 as TeamId, aPos, 'nisk');
  a.abilityRanks = { Q: 1, W: 1, E: 1, R: 1 };
  a.level = 6;
  const b = sim.addChampion(1 as TeamId, bPos, bChampion);
  b.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
  return { sim, a, b };
}

function ticks(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) sim.tick();
}

const pods = (sim: Sim): number => [...sim.zones.values()].filter((z) => z.trap).length;

describe('the fumble', () => {
  it('makes a fumbling striker miss: the swing is spent, nothing lands', () => {
    const { sim, b } = arena('vesk', { x: 40, z: 40 }, { x: 75, z: 75 });
    const dummy = sim.addChampion(0 as TeamId, { x: 79, z: 75 }, 'torv');
    addStatus(b, { kind: 'fumble', until: 100 });
    sim.orderAttack(b.id, dummy.id);
    let misses = 0;
    for (let i = 0; i < 80; i++) {
      for (const ev of sim.tick()) if (ev.type === 'miss' && ev.unitId === b.id) misses++;
    }
    expect(misses).toBeGreaterThan(0);
    expect(dummy.hp).toBe(dummy.maxHp);
  });

  it('is crowd control: the Resolve shortens it, structures shrug it off', () => {
    const { sim, b } = arena('vesk', { x: 40, z: 40 }, { x: 75, z: 75 });
    const ctx = (sim as unknown as { ctx(): Parameters<typeof applyEffects>[0] }).ctx();
    applyEffects(ctx, 1, { ad: 0, ap: 0 }, b, [{ kind: 'fumble', duration: 1 }]);
    expect(isFumbled(b, sim.time + 0.9)).toBe(true);
    expect(isFumbled(b, sim.time + 1.1)).toBe(false);
    const tower = [...sim.units.values()].find((u) => u.kind === 'tower')!;
    applyEffects(ctx, 1, { ad: 0, ap: 0 }, tower, [{ kind: 'fumble', duration: 1 }], 'attack');
    expect(isFumbled(tower, sim.time)).toBe(false);
  });

  it('Pepper Dart deals magic damage and fumbles its target, which every viewer reads', () => {
    const { sim, a, b } = arena('vesk', { x: 75, z: 75 }, { x: 80, z: 75 });
    expect(sim.castAbility(a.id, 'Q', { x: 80, z: 75 })).toBe(true);
    let fumbled = false;
    for (let i = 0; i < 15 && !fumbled; i++) {
      sim.tick();
      fumbled = isFumbled(b, sim.time);
    }
    expect(fumbled).toBe(true);
    expect(b.hp).toBeLessThan(b.maxHp);
    // The enemy's observation of the dart's victim, and the victim's own.
    const seen = buildObservation(sim, a.id)!.units.find((u) => u.id === b.id);
    expect(seen?.statuses?.some((s) => s.kind === 'fumble')).toBe(true);
    const own = buildObservation(sim, b.id)!.self;
    expect(own.statuses?.some((s) => s.kind === 'fumble')).toBe(true);
  });
});

describe('the charges', () => {
  it('start at one when learned, fill to the store, and every cast spends one', () => {
    const { sim, a } = arena('vesk', { x: 75, z: 75 }, { x: 95, z: 95 });
    ticks(sim, 1);
    expect(chargesOf(a, 'R')).toBe(1);
    const spec = CHAMPIONS.nisk!.abilities.R.charges!;
    ticks(sim, Math.ceil((rechargeSeconds(spec, 1) * 2) / DT) + 2);
    expect(chargesOf(a, 'R')).toBe(3);
    // Full: no more piles up.
    ticks(sim, Math.ceil(rechargeSeconds(spec, 1) / DT) + 2);
    expect(chargesOf(a, 'R')).toBe(3);
    const obs = buildObservation(sim, a.id)!;
    expect(obs.self.abilityCharges?.R).toBe(3);
    expect(obs.self.abilityReady.R).toBe(true);
    for (let i = 0; i < 3; i++) {
      expect(sim.castAbility(a.id, 'R', { x: 78, z: 75 + i })).toBe(true);
      ticks(sim, Math.ceil(CHAMPIONS.nisk!.abilities.R.cooldown / DT) + 1);
    }
    expect(chargesOf(a, 'R')).toBe(0);
    expect(buildObservation(sim, a.id)!.self.abilityReady.R).toBe(false);
    expect(sim.castAbility(a.id, 'R', { x: 78, z: 79 })).toBe(false);
  });

  it('a champion without charges reads none', () => {
    const { sim, b } = arena('vesk', { x: 75, z: 75 }, { x: 95, z: 95 });
    ticks(sim, 1);
    expect(buildObservation(sim, b.id)!.self.abilityCharges).toBeUndefined();
  });
});

describe('the Sourpods', () => {
  it('lie hidden from an enemy until one of its champions stands close', () => {
    const { sim, a, b } = arena('vesk', { x: 75, z: 75 }, { x: 75, z: 85 });
    ticks(sim, 1);
    expect(sim.castAbility(a.id, 'R', { x: 79, z: 75 })).toBe(true);
    const pod = [...sim.zones.values()].find((z) => z.trap)!;
    expect(pod).toBeDefined();
    // The planter's team sees it; the enemy, in plain sight of the spot
    // but ten meters off, does not, on the wire's rule or in a bot's eyes.
    expect(sim.zoneSeen(0 as TeamId, pod)).toBe(true);
    expect(sim.isPointVisible(1 as TeamId, pod.pos.x, pod.pos.z)).toBe(true);
    expect(sim.zoneSeen(1 as TeamId, pod)).toBe(false);
    expect(buildObservation(sim, b.id)!.zones?.some((z) => z.trap)).toBe(false);
    expect(buildObservation(sim, a.id)!.zones?.some((z) => z.trap && z.friendly)).toBe(true);
    // Close enough, it shows, and the observation flags it as a pod.
    b.pos = { x: 79, z: 78 };
    b.path = [];
    expect(sim.zoneSeen(1 as TeamId, pod)).toBe(true);
    expect(buildObservation(sim, b.id)!.zones?.some((z) => z.trap && !z.friendly)).toBe(true);
  });

  it('burst under an armed enemy step into a slowing cloud of poison, never under a minion', () => {
    const { sim, a, b } = arena('vesk', { x: 75, z: 75 }, { x: 95, z: 95 });
    ticks(sim, 1);
    expect(sim.castAbility(a.id, 'R', { x: 79, z: 75 })).toBe(true);
    const m = createMinion(9999, 1, 'melee', 'mid', { x: 79, z: 75 });
    sim.units.set(m.id, m);
    ticks(sim, Math.ceil(1.2 / DT));
    expect(pods(sim)).toBe(1);
    sim.units.delete(m.id);
    b.pos = { x: 79.3, z: 75 };
    b.path = [];
    let burst = false;
    for (let i = 0; i < 4 && !burst; i++) {
      for (const ev of sim.tick()) if (ev.type === 'trap' && ev.unitId === b.id) burst = true;
    }
    expect(burst).toBe(true);
    expect(pods(sim)).toBe(0);
    const before = b.hp;
    ticks(sim, 12);
    expect(b.hp).toBeLessThan(before);
    expect(slowPct(b, sim.time)).toBeGreaterThan(0);
  });

  it('wait out their arming beat', () => {
    const { sim, a, b } = arena('vesk', { x: 75, z: 75 }, { x: 79, z: 75.4 });
    ticks(sim, 1);
    b.path = [];
    expect(sim.castAbility(a.id, 'R', { x: 79, z: 75 })).toBe(true);
    ticks(sim, Math.floor(0.8 / DT));
    expect(pods(sim)).toBe(1);
    ticks(sim, Math.ceil(0.4 / DT));
    expect(pods(sim)).toBe(0);
  });

  it('keep at most five of a planter on the ground, the oldest going first', () => {
    const { sim, a } = arena('vesk', { x: 75, z: 75 }, { x: 140, z: 140 });
    ticks(sim, 1);
    const spec = CHAMPIONS.nisk!.abilities.R.charges!;
    for (let i = 0; i < 6; i++) {
      a.charges.R = { count: spec.max, nextAt: sim.time + 30 };
      a.cooldowns.R = 0;
      a.mana = a.maxMana;
      expect(sim.castAbility(a.id, 'R', { x: 76 + i * 0.8, z: 78 })).toBe(true);
      // The decision budget refills between two presses.
      ticks(sim, 10);
    }
    const left = [...sim.zones.values()].filter((z) => z.trap);
    expect(left).toHaveLength(5);
    expect(left.some((z) => Math.abs(z.pos.x - 76) < 1e-6)).toBe(false);
  });

  it('wither after three minutes', () => {
    const { sim, a } = arena('vesk', { x: 75, z: 75 }, { x: 140, z: 140 });
    ticks(sim, 1);
    expect(sim.castAbility(a.id, 'R', { x: 79, z: 75 })).toBe(true);
    ticks(sim, Math.ceil(179 / DT));
    expect(pods(sim)).toBe(1);
    ticks(sim, Math.ceil(2 / DT));
    expect(pods(sim)).toBe(0);
  });

  it('work on the planet: planted on the sphere, burst there, the cloud on the ground', () => {
    const sim = planetSim();
    const a = sim.addChampion(0 as TeamId, HOME, 'nisk');
    a.abilityRanks = { Q: 1, W: 1, E: 1, R: 1 };
    a.level = 6;
    sim.tick();
    const aim = { x: HOME.x + 3, y: HOME.y, z: HOME.z };
    expect(sim.castAbility(a.id, 'R', aim)).toBe(true);
    const pod = [...sim.zones.values()].find((z) => z.trap)!;
    expect(offGround(pod.pos)).toBeNull();
    expect(dist(pod.pos, a.pos)).toBeLessThanOrEqual(6 + 1e-6);
    ticks(sim, Math.ceil(1.2 / DT));
    const b = sim.addChampion(1 as TeamId, pod.pos, 'vesk');
    b.path = [];
    ticks(sim, 2);
    expect(pods(sim)).toBe(0);
    const cloud = [...sim.zones.values()].find((z) => z.vfx === 'nisk_R')!;
    expect(cloud).toBeDefined();
    expect(offGround(cloud.pos)).toBeNull();
  });
});

describe('Lie Low', () => {
  it('hides Nisk after keeping still, and a step in the open shows it again', () => {
    // Out of its own reach, or idle defense would have it shoot (an act).
    const { sim, a, b } = arena('vesk', { x: 75, z: 75 }, { x: 84, z: 75 });
    ticks(sim, 2);
    expect(sim.isVisible(1 as TeamId, a.id)).toBe(true);
    ticks(sim, Math.ceil(1.6 / DT));
    expect(isStealthed(a, sim.time)).toBe(true);
    expect(sim.isVisible(1 as TeamId, a.id)).toBe(false);
    expect(buildObservation(sim, b.id)!.units.some((u) => u.id === a.id)).toBe(false);
    // Its own team still sees it.
    const mate = sim.addChampion(0 as TeamId, { x: 72, z: 75 }, 'torv');
    expect(buildObservation(sim, mate.id)!.units.some((u) => u.id === a.id)).toBe(true);
    sim.orderMove(a.id, 75, 71);
    ticks(sim, 2);
    expect(isStealthed(a, sim.time)).toBe(false);
    expect(sim.isVisible(1 as TeamId, a.id)).toBe(true);
  });

  it('keeps Nisk hidden while it walks inside one brush, and shows it when it leaves', () => {
    const { sim, a } = arena('vesk', { x: 69, z: 82 }, { x: 74, z: 76 });
    ticks(sim, Math.ceil(1.6 / DT));
    expect(isStealthed(a, sim.time)).toBe(true);
    sim.orderMove(a.id, 71, 82);
    ticks(sim, 8);
    expect(isStealthed(a, sim.time)).toBe(true);
    sim.orderMove(a.id, 76, 82);
    ticks(sim, 40);
    expect(isStealthed(a, sim.time)).toBe(false);
  });

  it('an attack ends the hiding and the first one swings with the burst', () => {
    const { sim, a, b } = arena('vesk', { x: 75, z: 75 }, { x: 79, z: 75 });
    // Both held still on a stop order, so idle defense keeps its hands off.
    sim.orderStop(a.id);
    sim.orderStop(b.id);
    ticks(sim, Math.ceil(1.6 / DT));
    expect(isStealthed(a, sim.time)).toBe(true);
    expect(attackSpeedBonusPct(a, sim.time)).toBeCloseTo(0.6, 6);
    sim.orderAttack(a.id, b.id);
    ticks(sim, 2);
    expect(isStealthed(a, sim.time)).toBe(false);
    // The burst carries on for its span after the swing that ended it.
    ticks(sim, Math.floor(2 / DT));
    expect(attackSpeedBonusPct(a, sim.time)).toBeCloseTo(0.6, 6);
    ticks(sim, Math.ceil(1 / DT));
    expect(attackSpeedBonusPct(a, sim.time)).toBe(0);
  });

  it('taking damage restarts the count', () => {
    const { sim, a } = arena('vesk', { x: 75, z: 75 }, { x: 130, z: 130 });
    for (let i = 0; i < Math.ceil(1.6 / DT); i++) {
      if (i % 10 === 0) a.lastDamagedAt = sim.time;
      sim.tick();
    }
    expect(isStealthed(a, sim.time)).toBe(false);
  });

  it('is a passive of its own: no other champion lurks', () => {
    const { sim, b } = arena('vesk', { x: 75, z: 75 }, { x: 100, z: 75 });
    ticks(sim, Math.ceil(2 / DT));
    expect(b.lurk).toBeNull();
    expect(isStealthed(b, sim.time)).toBe(false);
  });
});

describe('Bittertip and Hightail', () => {
  it('every dart for a few seconds poisons, each hit renewing the one poison', () => {
    const { sim, a, b } = arena('torv', { x: 75, z: 75 }, { x: 79, z: 75 });
    expect(sim.castAbility(a.id, 'E', a.pos)).toBe(true);
    sim.orderAttack(a.id, b.id);
    ticks(sim, Math.ceil(4 / DT));
    const dots = b.statuses.filter((s) => s.kind === 'dot' && s.sourceId === a.id);
    expect(dots).toHaveLength(1);
    const until = dots[0]!.until;
    ticks(sim, Math.ceil(1.6 / DT));
    const later = b.statuses.filter((s) => s.kind === 'dot' && s.sourceId === a.id);
    expect(later).toHaveLength(1);
    expect(later[0]!.until).toBeGreaterThan(until);
  });

  it('Hightail makes Nisk a little faster at all times once learned, more per rank', () => {
    const { sim, a } = arena('vesk', { x: 75, z: 75 }, { x: 130, z: 130 });
    a.abilityRanks.W = 3;
    ticks(sim, 10);
    const msBuffs = a.statuses.filter((s) => s.kind === 'buff' && s.msPct > 0);
    expect(msBuffs).toHaveLength(1);
    const buff = msBuffs[0]!;
    if (buff.kind === 'buff') {
      expect(buff.msPct).toBeCloseTo(HIGHTAIL_MS_BASE + 3 * HIGHTAIL_MS_PER_RANK, 9);
    }
    a.abilityRanks.W = 0;
    ticks(sim, 20);
    expect(a.statuses.some((s) => s.kind === 'buff' && s.msPct > 0)).toBe(false);
  });
});
