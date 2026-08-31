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
  it('pins X and Z of position tracks, keeps the height bob, spares rotations', () => {
    // A run cycle whose root walks forward along Z while bobbing on Y.
    const clip = {
      tracks: [
        { name: 'Hips.position', values: [1, 0.9, 0, 1.2, 1.05, 0.5, 1.4, 0.9, 1.0] },
        { name: 'Hips.quaternion', values: [0, 0, 0, 1, 0, 0.2, 0, 0.98] },
      ],
    };
    stripTravel(clip);
    // X and Z hold the first frame; Y still bobs.
    expect(clip.tracks[0]?.values).toEqual([1, 0.9, 0, 1, 1.05, 0, 1, 0.9, 0]);
    expect(clip.tracks[1]?.values).toEqual([0, 0, 0, 1, 0, 0.2, 0, 0.98]);
    // Idempotent: a second pass changes nothing.
    stripTravel(clip);
    expect(clip.tracks[0]?.values).toEqual([1, 0.9, 0, 1, 1.05, 0, 1, 0.9, 0]);
  });
});
