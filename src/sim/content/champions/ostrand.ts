// Ostrand, the Pledgeblade. Fighter (docs/design/ostrand.md): a knight who
// names one enemy champion, the Sworn (sworn.ts), and will not let go. Q
// thrusts down a line and slows the Sworn hardest; W plants a banner that
// hardens allies and reveals enemies; E throws a gauntlet that swears
// whoever it strikes; R raises the Oathfield (oathfield.ts), a ring of
// stone nobody walks or dashes across, around him and his Sworn.
// Not yet dealt anywhere: `released: false` keeps him out of every pick.

import { refreshBuff } from '../../combat/status';
import { dist } from '../../geo';
import { isSwornBy, swear, swornOf } from '../../sworn';
import { hostile } from '../../unit';
import type { ChampionDef } from './index';

// Toward the Sworn: the stride while it is this near, and its share.
export const SWORN_STRIDE_REACH = 8;
export const SWORN_STRIDE_PCT = 0.15;
// Against the Sworn: the share his attacks and spells add.
export const SWORN_DAMAGE_PCT = 0.1;
// A takedown on the Sworn heals this share of his missing health.
export const SWORN_TAKEDOWN_HEAL = 0.12;

export const OSTRAND: ChampionDef = {
  id: 'ostrand',
  name: 'Ostrand, the Pledgeblade',
  role: 'Fighter',
  blurb: 'A duelist who names one enemy and rings the two of them in stone.',
  released: false,
  passive: {
    name: 'Sworn',
    description:
      'The first enemy champion he damages becomes his Sworn for 8 seconds, renewed by every ' +
      'hit. He moves faster near his Sworn and deals it more damage; a takedown on it heals ' +
      'him and refreshes Lance Drive.',
    modifyDamage(ctx, self, target, amount) {
      if (target.kind !== 'champion' || !hostile(self, target)) return amount;
      swear(ctx, self, target, false);
      return isSwornBy(target, self.id, ctx.time) ? amount * (1 + SWORN_DAMAGE_PCT) : amount;
    },
    onTick(ctx, self) {
      const sworn = swornOf(ctx, self);
      if (!sworn || dist(self.pos, sworn.pos) > SWORN_STRIDE_REACH) return;
      // Four checks a second: the stride outlasts the gap between two.
      refreshBuff(self, ctx.time, 0.3, { msPct: SWORN_STRIDE_PCT });
    },
    onTakedown(ctx, self, victim) {
      if (!isSwornBy(victim, self.id, ctx.time)) return;
      self.hp = Math.min(self.maxHp, self.hp + (self.maxHp - self.hp) * SWORN_TAKEDOWN_HEAL);
      self.cooldowns.Q = ctx.time;
    },
  },
  base: {
    hp: 640,
    mana: 280,
    ad: 60,
    ap: 0,
    armor: 30,
    mr: 30,
    attackRange: 2.0,
    attackSpeed: 0.66,
    moveSpeed: 3.7,
    hpRegen: 2.1,
    manaRegen: 1.1,
    radius: 0.7,
  },
  growth: { hp: 98, mana: 28, ad: 3.6, armor: 2.8, mr: 1.8 },
  abilities: {
    Q: {
      // A fast thrust down a short line: everyone on it, the Sworn slowed
      // hardest. The damage lands first, so a first thrust that names the
      // Sworn already slows it as one.
      name: 'Lance Drive',
      manaCost: 30,
      cooldown: 6,
      castRange: 4.5,
      spec: {
        kind: 'skillshot',
        speed: 40,
        radius: 0.6,
        range: 4.5,
        pierce: true,
        onHit: [
          { kind: 'damage', base: 65, adRatio: 0.8, dtype: 'physical' },
          {
            kind: 'conditional',
            when: { kind: 'targetSworn' },
            effects: [{ kind: 'slow', pct: 0.4, duration: 1 }],
            otherwise: [{ kind: 'slow', pct: 0.25, duration: 1 }],
          },
        ],
      },
    },
    W: {
      // A banner at his feet that stays where it stands: allies under it
      // are harder to hurt, enemies under it are seen.
      name: 'Standard',
      manaCost: 50,
      cooldown: 16,
      castRange: 0,
      spec: {
        kind: 'zone',
        radius: 3.5,
        duration: 4,
        tickEvery: 0.5,
        reveal: true,
        allyOnTick: [{ kind: 'buff', duration: 0.5, armor: 15, mr: 15 }],
      },
    },
    E: {
      // A thrown gauntlet: the first enemy champion struck is sworn, over
      // any Sworn he held. Pressed again within 3 s he charges at the
      // Sworn, and a wall or a cliff stops him like any dash.
      name: 'Gauntlet Throw',
      manaCost: 40,
      cooldown: 12,
      castRange: 9,
      recast: { window: 3, toSworn: { speed: 18, range: 11 } },
      spec: {
        kind: 'skillshot',
        speed: 24,
        radius: 0.6,
        range: 9,
        onHit: [
          { kind: 'damage', base: 40, adRatio: 0.3, dtype: 'physical' },
          { kind: 'conditional', when: { kind: 'targetIsChampion' }, effects: [{ kind: 'swear' }] },
        ],
      },
    },
    R: {
      name: 'Oathfield',
      manaCost: 100,
      cooldown: 100,
      castRange: 4.5,
      // Inside his ring he takes a fifth less from champions outside it.
      spec: { kind: 'oathfield', reach: 4.5, radius: 5, duration: 4, guard: 0.2 },
      atRank: [
        { rank: 2, spec: { kind: 'oathfield', reach: 4.5, radius: 5, duration: 4.5, guard: 0.2 } },
        { rank: 3, spec: { kind: 'oathfield', reach: 4.5, radius: 5, duration: 5, guard: 0.2 } },
      ],
    },
  },
};
