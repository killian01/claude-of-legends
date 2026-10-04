// The dev shortcut to a ring's creature (src/game/creature_now.ts): the
// query names a creature, its clock is rewound to two seconds from now,
// and the champion stands on its ring, short of the center.

import { describe, expect, it } from 'vitest';
import { creatureNowFrom, riseCreatureNow } from '../src/game/creature_now';
import type { RingState } from '../src/sim/rings';

function ring(creature: 'voidmaul' | 'pyrefang'): RingState {
  return {
    ring: creature === 'voidmaul' ? 'top' : 'bot',
    creature,
    site: { id: creature === 'voidmaul' ? 'top' : 'bot', x: 4, z: 140, r: 16 } as RingState['site'],
    unitId: null,
    nextRiseAt: 390,
    riseIndex: 0,
    roseAt: null,
  };
}

describe('creature now', () => {
  it('reads only a known creature from the query', () => {
    expect(creatureNowFrom('?creature=voidmaul')).toBe('voidmaul');
    expect(creatureNowFrom('?creature=pyrefang')).toBe('pyrefang');
    expect(creatureNowFrom('?creature=warden')).toBeNull();
    expect(creatureNowFrom('')).toBeNull();
  });

  it('rewinds that ring alone and stands the champion on it', () => {
    const rings = [ring('pyrefang'), ring('voidmaul')];
    const stand = riseCreatureNow(rings, 'voidmaul', 1.5, 156);
    expect(rings[1]!.nextRiseAt).toBe(3.5);
    expect(rings[0]!.nextRiseAt).toBe(390);
    expect(stand).not.toBeNull();
    const off = Math.sqrt((stand!.x - 4) ** 2 + (stand!.z - 140) ** 2);
    expect(off).toBeGreaterThan(5);
    expect(off).toBeLessThan(16);
    // A ring in the far corner stands its champion back toward the map.
    const far = { ...ring('pyrefang'), site: { ...ring('pyrefang').site, x: 150 } };
    expect(riseCreatureNow([far], 'pyrefang', 0, 156)!.x).toBeLessThan(150);
  });

  it('leaves a live creature alone', () => {
    const live = { ...ring('voidmaul'), unitId: 7 };
    expect(riseCreatureNow([live], 'voidmaul', 0, 156)).toBeNull();
    expect(live.nextRiseAt).toBe(390);
  });
});
