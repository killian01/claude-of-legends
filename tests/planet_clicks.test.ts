// Clicks and taps on the planet, headless (src/render/planet_stage.ts over
// the online mirror, src/net/client_world.ts): the path a click takes in a
// battle royale, from a screen point to the order on the wire. The bug it
// pins: the stage read the drop off the last frame it drew, so on a slow
// frame (a phone stalling, a software GL) the snapshots had landed the
// match long before the next draw and every click still picked a landing
// (a `drop` sent, no `move`). What a click means is read off the world as
// it is now.

import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { starOrchard } from '../server/star_orchard';
import { nearestEnemy, pickEnemyAt, pickEnemyOnScreen } from '../src/game/picking';
import { leadPoint } from '../src/game/thumb_stick';
import { ClientWorld } from '../src/net/client_world';
import type { ClientMsg, ServerMsg } from '../src/net/protocol';
import type { PlanetStage as PlanetStageType } from '../src/render/planet_stage';
import { dirTo, dist, offset, type Vec3 } from '../src/sim/geo';

type Snap = Extract<ServerMsg, { t: 'snap' }>;
type Listener = (e: Partial<PointerEvent>) => void;

const W = 1100;
const H = 690;
const listeners = new Map<string, Listener[]>();
function on(target: string) {
  return (type: string, fn: Listener) => {
    const key = `${target}:${type}`;
    listeners.set(key, [...(listeners.get(key) ?? []), fn]);
  };
}
function fire(target: string, type: string, e: Partial<PointerEvent>): void {
  for (const fn of listeners.get(`${target}:${type}`) ?? []) fn(e);
}

// The DOM the stage touches, a canvas and the window's pointer listeners,
// stood in for: no WebGL is needed for the chart, the camera and the rays.
let PlanetStage: typeof PlanetStageType;
let standIn: typeof import('../src/render/planet_terrain').standInGroundPlanet;
beforeAll(async () => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.document = {
    createElement: () => ({ getContext: () => null, width: 0, height: 0, style: {} }),
  };
  g.window = { addEventListener: on('window'), removeEventListener: () => undefined };
  ({ PlanetStage } = await import('../src/render/planet_stage'));
  ({ standInGroundPlanet: standIn } = await import('../src/render/planet_terrain'));
});

const R = 80;
function sphere(x: number, y: number, z: number): Vec3 {
  const d = Math.hypot(x, y, z);
  return { x: (x / d) * R, y: (y / d) * R, z: (z / d) * R };
}
const HOME = sphere(0.35, 0.86, 0.37);
const FOE = offset(HOME, dirTo(HOME, sphere(1, 0, 0))!, 6) as Vec3;
const dusk = {
  p: 0,
  c: [0, 80, 0] as [number, number, number],
  r: 160,
  pe: 100,
  sh: 0 as const,
  b: 0,
};

function snap(st: 'drop' | 'play', time: number): Snap {
  return {
    t: 'snap',
    time,
    units: [
      { i: 1, ...HOME, h: 500, m: 500, k: 'champion', t: 1, c: 'fenn', n: 'you' },
      { i: 2, ...FOE, h: 500, m: 500, k: 'champion', t: 2, c: 'dain', n: 'foe' },
    ],
    gone: [],
    projectiles: [],
    zones: [],
    walls: [],
    self: null,
    events: [],
    winner: null,
    royale: { v: 'respawn', st, de: 10, end: 610, dusk, alive: 50, people: 1 },
  } as Snap;
}

