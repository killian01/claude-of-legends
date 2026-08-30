// Fenn, the Quickblade. Assassin (docs/design/kits-v2.md): in, kill, out,
// with every strike committed and visible. He hunts strays (W's isolation
// bonus), snowballs through takedowns (Q resets), and his R is the roster's
// only recast: commit forward with a banked, budgeted way home (ADR 0005).

import type { ChampionDef } from './index';

const OPPORTUNIST_THRESHOLD = 0.35;
const OPPORTUNIST_BONUS = 1.15;
// A takedown this soon after Fenn damaged the victim resets Lunge.
const LUNGE_RESET_WINDOW_S = 2;

export const FENN: ChampionDef = {
  id: 'fenn',
  name: 'Fenn, the Quickblade',
  role: 'Assassin',
  blurb: 'A single-target executioner who commits hard and finishes low targets.',
  passive: {
    name: 'Opportunist',
    description:
      'Deals 15 percent bonus damage to enemies below 35 percent health. Takedowns on ' +
      'recently struck champions reset Lunge.',
    modifyDamage(_ctx, _self, target, amount) {
      if (target.maxHp <= 0 || target.hp / target.maxHp >= OPPORTUNIST_THRESHOLD) return amount;
      return amount * OPPORTUNIST_BONUS;
    },
    onTakedown(ctx, self, victim) {
      const hit = victim.recentDamagers.find((r) => r.id === self.id);
      if (hit && ctx.time - hit.at <= LUNGE_RESET_WINDOW_S) self.cooldowns.Q = ctx.time;
    },
  },
  base: {
    hp: 560,
    mana: 320,
    ad: 64,
    ap: 0,
    armor: 24,
    mr: 30,
    attackRange: 1.8,
    attackSpeed: 0.7,
    moveSpeed: 3.85,
    hpRegen: 1.6,
    manaRegen: 1.3,
    radius: 0.62,
  },
  growth: { hp: 92, mana: 35, ad: 5.5, armor: 2.2, mr: 1.6 },
  abilities: {
    Q: {
      name: 'Lunge',
      manaCost: 35,
      cooldown: 5.5,
      castRange: 5,
      // A real flight now: visible, interceptable, and reset by takedowns
      // (the passive), the assassin's snowball lever.
      spec: {
        kind: 'dash',
        range: 5,
        speed: 18,
        landRadius: 1.8,
        onLand: [{ kind: 'damage', base: 79, adRatio: 1.52, dtype: 'physical' }],
      },
    },
    W: {
      name: 'Twin Fangs',
      manaCost: 40,
      cooldown: 6,
      castRange: 8,
      // Both fangs bite anyone; a target with no ally nearby takes the
      // hunter's bonus. Fenn wants strays, not teamfights.
      spec: {
        kind: 'skillshot',
        speed: 26,
        radius: 0.5,
        range: 8,
        onHit: [
          { kind: 'damage', base: 40, adRatio: 0.66, dtype: 'physical' },
          { kind: 'damage', base: 40, adRatio: 0.66, dtype: 'physical' },
          {
            kind: 'conditional',
            when: { kind: 'targetIsolated', radius: 4 },
            effects: [{ kind: 'damage', base: 32, adRatio: 0.53, dtype: 'physical' }],
          },
        ],
      },
    },
    E: {
      name: 'Smoke Veil',
      manaCost: 45,
      cooldown: 10.5,
      castRange: 0,
      spec: {
        kind: 'self_or_ally',
        searchRadius: 0,
        effects: [
          { kind: 'stealth', duration: 2.5 },
          { kind: 'buff', duration: 2.5, msPct: 0.25 },
        ],
      },
    },
    R: {
      name: 'Shadow Flurry',
      manaCost: 85,
      cooldown: 56.5,
      castRange: 5.5,
      // The crouch telegraphs, then Fenn blurs down a short line, striking
      // every champion passed, untouchable only while he travels. Pressing
      // R again inside the window blinks him back to where he committed:
      // the banked, budgeted way home (the roster's only recast, ADR 0005).
      windup: 0.35,
      spec: {
        kind: 'dash',
        range: 5.5,
        speed: 14,
        untargetableDuringTravel: true,
        passThrough: [
          {
            kind: 'conditional',
            when: { kind: 'targetIsChampion' },
            effects: [{ kind: 'damage', base: 228, adRatio: 1.9, dtype: 'physical' }],
          },
        ],
      },
      recast: { window: 4, returnBlink: true },
    },
  },
};
