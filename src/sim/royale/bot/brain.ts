// The battle royale bot's decision, one per slot (ADR 0031): a Policy's
// body, deterministic over (observation, rng) and blind past what its own
// sight shows. In order: the drop's pick; out of the dark; the dodge; the
// fight when an enemy in sight is noticed (backing off and kiting when low,
// finishing a low enemy, never chasing into the Dusk); holding still while
// a cache opens; ahead of the Dusk's next cap; the nearest cache; a camp
// when nothing better is near; the big creatures for a strong bot strong
// enough; the light's heart. Its skill (content/bots/royale_skills.ts)
// slows its eye, scatters its aim and sets its nerve.

import type { RoyaleSkill } from '../../content/bots/royale_skills';
import { dist, dot, norm, scale, turnLeft, type Vec3 } from '../../geo';
import { KITE_DANGER_FRAC, KITE_STEP, RANGED_MIN_RANGE } from '../../playbook/micro';
import type { Action, Observation, ObsUnit } from '../../policy';
import type { Rng } from '../../rng';
import { depthInside } from '../dusk';
import { along, type RoyaleLayout } from '../layout';
import { pickDropPoint } from './drop_pick';
import { awayPoint, escapeCast, fightSigil, pickCast, pickTarget, royaleOdds } from './fight';
import { buildSense, p3, type Sense } from './sense';
import {
  beatDusk,
  CACHE_NEAR_M,
  leaveDark,
  lootCache,
  moveTo,
  pickCache,
  pickCampSpot,
  roam,
} from './travel';

const NOOP: Action = { kind: 'noop' };
// Health share a target must be under for the bot to finish it whatever
// the odds say.
export const FINISH_HP = 0.25;
// An enemy this close counts as on top of the bot when it backs off.
export const DANGER_M = 11;
// Once the light is this small, every bot's nerve rises by this much.
export const LAST_LIGHT_M = 20;
export const LAST_LIGHT_NERVE = 0.15;
// One life's caution: the odds a fight needs, and the health under which
// a bot backs off, both rise by this much. Small: at 0.1 two even bots
// passed each other by, and a playtest (2026-10-03) saw bots that never
// fought one another.
export const ONE_LIFE_CAUTION = 0.06;
// How much better than its nerve the odds must be for a bot to START a
// fight, by the Dusk's phase (0 the calm, 1 to 5 the closings, 6 dark):
// the calm is for looting, each closing brings fights on, and the last
// light takes them all. A hit is answered and a low enemy finished in
// every phase. Without it the bots either ignored each other until the
// Dusk crammed them in (a playtest, 2026-10-03) or turned the drop into a
// bloodbath that ended One life in three minutes.
export const PHASE_NERVE: readonly number[] = [0.12, 0.08, 0.05, 0.03, 0.01, 0, 0];
// An even fight (odds within EVEN_ODDS of the bot's nerve) is not refused
// for good: each decision with one in sight the bot starts it with this
// chance, by the Dusk's phase, so the takedowns come all along the match
// rather than all at once when the light corners everyone.
export const EVEN_ODDS = 0.06;
// A far stronger enemy this close is run from before it strikes: a fed
// champion otherwise walked through a crowd that waited its turn (one took
// thirty takedowns in under three minutes). The odds against it alone.
export const FLEE_ODDS = 0.3;
export const FLEE_M = 10;
export const EVEN_FIGHT_CHANCE: readonly number[] = [0.004, 0.01, 0.018, 0.03, 0.05, 0.1, 0.3];
// A camp body this close is worth hitting.
export const CAMP_FIGHT_M = 14;
// The bot's own health share to take a camp.
export const CAMP_HP = 0.5;

const SELF_RADIUS = 0.75;
const DODGE_STEP = 2.6;
const DODGE_ETA_S = 1.0;
const WINDUP_DANGER_RADIUS = 3.4;

