// The engine's micro, shared by every playbook: what a bot does with its
// hands, as opposed to what the playbook decides it should be doing. Grown
// out of the scripted Laner (ADR 0002 phase 1, kits v2, three playtest
// rounds): the dodge reflexes, hint-driven ability selection, predictive
// aim, role builds, recall discipline, and the per-slot context every
// trigger and behavior reads. Pure over the observation; the only
// randomness is the movement jitter, drawn through the sim's Rng at most
// once per slot, the first time a behavior asks for it.

import type { AbilityDef } from '../combat/casting';
import { type ChampionHints, hintsFor } from '../content/bots/hints';
import { CHAMPIONS } from '../content/champions';
import { effectiveItemCost } from '../content/items';
import { GAME_MAP } from '../content/map';
import type { Action, Observation, ObsSelf, ObsUnit } from '../policy';
import type { Rng } from '../rng';

type ChampionDef = NonNullable<(typeof CHAMPIONS)[string]>;

// Tuning shared by the reflexes and the default behavior parameters. The
// comments on each are the playtest findings that set them.
export const RETREAT_HP_FRAC = 0.32;
// 0.7, down from 0.85: bots leave the fountain sooner, so lanes stand
// empty less often (pacing review).
export const REJOIN_HP_FRAC = 0.7;
export const CAST_RANGE = 7;
export const CHAMPION_ATTACK_RANGE = 9;
export const FARM_RANGE = 8;
// Review F.0: towers reach ~9 plus radii and the bot attacked structures at
// range 8, diving to its death. It now stays out of tower reach unless its
// minions are soaking, and only sieges with an escort.
// 11.5, up from 11: real reach is attackRange 9 plus tower and champion
// radii, and the heaviest champions had a live sliver outside the band.
export const TOWER_DANGER_RANGE = 11.5;
export const ESCORT_RADIUS = 7;
export const ESCORT_MIN = 3;
export const KILL_SECURE_HP_FRAC = 0.3;
// Dodging: the bot's own body radius (champions run 0.6 to 0.75), how far a
// sidestep goes, how soon a projectile must arrive to be worth reacting to,
// and how close a windup's landing spot must be to step off it.
const SELF_RADIUS = 0.75;
const DODGE_STEP = 2.6;
const DODGE_ETA_S = 1.0;
const WINDUP_DANGER_RADIUS = 3.4;
// Recall discipline (playtest round 3: bots parked beside their own Sanctum
// channeling, canceling, and rechanneling forever). Break-even: an 8 s
// channel at moveSpeed ~3.7 only beats walking past roughly 29 units, so
// closer than this the bot walks home instead.
export const RECALL_MIN_HOME_DIST = 30;
// Start a channel only when the spot is genuinely clear: no enemy champion
// near or freshly remembered, and no enemy minions (their aggro breaks the
// channel just as surely, and the bot used to restart on the same spot
// without ever understanding why it kept dying).
const RECALL_CLEAR_CHAMP_RANGE = 18;
const RECALL_CLEAR_MEMORY_RANGE = 16;
const RECALL_CLEAR_MINION_RANGE = 8;
// Once channeling, hold unless an enemy champion is close enough to
// actually break it. The gap between 18 and 10 is the hysteresis that kills
// the start/cancel/restart oscillation an enemy hovering on one radius
// used to produce.
const RECALL_BREAK_RANGE = 10;
// Go home to spend once the bank comfortably covers the next build step
// (snowball review, round 2: the only recall trigger was low HP, so kill
// gold sat unspent and a lead never became items).
export const SHOP_TRIP_GOLD = 1000;
// Mid game macro: converge on a live Warden, pre-position at the nearest
// pit shortly before the clock strikes, and past the regroup bell every bot
// pushes mid as one group instead of five solo lanes forever.
export const WARDEN_APPROACH_RANGE = 40;
export const WARDEN_PREP_S = 20;
export const WARDEN_PREP_RANGE = 55;
export const WARDEN_FIGHT_HP_FRAC = 0.5;
export const REGROUP_AT_S = 12 * 60;
// The movement jitter's half-width, in units.
const JITTER = 1.5;

export function dist(ax: number, az: number, b: ObsUnit): number {
  return Math.hypot(b.x - ax, b.z - az);
}

