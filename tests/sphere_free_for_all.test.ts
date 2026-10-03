// The battle royale's two foundations together (ADR 0029, ADR 0030): a
// free-for-all on the sphere tests' shared planet (tests/sphere_world.ts),
// every champion its own team, back at its own point on the sphere a few
// seconds after a death. A brawl of twelve keeps every body, bolt, field
// and wall on the sphere; each team sees through its own eyes only; and
// what a team remembers of a champion, or notes of a camp, is measured on
// the sphere, its y included, never on the plane's two coordinates.

import { describe, expect, it } from 'vitest';
import { CAMP_FIRST_SPAWN_S } from '../src/sim/content/camps';
import { CHAMPION_LIST } from '../src/sim/content/champions';
import { copy, dist, heading, offset } from '../src/sim/geo';
import type { Sim } from '../src/sim/sim';
import { type AbilityKey, TICK_RATE, type Vec2 } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';
import { computeVisibility } from '../src/sim/vision';
import { HOME, offGround, PLANET, planetSim } from './sphere_world';

const KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];

// Everything of a world that stands on the ground, read for anything off
// the sphere.
function strays(sim: Sim): string[] {
  const out: string[] = [];
  const note = (what: string, p: Vec2) => {
    const why = offGround(p);
    if (why) out.push(`${what}: ${why}`);
  };
  for (const u of sim.units.values()) {
    note(`unit ${u.id} (${u.kind})`, u.pos);
    if (!Number.isFinite(u.hp)) out.push(`unit ${u.id}: hp ${u.hp}`);
    if (u.activeDash) note(`dash of ${u.id}`, u.activeDash.from);
  }
  for (const p of sim.projectiles.values()) note(`bolt ${p.id}`, p.pos);
  for (const z of sim.zones.values()) note(`field ${z.id}`, z.pos);
  for (const w of sim.walls.values()) for (const s of w.samples) note(`wall ${w.id}`, s);
  return out;
}

