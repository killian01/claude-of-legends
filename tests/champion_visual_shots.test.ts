// One-shot actions must release the rig when they finish. A LoopOnce action
// with clampWhenFinished holds its last frame at full weight forever unless
// it is faded out, and a clamped swing or corpse pose blended into the run
// visibly corrupts the gait (reported as "his walk changes after attacking
// or dying"). Pure mixer logic, so plain node exercises it without a GLB.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ChampionTemplate } from '../src/render/champions/assets';
import type { ChampionAnimInput } from '../src/render/champions/anim';
import { ChampionVisual } from '../src/render/champions/visual';

function makeVisual(): ChampionVisual {
  const rig = new THREE.Object3D();
  const root = new THREE.Group();
  root.add(rig);
  const clip = (name: string): THREE.AnimationClip =>
    new THREE.AnimationClip(name, 1, [new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [0, 0])]);
  const clips = new Map(['Idle', 'Run', 'Attack', 'Cast', 'Death'].map((n) => [n, clip(n)]));
  const def = {
    url: 'test.glb',
    height: 2,
    barY: 2,
    clips: { idle: 'Idle', run: 'Run', attack: 'Attack', cast: 'Cast', windup: 'Idle', death: 'Death' },
  };
  const template = { def, scene: rig, clips, scale: 1, groundY: 0, props: new Map() } as unknown as ChampionTemplate;
  return new ChampionVisual(template, root, rig);
}

function pump(v: ChampionVisual, ms: number, input: ChampionAnimInput): void {
  for (let t = 0; t < ms; t += 16) v.update(16, input);
}

function action(v: ChampionVisual, group: 'shotActions' | 'baseActions', key: string): THREE.AnimationAction {
  const groups = v as unknown as Record<string, Record<string, THREE.AnimationAction | undefined>>;
  const a = groups[group]?.[key];
  if (!a) throw new Error(`missing action ${group}.${key}`);
  return a;
}

const RUNNING: ChampionAnimInput = { moving: true, windingUp: false, dead: false, speed: 3.7 };
const STANDING: ChampionAnimInput = { moving: false, windingUp: false, dead: false, speed: 0 };

describe('champion one-shot release', () => {
  it('fades a finished attack out instead of leaving it clamped in the mix', () => {
    const v = makeVisual();
    pump(v, 500, RUNNING);
    v.playAttack();
    pump(v, 2000, RUNNING);
    expect(action(v, 'shotActions', 'attack').getEffectiveWeight()).toBeLessThan(0.01);
    expect(action(v, 'baseActions', 'run').getEffectiveWeight()).toBeGreaterThan(0.9);
  });

  it('holds the corpse pose while dead, then fades it out on revive', () => {
    const v = makeVisual();
    pump(v, 500, STANDING);
    pump(v, 1500, { ...STANDING, dead: true });
    const death = action(v, 'shotActions', 'death');
    expect(death.getEffectiveWeight()).toBeGreaterThan(0.9);
    pump(v, 1000, STANDING);
    expect(death.getEffectiveWeight()).toBeLessThan(0.01);
    expect(action(v, 'baseActions', 'idle').getEffectiveWeight()).toBeGreaterThan(0.9);
  });
});
