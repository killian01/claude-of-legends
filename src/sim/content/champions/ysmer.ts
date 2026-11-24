// Ysmer, the Turnlamp. Support (docs/design/ysmer.md): a hooded
// lamplighter who trades places (combat/swap.ts). Q is a slowing bolt of
// lamplight; W hangs a lantern at her feet that mends allies and shows
// enemies, and pressed again she is back beside it; E throws a spark that
// trades her with the enemy champion it strikes; R, In My Stead, reaches
// any champion near the aim: an ally is traded out of harm and shielded,
// an enemy is traded into hers and held. Homeward Glow speeds the
// wounded around her.

import { refreshBuff } from '../../combat/status';
import { dist } from '../../geo';
import { hostile } from '../../unit';
import type { ChampionDef } from './index';

// Homeward Glow: champions of her side (herself too) within this reach and
// under this share of their health move this much faster.
export const GLOW_REACH = 6;
export const GLOW_HP_FRAC = 0.35;
export const GLOW_MS_PCT = 0.2;
// Just over the 0.25 s passive tick so the stride never flickers off.
const GLOW_S = 0.4;

export const YSMER: ChampionDef = {
  id: 'ysmer',
  name: 'Ysmer, the Turnlamp',
  role: 'Support',
  blurb: 'A hooded lamplighter who trades places: a friend pulled out, a foe pulled in.',
  released: false,
  passive: {
    name: 'Homeward Glow',
    description:
      'Ysmer and allied champions within 6 of her move 20 percent faster while under 35 ' +
      'percent health.',
    onTick(ctx, self) {
      for (const u of ctx.units.values()) {
        if (u.kind !== 'champion' || u.neutral || u.dead || ctx.dead.has(u.id)) continue;
        if (u.team !== self.team || hostile(self, u)) continue;
        if (u.maxHp <= 0 || u.hp / u.maxHp >= GLOW_HP_FRAC) continue;
        if (dist(self.pos, u.pos) > GLOW_REACH) continue;
        refreshBuff(u, ctx.time, GLOW_S, { msPct: GLOW_MS_PCT });
      }
    },
  },
  base: {
    hp: 560,
    mana: 420,
    ad: 46,
    ap: 0,
    armor: 24,
    mr: 30,
    attackRange: 5.5,
    attackSpeed: 0.62,
    moveSpeed: 3.65,
    hpRegen: 1.4,
    manaRegen: 1.8,
    radius: 0.6,
  },
  growth: { hp: 86, mana: 40, ad: 2.6, armor: 2.4, mr: 1.5 },
  abilities: {
    Q: {
      name: 'Wick Shot',
      manaCost: 50,
      cooldown: 7,
      castRange: 9,
      spec: {
        kind: 'skillshot',
        speed: 22,
        radius: 0.6,
        range: 9,
        onHit: [
          { kind: 'damage', base: 70, apRatio: 0.7, dtype: 'magic' },
          { kind: 'slow', pct: 0.2, duration: 1.5 },
        ],
      },
    },
    W: {
      // A lantern hung at her feet: allies under it mend, enemies under it
      // are seen. Pressed again within its life she is back beside it.
      name: 'Hung Lantern',
      manaCost: 60,
      cooldown: 14,
      castRange: 0,
      recast: { window: 5, returnBlink: true },
      spec: {
        kind: 'zone',
        radius: 3,
        duration: 5,
        tickEvery: 0.5,
        reveal: true,
        allyOnTick: [{ kind: 'heal', base: 8, apRatio: 0.05 }],
      },
    },
    E: {
      // The first enemy struck takes the spark; a champion trades places
      // with her and is slowed where she stood. A minion in the way takes
      // the spark and nobody moves.
      name: 'Changeling Spark',
      manaCost: 70,
      cooldown: 16,
      castRange: 7.5,
      spec: {
        kind: 'skillshot',
        speed: 20,
        radius: 0.55,
        range: 7.5,
        onHit: [
          { kind: 'damage', base: 55, apRatio: 0.5, dtype: 'magic' },
          {
            kind: 'conditional',
            when: { kind: 'targetIsChampion' },
            effects: [{ kind: 'swap' }, { kind: 'slow', pct: 0.35, duration: 1.25 }],
          },
        ],
      },
    },
    R: {
      // The champion nearest the aim, either side: an ally is taken out of
      // harm and shielded, an enemy is brought into hers and held. Ysmer
      // stands where they stood, under a shield of her own.
      name: 'In My Stead',
      manaCost: 100,
      cooldown: 80,
      castRange: 11,
      spec: {
        kind: 'champion_target',
        searchRadius: 2.5,
        onAlly: [{ kind: 'swap' }, { kind: 'shield', base: 150, apRatio: 0.6, duration: 3 }],
        onEnemy: [{ kind: 'swap' }, { kind: 'root', duration: 1 }],
        selfEffects: [{ kind: 'shield', base: 100, apRatio: 0.4, duration: 2.5 }],
      },
    },
  },
};
