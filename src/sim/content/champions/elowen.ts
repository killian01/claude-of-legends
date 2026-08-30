// Elowen, Mistward. Battlemage (docs/design/kits-v2.md): the mist decides
// what you see and where you may go. W blinds enemies and conceals allies
// inside; R's storm throws walkers back at its rim (dashes and blinks pass
// free); Q weaves: every second Mist Lance on a target bursts and slows.

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
    attackRange: 5.75,
    attackSpeed: 0.62,
    moveSpeed: 3.65,
    hpRegen: 1.2,
    manaRegen: 1.7,
    radius: 0.65,
  },
  growth: { hp: 90, mana: 45, ad: 3, armor: 2.3, mr: 1.3 },
  abilities: {
    Q: {
      name: 'Mist Lance',
      manaCost: 40,
      cooldown: 4.5,
      castRange: 9.5,
      spec: {
        kind: 'skillshot',
        speed: 22,
        radius: 0.6,
        range: 9.5,
        pierce: true,
        onHit: [
          { kind: 'damage', base: 62, apRatio: 0.95, dtype: 'magic' },
          // The mist clings: the second lance on a marked target bursts and
          // slows. Duration outlives the rank-1 cooldown so the weave works
          // from level 1.
          {
            kind: 'mark',
            duration: 5.5,
            stacksToTrigger: 2,
            onTrigger: [
              { kind: 'damage', base: 55, apRatio: 0.4, dtype: 'magic' },
              { kind: 'slow', pct: 0.25, duration: 1 },
            ],
          },
        ],
      },
    },
    W: {
      name: 'Veil',
      manaCost: 60,
      cooldown: 10.5,
      castRange: 8,
      spec: {
        kind: 'zone',
        radius: 3.5,
        duration: 3.5,
        tickEvery: 0.5,
        onTick: [
          { kind: 'blind', duration: 1, factor: 0.4 },
          { kind: 'damage', base: 10, apRatio: 0.19, dtype: 'magic' },
        ],
        // The mist conceals: allied CHAMPIONS inside stay hidden (the zone
        // itself is visible, so enemies know where the threat is, not what
        // it does). Minions are exempt or the lane war would stall blind.
        allyOnTick: [
          {
            kind: 'conditional',
            when: { kind: 'targetIsChampion' },
            effects: [{ kind: 'stealth', duration: 0.6 }],
          },
        ],
      },
    },
    E: {
      name: 'Drifting Step',
      manaCost: 45,
      cooldown: 8.5,
      castRange: 4,
      spec: { kind: 'dash', range: 4 },
    },
    R: {
      name: 'Whiteout',
      manaCost: 85,
      cooldown: 64,
      castRange: 9,
      spec: {
        kind: 'zone',
        radius: 5,
        duration: 4,
        tickEvery: 0.5,
        onTick: [
          { kind: 'damage', base: 35, apRatio: 0.48, dtype: 'magic' },
          { kind: 'slow', pct: 0.45, duration: 1 },
        ],
        // The storm's rim is a wall of wind: walking out throws you back
        // toward the eye (once per 1.5 s each). A dash or blink escapes.
        boundary: {
          effects: [
            { kind: 'knockback', distance: 2, direction: 'toCenter' },
            { kind: 'damage', base: 25, apRatio: 0.2, dtype: 'magic' },
          ],
          perUnitEvery: 1.5,
        },
      },
    },
  },
};
