// Builds one team-scoped snapshot for one client. The fog of war is enforced
// HERE: what never reaches the wire can never be maphacked. Identity fields
// go out once per unit per client, tracked by the caller-owned `known` set;
// a unit leaving vision lands in `gone` and is re-sent full when it returns.

import type {
  SelfSnap,
  ServerMsg,
  SnapEvent,
  SnapMobile,
  SnapUnit,
  SnapWall,
} from '../src/net/protocol';
import { unrootedMoveSpeed } from '../src/sim/combat/status';
import { hasAnyFavor } from '../src/sim/favors';
import type { Projectile } from '../src/sim/projectiles';
import type { Sim, SimEvent } from '../src/sim/sim';
import { effectiveRank } from '../src/sim/stats';
import { otherTeam, TWO_TEAMS } from '../src/sim/teams';
import type { AbilityKey, TeamId } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';
import type { Wall } from '../src/sim/walls';
import type { Zone } from '../src/sim/zones';

export const round2 = (n: number): number => Math.round(n * 100) / 100;

// The most of its path the own champion is told each snapshot: the
// prediction re-walks it for a fraction of a second, and a path the
// search smoothed seldom has more than a handful of corners.
export const PATH_SENT_MAX = 16;

// The seat's orders as the server applied them (server/match.ts): the
// number of the last one and the match time it landed, for the client's
// prediction (src/net/self_predict.ts).
export interface SeatAck {
  ack: number;
  ackAt: number;
}

export const NO_ACK: SeatAck = { ack: 0, ackAt: 0 };

// Display-relevant statuses carried on every visible unit: crowd control,
// the total mark stacks (Sylra's thorns, Elowen's mist) so a marked victim
// can SEE the trigger building, and live shields so every health bar can
// draw the grey overlay, both teams alike.
export function ccChips(u: Unit, time: number): { k: string; v?: number }[] {
  const out: { k: string; v?: number }[] = [];
  let markStacks = 0;
  for (const s of u.statuses) {
    if (s.until <= time) continue;
    // A stealthed unit reaches only its own team's snapshots (an enemy
    // never sees it at all): what draws the shimmer on a hidden ally.
    if (
      s.kind === 'stun' ||
      s.kind === 'root' ||
      s.kind === 'recall' ||
      s.kind === 'airborne' ||
      s.kind === 'untargetable' ||
      s.kind === 'fumble' ||
      s.kind === 'stealth'
    ) {
      out.push({ k: s.kind });
    } else if (s.kind === 'slow') out.push({ k: 'slow', v: round2(s.pct) });
    else if (s.kind === 'shield' && s.remaining > 0)
      out.push({ k: 'shield', v: Math.round(s.remaining) });
    else if (s.kind === 'mark') markStacks += s.stacks;
  }
  if (markStacks > 0) out.push({ k: 'mark', v: markStacks });
  return out;
}

export function statusValue(s: Unit['statuses'][number]): number | undefined {
  switch (s.kind) {
    case 'slow':
      return round2(s.pct);
    case 'shield':
      return Math.round(s.remaining);
    case 'mark':
      return s.stacks;
    case 'dot':
      return s.perSecond;
    case 'grievous':
      return round2(s.factor);
    // The health still to drink, so the client knows the draught runs.
    case 'draught':
      return Math.ceil(s.left);
    default:
      return undefined;
  }
}

// One unit's record for a viewer on `team`: the lite fields every
// snapshot, y beside x and z on the planet's sphere, and the identity block
// when the viewer's `known` set does not hold the unit yet (it is added).
export function unitRecord(u: Unit, time: number, team: number, known: Set<number>): SnapUnit {
  const snap: SnapUnit = {
    i: u.id,
    x: round2(u.pos.x),
    z: round2(u.pos.z),
    h: Math.round(u.hp),
    m: Math.round(u.maxHp),
  };
  if (u.pos.y !== undefined) snap.y = round2(u.pos.y);
  if (u.kind === 'champion') snap.l = u.level;
  if (u.dead) snap.d = 1;
  const cc = ccChips(u, time);
  if (cc.length > 0) snap.st = cc;
  // Windup telegraph: while a champion charges a cast, everyone who can
  // see the champion also sees what is coming and where.
  if (u.pendingSpell) {
    snap.w = {
      k: u.pendingSpell.key,
      x: round2(u.pendingSpell.aim.x),
      z: round2(u.pendingSpell.aim.z),
      u: round2(u.pendingSpell.resolveAt),
    };
    if (u.pendingSpell.aim.y !== undefined) snap.w.y = round2(u.pendingSpell.aim.y);
  }
  // The active play of an allied bot: what it is doing, for the overlay.
  // Team-scoped, like chat and pings.
  if (u.play !== null && u.team === team) snap.p = u.play;
  if (u.coachOrder !== null && u.team === team) snap.co = u.coachOrder;
  if (!known.has(u.id)) {
    known.add(u.id);
    snap.k = u.kind;
    snap.t = u.team;
    snap.c = u.championId;
    if (u.kind === 'champion') snap.sk = u.skin;
    snap.r = u.radius;
    snap.rg = u.stats.attackRange;
    if (u.structure) snap.s = u.structure;
    if (u.kind === 'creature' && u.creatureId) {
      snap.cr = u.creatureId;
      if (u.aspect) snap.a = u.aspect;
      if (u.ascendant) snap.asc = 1;
    }
    if (u.kind === 'camp' && u.campKind) snap.ck = u.campKind;
  }
  return snap;
}

