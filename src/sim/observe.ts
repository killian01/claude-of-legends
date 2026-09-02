// Builds a Policy observation for one champion: its own full state plus
// whatever its TEAM currently sees, nothing else. Fog correctness for bots
// is enforced by construction here, exactly like the server-side snapshot
// scoping is for human clients.

import { effectiveMoveSpeed } from './combat/status';
import { SIGILS } from './content/sigils';
import type {
  Observation,
  ObsLastSeen,
  ObsProjectile,
  ObsStatus,
  ObsUnit,
  ObsWall,
  ObsZone,
} from './policy';
import type { Sim } from './sim';
import { effectiveRank } from './stats';
import { isInvulnerable } from './structure_rules';
import type { AbilityKey } from './types';
import type { Unit } from './unit';

const KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];

// The curated on-screen statuses a viewer reads at a glance (policy.ts
// ObsStatus); everything else on the unit is internal bookkeeping.
const OBS_STATUS_KINDS: readonly ObsStatus['kind'][] = [
  'stun',
  'root',
  'airborne',
  'slow',
  'shield',
];

// The motion a viewer sees on screen: a dash in flight travels at its own
// speed, a walking unit steps toward its next waypoint at effective speed
// (zero while rooted, stunned, or airborne), everything else stands still.
function velocityOf(u: Unit, time: number): { vx: number; vz: number } {
  if (u.activeDash) {
    return {
      vx: u.activeDash.dir.x * u.activeDash.speed,
      vz: u.activeDash.dir.z * u.activeDash.speed,
    };
  }
  const wp = u.path[0];
  if (!wp || u.pendingSpell) return { vx: 0, vz: 0 };
  const dx = wp.x - u.pos.x;
  const dz = wp.z - u.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return { vx: 0, vz: 0 };
  const speed = effectiveMoveSpeed(u, time);
  return { vx: (dx / d) * speed, vz: (dz / d) * speed };
}

