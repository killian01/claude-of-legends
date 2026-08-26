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
    { kind: 'damage', base: 35, apRatio: 0.57, dtype: 'magic' },
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
    moveSpeed: 3.6,
    hpRegen: 1.1,
    manaRegen: 1.6,
    radius: 0.65,
  },
  growth: {
    hp: 96,
    mana: 40,
    ad: 3,
    armor: 2.4,
    mr: 1.3,
  },
  abilities: {
    Q: {
      name: 'Thorn Bolt',
      manaCost: 45,
      cooldown: 5.5,
      castRange: 10.5,
      spec: {
        kind: 'skillshot',
        speed: 24,
        radius: 0.7,
        range: 10.5,
        onHit: [{ kind: 'damage', base: 70, apRatio: 1.23, dtype: 'magic' }, BARBED_MARK],
      },
    },
    W: {
      name: 'Bramble Field',
      manaCost: 60,
      cooldown: 9,
      castRange: 8.5,
      spec: {
        kind: 'zone',
        radius: 3.2,
        duration: 4,
        tickEvery: 0.5,
        onEnter: [BARBED_MARK],
        onTick: [
          { kind: 'damage', base: 18, apRatio: 0.19, dtype: 'magic' },
          { kind: 'slow', pct: 0.25, duration: 1 },
        ],
      },
    },
    E: {
      name: 'Verdant Shell',
      manaCost: 50,
      cooldown: 8.5,
      castRange: 8,
      spec: {
        kind: 'self_or_ally',
        searchRadius: 2.5,
        effects: [{ kind: 'shield', base: 70, apRatio: 0.6, duration: 2.5 }],
      },
    },
    R: {
      name: 'Overgrowth',
      manaCost: 85,
      cooldown: 60,
      castRange: 9,
      spec: {
        kind: 'zone',
        radius: 4.2,
        duration: 1.3,
        detonateDelay: 1.25,
        onDetonate: [
          { kind: 'damage', base: 158, apRatio: 1.33, dtype: 'magic' },
          { kind: 'root', duration: 1.6 },
          BARBED_MARK,
        ],
      },
    },
  },
};
