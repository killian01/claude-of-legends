// Builds one team-scoped snapshot for one client. The fog of war is enforced
// HERE: what never reaches the wire can never be maphacked. Identity fields
// go out once per unit per client, tracked by the caller-owned `known` set;
// a unit leaving vision lands in `gone` and is re-sent full when it returns.

import type { SelfSnap, ServerMsg, SnapEvent, SnapMobile, SnapUnit } from '../src/net/protocol';
import type { Sim, SimEvent } from '../src/sim/sim';
import { effectiveRank } from '../src/sim/stats';
import type { TeamId } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';

const round2 = (n: number): number => Math.round(n * 100) / 100;

// Display-relevant crowd control carried on every visible unit.
function ccChips(u: Unit, time: number): { k: string; v?: number }[] {
  const out: { k: string; v?: number }[] = [];
  for (const s of u.statuses) {
    if (s.until <= time) continue;
    if (
      s.kind === 'stun' ||
      s.kind === 'root' ||
      s.kind === 'recall' ||
      s.kind === 'airborne' ||
      s.kind === 'untargetable'
    ) {
      out.push({ k: s.kind });
    } else if (s.kind === 'slow') out.push({ k: 'slow', v: round2(s.pct) });
  }
  return out;
}

function statusValue(s: Unit['statuses'][number]): number | undefined {
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
    default:
      return undefined;
  }
}

export function buildSnapshot(
  sim: Sim,
  team: TeamId,
  selfUnitId: number,
  known: Set<number>,
  events: readonly SimEvent[],
): ServerMsg {
  const units: SnapUnit[] = [];
  const visibleNow = new Set<number>();
  const knownBefore = new Set(known);
  for (const u of sim.units.values()) {
    if (!sim.isVisible(team, u.id)) continue;
    visibleNow.add(u.id);
    const snap: SnapUnit = {
      i: u.id,
      x: round2(u.pos.x),
      z: round2(u.pos.z),
      h: Math.round(u.hp),
      m: Math.round(u.maxHp),
    };
    if (u.kind === 'champion') snap.l = u.level;
    if (u.dead) snap.d = 1;
    const cc = ccChips(u, sim.time);
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
    }
    if (!known.has(u.id)) {
      known.add(u.id);
      snap.k = u.kind;
      snap.t = u.team;
      snap.c = u.championId;
      if (u.kind === 'champion') snap.sk = u.skin;
      snap.r = u.radius;
      snap.rg = u.stats.attackRange;
      if (u.structure) snap.s = u.structure;
    }
    units.push(snap);
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
  const projectiles: SnapMobile[] = [];
  for (const p of sim.projectiles.values()) {
    if (p.team !== team && !sim.isPointVisible(team, p.pos.x, p.pos.z)) continue;
    const rec: SnapMobile = {
      i: p.id,
      x: round2(p.pos.x),
      z: round2(p.pos.z),
      r: p.radius,
      t: p.team,
    };
    if (p.vfx) rec.v = p.vfx;
    projectiles.push(rec);
  }
  const zones: SnapMobile[] = [];
  for (const z of sim.zones.values()) {
    if (z.team !== team && !sim.isPointVisible(team, z.pos.x, z.pos.z)) continue;
    const rec: SnapMobile = {
      i: z.id,
      x: round2(z.pos.x),
      z: round2(z.pos.z),
      r: z.radius,
      t: z.team,
    };
    if (z.vfx) rec.v = z.vfx;
    zones.push(rec);
  }

  let self: SelfSnap | null = null;
  const selfUnit = sim.units.get(selfUnitId);
  if (selfUnit) {
    self = {
      mana: Math.round(selfUnit.mana),
      maxMana: Math.round(selfUnit.maxMana),
      ad: Math.round(selfUnit.stats.ad),
      gold: Math.floor(selfUnit.gold),
      level: selfUnit.level,
      xp: Math.round(selfUnit.xp),
      dead: selfUnit.dead,
      respawnAt: round2(selfUnit.respawnAt),
      cooldowns: { ...selfUnit.cooldowns },
      // Effective ranks: R already reads 1 at level 6 pre-investment.
      abilityRanks: {
        Q: effectiveRank(selfUnit, 'Q'),
        W: effectiveRank(selfUnit, 'W'),
        E: effectiveRank(selfUnit, 'E'),
        R: effectiveRank(selfUnit, 'R'),
      },
      skillPoints: selfUnit.skillPoints,
      sigilCooldowns: [...selfUnit.sigilCooldowns],
      items: [...selfUnit.items],
      sigils: [...selfUnit.sigils],
      statuses: selfUnit.statuses
        .filter((s) => s.until > sim.time)
        .map((s) => ({ k: s.kind, until: round2(s.until), v: statusValue(s) })),
    };
    const boon = sim.teamBuff(team);
    if (boon) {
      self.boonUntil = round2(boon.until);
      self.boonStacks = boon.stacks;
    }
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
    self,
    events: snapEvents,
    winner: sim.winner,
    objAt: sim.objectiveSpawnAt(),
  };
}