// A projectile's record, y on the sphere; the homing victim only when the
// viewer sees it (a homing target in the fog would name a unit the team has
// no sight of).
export function projectileRecord(p: Projectile, seesUnit: (id: number) => boolean): SnapMobile {
  const rec: SnapMobile = {
    i: p.id,
    x: round2(p.pos.x),
    z: round2(p.pos.z),
    r: p.radius,
    t: p.team,
  };
  if (p.pos.y !== undefined) rec.y = round2(p.pos.y);
  if (p.vfx) rec.v = p.vfx;
  if (p.sourceId) rec.s = p.sourceId;
  if (p.homingTargetId !== null && seesUnit(p.homingTargetId)) rec.h = p.homingTargetId;
  return rec;
}

export function zoneRecord(z: Zone): SnapMobile {
  const rec: SnapMobile = {
    i: z.id,
    x: round2(z.pos.x),
    z: round2(z.pos.z),
    r: z.radius,
    t: z.team,
  };
  if (z.pos.y !== undefined) rec.y = round2(z.pos.y);
  if (z.vfx) rec.v = z.vfx;
  return rec;
}

export function wallRecord(w: Wall): SnapWall {
  const rec: SnapWall = {
    i: w.id,
    x1: round2(w.a.x),
    z1: round2(w.a.z),
    x2: round2(w.b.x),
    z2: round2(w.b.z),
    t: w.team,
    u: round2(w.until),
  };
  if (w.a.y !== undefined) rec.y1 = round2(w.a.y);
  if (w.b.y !== undefined) rec.y2 = round2(w.b.y);
  return rec;
}

// The charge stores on the self block, absent for a kit with none.
function chargesRecord(u: Unit): Pick<SelfSnap, 'ch'> {
  const ch: NonNullable<SelfSnap['ch']> = {};
  let any = false;
  for (const [key, st] of Object.entries(u.charges)) {
    if (!st) continue;
    ch[key as AbilityKey] = [st.count, round2(st.nextAt)];
    any = true;
  }
  return any ? { ch } : {};
}

// The own champion's block, what every host tells its seat alike: the
// numbers the HUD draws and what the prediction walks on. `path` sends the
// path still to walk as x, z pairs (the plane's prediction reads it).
export function selfRecord(u: Unit, time: number, seat: SeatAck, path = true): SelfSnap {
  const self: SelfSnap = {
    mana: Math.round(u.mana),
    maxMana: Math.round(u.maxMana),
    ad: Math.round(u.stats.ad),
    gold: Math.floor(u.gold),
    level: u.level,
    xp: Math.round(u.xp),
    dead: u.dead,
    respawnAt: round2(u.respawnAt),
    cooldowns: { ...u.cooldowns },
    ...chargesRecord(u),
    // Effective ranks: R already reads 1 at level 6 pre-investment.
    abilityRanks: {
      Q: effectiveRank(u, 'Q'),
      W: effectiveRank(u, 'W'),
      E: effectiveRank(u, 'E'),
      R: effectiveRank(u, 'R'),
    },
    skillPoints: u.skillPoints,
    sigilCooldowns: [...u.sigilCooldowns],
    items: [...u.items],
    sigils: [...u.sigils],
    statuses: u.statuses
      .filter((s) => s.until > time)
      .map((s) => ({ k: s.kind, until: round2(s.until), v: statusValue(s) })),
    // What the HUD tells the player (ADR 0026): the self block only, so
    // the other team never learns where this seat plays.
    lane: u.lane,
    ms: round2(unrootedMoveSpeed(u, time)),
    rg: round2(u.stats.attackRange),
    ack: seat.ack,
    ackAt: round2(seat.ackAt),
  };
  if (path && u.path.length > 0) {
    self.path = u.path.slice(0, PATH_SENT_MAX).flatMap((p) => [round2(p.x), round2(p.z)]);
  }
  if (u.attackTargetId !== null) self.tgt = u.attackTargetId;
  if (u.activeDash) self.dash = 1;
  return self;
}

