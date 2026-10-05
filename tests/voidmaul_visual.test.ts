import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  VOIDMAUL_ATTACK_RELEASE_S,
  VOIDMAUL_CLIPS,
  VOIDMAUL_SCALE,
  VOIDMAUL_WALK_SOURCE_SPEED,
  type VoidmaulInput,
  type VoidmaulTemplate,
  VoidmaulVisual,
} from '../src/render/creatures/voidmaul_visual';

function makeTemplate(): VoidmaulTemplate {
  const scene = new THREE.Group();
  const duration: Record<string, number> = {
    Idle: 4,
    Walk: 4 / 3,
    Attack: 76 / 24,
    AttackCrush: 76 / 24,
    Hurt: 0.8,
    Death: 3.2,
    Spawn: 4,
  };
  const clips = new Map(
    VOIDMAUL_CLIPS.map((name) => [
      name,
      new THREE.AnimationClip(name, duration[name], [
        new THREE.NumberKeyframeTrack('.position[x]', [0, duration[name]!], [0, 0]),
      ]),
    ]),
  );
  return { scene, clips };
}

const STANDING: VoidmaulInput = { moving: false, speed: 0 };
const WALKING: VoidmaulInput = { moving: true, speed: 2.8 };

function internal(v: VoidmaulVisual) {
  return v as unknown as {
    actions: Map<string, THREE.AnimationAction>;
    shot: THREE.AnimationAction | null;
  };
}

function action(v: VoidmaulVisual, name: string): THREE.AnimationAction {
  const a = internal(v).actions.get(name);
  if (!a) throw new Error(`Missing ${name}`);
  return a;
}

function pump(v: VoidmaulVisual, ms: number, input = STANDING): void {
  for (let t = 0; t < ms; t += 10) v.update(Math.min(10, ms - t), input);
}

