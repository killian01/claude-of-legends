// Ysmer, the Turnlamp, through the Sim (docs/design/ysmer.md, slice 1): the
// release switch, Changeling Spark trading her with the enemy champion it
// strikes, In My Stead reaching the champion nearest the aim on either
// side (refused, unpaid, with nobody there; never a hidden enemy), the
// trade across an Oathfield's rim, Hung Lantern's way back, Homeward Glow,
// and the trade's own refusals.

import { describe, expect, it } from 'vitest';
import { addStatus, isRooted, slowPct } from '../src/sim/combat/status';
import { tradePlaces } from '../src/sim/combat/swap';
import { CHAMPION_LIST, CHAMPIONS, UNRELEASED_CHAMPIONS } from '../src/sim/content/champions';
import { GLOW_MS_PCT } from '../src/sim/content/champions/ysmer';
import { dist } from '../src/sim/geo';
import { passiveOf } from '../src/sim/passives';
import { Sim } from '../src/sim/sim';
import type { TeamId, Vec2 } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';

const C: Vec2 = { x: 75, z: 75 };

function arena(seed = 43): { sim: Sim; y: Unit } {
  const sim = new Sim(seed);
  const y = sim.addChampion(0 as TeamId, C, 'ysmer');
  y.abilityRanks = { Q: 1, W: 1, E: 1, R: 1 };
  y.level = 6;
  y.mana = y.maxMana;
  return { sim, y };
}

function champ(sim: Sim, team: number, at: Vec2, id = 'torv'): Unit {
  const u = sim.addChampion(team as TeamId, at, id);
  u.abilityRanks = { Q: 1, W: 1, E: 1, R: 1 };
  u.level = 6;
  return u;
}

function ticks(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) sim.tick();
}

const hasShield = (u: Unit, sim: Sim): boolean =>
  u.statuses.some((s) => s.kind === 'shield' && s.until > sim.time && s.remaining > 0);

type Ctx = Parameters<typeof tradePlaces>[0];
const ctxOf = (sim: Sim): Ctx => (sim as unknown as { ctx(): Ctx }).ctx();

describe('the release switch', () => {
  it('keeps Ysmer out of every pick while the match registry can still field her', () => {
    expect(CHAMPION_LIST.some((c) => c.id === 'ysmer')).toBe(false);
    expect(CHAMPIONS.ysmer).toBeUndefined();
    expect(UNRELEASED_CHAMPIONS.ysmer?.released).toBe(false);
    const { y } = arena();
    expect(y.championId).toBe('ysmer');
  });
});

describe('Changeling Spark', () => {
  it('trades her with the enemy champion it strikes, and slows it where she stood', () => {
    const { sim, y } = arena();
    const foe = champ(sim, 1, { x: 81, z: 75 });
    const from = { ...y.pos };
    const there = { ...foe.pos };
    const hp = foe.hp;
    expect(sim.castAbility(y.id, 'E', { x: 85, z: 75 })).toBe(true);
    ticks(sim, 10);
    expect(foe.hp).toBeLessThan(hp);
    expect(dist(y.pos, there)).toBeLessThan(1.2);
    expect(dist(foe.pos, from)).toBeLessThan(1.2);
    expect(slowPct(foe, sim.time)).toBeGreaterThan(0);
  });

  it('moves nobody when it flies past every champion', () => {
    const { sim, y } = arena();
    const foe = champ(sim, 1, { x: 75, z: 81 });
    const from = { ...y.pos };
    const there = { ...foe.pos };
    expect(sim.castAbility(y.id, 'E', { x: 85, z: 75 })).toBe(true);
    ticks(sim, 12);
    expect(dist(y.pos, from)).toBeLessThan(0.5);
    expect(dist(foe.pos, there)).toBeLessThan(0.5);
  });

  it('carries her across a standing Oathfield, as any blink clears its rim', () => {
    const { sim, y } = arena();
    const ostrand = champ(sim, 1, { x: 82, z: 75 }, 'ostrand');
    ostrand.mana = ostrand.maxMana;
    const ally = champ(sim, 0, { x: 84, z: 75 }, 'dain');
    expect(sim.castAbility(ostrand.id, 'R', ally.pos)).toBe(true);
    ticks(sim, 2);
    const ringAt = { ...ostrand.pos };
    expect(sim.castAbility(y.id, 'E', { x: 90, z: 75 })).toBe(true);
    ticks(sim, 10);
    // She stands inside the ring now, where Ostrand stood; he is outside.
    expect(dist(y.pos, ringAt)).toBeLessThan(1.5);
    expect(dist(ostrand.pos, C)).toBeLessThan(1.5);
  });
});

