// Builds a Policy observation for one champion: its own full state plus
// whatever its TEAM currently sees, nothing else. Fog correctness for bots
// is enforced by construction here, exactly like the server-side snapshot
// scoping is for human clients.

import { effectiveMoveSpeed } from './combat/status';
import { heartwoodOf } from './content/grafts';
import { SIGILS } from './content/sigils';
import { draughtLeft } from './draught';
import { hypot } from './exact';
import { carry, copy, dirTo } from './geo';
import type {
  Observation,
  ObsLastSeen,
  ObsProjectile,
  ObsSeat,
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
  const d = hypot(dx, dz);
  if (d < 1e-6) return { vx: 0, vz: 0 };
  const speed = effectiveMoveSpeed(u, time);
  return { vx: (dx / d) * speed, vz: (dz / d) * speed };
}

// The same motion on the sphere, a tangent at the unit (ADR 0029): the
// dash's heading carried to where the body is now, else the heading toward
// the next waypoint.
function sphereVelocityOf(u: Unit, time: number): { vx: number; vy: number; vz: number } {
  if (u.activeDash) {
    const d = carry(u.activeDash.dir, u.activeDash.from, u.pos);
    const s = u.activeDash.speed;
    return { vx: d.x * s, vy: (d.y ?? 0) * s, vz: d.z * s };
  }
  const wp = u.path[0];
  if (!wp || u.pendingSpell) return { vx: 0, vy: 0, vz: 0 };
  const dir = dirTo(u.pos, wp);
  if (!dir) return { vx: 0, vy: 0, vz: 0 };
  const speed = effectiveMoveSpeed(u, time);
  return { vx: dir.x * speed, vy: (dir.y ?? 0) * speed, vz: dir.z * speed };
}

export function buildObservation(sim: Sim, unitId: number): Observation | null {
  const u = sim.units.get(unitId);
  if (u?.kind !== 'champion' || u.championId === null) return null;
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
      hp: other.hp,
      maxHp: other.maxHp,
      radius: other.radius,
    };
    if (other.kind === 'tower' || other.kind === 'sanctum') {
      row.invulnerable = isInvulnerable(sim.units, other);
    }
    if (other.pos.y !== undefined) {
      // On the planet (additive v0 fields): the third coordinate and the
      // velocity's.
      row.y = other.pos.y;
      const vel = sphereVelocityOf(other, sim.time);
      row.vx = vel.vx;
      row.vy = vel.vy;
      row.vz = vel.vz;
    } else {
      const vel = velocityOf(other, sim.time);
      row.vx = vel.vx;
      row.vz = vel.vz;
    }
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
      row.items = [...other.items];
      row.level = other.level;
      // The battle royale's Heartwood, on the champion for everyone to see.
      if (other.grafts.length > 0) {
        const hw = heartwoodOf(other);
        if (hw) row.heartwood = hw;
      }
    }
    // The observable telegraph: a visible champion mid-windup announces
    // where the cast lands. Bursts and cones land on the caster.
    if (other.kind === 'champion' && other.pendingSpell && other.championId) {
      const pending = other.pendingSpell;
      const spec = other.champion?.abilities[pending.key]?.spec;
      const selfCentered = spec?.kind === 'burst' || spec?.kind === 'cone';
      const landing = selfCentered ? other.pos : pending.aim;
      row.windup = {
        key: pending.key,
        x: landing.x,
        z: landing.z,
        ...(landing.y !== undefined ? { y: landing.y } : {}),
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
    if (!friendly && !sim.isPointVisible(u.team, p.pos.x, p.pos.z, p.pos.y)) continue;
    projectiles.push({
      x: p.pos.x,
      z: p.pos.z,
      dirX: p.dir.x,
      dirZ: p.dir.z,
      ...(p.pos.y !== undefined ? { y: p.pos.y, dirY: p.dir.y ?? 0 } : {}),
      speed: p.speed,
      radius: p.radius,
      friendly,
      homing: p.homingTargetId !== null,
    });
  }
  const zones: ObsZone[] = [];
  for (const z of sim.zones.values()) {
    const friendly = z.team === u.team;
    if (!friendly && !sim.isPointVisible(u.team, z.pos.x, z.pos.z, z.pos.y)) continue;
    zones.push({
      x: z.pos.x,
      z: z.pos.z,
      ...(z.pos.y !== undefined ? { y: z.pos.y } : {}),
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
  for (const [id, rec] of sim.lastSeen[u.team] ?? []) {
    if (sim.time - rec.at > LAST_SEEN_FRESH_S) continue;
    const other = sim.units.get(id);
    if (!other || other.dead) continue;
    if (sim.isVisible(u.team, id)) continue;
    // On the planet the third coordinate too (additive v0 field).
    const y = rec.y !== undefined ? { y: rec.y } : {};
    lastSeen.push({ id, x: rec.x, z: rec.z, ...y, at: rec.at, hpFrac: rec.hpFrac });
  }

  // The seats: every champion of both teams, public from champion select;
  // the assigned lane only for the own team.
  const seats: ObsSeat[] = [];
  for (const other of sim.units.values()) {
    if (other.kind !== 'champion' || other.neutral || !other.championId) continue;
    const role = other.champion?.role;
    if (!role) continue;
    seats.push({
      id: other.id,
      team: other.team,
      championId: other.championId,
      role,
      ...(other.team === u.team ? { lane: other.lane as 'top' | 'mid' | 'bot' | null } : {}),
      dead: other.dead,
    });
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

  const pit = sim.wardenPit();
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
      attackReadyAt: u.attackReadyAt,
      attackDamage: u.stats.ad,
      holding: u.holding,
      attackSwingUntil: u.pendingAttack ? u.pendingAttack.resolveAt : null,
      recastArmed: u.recastArmed && u.recastArmed.until > sim.time ? u.recastArmed.key : null,
      lane: u.kind === 'champion' ? (u.lane as 'top' | 'mid' | 'bot' | null) : null,
      recalling: u.statuses.some((s) => s.kind === 'recall' && s.until > sim.time),
      drinking: draughtLeft(u, sim.time),
      struckAt: u.lastHitByChampion !== 0 ? u.lastHitAt : null,
      // The owner's coach order, additive: absent for every uncoached seat.
      ...(u.coachOrder ? { coachOrder: u.coachOrder } : {}),
      // On the planet (additive v0 fields): the third coordinate, where the
      // walk ends and the stride, what a person reads off their own
      // champion.
      ...(u.pos.y !== undefined
        ? {
            y: u.pos.y,
            dest: u.path.length > 0 ? copy(u.path[u.path.length - 1]!) : null,
            moveSpeed: effectiveMoveSpeed(u, sim.time),
          }
        : {}),
    },
    units,
    objectiveSpawnAt: sim.objectiveSpawnAt(),
    wardenRoseAt: sim.objectives.roseAt,
    ...(pit ? { wardenPit: { x: pit.x, z: pit.z } } : {}),
    creatures: sim.ringClocks(),
    camps: sim.campsFor(u.team),
    projectiles,
    zones,
    walls,
    lastSeen,
    seats,
    laneOpponents: sim.laneOpponents(u.team),
    laneActivity: sim.laneActivity(u.team),
    // The battle royale's block (additive v0 field), only in one.
    ...(sim.royaleMode ? { royale: sim.royaleMode.observe(sim, u) } : {}),
  };
}
