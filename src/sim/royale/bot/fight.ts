// The battle royale bot's hands in a fight, on the sphere: the odds of a
// fight from what its sight shows (health, level, items, the enemy's
// health), the target, the cast, aimed where the target will be the way
// the house bots aim (playbook/micro.ts: the lead over the bolt's flight,
// a hard-CC'd target hit where it stands, the reach read off the spell),
// the escape, the kite. Every distance a chord (src/sim/geo.ts).

import type { AbilityDef } from '../../combat/casting';
import { ITEMS } from '../../content/items';
import { addScaled, dirTo, dist, dot, norm, scale, unit, type Vec3 } from '../../geo';
import { abilityRange, CHAMPION_ATTACK_RANGE, hardCCd, readySigil } from '../../playbook/micro';
import { LEVEL_WEIGHT } from '../../playbook/odds';
import type { Action, ObsUnit } from '../../policy';
import type { Rng } from '../../rng';
import { depthInside, insideCap } from '../dusk';
import { along, randomHeading } from '../layout';
import { p3, type Sense } from './sense';

// How far around the bot the odds count champions.
export const ODDS_RADIUS = 16;
// An item's weight in the odds: a thousand of its price counts a tenth.
const ITEM_WEIGHT_PER_1000 = 0.1;

export function itemPower(items: readonly string[] | undefined): number {
  let cost = 0;
  for (const id of items ?? []) cost += ITEMS[id]?.cost ?? 0;
  return (cost / 1000) * ITEM_WEIGHT_PER_1000;
}

// One champion's weight: health share, scaled by level and items.
export function strength(hpFrac: number, level: number | undefined, items?: readonly string[]) {
  const lvl = 1 + (Math.max(1, level ?? 1) - 1) * LEVEL_WEIGHT;
  return Math.max(0, hpFrac) * lvl * (1 + itemPower(items));
}

// How much a bystander weighs in a free-for-all's odds, and how many count:
// the others in reach are as busy with each other as with the bot, and a
// crowd is no more of a threat than the two nearest of it.
export const BYSTANDER_WEIGHT = 0.25;
export const BYSTANDERS = 2;

// The bot's share of the strength of a fight against `target`: 0.5 an even
// duel. The nearest other enemies in reach count too, at a bystander's
// weight, those within the skill's bystanderFullM at full weight (a
// strong bot reads the champion beside the fight as a third fighter);
// with no target, every enemy in reach at full weight.
export function royaleOdds(sense: Sense, target?: ObsUnit, within = ODDS_RADIUS): number {
  const own = strength(sense.s.hpFrac, sense.s.level, sense.s.items);
  let enemy = 0;
  let bystanders = 0;
  // sense.enemies is nearest first.
  for (const e of sense.enemies) {
    if (target !== undefined && e.id === target.id) {
      enemy += strength(e.hpFrac, e.level, e.items);
      continue;
    }
    const d = dist(sense.me, p3(e));
    if (d > within) continue;
    if (target === undefined || d <= sense.skill.bystanderFullM) {
      enemy += strength(e.hpFrac, e.level, e.items);
      continue;
    }
    if (bystanders >= BYSTANDERS) continue;
    bystanders++;
    enemy += BYSTANDER_WEIGHT * strength(e.hpFrac, e.level, e.items);
  }
  const total = own + enemy;
  return total > 0 ? own / total : 0.5;
}

// How a target weighs: its health share and its distance. Health once
// counted ten times a meter's 0.3, and a bot walked past an enemy at full
// health beside it to finish a low one fifteen meters off (a playtest,
// 2026-10-03: the bots only came for a champion someone else had worn
// down). A low enemy close by still comes first.
export const TARGET_HP_WEIGHT = 4;
export const TARGET_M_WEIGHT = 0.6;

// The target: a hard-CC'd enemy in reach first, else the best of health
// and distance within `reach` (the skill's chase unless told, or a reach
// per enemy); null when none is worth it. Never one standing in the dark.
export function pickTarget(
  sense: Sense,
  reach: number | ((e: ObsUnit) => number) = sense.skill.chase,
): ObsUnit | null {
  let best: ObsUnit | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const e of sense.enemies) {
    const at = p3(e);
    const d = dist(sense.me, at);
    if (d > (typeof reach === 'number' ? reach : reach(e))) continue;
    // Never into the dark, while there is light to stay in.
    if (sense.now.radius > 0 && !insideCap(sense.now, at)) continue;
    const ccd = hardCCd(e, sense.obs.time) && d <= CHAMPION_ATTACK_RANGE;
    const score = (ccd ? -10 : 0) + e.hpFrac * TARGET_HP_WEIGHT + d * TARGET_M_WEIGHT;
    if (score < bestScore || (score === bestScore && best !== null && e.id < best.id)) {
      best = e;
      bestScore = score;
    }
  }
  return best;
}

