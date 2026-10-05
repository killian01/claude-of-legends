// Where a ring's creature looks at rest (src/render/creature_facing.ts):
// at the nearest point of its ring's lane, on the Star Orchard export.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { creatureRest, nearestOnPath, ringRestYaw } from '../src/render/creature_facing';
import {
  type StarOrchardLayout,
  type StarOrchardManifest,
  starOrchardMap,
} from '../src/sim/content/star_orchard';

const folder = new URL('../public/map/star-orchard/', import.meta.url);
const manifest: StarOrchardManifest = JSON.parse(
  readFileSync(new URL('manifest.json', folder), 'utf8'),
);
const layout: StarOrchardLayout = JSON.parse(
  readFileSync(new URL('gameplay.json', folder), 'utf8'),
);
const map = starOrchardMap(layout, manifest);

describe('creature facing', () => {
  it('finds the nearest point of a path, inside a segment or at its end', () => {
    const path = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ];
    expect(nearestOnPath(path, { x: 4, z: 3 })).toEqual({ x: 4, z: 0 });
    expect(nearestOnPath(path, { x: 14, z: 3 })).toEqual({ x: 10, z: 0 });
  });

  it('looks along +z as atan2(dx, dz), the body forward', () => {
    const site = { id: 'top', lane: 'top', x: 0, z: 0, r: 5, leash: 8 } as const;
    expect(
      ringRestYaw(site, [
        { x: -10, z: 6 },
        { x: 10, z: 6 },
      ]),
    ).toBeCloseTo(0);
    expect(
      ringRestYaw(site, [
        { x: 6, z: -10 },
        { x: 6, z: 10 },
      ]),
    ).toBeCloseTo(Math.PI / 2);
  });

  it('turns each creature of the Star Orchard to its own lane', () => {
    for (const creature of ['voidmaul', 'pyrefang'] as const) {
      const rest = creatureRest(map, creature);
      expect(rest).not.toBeNull();
      const site = map.rings!.find((r) => r.x === rest!.home.x && r.z === rest!.home.z)!;
      const lane = map.lanes[site.lane];
      const q = nearestOnPath(lane, site)!;
      // A step along the rest yaw brings the creature closer to its lane.
      const step = { x: site.x + Math.sin(rest!.yaw), z: site.z + Math.cos(rest!.yaw) };
      const before = Math.hypot(q.x - site.x, q.z - site.z);
      expect(Math.hypot(q.x - step.x, q.z - step.z)).toBeCloseTo(before - 1, 5);
    }
  });
});
