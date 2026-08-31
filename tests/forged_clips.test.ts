// Clip-name resolution for forged models: the provider's preset spellings
// and the mock placeholder's bare roles both land on the renderer's clip
// vocabulary, with idle as the universal fallback.

import { describe, expect, it } from 'vitest';
import { CLIP_ROLES } from '../server/generation/provider';
import { resolveForgedClips, stripTravel } from '../src/render/champions/forged_clips';

describe('resolveForgedClips', () => {
  it('maps the live provider preset names onto the clip vocabulary', () => {
    // The exact names a live retarget bakes into the GLB (verified 2026-08-31).
    const names = [
      'preset:biped:idle',
      'preset:biped:run',
      'preset:biped:slash',
      'preset:biped:cast_a_spell',
      'preset:biped:defeat_02',
    ];
    expect(resolveForgedClips(names)).toEqual({
      idle: 'preset:biped:idle',
      run: 'preset:biped:run',
      attack: 'preset:biped:slash',
      cast: 'preset:biped:cast_a_spell',
      windup: 'preset:biped:cast_a_spell',
      death: 'preset:biped:defeat_02',
    });
  });

  it('maps the mock placeholder clip roles onto themselves', () => {
    const resolved = resolveForgedClips([...CLIP_ROLES]);
    expect(resolved).toMatchObject({
      idle: 'idle',
      run: 'run',
      attack: 'attack',
      cast: 'cast',
      death: 'death',
    });
  });

  it('falls back to idle for anything missing, null when clipless', () => {
    const resolved = resolveForgedClips(['preset:biped:idle']);
    expect(resolved).toMatchObject({ idle: 'preset:biped:idle', run: 'preset:biped:idle' });
    expect(resolveForgedClips([])).toBe(null);
    // No idle at all: the first clip stands in.
    expect(resolveForgedClips(['weird_a', 'weird_b'])?.idle).toBe('weird_a');
  });
});

describe('stripTravel', () => {
  it('removes the net drift on every axis, keeps the bob, spares rotations', () => {
    // A run cycle whose root drifts on X and Z while bobbing on Y (all
    // values dyadic so the detrending arithmetic is exact).
    const clip = {
      tracks: [
        {
          name: 'Hips.position',
          times: [0, 0.5, 1],
          values: [1, 0.75, 0, 1.25, 1, 0.5, 1.5, 0.75, 1],
        },
        { name: 'Hips.quaternion', times: [0, 1], values: [0, 0, 0, 1, 0, 0.25, 0, 0.75] },
      ],
    };
    const removed = stripTravel(clip);
    // X and Z lose their straight-line drift; the Y bob has none to lose.
    expect(clip.tracks[0]?.values).toEqual([1, 0.75, 0, 1, 1, 0, 1, 0.75, 0]);
    expect(clip.tracks[1]?.values).toEqual([0, 0, 0, 1, 0, 0.25, 0, 0.75]);
    // The removed drift is handed back: the facing fix derives from it.
    expect(removed).toEqual([{ name: 'Hips.position', drift: [0.5, 0, 1] }]);
    // Idempotent: a detrended track has zero drift left to remove.
    expect(stripTravel(clip)).toEqual([]);
    expect(clip.tracks[0]?.values).toEqual([1, 0.75, 0, 1, 1, 0, 1, 0.75, 0]);
  });

  it('catches travel hidden on the local Y axis by a rotated armature', () => {
    // A quarter-turned export puts the world's forward on the bone's local
    // Y: the old X/Z pinning missed exactly this (live playtest bug).
    const clip = {
      tracks: [
        {
          name: 'Hips.position',
          times: [0, 0.5, 1],
          values: [0, 0, 0, 0, 0.5, 0.25, 0, 1, 0],
        },
      ],
    };
    const removed = stripTravel(clip);
    // The Y drift is gone; the Z bob (returns to its start) survives.
    expect(clip.tracks[0]?.values).toEqual([0, 0, 0, 0, 0, 0.25, 0, 0, 0]);
    expect(removed).toEqual([{ name: 'Hips.position', drift: [0, 1, 0] }]);
  });

  it('detrends glTF cubic-spline tracks, values and tangents alike', () => {
    // Stride 9: in-tangent, value, out-tangent per key. Y drifts by 2 over
    // one second with matching slope-2 tangents.
    const clip = {
      tracks: [
        {
          name: 'Hips.position',
          times: [0, 1],
          values: [0, 2, 0, 0, 0, 0, 0, 2, 0, 0, 2, 0, 0, 2, 0, 0, 2, 0],
        },
      ],
    };
    stripTravel(clip);
    expect(clip.tracks[0]?.values).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