function move(p: Vec3): Action {
  return { kind: 'move', x: p.x, y: p.y, z: p.z };
}

// The sidestep: a bolt on course, a hostile zone underfoot, a telegraph
// landing here. The skill decides whether the bot reacts at all.
export function dodge(sense: Sense, rng: Rng): Action | null {
  const R = sense.layout.radius;
  const me = sense.me;
  for (const p of sense.obs.projectiles ?? []) {
    if (p.friendly || p.homing) continue;
    const pos = { x: p.x, y: p.y ?? 0, z: p.z };
    const dir = { x: p.dirX, y: p.dirY ?? 0, z: p.dirZ };
    const rel = { x: me.x - pos.x, y: me.y - pos.y, z: me.z - pos.z };
    const ahead = dot(rel, dir);
    if (ahead < 0 || ahead / Math.max(1, p.speed) > DODGE_ETA_S) continue;
    const lat = { x: rel.x - dir.x * ahead, y: rel.y - dir.y * ahead, z: rel.z - dir.z * ahead };
    const lateral = norm(lat);
    if (lateral > p.radius + SELF_RADIUS + 0.5) continue;
    if (rng.next() >= sense.skill.dodge) return null;
    const side = lateral > 1e-3 ? (scale(lat, 1 / lateral) as Vec3) : (turnLeft(dir, me) as Vec3);
    return move(along(me, side, DODGE_STEP, R));
  }
  for (const zn of sense.obs.zones ?? []) {
    if (zn.friendly) continue;
    const at = p3(zn);
    const d = dist(me, at);
    if (d > zn.radius + SELF_RADIUS) continue;
    if (rng.next() >= sense.skill.dodge) return null;
    return move(awayFrom(sense, at, zn.radius + SELF_RADIUS + 1 - d));
  }
  for (const e of sense.enemies) {
    if (!e.windup) continue;
    const at = { x: e.windup.x, y: e.windup.y ?? 0, z: e.windup.z };
    if (dist(me, at) > WINDUP_DANGER_RADIUS) continue;
    if (rng.next() >= sense.skill.dodge) return null;
    return move(awayFrom(sense, at, DODGE_STEP));
  }
  return null;
}

function awayFrom(sense: Sense, from: Vec3, len: number): Vec3 {
  const R = sense.layout.radius;
  const rel = { x: sense.me.x - from.x, y: sense.me.y - from.y, z: sense.me.z - from.z };
  const n = norm(rel);
  if (n < 1e-6) return sense.me;
  return along(sense.me, scale(rel, 1 / n) as Vec3, Math.max(0.5, len), R);
}

// Backing off: the escape when there is one, else a step away.
function retreat(sense: Sense): Action {
  const esc = escapeCast(sense);
  if (esc) return esc;
  return moveTo(sense, awayPoint(sense, 6));
}

function fight(sense: Sense, target: ObsUnit, rng: Rng): Action {
  const c = pickCast(sense, target, rng);
  if (c) return c;
  const sigil = fightSigil(sense);
  if (sigil) return sigil;
  const { s, obs } = sense;
  const d = dist(sense.me, p3(target));
  if (
    sense.skill.kite &&
    sense.attackRange >= RANGED_MIN_RANGE &&
    (s.attackReadyAt ?? 0) > obs.time + 0.15 &&
    d < sense.attackRange * KITE_DANGER_FRAC
  ) {
    const step = awayPoint(sense, KITE_STEP);
    if (depthInside(sense.now, step) > 2) return move(step);
  }
  return { kind: 'attack', targetId: target.id };
}

// A camp body, or a big creature for a strong bot strong enough, in reach.
function neutralTarget(sense: Sense): ObsUnit | null {
  if (sense.s.hpFrac < CAMP_HP) return null;
  for (const n of sense.neutrals) {
    const d = dist(sense.me, p3(n));
    if (d > CAMP_FIGHT_M) break;
    if (depthInside(sense.now, p3(n)) < 2) continue;
    if (n.kind === 'camp') return n;
    if (sense.skill.creatures && sense.s.level >= 9 && sense.s.hpFrac >= 0.8) return n;
  }
  return null;
}

