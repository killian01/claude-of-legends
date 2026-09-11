// The rings gate (docs/plan-rings.md): the Star Orchard's two corner
// circles hold the Pyrefang (bot, 4:00) and the Voidmaul (top, 6:30), each
// rising on its clock with the next aspect of a fixed order, neutral and
// in the fog until a team has sight on its ring, fighting champions only inside it, resetting
// when pulled out or left alone, and paying the killing team its aspect as
// a permanent favor plus gold to every member. Once its three aspects are
// spent a ring's creature returns as its Ascendant, whose death hands the
// Wrath instead. The Warden rises last, at 12:00. Played on the export,
// since the launch map fixture has no rings.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dealDamage } from '../src/sim/combat/damage';
import { GAME_MAP } from '../src/sim/content/map';
import {
  ASPECTS,
  bodyGrowth,
  CREATURE_LIST,
  CREATURES,
  FAVOR_MAX_STACKS,
  RING_GOLD_EACH,
  WRATH_DURATION_S,
} from '../src/sim/content/rings';
import {
  type StarOrchardLayout,
  type StarOrchardManifest,
  starOrchardMap,
} from '../src/sim/content/star_orchard';
import { WARDEN_FIRST_SPAWN_S } from '../src/sim/objectives';
import { Sim } from '../src/sim/sim';
import type { CombatCtx } from '../src/sim/sim_context';
import { decodeTerrainNav, TerrainNavGrid } from '../src/sim/terrain_nav';
import type { TeamId } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';

const TICKS_PER_S = 20;

const folder = new URL('../public/map/star-orchard/', import.meta.url);
const manifest: StarOrchardManifest = JSON.parse(
  readFileSync(new URL('manifest.json', folder), 'utf8'),
);
const layout: StarOrchardLayout = JSON.parse(
  readFileSync(new URL('gameplay.json', folder), 'utf8'),
);
const binary = readFileSync(new URL('navigation.bin', folder));
const navigation = binary.buffer.slice(
  binary.byteOffset,
  binary.byteOffset + binary.byteLength,
) as ArrayBuffer;

function orchardSim(seed = 11): Sim {
  const map = starOrchardMap(layout, manifest);
  const nav = new TerrainNavGrid(decodeTerrainNav(manifest, navigation));
  return new Sim(seed, { map, nav, strictNavigation: true });
}

function ctxOf(sim: Sim): CombatCtx {
  return (sim as unknown as { ctx(): CombatCtx }).ctx();
}

function creatures(sim: Sim): Unit[] {
  return [...sim.units.values()].filter((u) => u.kind === 'creature');
}

function creatureOf(sim: Sim, id: 'pyrefang' | 'voidmaul'): Unit | undefined {
  return creatures(sim).find((u) => u.creatureId === id);
}

// Rewind a ring's clock instead of ticking four sim-minutes to meet the
// creature; the schedule itself is pinned by its own test below.
function rise(sim: Sim, id: 'pyrefang' | 'voidmaul'): Unit {
  const state = sim.ringStates.find((s) => s.creature === id)!;
  state.nextRiseAt = sim.time;
  for (let i = 0; i < 3 * TICKS_PER_S && !creatureOf(sim, id); i++) sim.tick();
  const c = creatureOf(sim, id);
  expect(c).toBeDefined();
  return c!;
}

// A champion of `team` beside the creature slays it: mid-fight state (nearly
// dead and recently hit, so the calm reset never fires), then the strike.
function slay(sim: Sim, c: Unit, team: TeamId, slayer?: Unit): Unit {
  const s = slayer ?? sim.addChampion(team, { x: c.pos.x + 2, z: c.pos.z });
  c.hp = 1;
  c.lastDamagedAt = sim.time;
  sim.orderAttack(s.id, c.id);
  for (let i = 0; i < 100 && sim.units.has(c.id); i++) sim.tick();
  expect(sim.units.has(c.id)).toBe(false);
  return s;
}

