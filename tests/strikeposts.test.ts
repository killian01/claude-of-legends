// The Range (CONTEXT.md: Range, Strikepost; docs/plan-practice-range.md):
// a sim built with `range` stands one post of each kind in the team's base
// on open ground, sends no waves and raises no neutral body, and its posts
// never fall: a champion hits them for as long as it likes, they pay
// nothing, and left alone they fill and stand back on their spot.

import { describe, expect, it } from 'vitest';
import { starOrchard } from '../server/star_orchard';
import { orchardSim } from '../src/net/replay';
import { mitigationMultiplier } from '../src/sim/combat/damage';
import { GAME_MAP } from '../src/sim/content/map';
import { STRIKEPOST_CALM_S, STRIKEPOST_ORDER, STRIKEPOSTS } from '../src/sim/content/strikeposts';
import { dist } from '../src/sim/geo';
import { Sim, type SimOptions } from '../src/sim/sim';
import { TerrainNavGrid } from '../src/sim/terrain_nav';
import type { Unit } from '../src/sim/unit';

const TICKS_PER_S = 20;

function orchardOptions(): SimOptions {
  const orchard = starOrchard();
  return {
    map: orchard.map,
    nav: new TerrainNavGrid(orchard.navigation),
    strictNavigation: true,
  };
}

function rangeSim(seed = 3): Sim {
  return new Sim(seed, { ...orchardOptions(), range: { team: 0 } });
}

function posts(sim: Sim): Unit[] {
  return [...sim.units.values()].filter((u) => u.kind === 'post');
}

function run(sim: Sim, seconds: number): void {
  for (let i = 0; i < seconds * TICKS_PER_S; i++) sim.tick();
}

describe('the Range', () => {
  it('stands one post of each kind in the base, on open ground', () => {
    const sim = rangeSim();
    const standing = posts(sim);
    expect(standing.map((u) => u.postKind)).toEqual([...STRIKEPOST_ORDER]);
    const sanctum = sim.map.sanctums.find((s) => s.team === 0)!;
    const enemy = sim.map.sanctums.find((s) => s.team === 1)!;
    for (const u of standing) {
      expect(u.neutral).toBe(true);
      expect(u.hp).toBe(STRIKEPOSTS[u.postKind!].hp);
      expect(sim.nav.isWalkableAt(u.pos.x, u.pos.z)).toBe(true);
      expect(dist(u.pos, sanctum)).toBeLessThan(dist(u.pos, enemy) / 4);
    }
    expect(dist(standing[0]!.pos, standing[1]!.pos)).toBeGreaterThan(3);
  });

  it('stands clear of every tower, so none hides a post from the camera', () => {
    const sim = rangeSim();
    const towers = [...sim.units.values()].filter((u) => u.kind === 'tower');
    for (const post of posts(sim)) {
      for (const t of towers) expect(dist(post.pos, t.pos)).toBeGreaterThan(6);
    }
  });

  it('is absent from every other match', () => {
    expect(posts(new Sim(3, orchardOptions()))).toEqual([]);
    expect(posts(new Sim(3))).toEqual([]);
  });

  it('sends no waves and raises no camp, ring creature or Warden', () => {
    const sim = rangeSim();
    run(sim, 120);
    const kinds = new Set([...sim.units.values()].map((u) => u.kind));
    expect([...kinds].sort()).toEqual(['post', 'sanctum', 'tower']);
  });

  it('never falls to a champion, and pays it nothing', () => {
    const sim = rangeSim();
    const self = sim.addChampion(0);
    sim.setLevel(self.id, 18);
    self.stats.ad = 4000;
    const post = posts(sim)[0]!;
    self.pos = { x: post.pos.x + 1, z: post.pos.z };
    const gold = self.gold;
    sim.orderAttack(self.id, post.id);
    const deaths: number[] = [];
    for (let i = 0; i < 10 * TICKS_PER_S; i++) {
      for (const ev of sim.tick()) if (ev.type === 'death') deaths.push(ev.unitId);
    }
    expect(deaths).toEqual([]);
    expect(sim.units.get(post.id)).toBe(post);
    expect(post.dead).toBe(false);
    expect(post.hp).toBeGreaterThan(0);
    expect(self.attackTargetId).toBe(post.id);
    expect(self.gold - gold).toBeLessThan(50);
  });

  it('fills and stands back on its spot once left alone', () => {
    const sim = rangeSim();
    const post = posts(sim)[1]!;
    const home = { ...post.pos };
    post.hp = 100;
    post.pos = { x: home.x + 2, z: home.z };
    post.lastDamagedAt = sim.time;
    run(sim, STRIKEPOST_CALM_S - 1);
    expect(post.hp).toBe(100);
    run(sim, 2);
    expect(post.hp).toBe(post.maxHp);
    expect(post.pos).toEqual(home);
  });

  it('reads a tank against the plated post', () => {
    const [bare, plated] = posts(rangeSim());
    expect(mitigationMultiplier(bare!, 'physical')).toBe(1);
    expect(mitigationMultiplier(plated!, 'magic')).toBeLessThan(0.6);
  });

  it("is what the client's Star Orchard sim builds when asked, and only then", () => {
    const orchard = starOrchard();
    expect(posts(orchardSim(orchard, 3, { team: 0 })).map((u) => u.postKind)).toEqual([
      ...STRIKEPOST_ORDER,
    ]);
    expect(posts(orchardSim(orchard, 3))).toEqual([]);
  });

  it('stands the same on the test map', () => {
    const sim = new Sim(1, { map: GAME_MAP, range: { team: 0 } });
    expect(posts(sim)).toHaveLength(STRIKEPOST_ORDER.length);
  });
});
