// The battle royale bot's hands in a fight, on the sphere: the odds of a
// fight from what its sight shows (health, level, items, the enemy's
// health), the target, the cast, aimed where the target will be the way
// the house bots aim (playbook/micro.ts: the lead over the bolt's flight,
// a hard-CC'd target hit where it stands, the reach read off the spell),
// the escape, the kite. Every distance a chord (src/sim/geo.ts).

import type { AbilityDef } from '../../combat/casting';
import { ITEMS } from '../../content/items';
import { dirTo, dist, norm, scale, type Vec3 } from '../../geo';
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
// weight; with no target, every enemy in reach at full weight.
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
    if (dist(sense.me, p3(e)) > within) continue;
    if (target === undefined) {
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

// The target: a hard-CC'd enemy in reach first, else the weakest in chase
// reach weighed by distance; null when none is worth it. Never one standing
// in the dark.
export function pickTarget(sense: Sense): ObsUnit | null {
  let best: ObsUnit | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const e of sense.enemies) {
    const at = p3(e);
    const d = dist(sense.me, at);
    if (d > sense.skill.chase) continue;
    // Never into the dark, while there is light to stay in.
    if (sense.now.radius > 0 && !insideCap(sense.now, at)) continue;
    const ccd = hardCCd(e, sense.obs.time) && d <= CHAMPION_ATTACK_RANGE;
    const score = (ccd ? -10 : 0) + e.hpFrac * 10 + d * 0.3;
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
  const n = Math.sqrt(ax * ax + ay * ay + az * az);
  if (n > 1e-6) dir = { x: ax / n, y: ay / n, z: az / n };
  if (dir && inward) {
    const out = along(sense.me, dir, len, R);
    if (depthInside(sense.now, out) < 3) {
      const mx = dir.x + inward.x * 1.5;
      const my = dir.y + (inward.y ?? 0) * 1.5;
      const mz = dir.z + inward.z * 1.5;
      const m = Math.sqrt(mx * mx + my * my + mz * mz);
      dir = m > 1e-6 ? { x: mx / m, y: my / m, z: mz / m } : (inward as Vec3);
    }
  }
  if (!dir) dir = (inward as Vec3 | null) ?? null;
  return dir ? along(sense.me, dir, len, R) : sense.me;
}

// The escape: the escape key or the Riftstep toward the way out, the Mend
// when hurt. Null when none is ready.
export function escapeCast(sense: Sense): Action | null {
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
  const mend = readySigil(s, 'mend');
  if (mend !== -1 && s.hpFrac < 0.5) {
    return { kind: 'sigil', slot: mend, x: sense.me.x, y: sense.me.y, z: sense.me.z };
  }
  return null;
}

// A sigil worth pressing mid-fight: the Mend when hurt.
export function fightSigil(sense: Sense): Action | null {
  const mend = readySigil(sense.s, 'mend');
  if (mend !== -1 && sense.s.hpFrac < 0.45) {
    return { kind: 'sigil', slot: mend, x: sense.me.x, y: sense.me.y, z: sense.me.z };
  }
  return null;
}
