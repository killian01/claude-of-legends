// The Laner: the default scripted bot (ADR 0002 phase 1). One file per bot,
// contributable by PR: implement Policy, register in index.ts, done. Pure
// heuristics over the observation; it reads only the static map (a known
// constant of the contract). It draws a LITTLE randomness for movement
// jitter so different seeds produce different matches (review finding F.0:
// all-bot games were identical across seeds).
// Priorities: survive, avoid tower dives, fight, farm, push with the wave.

import type { AbilityDef } from '../../combat/casting';
import type { Action, Observation, ObsSelf, ObsUnit, Policy } from '../../policy';
import type { Rng } from '../../rng';
import type { AbilityKey } from '../../types';
import { CHAMPIONS } from '../champions';
import { effectiveItemCost } from '../items';
import { GAME_MAP } from '../map';
import { hintsFor } from './hints';

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
// Dodging: the bot's own body radius (champions run 0.6 to 0.75), how far a
// sidestep goes, how soon a projectile must arrive to be worth reacting to,
// and how close a windup's landing spot must be to step off it.
const SELF_RADIUS = 0.75;
const DODGE_STEP = 2.6;
const DODGE_ETA_S = 1.0;
const WINDUP_DANGER_RADIUS = 3.4;

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

// The true reach of an ability, read from its CastSpec (kits-v2: the old
// bot used one hardcoded 7 for everyone and refused to poke at range).
function abilityRange(def: AbilityDef): number {
  const spec = def.spec;
  switch (spec.kind) {
    case 'skillshot':
    case 'cone':
      return spec.range;
    case 'dash':
      return spec.range;
    case 'burst':
      return spec.radius + 0.5;
    default:
      return def.castRange;
  }
}

// Hint-driven ability selection against the nearest enemy champion. The
// generic rules per role; the per-champion intent lives in hints.ts.
function pickCast(
  s: ObsSelf,
  champ: ObsUnit,
  enemyChampions: ObsUnit[],
  obs: Observation,
): Action | null {
  const def = s.championId ? CHAMPIONS[s.championId] : undefined;
  if (!def) return null;
  const hints = hintsFor(s.championId);
  const dc = Math.hypot(champ.x - s.x, champ.z - s.z);

  // The ultimate first, behind its gates: a held R is a threat, a wasted
  // one is a minute of nothing.
  if (s.abilityReady.R && s.recastArmed !== 'R') {
    const r = def.abilities.R;
    const range = abilityRange(r);
    const minR = hints.minRange?.R ?? 0;
    const cluster = enemyChampions.filter(
      (e) => Math.hypot(e.x - champ.x, e.z - champ.z) <= (hints.ult.radius ?? 5),
    ).length;
    const gate =
      (hints.ult.minEnemies !== undefined && cluster >= hints.ult.minEnemies) ||
      (hints.ult.targetHpBelow !== undefined && champ.hpFrac < hints.ult.targetHpBelow);
    if (gate && dc <= range && dc >= minR) {
      return { kind: 'cast', key: 'R', x: champ.x, z: champ.z };
    }
  }

  for (const key of ['Q', 'W', 'E'] as const) {
    if (!s.abilityReady[key]) continue;
    const role = hints.keys[key];
    if (role === 'escape') continue; // held for the retreat
    const range = abilityRange(def.abilities[key]);
    const minR = hints.minRange?.[key] ?? 0;
    if (role === 'steroid') {
      if (dc <= CHAMPION_ATTACK_RANGE) return { kind: 'cast', key, x: s.x, z: s.z };
      continue;
    }
    if (role === 'heal') {
      const hurt = obs.units
        .filter((u) => u.friendly && u.kind === 'champion' && u.hpFrac < 0.65)
        .sort((a, b) => a.hpFrac - b.hpFrac)[0];
      if (hurt && Math.hypot(hurt.x - s.x, hurt.z - s.z) <= def.abilities[key].castRange) {
        return { kind: 'cast', key, x: hurt.x, z: hurt.z };
      }
      continue;
    }
    if (role === 'wall') {
      if (champ.hpFrac < 0.5 && dc <= range) return { kind: 'cast', key, x: champ.x, z: champ.z };
      continue;
    }
    if (role === 'engage' && s.hpFrac < 0.5) continue;
    if (dc <= range && dc >= minR) return { kind: 'cast', key, x: champ.x, z: champ.z };
  }
  return null;
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
    if (!has('doombrand')) {
      if (!has('iron_blade')) return 'iron_blade';
      return 'doombrand';
    }
    if (!has('skyshear')) {
      if (!has('swift_fang')) return 'swift_fang';
      return 'skyshear';
    }
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
    if (!has('tempest_core')) {
      if (!has('spark_rod')) return 'spark_rod';
      return 'tempest_core';
    }
    if (!has('null_engine')) {
      if (!has('spark_rod')) return 'spark_rod';
      return 'null_engine';
    }
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
  if (!has('worldheart')) {
    if (!has('guard_plate')) return 'guard_plate';
    return 'worldheart';
  }
  return null;
}

