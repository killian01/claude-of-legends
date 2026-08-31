// The mannequin build script bakes the preview catalog once; the server
// offers picks from TRIPO_CLIP_CHOICES. The two lists must be the same
// set, or a pickable preset would have no preview (or a preview no
// pick). The script is plain node (.mjs), so the test reads its preset
// table textually instead of importing it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TRIPO_CLIP_CHOICES } from '../server/generation/tripo';

describe('the mannequin build script', () => {
  it('bakes exactly the pickable catalog, deduplicated', () => {
    const src = readFileSync('scripts/forge_mannequin.mjs', 'utf8');
    const start = src.indexOf('MANNEQUIN_PRESETS = [');
    const block = src.slice(start, src.indexOf('];', start));
    const scripted = [...block.matchAll(/'(preset:biped:[a-z0-9_]+)'/g)].map((m) => m[1]);
    const catalog = new Set(
      Object.values(TRIPO_CLIP_CHOICES).flatMap((list) => list.map((c) => c.id)),
    );
    expect([...scripted].sort()).toEqual([...catalog].sort());
    // Deduplicated: one bake per preset, even for ids serving two roles.
    expect(new Set(scripted).size).toBe(scripted.length);
  });
});
