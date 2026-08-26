// Sylra, Thornweaver. Zone-control mage (docs/design/roster.md): her passive
// Barbed Marks is expressed as mark effects on Q, W entry, and R detonation;
// the third mark roots and bites. Numbers are first-pass balance.

import type { EffectSpec } from '../../combat/effects';
import type { ChampionDef } from './index';

const BARBED_MARK: EffectSpec = {
  kind: 'mark',
  duration: 4,
  stacksToTrigger: 3,
  onTrigger: [
    { kind: 'root', duration: 1.1 },
    { kind: 'damage', base: 40, apRatio: 0.3, dtype: 'magic' },
  ],
};

export const SYLRA: ChampionDef = {
  id: 'sylra',
  name: 'Sylra, Thornweaver',
  role: 'Mage',
  blurb: 'A zone-control mage who locks areas down and punishes anyone who stays.',
  // Barbed Marks lives entirely in her ability specs (mark effects), so the
  // passive entry is descriptive only.
  passive: {
    name: 'Barbed Marks',
    description: 'Her abilities mark enemies; the third mark on a target roots it briefly.',
  },
  base: {
    hp: 570,
    mana: 480,
    ad: 52,
    ap: 0,
    armor: 22,
    mr: 30,
    attackRange: 5.5,
    attackSpeed: 0.65,
    moveSpeed: 3.35,
    hpRegen: 1.1,
    manaRegen: 1.6,
    radius: 0.65,
  },
  growth: {
    hp: 96,
    mana: 40,
    ad: 3,
    armor: 4.2,
    mr: 1.3,
  },
  abilities: {
    Q: {
      name: 'Thorn Bolt',
      manaCost: 50,
      cooldown: 7,
      castRange: 10.5,
      spec: {
        kind: 'skillshot',
        speed: 24,
        radius: 0.7,
        range: 10.5,
        onHit: [{ kind: 'damage', base: 80, apRatio: 0.65, dtype: 'magic' }, BARBED_MARK],
      },
    },
    W: {
      name: 'Bramble Field',
      manaCost: 70,
      cooldown: 12,
      castRange: 8.5,
      spec: {
        kind: 'zone',
        radius: 3.2,
        duration: 4,
        tickEvery: 0.5,
        onEnter: [BARBED_MARK],
        onTick: [
          { kind: 'damage', base: 20, apRatio: 0.1, dtype: 'magic' },
          { kind: 'slow', pct: 0.25, duration: 1 },
        ],
      },
    },
    E: {
      name: 'Verdant Shell',
      manaCost: 60,
      cooldown: 11,
      castRange: 8,
      spec: {
        kind: 'self_or_ally',
        searchRadius: 2.5,
        effects: [{ kind: 'shield', base: 70, apRatio: 0.6, duration: 2.5 }],
      },
    },
    R: {
      name: 'Overgrowth',
      manaCost: 100,
      cooldown: 80,
      castRange: 9,
      spec: {
        kind: 'zone',
        radius: 4.2,
        duration: 1.3,
        detonateDelay: 1.25,
        onDetonate: [
          { kind: 'damage', base: 180, apRatio: 0.7, dtype: 'magic' },
          { kind: 'root', duration: 1.6 },
          BARBED_MARK,
        ],
      },
    },
  },
};
