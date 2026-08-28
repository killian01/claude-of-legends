// Vesk, the Longshot. Artillery marksman (docs/design/kits-v2.md): distance
// IS damage. Q and R scale with the distance flown, so point-blank shots
// are mistakes and max-range shots the reward; E's vault leaves caltrops at
// the launch point (passive onCast, spawned at the pre-vault position).

import { isRooted, slowPct } from '../../combat/status';
import type { ChampionDef } from './index';

const DEADSTILL_BONUS = 1.15;
const BACKSTEP_PATCH_RADIUS = 1.5;
const BACKSTEP_PATCH_DURATION_S = 1.5;

export const VESK: ChampionDef = {
  id: 'vesk',
  name: 'Vesk, the Longshot',
  role: 'Marksman',
  blurb: 'Artillery range, immobile and terrifying: punishes anything held still.',
  passive: {
    name: 'Deadstill',
    description: 'Attacks deal 15 percent bonus damage to slowed or immobilized targets.',
    modifyDamage(ctx, _self, target, amount, _dtype, via) {
      if (via !== 'attack') return amount;
      if (slowPct(target, ctx.time) <= 0 && !isRooted(target, ctx.time)) return amount;
      return amount * DEADSTILL_BONUS;
    },
    // Backstep scatters caltrops where the vault began: kiting leaves a
    // trace that feeds Deadstill. onCast fires before the dash launches, so
    // self.pos is still the launch point.
    onCast(ctx, self, key) {
      if (key !== 'E') return;
      const tickEvery = 0.5;
      const id = ctx.allocId();
      ctx.zones.set(id, {
        id,
        sourceId: self.id,
        team: self.team,
        pos: { x: self.pos.x, z: self.pos.z },
        radius: BACKSTEP_PATCH_RADIUS,
        until: ctx.time + BACKSTEP_PATCH_DURATION_S,
        tickEvery,
        nextTickAt: ctx.time + tickEvery,
        power: { ad: self.stats.ad, ap: self.stats.ap },
        onEnter: [],
        onTick: [{ kind: 'slow', pct: 0.35, duration: 1 }],
        allyOnTick: [],
        detonateAt: null,
        onDetonate: [],
        entered: new Set(),
        reveal: false,
        boundary: null,
        boundaryNextAt: new Map(),
        insideIds: new Set(),
        leaveZone: null,
        vfx: 'vesk_W',
      });
    },
  },
  base: {
    hp: 540,
    mana: 300,
    ad: 60,
    ap: 0,
    armor: 22,
    mr: 30,
    attackRange: 6.2,
    attackSpeed: 0.66,
    moveSpeed: 3.55,
    hpRegen: 1.3,
    manaRegen: 1.4,
    radius: 0.6,
  },
  growth: { hp: 88, mana: 32, ad: 5.5, armor: 2, mr: 1.3 },
  abilities: {
    Q: {
      name: 'Piercing Round',
      manaCost: 45,
      cooldown: 6,
      castRange: 14,
      // The marksman shoulders his rifle before the shot: a short windup
      // that telegraphs the line and lets the target step off it.
      windup: 0.3,
      // Damage grows with the distance flown: about +50 percent past 8.5.
      spec: {
        kind: 'skillshot',
        speed: 30,
        radius: 0.5,
        range: 14,
        pierce: true,
        onHit: [
          { kind: 'damage', base: 55, adRatio: 1.15, dtype: 'physical' },
          {
            kind: 'conditional',
            when: { kind: 'distanceAtLeast', distance: 8.5 },
            effects: [{ kind: 'damage', base: 28, adRatio: 0.57, dtype: 'physical' }],
          },
        ],
      },
    },
    W: {
      name: 'Caltrops',
      manaCost: 50,
      cooldown: 9,
      castRange: 8,
      spec: {
        kind: 'zone',
        radius: 3,
        duration: 3,
        tickEvery: 0.5,
        onTick: [
          { kind: 'slow', pct: 0.35, duration: 1 },
          { kind: 'damage', base: 9, adRatio: 0.19, dtype: 'physical' },
        ],
      },
    },
    E: {
      name: 'Backstep',
      manaCost: 35,
      cooldown: 7.5,
      castRange: 3,
      // A real vault (caltrops land at the launch point via the passive).
      spec: {
        kind: 'dash',
        range: 3,
        speed: 16,
        selfEffects: [{ kind: 'buff', duration: 3, asPct: 0.5 }],
      },
    },
    R: {
      name: 'Horizon Shot',
      manaCost: 85,
      cooldown: 67.5,
      // Map-crossing artillery (the map is 150 across): the shot itself is
      // the fantasy, so the range covers anything Vesk can draw a line to.
      // The payoff is distance-tiered: a close shot only slows, a long one
      // stuns, the longest stuns hard. The counterplay window (windup plus
      // flight time) grows exactly as the payoff does.
      castRange: 120,
      windup: 0.6,
      spec: {
        kind: 'skillshot',
        speed: 40,
        radius: 0.9,
        range: 120,
        onHit: [
          {
            kind: 'conditional',
            when: { kind: 'distanceAtLeast', distance: 80 },
            effects: [
              { kind: 'damage', base: 220, adRatio: 1.9, dtype: 'physical' },
              { kind: 'stun', duration: 1.5 },
            ],
            otherwise: [
              {
                kind: 'conditional',
                when: { kind: 'distanceAtLeast', distance: 30 },
                effects: [
                  { kind: 'damage', base: 220, adRatio: 1.9, dtype: 'physical' },
                  { kind: 'stun', duration: 0.75 },
                ],
                otherwise: [
                  { kind: 'damage', base: 180, adRatio: 1.4, dtype: 'physical' },
                  { kind: 'slow', pct: 0.5, duration: 2 },
                ],
              },
            ],
          },
        ],
      },
    },
  },
};