// Scatter: a point moved a random way by up to `m` meters.
function scatter(p: Vec3, m: number, rng: Rng, radius: number): Vec3 {
  if (m <= 0) return p;
  return along(p, randomHeading(rng, p), m * rng.next(), radius);
}

// Where to aim an ability at a target: a skillshot leads it by the
// skill's share of its motion over the bolt's flight, capped at the reach;
// anything else at the body. Then the skill's scatter.
export function aimAt(sense: Sense, target: ObsUnit, def: AbilityDef, rng: Rng): Vec3 {
  const R = sense.layout.radius;
  const at = p3(target);
  const spec = def.spec;
  let aim = at;
  if (spec.kind === 'skillshot' && !hardCCd(target, sense.obs.time)) {
    const v = { x: target.vx ?? 0, y: target.vy ?? 0, z: target.vz ?? 0 };
    const speed = norm(v);
    if (speed > 0.05) {
      const eta = dist(sense.me, at) / spec.speed;
      aim = along(at, scale(v, 1 / speed) as Vec3, speed * eta * sense.skill.aimLead, R);
    }
    const d = dist(sense.me, aim);
    if (d > spec.range) {
      const dir = dirTo(sense.me, aim);
      if (dir) aim = along(sense.me, dir as Vec3, spec.range, R);
    }
  }
  return scatter(aim, sense.skill.aimError, rng, R);
}

function cast(key: 'Q' | 'W' | 'E' | 'R', p: Vec3): Action {
  return { kind: 'cast', key, x: p.x, y: p.y, z: p.z };
}

// The cast against a target, the house bots' rules read on the sphere:
// the ultimate behind its gates (a duel against a hurt enemy opens it in a
// free-for-all), then Q, W, E by their roles; the escape held. Null when
// nothing is worth casting.
export function pickCast(
  sense: Sense,
  target: ObsUnit,
  rng: Rng,
  engage = true,
  ult = true,
): Action | null {
  const { s, def, hints } = sense;
  if (!def) return null;
  const at = p3(target);
  const d = dist(sense.me, at);
  if (ult && s.abilityReady.R && s.recastArmed !== 'R') {
    const r = def.abilities.R;
    const range = abilityRange(r);
    const minR = hints.minRange?.R ?? 0;
    const radius = hints.ult.radius ?? 5;
    const cluster = sense.enemies.filter((e) => dist(p3(e), at) <= radius).length;
    const gate =
      (hints.ult.minEnemies !== undefined && cluster >= hints.ult.minEnemies) ||
      (hints.ult.targetHpBelow !== undefined && target.hpFrac < hints.ult.targetHpBelow) ||
      (target.hpFrac < 0.6 && target.hpFrac < s.hpFrac);
    if (gate && d <= range && d >= minR) return cast('R', aimAt(sense, target, r, rng));
  }
  for (const key of ['Q', 'W', 'E'] as const) {
    if (!s.abilityReady[key]) continue;
    const role = hints.keys[key];
    if (role === 'escape') continue;
    const ability = def.abilities[key];
    // A cast that needs an ally to land on is never pressed: in a
    // free-for-all there is none (Dain's Cinder Guard).
    if (ability.spec.kind === 'dash' && ability.spec.toAlly) continue;
    const range = abilityRange(ability);
    const minR = hints.minRange?.[key] ?? 0;
    if (role === 'steroid') {
      if (d <= sense.attackRange + 2) return cast(key, sense.me);
      continue;
    }
    if (role === 'heal') {
      if (s.hpFrac < 0.65) return cast(key, sense.me);
      continue;
    }
    if (role === 'wall') {
      if (target.hpFrac < 0.5 && d <= range) return cast(key, at);
      continue;
    }
    if (role === 'engage' && (s.hpFrac < 0.5 || !engage)) continue;
    if (d <= range && d >= minR) return cast(key, aimAt(sense, target, ability, rng));
  }
  return null;
}

