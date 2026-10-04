// A unit's body dressed for the match (src/render/body_dress.ts): toon
// unless the terrain authored it, a champion's silhouette twins on the
// planet, and a warm-up sample dressed exactly like the live body it
// stands for, so the programs the warm-up links are the ones the match
// draws with. The fights' warm-up once built its samples undressed: its
// champions and creatures linked Lambert programs while every live body
// drew toon ones, and the first of each seen still linked its own.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { bodyDress, dressBody, programPicks, warmUnit } from '../src/render/body_dress';
import { buildCampMesh } from '../src/render/camp_shapes';
import { buildChampionMesh } from '../src/render/champion_shapes';
import { buildCreatureMesh } from '../src/render/creature_shapes';
import { attachGhosts, ghostMaterial } from '../src/render/planet_ghost';
import { WARM_BODIES } from '../src/render/warm_samples';
import type { Unit } from '../src/sim/unit';

// A body built the way the renderer's unit builder builds one of these
// kinds (its champion figure, a creature, a camp), then dressed.
function built(u: Unit, planet: boolean): THREE.Group {
  const holder = new THREE.Group();
  if (u.kind === 'champion') holder.add(buildChampionMesh(u.championId, 0x4a7dd6, u.skin));
  else if (u.kind === 'creature') buildCreatureMesh(u, holder);
  else if (u.kind === 'camp') buildCampMesh(u, holder);
  const ghostMat = ghostMaterial(0xff4a3a);
  dressBody(holder, bodyDress(u.kind, { authored: false, planet }), (body) =>
    attachGhosts(body, ghostMat),
  );
  return holder;
}

// A live unit of the same kind: a seat, a team, a place, its own look.
function live(sample: Partial<Unit>): Unit {
  return {
    id: 4242,
    team: 1,
    pos: { x: 120, z: -40 },
    aspect: 'tide',
    ...sample,
  } as unknown as Unit;
}

describe("a body's dress", () => {
  it('turns every body toon but a structure the terrain authored', () => {
    expect(bodyDress('creature', { authored: false, planet: false }).toon).toBe(true);
    expect(bodyDress('tower', { authored: true, planet: false }).toon).toBe(false);
  });

  it("gives a champion's body its ghosts on the planet only", () => {
    expect(bodyDress('champion', { authored: false, planet: true }).ghosts).toBe(true);
    expect(bodyDress('champion', { authored: false, planet: false }).ghosts).toBe(false);
    for (const kind of ['creature', 'camp', 'warden'] as const) {
      expect(bodyDress(kind, { authored: false, planet: true }).ghosts).toBe(false);
    }
  });

  it("keeps a Lambert material's side, see-through, vertex and instance colors in its toon twin", () => {
    const geometry = new THREE.BoxGeometry();
    const root = new THREE.Group();
    const lambert = new THREE.MeshLambertMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5,
      vertexColors: true,
    });
    const cells = new THREE.InstancedMesh(geometry, lambert, 2);
    cells.setColorAt(0, new THREE.Color(0xff0000));
    root.add(cells);
    const before = programPicks(root)[0]!;
    dressBody(root, bodyDress('camp', { authored: false, planet: false }), () => undefined);
    const after = programPicks(root)[0]!;
    expect(after.startsWith('MeshToonMaterial, double, transparent')).toBe(true);
    for (const kept of ['vertex colors', 'instance colors']) {
      expect(before).toContain(kept);
      expect(after).toContain(kept);
    }
  });
});

describe('a warm-up sample and the live body it stands for', () => {
  const samples: Partial<Unit>[] = [
    ...WARM_BODIES.filter((b) => b.kind !== 'warden').map((b) => b as Partial<Unit>),
    ...['korrath', 'sylra', 'elowen', 'torv'].map(
      (id) => ({ kind: 'champion', championId: id, skin: 0 }) as Partial<Unit>,
    ),
  ];

  for (const planet of [true, false]) {
    it(`link the same programs ${planet ? 'on the planet' : 'on the plane'}`, () => {
      for (const sample of samples) {
        const warm = programPicks(built(warmUnit(sample), planet));
        const match = programPicks(built(live(sample), planet));
        expect(warm.length).toBeGreaterThan(0);
        expect(warm).toEqual(match);
        // Dressed: no Lambert program left to link.
        expect(warm.some((p) => p.startsWith('MeshLambertMaterial'))).toBe(false);
        const ghosts = warm.some((p) => p.includes('key col-ghost'));
        expect(ghosts).toBe(planet && sample.kind === 'champion');
      }
    });
  }

  it("go through the renderer's one builder, which dresses through this module", () => {
    const source = readFileSync('src/render/renderer.ts', 'utf8');
    const between = (from: string, to: string): string => {
      const start = source.indexOf(from);
      return source.slice(start, source.indexOf(to, start));
    };
    // The warm-up's body and champion samples, and the units as they come
    // into sight, all build through buildBody.
    const warm = between('private warmFights(', '\n  }\n');
    expect(warm.match(/this\.buildBody\(/g)).toHaveLength(2);
    expect(warm).toContain('this.buildBody(warmUnit(body))');
    expect(between('  onSimTick(): void {', '\n  }\n')).toContain('this.buildBody(u)');
    // buildBody dresses through bodyDress and dressBody, and nothing else
    // in the renderer turns a body toon on its own.
    const buildBody = between('  private buildBody(', '\n  }\n');
    expect(buildBody).toContain('bodyDress(u.kind');
    expect(buildBody).toContain('dressBody(holder, dress');
    expect(source).not.toContain('toonifyMaterials');
  });
});
