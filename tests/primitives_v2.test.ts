// The kits-v2 engine primitives, driven directly through the combat seam:
// conditional effects, directional knockbacks, cooldown refunds, empowered
// attacks, traveling dashes, chains, walls, reveal zones, shield bursts,
// per-rank overrides, and the recast window (ADR 0005).

import { describe, expect, it } from 'vitest';
import { type AbilityDef, castAbility, executeCast, specForRank } from '../src/sim/combat/casting';
import { applyEffects, type EffectSpec } from '../src/sim/combat/effects';
import { stepShieldBursts } from '../src/sim/combat/shield_burst';
import { addStatus, isStunned } from '../src/sim/combat/status';
import { CHAMPIONS } from '../src/sim/content/champions';
import { stepDashes } from '../src/sim/dashes';
import { NavGrid } from '../src/sim/navgrid';
import { stepProjectiles } from '../src/sim/projectiles';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import type { CombatCtx } from '../src/sim/sim_context';
import { TeamBuffs } from '../src/sim/team_buffs';
import { DT } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';
import { createChampion } from '../src/sim/unit';
import { computeVisibility } from '../src/sim/vision';
import { raiseWall, stepWalls } from '../src/sim/walls';
import { stepZones } from '../src/sim/zones';

function mkCtx(nav = new NavGrid(40, [], 0)): { ctx: CombatCtx; advance: (s: number) => void } {
  let time = 0;
  let nextId = 100;
  const ctx: CombatCtx = {
    get time() {
      return time;
    },
    rng: new Rng(7),
    nav,
    units: new Map(),
    projectiles: new Map(),
    zones: new Map(),
    walls: new Map(),
    events: [],
    dead: new Set(),
    killers: new Map(),
    teamBuffs: new TeamBuffs(),
    allocId: () => nextId++,
  };
  return { ctx, advance: (s: number) => (time += s) };
}

function champ(ctx: CombatCtx, id: number, team: 0 | 1, x: number, z: number): Unit {
  const u = createChampion(id, team, { x, z }, CHAMPIONS.sylra!);
  ctx.units.set(id, u);
  return u;
}

const POWER = { ad: 0, ap: 0 };

describe('conditional effects', () => {
  it('branches on distance traveled', () => {
    const { ctx } = mkCtx();
    const target = champ(ctx, 2, 1, 0, 0);
    const spec: EffectSpec = {
      kind: 'conditional',
      when: { kind: 'distanceAtLeast', distance: 6 },
      effects: [{ kind: 'root', duration: 1 }],
      otherwise: [{ kind: 'slow', pct: 0.3, duration: 1 }],
    };
    applyEffects(ctx, 1, POWER, target, [spec], 'ability', { distance: 7 });
    expect(target.statuses.some((s) => s.kind === 'root')).toBe(true);
    target.statuses = [];
    applyEffects(ctx, 1, POWER, target, [spec], 'ability', { distance: 3 });
    expect(target.statuses.some((s) => s.kind === 'slow')).toBe(true);
    expect(target.statuses.some((s) => s.kind === 'root')).toBe(false);
  });

  it('branches on target isolation', () => {
    const { ctx } = mkCtx();
    const target = champ(ctx, 2, 1, 10, 10);
    const spec: EffectSpec = {
      kind: 'conditional',
      when: { kind: 'targetIsolated', radius: 4 },
      effects: [{ kind: 'damage', base: 100, dtype: 'true' }],
    };
    applyEffects(ctx, 1, POWER, target, [spec]);
    expect(target.maxHp - target.hp).toBe(100);
    // A nearby teammate breaks isolation.
    champ(ctx, 3, 1, 12, 10);
    const before = target.hp;
    applyEffects(ctx, 1, POWER, target, [spec]);
    expect(target.hp).toBe(before);
  });

  it('branches on the target already being slowed', () => {
    const { ctx } = mkCtx();
    const target = champ(ctx, 2, 1, 0, 0);
    const spec: EffectSpec = {
      kind: 'conditional',
      when: { kind: 'targetSlowed' },
      effects: [{ kind: 'root', duration: 0.9 }],
      otherwise: [{ kind: 'slow', pct: 0.3, duration: 1.5 }],
    };
    applyEffects(ctx, 1, POWER, target, [spec]);
    expect(target.statuses.some((s) => s.kind === 'slow')).toBe(true);
    applyEffects(ctx, 1, POWER, target, [spec]);
    expect(target.statuses.some((s) => s.kind === 'root')).toBe(true);
  });
});

