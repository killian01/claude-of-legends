// Torv, Stonehorn. Engage support (docs/design/roster.md). Passive Bulwark
// Aura (armor to nearby allies) is deferred with the passive-hook system.
// His W exercises the taunt primitive.

import { refreshBuff } from '../../combat/status';
import type { ChampionDef } from './index';

const BULWARK_RANGE = 6;
const BULWARK_ARMOR = 8;
// Just over the 0.25 s passive tick so the aura never flickers off.
const BULWARK_DURATION_S = 0.4;

export const TORV: ChampionDef = {
  id: 'torv',
  name: 'Torv, Stonehorn',
  role: 'Support',
  blurb: 'The one who starts the fight: engage, disruption, and a protective aura.',
  passive: {
    name: 'Bulwark Aura',
    description: 'Nearby allied champions gain 8 bonus armor.',
    onTick(ctx, self) {
      for (const u of ctx.units.values()) {
        if (u.kind !== 'champion' || u.team !== self.team || u.dead || ctx.dead.has(u.id)) {
          continue;
        }
        if (Math.hypot(u.pos.x - self.pos.x, u.pos.z - self.pos.z) > BULWARK_RANGE) continue;
        refreshBuff(u, ctx.time, BULWARK_DURATION_S, { armor: BULWARK_ARMOR });
      }
    },
  },
  base: {
    hp: 640,
    mana: 340,
    ad: 56,
    ap: 0,
    armor: 30,
    mr: 32,
    attackRange: 1.25,
    attackSpeed: 0.6,
    moveSpeed: 3.7,
    hpRegen: 2.0,
    manaRegen: 1.3,
    radius: 0.72,
  },
  growth: { hp: 92, mana: 35, ad: 3.2, armor: 3.2, mr: 2 },
  abilities: {
    Q: {
      name: 'Horn Charge',
      manaCost: 45,
      cooldown: 7.5,
      castRange: 5.5,
      windup: 0.25,
      spec: {
        kind: 'dash',
        range: 5.5,
        landRadius: 2,
        onLand: [
          { kind: 'damage', base: 108, adRatio: 0.5, dtype: 'physical' },
          { kind: 'knockup', duration: 0.75 },
        ],
      },
    },
    W: {
      name: 'Challenge',
      manaCost: 50,
      cooldown: 10.5,
      castRange: 0,
      // Hard CC telegraphs itself: the roar is seen before it takes hold.
      windup: 0.25,
      spec: {
        kind: 'burst',
        radius: 3,
        effects: [{ kind: 'taunt', duration: 1.2 }],
      },
    },
    E: {
      name: 'Tremor Stomp',
      manaCost: 40,
      cooldown: 6,
      castRange: 0,
      // The stomp is a heavy instant nuke: it owes its victims a beat.
      windup: 0.3,
      spec: {
        kind: 'burst',
        radius: 3.2,
        effects: [
          { kind: 'damage', base: 81, adRatio: 0.4, dtype: 'magic' },
          { kind: 'slow', pct: 0.3, duration: 1.5 },
        ],
      },
    },
    R: {
      name: 'Faultline',
      manaCost: 85,
      cooldown: 67.5,
      castRange: 9,
      spec: {
        kind: 'skillshot',
        speed: 18,
        radius: 1.2,
        range: 9,
        pierce: true,
        onHit: [
          { kind: 'damage', base: 203, adRatio: 0.6, dtype: 'magic' },
          { kind: 'stun', duration: 1.2 },
        ],
      },
    },
  },
};