describe('Voidmaul quadruped playback', () => {
  it('plays the authoritative crush choice on its contact beat and returns to its gait', () => {
    const visual = new VoidmaulVisual(makeTemplate(), null, 1.1);
    visual.playAttack(1.75, 'crush');
    visual.playHit();
    pump(visual, 1750);
    expect(internal(visual).shot).toBe(action(visual, 'AttackCrush'));
    expect(action(visual, 'AttackCrush').time).toBeCloseTo(VOIDMAUL_ATTACK_RELEASE_S, 5);
    expect(action(visual, 'Attack').isRunning()).toBe(false);
    pump(visual, 1700, WALKING);
    expect(action(visual, 'AttackCrush').getEffectiveWeight()).toBeLessThan(0.01);
    expect(action(visual, 'Walk').getEffectiveWeight()).toBeGreaterThan(0.99);
    visual.playAttack(0.5, 'slam');
    pump(visual, 500);
    expect(action(visual, 'Attack').time).toBeCloseTo(VOIDMAUL_ATTACK_RELEASE_S, 5);
    expect(action(visual, 'AttackCrush').getEffectiveWeight()).toBeLessThan(0.01);
    visual.dispose();
  });

  it('lands the authored slam on the simulation damage beat at different attack speeds', () => {
    const visual = new VoidmaulVisual(makeTemplate(), null, 1.1);
    for (const windup of [0.6, 0.35, 0.15]) {
      visual.playAttack(windup);
      pump(visual, windup * 1000);
      expect(action(visual, 'Attack').time).toBeCloseTo(VOIDMAUL_ATTACK_RELEASE_S, 5);
      expect(action(visual, 'Attack').getEffectiveWeight()).toBeGreaterThan(0.99);
    }
    visual.dispose();
  });

  it('releases a clamped slam and resumes the moving gait without a leftover attack pose', () => {
    const visual = new VoidmaulVisual(makeTemplate(), null, 1.1);
    pump(visual, 400, WALKING);
    visual.playAttack(0.5);
    pump(visual, 1600, WALKING);
    expect(action(visual, 'Attack').getEffectiveWeight()).toBeLessThan(0.01);
    expect(action(visual, 'Walk').getEffectiveWeight()).toBeGreaterThan(0.99);
    expect(action(visual, 'Walk').loop).toBe(THREE.LoopRepeat);
    const expectedRate = WALKING.speed / (VOIDMAUL_WALK_SOURCE_SPEED * VOIDMAUL_SCALE * 1.1);
    expect(action(visual, 'Walk').getEffectiveTimeScale()).toBeCloseTo(expectedRate, 6);
    visual.dispose();
  });

  it('seeks the rise age when the asset arrives and uses idle for an old creature', () => {
    const opening = new VoidmaulVisual(makeTemplate(), 2.5, 1.1);
    expect(opening.rising).toBe(true);
    expect(action(opening, 'Spawn').time).toBeCloseTo(2.5);
    pump(opening, 1800);
    expect(opening.rising).toBe(false);
    expect(action(opening, 'Idle').getEffectiveWeight()).toBeGreaterThan(0.99);
    const old = new VoidmaulVisual(makeTemplate(), 5, 1.1);
    expect(old.rising).toBe(false);
    expect(action(old, 'Idle').isRunning()).toBe(true);
    opening.dispose();
    old.dispose();
  });

  it('allows movement or an attack to interrupt an emergence', () => {
    const moving = new VoidmaulVisual(makeTemplate(), 1, 1.1);
    pump(moving, 300, WALKING);
    expect(moving.rising).toBe(false);
    expect(action(moving, 'Walk').getEffectiveWeight()).toBeGreaterThan(0.99);
    const fighting = new VoidmaulVisual(makeTemplate(), 1, 1.1);
    fighting.playAttack(0.5);
    pump(fighting, 100);
    expect(fighting.rising).toBe(false);
    expect(action(fighting, 'Attack').getEffectiveWeight()).toBeGreaterThan(0.99);
    moving.dispose();
    fighting.dispose();
  });

  it('plays a short flinch once and protects attacks from damage reaction interruptions', () => {
    const visual = new VoidmaulVisual(makeTemplate(), null, 1.1);
    visual.playHit();
    pump(visual, 200);
    visual.playHit();
    expect(action(visual, 'Hurt').time).toBeCloseTo(0.2);
    pump(visual, 1000, WALKING);
    expect(action(visual, 'Hurt').getEffectiveWeight()).toBeLessThan(0.01);
    expect(action(visual, 'Walk').getEffectiveWeight()).toBeGreaterThan(0.99);
    visual.playAttack(0.5);
    visual.playHit();
    expect(internal(visual).shot).toBe(action(visual, 'Attack'));
    visual.dispose();
  });

  it('holds its authored corpse and refuses movement, attacks and hurt while dead', () => {
    const visual = new VoidmaulVisual(makeTemplate(), null, 1.1);
    visual.playDeath();
    pump(visual, 4000, WALKING);
    visual.playAttack(0.5);
    visual.playHit();
    expect(visual.deathDurationMs).toBe(3200);
    expect(action(visual, 'Death').getEffectiveWeight()).toBeGreaterThan(0.99);
    expect(action(visual, 'Death').time).toBeCloseTo(3.2);
    expect(internal(visual).shot).toBe(action(visual, 'Death'));
    expect(action(visual, 'Walk').isRunning()).toBe(false);
    visual.dispose();
  });

  it('owns clone materials and leaves shared source textures and geometry available', () => {
    const t = makeTemplate();
    const source = new THREE.MeshStandardMaterial();
    let sourceDisposed = false;
    source.addEventListener('dispose', () => {
      sourceDisposed = true;
    });
    const geometry = new THREE.BoxGeometry();
    let geometryDisposed = false;
    geometry.addEventListener('dispose', () => {
      geometryDisposed = true;
    });
    const mesh = new THREE.Mesh(geometry, source);
    mesh.name = 'Voidmaul_Body';
    t.scene.add(mesh);
    const first = new VoidmaulVisual(t, null, 1.1);
    const second = new VoidmaulVisual(t, null, 1.1);
    const firstMesh = first.root.getObjectByName(mesh.name) as THREE.Mesh;
    const secondMesh = second.root.getObjectByName(mesh.name) as THREE.Mesh;
    expect(firstMesh.material).not.toBe(secondMesh.material);
    expect(firstMesh.geometry).toBe(geometry);
    expect(firstMesh.userData.sharedGeo).toBe(true);
    first.dispose();
    expect(sourceDisposed).toBe(false);
    expect(geometryDisposed).toBe(false);
    expect(source).toBe((t.scene.getObjectByName(mesh.name) as THREE.Mesh).material);
    second.dispose();
  });
});
