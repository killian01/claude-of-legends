// Builds a Policy observation for one champion: its own full state plus
// whatever its TEAM currently sees, nothing else. Fog correctness for bots
// is enforced by construction here, exactly like the server-side snapshot
// scoping is for human clients.

import { sightFactor } from './combat/status';
import { CHAMPIONS } from './content/champions';
import { SIGILS } from './content/sigils';
import type { Observation, ObsProjectile, ObsUnit, ObsZone } from './policy';
import type { Sim } from './sim';
import { effectiveRank } from './stats';
import { isInvulnerable } from './structure_rules';
import type { AbilityKey, TeamId } from './types';
import { sightBlocked } from './vision';

const KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];

// A ground POINT is visible when some alive friendly unit has it in sight
// range with no wall in between. Projectiles and zones have no unit id, so
// the per-unit visibility sets cannot cover them.
function pointVisible(sim: Sim, team: TeamId, x: number, z: number): boolean {
  for (const src of sim.units.values()) {
    if (src.team !== team || src.neutral || src.dead) continue;
    if (Math.hypot(src.pos.x - x, src.pos.z - z) > src.sightRange * sightFactor(src, sim.time)) {
      continue;
    }
    if (sightBlocked(sim.map, src.pos, { x, z })) continue;
    return true;
  }
  return false;
}

export function buildObservation(sim: Sim, unitId: number): Observation | null {
  const u = sim.units.get(unitId);
  if (!u || u.kind !== 'champion' || u.championId === null) return null;
  const def = CHAMPIONS[u.championId];
  if (!def) return null;

  const abilityReady = { Q: false, W: false, E: false, R: false };
  const abilityRanks = { Q: 0, W: 0, E: 0, R: 0 };
  for (const key of KEYS) {
    const a = def.abilities[key];
    abilityRanks[key] = effectiveRank(u, key);
    abilityReady[key] =
      (u.cooldowns[key] ?? 0) <= sim.time && u.mana >= a.manaCost && abilityRanks[key] > 0;
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
    // The observable telegraph: a visible champion mid-windup announces
    // where the cast lands. Bursts and cones land on the caster.
    if (other.kind === 'champion' && other.pendingSpell && other.championId) {
      const pending = other.pendingSpell;
      const spec = CHAMPIONS[other.championId]?.abilities[pending.key]?.spec;
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
    if (!friendly && !pointVisible(sim, u.team, p.pos.x, p.pos.z)) continue;
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
    if (!friendly && !pointVisible(sim, u.team, z.pos.x, z.pos.z)) continue;
    zones.push({
      x: z.pos.x,
      z: z.pos.z,
      radius: z.radius,
      friendly,
      detonateAt: z.detonateAt,
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
      lane: u.kind === 'champion' ? (u.lane as 'top' | 'mid' | 'bot' | null) : null,
    },
    units,
    objectiveSpawnAt: sim.objectiveSpawnAt(),
    projectiles,
    zones,
  };
}
