// Clip-name resolution for forged models: the provider's preset spellings
// and the mock placeholder's bare roles both land on the renderer's clip
// vocabulary, with idle as the universal fallback.

import { describe, expect, it } from 'vitest';
import { CLIP_ROLES } from '../server/generation/provider';
import {
  resolveForgedClips,
  spellClipPicks,
  stripStanceLead,
  stripTravel,
} from '../src/render/champions/forged_clips';

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

  it('leaves the run displaced by its first key: stripStanceLead owns that', () => {
    // The live probe's exact failure shape: the preset is trimmed
    // mid-stride, so after detrending the whole loop still plays ahead
    // of the stance by the first key's value along the travel axis.
    const clip = {
      tracks: [
        {
          name: 'Hip.position',
          times: [0, 0.5, 1],
          values: [0, 1.25, 0.1, 0, 1.75, 0.35, 0, 2.25, 0.1],
        },
      ],
    };
    const removed = stripTravel(clip);
    expect(removed).toEqual([{ name: 'Hip.position', drift: [0, 1, 0] }]);
    // Detrended, but anchored a full unit ahead of the idle stance.
    expect(clip.tracks[0]?.values).toEqual([0, 1.25, 0.1, 0, 1.25, 0.35, 0, 1.25, 0.1]);
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

describe('stripStanceLead', () => {
  it('rebases the detrended run onto the idle stance along the travel axis', () => {
    // The mid-stride trim: after detrending, the run holds the hip a
    // full unit ahead of idle on the travel axis (local Y here) while
    // legitimately swaying on Z; only the travel component must go.
    const run = {
      tracks: [
        {
          name: 'Hip.position',
          times: [0, 0.5, 1],
          values: [0, 1.25, 0.1, 0, 1.25, 0.35, 0, 1.25, 0.1],
        },
      ],
    };
    const idle = {
      tracks: [{ name: 'Hip.position', times: [0, 1], values: [0, 0.25, 0.1, 0, 0.25, 0.1] }],
    };
    stripStanceLead(run, idle, [{ name: 'Hip.position', drift: [0, 1, 0] }]);
    // The Y lead (1.25 - 0.25 = 1) is gone from every key; Z untouched.
    expect(run.tracks[0]?.values).toEqual([0, 0.25, 0.1, 0, 0.25, 0.35, 0, 0.25, 0.1]);
    // Idempotent: the projection is zero after one pass.
    stripStanceLead(run, idle, [{ name: 'Hip.position', drift: [0, 1, 0] }]);
    expect(run.tracks[0]?.values).toEqual([0, 0.25, 0.1, 0, 0.25, 0.35, 0, 0.25, 0.1]);
  });

  it('removes only the component along the travel direction', () => {
    // Travel on a diagonal (3-4-5 on X/Z): the stance offset splits into
    // a lead along the travel line plus a perpendicular lean; the lean
    // must survive the rebase.
    const unit = [0.6, 0, 0.8];
    const perp = [0.8, 0, -0.6];
    const first = [2 * (unit[0] ?? 0) + (perp[0] ?? 0), 0.5, 2 * (unit[2] ?? 0) + (perp[2] ?? 0)];
    const run = {
      tracks: [{ name: 'Hip.position', times: [0, 1], values: [...first, ...first] }],
    };
    const idle = {
      tracks: [{ name: 'Hip.position', times: [0, 1], values: [0, 0.5, 0, 0, 0.5, 0] }],
    };
    stripStanceLead(run, idle, [{ name: 'Hip.position', drift: [3, 0, 4] }]);
    const v = run.tracks[0]?.values ?? [];
    // The lead of 2 along the unit is removed; the perpendicular remains.
    expect(v[0]).toBeCloseTo(perp[0] ?? 0, 10);
    expect(v[1]).toBeCloseTo(0.5, 10);
    expect(v[2]).toBeCloseTo(perp[2] ?? 0, 10);
  });

  it('shifts cubic-spline values but never the tangents, skips missing stance tracks', () => {
    const run = {
      tracks: [
        {
          name: 'Hip.position',
          times: [0, 1],
          values: [0, 5, 0, 0, 2, 0, 0, 5, 0, 0, 5, 0, 0, 2, 0, 0, 5, 0],
        },
        { name: 'Chest.position', times: [0, 1], values: [1, 1, 1, 1, 1, 1] },
      ],
    };
    const idle = {
      tracks: [{ name: 'Hip.position', times: [0, 1], values: [0, 1, 0, 0, 1, 0] }],
    };
    stripStanceLead(run, idle, [
      { name: 'Hip.position', drift: [0, 2, 0] },
      { name: 'Chest.position', drift: [0, 1, 0] },
    ]);
    // Values drop by the lead of 1; the slope-5 tangents stay.
    expect(run.tracks[0]?.values).toEqual([0, 5, 0, 0, 1, 0, 0, 5, 0, 0, 5, 0, 0, 1, 0, 0, 5, 0]);
    // No Chest track in the stance: left alone rather than guessed.
    expect(run.tracks[1]?.values).toEqual([1, 1, 1, 1, 1, 1]);
  });
});

describe('spellClipPicks', () => {
  it('keeps only the slots whose clip the loaded files actually carry', () => {
    const picks = {
      cast: 'preset:biped:cast_a_spell',
      castQ: 'house:magic_cast_01',
      castW: 'preset:biped:slash',
      castR: 'missing_from_files',
    };
    const available = new Set(['house:magic_cast_01', 'preset:biped:slash']);
    expect(spellClipPicks(picks, available)).toEqual({
      Q: 'house:magic_cast_01',
      W: 'preset:biped:slash',
    });
  });

  it('answers undefined with no picks map or no surviving slot', () => {
    expect(spellClipPicks(null, new Set(['x']))).toBe(undefined);
    expect(spellClipPicks({ cast: 'x' }, new Set(['x']))).toBe(undefined);
    expect(spellClipPicks({ castQ: 'gone' }, new Set(['x']))).toBe(undefined);
  });
});
