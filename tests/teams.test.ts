// Any number of teams (ADR 0030): a match of fifty, every champion its own
// team, the battle royale's shape, played on the launch map fixture with
// explicit joining points and a respawn the test decides. An enemy is a
// different team: each team sees through its own eyes only, two champions
// of different teams fight, the per-team records (favors, the Boon, the
// Wrath, the memory of who was seen) hold a slot for every team, and the
// systems only the 5v5 has (towers, Sanctums, waves, the fountain) stay
// out. The two-team default is pinned bit for bit by
// tests/fixed_match.test.ts.

import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../server/snapshot';
import { ClientWorld } from '../src/net/client_world';
import { CAMP_FIRST_SPAWN_S } from '../src/sim/camps';
import { CAMPS } from '../src/sim/content/camps';
import { CHAMPION_LIST } from '../src/sim/content/champions';
import { buildObservation } from '../src/sim/observe';
import { Sim, type SimOptions } from '../src/sim/sim';
import { isSide, otherTeam, perTeam, validTeam } from '../src/sim/teams';
import { TICK_RATE, type Vec2 } from '../src/sim/types';
import { createCamp, createChampion, type Unit } from '../src/sim/unit';
import { computeVisibility } from '../src/sim/vision';
import { teamLook } from '../src/ui/team_look';
import { teamKills } from '../src/ui/team_score';

const TEAMS = 50;

// Fifty joining points on a grid over the launch map, each snapped to open
// ground.
function grid(sim: Sim): Vec2[] {
  const out: Vec2[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 10; col++) {
      const x = 15 + col * 13;
      const z = 35 + row * 20;
      out.push(sim.nav.nearestWalkable(x, z) ?? { x, z });
    }
  }
  return out;
}

// A fifty-team match: champion i on team i at its grid point, back at that
// point three seconds after a death.
function freeForAll(seed = 7, options: SimOptions = {}): { sim: Sim; champs: Unit[] } {
  const home = new Map<number, Vec2>();
  const sim = new Sim(seed, {
    teamCount: TEAMS,
    respawnDelay: () => 3,
    respawnPoint: (u) => home.get(u.id) ?? null,
    ...options,
  });
  const points = grid(sim);
  const champs: Unit[] = [];
  for (let team = 0; team < TEAMS; team++) {
    const def = CHAMPION_LIST[team % CHAMPION_LIST.length]!;
    const u = sim.addChampion(team, points[team]!, def.id);
    home.set(u.id, { ...points[team]! });
    champs.push(u);
  }
  return { sim, champs };
}

describe('the team helpers', () => {
  it('name the other side of a pair, a record per team, and the teams a match holds', () => {
    expect(otherTeam(0)).toBe(1);
    expect(otherTeam(1)).toBe(0);
    expect(perTeam(3, (t) => t * 2)).toEqual([0, 2, 4]);
    expect(validTeam(49, TEAMS)).toBe(true);
    expect(validTeam(50, TEAMS)).toBe(false);
    expect(validTeam(-1, TEAMS)).toBe(false);
    expect(validTeam(1.5, TEAMS)).toBe(false);
    expect(isSide(1)).toBe(true);
    expect(isSide(2)).toBe(false);
  });
});

