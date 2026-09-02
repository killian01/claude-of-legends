// Structural gate for the recorded sound bank (src/game/sfx_bank.ts over
// public/sfx/). The manifest degrades silently in both directions: a
// listed file that is not on disk plays the synthesis forever, and a
// rendered file that is not listed ships for nothing. Both are caught
// here, along with the palette coverage (every cast and attack sound a
// forged creator can pick has a recording) and the size budget.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SFX_BANK } from '../src/game/sfx_bank';
import { ATTACK_SOUNDS, CAST_SOUNDS } from '../src/sim/content/sounds';

const DIR = join(process.cwd(), 'public', 'sfx');
const FILE_MAX_KB = 80;
const BANK_MAX_KB = 1200;

describe('the recorded sound bank', () => {
  it('lists exactly the recordings on disk', () => {
    const listed = Object.values(SFX_BANK).flat().sort();
    const onDisk = readdirSync(DIR)
      .filter((f) => f.endsWith('.ogg'))
      .sort();
    expect(listed).toEqual(onDisk);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('covers the whole palette a forged creator picks from', () => {
    for (const s of CAST_SOUNDS) expect(SFX_BANK[`cast_${s.id}`]?.length ?? 0).toBeGreaterThan(0);
    for (const s of ATTACK_SOUNDS) expect(SFX_BANK[s.id]?.length ?? 0).toBeGreaterThan(0);
    // The combat sounds every match plays.
    for (const id of ['hit', 'impact', 'towershot', 'cast']) {
      expect(SFX_BANK[id]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('stays inside the size budget', () => {
    let total = 0;
    for (const file of Object.values(SFX_BANK).flat()) {
      const size = statSync(join(DIR, file)).size;
      expect(size, file).toBeLessThan(FILE_MAX_KB * 1024);
      total += size;
    }
    expect(total).toBeLessThan(BANK_MAX_KB * 1024);
    expect(existsSync(join(DIR, 'CREDITS.md'))).toBe(true);
  });
});
