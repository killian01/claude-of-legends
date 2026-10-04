// The fights' art warmed off screen (src/render/warm_samples.ts): every hook
// of a spell's art runs once (a zone through its life, for a foe and a
// friend), a failing hook keeps to itself, the steps run one at a time and
// stop once the match is gone, and every sample is compiled at its start
// and again later, then released. The champions and the bodies drawn from
// no file start at once: only a Pyrefang's body waits for its model and a
// spell for its champion's effect files.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { SpellVisual } from '../src/render/vfx/catalog';
import type { VfxSystem } from '../src/render/vfx/system';
import {
  type FightWarmHost,
  filesFor,
  runSteps,
  sampleSpellArt,
  sliced,
  texturesOf,
  WARM_BODIES,
  type WarmFiles,
  warmFights,
} from '../src/render/warm_samples';

function fakeFx() {
  const fx = {
    updates: 0,
    timedDisposed: 0,
    pooledLights: () => [new THREE.PointLight()],
    update: () => {
      fx.updates++;
    },
    timed: {
      dispose: () => {
        fx.timedDisposed++;
      },
    },
  };
  return fx;
}

const mesh = (): THREE.Mesh =>
  new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());

describe("a spell's art sampled", () => {
  it('runs every hook once, a zone for a foe and a friend through its life', () => {
    const calls: string[] = [];
    const rec = (name: string) => (): void => {
      calls.push(name);
    };
    const vis: SpellVisual = {
      projectile: () => {
        calls.push('projectile');
        return mesh();
      },
      projectileTick: rec('projectileTick'),
      zone: (_r, _c, hostile) => {
        calls.push(`zone ${hostile ? 'foe' : 'friend'}`);
        return mesh();
      },
      zoneTick: (_fx, _h, _x, _z, _r, age) => {
        calls.push(`zoneTick ${age}`);
      },
      shield: () => {
        calls.push('shield');
        return mesh();
      },
      shieldTick: rec('shieldTick'),
      impact: rec('impact'),
      castFx: rec('castFx'),
      detonate: rec('detonate'),
      windupTick: rec('windupTick'),
      release: rec('release'),
      shieldEnd: rec('shieldEnd'),
    };
    const added: THREE.Object3D[] = [];
    let settled = 0;
    sampleSpellArt(
      vis,
      fakeFx() as unknown as VfxSystem,
      (o) => added.push(o),
      () => settled++,
    );
    expect(added).toHaveLength(4);
    // Each age of each zone compiled as it stands.
    expect(settled).toBe(6);
    expect(calls.filter((c) => c.startsWith('zone '))).toEqual(['zone foe', 'zone friend']);
    expect(calls.filter((c) => c.startsWith('zoneTick')).length).toBe(6);
    for (const hook of ['projectile', 'projectileTick', 'shield', 'shieldTick', 'impact']) {
      expect(calls.filter((c) => c === hook)).toHaveLength(1);
    }
    for (const hook of ['castFx', 'detonate', 'windupTick', 'release', 'shieldEnd']) {
      expect(calls).toContain(hook);
    }
  });

  it('keeps a failing hook to itself', () => {
    const calls: string[] = [];
    const vis: SpellVisual = {
      projectile: () => {
        throw new Error('no template');
      },
      impact: () => {
        calls.push('impact');
      },
    };
    expect(() =>
      sampleSpellArt(vis, fakeFx() as unknown as VfxSystem, () => undefined),
    ).not.toThrow();
    expect(calls).toEqual(['impact']);
  });
});