const policy: Policy = (obs, rng: Rng): Action => {
  const s = obs.self;
  if (s.dead) return { kind: 'noop' };

  // Dodge before anything else: the observation now carries threats, and a
  // sidestep is free (movement is never budgeted). Skillshots on a
  // collision course get a perpendicular step; hostile zones get walked out
  // of; an enemy windup landing here gets stepped off.
  for (const p of obs.projectiles ?? []) {
    if (p.friendly || p.homing) continue;
    const relX = s.x - p.x;
    const relZ = s.z - p.z;
    const along = relX * p.dirX + relZ * p.dirZ;
    if (along < 0) continue;
    if (along / Math.max(1, p.speed) > DODGE_ETA_S) continue;
    const lateral = relX * -p.dirZ + relZ * p.dirX;
    if (Math.abs(lateral) > p.radius + SELF_RADIUS + 0.5) continue;
    // Step out on the side the bolt already misses toward.
    const side = lateral >= 0 ? 1 : -1;
    return {
      kind: 'move',
      x: s.x - p.dirZ * side * DODGE_STEP,
      z: s.z + p.dirX * side * DODGE_STEP,
    };
  }
  for (const zn of obs.zones ?? []) {
    if (zn.friendly) continue;
    const d = Math.hypot(s.x - zn.x, s.z - zn.z);
    if (d > zn.radius + SELF_RADIUS) continue;
    const ux = d > 0.05 ? (s.x - zn.x) / d : 1;
    const uz = d > 0.05 ? (s.z - zn.z) / d : 0;
    const out = zn.radius + SELF_RADIUS + 1.0;
    return { kind: 'move', x: zn.x + ux * out, z: zn.z + uz * out };
  }
  for (const e of obs.units) {
    if (e.friendly || e.kind !== 'champion' || !e.windup) continue;
    const d = Math.hypot(s.x - e.windup.x, s.z - e.windup.z);
    if (d > WINDUP_DANGER_RADIUS) continue;
    const ux = d > 0.05 ? (s.x - e.windup.x) / d : 1;
    const uz = d > 0.05 ? (s.z - e.windup.z) / d : 0;
    return { kind: 'move', x: s.x + ux * DODGE_STEP, z: s.z + uz * DODGE_STEP };
  }

  // ADR 0005: a banked recast is the way home. Press it the moment staying
  // committed stops being worth it.
  const hints = hintsFor(s.championId);
  if (
    s.recastArmed &&
    hints.recastHomeBelow !== undefined &&
    s.hpFrac < hints.recastHomeBelow &&
    s.abilityReady[s.recastArmed]
  ) {
    return { kind: 'cast', key: s.recastArmed, x: s.x, z: s.z };
  }

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

  // Survive: with a chaser on top of it, Riftstep toward home (or Zephyr to
  // outrun); otherwise Mend if ready; otherwise run.
  if (s.hpFrac < RETREAT_HP_FRAC) {
    const chaser = obs.units.some(
      (u) => !u.friendly && u.kind === 'champion' && Math.hypot(u.x - s.x, u.z - s.z) <= 6,
    );
    if (chaser) {
      // The kit's own escape key first (hints.ts), aimed toward home; the
      // sigils are the backup plan.
      const escapeKey = (['Q', 'W', 'E'] as const).find(
        (k) => hints.keys[k] === 'escape' && s.abilityReady[k],
      );
      if (escapeKey) {
        const dxf = fountain.x - s.x;
        const dzf = fountain.z - s.z;
        const df = Math.hypot(dxf, dzf) || 1;
        return { kind: 'cast', key: escapeKey, x: s.x + (dxf / df) * 6, z: s.z + (dzf / df) * 6 };
      }
      const rift = s.sigils.findIndex((id, i) => id === 'riftstep' && s.sigilReady[i] === true);
      if (rift !== -1) {
        const dxf = fountain.x - s.x;
        const dzf = fountain.z - s.z;
        const df = Math.hypot(dxf, dzf) || 1;
        return { kind: 'sigil', slot: rift, x: s.x + (dxf / df) * 6, z: s.z + (dzf / df) * 6 };
      }
      const zephyr = s.sigils.findIndex((id, i) => id === 'zephyr' && s.sigilReady[i] === true);
      if (zephyr !== -1) return { kind: 'sigil', slot: zephyr, x: s.x, z: s.z };
    }
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

  // Fight: Sear a kill-range target (the heal cut closes the escape), then
  // the hint-driven kit (each ability at its TRUE range, the ultimate held
  // behind its gates), otherwise attack.
  if (champ) {
    const dc = dist(s.x, s.z, champ);
    if (dc <= CAST_RANGE && champ.hpFrac < KILL_SECURE_HP_FRAC) {
      const sear = s.sigils.findIndex((id, i) => id === 'sear' && s.sigilReady[i] === true);
      if (sear !== -1) return { kind: 'sigil', slot: sear, x: champ.x, z: champ.z };
    }
    const cast = pickCast(s, champ, enemyChampions, obs);
    if (cast) return cast;
    if (dc <= CHAMPION_ATTACK_RANGE) return { kind: 'attack', targetId: champ.id };
  }

  // Contest the Warden: a live one in reach is worth a detour, but never
  // alone; deliberately dumb (systems review v1).
  const warden = enemies.find((u) => u.kind === 'warden');
  if (warden) {
    const dw = dist(s.x, s.z, warden);
    const alliesNearWarden = obs.units.filter(
      (v) => v.friendly && v.kind === 'champion' && dist(warden.x, warden.z, v) <= 14,
    ).length;
    if (dw <= FARM_RANGE && alliesNearWarden >= 1) {
      return { kind: 'attack', targetId: warden.id };
    }
    if (dw > FARM_RANGE && dw <= 35 && alliesNearWarden >= 1) {
      return { kind: 'move', x: warden.x, z: warden.z };
    }
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
  // Jungle detour: with no enemy champion in sight and no minion to farm, a
  // visible camp nearby is free income (systems review v1: one dumb rule).
  if (!champ) {
    const camp = nearest(
      enemies.filter((u) => u.kind === 'camp'),
      s.x,
      s.z,
    );
    if (camp && dist(s.x, s.z, camp) <= FARM_RANGE) {
      return { kind: 'attack', targetId: camp.id };
    }
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

  // Push MY lane: follow the most advanced friendly minion near the
  // assigned lane's polyline, else walk that lane's waypoints. Unassigned
  // participants keep the old any-lane behavior. A little jitter
  // differentiates matches across seeds (playtest review: all ten
  // champions used to funnel into one lane).
  const jx = (rng.next() * 2 - 1) * 1.5;
  const jz = (rng.next() * 2 - 1) * 1.5;
  const myLane = s.lane ? GAME_MAP.lanes[s.lane] : null;
  const laneDist = (x: number, z: number): number => {
    if (!myLane) return 0;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i + 1 < myLane.length; i++) {
      const a = myLane[i]!;
      const b = myLane[i + 1]!;
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const len2 = abx * abx + abz * abz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / len2));
      best = Math.min(best, Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)));
    }
    return best;
  };
  let vanguard: ObsUnit | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const m of friendlyMinions) {
    if (laneDist(m.x, m.z) > 7) continue;
    const d = Math.hypot(m.x - enemySanctum.x, m.z - enemySanctum.z);
    if (d < bestD) {
      bestD = d;
      vanguard = m;
    }
  }
  if (vanguard) return { kind: 'move', x: vanguard.x + jx, z: vanguard.z + jz };
  if (myLane) {
    // No wave to follow yet: walk the lane toward the enemy end.
    const oriented = s.team === 0 ? myLane : [...myLane].reverse();
    let idx = 0;
    let nearest = Number.POSITIVE_INFINITY;
    oriented.forEach((p, i) => {
      const d = Math.hypot(p.x - s.x, p.z - s.z);
      if (d < nearest) {
        nearest = d;
        idx = i;
      }
    });
    const next = oriented[Math.min(idx + 1, oriented.length - 1)]!;
    return { kind: 'move', x: next.x + jx, z: next.z + jz };
  }
  return { kind: 'move', x: enemySanctum.x + jx, z: enemySanctum.z + jz };
};

export const LANER: BotDef = {
  id: 'laner',
  name: 'Laner',
  policy,
};
