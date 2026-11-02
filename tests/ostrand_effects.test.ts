// Ostrand's authored spell effects: the catalog wires each of his four
// spells to its own look, the builders make the parts the ticks animate,
// the Standard tells its own side from the other, and the Oathfield's dust
// breaks the ground on the ring the sim raises (no GPU, a recording
// VfxSystem stand-in).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SPELL_VFX } from '../src/render/vfx/catalog';
import {
  buildGauntlet,
  buildLancePoint,
  buildStandard,
  OATH,
  oathfieldRise,
  STONE,
  standardTick,
  WARD,
} from '../src/render/vfx/ostrand_fx';
import type { VfxSystem } from '../src/render/vfx/system';
import { OSTRAND } from '../src/sim/content/champions/ostrand';

function recordingFx(): { fx: VfxSystem; calls: string[]; debris: [number, number][] } {
  const calls: string[] = [];
  const debris: [number, number][] = [];
  const note = (name: string) => () => {
    calls.push(name);
  };
  const fx = {
    particles: { spawn: note('particle') },
    rings: { spawn: note('ring') },
    debris: {
      burst: (x: number, z: number) => {
        calls.push('debris');
        debris.push([x, z]);
      },
    },
    glowFlash: note('glow'),
    sparkBurst: note('spark'),
    smokePuffs: note('smoke'),
    lightPulse: note('light'),
    onShake: note('shake'),
    schedule: (_ms: number, fn: () => void) => fn(),
  } as unknown as VfxSystem;
  return { fx, calls, debris };
}

describe('Ostrand spell effects', () => {
  it('gives each of his four spells its own entry in the catalog', () => {
    expect(SPELL_VFX.ostrand_Q?.projectile).toBeTypeOf('function');
    expect(SPELL_VFX.ostrand_Q?.impact).toBeTypeOf('function');
    expect(SPELL_VFX.ostrand_W?.zone).toBeTypeOf('function');
    expect(SPELL_VFX.ostrand_W?.zoneTick).toBeTypeOf('function');
    expect(SPELL_VFX.ostrand_E?.projectile).toBeTypeOf('function');
    expect(SPELL_VFX.ostrand_E?.impact).toBeTypeOf('function');
    expect(SPELL_VFX.ostrand_R?.castFx).toBeTypeOf('function');
  });

  it('matches each hook to the kind of spell the sim casts', () => {
    expect(OSTRAND.abilities.Q.spec.kind).toBe('skillshot');
    expect(OSTRAND.abilities.W.spec.kind).toBe('zone');
    expect(OSTRAND.abilities.E.spec.kind).toBe('skillshot');
    expect(OSTRAND.abilities.R.spec.kind).toBe('oathfield');
  });

  it('flies the lance and the gauntlet unstretched, their own shape', () => {
    expect(buildLancePoint().userData.stretch).toBe(false);
    expect(buildGauntlet().userData.stretch).toBe(false);
  });

  it('plants a Standard whose rim reads gold for allies and crimson for the other side', () => {
    const rimColor = (o: THREE.Object3D) => {
      const rim = o.children.find(
        (c) => c instanceof THREE.Mesh && c.geometry instanceof THREE.RingGeometry,
      ) as THREE.Mesh;
      return (rim.material as THREE.MeshBasicMaterial).color.getHex();
    };
    expect(rimColor(buildStandard(3.5, false))).toBe(WARD);
    expect(rimColor(buildStandard(3.5, true))).toBe(OATH.glow);
  });

  it('plants the Standard once, then sways its cloth while it stands', () => {
    const { fx, calls } = recordingFx();
    const holder = buildStandard(3.5, false);
    const pivot = holder.userData.pivot as THREE.Object3D;
    standardTick(fx, holder, 0, 0, 3.5, 0, 16);
    const planted = calls.filter((c) => c === 'ring').length;
    standardTick(fx, holder, 0, 0, 3.5, 250, 16);
    expect(planted).toBe(1);
    expect(calls.filter((c) => c === 'ring').length).toBe(1);
    expect(pivot.rotation.y).not.toBe(0);
  });

  it('breaks the ground on the ring the Oathfield raises around him', () => {
    const { fx, calls, debris } = recordingFx();
    const spec = OSTRAND.abilities.R.spec;
    if (spec.kind !== 'oathfield') throw new Error('R is the Oathfield');
    oathfieldRise(fx, 10, 20);
    expect(calls).toContain('shake');
    expect(debris.length).toBe(8);
    for (const [x, z] of debris) {
      expect(Math.hypot(x - 10, z - 20)).toBeCloseTo(spec.radius, 6);
    }
    expect(STONE).toBeTypeOf('number');
  });
});
