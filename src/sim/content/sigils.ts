// The four launch Sigils (game definition): every participant picks two at
// champion select (a fixed default until the select screen lands in phase 6).
// Data-as-code on the same CastSpec primitives as abilities.

import type { CastSpec } from '../combat/casting';

export interface SigilDef {
  id: string;
  name: string;
  cooldown: number;
  castRange: number;
  spec: CastSpec;
}

// 150 s (down from 210) and range 5.5 (up from 4.5): the old blink was both
// rarer and shorter than several champion dashes, which made the marquee
// sigil read as a downgrade (gap analysis).
const RIFTSTEP: SigilDef = {
  id: 'riftstep',
  name: 'Riftstep',
  cooldown: 150,
  castRange: 5.5,
  spec: { kind: 'dash', range: 5.5 },
};

const ZEPHYR: SigilDef = {
  id: 'zephyr',
  name: 'Zephyr',
  cooldown: 150,
  castRange: 0,
  spec: {
    kind: 'self_or_ally',
    searchRadius: 0,
    effects: [{ kind: 'buff', duration: 6, msPct: 0.35 }],
  },
};

// 100 plus 15 percent max health: the old flat 220 was 39 percent of a
// level-1 bar and a rounding error at 18; the pct half keeps it a real
// button all game.
const MEND: SigilDef = {
  id: 'mend',
  name: 'Mend',
  cooldown: 150,
  castRange: 7,
  spec: {
    kind: 'self_or_ally',
    searchRadius: 2.5,
    effects: [{ kind: 'heal', base: 100, maxHpPct: 0.15 }],
  },
};

const SEAR: SigilDef = {
  id: 'sear',
  name: 'Sear',
  cooldown: 120,
  castRange: 7,
  spec: {
    kind: 'enemy_target',
    searchRadius: 2,
    effects: [
      { kind: 'dot', duration: 3, perSecond: 30, dtype: 'magic' },
      { kind: 'grievous', duration: 3, factor: 0.4 },
    ],
  },
};

export const SIGILS: Readonly<Record<string, SigilDef>> = {
  [RIFTSTEP.id]: RIFTSTEP,
  [ZEPHYR.id]: ZEPHYR,
  [MEND.id]: MEND,
  [SEAR.id]: SEAR,
};

export const SIGIL_LIST: readonly SigilDef[] = [RIFTSTEP, ZEPHYR, MEND, SEAR];
