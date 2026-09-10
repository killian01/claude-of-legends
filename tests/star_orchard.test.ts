// The Star Orchard test mode (docs/star-orchard.md): the shipped export
// under public/map/star-orchard/ assembles into a map the real sim plays
// with the real house bots, on the exported walkability grid, and the
// launch map stays exactly what it was for every other match.

import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { attachBot } from '../src/sim/content/bots';
import { houseSeats } from '../src/sim/content/bots/house';
import { GAME_MAP } from '../src/sim/content/map';
import {
  STAR_ORCHARD_TOWERS,
  type StarOrchardLayout,
  type StarOrchardManifest,
  starOrchardMap,
} from '../src/sim/content/star_orchard';
import { findPath } from '../src/sim/pathfind';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { isInvulnerable } from '../src/sim/structure_rules';
import { decodeTerrainNav, TerrainNavGrid } from '../src/sim/terrain_nav';
import type { TeamId } from '../src/sim/types';

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

// A match the way the test mode builds one: the pick on team 0, the fill
// as house bots on both sides, strict navigation on the exported grid.
function match(team: TeamId = 0, seed = 42) {
  const map = starOrchardMap(layout, manifest);
  const nav = new TerrainNavGrid(decodeTerrainNav(manifest, navigation));
  const sim = new Sim(seed, { map, nav, strictNavigation: true });
  const rng = new Rng(seed);
  const self = sim.addChampion(team, undefined, 'sylra');
  for (const seat of houseSeats([{ championId: 'sylra' }], rng)) {
    attachBot(sim, sim.addChampion(team, undefined, seat.championId).id, seat.bot);
  }
  const other = (team === 0 ? 1 : 0) as TeamId;
  for (const seat of houseSeats([], rng)) {
    attachBot(sim, sim.addChampion(other, undefined, seat.championId).id, seat.bot);
  }
  return { sim, nav, self, map };
}

describe('the Star Orchard export', () => {
  it('ships one revision whose gameplay, navigation and model agree', () => {
    expect(manifest.revision).toBe(layout.revision);
    expect(manifest.sourceSha256).toBe(layout.sourceSha256);
    expect(navigation.byteLength).toBe(manifest.cells ** 2 * 2);
    expect(layout.towers).toHaveLength(STAR_ORCHARD_TOWERS);
  });

  it('ships a model a match can download: compressed, capped, with its towers', () => {
    const file = new URL('map.glb', folder);
    const bytes = statSync(file).size;
    expect(bytes).toBe(manifest.visualReport?.glbBytes);
    expect(bytes).toBeLessThan(60e6);
    const fd = openSync(file, 'r');
    try {
      const header = Buffer.alloc(20);
      readSync(fd, header, 0, 20, 0);
      const json = Buffer.alloc(header.readUInt32LE(12));
      readSync(fd, json, 0, json.length, 20);
      const gltf = JSON.parse(json.toString('utf8')) as {
        extensionsUsed?: string[];
        nodes: { extras?: { role?: string } }[];
        images?: { mimeType?: string }[];
      };
      expect(gltf.extensionsUsed).toContain('EXT_meshopt_compression');
      expect(gltf.nodes.filter((n) => n.extras?.role === 'defensive_tower')).toHaveLength(
        STAR_ORCHARD_TOWERS,
      );
      for (const image of gltf.images ?? []) expect(image.mimeType).toBe('image/webp');
    } finally {
      closeSync(fd);
    }
  });

  it('refuses a gameplay record traced on another Blender source', () => {
    expect(() => starOrchardMap({ ...layout, sourceSha256: 'stale' }, manifest)).toThrow(
      'does not match',
    );
    expect(() => starOrchardMap(layout, { ...manifest, revision: 0 })).toThrow('does not match');
  });

  it('assembles the map: three towers a lane, two guardians a base, five spawns a team', () => {
    const map = starOrchardMap(layout, manifest);
    for (const team of [0, 1] as const) {
      for (const lane of ['top', 'mid', 'bot'] as const) {
        const tiers = map.towers
          .filter((t) => t.team === team && t.lane === lane)
          .map((t) => t.tier)
          .sort();
        expect(tiers).toEqual([1, 2, 3]);
      }
      expect(map.towers.filter((t) => t.team === team && t.lane === 'sanctum')).toHaveLength(2);
      expect(map.spawns?.filter((s) => s.team === team)).toHaveLength(5);
      expect(map.fountains.filter((f) => f.team === team)).toHaveLength(1);
      expect(map.sanctums.filter((s) => s.team === team)).toHaveLength(1);
    }
    expect(map.camps).toHaveLength(6);
    expect(map.camps.filter((c) => c.buff)).toHaveLength(2);
    expect(map.laneWidth).toBe(11.5);
    for (const lane of Object.values(map.lanes)) expect(lane.length).toBeGreaterThan(1);
  });

  it('leaves the launch map to every match that does not ask for it', () => {
    const before = JSON.stringify(GAME_MAP);
    const { sim } = match();
    expect(new Sim(7).map).toBe(GAME_MAP);
    expect(sim.map).not.toBe(GAME_MAP);
    expect(JSON.stringify(GAME_MAP)).toBe(before);
    expect(new Sim(7).map.towers).toHaveLength(16);
    expect(sim.map.towers).toHaveLength(STAR_ORCHARD_TOWERS);
  });
});

