// The core systems on a sphere (ADR 0029): a bare planet of radius 80 with
// no lanes, towers, fountains or pits, open everywhere (OpenSphereGround),
// and champions set down on it. Walking, attacking, a skillshot, a dash, a
// zone, a spell wall, separation and sight all play on the sphere through
// the same code the 5v5 plays on the plane, and keep every body on it.

import { describe, expect, it } from 'vitest';
import type { GameMap } from '../src/sim/content/map';
import { basis, dirTo, dist, dot, heading, offset, turnLeft } from '../src/sim/geo';
import { OpenSphereGround } from '../src/sim/ground';
import { Sim } from '../src/sim/sim';
import type { Vec2 } from '../src/sim/types';
import type { UnitKind } from '../src/sim/unit';

const R = 80;

// The planet's record: nothing of the 5v5 on it.
const PLANET: GameMap = {
  size: 1,
  borderMargin: 0,
  laneWidth: 0,
  river: { a: { x: 0, z: 0 }, b: { x: 0, z: 0 }, width: 0 },
  fountains: [],
  sanctums: [],
  towers: [],
  lanes: { top: [], mid: [], bot: [] },
  walls: [],
  brush: [],
  wardenPits: [],
  camps: [],
};

function planetSim(separation?: readonly UnitKind[]): Sim {
  return new Sim(3, { map: PLANET, ground: new OpenSphereGround(R), separation });
}

function radius(p: Vec2): number {
  return Math.sqrt(p.x * p.x + (p.y ?? 0) * (p.y ?? 0) + p.z * p.z);
}

// The unit normal of the great circle through a and b.
function circleNormal(a: Vec2, b: Vec2): Vec2 {
  const ay = a.y ?? 0;
  const by = b.y ?? 0;
  const x = ay * b.z - a.z * by;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * by - ay * b.x;
  const m = Math.sqrt(x * x + y * y + z * z);
  return { x: x / m, y: y / m, z: z / m };
}

// A start well away from the frame's poles, and the east heading there.
const START: Vec2 = (() => {
  const d = Math.sqrt(0.6 * 0.6 + 0.3 * 0.3 + 0.74 * 0.74);
  return { x: (0.6 / d) * R, y: (0.3 / d) * R, z: (0.74 / d) * R };
})();
const EAST = basis(START).east;

function at(s: number, from: Vec2 = START, dir: Vec2 = EAST): Vec2 {
  return offset(from, dir, s);
}