describe('a match of fifty teams', () => {
  it('plays 45 seconds of a brawl without throwing, through the camps rising', () => {
    const { sim, champs } = freeForAll();
    expect(sim.teamCount).toBe(TEAMS);
    // The structures are the two sides' alone.
    for (const u of sim.units.values()) expect(u.kind).toBe('champion');
    for (const u of champs) sim.orderAttackMove(u.id, 75, 75);
    const points = grid(sim);
    let damage = 0;
    let deaths = 0;
    let comebacks = 0;
    const down = new Set<number>();
    const ticks = (CAMP_FIRST_SPAWN_S + 15) * TICK_RATE;
    for (let i = 0; i < ticks; i++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'damage') damage += ev.amount;
        if (ev.type === 'death') {
          const u = sim.units.get(ev.unitId);
          if (u?.kind === 'champion') deaths++;
        }
      }
      // A champion back from the dead stands on its own joining point.
      for (const u of champs) {
        if (u.dead) down.add(u.id);
        else if (down.delete(u.id)) {
          comebacks++;
          expect(u.pos).toEqual(points[u.team]);
        }
      }
      // Whoever came back walks into the fight again.
      if (i % TICK_RATE === 0) {
        for (const u of champs) {
          if (!u.dead && u.attackMoveTarget === null && u.attackTargetId === null) {
            sim.orderAttackMove(u.id, 75, 75);
          }
        }
      }
    }
    expect(damage).toBeGreaterThan(0);
    expect(deaths).toBeGreaterThan(0);
    expect(comebacks).toBeGreaterThan(0);
    // No waves, no towers, no Sanctum: nobody wins a free-for-all by the
    // 5v5's rule.
    const kinds = new Set([...sim.units.values()].map((u) => u.kind));
    expect(kinds.has('minion')).toBe(false);
    expect(kinds.has('tower')).toBe(false);
    expect(sim.winner).toBeNull();
    // The camps rose and every team keeps its own memory of them.
    expect(kinds.has('camp')).toBe(true);
    expect(sim.campsFor(37)).toHaveLength(sim.map.camps.length);
    // Every seat still reads its own observation.
    for (const u of champs) {
      const obs = buildObservation(sim, u.id);
      expect(obs?.self.team).toBe(u.team);
      for (const row of obs?.units ?? []) {
        if (row.kind === 'champion') expect(row.friendly).toBe(false);
      }
    }
    expect(teamKills(sim.scoreboard())).toHaveLength(TEAMS);
  }, 60_000);

  it('gives every team its own sight: never its own units, always a close enemy', () => {
    const { sim, champs } = freeForAll();
    // A second champion on team 37, and an enemy two meters from it.
    const a = champs[37]!;
    const mate = sim.addChampion(37, { x: a.pos.x + 1, z: a.pos.z });
    const near = champs[38]!;
    near.pos = { x: a.pos.x, z: a.pos.z + 2 };
    sim.tick();
    const sets = computeVisibility(sim.map, sim.units, sim.time, sim.zones, sim.teamCount);
    expect(sets).toHaveLength(TEAMS);
    for (const [team, seen] of sets.entries()) {
      for (const id of seen) expect(sim.units.get(id)?.team).not.toBe(team);
    }
    expect(sets[37]!.has(near.id)).toBe(true);
    expect(sets[37]!.has(mate.id)).toBe(false);
    expect(sets[38]!.has(a.id)).toBe(true);
    expect(sets[38]!.has(mate.id)).toBe(true);
    expect(sim.isVisible(37, near.id)).toBe(true);
    expect(sim.isVisible(37, mate.id)).toBe(true);
    // Across the map, out of sight.
    expect(sim.isVisible(37, champs[0]!.id)).toBe(false);
    // The memory of who was seen is the team's own too.
    expect(sim.lastSeen).toHaveLength(TEAMS);
    expect(sim.lastSeen[37]!.has(near.id)).toBe(true);
    expect(sim.lastSeen[37]!.has(mate.id)).toBe(false);
    expect(sim.lastSeen[0]!.has(near.id)).toBe(false);
    // And the observation reads it: the mate is friendly, the enemy not.
    const obs = buildObservation(sim, a.id)!;
    expect(obs.units.find((r) => r.id === mate.id)?.friendly).toBe(true);
    expect(obs.units.find((r) => r.id === near.id)?.friendly).toBe(false);
  });

  it('shows a neutral unit to every team that has it in sight', () => {
    const map = { size: 60, walls: [], borderMargin: 0, brush: [], fountains: [] };
    const def = CHAMPION_LIST[0]!;
    const units = new Map<number, Unit>();
    const put = (u: Unit): void => {
      units.set(u.id, u);
    };
    put(createChampion(1, 1, { x: 10, z: 10 }, def));
    put(createChampion(2, 3, { x: 12, z: 10 }, def));
    put(createChampion(3, 4, { x: 50, z: 50 }, def));
    // The camp's nominal team is 0, a team with nobody near it.
    put(createCamp(4, CAMPS.barkmaw, { x: 11, z: 12 }));
    // biome-ignore lint/suspicious/noExplicitAny: minimal map stub for vision
    const sets = computeVisibility(map as any, units, 0, undefined, 5);
    expect(sets[1]!.has(4)).toBe(true);
    expect(sets[3]!.has(4)).toBe(true);
    expect(sets[4]!.has(4)).toBe(false);
    expect(sets[0]!.has(4)).toBe(false);
    // Teams 1 and 3 see each other; team 4 sees nobody.
    expect(sets[1]!.has(2)).toBe(true);
    expect(sets[3]!.has(1)).toBe(true);
    expect(sets[4]!.size).toBe(0);
  });

  it('lets two champions of different teams fight', () => {
    const { sim, champs } = freeForAll();
    const a = champs[10]!;
    const b = champs[41]!;
    b.pos = { x: a.pos.x + 1.5, z: a.pos.z };
    sim.tick();
    sim.orderAttack(a.id, b.id);
    expect(a.attackTargetId).toBe(b.id);
    let landed = 0;
    for (let i = 0; i < 3 * TICK_RATE; i++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'damage' && ev.sourceId === a.id && ev.targetId === b.id) {
          landed += ev.amount;
        }
      }
    }
    expect(landed).toBeGreaterThan(0);
    expect(b.hp).toBeLessThan(b.maxHp);
  });

  it('holds the favors and the team buffs of team 37 apart from every other', () => {
    const { sim, champs } = freeForAll();
    const mine = champs[37]!;
    const other = champs[36]!;
    sim.grantFavor(37, 'might');
    expect(mine.favors.might).toBe(1);
    expect(other.favors.might).toBe(0);
    expect(sim.teamFavors(37).might).toBe(1);
    expect(sim.teamFavors(0).might).toBe(0);
    sim.teamBuffs.grantBoon(37, sim.time);
    expect(sim.teamBuff(37)?.stacks).toBe(1);
    expect(sim.teamBuff(36)).toBeNull();
    expect(sim.teamBuffs.damageMultiplier(37, sim.time)).toBeGreaterThan(1);
    expect(sim.teamBuffs.damageMultiplier(1, sim.time)).toBe(1);
    sim.grantWrath(37);
    expect(sim.teamWrath(37)).not.toBeNull();
    expect(sim.teamWrath(49)).toBeNull();
    // A checkpoint carries all fifty and puts them back.
    const snap = sim.snapshot();
    sim.grantFavor(12, 'tide');
    sim.restore(snap);
    expect(sim.teamFavors(12).tide).toBe(0);
    expect(sim.teamFavors(37).might).toBe(1);
    expect(sim.teamBuff(37)?.stacks).toBe(1);
    expect(sim.teamWrath(37)).not.toBeNull();
  });

  it('brings a champion back where and when the mode says, or keeps it down', () => {
    let open = false;
    const back = { x: 75, z: 75 };
    const { sim, champs } = freeForAll(7, {
      respawnDelay: () => 1,
      respawnPoint: () => (open ? back : null),
    });
    const a = champs[5]!;
    const b = champs[6]!;
    b.pos = { x: a.pos.x + 1.5, z: a.pos.z };
    b.hp = 1;
    sim.tick();
    sim.orderAttack(a.id, b.id);
    for (let i = 0; i < 3 * TICK_RATE && !b.dead; i++) sim.tick();
    expect(b.dead).toBe(true);
    expect(b.respawnAt).toBeCloseTo(sim.time + 1 - 1 / TICK_RATE, 6);
    expect(a.kills).toBe(1);
    // Past the delay, the mode still says no: down it stays.
    for (let i = 0; i < 3 * TICK_RATE; i++) sim.tick();
    expect(b.dead).toBe(true);
    // The mode answers: back at its point, whole.
    open = true;
    sim.tick();
    expect(b.dead).toBe(false);
    expect(b.pos).toEqual(back);
    expect(b.pos).not.toBe(back);
    expect(b.hp).toBe(b.maxHp);
  });

  it('asks for a joining point on a team without a fountain, and refuses a team it lacks', () => {
    const sim = new Sim(1, { teamCount: TEAMS });
    expect(() => sim.addChampion(37)).toThrow(/no fountain/);
    expect(() => sim.addChampion(50, { x: 75, z: 75 })).toThrow(/no team 50/);
    const u = sim.addChampion(37, { x: 75, z: 75 });
    expect(u.team).toBe(37);
    // A champion with no respawn rule and no fountain stays down.
    u.hp = 0;
    u.dead = true;
    u.respawnAt = 0;
    sim.tick();
    expect(u.dead).toBe(true);
  });
});

