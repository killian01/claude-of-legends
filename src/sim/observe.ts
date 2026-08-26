// Builds a Policy observation for one champion: its own full state plus
// whatever its TEAM currently sees, nothing else. Fog correctness for bots
// is enforced by construction here, exactly like the server-side snapshot
// scoping is for human clients.

import { CHAMPIONS } from './content/champions';
import { SIGILS } from './content/sigils';
import type { Observation, ObsUnit } from './policy';
import type { Sim } from './sim';
import { effectiveRank } from './stats';
import { isInvulnerable } from './structure_rules';
import type { AbilityKey } from './types';

const KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];

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
    units.push(row);
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
  };
}