describe('a match on the Star Orchard', () => {
  it.each([0, 1] as const)(
    'seats team %i on its platform, connected to every lane, camp and the center',
    (team) => {
      const { sim, nav, map } = match(team);
      const fountain = map.fountains.find((f) => f.team === team)!;
      const start = { x: fountain.x, z: fountain.z };
      expect(nav.heightAt(start.x, start.z)).toBeCloseTo(3.82, 2);
      for (const unit of sim.units.values()) {
        if (unit.kind !== 'champion') continue;
        expect(nav.isWalkableAt(unit.pos.x, unit.pos.z)).toBe(true);
        if (unit.team === team) expect(nav.heightAt(unit.pos.x, unit.pos.z)).toBeCloseTo(3.82, 2);
      }
      const destinations = [
        ...manifest.landmarks.map((p) => ({ x: p.x, z: -p.z })),
        ...Object.values(map.lanes).flat(),
      ];
      for (const destination of destinations) {
        const route = findPath(nav, start, destination);
        expect(route.length, JSON.stringify(destination)).toBeGreaterThan(0);
        let previous = start;
        for (const point of route) {
          expect(nav.lineOfWalk(previous, point), JSON.stringify({ previous, point })).toBe(true);
          previous = point;
        }
      }
    },
  );

  it('protects each lane tower until the tiers in front of it fall', () => {
    const { sim } = match();
    const towers = [...sim.units.values()].filter(
      (u) => u.team === 1 && u.structure?.lane === 'mid',
    );
    const outer = towers.find((u) => u.structure?.tier === 1)!;
    const inner = towers.find((u) => u.structure?.tier === 2)!;
    const base = towers.find((u) => u.structure?.tier === 3)!;
    expect(isInvulnerable(sim.units, outer)).toBe(false);
    expect(isInvulnerable(sim.units, inner)).toBe(true);
    expect(isInvulnerable(sim.units, base)).toBe(true);
    outer.dead = true;
    expect(isInvulnerable(sim.units, inner)).toBe(false);
    expect(isInvulnerable(sim.units, base)).toBe(true);
    inner.dead = true;
    expect(isInvulnerable(sim.units, base)).toBe(false);
  });

  it('keeps baked collisions after a temporary wall over them is lifted', () => {
    const { nav } = match();
    const baseline = nav.snapshotBlockers();
    nav.blockCircle(33.8, 29.4, 2);
    nav.unblockCircle(33.8, 29.4, 2);
    expect(nav.snapshotBlockers()).toEqual(baseline);
  });

  it('runs waves, camps and the house bots on the exported grid, every unit on open ground', () => {
    const { sim, nav, map } = match();
    const damage = new Set<string>();
    const advancing = new Set<string>();
    const botsOut = new Set<number>();
    for (let tick = 0; tick < 1800; tick++) {
      for (const event of sim.tick()) {
        if (event.type === 'damage') {
          const source = sim.units.get(event.sourceId);
          if (source) damage.add(source.kind);
        }
      }
      if (tick % 100 !== 0) continue;
      for (const unit of sim.units.values()) {
        if (unit.dead || unit.moveSpeed <= 0) continue;
        expect(
          nav.isWalkableAt(unit.pos.x, unit.pos.z),
          JSON.stringify({ tick, id: unit.id, kind: unit.kind, pos: unit.pos }),
        ).toBe(true);
        const home = map.fountains.find((f) => f.team === unit.team)!;
        const away = Math.hypot(unit.pos.x - home.x, unit.pos.z - home.z);
        if (unit.kind === 'minion' && away > 35) advancing.add(`${unit.team}:${unit.lane}`);
        if (unit.kind === 'champion' && sim.policies.has(unit.id) && away > 30)
          botsOut.add(unit.id);
      }
    }
    expect([...sim.units.values()].filter((u) => u.kind === 'camp')).toHaveLength(6);
    expect(advancing.size, JSON.stringify([...advancing])).toBe(6);
    // The house bots walk THIS map's lanes: on the launch map's lane
    // coordinates they would stand in cliffs and never leave the platform.
    expect(botsOut.size).toBeGreaterThanOrEqual(6);
    expect(damage.has('minion')).toBe(true);
    expect(damage.has('champion')).toBe(true);
    expect(damage.has('tower')).toBe(true);
  }, 60000);

  it.each([0, 1] as const)('recalls, shops and respawns on platform %i', (team) => {
    const { sim, nav, self, map } = match(team);
    sim.policies.clear();
    const camp = map.camps[team === 0 ? 2 : 3]!;
    self.pos = { x: camp.x, z: camp.z };
    sim.startRecall(self.id);
    for (let tick = 0; tick < 180; tick++) sim.tick();
    const home = map.fountains.find((f) => f.team === team)!;
    expect(self.pos).toEqual({ x: home.x, z: home.z });
    expect(nav.heightAt(self.pos.x, self.pos.z)).toBeCloseTo(3.82, 2);
    expect(sim.buyItem(self.id, 'iron_blade')).toBe(true);
    const champions = [...sim.units.values()].filter((u) => u.kind === 'champion');
    for (const unit of champions) {
      unit.dead = true;
      unit.respawnAt = sim.time;
    }
    sim.tick();
    for (const unit of champions) {
      expect(unit.dead).toBe(false);
      expect(nav.isWalkableAt(unit.pos.x, unit.pos.z)).toBe(true);
      expect(nav.heightAt(unit.pos.x, unit.pos.z)).toBeCloseTo(3.82, 2);
    }
  });

  it.each([0, 1] as const)(
    'heals and sells on every seat of platform %i, and not at its Sanctum',
    (team) => {
      const { sim, map } = match(team);
      sim.policies.clear();
      for (const u of [...sim.units.values()]) if (u.kind === 'tower') sim.units.delete(u.id);
      const seats = map.spawns?.filter((s) => s.team === team) ?? [];
      const champions = [...sim.units.values()].filter(
        (u) => u.kind === 'champion' && u.team === team,
      );
      expect(champions.map((u) => u.pos)).toEqual(seats.map((s) => ({ x: s.x, z: s.z })));
      // The terrace is a band around the Sanctum: the seats at its ends
      // stand well past the middle pad's reach, and the fountain is there
      // anyway, for the shop and for the healing alike.
      const home = map.fountains.find((f) => f.team === team)!;
      const ends = [seats[0]!, seats[seats.length - 1]!];
      for (const seat of ends) {
        expect(Math.hypot(seat.x - home.x, seat.z - home.z)).toBeGreaterThan(10);
      }
      for (const unit of champions) {
        expect(sim.buyItem(unit.id, 'iron_blade'), `seat ${unit.pos.x},${unit.pos.z}`).toBe(true);
        unit.hp = unit.maxHp / 2;
      }
      sim.tick();
      for (const unit of champions) {
        expect(unit.hp, `seat ${unit.pos.x},${unit.pos.z}`).toBeGreaterThan(unit.maxHp * 0.504);
      }
      // An enemy on the terrace is not burned: the burn is the middle pad's.
      const foe = [...sim.units.values()].find((u) => u.kind === 'champion' && u.team !== team)!;
      foe.pos = { x: seats[0]!.x, z: seats[0]!.z };
      const onSeat = foe.hp;
      sim.tick();
      expect(foe.hp).toBeGreaterThanOrEqual(onSeat);
      foe.pos = { x: home.x, z: home.z };
      const onPad = foe.hp;
      sim.tick();
      expect(foe.hp).toBeLessThan(onPad);
      // Not on the base ground in front of the Sanctum, where a defender fights.
      const sanctum = map.sanctums.find((s) => s.team === team)!;
      const self = champions[0]!;
      const toward = team === 0 ? 1 : -1;
      self.pos = { x: sanctum.x + 5 * toward, z: sanctum.z + toward };
      self.gold = 1000;
      expect(sim.buyItem(self.id, 'iron_blade')).toBe(false);
      expect(sim.sellItem(self.id, 0)).toBe(false);
    },
  );

  it('sends no bot out of its seat empty-handed', () => {
    // The default playbooks shop when the bot stands at its fountain: on the
    // launch map every seat is, and on the terrace every seat now is too.
    const { sim } = match();
    for (let tick = 0; tick < 100; tick++) sim.tick();
    for (const unit of sim.units.values()) {
      if (unit.kind !== 'champion' || !sim.policies.has(unit.id)) continue;
      expect(unit.items.length, `bot ${unit.id} on team ${unit.team}`).toBeGreaterThan(0);
    }
  });

  it('ends when the enemy Sanctum falls', () => {
    const { sim, nav, self } = match();
    sim.policies.clear();
    for (const unit of [...sim.units.values()]) {
      if (unit.team === 1 && unit.kind === 'tower') sim.units.delete(unit.id);
    }
    const sanctum = [...sim.units.values()].find((u) => u.kind === 'sanctum' && u.team === 1)!;
    self.pos = nav.nearestWalkable(sanctum.pos.x - 4, sanctum.pos.z - 4)!;
    sanctum.hp = 40;
    sim.orderAttack(self.id, sanctum.id);
    for (let tick = 0; tick < 100 && sim.winner === null; tick++) sim.tick();
    expect(sim.winner).toBe(0);
  });

  it('is deterministic: two matches on one seed play out identically', () => {
    const a = match(0, 9);
    const b = match(0, 9);
    for (let tick = 0; tick < 600; tick++) {
      a.sim.tick();
      b.sim.tick();
    }
    const state = (sim: Sim) =>
      [...sim.units.values()].map((u) => [u.id, u.pos.x, u.pos.z, u.hp, u.dead]);
    expect(state(a.sim)).toEqual(state(b.sim));
  });
});