describe('the rings', () => {
  it('are traced by the export, one at the elbow of each side lane, walkable', () => {
    const sim = orchardSim();
    const rings = sim.map.rings ?? [];
    expect(rings.map((r) => r.id).sort()).toEqual(['bot', 'top']);
    for (const ring of rings) {
      expect(ring.lane).toBe(ring.id);
      expect(sim.nav.isWalkableAt(ring.x, ring.z), ring.id).toBe(true);
      // Neutral ground: the same distance from both teams' outer towers.
      const outer = sim.map.towers.filter((t) => t.lane === ring.lane && t.tier === 1);
      expect(outer).toHaveLength(2);
      const d = outer.map((t) => Math.hypot(t.x - ring.x, t.z - ring.z));
      expect(Math.abs(d[0]! - d[1]!)).toBeLessThan(2);
      expect(ring.r).toBeGreaterThan(10);
    }
    expect(GAME_MAP.rings ?? []).toHaveLength(0);
    expect(new Sim(7).ringStates).toHaveLength(0);
  });

  it('rise in order: the Pyrefang at 4:00, the Voidmaul at 6:30, the Warden last at 12:00', () => {
    expect(CREATURES.pyrefang.firstRiseS).toBe(240);
    expect(CREATURES.voidmaul.firstRiseS).toBe(390);
    expect(WARDEN_FIRST_SPAWN_S).toBe(720);
    expect(CREATURES.pyrefang.firstRiseS).toBeLessThan(CREATURES.voidmaul.firstRiseS);
    expect(CREATURES.voidmaul.firstRiseS).toBeLessThan(WARDEN_FIRST_SPAWN_S);
    for (const def of CREATURE_LIST) {
      expect(def.returnS).toBe(180);
      expect(def.ascendant.returnS).toBe(300);
    }
    const sim = orchardSim();
    const clocks = sim.ringClocks();
    expect(clocks.map((c) => [c.ring, c.creature, c.riseAt, c.aspect, c.ascendant])).toEqual([
      ['top', 'voidmaul', 390, 'bulwark', false],
      ['bot', 'pyrefang', 240, 'might', false],
    ]);
    // Nothing stands on a ring before its clock strikes, and the
    // Pyrefang stands there the tick it does.
    sim.time = 239;
    while (sim.time < 240 - 0.01) {
      sim.tick();
      expect(creatures(sim), String(sim.time)).toHaveLength(0);
    }
    sim.tick();
    sim.tick();
    const p = creatureOf(sim, 'pyrefang');
    expect(p).toBeDefined();
    expect(sim.ringClocks().find((c) => c.ring === 'bot')?.riseAt).toBeNull();
  });

  it('stands on its ring, neutral, in the fog until a team has sight, grown with the clock', () => {
    const sim = orchardSim();
    sim.time = CREATURES.pyrefang.firstRiseS;
    const p = rise(sim, 'pyrefang');
    const ring = sim.map.rings!.find((r) => r.id === 'bot')!;
    expect(Math.hypot(p.pos.x - ring.x, p.pos.z - ring.z)).toBeLessThan(1);
    expect(p.neutral).toBe(true);
    expect(p.aspect).toBe('might');
    // The body sits in the fog like a camp (ADR 0023); its clock stays
    // public to both teams.
    expect(sim.isVisible(0, p.id)).toBe(false);
    expect(sim.isVisible(1, p.id)).toBe(false);
    expect(sim.ringClocks().find((c) => c.ring === 'bot')?.unitId).toBe(p.id);
    sim.addChampion(1, { x: p.pos.x + 5, z: p.pos.z });
    sim.tick();
    expect(sim.isVisible(1, p.id)).toBe(true);
    expect(sim.isVisible(0, p.id)).toBe(false);
    // Grown at the tick it rose (a few ticks past the clock, so within a
    // fraction of a percent of the clock's own growth).
    const expected = CREATURES.pyrefang.body.hp * bodyGrowth(CREATURES.pyrefang.firstRiseS);
    expect(Math.abs(p.maxHp - expected) / expected).toBeLessThan(0.005);
    expect(p.bitePct).toBe(CREATURES.pyrefang.body.bitePct);
    expect(p.ascendant).toBe(false);
    expect(p.goldBounty).toBe(0);
    // Grown with the clock: the same body at 12:00 is about twice the one
    // at 4:00, the way a laner's sustained damage is (content/rings.ts,
    // BODY_GROWTH); the resistances stay as written.
    const late = orchardSim();
    late.time = 720;
    const p12 = rise(late, 'pyrefang');
    expect(p12.maxHp).toBeGreaterThan(p.maxHp * 1.7);
    expect(p12.stats.armor).toBe(p.stats.armor);
    expect(p12.stats.ad).toBeGreaterThan(p.stats.ad);
  });

  it('retaliates against a champion that hits it, and resets when left alone', () => {
    const sim = orchardSim();
    const v = rise(sim, 'voidmaul');
    const diver = sim.addChampion(0, { x: v.pos.x + 2, z: v.pos.z });
    sim.orderAttack(diver.id, v.id);
    let retaliated = false;
    for (let i = 0; i < 6 * TICKS_PER_S && !retaliated; i++) {
      sim.tick();
      if (v.attackTargetId === diver.id) retaliated = true;
    }
    expect(retaliated).toBe(true);
    // The diver leaves; alone and hurt, the creature resets at the center.
    sim.orderMove(diver.id, diver.pos.x + 30, diver.pos.z);
    v.hp = v.maxHp - 500;
    for (let i = 0; i < 8 * TICKS_PER_S; i++) sim.tick();
    expect(v.hp).toBe(v.maxHp);
    const ring = sim.map.rings!.find((r) => r.id === 'top')!;
    expect(Math.hypot(v.pos.x - ring.x, v.pos.z - ring.z)).toBeLessThan(1);
    expect(v.attackTargetId).toBeNull();
  });

  it('left alone while hurt, heals fast rather than snapping to full', () => {
    const sim = orchardSim();
    const p = rise(sim, 'pyrefang');
    p.hp = Math.round(p.maxHp * 0.2);
    p.lastDamagedAt = sim.time;
    // Five seconds of calm, then the regeneration: not full yet after two
    // more seconds, full within a minute of it.
    for (let i = 0; i < 7 * TICKS_PER_S; i++) sim.tick();
    expect(p.hp).toBeGreaterThan(p.maxHp * 0.24);
    expect(p.hp).toBeLessThan(p.maxHp * 0.5);
    for (let i = 0; i < 40 * TICKS_PER_S; i++) sim.tick();
    expect(p.hp).toBe(p.maxHp);
    // Hit again while calm and hurt, it fights on from where it stands.
    p.hp = Math.round(p.maxHp * 0.5);
    p.lastDamagedAt = sim.time;
    for (let i = 0; i < 2 * TICKS_PER_S; i++) {
      p.lastDamagedAt = sim.time;
      sim.tick();
    }
    expect(p.hp).toBe(Math.round(p.maxHp * 0.5));
  });

  it('holds its target anywhere on the platform, stairs included, and resets past it', () => {
    const sim = orchardSim();
    const p = rise(sim, 'pyrefang');
    const ring = sim.map.rings!.find((r) => r.id === 'bot')!;
    // The leash reaches the foot of the fan stairs, well past the disc.
    expect(ring.leash).toBeGreaterThan(ring.r + 4);
    expect(ring.leash).toBeLessThan(ring.r + 10);
    // A champion on the steps (past the disc's edge) keeps the creature's
    // attention and the creature follows without resetting.
    const stairs = sim.addChampion(0, { x: ring.x - ring.r - 2, z: ring.z });
    p.hp = p.maxHp - 400;
    p.lastDamagedAt = sim.time;
    p.attackTargetId = stairs.id;
    for (let i = 0; i < 2 * TICKS_PER_S; i++) {
      p.lastDamagedAt = sim.time;
      sim.tick();
    }
    expect(p.attackTargetId).toBe(stairs.id);
    expect(p.hp).toBeLessThan(p.maxHp);
    // Pulled past the foot of the stairs, it resets to full at the center.
    p.pos = { x: ring.x - ring.leash - 2, z: ring.z };
    sim.tick();
    expect(p.hp).toBe(p.maxHp);
    expect(Math.hypot(p.pos.x - ring.x, p.pos.z - ring.z)).toBeLessThan(1);
  });

  it('pays the killing team its aspect as a favor and gold to every member, dead or alive', () => {
    const sim = orchardSim();
    const p = rise(sim, 'pyrefang');
    const far = sim.addChampion(1, { x: 30, z: 120 });
    const corpse = sim.addChampion(1, { x: 40, z: 120 });
    corpse.dead = true;
    corpse.respawnAt = sim.time + 60;
    const rival = sim.addChampion(0, { x: 30, z: 30 });
    const before = [far.gold, corpse.gold, rival.gold];
    const slayer = slay(sim, p, 1);
    // No last-hit bounty: the slayer gets the team's share and nothing more.
    expect(slayer.gold - 500).toBe(RING_GOLD_EACH);
    expect(far.gold - before[0]!).toBe(RING_GOLD_EACH);
    expect(corpse.gold - before[1]!).toBe(RING_GOLD_EACH);
    expect(rival.gold - before[2]!).toBe(0);
    expect(sim.teamFavors(1).might).toBe(1);
    expect(sim.teamFavors(0).might).toBe(0);
    // Every member mirrors the team's favor, the corpse included.
    for (const u of [slayer, far, corpse]) expect(u.favors.might).toBe(1);
    expect(rival.favors.might).toBe(0);
    // The ring's clock restarts, carrying the next aspect of the order.
    const clock = sim.ringClocks().find((c) => c.ring === 'bot')!;
    expect(clock.riseAt).not.toBeNull();
    expect(clock.riseAt! - sim.time).toBeGreaterThan(CREATURES.pyrefang.returnS - 6);
    expect(clock.aspect).toBe('tide');
  });

  it('shares its xp among the killing team present, like the Warden', () => {
    const sim = orchardSim();
    const p = rise(sim, 'pyrefang');
    const near = sim.addChampion(1, { x: p.pos.x - 3, z: p.pos.z });
    const xpBefore = near.xp;
    slay(sim, p, 1);
    expect(near.xp + (near.level - 1) * 1000).toBeGreaterThan(xpBefore);
  });

  it('carries its aspects in a fixed order, once each, then rises as its Ascendant', () => {
    const sim = orchardSim();
    const seen: (string | null)[] = [];
    const slayer = sim.addChampion(1, { x: 120, z: 30 });
    const far = sim.addChampion(1, { x: 30, z: 120 });
    let ascendant: Unit | null = null;
    for (let i = 0; i < 5; i++) {
      const p = rise(sim, 'pyrefang');
      seen.push(p.aspect);
      if (i === 3) {
        ascendant = p;
        expect(p.ascendant).toBe(true);
        expect(sim.ringClocks().find((c) => c.ring === 'bot')).toMatchObject({
          aspect: null,
          ascendant: true,
          unitId: p.id,
        });
        // The bigger body: a team's fight, not a duo's.
        expect(p.maxHp).toBeGreaterThan(CREATURES.pyrefang.body.hp * bodyGrowth(sim.time) * 1.5);
        expect(p.radius).toBeGreaterThan(CREATURES.pyrefang.body.radius);
        const gold = far.gold;
        slayer.pos = { x: p.pos.x + 2, z: p.pos.z };
        slay(sim, p, 1, slayer);
        // Its death hands the Wrath and the gold, and no favor.
        expect(sim.teamWrath(1)).toBeCloseTo(sim.time + WRATH_DURATION_S, 0);
        expect(sim.teamWrath(0)).toBeNull();
        expect(far.gold - gold).toBe(RING_GOLD_EACH);
        // And the ring's clock restarts on the Ascendant's longer return.
        const clock = sim.ringClocks().find((c) => c.ring === 'bot')!;
        expect(clock.ascendant).toBe(true);
        expect(clock.riseAt! - sim.time).toBeGreaterThan(CREATURES.pyrefang.ascendant.returnS - 6);
        continue;
      }
      slayer.pos = { x: p.pos.x + 2, z: p.pos.z };
      slay(sim, p, 1, slayer);
    }
    expect(ascendant).not.toBeNull();
    expect(seen).toEqual(['might', 'tide', 'tempo', null, null]);
    expect(sim.teamFavors(1)).toMatchObject({ might: 1, tide: 1, tempo: 1 });
    // The Voidmaul's order is its own.
    expect(CREATURES.voidmaul.aspects).toEqual(['bulwark', 'swiftness', 'resolve']);
    expect(CREATURES.pyrefang.aspects).toEqual(['might', 'tide', 'tempo']);
    // Each ring alternates offense and defense: neither is the boring one.
    expect(Object.keys(ASPECTS).sort()).toEqual([
      'bulwark',
      'might',
      'resolve',
      'swiftness',
      'tempo',
      'tide',
    ]);
  });

  it('holds each aspect once: a second grant of the same favor changes nothing', () => {
    const sim = orchardSim();
    for (let i = 0; i < FAVOR_MAX_STACKS + 2; i++) sim.grantFavor(0, 'might');
    expect(FAVOR_MAX_STACKS).toBe(1);
    expect(sim.teamFavors(0).might).toBe(1);
  });

  it('pays nobody when no champion made the kill, and the clock restarts anyway', () => {
    const sim = orchardSim();
    const p = rise(sim, 'pyrefang');
    const bystander = sim.addChampion(0, { x: 30, z: 30 });
    const gold = bystander.gold;
    // A death with no unit on record as the source.
    dealDamage(ctxOf(sim), 0, p, 99999, 'true');
    sim.tick();
    expect(sim.units.has(p.id)).toBe(false);
    expect(bystander.gold - gold).toBe(0);
    expect(sim.teamFavors(0).might).toBe(0);
    expect(sim.teamFavors(1).might).toBe(0);
    expect(sim.ringClocks().find((c) => c.ring === 'bot')?.riseAt).not.toBeNull();
  });

  it('survives a world checkpoint: the clocks, the favors and the Wrath restore', () => {
    const sim = orchardSim();
    const p = rise(sim, 'pyrefang');
    slay(sim, p, 1);
    sim.ringStates.find((s) => s.ring === 'bot')!.riseIndex = 3;
    slay(sim, rise(sim, 'pyrefang'), 0);
    const snap = sim.snapshot();
    const clocks = sim.ringClocks();
    const favors = sim.teamFavors(1);
    const wrath = sim.teamWrath(0);
    expect(wrath).not.toBeNull();
    for (let i = 0; i < 40; i++) sim.tick();
    sim.grantFavor(0, 'bulwark');
    sim.restore(snap);
    expect(sim.ringClocks()).toEqual(clocks);
    expect(sim.teamFavors(1)).toEqual(favors);
    expect(sim.teamFavors(0).bulwark).toBe(0);
    expect(sim.teamWrath(0)).toBe(wrath);
  });
});