describe('directional knockback', () => {
  it('aside pushes perpendicular to the travel line', () => {
    const { ctx } = mkCtx();
    const target = champ(ctx, 2, 1, 10, 11);
    applyEffects(
      ctx,
      1,
      POWER,
      target,
      [{ kind: 'knockback', distance: 2, direction: 'aside' }],
      'ability',
      {
        lineFrom: { x: 0, z: 10 },
        lineDir: { x: 1, z: 0 },
      },
    );
    // Above the west-to-east line: pushed further north, x unchanged.
    expect(target.pos.x).toBeCloseTo(10, 5);
    expect(target.pos.z).toBeCloseTo(13, 5);
  });

  it('toCenter pushes toward the shape center', () => {
    const { ctx } = mkCtx();
    const target = champ(ctx, 2, 1, 14, 10);
    applyEffects(
      ctx,
      1,
      POWER,
      target,
      [{ kind: 'knockback', distance: 2, direction: 'toCenter' }],
      'ability',
      {
        center: { x: 10, z: 10 },
      },
    );
    expect(target.pos.x).toBeCloseTo(12, 5);
  });
});

describe('cooldown refund', () => {
  it('refunds a fraction of the remaining cooldown on the source', () => {
    const { ctx } = mkCtx();
    const source = champ(ctx, 1, 0, 0, 0);
    const target = champ(ctx, 2, 1, 2, 0);
    source.cooldowns.Q = 10;
    applyEffects(ctx, source.id, POWER, target, [
      { kind: 'cooldownRefund', key: 'Q', pctOfRemaining: 0.5 },
    ]);
    expect(source.cooldowns.Q).toBeCloseTo(5, 5);
  });
});

describe('empowered attack', () => {
  it('the next auto carries the riders and splashes', () => {
    const sim = new Sim(3);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    a.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    const b = sim.addChampion(1, { x: 79, z: 75 });
    const c = sim.addChampion(1, { x: 80.5, z: 75 });
    addStatus(a, {
      kind: 'empower',
      until: 60,
      bonus: [{ kind: 'damage', base: 50, dtype: 'true' }],
      splashRadius: 2.5,
      splash: [{ kind: 'slow', pct: 0.4, duration: 6 }],
      scale: 1,
    });
    sim.orderAttack(a.id, b.id);
    for (let i = 0; i < 30; i++) sim.tick();
    // Rider landed on the victim (true damage on top of the auto)...
    expect(b.maxHp - b.hp).toBeGreaterThan(50);
    // ...and the splash slowed the bystander.
    expect(c.statuses.some((s) => s.kind === 'slow')).toBe(true);
    // Consumed: no empower left on the attacker.
    expect(a.statuses.some((s) => s.kind === 'empower')).toBe(false);
  });
});

describe('traveling dash', () => {
  const dashSpec = (speed: number): AbilityDef['spec'] => ({
    kind: 'dash',
    range: 8,
    speed,
    landRadius: 2,
    onLand: [{ kind: 'damage', base: 80, dtype: 'true' }],
    passThrough: [{ kind: 'damage', base: 20, dtype: 'true' }],
  });

  it('flies over ticks, strikes pass-through victims, lands its payload', () => {
    const { ctx } = mkCtx();
    const caster = champ(ctx, 1, 0, 10, 10);
    const mid = champ(ctx, 2, 1, 14, 10);
    const far = champ(ctx, 3, 1, 18, 10);
    executeCast(ctx, caster, dashSpec(16), 8, { x: 18, z: 10 }, POWER);
    expect(caster.activeDash).not.toBeNull();
    const startX = caster.pos.x;
    stepDashes(ctx, DT);
    expect(caster.pos.x).toBeGreaterThan(startX);
    expect(caster.pos.x).toBeLessThan(18);
    for (let i = 0; i < 20; i++) stepDashes(ctx, DT);
    expect(caster.activeDash).toBeNull();
    expect(caster.pos.x).toBeCloseTo(18, 1);
    // Passed through the mid enemy en route, landed on the far one.
    expect(mid.maxHp - mid.hp).toBe(20);
    expect(far.maxHp - far.hp).toBeGreaterThanOrEqual(80);
  });

  it('a wall stops the flight at its face', () => {
    const { ctx } = mkCtx();
    const caster = champ(ctx, 1, 0, 10, 10);
    raiseWall(ctx, 99, 1, { x: 14, z: 10 }, { x: 1, z: 0 }, 6, 3);
    executeCast(ctx, caster, dashSpec(16), 8, { x: 18, z: 10 }, POWER);
    for (let i = 0; i < 20; i++) stepDashes(ctx, DT);
    expect(caster.activeDash).toBeNull();
    expect(caster.pos.x).toBeLessThan(14);
  });
});

