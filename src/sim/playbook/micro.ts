// The engine's micro, shared by every playbook: what a bot does with its
// hands, as opposed to what the playbook decides it should be doing. Grown
// out of the scripted Laner (ADR 0002 phase 1, kits v2, three playtest
// rounds): the dodge reflexes, hint-driven ability selection, predictive
// aim, the kit walked to its next purchase, recall discipline, and the
// per-slot context every trigger and behavior reads. Pure over the observation; the only
// randomness is the movement jitter, drawn through the sim's Rng at most
// once per slot, the first time a behavior asks for it.

import type { AbilityDef } from '../combat/casting';
import { type ChampionHints, hintsFor } from '../content/bots/hints';
import { CHAMPIONS } from '../content/champions';
import { GAME_MAP, type GameMap } from '../content/map';
import { hypot } from '../exact';
import { onFountain } from '../fountain';
import type { Action, Observation, ObsSelf, ObsUnit } from '../policy';
import type { Rng } from '../rng';
import { type ActiveKit, resolveKit } from './kit';
import type { KitDef } from './types';

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
  return hypot(b.x - ax, b.z - az);
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
  const d = hypot(target.x - s.x, target.z - s.z);
  const eta = d / spec.speed;
  const px = target.x + (target.vx ?? 0) * eta;
  const pz = target.z + (target.vz ?? 0) * eta;
  const pd = hypot(px - s.x, pz - s.z);
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
// rules per role; the per-champion intent lives in hints.ts. With `engage`
// false the engage spell is held: an uncommitted fight (behaviors.ts) does
// not dash in.
export function pickCast(ctx: SlotContext, champ: ObsUnit, engage = true): Action | null {
  const { s, obs, def, hints, enemyChampions } = ctx;
  if (!def) return null;
  const dc = hypot(champ.x - s.x, champ.z - s.z);

  // The ultimate first, behind its gates: a held R is a threat, a wasted
  // one is a minute of nothing.
  if (s.abilityReady.R && s.recastArmed !== 'R') {
    const r = def.abilities.R;
    const range = abilityRange(r);
    const minR = hints.minRange?.R ?? 0;
    const cluster = enemyChampions.filter(
      (e) => hypot(e.x - champ.x, e.z - champ.z) <= (hints.ult.radius ?? 5),
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
      if (hurt && hypot(hurt.x - s.x, hurt.z - s.z) <= def.abilities[key].castRange) {
        return { kind: 'cast', key, x: hurt.x, z: hurt.z };
      }
      continue;
    }
    if (role === 'wall') {
      if (champ.hpFrac < 0.5 && dc <= range) return { kind: 'cast', key, x: champ.x, z: champ.z };
      continue;
    }
    if (role === 'engage' && (s.hpFrac < 0.5 || !engage)) continue;
    if (dc <= range && dc >= minR) {
      const aim = aimAt(s, champ, def.abilities[key], obs.time);
      return { kind: 'cast', key, x: aim.x, z: aim.z };
    }
  }
  return null;
}

// The fight's distance (ADR 0014). A champion whose attack range reaches
// this far is ranged and kites by default; a kite steps away from any enemy
// champion closer than this fraction of its own range, by this many units;
// a front stance chases a target this far; the lowest and squishiest target
// rules look this far around the bot.
export const RANGED_MIN_RANGE = 4;
export const KITE_DANGER_FRAC = 0.6;
export const KITE_STEP = 3.5;
export const CHASE_RANGE = 15;
// How far past its own range a kiting champion steps in to reach a target.
export const KITE_APPROACH = 4;
// An ally is in a fight when an enemy champion stands this close to it;
// a bot is beside an ally, or under a tower, within this much.
export const ENGAGED_RANGE = 10;
export const BESIDE_RANGE = 6;
// An allied champion this close counts as company for a walk-in.
export const ALONE_RANGE = 8;
// An enemy champion this close to an allied tower threatens it (the tower's
// danger band plus a step: a sieger stands at its edge).
export const TOWER_THREAT_RANGE = 16;
export const JOIN_RANGE = 40;
export const FIGHT_TARGET_RADIUS = 25;
// Own attack range when the observation predates the field.
const ATTACK_RANGE_FALLBACK = 6;