describe('In My Stead', () => {
  it('is refused and costs nothing with no champion near the aim', () => {
    const { sim, y } = arena();
    champ(sim, 0, { x: 75, z: 82 }, 'dain');
    const mana = y.mana;
    expect(sim.castAbility(y.id, 'R', { x: 84, z: 75 })).toBe(false);
    expect(y.mana).toBe(mana);
    expect(y.cooldowns.R ?? 0).toBeLessThanOrEqual(sim.time);
  });

  it('swaps an ally out of harm and shields both of them', () => {
    const { sim, y } = arena();
    const ally = champ(sim, 0, { x: 84, z: 75 }, 'vesk');
    const from = { ...y.pos };
    const there = { ...ally.pos };
    expect(sim.castAbility(y.id, 'R', there)).toBe(true);
    expect(dist(y.pos, there)).toBeLessThan(1e-9);
    expect(dist(ally.pos, from)).toBeLessThan(1e-9);
    expect(hasShield(ally, sim)).toBe(true);
    expect(hasShield(y, sim)).toBe(true);
    expect(isRooted(ally, sim.time)).toBe(false);
  });

  it('brings an enemy into her place and holds it there', () => {
    const { sim, y } = arena();
    const foe = champ(sim, 1, { x: 85, z: 75 }, 'vesk');
    const from = { ...y.pos };
    expect(sim.castAbility(y.id, 'R', { x: 85.5, z: 75 })).toBe(true);
    expect(dist(foe.pos, from)).toBeLessThan(1e-9);
    expect(dist(y.pos, { x: 85, z: 75 })).toBeLessThan(1e-9);
    expect(isRooted(foe, sim.time)).toBe(true);
    expect(hasShield(foe, sim)).toBe(false);
  });

  it('breaks the recall of the enemy it brings in: a held enemy does not go home', () => {
    const { sim, y } = arena();
    const foe = champ(sim, 1, { x: 85, z: 75 }, 'vesk');
    sim.startRecall(foe.id);
    expect(foe.statuses.some((s) => s.kind === 'recall')).toBe(true);
    expect(sim.castAbility(y.id, 'R', foe.pos)).toBe(true);
    expect(foe.statuses.some((s) => s.kind === 'recall')).toBe(false);
  });

  it('reaches an ally hidden in stealth, but nobody untargetable on either side', () => {
    const { sim, y } = arena();
    const ally = champ(sim, 0, { x: 84, z: 75 }, 'fenn');
    addStatus(ally, { kind: 'untargetable', until: sim.time + 5 });
    const mana = y.mana;
    expect(sim.castAbility(y.id, 'R', ally.pos)).toBe(false);
    expect(y.mana).toBe(mana);
    ally.statuses = ally.statuses.filter((s) => s.kind !== 'untargetable');
    addStatus(ally, { kind: 'stealth', until: sim.time + 5 });
    expect(sim.castAbility(y.id, 'R', { x: 84, z: 75 })).toBe(true);
    expect(dist(ally.pos, C)).toBeLessThan(1e-9);
  });

  it('never reaches an enemy hidden in stealth', () => {
    const { sim, y } = arena();
    const foe = champ(sim, 1, { x: 84, z: 75 }, 'fenn');
    addStatus(foe, { kind: 'stealth', until: sim.time + 5 });
    expect(sim.castAbility(y.id, 'R', foe.pos)).toBe(false);
  });

  it('works where everyone is an enemy: four sides, no ally at all', () => {
    const sim = new Sim(43, { teamCount: 4 });
    const y = sim.addChampion(0 as TeamId, C, 'ysmer');
    y.abilityRanks = { Q: 1, W: 1, E: 1, R: 1 };
    y.level = 6;
    y.mana = y.maxMana;
    const foe = sim.addChampion(3 as TeamId, { x: 80, z: 75 }, 'sylra');
    expect(sim.castAbility(y.id, 'R', foe.pos)).toBe(true);
    expect(dist(foe.pos, C)).toBeLessThan(1e-9);
    expect(isRooted(foe, sim.time)).toBe(true);
  });
});