describe('walls', () => {
  it('block ground while alive and unblock on expiry', () => {
    const { ctx, advance } = mkCtx();
    expect(ctx.nav.isWalkableAt(20, 20)).toBe(true);
    raiseWall(ctx, 1, 0, { x: 20, z: 20 }, { x: 1, z: 0 }, 4, 2.5);
    expect(ctx.nav.isWalkableAt(20, 20)).toBe(false);
    advance(3);
    stepWalls(ctx);
    expect(ctx.walls.size).toBe(0);
    expect(ctx.nav.isWalkableAt(20, 20)).toBe(true);
  });

  it('shove a unit standing in the footprint to open ground', () => {
    const { ctx } = mkCtx();
    const u = champ(ctx, 2, 1, 20, 20);
    raiseWall(ctx, 1, 0, { x: 20, z: 20 }, { x: 1, z: 0 }, 4, 2.5);
    expect(ctx.nav.isWalkableAt(u.pos.x, u.pos.z)).toBe(true);
  });
});

describe('chain skillshot', () => {
  it('jumps once to the nearest other enemy with its chain payload', () => {
    const { ctx } = mkCtx();
    const caster = champ(ctx, 1, 0, 10, 10);
    const first = champ(ctx, 2, 1, 16, 10);
    const second = champ(ctx, 3, 1, 18, 11);
    executeCast(
      ctx,
      caster,
      {
        kind: 'skillshot',
        speed: 20,
        radius: 0.6,
        range: 10,
        onHit: [{ kind: 'damage', base: 60, dtype: 'true' }],
        chain: { radius: 4, onHit: [{ kind: 'damage', base: 40, dtype: 'true' }] },
      },
      10,
      { x: 16, z: 10 },
      POWER,
    );
    for (let i = 0; i < 30; i++) stepProjectiles(ctx, DT);
    expect(first.maxHp - first.hp).toBe(60);
    expect(second.maxHp - second.hp).toBe(40);
    expect(ctx.projectiles.size).toBe(0);
  });

  it('leaves a fissure wall when declared', () => {
    const { ctx } = mkCtx();
    const caster = champ(ctx, 1, 0, 10, 10);
    executeCast(
      ctx,
      caster,
      {
        kind: 'skillshot',
        speed: 20,
        radius: 0.6,
        range: 8,
        pierce: true,
        onHit: [],
        leaveWall: { duration: 2 },
      },
      8,
      { x: 18, z: 10 },
      POWER,
    );
    for (let i = 0; i < 30; i++) stepProjectiles(ctx, DT);
    expect(ctx.walls.size).toBe(1);
    expect(ctx.nav.isWalkableAt(14, 10)).toBe(false);
  });
});

describe('zone boundary and reveal', () => {
  it('punishes walking out through the rim, once per cooldown', () => {
    const { ctx, advance } = mkCtx();
    champ(ctx, 1, 0, 30, 30);
    const enemy = champ(ctx, 2, 1, 30, 30);
    const caster = ctx.units.get(1)!;
    executeCast(
      ctx,
      caster,
      {
        kind: 'zone',
        radius: 3,
        duration: 6,
        boundary: {
          effects: [{ kind: 'knockback', distance: 2, direction: 'toCenter' }],
          perUnitEvery: 1.5,
        },
      },
      9,
      { x: 30, z: 30 },
      POWER,
    );
    stepZones(ctx);
    // Walk just past the rim: thrown back toward the center.
    enemy.pos = { x: 34.2, z: 30 };
    advance(DT);
    stepZones(ctx);
    expect(enemy.pos.x).toBeCloseTo(32.2, 5);
    // Inside again; walking out during the per-unit cooldown is free.
    stepZones(ctx);
    enemy.pos = { x: 34.2, z: 30 };
    advance(DT);
    stepZones(ctx);
    expect(enemy.pos.x).toBeCloseTo(34.2, 5);
  });

  it('a reveal zone sees stealthed enemies inside', () => {
    const { ctx } = mkCtx();
    const caster = champ(ctx, 1, 0, 30, 30);
    const enemy = champ(ctx, 2, 1, 31, 30);
    addStatus(enemy, { kind: 'stealth', until: 60 });
    const map = { size: 40, walls: [], borderMargin: 0, brush: [], fountains: [] };
    // biome-ignore lint/suspicious/noExplicitAny: minimal map stub for vision
    const without = computeVisibility(map as any, ctx.units, 0, ctx.zones);
    expect(without[0].has(enemy.id)).toBe(false);
    executeCast(
      ctx,
      caster,
      { kind: 'zone', radius: 4, duration: 3, reveal: true },
      9,
      { x: 30, z: 30 },
      POWER,
    );
    // biome-ignore lint/suspicious/noExplicitAny: minimal map stub for vision
    const withZone = computeVisibility(map as any, ctx.units, 0, ctx.zones);
    expect(withZone[0].has(enemy.id)).toBe(true);
  });
});

