// The fresh draft: what a new champion is before the creator touches
// anything. Legal out of the box and middle of the road on every stat,
// with a kit that weighs what a roster kit weighs and sits under every
// burst cap with room (the first thing a creator sees should be an
// example of the rules, not a case at their edge). Each envelope is
// spent to roughly four fifths, so the first pull on any polygon moves
// and no rail comes free without dumping another axis. Pure data: the
// id comes from the caller, so this stays deterministic and hostable
// anywhere the sim is.

import type { ForgedChampionDef } from './forged_def';

export function freshDraftDef(id: string): ForgedChampionDef {
  return {
    id,
    name: 'New Champion',
    title: '',
    tagline: '',
    role: 'Fighter',
    creator: '',
    passive: { template: 'battle_flow', params: { msPct: 0.1, duration: 1.5 }, name: 'Momentum' },
    base: {
      hp: 540,
      mana: 350,
      ad: 52,
      ap: 0,
      armor: 24,
      mr: 26,
      attackRange: 5.5,
      attackSpeed: 0.6,
      moveSpeed: 3.65,
      hpRegen: 1.3,
      manaRegen: 1.2,
      radius: 0.65,
    },
    growth: { hp: 85, mana: 35, ad: 3.5, armor: 2.3, mr: 1.3 },
    abilities: {
      Q: {
        name: 'First Strike',
        manaCost: 40,
        cooldown: 4.5,
        castRange: 9,
        spec: {
          kind: 'skillshot',
          speed: 22,
          radius: 0.7,
          range: 9,
          onHit: [
            { kind: 'damage', base: 120, adRatio: 0.8, dtype: 'physical' },
            { kind: 'slow', pct: 0.4, duration: 1.5 },
          ],
        },
      },
      W: {
        name: 'Second Wind',
        manaCost: 50,
        cooldown: 9,
        castRange: 7,
        spec: {
          kind: 'zone',
          radius: 3,
          duration: 3,
          tickEvery: 0.5,
          onEnter: [{ kind: 'slow', pct: 0.45, duration: 2 }],
          onTick: [{ kind: 'damage', base: 18, adRatio: 0.15, dtype: 'magic' }],
          allyOnTick: [{ kind: 'heal', base: 16 }],
        },
      },
      E: {
        name: 'Third Step',
        manaCost: 35,
        cooldown: 7,
        castRange: 4.5,
        spec: {
          kind: 'dash',
          range: 4.5,
          speed: 16,
          landRadius: 1.5,
          onLand: [{ kind: 'damage', base: 80, adRatio: 0.5, dtype: 'physical' }],
          selfEffects: [{ kind: 'buff', duration: 3, asPct: 0.4 }],
          passThrough: [],
        },
      },
      R: {
        name: 'The Answer',
        manaCost: 85,
        cooldown: 60,
        castRange: 8,
        spec: {
          kind: 'zone',
          radius: 3.5,
          duration: 1.5,
          detonateDelay: 1.2,
          onEnter: [{ kind: 'slow', pct: 0.5, duration: 1.5 }],
          onTick: [],
          allyOnTick: [],
          onDetonate: [
            { kind: 'damage', base: 260, adRatio: 1.0, dtype: 'physical' },
            { kind: 'stun', duration: 1.3 },
          ],
        },
      },
    },
  };
}
