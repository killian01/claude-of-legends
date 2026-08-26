// The Laner: the default scripted bot (ADR 0002 phase 1). One file per bot,
// contributable by PR: implement Policy, register in index.ts, done. Pure
// deterministic heuristics over the observation; it never reads sim state
// directly (only the static map, a known constant of the contract) and it
// draws no randomness. Priorities: survive, fight, farm, push.

import type { Action, Observation, ObsUnit, Policy } from '../../policy';
import { ITEMS } from '../items';
import { GAME_MAP } from '../map';

export interface BotDef {
  id: string;
  name: string;
  policy: Policy;
}

const RETREAT_HP_FRAC = 0.32;
const REJOIN_HP_FRAC = 0.85;
const CAST_RANGE = 7;
const CHAMPION_ATTACK_RANGE = 9;
const FARM_RANGE = 8;

// A tanky-neutral shopping list any champion can hold.
const SHOPPING: readonly string[] = [
  'heart_gem',
  'iron_blade',
  'guard_plate',
  'null_cloak',
  'colossus_heart',
  'swift_fang',
];

function dist(ax: number, az: number, b: ObsUnit): number {
  return Math.hypot(b.x - ax, b.z - az);
}

function nearest(list: ObsUnit[], x: number, z: number): ObsUnit | null {
  let best: ObsUnit | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const u of list) {
    const d = dist(x, z, u);
    if (d < bestD) {
      bestD = d;
      best = u;
    }
  }
  return best;
}

const policy: Policy = (obs): Action => {
  const s = obs.self;
  if (s.dead) return { kind: 'noop' };

  const fountain = GAME_MAP.fountains.find((f) => f.team === s.team)!;
  const enemySanctum = GAME_MAP.sanctums.find((c) => c.team !== s.team)!;
  const atFountain = Math.hypot(s.x - fountain.x, s.z - fountain.z) <= fountain.r + 2;

  // Survive: mend if equipped and ready, otherwise run home.
  if (s.hpFrac < RETREAT_HP_FRAC) {
    const mendSlot = s.sigils.findIndex((id, i) => id === 'mend' && s.sigilReady[i] === true);
    if (mendSlot !== -1) return { kind: 'sigil', slot: mendSlot, x: s.x, z: s.z };
    return { kind: 'move', x: fountain.x, z: fountain.z };
  }
  // Heal up before walking back out.
  if (atFountain && s.hpFrac < REJOIN_HP_FRAC) return { kind: 'noop' };

  // Shop while home.
  if (atFountain && s.items.length < 6) {
    for (const itemId of SHOPPING) {
      if (s.items.includes(itemId)) continue;
      const def = ITEMS[itemId];
      if (def && s.gold >= def.cost) return { kind: 'buy', itemId };
    }
  }

  const enemies = obs.units.filter((u) => !u.friendly);
  const enemyChampions = enemies.filter((u) => u.kind === 'champion');
  const champ = nearest(enemyChampions, s.x, s.z);

  // Fight: throw a ready ability at a close champion, otherwise attack it.
  if (champ && dist(s.x, s.z, champ) <= CHAMPION_ATTACK_RANGE) {
    if (dist(s.x, s.z, champ) <= CAST_RANGE) {
      for (const key of ['Q', 'W', 'E', 'R'] as const) {
        if (s.abilityReady[key]) return { kind: 'cast', key, x: champ.x, z: champ.z };
      }
    }
    return { kind: 'attack', targetId: champ.id };
  }

  // Farm: nearest enemy minion, then any vulnerable structure in reach.
  const minion = nearest(
    enemies.filter((u) => u.kind === 'minion'),
    s.x,
    s.z,
  );
  if (minion && dist(s.x, s.z, minion) <= FARM_RANGE) {
    return { kind: 'attack', targetId: minion.id };
  }
  const structure = nearest(
    enemies.filter((u) => u.kind === 'tower' || u.kind === 'sanctum'),
    s.x,
    s.z,
  );
  if (structure && dist(s.x, s.z, structure) <= FARM_RANGE) {
    return { kind: 'attack', targetId: structure.id };
  }

  // Push: follow the most advanced friendly minion wave, else walk at the
  // enemy Sanctum and let pathfinding pick the route.
  const friendlyMinions = obs.units.filter((u) => u.friendly && u.kind === 'minion');
  let vanguard: ObsUnit | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const m of friendlyMinions) {
    const d = Math.hypot(m.x - enemySanctum.x, m.z - enemySanctum.z);
    if (d < bestD) {
      bestD = d;
      vanguard = m;
    }
  }
  if (vanguard) return { kind: 'move', x: vanguard.x, z: vanguard.z };
  return { kind: 'move', x: enemySanctum.x, z: enemySanctum.z };
};

export const LANER: BotDef = {
  id: 'laner',
  name: 'Laner',
  policy,
};