export function buildObservation(sim: Sim, unitId: number): Observation | null {
  const u = sim.units.get(unitId);
  if (!u || u.kind !== 'champion' || u.championId === null) return null;
  const def = u.champion;
  if (!def) return null;

  const abilityReady = { Q: false, W: false, E: false, R: false };
  const abilityRanks = { Q: 0, W: 0, E: 0, R: 0 };
  for (const key of KEYS) {
    const a = def.abilities[key];
    abilityRanks[key] = effectiveRank(u, key);
    abilityReady[key] =
      (u.cooldowns[key] ?? 0) <= sim.time && u.mana >= a.manaCost && abilityRanks[key] > 0;
    // ADR 0005: an armed recast window reads as ready; the press resolves
    // the follow-up with no mana or cooldown gate.
    if (u.recastArmed && u.recastArmed.key === key && u.recastArmed.until > sim.time) {
      abilityReady[key] = true;
    }
  }

  const sigilReady = u.sigils.map((id, slot) => {
    if (!SIGILS[id]) return false;
    return (u.sigilCooldowns[slot] ?? 0) <= sim.time;
  });

  const units: ObsUnit[] = [];
  for (const other of sim.units.values()) {
    if (other.id === u.id) continue;
    if (!sim.isVisible(u.team, other.id)) continue;
    const row: ObsUnit = {
      id: other.id,
      kind: other.kind,
      // The neutral Warden reads as hostile to BOTH teams.
      friendly: !other.neutral && other.team === u.team,
      x: other.pos.x,
      z: other.pos.z,
      hpFrac: other.maxHp > 0 ? other.hp / other.maxHp : 0,
      radius: other.radius,
    };
    if (other.kind === 'tower' || other.kind === 'sanctum') {
      row.invulnerable = isInvulnerable(sim.units, other);
    }
    const vel = velocityOf(other, sim.time);
    row.vx = vel.vx;
    row.vz = vel.vz;
    if (other.kind === 'champion') {
      const visible: ObsStatus[] = [];
      for (const st of other.statuses) {
        if (st.until <= sim.time) continue;
        if ((OBS_STATUS_KINDS as readonly string[]).includes(st.kind)) {
          visible.push({ kind: st.kind as ObsStatus['kind'], until: st.until });
        }
      }
      if (visible.length > 0) row.statuses = visible;
      if (other.championId) row.championId = other.championId;
    }
    // The observable telegraph: a visible champion mid-windup announces
    // where the cast lands. Bursts and cones land on the caster.
    if (other.kind === 'champion' && other.pendingSpell && other.championId) {
      const pending = other.pendingSpell;
      const spec = other.champion?.abilities[pending.key]?.spec;
      const selfCentered = spec?.kind === 'burst' || spec?.kind === 'cone';
      row.windup = {
        key: pending.key,
        x: selfCentered ? other.pos.x : pending.aim.x,
        z: selfCentered ? other.pos.z : pending.aim.z,
        resolveAt: pending.resolveAt,
      };
    }
    units.push(row);
  }

  // Threats: everything in flight or on the ground the team can see. Own
  // projectiles and zones are always known; enemy ones need a sighted point.
  const projectiles: ObsProjectile[] = [];
  for (const p of sim.projectiles.values()) {
    const friendly = p.team === u.team;
    if (!friendly && !sim.isPointVisible(u.team, p.pos.x, p.pos.z)) continue;
    projectiles.push({
      x: p.pos.x,
      z: p.pos.z,
      dirX: p.dir.x,
      dirZ: p.dir.z,
      speed: p.speed,
      radius: p.radius,
      friendly,
      homing: p.homingTargetId !== null,
    });
  }
  const zones: ObsZone[] = [];
  for (const z of sim.zones.values()) {
    const friendly = z.team === u.team;
    if (!friendly && !sim.isPointVisible(u.team, z.pos.x, z.pos.z)) continue;
    zones.push({
      x: z.pos.x,
      z: z.pos.z,
      radius: z.radius,
      friendly,
      detonateAt: z.detonateAt,
    });
  }
  // Memory of the vanished: enemy champions the team saw recently but
  // cannot see now, at their last sighted spot (the human's memory of who
  // ran into which brush, made observable).
  const LAST_SEEN_FRESH_S = 4;
  const lastSeen: ObsLastSeen[] = [];
  for (const [id, rec] of sim.lastSeen[u.team]) {
    if (sim.time - rec.at > LAST_SEEN_FRESH_S) continue;
    const other = sim.units.get(id);
    if (!other || other.dead) continue;
    if (sim.isVisible(u.team, id)) continue;
    lastSeen.push({ id, x: rec.x, z: rec.z, at: rec.at, hpFrac: rec.hpFrac });
  }

  // Walls are terrain: both teams always see them, like the pathing change.
  const walls: ObsWall[] = [];
  for (const w of sim.walls.values()) {
    walls.push({
      x1: w.a.x,
      z1: w.a.z,
      x2: w.b.x,
      z2: w.b.z,
      friendly: w.team === u.team,
      until: w.until,
    });
  }

  return {
    tick: sim.tickCount,
    time: sim.time,
    winner: sim.winner,
    self: {
      id: u.id,
      team: u.team,
      x: u.pos.x,
      z: u.pos.z,
      hp: u.hp,
      maxHp: u.maxHp,
      hpFrac: u.maxHp > 0 ? u.hp / u.maxHp : 0,
      mana: u.mana,
      maxMana: u.maxMana,
      level: u.level,
      gold: u.gold,
      dead: u.dead,
      abilityReady,
      abilityRanks,
      skillPoints: u.skillPoints,
      sigils: [...u.sigils],
      sigilReady,
      items: [...u.items],
      championId: u.championId,
      attackRange: u.stats.attackRange,
      recastArmed: u.recastArmed && u.recastArmed.until > sim.time ? u.recastArmed.key : null,
      lane: u.kind === 'champion' ? (u.lane as 'top' | 'mid' | 'bot' | null) : null,
      recalling: u.statuses.some((s) => s.kind === 'recall' && s.until > sim.time),
      // The owner's coach order, additive: absent for every uncoached seat.
      ...(u.coachOrder ? { coachOrder: u.coachOrder } : {}),
    },
    units,
    objectiveSpawnAt: sim.objectiveSpawnAt(),
    projectiles,
    zones,
    walls,
    lastSeen,
  };
}