describe('Hung Lantern', () => {
  it('brings her back to the lantern when pressed again', () => {
    const { sim, y } = arena();
    const at = { ...y.pos };
    expect(sim.castAbility(y.id, 'W', { x: 80, z: 75 })).toBe(true);
    sim.orderMove(y.id, 75, 83);
    ticks(sim, 30);
    expect(dist(y.pos, at)).toBeGreaterThan(3);
    expect(sim.castAbility(y.id, 'W', y.pos)).toBe(true);
    expect(dist(y.pos, at)).toBeLessThan(0.5);
  });
});

describe('Homeward Glow', () => {
  it('speeds a wounded ally near her, not a healthy one or a far one', () => {
    const { sim, y } = arena();
    const near = champ(sim, 0, { x: 78, z: 75 }, 'vesk');
    const well = champ(sim, 0, { x: 75, z: 78 }, 'maera');
    const far = champ(sim, 0, { x: 90, z: 75 }, 'dain');
    near.hp = near.maxHp * 0.2;
    far.hp = far.maxHp * 0.2;
    y.hp = y.maxHp * 0.2;
    passiveOf(y)!.onTick!(ctxOf(sim), y);
    const glow = (u: Unit) =>
      u.statuses.some((s) => s.kind === 'buff' && s.msPct === GLOW_MS_PCT && s.until > sim.time);
    expect(glow(near)).toBe(true);
    expect(glow(y)).toBe(true);
    expect(glow(well)).toBe(false);
    expect(glow(far)).toBe(false);
  });
});

describe('trading places', () => {
  it('refuses a dead unit and a structure, and ends a flight in progress', () => {
    const { sim, y } = arena();
    const foe = champ(sim, 1, { x: 80, z: 75 });
    const ctx = ctxOf(sim);
    foe.hp = 0;
    expect(tradePlaces(ctx, y, foe)).toBe(false);
    foe.hp = foe.maxHp;
    const tower = [...sim.units.values()].find((u) => u.kind === 'tower');
    if (tower) expect(tradePlaces(ctx, y, tower)).toBe(false);
    expect(tradePlaces(ctx, y, y)).toBe(false);
    addStatus(foe, { kind: 'untargetable', until: sim.time + 1 });
    expect(tradePlaces(ctx, y, foe)).toBe(false);
    foe.statuses = foe.statuses.filter((s) => s.kind !== 'untargetable');
    foe.activeDash = {
      from: { ...foe.pos },
      dir: { x: 1, z: 0 },
      speed: 10,
      remaining: 5,
      traveled: 0,
      landRadius: 0,
      onLand: [],
      selfEffects: [],
      passThrough: [],
      hitIds: new Set(),
      power: { ad: 0, ap: 0 },
      vfx: null,
    };
    expect(tradePlaces(ctx, y, foe)).toBe(true);
    expect(foe.activeDash).toBeNull();
    expect(dist(foe.pos, C)).toBeLessThan(1e-9);
  });

  it('plays out the same on every run of a seed', () => {
    const run = (): number => {
      const { sim, y } = arena(7);
      const foe = champ(sim, 1, { x: 81, z: 75 });
      sim.castAbility(y.id, 'E', foe.pos);
      ticks(sim, 40);
      // The spark traded them: she stands where the enemy stood.
      expect(dist(y.pos, { x: 81, z: 75 })).toBeLessThan(1.5);
      sim.castAbility(y.id, 'R', foe.pos);
      ticks(sim, 40);
      return sim.checksum();
    };
    expect(run()).toBe(run());
  });
});