function setup() {
  const sent: ClientMsg[] = [];
  const world = new ClientWorld(
    (m) => sent.push(m),
    starOrchard().map,
    null,
    () => 0,
  );
  world.applyServer({
    t: 'match_start',
    selfUnitId: 1,
    team: 1,
    royale: { v: 'respawn', seats: 50 },
  });
  world.applyServer(snap('drop', 1));
  const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 500);
  const canvas = { addEventListener: on('canvas'), removeEventListener: () => undefined };
  const stage = new PlanetStage(
    world,
    standIn(),
    canvas as unknown as HTMLCanvasElement,
    () => ({ left: 0, top: 0, width: W, height: H }),
    camera,
  );
  stage.picker = 1;
  stage.diveSeconds = 0.0001;
  const fog = new THREE.Texture();
  // One frame as the renderer draws it: the stage, the chart on the
  // followed champion, the camera.
  const frame = (): void => {
    const me = world.units.get(1)!;
    stage.update(performance.now(), 16, fog, me.pos);
    stage.takeRemap();
    const local = stage.toLocal(me.pos);
    stage.recenterOn(local.x, local.z, true);
    const focus = stage.toLocal(me.pos);
    stage.placeView(new THREE.Vector3(focus.x, 0, focus.z), 0.85, 16);
  };
  const ray = (sx: number, sy: number): THREE.Ray => {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2((sx / W) * 2 - 1, -(sy / H) * 2 + 1), camera);
    return rc.ray;
  };
  const click = (sx: number, sy: number): void => {
    fire('canvas', 'pointerdown', { clientX: sx, clientY: sy, pointerId: 1 });
    fire('window', 'pointerup', { clientX: sx, clientY: sy, pointerId: 1 });
  };
  // The renderer's projector on the planet (renderer.ts projectToScreen).
  const project = (x: number, y: number, z: number, gy?: number) =>
    gy === undefined ? null : stage.projectSphere({ x, y: gy, z }, y);
  return { world, sent, stage, frame, ray, click, project };
}

describe('a click on the planet', () => {
  it('picks a landing during the drop, and nothing on the ground', () => {
    const { sent, stage, frame, ray, click } = setup();
    frame();
    expect(stage.groundPointAt(ray(W / 2, H / 2))).toBeNull();
    click(W / 2, H / 2);
    expect(sent.filter((m) => m.t === 'drop')).toHaveLength(1);
  });

  it('moves once the snapshots say the match landed, before the next frame is drawn', () => {
    const { world, sent, stage, frame, ray, click } = setup();
    frame();
    // The match lands; no frame has been drawn since (a stalled draw).
    world.applyServer(snap('play', 12));
    click(W / 2, H / 2);
    expect(sent.filter((m) => m.t === 'drop')).toHaveLength(0);
    expect(stage.groundPointAt(ray(W / 2, H / 2))).not.toBeNull();
  });

  it('lands on the champion under the screen middle once drawn, and the order goes out with y', () => {
    const { world, sent, stage, frame, ray, project } = setup();
    world.applyServer(snap('play', 12));
    frame();
    frame();
    const mid = stage.groundPointAt(ray(W / 2, H / 2))!;
    expect(dist(mid, HOME)).toBeLessThan(1.5);
    // A click up the screen: ground some meters ahead, nobody there.
    const sx = W / 2;
    const sy = H / 2 - 160;
    const p = stage.groundPointAt(ray(sx, sy))!;
    expect(p).not.toBeNull();
    expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(R, 6);
    expect(dist(p, HOME)).toBeGreaterThan(4);
    // boot.ts clickOrder: an enemy under the cursor, else a walk.
    const enemy = pickEnemyOnScreen(world, 1, sx, sy, project) ?? pickEnemyAt(world, p, 1);
    expect(enemy).toBeNull();
    world.orderMove(1, p.x, p.z, p.y);
    expect(sent.at(-1)).toEqual({ t: 'move', x: p.x, y: p.y, z: p.z });
    // A click on the foe attacks it instead.
    const foe = project(FOE.x, 1.2, FOE.z, FOE.y)!;
    expect(foe).not.toBeNull();
    expect(pickEnemyOnScreen(world, 1, foe.x, foe.y, project)?.id).toBe(2);
  });

  it('turns a thumb stick and a tap into walks on a phone too', () => {
    const { world, stage, frame, ray } = setup();
    world.applyServer(snap('play', 12));
    frame();
    frame();
    // touch.ts worldDir: two ground points through the screen's middle.
    const a = stage.groundPointAt(ray(W / 2, H / 2))!;
    const b = stage.groundPointAt(ray(W / 2, H / 2 - 50))!;
    const dir = dirTo(a, b)!;
    const lead = leadPoint(world.units.get(1)!.pos, dir, 3, 156);
    expect(dist(lead, HOME)).toBeCloseTo(3, 3);
    // Up the screen is north in the chart: the lead stands up the screen.
    const ahead = stage.toLocal(lead);
    const here = stage.toLocal(HOME);
    expect(ahead.z - here.z).toBeGreaterThan(2.5);
    // A tap far from anyone (touch.ts onTap) is a ground point, no target.
    const tap = stage.groundPointAt(ray(W / 2 + 200, H / 2 + 80))!;
    expect(tap).not.toBeNull();
    expect(nearestEnemy(world, 1, tap, 0.5)).toBeNull();
  });
});
