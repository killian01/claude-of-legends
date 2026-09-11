// The objective line and the favor chips (src/ui/objective_line.ts): the
// wording the HUD shows for the three creatures and the favors held, pure
// over the clocks so it reads the same on every host.

import { describe, expect, it } from 'vitest';
import { NO_FAVORS } from '../src/sim/favors';
import type { RingClock } from '../src/sim/rings';
import {
  clockText,
  creatureName,
  favorChips,
  favorClaimText,
  objectiveLine,
  wrathChipText,
} from '../src/ui/objective_line';

const rings: RingClock[] = [
  {
    ring: 'top',
    creature: 'voidmaul',
    x: 0,
    z: 146,
    unitId: null,
    riseAt: 390,
    aspect: 'bulwark',
    ascendant: false,
  },
  {
    ring: 'bot',
    creature: 'pyrefang',
    x: 149,
    z: 7,
    unitId: 12,
    riseAt: null,
    aspect: 'might',
    ascendant: false,
  },
];

describe('the objective line', () => {
  it('says the bot ring, the top ring, then the Warden, each with its aspect or LIVE', () => {
    expect(objectiveLine(rings, 720, 318)).toBe(
      'Pyrefang LIVE Might · Voidmaul 1:12 Bulwark · Warden 6:42',
    );
    expect(objectiveLine(rings, null, 318)).toMatch(/Warden LIVE$/);
  });

  it('names the Ascendant on its rise, with no aspect after it', () => {
    const late: RingClock[] = [
      {
        ring: 'top',
        creature: 'voidmaul',
        x: 0,
        z: 146,
        unitId: 30,
        riseAt: null,
        aspect: null,
        ascendant: true,
      },
      {
        ring: 'bot',
        creature: 'pyrefang',
        x: 149,
        z: 7,
        unitId: null,
        riseAt: 1090,
        aspect: null,
        ascendant: true,
      },
    ];
    expect(objectiveLine(late, 1000, 960)).toBe(
      'Pyrefang Ascendant 2:10 · Voidmaul Ascendant LIVE · Warden 0:40',
    );
    expect(creatureName('pyrefang', false)).toBe('Pyrefang');
    expect(creatureName('voidmaul', true)).toBe('Voidmaul Ascendant');
  });

  it('says only the Warden on a map without rings', () => {
    expect(objectiveLine([], 600, 0)).toBe('Warden 10:00');
  });

  it('formats a clock and never shows a negative one', () => {
    expect(clockText(72)).toBe('1:12');
    expect(clockText(0.2)).toBe('0:01');
    expect(clockText(-3)).toBe('0:00');
  });
});

describe('the favor chips', () => {
  it("say what each favor held does, for the stacks held, in the rings' order", () => {
    expect(favorChips(NO_FAVORS)).toEqual([]);
    const chips = favorChips({ ...NO_FAVORS, might: 2, bulwark: 1, resolve: 1 });
    expect(chips.map((c) => c.aspect)).toEqual(['might', 'bulwark', 'resolve']);
    expect(chips[0]).toMatchObject({ stacks: 2, text: 'MIGHT +6% AD and AP' });
    expect(chips[1]?.text).toBe('BULWARK +5% armor and MR');
    expect(chips[2]?.text).toBe('RESOLVE +6% tenacity, +6% heal and shield power');
  });

  it('names the creature and the aspect in a claim', () => {
    expect(favorClaimText('pyrefang', 'tide')).toBe("Pyrefang's favor: Tide");
  });

  it('says what the Wrath does and how long it lasts', () => {
    expect(wrathChipText(1150, 1000)).toBe('WRATH execute under 20%, hits burn 3% 2:30');
  });
});