// The way out: away from the enemies in sight, bent toward the light's
// center when the straight way would leave it.
export function awayPoint(sense: Sense, len: number): Vec3 {
  const R = sense.layout.radius;
  let ax = 0;
  let ay = 0;
  let az = 0;
  for (const e of sense.enemies) {
    const d = dirTo(sense.me, p3(e));
    if (!d) continue;
    const w = 1 / Math.max(1, dist(sense.me, p3(e)));
    ax -= d.x * w;
    ay -= (d.y ?? 0) * w;
    az -= d.z * w;
  }
  const inward = sense.now.radius > 0 ? dirTo(sense.me, sense.now.center) : null;
  let dir: Vec3 | null = null;
  const n = norm({ x: ax, y: ay, z: az });
  if (n > 1e-6) dir = { x: ax / n, y: ay / n, z: az / n };
  if (dir && inward) {
    const out = along(sense.me, dir, len, R);
    if (depthInside(sense.now, out) < 3) {
      const mixed = addScaled(dir, inward, 1.5);
      dir = norm(mixed) > 1e-6 ? (unit(mixed) as Vec3) : (inward as Vec3);
    }
  }
  if (!dir) dir = (inward as Vec3 | null) ?? null;
  return dir ? along(sense.me, dir, len, R) : sense.me;
}

// The escape: the way out cast (exitCast), the Mend when hurt. Null when
// none is ready.
export function escapeCast(sense: Sense): Action | null {
  const out = exitCast(sense);
  if (out) return out;
  const mend = readySigil(sense.s, 'mend');
  if (mend !== -1 && sense.s.hpFrac < 0.5) {
    return { kind: 'sigil', slot: mend, x: sense.me.x, y: sense.me.y, z: sense.me.z };
  }
  return null;
}

// A cast that takes the bot out of a fight: the escape key or the
// Riftstep toward the way out, else the Zephyr's stride. Null when none is
// ready.
export function exitCast(sense: Sense): Action | null {
  const { s, def, hints } = sense;
  if (def) {
    for (const key of ['Q', 'W', 'E'] as const) {
      if (hints.keys[key] !== 'escape' || !s.abilityReady[key]) continue;
      const p = awayPoint(sense, abilityRange(def.abilities[key]));
      return cast(key, p);
    }
  }
  const rift = readySigil(s, 'riftstep');
  if (rift !== -1) {
    const p = awayPoint(sense, 5.5);
    return { kind: 'sigil', slot: rift, x: p.x, y: p.y, z: p.z };
  }
  const zephyr = readySigil(s, 'zephyr');
  if (zephyr !== -1) {
    return { kind: 'sigil', slot: zephyr, x: sense.me.x, y: sense.me.y, z: sense.me.z };
  }
  return null;
}

// An enemy walking away from the bot faster than this is leaving a fight.
export const FLEEING_SPEED = 1;
// The commit (bots with intent): a winning bot keeps after a leaving
// enemy out to its skill's chase plus COMMIT_M while it can catch it:
// under COMMIT_HP, no faster than the bot, or a dash or the Zephyr ready.
// The trades that let a fleeing enemy go left One life's duels unended
// (3 of 40 ended in a death within 45 s, the duel probes of 2026-10-03).
export const COMMIT_M = 4;
export const COMMIT_HP = 0.4;

function velocity(e: ObsUnit): Vec3 {
  return { x: e.vx ?? 0, y: e.vy ?? 0, z: e.vz ?? 0 };
}

// How fast an enemy walks away from the bot, meters a second (negative
// when it comes closer).
export function awaySpeed(sense: Sense, e: ObsUnit): number {
  const dir = dirTo(sense.me, p3(e));
  if (!dir) return 0;
  const v = velocity(e);
  return dot(v, dir);
}

export function leaving(sense: Sense, e: ObsUnit): boolean {
  return awaySpeed(sense, e) >= FLEEING_SPEED;
}

// A dash of its own kit ready (one that lands on an enemy or a point, not
// on an ally).
export function dashReady(sense: Sense): boolean {
  const { s, def } = sense;
  if (!def) return false;
  for (const key of ['Q', 'W', 'E'] as const) {
    if (!s.abilityReady[key]) continue;
    const spec = def.abilities[key].spec;
    if (spec.kind === 'dash' && !spec.toAlly) return true;
  }
  return false;
}