type Fountain = GameMap['fountains'][number];
type Sanctum = GameMap['sanctums'][number];

// Everything a slot's triggers and behaviors read, computed once from the
// observation. Pure except `jitter`, which draws from the sim's Rng the
// first time it is asked and then repeats the same pair for the slot.
export interface SlotContext {
  readonly obs: Observation;
  readonly s: ObsSelf;
  // The map the match is played on: lanes, pits and bases a play walks to.
  readonly map: GameMap;
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
  // Own attack range in units: what a kite holds.
  readonly attackRange: number;
  // On the own fountain as the sim sees it (src/sim/fountain.ts): where a
  // bot heals, buys and sells, which on the Star Orchard is the whole
  // spawn terrace.
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
  // Allied champions within the radius that have an enemy champion within
  // ENGAGED_RANGE of them, nearest first.
  engagedAllies(within: number): ObsUnit[];
  // An allied champion stands within ALONE_RANGE.
  besideAlly(): boolean;
  // Live allied towers within the radius with enemy champions in sight near
  // them (TOWER_THREAT_RANGE), the most threatened first, the nearest on a
  // tie, each with its count.
  threatenedTowers(within: number): { tower: ObsUnit; count: number }[];
  jitter(): { jx: number; jz: number };
  // The kit in force this slot (ADR 0014), resolved once when first asked.
  kit(): ActiveKit;
}

