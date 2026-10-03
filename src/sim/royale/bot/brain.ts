// The battle royale bot's decision, one per slot (ADR 0031): a Policy's
// body, deterministic over (observation, rng) and blind past what its own
// sight shows. In order: the drop's pick; out of the dark; the dodge; the
// fight when an enemy in sight is noticed (running from a far stronger
// one, backing off when low and losing, the swing never thrown away, a
// kite between strikes, a low enemy finished, a fleeing one let go in One
// life's early trades, never a chase into the Dusk); holding still while
// a cache opens; ahead of the Dusk's next cap; the nearest cache; a camp
// when nothing better is near; the big creatures for a strong bot strong
// enough; a wander where it stands. Its skill (content/bots/
// royale_skills.ts) slows its eye, scatters its aim and sets its nerve.

import type { RoyaleSkill } from '../../content/bots/royale_skills';
import { dirTo, dist, dot, norm, scale, turnLeft, type Vec3 } from '../../geo';
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
// A far stronger enemy this close is run from before it strikes: a fed
// champion otherwise walked through a crowd that waited its turn (one took
// thirty takedowns in under three minutes). The odds against it alone.
export const FLEE_ODDS = 0.3;
export const FLEE_M = 10;
// How far under its nerve the odds may be for a struck bot to hit back
// rather than back off.
export const ANSWER_MARGIN = 0.1;
// The odds under which a hurt bot backs off: only from a fight it is
// losing. Backing off from every enemy in reach, two hurt bots that met
// circled one another without a blow (a playtest, 2026-10-03).
export const LOSING_ODDS = 0.5;
// One life, until the Dusk's SKIRMISH_UNTIL_PHASE: a fight between
// champions is a trade, the way the genre keeps its early game alive (its
// bots fight one another and seldom see it through): the loser backs off
// sooner (its skill's health line raised by SKIRMISH_HP), the winner lets
// a fleeing enemy go unless it can finish it where it stands, and both
// heal out of combat (types.ts). Fought to the death from every bot's
// first sight, fifty champions fell to a handful in two minutes. From that
// phase on the light leaves no room to back off into, and fights go to
// the end.
export const SKIRMISH_UNTIL_PHASE = 5;
export const SKIRMISH_HP = 0.15;
// An enemy walking away from the bot faster than this, under this share
// of its health, is fleeing a fight; a passer-by at full health is not.
export const FLEEING_SPEED = 1;
export const FLEEING_HP = 0.6;
// An enemy this close is fought on odds this much under the bot's nerve:
// two champions face to face do not walk past each other.
export const CLOSE_M = 6;
export const CLOSE_MARGIN = 0.08;
// How far past its own reach the bot still follows a fleeing enemy it can
// finish.
export const FINISH_REACH = 2.5;
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
  const { s, obs } = sense;
  if (s.attackSwingUntil != null && s.attackSwingUntil > obs.time) return NOOP;
  const c = pickCast(sense, target, rng);
  if (c) return c;
  const sigil = fightSigil(sense);
  if (sigil) return sigil;
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

// A fleeing enemy the bot lets go: walking away and past the bot's reach,
// unless it is low enough to finish within FINISH_REACH of it.
function lettingGo(sense: Sense, target: ObsUnit): boolean {
  const at = p3(target);
  const d = dist(sense.me, at);
  const dir = dirTo(sense.me, at);
  if (!dir) return false;
  const away = dot({ x: target.vx ?? 0, y: target.vy ?? 0, z: target.vz ?? 0 }, dir);
  if (away < FLEEING_SPEED || target.hpFrac >= FLEEING_HP) return false;
  const reach = sense.attackRange + 0.5;
  if (d <= reach) return false;
  return !(target.hpFrac < FINISH_HP && d <= reach + FINISH_REACH);
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

  // A swing in the air is never thrown away but to run (the house bots'
  // orb walk, playbook/behaviors.ts): a sidestep or a kite step mid-swing
  // canceled one strike in five, and two bots circled each other without
  // a blow (a playtest, 2026-10-03).
  const swing = sense.s.attackSwingUntil;
  const sidestep = swing != null && swing > obs.time ? null : dodge(sense, rng);
  if (sidestep) return sidestep;

  if (sense.enemies.length > 0) {
    // The skill's eye: on a slot it does not take the enemies in, the bot
    // keeps to its order, the fight it is in included. Falling through to
    // the loot instead walked bots off mid-fight, and two bots passed each
    // other by (a playtest, 2026-10-03).
    const noticed = sense.struck || rng.next() < skill.attention;
    if (!noticed) return NOOP;
    const near = sense.enemies.some((e) => dist(sense.me, p3(e)) <= DANGER_M);
    // The last light leaves nowhere to go: everyone's nerve rises, and a
    // hit is answered rather than run from.
    const cornered = lightsOut || sense.now.radius <= LAST_LIGHT_M;
    const skirmish = r.variant === 'one_life' && r.dusk.phase < SKIRMISH_UNTIL_PHASE && !cornered;
    const backOff = cornered ? skill.retreatHp / 2 : skill.retreatHp + (skirmish ? SKIRMISH_HP : 0);
    if (near && sense.s.hpFrac < backOff && royaleOdds(sense) < LOSING_ODDS) return retreat(sense);
    if (!cornered) {
      const close = sense.enemies[0];
      if (close && dist(sense.me, p3(close)) <= FLEE_M && royaleOdds(sense, close, 0) < FLEE_ODDS) {
        return retreat(sense);
      }
    }
    // Every skill takes a fight its odds reach its nerve on, in either
    // variant and from the landing on: an even duel is fought, a weaker
    // enemy hunted, a low one finished, a hit answered.
    const target = pickTarget(sense);
    if (target) {
      const odds = royaleOdds(sense, target);
      const finish = target.hpFrac < FINISH_HP && sense.s.hpFrac > target.hpFrac;
      const nerve = skill.fightOdds - (cornered ? LAST_LIGHT_NERVE : 0);
      const answer = sense.struck && (cornered || odds >= nerve - ANSWER_MARGIN);
      const margin = dist(sense.me, p3(target)) <= CLOSE_M ? CLOSE_MARGIN : 0;
      const go = odds >= nerve - margin || finish || answer;
      if (go && !(skirmish && lettingGo(sense, target))) return fight(sense, target, rng);
    }
    if (near && sense.struck && !cornered) return retreat(sense);
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
