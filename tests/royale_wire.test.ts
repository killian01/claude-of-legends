// The planet on the wire (ADR 0029, ADR 0031): a point carries y on the
// sphere and never on the plane, so the 5v5's records keep their shape
// byte for byte (server/snapshot.ts record builders), and a point off the
// wire is read with its y or refused.

import { describe, expect, it } from 'vitest';
import {
  projectileRecord,
  selfRecord,
  unitRecord,
  wallRecord,
  zoneRecord,
} from '../server/snapshot';
import { wirePoint } from '../src/net/protocol';
import { CHAMPIONS } from '../src/sim/content/champions';
import type { Vec2 } from '../src/sim/types';
import { createChampion } from '../src/sim/unit';
import { FakeRoyaleSim } from './royale_fake';

const champion = (pos: Vec2) => {
  const u = createChampion(1, 0, pos, CHAMPIONS.fenn!);
  u.pos = { ...pos };
  return u;
};

describe('a point off the wire', () => {
  it('is x and z on the plane, with y on the sphere', () => {
    expect(wirePoint(1, 2)).toEqual({ x: 1, z: 2 });
    expect(wirePoint(1, 2, 3)).toEqual({ x: 1, y: 3, z: 2 });
  });

  it('is refused when a coordinate given is not a finite number', () => {
    expect(wirePoint(1, Number.NaN)).toBeNull();
    expect(wirePoint('1', 2)).toBeNull();
    expect(wirePoint(1, 2, Number.POSITIVE_INFINITY)).toBeNull();
    expect(wirePoint(1, 2, '3')).toBeNull();
  });
});

describe('the record builders', () => {
  it('leave the plane records as they were, with no y anywhere', () => {
    const u = champion({ x: 1.234, z: 5.678 });
    u.pendingSpell = { key: 'Q', aim: { x: 2, z: 3 }, resolveAt: 1 } as never;
    const rec = unitRecord(u, 0, 0, new Set());
    expect('y' in rec).toBe(false);
    expect('y' in (rec.w ?? {})).toBe(false);
    expect(Object.keys(rec).slice(0, 5)).toEqual(['i', 'x', 'z', 'h', 'm']);
    const sim = new FakeRoyaleSim('respawn');
    const p = sim.addProjectile(1, 0, { x: 1, y: 2, z: 3 });
    p.pos = { x: 1, z: 3 };
    expect('y' in projectileRecord(p, () => true)).toBe(false);
  });

  it('carry y on the sphere, for units, aims, bolts, zones and walls', () => {
    const u = champion({ x: 1, y: 79.991, z: 2 });
    u.pendingSpell = { key: 'Q', aim: { x: 2, y: 79.5, z: 3 }, resolveAt: 1 } as never;
    const rec = unitRecord(u, 0, 0, new Set());
    expect(rec).toMatchObject({ x: 1, y: 79.99, z: 2, w: { k: 'Q', x: 2, y: 79.5, z: 3 } });
    const sim = new FakeRoyaleSim('respawn');
    const p = sim.addProjectile(1, 0, { x: 1, y: 2, z: 3 });
    expect(projectileRecord(p, () => true).y).toBe(2);
    const zone = { id: 4, team: 0, pos: { x: 1, y: 2, z: 3 }, radius: 2, vfx: null } as never;
    expect(zoneRecord(zone).y).toBe(2);
    const wall = {
      id: 5,
      team: 0,
      a: { x: 0, y: 80, z: 0 },
      b: { x: 1, y: 79.9, z: 0 },
      until: 3,
    } as never;
    expect(wallRecord(wall)).toMatchObject({ y1: 80, y2: 79.9 });
  });

  it('send the path still to walk only where the prediction reads it', () => {
    const u = champion({ x: 1, z: 2 });
    u.path = [{ x: 3, z: 4 }];
    expect(selfRecord(u, 0, { ack: 0, ackAt: 0 }).path).toEqual([3, 4]);
    expect(selfRecord(u, 0, { ack: 0, ackAt: 0 }, false).path).toBeUndefined();
  });
});