describe('a free-for-all on the wire', () => {
  it("scopes a seat's snapshot to its own team's sight, with no enemy side to tell", () => {
    const { sim, champs } = freeForAll();
    const a = champs[37]!;
    const near = champs[38]!;
    near.pos = { x: a.pos.x, z: a.pos.z + 2 };
    sim.teamBuffs.grantBoon(37, sim.time);
    sim.teamBuffs.grantBoon(36, sim.time);
    sim.tick();
    const snap = buildSnapshot(sim, 37, a.id, new Set(), []);
    if (snap.t !== 'snap') throw new Error('not a snapshot');
    const ids = new Set(snap.units.map((u) => u.i));
    expect(ids.has(a.id)).toBe(true);
    expect(ids.has(near.id)).toBe(true);
    expect(ids.has(champs[0]!.id)).toBe(false);
    expect(snap.self?.boonStacks).toBe(1);
    expect(snap.self?.enemyBoonUntil).toBeUndefined();
  });

  it('tells the mirror the team count, the 5v5 saying nothing', () => {
    const map = new Sim(1).map;
    const ffa = new ClientWorld(() => undefined, map);
    ffa.applyServer({ t: 'match_start', selfUnitId: 1, team: 37, teams: TEAMS });
    expect(ffa.teamCount).toBe(TEAMS);
    expect(ffa.selfTeam).toBe(37);
    const fiveVFive = new ClientWorld(() => undefined, map);
    fiveVFive.applyServer({ t: 'match_start', selfUnitId: 1, team: 1 });
    expect(fiveVFive.teamCount).toBe(2);
  });
});

describe('the two-team default', () => {
  it('is the 5v5: two teams, the structures, the fountain, a team past two refused', () => {
    const sim = new Sim(11);
    expect(sim.teamCount).toBe(2);
    expect([...sim.units.values()].some((u) => u.kind === 'tower')).toBe(true);
    expect([...sim.units.values()].some((u) => u.kind === 'sanctum')).toBe(true);
    expect(() => sim.addChampion(2)).toThrow(/no team 2/);
    const u = sim.addChampion(1);
    expect(u.team).toBe(1);
    expect(sim.lastSeen).toHaveLength(2);
  });
});

describe('the look a team wears', () => {
  it('keeps the 5v5 sides for every viewer, and reads a free-for-all as you against all', () => {
    expect(teamLook(0, 1)).toBe(0);
    expect(teamLook(1, 1)).toBe(1);
    expect(teamLook(1, 0, 2)).toBe(1);
    expect(teamLook(37, 37, TEAMS)).toBe(0);
    expect(teamLook(0, 37, TEAMS)).toBe(1);
    expect(teamLook(36, 37, TEAMS)).toBe(1);
  });
});