export function buildSlotContext(
  obs: Observation,
  rng: Rng,
  kitDef?: KitDef,
  map: GameMap = GAME_MAP,
): SlotContext {
  const s = obs.self;
  const fountain = map.fountains.find((f) => f.team === s.team)!;
  const enemySanctum = map.sanctums.find((c) => c.team !== s.team)!;
  const enemyTowers = obs.units.filter((u) => !u.friendly && u.kind === 'tower');
  const inTowerReach = (x: number, z: number): boolean =>
    enemyTowers.some((t) => hypot(t.x - x, t.z - z) <= TOWER_DANGER_RANGE);
  const enemies = obs.units.filter((u) => !u.friendly);
  const friendlyMinions = obs.units.filter((u) => u.friendly && u.kind === 'minion');
  const escortAt = (x: number, z: number): number =>
    friendlyMinions.filter((m) => hypot(m.x - x, m.z - z) <= ESCORT_RADIUS).length;
  const enemyChampions = enemies.filter((u) => u.kind === 'champion');
  const ccdTarget = enemyChampions
    .filter((u) => hardCCd(u, obs.time) && dist(s.x, s.z, u) <= CHAMPION_ATTACK_RANGE)
    .sort((a, b) => dist(s.x, s.z, a) - dist(s.x, s.z, b))[0];
  const champ = ccdTarget ?? nearest(enemyChampions, s.x, s.z);
  const atFountain = onFountain(fountain, { x: s.x, z: s.z });
  // A neutral body in reach counts like a minion: a bot that opened a
  // recall beside the creature it had been hitting was bitten out of the
  // channel, tried again, and stood there until the body reset (the rings'
  // round two, measured on the house bots).
  const recallClear = (): boolean =>
    !obs.units.some(
      (u) =>
        !u.friendly &&
        ((u.kind === 'champion' && hypot(u.x - s.x, u.z - s.z) <= RECALL_CLEAR_CHAMP_RANGE) ||
          ((u.kind === 'minion' || u.kind === 'warden' || u.kind === 'creature') &&
            hypot(u.x - s.x, u.z - s.z) <= RECALL_CLEAR_MINION_RANGE)),
    ) &&
    !(obs.lastSeen ?? []).some(
      (ls) => obs.time - ls.at <= 3 && hypot(ls.x - s.x, ls.z - s.z) <= RECALL_CLEAR_MEMORY_RANGE,
    ) &&
    !inTowerReach(s.x, s.z);
  let drawn: { jx: number; jz: number } | null = null;
  let resolved: ActiveKit | null = null;
  const ctx: SlotContext = {
    obs,
    s,
    map,
    def: s.championId ? CHAMPIONS[s.championId] : undefined,
    attackRange: s.attackRange ?? ATTACK_RANGE_FALLBACK,
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
    distHome: () => hypot(s.x - fountain.x, s.z - fountain.z),
    besideAlly: () =>
      obs.units.some(
        (u) => u.friendly && u.kind === 'champion' && dist(s.x, s.z, u) <= ALONE_RANGE,
      ),
    threatenedTowers: (within: number) => {
      const out: { tower: ObsUnit; count: number }[] = [];
      for (const t of obs.units) {
        if (!t.friendly || t.kind !== 'tower' || t.hpFrac <= 0) continue;
        if (dist(s.x, s.z, t) > within) continue;
        const count = enemyChampions.filter((e) => dist(t.x, t.z, e) <= TOWER_THREAT_RANGE).length;
        if (count > 0) out.push({ tower: t, count });
      }
      return out.sort(
        (a, b) => b.count - a.count || dist(s.x, s.z, a.tower) - dist(s.x, s.z, b.tower),
      );
    },
    engagedAllies: (within: number) =>
      obs.units
        .filter(
          (u) =>
            u.friendly &&
            u.kind === 'champion' &&
            dist(s.x, s.z, u) <= within &&
            enemyChampions.some((e) => dist(u.x, u.z, e) <= ENGAGED_RANGE),
        )
        .sort((a, b) => dist(s.x, s.z, a) - dist(s.x, s.z, b)),
    jitter: () => {
      if (!drawn) {
        drawn = { jx: (rng.next() * 2 - 1) * JITTER, jz: (rng.next() * 2 - 1) * JITTER };
      }
      return drawn;
    },
    kit: () => {
      if (!resolved) resolved = resolveKit(kitDef, s.championId, ctx);
      return resolved;
    },
  };
  return ctx;
}

// The point `len` units from the bot toward home.
export function homewardPoint(ctx: SlotContext, len: number): { x: number; z: number } {
  const { s, fountain } = ctx;
  const dh = hypot(fountain.x - s.x, fountain.z - s.z) || 1;
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
    const d = hypot(s.x - zn.x, s.z - zn.z);
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
    const d = hypot(s.x - e.windup.x, s.z - e.windup.z);
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
// then the kit's skill order (Q, W, E unless the owner said otherwise). A
// free action, but one decision slot this period.
export function levelUp(ctx: SlotContext): Action | null {
  const { s } = ctx;
  if (s.skillPoints > 0) {
    const ultGate = [6, 11, 16][s.abilityRanks.R];
    if (ultGate !== undefined && s.level >= ultGate) return { kind: 'level', key: 'R' };
    for (const key of ctx.kit().skills) {
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
        !u.friendly && u.kind === 'champion' && hypot(u.x - s.x, u.z - s.z) <= RECALL_BREAK_RANGE,
    ) ||
    (obs.lastSeen ?? []).some(
      (ls) => obs.time - ls.at <= 2 && hypot(ls.x - s.x, ls.z - s.z) <= RECALL_BREAK_RANGE,
    );
  return breaker ? null : { kind: 'noop' };
}

// The slot of the sigil with this id, when it is ready; -1 otherwise.
export function readySigil(s: ObsSelf, id: string): number {
  return s.sigils.findIndex((sid, i) => sid === id && s.sigilReady[i] === true);
}

export { laneDistance } from '../lanes';