// A file on its way: it lands when the test says so.
function onTheWay(): { promise: Promise<void>; land: () => void; fail: () => void } {
  let land = (): void => undefined;
  let fail = (): void => undefined;
  const promise = new Promise<void>((done, refuse) => {
    land = () => done();
    fail = () => refuse(new Error('404'));
  });
  return { promise, land, fail };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('the warm-up steps', () => {
  const never = (): Promise<void> => new Promise(() => undefined);

  it('run in order, one between each pause, past a failing one', async () => {
    const order: string[] = [];
    const ran = await runSteps(
      [
        { run: () => order.push('a') },
        {
          run: () => {
            throw new Error('x');
          },
        },
        { run: () => order.push('c') },
      ],
      async () => {
        order.push('|');
      },
      () => false,
      never,
    );
    expect(ran).toBe(3);
    expect(order).toEqual(['a', '|', '|', 'c', '|']);
  });

  it('stop once the match is gone', async () => {
    let gone = false;
    const order: string[] = [];
    const ran = await runSteps(
      [{ run: () => order.push('a') }, { run: () => order.push('b') }],
      async () => {
        gone = true;
      },
      () => gone,
      never,
    );
    expect(ran).toBe(1);
    expect(order).toEqual(['a']);
  });

  it('pass over a step whose files are on their way, and run it once they land', async () => {
    const file = onTheWay();
    const order: string[] = [];
    const done = runSteps(
      [
        { run: () => order.push('waits'), waits: file.promise },
        { run: () => order.push('a') },
        { run: () => order.push('b') },
      ],
      async () => undefined,
      () => false,
      never,
    );
    await settle();
    expect(order).toEqual(['a', 'b']);
    file.land();
    expect(await done).toBe(3);
    expect(order).toEqual(['a', 'b', 'waits']);
  });

  it('run a step whose file failed, as the match would draw it', async () => {
    const file = onTheWay();
    const order: string[] = [];
    const done = runSteps(
      [{ run: () => order.push('waits'), waits: file.promise }],
      async () => undefined,
      () => false,
      never,
    );
    file.fail();
    expect(await done).toBe(1);
    expect(order).toEqual(['waits']);
  });

  it('let go of a file that never lands once the match is gone', async () => {
    let gone = false;
    let idles = 0;
    const ran = await runSteps(
      [{ run: () => undefined, waits: never() }],
      async () => undefined,
      () => gone,
      async () => {
        idles++;
        if (idles === 3) gone = true;
      },
    );
    expect(ran).toBe(0);
    expect(idles).toBe(3);
  });
});

describe('the files a sample waits for', () => {
  const files: WarmFiles = {
    pyrefang: () => Promise.resolve('pyrefang'),
    effects: { sylra: () => Promise.resolve('sylra') },
  };

  it('are none for a champion and for every body but the Pyrefang', async () => {
    expect(filesFor({ kind: 'champion', id: 'sylra' }, files)).toBeNull();
    for (const body of WARM_BODIES) {
      const waits = filesFor({ kind: 'body', body }, files);
      if (body.creatureId === 'pyrefang') expect(await waits).toBe('pyrefang');
      else expect(waits).toBeNull();
    }
  });

  it("are a spell's champion's effect files, none for a champion without", async () => {
    expect(await filesFor({ kind: 'spell', id: 'sylra_Q' }, files)).toBe('sylra');
    expect(filesFor({ kind: 'spell', id: 'dain_R' }, files)).toBeNull();
    expect(filesFor({ kind: 'spell', id: 'constructor_Q' }, files)).toBeNull();
  });
});

describe('the pause between steps', () => {
  it('lets a frame go only once its budget is spent', async () => {
    let t = 0;
    let frames = 0;
    const next = sliced(
      4,
      () => t,
      async () => {
        frames++;
        t += 16;
      },
    );
    // Two light steps of a millisecond share the frame.
    t += 1;
    await next();
    t += 1;
    await next();
    expect(frames).toBe(0);
    // A heavy one spends the rest: the next step waits for a new frame.
    t += 5;
    await next();
    expect(frames).toBe(1);
    t += 1;
    await next();
    expect(frames).toBe(1);
  });
});

describe('the fights warmed', () => {
  function host(over: Partial<FightWarmHost> = {}) {
    const fx = fakeFx();
    const compiled: number[] = [];
    const materials: THREE.Material[] = [];
    let disposedChampions = 0;
    const made = (): THREE.Mesh => {
      const m = mesh();
      materials.push(m.material as THREE.Material);
      return m;
    };
    const h: FightWarmHost = {
      compile: (scene) => compiled.push(scene.children.length),
      body: () => made(),
      champion: () => ({
        root: made(),
        dispose: () => {
          disposedChampions++;
        },
      }),
      championIds: ['torv', 'sylra'],
      catalog: { dain_A: { impact: () => undefined }, dain_R: { zone: () => made() } },
      makeFx: () => fx as unknown as VfxSystem,
      files: { pyrefang: async () => undefined, effects: {} },
      next: async () => undefined,
      idle: async () => undefined,
      gone: () => false,
      ...over,
    };
    return { h, fx, compiled, materials, champions: () => disposedChampions };
  }

  it('compiles each sample at its start and later, a step each', async () => {
    const { h, fx, compiled, champions } = host();
    const steps = await warmFights(h);
    // Two spells, every body, two champions.
    const expected = 2 + WARM_BODIES.length + 2;
    expect(steps).toBe(expected);
    // Twice a step, and once more for each age of the one zone, a foe's
    // and a friend's.
    expect(compiled).toHaveLength(2 * expected + 6);
    expect(fx.updates).toBe(expected);
    expect(fx.timedDisposed).toBe(expected);
    expect(champions()).toBe(2);
  });

  it('warms the champions first, then the bodies, then the spells', async () => {
    const order: string[] = [];
    const { h } = host();
    await warmFights({
      ...h,
      champion: (id) => {
        order.push(`champion ${id}`);
        return null;
      },
      body: (b) => {
        order.push(`body ${b.kind}`);
        return null;
      },
      catalog: {
        dain_R: {
          impact: () => {
            order.push('spell');
          },
        },
      },
    });
    expect(order[0]).toBe('champion torv');
    expect(order[1]).toBe('champion sylra');
    expect(order[2]).toMatch(/^body /);
    expect(order.at(-1)).toBe('spell');
  });

  it('starts the champions and the plain bodies without the Pyrefang and the effect files', async () => {
    const pyrefang = onTheWay();
    const effects = onTheWay();
    const order: string[] = [];
    const { h } = host();
    const done = warmFights({
      ...h,
      champion: (id) => {
        order.push(`champion ${id}`);
        return null;
      },
      body: (b) => {
        order.push(`body ${b.creatureId ?? b.campKind ?? b.kind}${b.ascendant ? '+' : ''}`);
        return null;
      },
      catalog: {
        dain_R: { impact: () => void order.push('spell dain_R') },
        sylra_Q: { impact: () => void order.push('spell sylra_Q') },
      },
      files: {
        pyrefang: () => pyrefang.promise,
        effects: { sylra: () => effects.promise },
      },
      // Only a file landing moves the wait on.
      idle: () => new Promise(() => undefined),
    });
    await settle();
    // Nothing that draws from a file has run; everything else has.
    expect(order).toEqual([
      'champion torv',
      'champion sylra',
      'body voidmaul',
      'body voidmaul+',
      'body warden',
      'body spinecrest',
      'body brackenlings',
      'body barkmaw',
      'spell dain_R',
    ]);
    effects.land();
    await settle();
    expect(order.at(-1)).toBe('spell sylra_Q');
    pyrefang.land();
    expect(await done).toBe(2 + WARM_BODIES.length + 2);
    expect(order.slice(-2)).toEqual(['body pyrefang', 'body pyrefang+']);
  });

  it("hides the samples' own lights from the programs", async () => {
    const { h, fx } = host();
    const lights = [new THREE.PointLight(), new THREE.PointLight()];
    fx.pooledLights = () => lights;
    await warmFights(h);
    for (const l of lights) expect(l.visible).toBe(false);
  });

  it('releases what each step built, leaving nothing in the samples scene', async () => {
    const scenes: THREE.Scene[] = [];
    const { h } = host({ compile: (scene) => scenes.push(scene) });
    const disposedMats = new Set<THREE.Material>();
    const body = (): THREE.Object3D => {
      const m = mesh();
      const material = m.material as THREE.Material;
      material.addEventListener('dispose', () => disposedMats.add(material));
      return m;
    };
    await warmFights({ ...h, body });
    expect(disposedMats.size).toBe(WARM_BODIES.length);
    expect(scenes[0]!.children).toHaveLength(0);
  });

  it('does nothing once the match is gone', async () => {
    const { h, compiled } = host({ gone: () => true });
    expect(await warmFights(h)).toBe(0);
    expect(compiled).toHaveLength(0);
  });
});

describe("the samples' pictures", () => {
  it('are found once each, whatever reads them', () => {
    const shared = new THREE.Texture();
    const glow = new THREE.Texture();
    const root = new THREE.Group();
    root.add(
      new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshToonMaterial({ map: shared })),
    );
    root.add(
      new THREE.Mesh(new THREE.BufferGeometry(), [
        new THREE.MeshStandardMaterial({ map: shared, emissiveMap: glow }),
        new THREE.MeshBasicMaterial(),
      ]),
    );
    const found = texturesOf(root);
    expect(found).toHaveLength(2);
    expect(found).toContain(shared);
    expect(found).toContain(glow);
  });
});