export function nearest(list: ObsUnit[], x: number, z: number): ObsUnit | null {
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

// A hard-CC'd target cannot dodge: skillshots against it are free hits, so
// it is both the preferred victim and the one aimed at directly.
export function hardCCd(u: ObsUnit, time: number): boolean {
  return (u.statuses ?? []).some(
    (s) => (s.kind === 'stun' || s.kind === 'root' || s.kind === 'airborne') && s.until > time,
  );
}

// Predictive aim (kits-v2 bots): lead a skillshot by the target's observed
// velocity over the bolt's flight time; anything else fires at the body.
// The lead never reaches past the bolt's max range.
function aimAt(
  s: ObsSelf,
  target: ObsUnit,
  def: AbilityDef,
  time: number,
): { x: number; z: number } {
  const spec = def.spec;
  if (spec.kind !== 'skillshot' || hardCCd(target, time)) return { x: target.x, z: target.z };
  const d = Math.hypot(target.x - s.x, target.z - s.z);
  const eta = d / spec.speed;
  const px = target.x + (target.vx ?? 0) * eta;
  const pz = target.z + (target.vz ?? 0) * eta;
  const pd = Math.hypot(px - s.x, pz - s.z);
  if (pd > spec.range) {
    const k = spec.range / pd;
    return { x: s.x + (px - s.x) * k, z: s.z + (pz - s.z) * k };
  }
  return { x: px, z: pz };
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

// Hint-driven ability selection against the target champion. The generic
// rules per role; the per-champion intent lives in hints.ts.
export function pickCast(ctx: SlotContext, champ: ObsUnit): Action | null {
  const { s, obs, def, hints, enemyChampions } = ctx;
  if (!def) return null;
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
      const aim = aimAt(s, champ, r, obs.time);
      return { kind: 'cast', key: 'R', x: aim.x, z: aim.z };
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
    if (dc <= range && dc >= minR) {
      const aim = aimAt(s, champ, def.abilities[key], obs.time);
      return { kind: 'cast', key, x: aim.x, z: aim.z };
    }
  }
  return null;
}

// Deterministic ROLE-AWARE build plans that CAN buy duplicate components
// (review F.0: the old list never completed a two-component recipe; the
// snowball review found every bot on every champion building full tank).
// Returns the next item id to buy, or null when the build is done.
export function nextPurchase(items: readonly string[], championId: string | null): string | null {
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

// The next affordable step of the role build, null when there is none.
export function affordablePurchase(s: ObsSelf): string | null {
  if (s.items.length >= 6) return null;
  const wanted = nextPurchase(s.items, s.championId);
  if (wanted && s.gold >= effectiveItemCost(wanted, s.items)) return wanted;
  return null;
}

type Fountain = (typeof GAME_MAP.fountains)[number];
type Sanctum = (typeof GAME_MAP.sanctums)[number];

// Everything a slot's triggers and behaviors read, computed once from the
// observation. Pure except `jitter`, which draws from the sim's Rng the
// first time it is asked and then repeats the same pair for the slot.
export interface SlotContext {
  readonly obs: Observation;
  readonly s: ObsSelf;
  readonly def: ChampionDef | undefined;
  readonly hints: ChampionHints;
  readonly fountain: Fountain;
  readonly enemySanctum: Sanctum;
  readonly enemyTowers: ObsUnit[];
  readonly enemies: ObsUnit[];
  readonly enemyChampions: ObsUnit[];
  readonly friendlyMinions: ObsUnit[];
  // The fight target: a hard-CC'd enemy champion in attack range beats the
  // merely nearest one (every cast against it lands while the CC holds).
  readonly champ: ObsUnit | null;
  readonly atFountain: boolean;
  // Enemy towers are always visible; every voluntary step must know whether
  // it lands inside one's reach (playtest round 2: bots strolled under
  // towers via dodges, pursuit, and wave-following).
  inTowerReach(x: number, z: number): boolean;
  escortAt(x: number, z: number): number;
  // Clear enough to START an 8 second channel here: no enemy champion near
  // or freshly remembered, no enemy minions in aggro reach (their damage
  // breaks the channel too), and out of tower fire.
  recallClear(): boolean;
  distHome(): number;
  jitter(): { jx: number; jz: number };
}

export function buildSlotContext(obs: Observation, rng: Rng): SlotContext {
  const s = obs.self;
  const fountain = GAME_MAP.fountains.find((f) => f.team === s.team)!;
  const enemySanctum = GAME_MAP.sanctums.find((c) => c.team !== s.team)!;
  const enemyTowers = obs.units.filter((u) => !u.friendly && u.kind === 'tower');
  const inTowerReach = (x: number, z: number): boolean =>
    enemyTowers.some((t) => Math.hypot(t.x - x, t.z - z) <= TOWER_DANGER_RANGE);
  const enemies = obs.units.filter((u) => !u.friendly);
  const friendlyMinions = obs.units.filter((u) => u.friendly && u.kind === 'minion');
  const escortAt = (x: number, z: number): number =>
    friendlyMinions.filter((m) => Math.hypot(m.x - x, m.z - z) <= ESCORT_RADIUS).length;
  const enemyChampions = enemies.filter((u) => u.kind === 'champion');
  const ccdTarget = enemyChampions
    .filter((u) => hardCCd(u, obs.time) && dist(s.x, s.z, u) <= CHAMPION_ATTACK_RANGE)
    .sort((a, b) => dist(s.x, s.z, a) - dist(s.x, s.z, b))[0];
  const champ = ccdTarget ?? nearest(enemyChampions, s.x, s.z);
  const atFountain = Math.hypot(s.x - fountain.x, s.z - fountain.z) <= fountain.r + 2;
  const recallClear = (): boolean =>
    !obs.units.some(
      (u) =>
        !u.friendly &&
        ((u.kind === 'champion' && Math.hypot(u.x - s.x, u.z - s.z) <= RECALL_CLEAR_CHAMP_RANGE) ||
          (u.kind === 'minion' && Math.hypot(u.x - s.x, u.z - s.z) <= RECALL_CLEAR_MINION_RANGE)),
    ) &&
    !(obs.lastSeen ?? []).some(
      (ls) =>
        obs.time - ls.at <= 3 && Math.hypot(ls.x - s.x, ls.z - s.z) <= RECALL_CLEAR_MEMORY_RANGE,
    ) &&
    !inTowerReach(s.x, s.z);
  let drawn: { jx: number; jz: number } | null = null;
  return {
    obs,
    s,
    def: s.championId ? CHAMPIONS[s.championId] : undefined,
    hints: hintsFor(s.championId),
    fountain,
    enemySanctum,
    enemyTowers,
    enemies,
    enemyChampions,
    friendlyMinions,
    champ,
    atFountain,
    inTowerReach,
    escortAt,
    recallClear,
    distHome: () => Math.hypot(s.x - fountain.x, s.z - fountain.z),
    jitter: () => {
      if (!drawn) {
        drawn = { jx: (rng.next() * 2 - 1) * JITTER, jz: (rng.next() * 2 - 1) * JITTER };
      }
      return drawn;
    },
  };
}

// The point `len` units from the bot toward home.
export function homewardPoint(ctx: SlotContext, len: number): { x: number; z: number } {
  const { s, fountain } = ctx;
  const dh = Math.hypot(fountain.x - s.x, fountain.z - s.z) || 1;
  return {
    x: s.x + ((fountain.x - s.x) / dh) * len,
    z: s.z + ((fountain.z - s.z) / dh) * len,
  };
}

// A step of `len` units from the bot toward home.
export function towardHome(ctx: SlotContext, len: number): Action {
  const p = homewardPoint(ctx, len);
  return { kind: 'move', x: p.x, z: p.z };
}

// Dodge before anything else: the observation carries threats, and a
// sidestep is free (movement is never budgeted). Skillshots on a collision
// course get a perpendicular step; hostile zones get walked out of; an
// enemy windup landing here gets stepped off. No dodge may carry the bot
// INTO tower fire: a bolt hurts less than a ramping turret.
export function dodge(ctx: SlotContext): Action | null {
  const { s, obs, inTowerReach } = ctx;
  for (const p of obs.projectiles ?? []) {
    if (p.friendly || p.homing) continue;
    const relX = s.x - p.x;
    const relZ = s.z - p.z;
    const along = relX * p.dirX + relZ * p.dirZ;
    if (along < 0) continue;
    if (along / Math.max(1, p.speed) > DODGE_ETA_S) continue;
    const lateral = relX * -p.dirZ + relZ * p.dirX;
    if (Math.abs(lateral) > p.radius + SELF_RADIUS + 0.5) continue;
    // Step out on the side the bolt already misses toward, unless that
    // side is under a tower and this one is not.
    const side = lateral >= 0 ? 1 : -1;
    let mx = s.x - p.dirZ * side * DODGE_STEP;
    let mz = s.z + p.dirX * side * DODGE_STEP;
    if (inTowerReach(mx, mz) && !inTowerReach(s.x, s.z)) {
      mx = s.x + p.dirZ * side * DODGE_STEP;
      mz = s.z - p.dirX * side * DODGE_STEP;
    }
    return { kind: 'move', x: mx, z: mz };
  }
  for (const zn of obs.zones ?? []) {
    if (zn.friendly) continue;
    const d = Math.hypot(s.x - zn.x, s.z - zn.z);
    if (d > zn.radius + SELF_RADIUS) continue;
    const ux = d > 0.05 ? (s.x - zn.x) / d : 1;
    const uz = d > 0.05 ? (s.z - zn.z) / d : 0;
    const out = zn.radius + SELF_RADIUS + 1.0;
    const mx = zn.x + ux * out;
    const mz = zn.z + uz * out;
    if (inTowerReach(mx, mz) && !inTowerReach(s.x, s.z)) {
      // The radial escape leads under a tower: leave toward home instead.
      return towardHome(ctx, out);
    }
    return { kind: 'move', x: mx, z: mz };
  }
  for (const e of obs.units) {
    if (e.friendly || e.kind !== 'champion' || !e.windup) continue;
    const d = Math.hypot(s.x - e.windup.x, s.z - e.windup.z);
    if (d > WINDUP_DANGER_RADIUS) continue;
    const ux = d > 0.05 ? (s.x - e.windup.x) / d : 1;
    const uz = d > 0.05 ? (s.z - e.windup.z) / d : 0;
    const mx = s.x + ux * DODGE_STEP;
    const mz = s.z + uz * DODGE_STEP;
    if (inTowerReach(mx, mz) && !inTowerReach(s.x, s.z)) return towardHome(ctx, DODGE_STEP);
    return { kind: 'move', x: mx, z: mz };
  }
  return null;
}

// ADR 0005: a banked recast is the way home. Press it the moment staying
// committed stops being worth it.
export function recastHome(ctx: SlotContext): Action | null {
  const { s, hints } = ctx;
  if (
    s.recastArmed &&
    hints.recastHomeBelow !== undefined &&
    s.hpFrac < hints.recastHomeBelow &&
    s.abilityReady[s.recastArmed]
  ) {
    return { kind: 'cast', key: s.recastArmed, x: s.x, z: s.z };
  }
  return null;
}

// Spend skill points as soon as they exist: R at its level gates (6/11/16),
// then Q > W > E. A free action, but one decision slot this period.
export function levelUp(ctx: SlotContext): Action | null {
  const { s } = ctx;
  if (s.skillPoints > 0) {
    const ultGate = [6, 11, 16][s.abilityRanks.R];
    if (ultGate !== undefined && s.level >= ultGate) return { kind: 'level', key: 'R' };
    for (const key of ['Q', 'W', 'E'] as const) {
      if (s.abilityRanks[key] < 5) return { kind: 'level', key };
    }
  }
  return null;
}

// A running channel is an investment: hold it with noop unless an enemy
// champion is close enough to break it anyway. Every order a play issues
// resets the 8 second clock (sim cancelRecall), so passing through here IS
// the cancel decision.
export function holdRecall(ctx: SlotContext): Action | null {
  const { s, obs } = ctx;
  if (!s.recalling) return null;
  const breaker =
    obs.units.some(
      (u) =>
        !u.friendly &&
        u.kind === 'champion' &&
        Math.hypot(u.x - s.x, u.z - s.z) <= RECALL_BREAK_RANGE,
    ) ||
    (obs.lastSeen ?? []).some(
      (ls) => obs.time - ls.at <= 2 && Math.hypot(ls.x - s.x, ls.z - s.z) <= RECALL_BREAK_RANGE,
    );
  return breaker ? null : { kind: 'noop' };
}

// The slot of the sigil with this id, when it is ready; -1 otherwise.
export function readySigil(s: ObsSelf, id: string): number {
  return s.sigils.findIndex((sid, i) => sid === id && s.sigilReady[i] === true);
}

// The closest point of a lane's polyline to (x, z).
export function laneDistance(lane: readonly { x: number; z: number }[], x: number, z: number) {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < lane.length; i++) {
    const a = lane[i]!;
    const b = lane[i + 1]!;
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / len2));
    best = Math.min(best, Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)));
  }
  return best;
}
