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

const RIFTSTEP: SigilDef = {
  id: 'riftstep',
  name: 'Riftstep',
  cooldown: 210,
  castRange: 4.5,
  spec: { kind: 'dash', range: 4.5 },
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

const MEND: SigilDef = {
  id: 'mend',
  name: 'Mend',
  cooldown: 150,
  castRange: 7,
  spec: {
    kind: 'self_or_ally',
    searchRadius: 2.5,
    effects: [{ kind: 'heal', base: 220 }],
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
