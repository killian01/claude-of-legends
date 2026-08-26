// Korrath, the Bulwark. Tank (docs/design/roster.md).

import { addStatus } from '../../combat/status';
import type { ChampionDef } from './index';

const SHIELDSKIN_CALM_S = 4;
const SHIELDSKIN_BASE = 25;
const SHIELDSKIN_PER_LEVEL = 7;

export const KORRATH: ChampionDef = {
  id: 'korrath',
  name: 'Korrath, the Bulwark',
  role: 'Tank',
  blurb: 'An immovable frontline anchor who soaks damage and locks enemies down.',
  passive: {
    name: 'Shieldskin',
    description: 'After 4 seconds without taking damage, gains a small shield.',
    onTick(ctx, self) {
      if (ctx.time - self.lastDamagedAt < SHIELDSKIN_CALM_S) return;
      if (self.statuses.some((s) => s.kind === 'shield' && s.until > ctx.time)) return;
      addStatus(self, {
        kind: 'shield',
        until: ctx.time + 6,
        remaining: SHIELDSKIN_BASE + SHIELDSKIN_PER_LEVEL * self.level,
      });
    },
  },
  base: {
    hp: 650,
    mana: 320,
    ad: 58,
    ap: 0,
    armor: 32,
    mr: 32,
    attackRange: 1.25,
    attackSpeed: 0.62,
    moveSpeed: 3.65,
    hpRegen: 2.2,
    manaRegen: 1.2,
    radius: 0.75,
  },
  growth: { hp: 95, mana: 35, ad: 3.5, armor: 3.2, mr: 2 },
  abilities: {
    Q: {
      name: 'Shield Slam',
      manaCost: 35,
      cooldown: 4.5,
      castRange: 3,
      spec: {
        kind: 'cone',
        range: 3,
        halfAngle: Math.PI / 3.5,
        onHit: [
          { kind: 'damage', base: 95, adRatio: 0.4, dtype: 'physical' },
          { kind: 'slow', pct: 0.3, duration: 1.5 },
        ],
      },
    },
    W: {
      name: 'Iron Wall',
      manaCost: 45,
      cooldown: 10.5,
      castRange: 0,
      spec: {
        kind: 'self_or_ally',
        searchRadius: 0,
        effects: [{ kind: 'buff', duration: 3, armor: 40, mr: 40 }],
      },
    },
    E: {
      name: 'Grip Chain',
      manaCost: 50,
      cooldown: 9,
      castRange: 8,
      spec: {
        kind: 'skillshot',
        speed: 20,
        radius: 0.6,
        range: 8,
        onHit: [
          { kind: 'damage', base: 81, adRatio: 0.3, dtype: 'physical' },
          { kind: 'pull', distance: 6 },
        ],
      },
    },
    R: {
      name: 'Earthbreak',
      manaCost: 85,
      cooldown: 67.5,
      castRange: 6.5,
      spec: {
        kind: 'dash',
        range: 6.5,
        landRadius: 3,
        onLand: [
          { kind: 'damage', base: 203, adRatio: 0.5, dtype: 'magic' },
          { kind: 'stun', duration: 1.0 },
        ],
      },
    },
  },
};
