// Ashvyn, Nightbow. Mobile marksman (docs/design/roster.md). Passive
// Twinshot (every third attack strikes twice) and its W reset are deferred
// with the passive-hook system; W keeps the dash and grants attack speed.

import { dealDamage } from '../../combat/damage';
import type { ChampionDef } from './index';

const TWINSHOT_EVERY = 3;
const TWINSHOT_RATIO = 0.5;

export const ASHVYN: ChampionDef = {
  id: 'ashvyn',
  name: 'Ashvyn, Nightbow',
  role: 'Marksman',
  blurb: 'A mobile duelist marksman who weaves in and out of range.',
  passive: {
    name: 'Twinshot',
    description:
      'Every third attack strikes twice (the echo deals 50 percent damage). ' +
      "Casting Hunter's Step readies the echo instantly.",
    onAttackHit(ctx, self, target) {
      self.passiveStacks += 1;
      if (self.passiveStacks < TWINSHOT_EVERY) return;
      self.passiveStacks = 0;
      dealDamage(ctx, self.id, target, self.stats.ad * TWINSHOT_RATIO, 'physical', 'other');
    },
    // The roster's promised W synergy: the dash primes the next echo.
    onCast(_ctx, self, key) {
      if (key === 'W') self.passiveStacks = TWINSHOT_EVERY - 1;
    },
  },
  base: {
    hp: 560,
    mana: 280,
    ad: 58,
    ap: 0,
    armor: 24,
    mr: 30,
    attackRange: 5.5,
    attackSpeed: 0.75,
    moveSpeed: 3.7,
    hpRegen: 1.4,
    manaRegen: 1.3,
    radius: 0.6,
  },
  growth: { hp: 90, mana: 30, ad: 5.5, armor: 2.2, mr: 1.3 },
  abilities: {
    Q: {
      name: 'Shadow Volley',
      manaCost: 40,
      cooldown: 5.5,
      castRange: 5.5,
      // Instant scaling cone: the draw telegraphs before the volley flies.
      windup: 0.25,
      spec: {
        kind: 'cone',
        range: 5.5,
        halfAngle: Math.PI / 6,
        onHit: [{ kind: 'damage', base: 62, adRatio: 1.33, dtype: 'physical' }],
      },
    },
    W: {
      name: "Hunter's Step",
      manaCost: 35,
      cooldown: 7,
      castRange: 3.5,
      spec: {
        kind: 'dash',
        range: 3.5,
        selfEffects: [{ kind: 'buff', duration: 2.5, asPct: 0.4 }],
      },
    },
    E: {
      name: 'Pinning Arrow',
      manaCost: 45,
      cooldown: 8.5,
      castRange: 9,
      spec: {
        kind: 'skillshot',
        speed: 26,
        radius: 0.55,
        range: 9,
        onHit: [
          { kind: 'damage', base: 53, adRatio: 0.95, dtype: 'physical' },
          { kind: 'root', duration: 1.0 },
        ],
      },
    },
    R: {
      name: 'Eclipse Rain',
      manaCost: 85,
      cooldown: 64,
      castRange: 9,
      spec: {
        kind: 'zone',
        radius: 4.5,
        duration: 3,
        tickEvery: 0.5,
        onTick: [
          { kind: 'damage', base: 48, adRatio: 0.66, dtype: 'physical' },
          { kind: 'slow', pct: 0.3, duration: 1 },
        ],
      },
    },
  },
};
