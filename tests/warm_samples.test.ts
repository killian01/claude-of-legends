// The fights' art warmed off screen (src/render/warm_samples.ts): every hook
// of a spell's art runs once (a zone through its life, for a foe and a
// friend), a failing hook keeps to itself, the steps run one at a time and
// stop once the match is gone, and every sample is compiled at its start
// and again later, then released.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { SpellVisual } from '../src/render/vfx/catalog';
import type { VfxSystem } from '../src/render/vfx/system';
import {
  type FightWarmHost,
  runSteps,
  sampleSpellArt,
  sliced,
  texturesOf,
  WARM_BODIES,
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

describe('the warm-up steps', () => {
  it('run in order, one between each pause, past a failing one', async () => {
    const order: string[] = [];
    const ran = await runSteps(
      [
        () => order.push('a'),
        () => {
          throw new Error('x');
        },
        () => order.push('c'),
      ],
      async () => {
        order.push('|');
      },
      () => false,
    );
    expect(ran).toBe(3);
    expect(order).toEqual(['a', '|', '|', 'c', '|']);
  });

  it('stop once the match is gone', async () => {
    let gone = false;
    const order: string[] = [];
    const ran = await runSteps(
      [() => order.push('a'), () => order.push('b')],
      async () => {
        gone = true;
      },
      () => gone,
    );
    expect(ran).toBe(1);
    expect(order).toEqual(['a']);
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
      catalog: [{ impact: () => undefined }, { zone: () => made() }],
      makeFx: () => fx as unknown as VfxSystem,
      preload: async () => undefined,
      next: async () => undefined,
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
      catalog: [
        {
          impact: () => {
            order.push('spell');
          },
        },
      ],
    });
    expect(order[0]).toBe('champion torv');
    expect(order[1]).toBe('champion sylra');
    expect(order[2]).toMatch(/^body /);
    expect(order.at(-1)).toBe('spell');
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
