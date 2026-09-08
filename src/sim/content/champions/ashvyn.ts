// Ashvyn, Nightbow. Mobile marksman (docs/design/kits-v2.md): a tempo
// archer on a rhythm of thirds. E finally honors the roster promise (root
// at long range, slow up close); R's eclipse reveals everything under it.

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
    attackRange: 5.9,
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
      castRange: 7,
      // Instant scaling cone: the draw telegraphs before the volley flies.
      // Reach pass: at 5.5 the volley landed SHORTER than his own bow
      // (5.9), so there was never a moment to cast it that an attack did
      // not already cover. At the engine's cone rail it is what it reads
      // as, a point-blank shotgun that opens a trade.
      windup: 0.25,
      spec: {
        kind: 'cone',
        range: 7,
        halfAngle: Math.PI / 6,
        onHit: [{ kind: 'damage', base: 62, adRatio: 1.33, dtype: 'physical' }],
      },
    },
    W: {
      name: "Hunter's Step",
      manaCost: 35,
      cooldown: 7,
      // The step the blurb promises ("weaves in and out of range"): 3.5
      // was under his own body plus a champion's, so it bought no time at
      // all. Five costs a melee champion a second approach without undoing
      // its engage outright, which would be the other mistake.
      castRange: 5,
      spec: {
        kind: 'dash',
        range: 5,
        speed: 16,
        selfEffects: [{ kind: 'buff', duration: 2.5, asPct: 0.4 }],
      },
    },
    E: {
      name: 'Pinning Arrow',
      manaCost: 45,
      cooldown: 8.5,
      castRange: 10,
      // The roster promise, delivered: a long flight pins (root), a
      // point-blank shot only slows. Max-range picks, not melee spam.
      spec: {
        kind: 'skillshot',
        speed: 26,
        radius: 0.55,
        range: 10,
        onHit: [
          { kind: 'damage', base: 53, adRatio: 0.95, dtype: 'physical' },
          {
            kind: 'conditional',
            // Six tenths of the flight, held there as the arrow got
            // longer: the root stays the reward for the far shot.
            when: { kind: 'distanceAtLeast', distance: 6 },
            effects: [{ kind: 'root', duration: 1.0 }],
            otherwise: [{ kind: 'slow', pct: 0.4, duration: 1 }],
          },
        ],
      },
    },
    R: {
      name: 'Eclipse Rain',
      manaCost: 85,
      cooldown: 64,
      castRange: 10,
      // Brush and stealth offer no cover under the eclipse: the zone
      // reveals everything inside for its duration. It was the smallest
      // ultimate zone on the roster and cast from the shortest distance,
      // which is the wrong pair for the squishiest body that owns one.
      spec: {
        kind: 'zone',
        radius: 5.2,
        duration: 3,
        tickEvery: 0.5,
        reveal: true,
        onTick: [
          { kind: 'damage', base: 48, adRatio: 0.66, dtype: 'physical' },
          { kind: 'slow', pct: 0.3, duration: 1 },
        ],
      },
    },
  },
};