export function decide(
  obs: Observation,
  rng: Rng,
  layout: RoyaleLayout,
  skill: RoyaleSkill,
): Action {
  const r = obs.royale;
  if (!r) return NOOP;
  if (r.stage === 'drop') {
    if (r.drop) return NOOP;
    const p = pickDropPoint(layout, rng);
    return { kind: 'drop', x: p.x, y: p.y, z: p.z };
  }
  if (r.stage !== 'play' || obs.self.dead || r.flying) return NOOP;
  const sense = buildSense(obs, r, layout, skill);

  // Once the last light is out there is nowhere to go: no way out of the
  // dark, every fight is the last one.
  const lightsOut = sense.now.radius <= 0;
  const dark = lightsOut ? null : leaveDark(sense);
  if (dark) {
    if (sense.struck && sense.enemies.length > 0) {
      const esc = escapeCast(sense);
      if (esc) return esc;
    }
    return dark;
  }

  const sidestep = dodge(sense, rng);
  if (sidestep) return sidestep;

  if (sense.enemies.length > 0) {
    const noticed = sense.struck || rng.next() < skill.attention;
    if (noticed) {
      const near = sense.enemies.some((e) => dist(sense.me, p3(e)) <= DANGER_M);
      // The last light leaves nowhere to go: everyone's nerve rises, and a
      // hit is answered rather than run from.
      const cornered = lightsOut || sense.now.radius <= LAST_LIGHT_M;
      // One life: a death is the end, so every bot weighs a fight harder.
      const caution = r.variant === 'one_life' && !cornered ? ONE_LIFE_CAUTION : 0;
      const backOff = cornered ? skill.retreatHp / 2 : skill.retreatHp + caution;
      if (near && sense.s.hpFrac < backOff) return retreat(sense);
      if (!cornered) {
        const close = sense.enemies[0];
        if (
          close &&
          dist(sense.me, p3(close)) <= FLEE_M &&
          royaleOdds(sense, close, 0) < FLEE_ODDS
        ) {
          return retreat(sense);
        }
      }
      const target = pickTarget(sense);
      if (target) {
        const odds = royaleOdds(sense, target);
        const finish = target.hpFrac < FINISH_HP && sense.s.hpFrac > target.hpFrac;
        const nerve = skill.fightOdds + caution - (cornered ? LAST_LIGHT_NERVE : 0);
        const start = nerve + (PHASE_NERVE[r.dusk.phase] ?? 0);
        const even =
          odds >= nerve - EVEN_ODDS && rng.next() < (EVEN_FIGHT_CHANCE[r.dusk.phase] ?? 0);
        const answer = sense.struck && (cornered || odds >= nerve - 0.1);
        if (odds >= start || even || finish || answer) return fight(sense, target, rng);
      }
      if (near && sense.struck && !cornered) return retreat(sense);
    }
  }

  if (r.opening) return sense.s.dest ? { kind: 'stop' } : NOOP;

  const ahead = beatDusk(sense);
  if (ahead) return ahead;

  const cache = pickCache(sense, CACHE_NEAR_M);
  if (cache) return lootCache(sense, cache);

  const neutral = neutralTarget(sense);
  if (neutral) {
    const c = pickCast(sense, neutral, rng, true, false);
    if (c && sense.s.mana > sense.s.maxMana * 0.4) return c;
    return { kind: 'attack', targetId: neutral.id };
  }

  const camp = pickCampSpot(sense);
  if (camp && sense.s.hpFrac >= CAMP_HP) return moveTo(sense, camp);

  const far = pickCache(sense);
  if (far) return lootCache(sense, far);
  return roam(sense);
}
