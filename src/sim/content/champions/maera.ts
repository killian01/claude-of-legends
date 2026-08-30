// Maera, Tidecaller. Healing support (docs/design/kits-v2.md): the tide
// gives and takes in the same wave. W triages (double healing under 40
// percent); R finally honors the roster promise and SWEEPS enemies aside,
// lateral to the wave, while shielding the allies it passes.

import { healFactor } from '../../combat/status';
import type { ChampionDef } from './index';

const SPRING_TIDE_RATIO = 0.35;
const SPRING_TIDE_RANGE = 6;

export const MAERA: ChampionDef = {
  id: 'maera',
  name: 'Maera, Tidecaller',
  role: 'Support',
  blurb: 'Sustain and wave-shaped utility: keeps the team standing.',
  passive: {
    name: 'Spring Tide',
    description: 'Her heals splash 35 percent of the amount onto the nearest other ally.',
    onHealGiven(ctx, self, target, amount) {
      let best: typeof target | null = null;
      let bestD = SPRING_TIDE_RANGE;
      for (const u of ctx.units.values()) {
        if (u.kind !== 'champion' || u.team !== self.team) continue;
        if (u.id === target.id || u.id === self.id || u.dead || ctx.dead.has(u.id)) continue;
        const d = Math.hypot(u.pos.x - target.pos.x, u.pos.z - target.pos.z);
        if (d < bestD) {
          bestD = d;
          best = u;
        }
      }
      if (!best) return;
      const splash = amount * SPRING_TIDE_RATIO * healFactor(best, ctx.time);
      best.hp = Math.min(best.maxHp, best.hp + splash);
    },
  },
  base: {
    hp: 550,
    mana: 500,
    ad: 48,
    ap: 0,
    armor: 24,
    mr: 32,
    attackRange: 5.75,
    attackSpeed: 0.6,
    moveSpeed: 3.65,
    hpRegen: 1.4,
    manaRegen: 1.9,
    radius: 0.62,
  },
  growth: { hp: 85, mana: 50, ad: 2.5, armor: 2.3, mr: 1.5 },
  abilities: {
    Q: {
      name: 'Tide Surge',
      manaCost: 50,
      cooldown: 7,
      castRange: 9,
      spec: {
        kind: 'skillshot',
        speed: 20,
        radius: 1.0,
        range: 9,
        pierce: true,
        onHit: [{ kind: 'damage', base: 62, apRatio: 0.95, dtype: 'magic' }],
        allyEffects: [{ kind: 'heal', base: 60, apRatio: 0.4 }],
      },
    },
    W: {
      name: 'Rising Spring',
      manaCost: 60,
      cooldown: 10,
      castRange: 8,
      // Triage made legible: allies under 40 percent health heal double.
      spec: {
        kind: 'zone',
        radius: 3,
        duration: 4,
        tickEvery: 0.5,
        allyOnTick: [
          {
            kind: 'conditional',
            when: { kind: 'targetHpBelow', frac: 0.4 },
            effects: [{ kind: 'heal', base: 36, apRatio: 0.24 }],
            otherwise: [{ kind: 'heal', base: 18, apRatio: 0.12 }],
          },
        ],
      },
    },
    E: {
      name: 'Undertow',
      manaCost: 45,
      cooldown: 7,
      castRange: 8,
      spec: {
        kind: 'skillshot',
        speed: 18,
        radius: 0.9,
        range: 8,
        pierce: true,
        onHit: [
          { kind: 'damage', base: 44, apRatio: 0.66, dtype: 'magic' },
          { kind: 'slow', pct: 0.35, duration: 1.5 },
        ],
      },
    },
    R: {
      name: 'Great Wave',
      manaCost: 85,
      cooldown: 67.5,
      castRange: 10,
      windup: 0.5,
      // The peel ultimate: the wave sweeps enemies OFF its path (aside,
      // not airborne) and shields the allies it washes over.
      spec: {
        kind: 'skillshot',
        speed: 16,
        radius: 1.6,
        range: 10,
        pierce: true,
        onHit: [
          { kind: 'damage', base: 132, apRatio: 1.14, dtype: 'magic' },
          { kind: 'knockback', distance: 2.5, direction: 'aside' },
        ],
        allyEffects: [{ kind: 'shield', base: 150, apRatio: 0.5, duration: 3 }],
      },
    },
  },
};
