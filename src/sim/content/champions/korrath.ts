// Korrath, the Bulwark. Tank (docs/design/kits-v2.md): the fight happens
// where he says it does. W raises a real stone rampart; E's grip stuns
// whoever it slams into terrain (his own rampart included); R is a true
// leap whose epicenter, not its whole footprint, sends enemies airborne.

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
    attackRange: 1.8,
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
      castRange: 4,
      // Instant heavy cone: the slam telegraphs before it lands. Widened
      // and lengthened after the v2 playtest: the old sweep felt like a
      // dagger on a champion this size.
      windup: 0.3,
      spec: {
        kind: 'cone',
        range: 4,
        halfAngle: Math.PI / 3,
        onHit: [
          { kind: 'damage', base: 95, adRatio: 0.4, dtype: 'physical' },
          { kind: 'slow', pct: 0.3, duration: 1.5 },
        ],
      },
    },
    W: {
      // The name finally means it: a stone rampart across the aim, real
      // terrain that blocks walking and dashes for a beat.
      name: 'Iron Wall',
      manaCost: 45,
      cooldown: 11,
      castRange: 7,
      spec: { kind: 'wall', length: 4, duration: 6 },
    },
    E: {
      // A maul slam that sends a fissure of grasping stone along the ground.
      // A target dragged into contact with terrain (map rock or his own
      // rampart) is stunned: the wall and the grip are one kit.
      name: 'Earthgrip',
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
          // Evaluated BEFORE the pull: gripping someone who stands against
          // terrain crushes them into it first, then drags.
          {
            kind: 'conditional',
            when: { kind: 'targetNearTerrain', distance: 1.1 },
            effects: [{ kind: 'stun', duration: 0.75 }],
          },
          { kind: 'pull', distance: 6 },
        ],
      },
    },
    R: {
      name: 'Earthbreak',
      manaCost: 85,
      cooldown: 67.5,
      castRange: 6.5,
      windup: 0.4,
      // A true leap with air time and a telegraphed landing: the epicenter
      // sends enemies airborne, the rim only slows. Aim is the skill.
      spec: {
        kind: 'dash',
        range: 6.5,
        speed: 14,
        landRadius: 3,
        onLand: [
          {
            kind: 'conditional',
            when: { kind: 'withinCenter', radius: 1.5 },
            effects: [
              { kind: 'damage', base: 203, adRatio: 0.5, dtype: 'magic' },
              { kind: 'knockup', duration: 1.0 },
            ],
            otherwise: [
              { kind: 'damage', base: 120, adRatio: 0.35, dtype: 'magic' },
              { kind: 'slow', pct: 0.4, duration: 1.5 },
            ],
          },
        ],
      },
    },
  },
};
