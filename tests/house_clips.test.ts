// The house animation library: clips the repo ships itself (retargeted
// from Mixamo onto the Tripo skeleton by scripts/retarget_mixamo.py).
// Every entry must point at a real committed file whose single animation
// is named by its id, or a pick would land a champion a frozen role.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { catalogRoles, HOUSE_CLIP_CHOICES, houseClipFile } from '../server/generation/house_clips';
import { MockProvider } from '../server/generation/mock';
import { CLIP_ROLES } from '../server/generation/provider';

function glbAnimationNames(file: string): string[] {
  const buf = readFileSync(file);
  let off = 12;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    if (type === 0x4e4f534a) {
      const json = JSON.parse(buf.subarray(off + 8, off + 8 + len).toString()) as {
        animations?: { name?: string }[];
        meshes?: unknown[];
      };
      expect(json.meshes ?? []).toHaveLength(0);
      return (json.animations ?? []).map((a) => a.name ?? '');
    }
    off += 8 + len;
  }
  throw new Error(`${file}: no JSON chunk`);
}

describe('the house clip library', () => {
  it('ships a real geometry-free file per entry, animation named by its id', () => {
    for (const role of CLIP_ROLES) {
      for (const clip of HOUSE_CLIP_CHOICES[role]) {
        expect(clip.id).toMatch(/^house:/);
        expect(houseClipFile(clip.id)).toBe(clip.file);
        expect(glbAnimationNames(`public/${clip.file}`)).toEqual([clip.id]);
      }
    }
    expect(houseClipFile('preset:biped:run')).toBe(null);
    expect(houseClipFile('house:nope')).toBe(null);
  });

  it('previews on the mannequin: every entry sits in its manifest', () => {
    const manifest = JSON.parse(readFileSync('public/models/mannequin/mannequin.json', 'utf8')) as {
      clips: Record<string, string>;
    };
    for (const role of CLIP_ROLES) {
      for (const clip of HOUSE_CLIP_CHOICES[role]) {
        expect(manifest.clips[clip.id], clip.id).toBeDefined();
      }
    }
  });

  it('merges into the pickable catalog after the provider presets', () => {
    const roles = catalogRoles(new MockProvider());
    expect(roles.attack.map((c) => c.id)).toEqual([
      'attack',
      'attack_alt',
      ...HOUSE_CLIP_CHOICES.attack.map((c) => c.id),
    ]);
    // The merged entries are plain choices: no file paths leak to wire.
    for (const c of roles.attack) expect(c).not.toHaveProperty('file');
  });
});
