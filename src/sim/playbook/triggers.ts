// Trigger evaluation: does a play's condition hold this slot? Pure over the
// slot context; no trigger draws randomness or reads anything the team
// cannot see.

import type { SlotContext } from './micro';
import type { Trigger } from './types';

function within(value: number, below: number | undefined, atLeast: number | undefined): boolean {
  return (below === undefined || value < below) && (atLeast === undefined || value >= atLeast);
}

function countWithin(
  count: number,
  atLeast: number | undefined,
  atMost: number | undefined,
): boolean {
  return (atLeast === undefined || count >= atLeast) && (atMost === undefined || count <= atMost);
}

export function holds(t: Trigger, ctx: SlotContext): boolean {
  const { s, obs } = ctx;
  switch (t.kind) {
    case 'always':
      return true;
    case 'hp':
      return within(s.hpFrac, t.below, t.atLeast);
    case 'mana':
      return within(s.maxMana > 0 ? s.mana / s.maxMana : 1, t.below, t.atLeast);
    case 'level':
      return within(s.level, t.below, t.atLeast);
    case 'gold':
      return within(s.gold, t.below, t.atLeast);
    case 'time':
      return within(obs.time, t.below, t.atLeast);
    case 'enemies': {
      const n = ctx.enemyChampions.filter(
        (u) => Math.hypot(u.x - s.x, u.z - s.z) <= t.within,
      ).length;
      return countWithin(n, t.atLeast, t.atMost);
    }
    case 'allies': {
      const n = obs.units.filter(
        (u) => u.friendly && u.kind === 'champion' && Math.hypot(u.x - s.x, u.z - s.z) <= t.within,
      ).length;
      return countWithin(n, t.atLeast, t.atMost);
    }
    case 'enemyVisible':
      return ctx.champ !== null;
    case 'atFountain':
      return ctx.atFountain;
    case 'underTower':
      return ctx.inTowerReach(s.x, s.z);
    case 'warden': {
      const up = ctx.enemies.some((u) => u.kind === 'warden');
      if (t.state === 'up') return up;
      if (t.state === 'down') return !up;
      if (up || obs.objectiveSpawnAt == null) return false;
      const until = obs.objectiveSpawnAt - obs.time;
      return until >= 0 && until <= (t.within ?? 20);
    }
    case 'abilityReady':
      return s.abilityReady[t.key] === true;
    case 'sigilReady':
      return s.sigils.some((id, i) => id === t.id && s.sigilReady[i] === true);
    case 'lane':
      return s.lane === t.is;
    case 'order': {
      const order = s.coachOrder ?? null;
      return order !== null && (t.is === undefined || order.kind === t.is);
    }
    case 'not':
      return !holds(t.of, ctx);
    case 'all':
      return t.of.every((sub) => holds(sub, ctx));
    case 'any':
      return t.of.some((sub) => holds(sub, ctx));
  }
}
