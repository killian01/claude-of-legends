// Builds one team-scoped snapshot for one client. The fog of war is enforced
// HERE: what never reaches the wire can never be maphacked. Identity fields
// go out once per unit per client, tracked by the caller-owned `known` set;
// a unit leaving vision lands in `gone` and is re-sent full when it returns.

import type { SelfSnap, ServerMsg, SnapEvent, SnapMobile, SnapUnit } from '../src/net/protocol';
import type { Sim, SimEvent } from '../src/sim/sim';
import type { TeamId } from '../src/sim/types';

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function buildSnapshot(
  sim: Sim,
  team: TeamId,
  selfUnitId: number,
  known: Set<number>,
  events: readonly SimEvent[],
): ServerMsg {
  const units: SnapUnit[] = [];
  const visibleNow = new Set<number>();
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
    if (!known.has(u.id)) {
      known.add(u.id);
      snap.k = u.kind;
      snap.t = u.team;
      snap.c = u.championId;
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

  // Projectiles and zones ship unfiltered for now; scoping them by the
  // visibility of their source is a noted refinement.
  const projectiles: SnapMobile[] = [];
  for (const p of sim.projectiles.values()) {
    projectiles.push({ i: p.id, x: round2(p.pos.x), z: round2(p.pos.z), r: p.radius, t: p.team });
  }
  const zones: SnapMobile[] = [];
  for (const z of sim.zones.values()) {
    zones.push({ i: z.id, x: round2(z.pos.x), z: round2(z.pos.z), r: z.radius, t: z.team });
  }

  let self: SelfSnap | null = null;
  const selfUnit = sim.units.get(selfUnitId);
  if (selfUnit) {
    self = {
      mana: Math.round(selfUnit.mana),
      maxMana: Math.round(selfUnit.maxMana),
      gold: Math.floor(selfUnit.gold),
      level: selfUnit.level,
      xp: Math.round(selfUnit.xp),
      dead: selfUnit.dead,
      respawnAt: round2(selfUnit.respawnAt),
      cooldowns: { ...selfUnit.cooldowns },
      sigilCooldowns: [...selfUnit.sigilCooldowns],
      items: [...selfUnit.items],
      sigils: [...selfUnit.sigils],
    };
  }

  const snapEvents: SnapEvent[] = [];
  for (const ev of events) {
    if (ev.type === 'death')
      snapEvents.push({ e: 'death', unitId: ev.unitId, killerId: ev.killerId });
    else if (ev.type === 'victory') snapEvents.push({ e: 'victory', team: ev.team });
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
  };
}
