// The favors (docs/plan-rings.md): what a team holds for the rest of the
// match from the creatures it slew, one rule per aspect, measured on a
// champion. Might multiplies the damage stats, Tide gives missing health
// back every five seconds, Tempo the attack speed, Bulwark the resistances,
// Swiftness the speed out of combat and the slow resistance, Resolve the
// tenacity and the heal and shield power. Permanent: a death and a respawn
// leave every stack in place. The launch map fixture serves, since the
// grant is a sim door and no creature is needed.

import { describe, expect, it } from 'vitest';
import { applyEffects } from '../src/sim/combat/effects';
import { effectiveMoveSpeed, isStunned, slowPct } from '../src/sim/combat/status';
import { ASPECTS, TIDE_PERIOD_S } from '../src/sim/content/rings';
import { favorBonus, NO_FAVORS, outOfCombat } from '../src/sim/favors';
import { Sim } from '../src/sim/sim';
import type { CombatCtx } from '../src/sim/sim_context';
import { gainXp } from '../src/sim/stats';

const TICKS_PER_S = 20;

// A combat context over a sim, the way the systems see it (tests drive
// applyEffects directly through it).
function ctxOf(sim: Sim): CombatCtx {
  return (sim as unknown as { ctx(): CombatCtx }).ctx();
}

