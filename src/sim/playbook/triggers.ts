// Trigger evaluation: does a play's condition hold this slot? Pure over the
// slot context; no trigger draws randomness or reads anything the team
// cannot see.

import { ROLE_DAMAGE } from '../content/champions';
import type { ObsSeat } from '../policy';
import type { SlotContext } from './micro';
import { fightOdds, ODDS_RADIUS } from './odds';
import type { Side, Trigger } from './types';

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

// The seats a lineup trigger reads: the bot's own team (itself included)
// or the enemy's.
function seatsOf(ctx: SlotContext, side: Side): ObsSeat[] {
  const team = ctx.s.team;
  return (ctx.obs.seats ?? []).filter((seat) => (seat.team === team) === (side === 'own'));
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
    case 'numbers': {
      const allies = obs.units.filter(
        (u) => u.friendly && u.kind === 'champion' && Math.hypot(u.x - s.x, u.z - s.z) <= t.within,
      ).length;
      const enemies = ctx.enemyChampions.filter(
        (u) => Math.hypot(u.x - s.x, u.z - s.z) <= t.within,
      ).length;
      return countWithin(allies + 1 - enemies, t.atLeast, t.atMost);
    }
    case 'odds':
      return within(fightOdds(ctx, t.within ?? ODDS_RADIUS), t.below, t.atLeast);
    case 'minions': {
      const own = t.side === 'own';
      const n = obs.units.filter(
        (u) =>
          u.kind === 'minion' && u.friendly === own && Math.hypot(u.x - s.x, u.z - s.z) <= t.within,
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
    case 'allyFighting':
      return ctx.engagedAllies(t.within).length > 0;
    case 'order': {
      const order = s.coachOrder ?? null;
      return order !== null && (t.is === undefined || order.kind === t.is);
    }
    case 'champion':
      return seatsOf(ctx, t.side).some((seat) => seat.championId === t.is);
    case 'roles':
      return countWithin(
        seatsOf(ctx, t.side).filter((seat) => seat.role === t.role).length,
        t.atLeast,
        t.atMost,
      );
    case 'enemyDamage': {
      const enemy = seatsOf(ctx, 'enemy');
      const magic = enemy.filter((seat) => ROLE_DAMAGE[seat.role] === 'magic').length;
      const physical = enemy.filter((seat) => ROLE_DAMAGE[seat.role] === 'physical').length;
      return t.mostly === 'magic' ? magic > physical : physical > magic;
    }
    case 'enemyItem':
      return obs.units.some(
        (u) => !u.friendly && u.kind === 'champion' && (u.items ?? []).includes(t.item),
      );
    case 'laneOpponent': {
      if (s.lane === null) return false;
      const id = obs.laneOpponents?.[s.lane] ?? null;
      if (id === null) return false;
      return (obs.seats ?? []).some((seat) => seat.id === id && seat.championId === t.is);
    }
    case 'lanePartner':
      return (
        s.lane !== null &&
        seatsOf(ctx, 'own').some(
          (seat) => seat.id !== s.id && seat.lane === s.lane && seat.championId === t.is,
        )
      );
    case 'not':
      return !holds(t.of, ctx);
    case 'all':
      return t.of.every((sub) => holds(sub, ctx));
    case 'any':
      return t.of.some((sub) => holds(sub, ctx));
  }
}