describe('shield burst', () => {
  it('fires onBreak the moment damage drains the shield', () => {
    const { ctx } = mkCtx();
    const holder = champ(ctx, 1, 0, 10, 10);
    const enemy = champ(ctx, 2, 1, 11.5, 10);
    addStatus(holder, {
      kind: 'shield',
      until: 60,
      remaining: 30,
      burst: {
        radius: 2.5,
        onBreak: [{ kind: 'damage', base: 45, dtype: 'true' }],
        onExpire: [],
        sourceId: holder.id,
        power: { ad: 0, ap: 0, scale: 1 },
      },
    });
    applyEffects(ctx, enemy.id, POWER, holder, [{ kind: 'damage', base: 500, dtype: 'true' }]);
    stepShieldBursts(ctx);
    expect(enemy.maxHp - enemy.hp).toBe(45);
    expect(holder.statuses.some((s) => s.kind === 'shield')).toBe(false);
  });

  it('fires onExpire when the shield times out with value left', () => {
    const { ctx, advance } = mkCtx();
    const holder = champ(ctx, 1, 0, 10, 10);
    const enemy = champ(ctx, 2, 1, 11.5, 10);
    addStatus(holder, {
      kind: 'shield',
      until: 1,
      remaining: 30,
      burst: {
        radius: 2.5,
        onBreak: [],
        onExpire: [{ kind: 'damage', base: 25, dtype: 'true' }],
        sourceId: holder.id,
        power: { ad: 0, ap: 0, scale: 1 },
      },
    });
    advance(1.5);
    stepShieldBursts(ctx);
    expect(enemy.maxHp - enemy.hp).toBe(25);
  });
});

describe('per-rank overrides and recast', () => {
  const def: AbilityDef = {
    name: 'Test',
    manaCost: 10,
    cooldown: 8,
    castRange: 6,
    spec: { kind: 'burst', radius: 2, effects: [] },
    atRank: [{ rank: 3, spec: { kind: 'burst', radius: 4, effects: [] } }],
    recast: { window: 4, returnBlink: true },
  };

  it('specForRank picks the highest unlocked override', () => {
    expect(specForRank(def, 1)).toBe(def.spec);
    expect(specForRank(def, 2)).toBe(def.spec);
    const at3 = specForRank(def, 3);
    expect(at3.kind === 'burst' && at3.radius).toBe(4);
  });

  it('the recast press returns the caster to its cast position', () => {
    const { ctx, advance } = mkCtx();
    const caster = champ(ctx, 1, 0, 10, 10);
    caster.abilityRanks = { Q: 1, W: 0, E: 0, R: 0 };
    expect(castAbility(ctx, caster, 'Q', def, { x: 12, z: 10 })).toBe(true);
    expect(caster.recastArmed?.key).toBe('Q');
    // Wander off, then press again inside the window: banked return home.
    caster.pos = { x: 20, z: 18 };
    advance(2);
    expect(castAbility(ctx, caster, 'Q', def, { x: 0, z: 0 })).toBe(true);
    expect(caster.pos.x).toBeCloseTo(10, 5);
    expect(caster.pos.z).toBeCloseTo(10, 5);
    expect(caster.recastArmed).toBeNull();
    expect(isStunned(caster, ctx.time)).toBe(false);
  });

  it('an expired window is a normal (cooldown-gated) press again', () => {
    const { ctx, advance } = mkCtx();
    const caster = champ(ctx, 1, 0, 10, 10);
    caster.abilityRanks = { Q: 1, W: 0, E: 0, R: 0 };
    expect(castAbility(ctx, caster, 'Q', def, { x: 12, z: 10 })).toBe(true);
    caster.pos = { x: 20, z: 18 };
    advance(5);
    // Window gone; Q is still on cooldown, so the press is refused and the
    // caster stays where it stands.
    expect(castAbility(ctx, caster, 'Q', def, { x: 0, z: 0 })).toBe(false);
    expect(caster.pos.x).toBeCloseTo(20, 5);
  });
});
