// Elowen, Mistward. Battlemage (docs/design/roster.md). Passive Mistborne
// (ability damage grants move speed) is deferred with the passive-hook
// system. Her W exercises the blind primitive: enemy sight shrinks inside.

import { refreshBuff } from '../../combat/status';
import type { ChampionDef } from './index';

const MISTBORNE_MS_PCT = 0.08;
const MISTBORNE_DURATION_S = 1.2;

export const ELOWEN: ChampionDef = {
  id: 'elowen',
  name: 'Elowen, Mistward',
  role: 'Battlemage',
  blurb: 'A skirmishing mage who bends vision itself and flows between hits.',
  passive: {
    name: 'Mistborne',
    description: 'Dealing ability damage grants a brief burst of move speed.',
    modifyDamage(ctx, self, _target, amount, _dtype, via) {
      if (via === 'ability' && amount > 0) {
        refreshBuff(self, ctx.time, MISTBORNE_DURATION_S, { msPct: MISTBORNE_MS_PCT });
      }
      return amount;
    },
  },
  base: {
    hp: 560,
    mana: 480,
    ad: 52,
    ap: 0,
    armor: 22,
    mr: 30,
    attackRange: 5.25,
    attackSpeed: 0.62,
    moveSpeed: 3.4,
    hpRegen: 1.2,
    manaRegen: 1.7,
    radius: 0.65,
  },
  growth: { hp: 90, mana: 45, ad: 3, armor: 4, mr: 1.3 },
  abilities: {
    Q: {
      name: 'Mist Lance',
      manaCost: 45,
      cooldown: 6,
      castRange: 9.5,
      spec: {
        kind: 'skillshot',
        speed: 22,
        radius: 0.6,
        range: 9.5,
        pierce: true,
        onHit: [{ kind: 'damage', base: 70, apRatio: 0.5, dtype: 'magic' }],
      },
    },
    W: {
      name: 'Veil',
      manaCost: 70,
      cooldown: 14,
      castRange: 8,
      spec: {
        kind: 'zone',
        radius: 3.5,
        duration: 3.5,
        tickEvery: 0.5,
        onTick: [
          { kind: 'blind', duration: 1, factor: 0.4 },
          { kind: 'damage', base: 12, apRatio: 0.1, dtype: 'magic' },
        ],
      },
    },
    E: {
      name: 'Drifting Step',
      manaCost: 50,
      cooldown: 11,
      castRange: 4,
      spec: { kind: 'dash', range: 4 },
    },
    R: {
      name: 'Whiteout',
      manaCost: 100,
      cooldown: 85,
      castRange: 9,
      spec: {
        kind: 'zone',
        radius: 5,
        duration: 4,
        tickEvery: 0.5,
        onTick: [
          { kind: 'damage', base: 40, apRatio: 0.25, dtype: 'magic' },
          { kind: 'slow', pct: 0.45, duration: 1 },
        ],
      },
    },
  },
};