export function buildSnapshot(
  sim: Sim,
  team: TeamId,
  selfUnitId: number,
  known: Set<number>,
  events: readonly SimEvent[],
  seat: SeatAck = NO_ACK,
): ServerMsg {
  const units: SnapUnit[] = [];
  const visibleNow = new Set<number>();
  const knownBefore = new Set(known);
  for (const u of sim.units.values()) {
    if (!sim.isVisible(team, u.id)) continue;
    visibleNow.add(u.id);
    units.push(unitRecord(u, sim.time, team, known));
  }

  const gone: number[] = [];
  for (const id of known) {
    if (!visibleNow.has(id)) {
      gone.push(id);
      known.delete(id);
    }
  }

  // Fog-scoped: an enemy projectile or zone only ships while its position
  // is inside the team's sight (review F.2: unfiltered projectiles were a
  // maphack vector).
  const seesUnit = (id: number): boolean => sim.isVisible(team, id);
  const projectiles: SnapMobile[] = [];
  for (const p of sim.projectiles.values()) {
    if (p.team !== team && !sim.isPointVisible(team, p.pos.x, p.pos.z, p.pos.y)) continue;
    projectiles.push(projectileRecord(p, seesUnit));
  }
  const zones: SnapMobile[] = [];
  for (const z of sim.zones.values()) {
    // An enemy pod only while a champion of the team stands close (the
    // one rule, Sim.zoneSeen, the bots' observation reads too).
    if (!sim.zoneSeen(team, z)) continue;
    zones.push(zoneRecord(z));
  }
  // Walls are terrain: both teams always see them (they block everyone's
  // pathing), so they never fog-scope.
  const walls: SnapWall[] = [];
  for (const w of sim.walls.values()) walls.push(wallRecord(w));

  let self: SelfSnap | null = null;
  const selfUnit = sim.units.get(selfUnitId);
  if (selfUnit) {
    self = selfRecord(selfUnit, sim.time, seat);
    const boon = sim.teamBuff(team);
    if (boon) {
      self.boonUntil = round2(boon.until);
      self.boonStacks = boon.stacks;
    }
    // The enemy's side of each is the other team's, a 5v5 fact (ADR 0030).
    const enemy = sim.teamCount === TWO_TEAMS ? otherTeam(team) : null;
    const enemyBoon = enemy === null ? null : sim.teamBuff(enemy);
    if (enemyBoon) {
      self.enemyBoonUntil = round2(enemyBoon.until);
      self.enemyBoonStacks = enemyBoon.stacks;
    }
    const wrath = sim.teamWrath(team);
    if (wrath !== null) self.wrathUntil = round2(wrath);
    const enemyWrath = enemy === null ? null : sim.teamWrath(enemy);
    if (enemyWrath !== null) self.enemyWrathUntil = round2(enemyWrath);
    const favors = sim.teamFavors(team);
    if (hasAnyFavor(favors)) self.favors = favors;
    const enemyFavors = enemy === null ? null : sim.teamFavors(enemy);
    if (enemyFavors && hasAnyFavor(enemyFavors)) self.enemyFavors = enemyFavors;
  }

  const snapEvents: SnapEvent[] = [];
  for (const ev of events) {
    if (ev.type === 'death') {
      // Champion deaths are global (the kill feed, genre standard); other
      // deaths only reach clients that could see the unit.
      const victim = sim.units.get(ev.unitId);
      const isChampion = victim?.kind === 'champion';
      if (isChampion || knownBefore.has(ev.unitId)) {
        snapEvents.push({ e: 'death', unitId: ev.unitId, killerId: ev.killerId });
      }
    } else if (ev.type === 'gold' && ev.unitId === selfUnitId) {
      // Personal: your own last-hit and kill income only.
      snapEvents.push({ e: 'gold', amount: ev.amount });
    } else if (ev.type === 'damage' && ev.sourceId === selfUnitId && ev.targetId !== selfUnitId) {
      // Personal: only the damage YOU deal travels, for your own numbers.
      snapEvents.push({ e: 'dmg', targetId: ev.targetId, amount: Math.round(ev.amount) });
    } else if (ev.type === 'cast' && sim.isVisible(team, ev.unitId)) {
      snapEvents.push({ e: 'cast', unitId: ev.unitId, k: ev.key });
    } else if (ev.type === 'sigil' && sim.isVisible(team, ev.unitId)) {
      // Sigils relay as keyless casts: the flash and pulse still show.
      snapEvents.push({ e: 'cast', unitId: ev.unitId });
    } else if (ev.type === 'attack' && sim.isVisible(team, ev.unitId)) {
      snapEvents.push({ e: 'atk', unitId: ev.unitId, targetId: ev.targetId });
    } else if (
      ev.type === 'miss' &&
      (sim.isVisible(team, ev.unitId) || sim.isVisible(team, ev.targetId))
    ) {
      snapEvents.push({ e: 'miss', unitId: ev.unitId, targetId: ev.targetId });
    } else if (ev.type === 'victory') {
      snapEvents.push({ e: 'victory', team: ev.team });
    }
  }

  return {
    t: 'snap',
    time: round2(sim.time),
    units,
    gone,
    projectiles,
    zones,
    walls,
    self,
    events: snapEvents,
    winner: sim.winner,
    objAt: sim.objectiveSpawnAt(),
    // The live Warden's pit; nothing before the rise (ADR 0023).
    ...(sim.objectives.wardenId !== null ? { objPit: sim.objectives.pit } : {}),
    rings: sim.ringClocks().map((c) => ({
      r: c.ring,
      u: c.unitId,
      at: c.riseAt,
      a: c.aspect,
      ...(c.ascendant ? { asc: 1 as const } : {}),
      ...(c.roseAt !== null ? { ro: round2(c.roseAt) } : {}),
    })),
  };
}