describe('the favors', () => {
  it('start empty and mirror the team on every champion when granted', () => {
    const sim = new Sim(11);
    const a = sim.addChampion(0, { x: 40, z: 40 });
    const b = sim.addChampion(0, { x: 42, z: 40 });
    const e = sim.addChampion(1, { x: 100, z: 100 });
    expect(a.favors).toEqual(NO_FAVORS);
    sim.grantFavor(0, 'might');
    expect(a.favors.might).toBe(1);
    expect(b.favors.might).toBe(1);
    expect(e.favors.might).toBe(0);
    expect(favorBonus(a.favors, 'might')).toBeCloseTo(ASPECTS.might.perStack, 9);
  });

  it('Might: attack damage and ability power grow by the stack', () => {
    const sim = new Sim(11);
    const a = sim.addChampion(0, { x: 40, z: 40 });
    a.items = ['spark_rod'];
    sim.grantFavor(0, 'tempo');
    const ad = a.stats.ad;
    const ap = a.stats.ap;
    sim.grantFavor(0, 'might');
    expect(a.stats.ad).toBeCloseTo(ad * (1 + ASPECTS.might.perStack), 6);
    if (ap > 0) expect(a.stats.ap).toBeCloseTo(ap * (1 + ASPECTS.might.perStack), 6);
    // Each aspect once a match (the order no longer loops): a second grant
    // changes nothing.
    sim.grantFavor(0, 'might');
    expect(a.stats.ad).toBeCloseTo(ad * (1 + ASPECTS.might.perStack), 6);
  });

  it('Bulwark and Tempo: resistances and attack speed grow by the stack', () => {
    const sim = new Sim(11);
    const a = sim.addChampion(0, { x: 40, z: 40 });
    const { armor, mr, attackSpeed } = a.stats;
    sim.grantFavor(0, 'bulwark');
    expect(a.stats.armor).toBeCloseTo(armor * (1 + ASPECTS.bulwark.perStack), 6);
    expect(a.stats.mr).toBeCloseTo(mr * (1 + ASPECTS.bulwark.perStack), 6);
    expect(a.stats.attackSpeed).toBeCloseTo(attackSpeed, 6);
    sim.grantFavor(0, 'tempo');
    expect(a.stats.attackSpeed).toBeCloseTo(attackSpeed * (1 + ASPECTS.tempo.perStack), 6);
  });

  it('Tide: a share of the missing health comes back every five seconds', () => {
    const sim = new Sim(11);
    const a = sim.addChampion(0, { x: 40, z: 40 });
    sim.grantFavor(0, 'tide');
    // Past the opening beat (tick zero is one), with no regen of its own.
    sim.tick();
    a.stats.hpRegen = 0;
    a.hp = a.maxHp / 2;
    const missing = a.maxHp - a.hp;
    // Nothing between the beats.
    sim.tick();
    expect(a.hp).toBeCloseTo(a.maxHp / 2, 3);
    // Exactly one beat inside the next five seconds.
    for (let i = 0; i < TIDE_PERIOD_S * TICKS_PER_S; i++) sim.tick();
    expect(a.hp).toBeCloseTo(a.maxHp / 2 + missing * ASPECTS.tide.perStack, 1);
  });

  it('Swiftness: speed out of combat only, and slows bite less', () => {
    const sim = new Sim(11);
    const a = sim.addChampion(0, { x: 40, z: 40 });
    const base = effectiveMoveSpeed(a, sim.time);
    sim.grantFavor(0, 'swiftness');
    expect(outOfCombat(a, sim.time)).toBe(true);
    expect(effectiveMoveSpeed(a, sim.time)).toBeCloseTo(base * (1 + ASPECTS.swiftness.perStack), 6);
    // Hit two seconds ago: in combat, no bonus.
    a.lastDamagedAt = sim.time - 2;
    expect(outOfCombat(a, sim.time)).toBe(false);
    expect(effectiveMoveSpeed(a, sim.time)).toBeCloseTo(base, 6);
    a.lastDamagedAt = -999;
    // Hitting someone two seconds ago counts the same.
    a.lastDealtDamageAt = sim.time - 2;
    expect(effectiveMoveSpeed(a, sim.time)).toBeCloseTo(base, 6);
    a.lastDealtDamageAt = -999;
    // A 40 percent slow reads as 38 with one stack.
    a.statuses.push({ kind: 'slow', until: sim.time + 5, pct: 0.4 });
    expect(slowPct(a, sim.time)).toBeCloseTo(0.4 * (1 - ASPECTS.swiftness.perStack), 9);
  });

  it('dealing damage stamps the source, so a fight ends the Swiftness', () => {
    const sim = new Sim(11);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    const b = sim.addChampion(1, { x: 77, z: 75 });
    sim.orderAttack(a.id, b.id);
    for (let i = 0; i < 40; i++) sim.tick();
    expect(b.hp).toBeLessThan(b.maxHp);
    expect(sim.time - a.lastDealtDamageAt).toBeLessThan(2);
    expect(outOfCombat(a, sim.time)).toBe(false);
  });

  it('Resolve: crowd control shortens, knockups do not, heals and shields grow', () => {
    const sim = new Sim(11);
    const a = sim.addChampion(0, { x: 40, z: 40 });
    const foe = sim.addChampion(1, { x: 44, z: 40 });
    sim.grantFavor(0, 'resolve');
    const t = ASPECTS.resolve.perStack;
    const ctx = ctxOf(sim);
    const power = { ad: 0, ap: 0, scale: 1 };
    applyEffects(ctx, foe.id, power, a, [{ kind: 'stun', duration: 1 }]);
    const stun = a.statuses.find((s) => s.kind === 'stun')!;
    expect(stun.until - sim.time).toBeCloseTo(1 - t, 9);
    applyEffects(ctx, foe.id, power, a, [{ kind: 'slow', pct: 0.4, duration: 2 }]);
    const slow = a.statuses.find((s) => s.kind === 'slow')!;
    expect(slow.until - sim.time).toBeCloseTo(2 * (1 - t), 9);
    applyEffects(ctx, foe.id, power, a, [{ kind: 'knockup', duration: 1 }]);
    const air = a.statuses.find((s) => s.kind === 'airborne')!;
    expect(air.until - sim.time).toBeCloseTo(1, 9);
    expect(isStunned(a, sim.time)).toBe(true);
    // The foe holds none: its stun lasts the whole second.
    applyEffects(ctx, a.id, power, foe, [{ kind: 'stun', duration: 1 }]);
    expect(foe.statuses.find((s) => s.kind === 'stun')!.until - sim.time).toBeCloseTo(1, 9);
    // A heal and a shield from the team that holds Resolve.
    a.hp = a.maxHp - 300;
    applyEffects(ctx, a.id, power, a, [{ kind: 'heal', base: 100 }]);
    expect(a.maxHp - a.hp).toBeCloseTo(300 - 100 * (1 + t), 6);
    applyEffects(ctx, a.id, power, a, [{ kind: 'shield', base: 100, duration: 3 }]);
    const shield = a.statuses.find((s) => s.kind === 'shield')!;
    expect(shield.remaining).toBeCloseTo(100 * (1 + t), 6);
    // The foe's heal on itself is plain.
    foe.hp = foe.maxHp - 300;
    applyEffects(ctx, foe.id, power, foe, [{ kind: 'heal', base: 100 }]);
    expect(foe.maxHp - foe.hp).toBeCloseTo(200, 6);
  });

  it('outlive a death and a respawn', () => {
    const sim = new Sim(11);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    sim.grantFavor(0, 'bulwark');
    sim.grantFavor(0, 'might');
    const { armor, ad } = a.stats;
    a.hp = 1;
    const foe = sim.addChampion(1, { x: 77, z: 75 });
    sim.orderAttack(foe.id, a.id);
    for (let i = 0; i < 60 && !a.dead; i++) sim.tick();
    expect(a.dead).toBe(true);
    for (let i = 0; i < 40 * TICKS_PER_S && a.dead; i++) sim.tick();
    expect(a.dead).toBe(false);
    expect(a.favors.bulwark).toBe(1);
    expect(a.favors.might).toBe(1);
    expect(a.stats.armor).toBeCloseTo(armor, 6);
    expect(a.stats.ad).toBeCloseTo(ad, 6);
  });

  it('keep the mirror through a level up', () => {
    const sim = new Sim(11);
    const a = sim.addChampion(0, { x: 40, z: 40 });
    sim.grantFavor(0, 'bulwark');
    const before = a.stats.armor;
    gainXp(a, 5000);
    expect(a.level).toBeGreaterThan(1);
    expect(a.stats.armor).toBeGreaterThan(before);
    expect(a.favors.bulwark).toBe(1);
  });
});