// The nearest champion of another team the unit's team can see.
function nearestSeenEnemy(sim: Sim, u: Unit): Unit | null {
  let best: Unit | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const o of sim.units.values()) {
    if (o.kind !== 'champion' || o.dead || o.team === u.team) continue;
    if (!sim.isVisible(u.team, o.id)) continue;
    const d = dist(u.pos, o.pos);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

describe('a free-for-all on the sphere', () => {
  it('plays a brawl of twelve, every body on the sphere and every comeback at its own point', () => {
    const TEAMS = 12;
    const home = new Map<number, Vec2>();
    const sim = planetSim({
      teamCount: TEAMS,
      separation: ['minion', 'champion'],
      respawnDelay: () => 3,
      respawnPoint: (u) => home.get(u.id) ?? null,
    });
    const champs: Unit[] = [];
    for (let team = 0; team < TEAMS; team++) {
      // A ring of nine meters round HOME, each champion facing its middle.
      const at = offset(HOME, heading(HOME, (team * 2 * Math.PI) / TEAMS), 9);
      const def = CHAMPION_LIST[team % CHAMPION_LIST.length]!;
      const u = sim.addChampion(team, at, def.id);
      sim.setLevel(u.id, 6);
      for (const key of KEYS) sim.levelAbility(u.id, key);
      home.set(u.id, copy(at));
      champs.push(u);
    }
    for (const u of sim.units.values()) expect(u.kind).toBe('champion');

    let damage = 0;
    let deaths = 0;
    let comebacks = 0;
    const down = new Set<number>();
    const out: string[] = [];
    for (let i = 0; i < 40 * TICK_RATE; i++) {
      // Once a second each champion casts its next spell at the nearest
      // enemy it sees and goes for it, else walks to the middle.
      if (i % TICK_RATE === 0) {
        for (const u of champs) {
          if (u.dead) continue;
          const foe = nearestSeenEnemy(sim, u);
          if (foe) {
            sim.castAbility(u.id, KEYS[(i / TICK_RATE + u.team) % KEYS.length]!, copy(foe.pos));
            sim.orderAttack(u.id, foe.id);
          } else {
            sim.orderAttackMove(u.id, HOME.x, HOME.z, HOME.y);
          }
        }
      }
      for (const ev of sim.tick()) {
        if (ev.type === 'damage') damage += ev.amount;
        if (ev.type === 'death' && sim.units.get(ev.unitId)?.kind === 'champion') deaths++;
      }
      for (const u of champs) {
        if (u.dead) down.add(u.id);
        else if (down.delete(u.id)) {
          comebacks++;
          expect(u.pos).toEqual(home.get(u.id));
        }
      }
      out.push(...strays(sim).map((s) => `${(i / TICK_RATE).toFixed(2)} s ${s}`));
    }
    expect(out).toEqual([]);
    expect(damage).toBeGreaterThan(0);
    expect(deaths).toBeGreaterThan(0);
    expect(comebacks).toBeGreaterThan(0);
    expect(sim.winner).toBeNull();
  });

  it('gives each team its own sight on the sphere, and a memory with y', () => {
    const sim = planetSim({ teamCount: 4 });
    const a = sim.addChampion(0, HOME, 'vesk');
    const b = sim.addChampion(1, offset(HOME, heading(HOME, 0.5), 8), 'korrath');
    const far = sim.addChampion(2, offset(HOME, heading(HOME, 2), 30), 'torv');
    // Team 3 stands where team 0 stands on the plane's two coordinates, on
    // the far side of the planet: the plane's arithmetic would put them
    // side by side.
    const mirror = sim.addChampion(3, { x: HOME.x, y: -(HOME.y ?? 0), z: HOME.z }, 'fenn');
    for (const u of [a, b, far, mirror]) sim.orderStop(u.id);
    sim.tick();

    expect(sim.isVisible(0, b.id)).toBe(true);
    expect(sim.isVisible(1, a.id)).toBe(true);
    expect(sim.isVisible(0, far.id)).toBe(false);
    expect(sim.isVisible(2, a.id)).toBe(false);
    expect(sim.isVisible(0, mirror.id)).toBe(false);
    expect(sim.isVisible(3, a.id)).toBe(false);
    expect(sim.isPointVisible(3, HOME.x, HOME.z, HOME.y)).toBe(false);

    // One set per team, never with the team's own units in it.
    const sets = computeVisibility(PLANET, sim.units, sim.time, undefined, 4);
    expect(sets).toHaveLength(4);
    for (const u of [a, b, far, mirror]) expect(sets[u.team]!.has(u.id)).toBe(false);
    expect([...sets[0]!]).toEqual([b.id]);
    expect([...sets[3]!]).toEqual([]);

    // Team 0 remembers b where it stood on the sphere.
    const seen = sim.lastSeen[0]!.get(b.id)!;
    expect(seen).toMatchObject({ x: b.pos.x, y: b.pos.y, z: b.pos.z });
    expect(sim.lastSeen[3]!.has(a.id)).toBe(false);
    expect(sim.lastSeen[0]!.has(a.id)).toBe(false);
  });

  it('notes a camp on the sphere for the team beside it, not for one beside its plane shadow', () => {
    const spot = { ...offset(HOME, heading(HOME, 1), 3), kind: 'spinecrest' as const };
    const sim = planetSim({ teamCount: 3, map: { ...PLANET, camps: [spot] } });
    const near = sim.addChampion(0, HOME, 'vesk');
    // Under the spot's x and z, on the far side of the planet.
    const shadow = sim.addChampion(1, { x: spot.x, y: -(spot.y ?? 0), z: spot.z }, 'korrath');
    for (const u of [near, shadow]) sim.orderStop(u.id);
    while (sim.time < CAMP_FIRST_SPAWN_S + 1) sim.tick();

    const [ours] = sim.campsFor(0);
    expect(ours!.seenAt).not.toBeNull();
    expect(ours!.up).toBe(true);
    expect(sim.campsFor(1)[0]!.seenAt).toBeNull();
    expect(sim.campsFor(2)[0]!.seenAt).toBeNull();
    for (const u of sim.units.values()) expect(offGround(u.pos)).toBeNull();
  });
});
