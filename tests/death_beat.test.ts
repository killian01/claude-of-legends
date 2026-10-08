// The Death beat in Respawn (src/game/death_beat.ts): while the champion
// waits to come back, the camera is on whoever took it down when the
// mirror knows where they stand, holds on where it fell otherwise, and is
// back on the champion at the return.

import { describe, expect, it } from 'vitest';
import {
  BEAT_KEEP_S,
  BeatCamera,
  type BeatLens,
  DeathBeat,
  sameShot,
  shownPoint,
} from '../src/game/death_beat';
import type { SnapMark } from '../src/net/royale_wire';
import { MARK_SHOWN_S } from '../src/sim/royale/types';

const SELF = 7;
const KILLER = 12;
const at = (x: number) => ({ x, y: 40, z: 0 });

describe('the Death beat', () => {
  it('follows the killer while the mirror holds its body, the wait through', () => {
    const beat = new DeathBeat(SELF);
    beat.fell(SELF, KILLER, true);
    expect(beat.killer).toBe(KILLER);
    expect(beat.step({ time: 10, dead: true, body: at(1), shown: null })).toEqual({
      kind: 'killer',
      unitId: KILLER,
    });
  });

  it('holds on where the champion fell when the killer is nowhere known', () => {
    const beat = new DeathBeat(SELF);
    beat.fell(SELF, KILLER, true);
    expect(beat.step({ time: 10, dead: true, body: null, shown: null })).toEqual({ kind: 'self' });
  });

  it('looks at the point a mark shows when the body is out of the mirror', () => {
    const beat = new DeathBeat(SELF);
    beat.fell(SELF, KILLER, true);
    expect(beat.step({ time: 10, dead: true, body: null, shown: at(5) })).toEqual({
      kind: 'point',
      unitId: KILLER,
      at: at(5),
    });
  });

  it('keeps the last known point a moment, then goes back to where it fell', () => {
    const beat = new DeathBeat(SELF);
    beat.fell(SELF, KILLER, true);
    beat.step({ time: 10, dead: true, body: at(3), shown: null });
    expect(beat.step({ time: 10.5, dead: true, body: null, shown: null })).toEqual({
      kind: 'point',
      unitId: KILLER,
      at: at(3),
    });
    expect(
      beat.step({ time: 10 + BEAT_KEEP_S + 0.05, dead: true, body: null, shown: null }),
    ).toEqual({ kind: 'self' });
  });

  it('has nobody to follow after the Dusk, a creature or a fall of its own', () => {
    for (const [killerId, champion] of [
      [0, false],
      [SELF, true],
      [99, false],
    ] as const) {
      const beat = new DeathBeat(SELF);
      beat.fell(SELF, killerId, champion);
      expect(beat.killer).toBeNull();
      expect(beat.step({ time: 1, dead: true, body: at(1), shown: at(1) })).toEqual({
        kind: 'self',
      });
    }
  });

  it("ignores everyone else's deaths", () => {
    const beat = new DeathBeat(SELF);
    beat.fell(30, KILLER, true);
    expect(beat.killer).toBeNull();
  });

  it('is the champion again on the return', () => {
    const beat = new DeathBeat(SELF);
    beat.fell(SELF, KILLER, true);
    beat.step({ time: 10, dead: true, body: at(1), shown: null });
    expect(beat.step({ time: 15, dead: false, body: at(1), shown: null })).toEqual({
      kind: 'self',
    });
    expect(beat.killer).toBeNull();
  });

  it('keeps a death told a tick before the body falls', () => {
    const beat = new DeathBeat(SELF);
    beat.fell(SELF, KILLER, true);
    expect(beat.step({ time: 10, dead: false, body: at(1), shown: null })).toEqual({
      kind: 'self',
    });
    expect(beat.step({ time: 10.05, dead: true, body: at(1), shown: null })).toEqual({
      kind: 'killer',
      unitId: KILLER,
    });
  });

  it('tells two shots apart by kind, unit and point', () => {
    expect(sameShot({ kind: 'self' }, { kind: 'self' })).toBe(true);
    expect(sameShot({ kind: 'killer', unitId: 1 }, { kind: 'killer', unitId: 2 })).toBe(false);
    expect(
      sameShot({ kind: 'point', unitId: 1, at: at(1) }, { kind: 'point', unitId: 1, at: at(2) }),
    ).toBe(false);
    expect(sameShot({ kind: 'killer', unitId: 1 }, { kind: 'self' })).toBe(false);
  });
});

describe('where the globe shows a champion', () => {
  const mark = (unitId: number, shownAt: number, x: number): SnapMark => [
    unitId,
    'ablaze',
    x,
    40,
    0,
    shownAt,
  ];

  it("reads the latest of its marks still in its show, then the leader's point", () => {
    const mk = [mark(KILLER, 2, 1), mark(KILLER, 8, 2), mark(3, 9, 9)];
    expect(shownPoint({ mk }, KILLER, 9)).toEqual(at(2));
    expect(shownPoint({ mk }, KILLER, 8 + MARK_SHOWN_S + 0.1)).toBeNull();
    const leader = { i: KILLER, s: 9, at: [4, 40, 0] as [number, number, number] };
    expect(shownPoint({ mk: [], leader }, KILLER, 30)).toEqual(at(4));
    expect(shownPoint({ leader: { i: KILLER, s: 9 } }, KILLER, 30)).toBeNull();
    expect(shownPoint(null, KILLER, 30)).toBeNull();
  });
});

describe('the beat on the camera', () => {
  type FakeUnit = { kind: string; dead: boolean; pos: { x: number; y: number; z: number } };
  const setup = () => {
    const units = new Map<number, FakeUnit>([
      [SELF, { kind: 'champion', dead: false, pos: at(0) }],
      [KILLER, { kind: 'champion', dead: false, pos: at(2) }],
    ]);
    const world = { units, time: 0, royaleView: () => null };
    const calls: string[] = [];
    const lens: BeatLens = {
      watchUnit: (id) => calls.push(`watch ${id}`),
      lookAtPoint: (x) => calls.push(`look ${x}`),
      recenterCamera: () => calls.push('recenter'),
    };
    const camera = new BeatCamera(world as never, lens, SELF);
    return { units, world, calls, camera };
  };

  it('watches the killer on the death, and comes back to the champion on the return', () => {
    const { units, world, calls, camera } = setup();
    camera.tick([]);
    expect(calls).toEqual([]);
    units.get(SELF)!.dead = true;
    world.time = 1;
    camera.tick([{ unitId: SELF, killerId: KILLER, kn: 'Brakka' }]);
    expect(calls).toEqual([`watch ${KILLER}`, 'recenter']);
    calls.length = 0;
    world.time = 2;
    camera.tick([]);
    expect(calls).toEqual([]);
    units.get(SELF)!.dead = false;
    world.time = 6;
    camera.tick([]);
    expect(calls).toEqual(['watch null', 'recenter']);
  });

  it('recenters at the return even when the wait held where the champion fell', () => {
    const { units, world, calls, camera } = setup();
    units.delete(KILLER);
    units.get(SELF)!.dead = true;
    camera.tick([{ unitId: SELF, killerId: 0 }]);
    expect(calls).toEqual([]);
    units.get(SELF)!.dead = false;
    world.time = 5;
    camera.tick([]);
    expect(calls).toEqual(['watch null', 'recenter']);
  });
});
