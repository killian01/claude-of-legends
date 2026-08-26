// The Laner: the default scripted bot (ADR 0002 phase 1). One file per bot,
// contributable by PR: implement Policy, register in index.ts, done. Pure
// heuristics over the observation; it reads only the static map (a known
// constant of the contract). It draws a LITTLE randomness for movement
// jitter so different seeds produce different matches (review finding F.0:
// all-bot games were identical across seeds).
// Priorities: survive, avoid tower dives, fight, farm, push with the wave.

import type { Action, ObsUnit, Policy } from '../../policy';
import type { Rng } from '../../rng';
import { CHAMPIONS } from '../champions';
import { effectiveItemCost } from '../items';
import { GAME_MAP } from '../map';

export interface BotDef {
  id: string;
  name: string;
  policy: Policy;
}

const RETREAT_HP_FRAC = 0.32;
// 0.7, down from 0.85: bots leave the fountain sooner, so lanes stand
// empty less often (pacing review).
const REJOIN_HP_FRAC = 0.7;
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

// Deterministic ROLE-AWARE build plans that CAN buy duplicate components
// (review F.0: the old list never completed a two-component recipe; the
// snowball review found every bot on every champion building full tank).
// Returns the next item id to buy, or null when the build is done.
function nextPurchase(items: readonly string[], championId: string | null): string | null {
  const has = (id: string): boolean => items.includes(id);
  const count = (id: string): number => items.filter((x) => x === id).length;
  const role = championId ? CHAMPIONS[championId]?.role : undefined;

  if (role === 'Marksman' || role === 'Assassin' || role === 'Skirmisher') {
    if (!has('warbrand')) {
      if (count('iron_blade') < 2) return 'iron_blade';
      return 'warbrand';
    }
    if (!has('sunder_axe')) {
      if (!has('traveler_soles')) return 'traveler_soles';
      if (count('iron_blade') < 1) return 'iron_blade';
      return 'sunder_axe';
    }
    if (!has('windrazor')) {
      if (!has('swift_fang')) return 'swift_fang';
      if (count('iron_blade') < 1) return 'iron_blade';
      return 'windrazor';
    }
    if (!has('heart_gem')) return 'heart_gem';
    return null;
  }
  if (role === 'Mage' || role === 'Battlemage') {
    if (!has('storm_staff')) {
      if (count('spark_rod') < 2) return 'spark_rod';
      return 'storm_staff';
    }
    if (!has('void_crystal')) {
      if (!has('null_cloak')) return 'null_cloak';
      if (count('spark_rod') < 1) return 'spark_rod';
      return 'void_crystal';
    }
    if (!has('archmind')) {
      if (!has('mind_gem')) return 'mind_gem';
      if (count('spark_rod') < 1) return 'spark_rod';
      return 'archmind';
    }
    if (!has('heart_gem')) return 'heart_gem';
    return null;
  }
  // Tanks, fighters, and supports keep the defensive shell.
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

const policy: Policy = (obs, rng: Rng): Action => {
  const s = obs.self;
  if (s.dead) return { kind: 'noop' };

  // Spend skill points as soon as they exist: R at its level gates (6/11/16),
  // then Q > W > E. A free action, but one decision slot this period.
  if (s.skillPoints > 0) {
    const ultGate = [6, 11, 16][s.abilityRanks.R];
    if (ultGate !== undefined && s.level >= ultGate) return { kind: 'level', key: 'R' };
    for (const key of ['Q', 'W', 'E'] as const) {
      if (s.abilityRanks[key] < 5) return { kind: 'level', key };
    }
  }

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
    const wanted = nextPurchase(s.items, s.championId);
    if (wanted && s.gold >= effectiveItemCost(wanted, s.items)) {
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

  // Close out the game: a vulnerable Sanctum in reach beats everything,
  // especially once it is low (measured stall: both Sanctums chipped to
  // ~300 hp with nobody finishing).
  const sanctumTarget = enemies.find((e) => e.kind === 'sanctum' && e.invulnerable !== true);
  if (
    sanctumTarget &&
    dist(s.x, s.z, sanctumTarget) <= FARM_RANGE &&
    (sanctumTarget.hpFrac < 0.5 || escortAt(sanctumTarget.x, sanctumTarget.z) >= 2)
  ) {
    return { kind: 'attack', targetId: sanctumTarget.id };
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