// Whether the bot can catch a leaving enemy.
export function canCatch(sense: Sense, e: ObsUnit): boolean {
  if (e.hpFrac < COMMIT_HP) return true;
  if (sense.speed + 1e-9 >= norm(velocity(e))) return true;
  return dashReady(sense) || readySigil(sense.s, 'zephyr') !== -1;
}

// How far the bot follows this enemy: past its chase while it is leaving
// and can be caught.
export function chaseReach(sense: Sense, e: ObsUnit): number {
  const chase = sense.skill.chase;
  return leaving(sense, e) && canCatch(sense, e) ? chase + COMMIT_M : chase;
}

// The exits of a losing fight (bots with intent): a cast that takes the
// bot out (exitCast); a launch pad within EXIT_PAD_M, in the light, that
// the bot reaches before its pursuer; another enemy within EXIT_THIRD_M
// that the bot reaches before its pursuer does, so the pursuer runs into
// a third fighter. Turning its back with none of these handed the pursuer
// a free kill (a playtest, 2026-10-03).
export const EXIT_PAD_M = 15;
export const EXIT_THIRD_M = 12;
// With no exit, a hurt bot answers at odds this far under its nerve.
export const NO_EXIT_MARGIN = 0.2;

export function exitPad(sense: Sense, pursuer: ObsUnit | null): Vec3 | null {
  let best: Vec3 | null = null;
  let bestD = EXIT_PAD_M;
  for (const pad of sense.r.pads) {
    const d = dist(sense.me, pad.at);
    if (d > bestD) continue;
    if (sense.now.radius > 0 && (!insideCap(sense.now, pad.at) || !insideCap(sense.now, pad.to))) {
      continue;
    }
    if (pursuer && dist(p3(pursuer), pad.at) <= d) continue;
    best = pad.at;
    bestD = d;
  }
  return best;
}

export function exitThird(sense: Sense, pursuer: ObsUnit | null): ObsUnit | null {
  if (!pursuer) return null;
  let best: ObsUnit | null = null;
  for (const e of sense.enemies) {
    if (e.id === pursuer.id) continue;
    const d = dist(sense.me, p3(e));
    if (d > EXIT_THIRD_M) break;
    if (dist(p3(pursuer), p3(e)) <= d) continue;
    if (sense.now.radius > 0 && !insideCap(sense.now, p3(e))) continue;
    best = e;
    break;
  }
  return best;
}

// The way out of a losing fight from `pursuer`, or null when there is none.
export function exitFrom(sense: Sense, pursuer: ObsUnit | null): Action | null {
  const out = exitCast(sense);
  if (out) return out;
  const pad = exitPad(sense, pursuer);
  if (pad) return { kind: 'move', x: pad.x, y: pad.y, z: pad.z };
  const third = exitThird(sense, pursuer);
  if (third) return { kind: 'move', x: third.x, y: third.y ?? 0, z: third.z };
  return null;
}

// How far the Zephyr's chase reaches, and the Sear's finish.
export const ZEPHYR_CHASE_M = 10;
export const SEAR_HP = 0.35;
export const SEAR_M = 7;

// A sigil worth pressing mid-fight: the Mend when hurt, the Sear on a
// target low enough to finish, the Zephyr after a target leaving reach.
export function fightSigil(sense: Sense, target?: ObsUnit): Action | null {
  const mend = readySigil(sense.s, 'mend');
  if (mend !== -1 && sense.s.hpFrac < 0.45) {
    return { kind: 'sigil', slot: mend, x: sense.me.x, y: sense.me.y, z: sense.me.z };
  }
  if (!target) return null;
  const at = p3(target);
  const d = dist(sense.me, at);
  const sear = readySigil(sense.s, 'sear');
  if (sear !== -1 && target.hpFrac < SEAR_HP && d <= SEAR_M) {
    return { kind: 'sigil', slot: sear, x: at.x, y: at.y, z: at.z };
  }
  const zephyr = readySigil(sense.s, 'zephyr');
  if (
    zephyr !== -1 &&
    d <= ZEPHYR_CHASE_M &&
    d > sense.attackRange + 0.5 &&
    leaving(sense, target)
  ) {
    return { kind: 'sigil', slot: zephyr, x: sense.me.x, y: sense.me.y, z: sense.me.z };
  }
  return null;
}
