// The Laner: the default scripted bot (ADR 0002 phase 1). One file per bot,
// contributable by PR: implement Policy, register in index.ts, done. Pure
// heuristics over the observation; it reads only the static map (a known
// constant of the contract). It draws a LITTLE randomness for movement
// jitter so different seeds produce different matches (review finding F.0:
// all-bot games were identical across seeds).
// Priorities: survive, avoid tower dives, fight, farm, push with the wave.

import type { Action, ObsUnit, Policy } from '../../policy';
import type { Rng } from '../../rng';
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
// Review F.0: towers reach ~9 plus radii and the bot attacked structures at
// range 8, diving to its death. It now stays out of tower reach unless its
// minions are soaking, and only sieges with an escort.
const TOWER_DANGER_RANGE = 11;
const ESCORT_RADIUS = 7;
const ESCORT_MIN = 3;
const KILL_SECURE_HP_FRAC = 0.3;

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

// Deterministic build plan that CAN buy duplicate components (review F.0:
// the old list never completed a two-component recipe). Returns the next
// item id to buy, or null when the build is done.
function nextPurchase(items: readonly string[]): string | null {
  const has = (id: string): boolean => items.includes(id);
  const count = (id: string): number => items.filter((x) => x === id).length;
  if (!has('colossus_heart')) {
    if (count('heart_gem') < 2) return 'heart_gem';
    return 'colossus_heart';
  }
  if (!has('stone_bulwark')) {
    if (!has('guard_plate')) return 'guard_plate';
    if (count('heart_gem') < 1) return 'heart_gem';
    return 'stone_bulwark';
  }
  if (!has('spirit_ward')) {
    if (!has('null_cloak')) return 'null_cloak';
    if (count('heart_gem') < 1) return 'heart_gem';
    return 'spirit_ward';
  }
  if (!has('iron_blade')) return 'iron_blade';
  if (!has('swift_fang')) return 'swift_fang';
  return null;
}

// Mirrors the sim's component discount so the bot only tries affordable buys.
function effectiveCost(itemId: string, items: readonly string[]): number {
  const def = ITEMS[itemId];
  if (!def) return Number.POSITIVE_INFINITY;
  let discount = 0;
  const consumed: number[] = [];
  for (const compId of def.buildsFrom ?? []) {
    const idx = items.findIndex((it, i) => it === compId && !consumed.includes(i));
    if (idx !== -1) {
      consumed.push(idx);
      discount += ITEMS[compId]?.cost ?? 0;
    }
  }
  return def.cost - discount;
}

const policy: Policy = (obs, rng: Rng): Action => {
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
  // Heal up before walking back out (fountain regen makes this quick now).
  if (atFountain && s.hpFrac < REJOIN_HP_FRAC) return { kind: 'noop' };

  // Shop while home.
  if (atFountain && s.items.length < 6) {
    const wanted = nextPurchase(s.items);
    if (wanted && s.gold >= effectiveCost(wanted, s.items)) {
      return { kind: 'buy', itemId: wanted };
    }
  }

  const enemies = obs.units.filter((u) => !u.friendly);
  const friendlyMinions = obs.units.filter((u) => u.friendly && u.kind === 'minion');
  const escortAt = (x: number, z: number): number =>
    friendlyMinions.filter((m) => Math.hypot(m.x - x, m.z - z) <= ESCORT_RADIUS).length;

  const enemyChampions = enemies.filter((u) => u.kind === 'champion');
  const champ = nearest(enemyChampions, s.x, s.z);

  // Tower danger: standing in reach of a live enemy tower without an escort
  // is only worth it to secure a kill.
  const enemyTowers = enemies.filter((u) => u.kind === 'tower');
  const dangerTower = enemyTowers.find(
    (t) => dist(s.x, s.z, t) <= TOWER_DANGER_RANGE && escortAt(t.x, t.z) < ESCORT_MIN,
  );
  const securingKill =
    champ !== null && champ.hpFrac < KILL_SECURE_HP_FRAC && dist(s.x, s.z, champ) <= CAST_RANGE;
  if (dangerTower && !securingKill) {
    // Step back toward home just far enough to leave the danger zone.
    const dx = fountain.x - s.x;
    const dz = fountain.z - s.z;
    const d = Math.hypot(dx, dz) || 1;
    return { kind: 'move', x: s.x + (dx / d) * 8, z: s.z + (dz / d) * 8 };
  }

  // Fight: throw a ready ability at a close champion, otherwise attack it.
  if (champ && dist(s.x, s.z, champ) <= CHAMPION_ATTACK_RANGE) {
    if (dist(s.x, s.z, champ) <= CAST_RANGE) {
      for (const key of ['Q', 'W', 'E', 'R'] as const) {
        if (s.abilityReady[key]) return { kind: 'cast', key, x: champ.x, z: champ.z };
      }
    }
    return { kind: 'attack', targetId: champ.id };
  }

  // Farm: nearest enemy minion, then a vulnerable structure WITH an escort.
  const minion = nearest(
    enemies.filter((u) => u.kind === 'minion'),
    s.x,
    s.z,
  );
  if (minion && dist(s.x, s.z, minion) <= FARM_RANGE) {
    return { kind: 'attack', targetId: minion.id };
  }
  const structure = nearest(
    enemies.filter((u) => (u.kind === 'tower' || u.kind === 'sanctum') && u.invulnerable !== true),
    s.x,
    s.z,
  );
  if (
    structure &&
    dist(s.x, s.z, structure) <= FARM_RANGE &&
    escortAt(structure.x, structure.z) >= ESCORT_MIN
  ) {
    return { kind: 'attack', targetId: structure.id };
  }

  // Push: follow the most advanced friendly minion wave, else walk at the
  // enemy Sanctum. A little jitter differentiates matches across seeds.
  const jx = (rng.next() * 2 - 1) * 1.5;
  const jz = (rng.next() * 2 - 1) * 1.5;
  let vanguard: ObsUnit | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const m of friendlyMinions) {
    const d = Math.hypot(m.x - enemySanctum.x, m.z - enemySanctum.z);
    if (d < bestD) {
      bestD = d;
      vanguard = m;
    }
  }
  if (vanguard) return { kind: 'move', x: vanguard.x + jx, z: vanguard.z + jz };
  return { kind: 'move', x: enemySanctum.x + jx, z: enemySanctum.z + jz };
};

export const LANER: BotDef = {
  id: 'laner',
  name: 'Laner',
  policy,
};