describe('the core systems on a sphere', () => {
  it('walks a move order along its great circle and arrives', () => {
    const sim = planetSim();
    const u = sim.addChampion(0, START, 'korrath');
    const goal = at(15, START, heading(START, 0.7));
    const m = circleNormal(START, goal);
    sim.orderMove(u.id, goal.x, goal.z, goal.y);
    let last = dist(u.pos, goal);
    let ticks = 0;
    while (u.path.length > 0 && ticks < 400) {
      sim.tick();
      ticks++;
      expect(Math.abs(radius(u.pos) - R)).toBeLessThan(1e-6);
      expect(Math.abs(dot(u.pos, m))).toBeLessThan(1e-6);
      const d = dist(u.pos, goal);
      expect(d).toBeLessThan(last + 1e-12);
      last = d;
    }
    expect(u.path).toEqual([]);
    expect(dist(u.pos, goal)).toBeLessThan(1e-9);
    // 15 m at Korrath's 3.65 m/s.
    expect(ticks).toBeGreaterThan(75);
    expect(ticks).toBeLessThan(90);
  });

  it('lands a basic attack in range and none out of it', () => {
    const sim = planetSim();
    const vesk = sim.addChampion(0, START, 'vesk');
    const near = sim.addChampion(1, at(6), 'torv');
    sim.orderAttack(vesk.id, near.id);
    for (let i = 0; i < 40; i++) sim.tick();
    expect(near.hp).toBeLessThan(near.maxHp);
    // Already in range: the marksman never stepped.
    expect(dist(vesk.pos, START)).toBe(0);

    const held = planetSim();
    const archer = held.addChampion(0, START, 'vesk');
    const far = held.addChampion(1, at(9), 'torv');
    archer.moveSpeed = 0;
    held.orderAttack(archer.id, far.id);
    for (let i = 0; i < 60; i++) held.tick();
    expect(far.hp).toBe(far.maxHp);
    // Free to walk, the attacker closes the gap on the sphere and lands.
    archer.moveSpeed = 3.55;
    for (let i = 0; i < 60; i++) {
      held.tick();
      expect(Math.abs(radius(archer.pos) - R)).toBeLessThan(1e-6);
    }
    expect(far.hp).toBeLessThan(far.maxHp);
  });

  it('flies a skillshot along its great circle, through the unit on it and past the one beside it', () => {
    const sim = planetSim();
    const vesk = sim.addChampion(0, START, 'vesk');
    const onLine = sim.addChampion(1, at(10), 'torv');
    const lineAt9 = at(9);
    const beside = sim.addChampion(
      1,
      offset(lineAt9, turnLeft(dirTo(lineAt9, onLine.pos)!, lineAt9), 2),
      'torv',
    );
    for (const u of [vesk, onLine, beside]) sim.orderStop(u.id);
    expect(sim.levelAbility(vesk.id, 'Q')).toBe(true);
    expect(sim.castAbility(vesk.id, 'Q', onLine.pos)).toBe(true);
    const m = circleNormal(START, onLine.pos);
    let flew = 0;
    for (let i = 0; i < 40; i++) {
      sim.tick();
      for (const p of sim.projectiles.values()) {
        flew++;
        expect(Math.abs(radius(p.pos) - R)).toBeLessThan(1e-6);
        expect(Math.abs(dot(p.pos, m))).toBeLessThan(1e-6);
        // The heading stays a unit tangent at the bolt.
        expect(Math.abs(dot(p.dir, p.pos))).toBeLessThan(1e-9);
      }
    }
    expect(flew).toBeGreaterThan(5);
    expect(sim.projectiles.size).toBe(0);
    expect(onLine.hp).toBeLessThan(onLine.maxHp);
    expect(beside.hp).toBe(beside.maxHp);
  });

  it('dashes its whole distance and stays on the sphere', () => {
    const sim = planetSim();
    const fenn = sim.addChampion(0, START, 'fenn');
    const aim = at(7);
    expect(sim.levelAbility(fenn.id, 'Q')).toBe(true);
    expect(sim.castAbility(fenn.id, 'Q', aim)).toBe(true);
    expect(fenn.activeDash).not.toBeNull();
    const m = circleNormal(START, aim);
    let ticks = 0;
    while (fenn.activeDash && ticks < 40) {
      sim.tick();
      ticks++;
      expect(Math.abs(radius(fenn.pos) - R)).toBeLessThan(1e-6);
      expect(Math.abs(dot(fenn.pos, m))).toBeLessThan(1e-6);
    }
    expect(fenn.activeDash).toBeNull();
    // Seven meters at 18 m/s, to the aimed point.
    expect(ticks).toBeLessThan(10);
    expect(dist(START, fenn.pos)).toBeCloseTo(7, 9);
    expect(dist(aim, fenn.pos)).toBeLessThan(1e-9);
  });

  it('burns a unit inside a zone and spares one outside it', () => {
    const sim = planetSim();
    const vesk = sim.addChampion(0, START, 'vesk');
    const center = at(6);
    const toward = dirTo(center, START)!;
    const inside = sim.addChampion(1, offset(center, turnLeft(toward, center), 1), 'torv');
    const outside = sim.addChampion(1, offset(center, toward, -5), 'torv');
    for (const u of [vesk, inside, outside]) sim.orderStop(u.id);
    expect(sim.levelAbility(vesk.id, 'W')).toBe(true);
    expect(sim.castAbility(vesk.id, 'W', center)).toBe(true);
    const zone = [...sim.zones.values()][0]!;
    expect(dist(zone.pos, center)).toBeLessThan(1e-9);
    for (let i = 0; i < 30; i++) sim.tick();
    expect(inside.hp).toBeLessThan(inside.maxHp);
    expect(outside.hp).toBe(outside.maxHp);
  });

  it('raises a spell wall across the cast, its ends on the sphere', () => {
    const sim = planetSim();
    const korrath = sim.addChampion(0, START, 'korrath');
    const aim = at(5);
    expect(sim.levelAbility(korrath.id, 'W')).toBe(true);
    expect(sim.castAbility(korrath.id, 'W', aim)).toBe(true);
    const wall = [...sim.walls.values()][0]!;
    for (const s of [wall.a, wall.b, ...wall.samples]) {
      expect(Math.abs(radius(s) - R)).toBeLessThan(1e-6);
    }
    // Half the length to each side of the aim; the two chords bend round
    // the sphere, so end to end is a hair under the length.
    expect(dist(wall.a, aim)).toBeCloseTo(2, 9);
    expect(dist(wall.b, aim)).toBeCloseTo(2, 9);
    expect(dist(wall.a, wall.b)).toBeCloseTo(4, 3);
    // Across the cast: the wall's line is a quarter turn from the heading.
    const cast = dirTo(aim, offset(aim, dirTo(aim, START)!, -1))!;
    expect(Math.abs(dot(cast, dirTo(aim, wall.b)!))).toBeLessThan(1e-6);
  });

  it('pushes two overlapping champions apart when the match separates them', () => {
    const sim = planetSim(['minion', 'champion']);
    const a = sim.addChampion(0, START, 'korrath');
    const b = sim.addChampion(0, at(0.3), 'korrath');
    for (let i = 0; i < 20; i++) {
      sim.tick();
      expect(Math.abs(radius(a.pos) - R)).toBeLessThan(1e-6);
      expect(Math.abs(radius(b.pos) - R)).toBeLessThan(1e-6);
    }
    expect(dist(a.pos, b.pos)).toBeGreaterThan(a.radius + b.radius - 1e-3);

    // The 5v5's rule stands by default: champions walk through each other.
    const plain = planetSim();
    const c = plain.addChampion(0, START, 'korrath');
    const d = plain.addChampion(0, at(0.3), 'korrath');
    for (let i = 0; i < 20; i++) plain.tick();
    expect(dist(c.pos, d.pos)).toBeCloseTo(0.3, 9);
  });

  it('sees an enemy at 10 m and not at 14 m', () => {
    const sim = planetSim();
    sim.addChampion(0, START, 'vesk');
    const seen = sim.addChampion(1, at(10), 'korrath');
    const unseen = sim.addChampion(1, at(14, START, heading(START, 2)), 'korrath');
    sim.tick();
    expect(sim.isVisible(0, seen.id)).toBe(true);
    expect(sim.isVisible(0, unseen.id)).toBe(false);
    const p10 = at(10, START, heading(START, -1));
    const p14 = at(14, START, heading(START, -1));
    expect(sim.isPointVisible(0, p10.x, p10.z, p10.y)).toBe(true);
    expect(sim.isPointVisible(0, p14.x, p14.z, p14.y)).toBe(false);
  });

  it('runs a planet without the 5v5: no waves, no Warden, no fountain to come back to', () => {
    const sim = planetSim();
    const vesk = sim.addChampion(0, START, 'vesk');
    const victim = sim.addChampion(1, at(5), 'korrath');
    victim.hp = 1;
    sim.orderAttack(vesk.id, victim.id);
    // Past the first wave, past the Warden's first rise, past a respawn.
    for (let i = 0; i < 20 * 60 * 13; i++) sim.tick();
    expect(victim.dead).toBe(true);
    expect([...sim.units.values()].filter((u) => u.kind !== 'champion')).toEqual([]);
    expect(Math.abs(radius(vesk.pos) - R)).toBeLessThan(1e-6);
  });
});
