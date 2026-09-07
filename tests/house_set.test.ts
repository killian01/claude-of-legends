// The set a rigged champion borrows before it bakes (house_set.ts): the
// files must exist in the shipped library, cover every renderer role,
// and answer for any family (and for none).

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { houseClipUrl, houseDefaultClipFiles } from '../src/render/champions/house_set';

const ROLES = ['idle', 'run', 'attack', 'cast', 'death'] as const;
const FAMILIES = ['slashing', 'blunt', 'staff', 'bow', 'unarmed'] as const;

function shipped(): Set<string> {
  const dir = fileURLToPath(new URL('../public/models/mannequin/clips', import.meta.url));
  return new Set(readdirSync(dir).filter((f) => f.startsWith('house_')));
}

describe('houseDefaultClipFiles', () => {
  it('covers every role for every weapon family', () => {
    for (const family of FAMILIES) {
      const files = houseDefaultClipFiles(family);
      for (const role of ROLES) {
        expect(files[role], `${family} ${role}`).toBeTruthy();
      }
    }
  });

  it('names files that actually ship with the client', () => {
    // A renamed or dropped clip fails SILENTLY at runtime (the champion
    // keeps the placeholder figure), so it fails loudly here.
    const have = shipped();
    for (const family of [...FAMILIES, null]) {
      for (const url of Object.values(houseDefaultClipFiles(family))) {
        expect(url.startsWith('/models/mannequin/clips/')).toBe(true);
        expect(have.has(url.split('/').pop() ?? ''), url).toBe(true);
      }
    }
  });

  it('answers for an unknown family and for none', () => {
    const none = houseDefaultClipFiles(null);
    const strange = houseDefaultClipFiles('trebuchet');
    expect(Object.keys(none)).toHaveLength(ROLES.length);
    expect(strange).toEqual(none);
  });

  it('gives the ranged families a caster set and the heavy ones a two-hander', () => {
    // A bow draw reads as a cast, never as a sword swing.
    expect(houseDefaultClipFiles('bow').idle).toBe(houseClipUrl('magic_idle'));
    expect(houseDefaultClipFiles('staff').idle).toBe(houseClipUrl('magic_idle'));
    expect(houseDefaultClipFiles('blunt').idle).toBe(houseClipUrl('gs_idle'));
    expect(houseDefaultClipFiles('slashing').idle).toBe(houseClipUrl('sns_idle'));
  });
});
