// Nisk, the Hushdart. Scout marksman: a small, quick prankster of the brush
// who is hard to see and punishes careless walkers. Lie Low hides it once it
// keeps still or keeps to a brush (src/sim/lurk.ts), and the first dart out
// of hiding flies fast; Pepper Dart makes its victim fumble (CONTEXT.md:
// Fumble); Hightail is a sprint and a little speed at all times; Bittertip
// poisons every dart for a few seconds, each hit renewing the poison; the
// Sourpods are hidden traps from a store of charges (CONTEXT.md: Sourpod,
// Charge) that burst into a slowing cloud of poison under an enemy's feet.

import { refreshBuff } from '../../combat/status';
import { effectiveRank } from '../../stats';
import type { ChampionDef } from './index';

// Hightail's standing share of speed, by its rank: a little faster at all
// times once learned, a step more per rank.
export const HIGHTAIL_MS_BASE = 0.03;
export const HIGHTAIL_MS_PER_RANK = 0.01;
// Just over the 0.25 s passive tick so the stride never flickers off.
const STRIDE_S = 0.4;

export const NISK: ChampionDef = {
  id: 'nisk',
  name: 'Nisk, the Hushdart',
  role: 'Marksman',
  blurb:
    'A quick little prankster of the brush: unseen until it strikes, it leaves pods for careless feet.',
  attackSound: 'swing',
  passive: {
    name: 'Lie Low',
    description:
      'After keeping still for 1.5 seconds, or keeping to one brush as long, Nisk is hidden ' +
      'from enemies until it acts, moves in the open or leaves the brush; taking damage ' +
      'restarts the count. Its first attack out of hiding swings 60 percent faster, for 2.5 ' +
      'seconds. Once Hightail is learned Nisk is always a little faster: 4 percent, one more ' +
      'per rank.',
    lurk: { after: 1.5, burst: { asPct: 0.6, duration: 2.5 } },
    onTick(ctx, self) {
      const rank = effectiveRank(self, 'W');
      if (rank <= 0) return;
      refreshBuff(self, ctx.time, STRIDE_S, {
        msPct: HIGHTAIL_MS_BASE + HIGHTAIL_MS_PER_RANK * rank,
      });
    },
  },
  base: {
    hp: 520,
    mana: 300,
    ad: 55,
    ap: 0,
    armor: 22,
    mr: 30,
    attackRange: 5.6,
    attackSpeed: 0.72,
    moveSpeed: 3.7,
    hpRegen: 1.3,
    manaRegen: 1.4,
    // The smallest body on the roster: a goblin of the brush.
    radius: 0.5,
  },
  growth: { hp: 86, mana: 30, ad: 5.2, armor: 2.1, mr: 1.3 },
  abilities: {
    Q: {
      name: 'Pepper Dart',
      sound: 'sand',
      manaCost: 40,
      cooldown: 7,
      castRange: 8.5,
      // A dart of stinging dust, stopped by the first enemy: magic damage,
      // and the victim fumbles its attacks while its eyes water.
      spec: {
        kind: 'skillshot',
        speed: 24,
        radius: 0.45,
        range: 8.5,
        onHit: [
          { kind: 'damage', base: 62, adRatio: 0.7, apRatio: 0.5, dtype: 'magic' },
          { kind: 'fumble', duration: 1.25 },
        ],
      },
    },
    W: {
      name: 'Hightail',
      sound: 'dash',
      manaCost: 30,
      cooldown: 11,
      castRange: 0,
      spec: {
        kind: 'self_or_ally',
        searchRadius: 0,
        effects: [{ kind: 'buff', duration: 2, msPct: 0.45 }],
      },
    },
    E: {
      name: 'Bittertip',
      sound: 'venom',
      manaCost: 35,
      cooldown: 10,
      castRange: 0,
      // Every dart for five seconds carries the poison; each hit renews it
      // rather than stacking a second one beside it.
      spec: {
        kind: 'self_or_ally',
        searchRadius: 0,
        effects: [
          {
            kind: 'empower',
            duration: 5,
            hits: 99,
            bonus: [
              {
                kind: 'dot',
                duration: 3,
                perSecond: 12,
                adRatio: 0.12,
                apRatio: 0.2,
                dtype: 'magic',
                refresh: true,
              },
            ],
          },
        ],
      },
    },
    R: {
      name: 'Sourpods',
      sound: 'growth',
      manaCost: 50,
      // The beat between two pods; the store of three is the real clock.
      cooldown: 1.5,
      castRange: 6,
      charges: { max: 3, every: 30 },
      spec: {
        kind: 'trap',
        radius: 0.9,
        duration: 180,
        armDelay: 1,
        maxLive: 5,
        burst: {
          radius: 3,
          duration: 3,
          tickEvery: 0.5,
          onEnter: [{ kind: 'damage', base: 70, adRatio: 0.35, apRatio: 0.4, dtype: 'magic' }],
          onTick: [
            { kind: 'damage', base: 10, adRatio: 0.05, apRatio: 0.08, dtype: 'magic' },
            { kind: 'slow', pct: 0.35, duration: 0.75 },
          ],
        },
      },
    },
  },
};
