// The battle royale bot's decision, one per slot (ADR 0031): a Policy's
// body, deterministic over (observation, rng) and blind past what its own
// sight shows. In order: an open Graft offer's card (graft_pick.ts); the
// drop's pick, and a dead Respawn seat's pick of where to come back; out
// of the dark; a held Respawn Seedfall opening
// kept; the dodge; an ambush waiting in a bush; Respawn's Seedfall errand
// past a fight the bot did not strike in; the fight when an enemy in
// sight is noticed (a losing bot backs
// off only toward an exit, else answers; the swing never thrown away; a
// kite between strikes; a low enemy finished; a leaving one chased while
// it can be caught; never a chase into the Dusk); holding still while a
// cache opens; ahead of the Dusk's next cap; a winning bot after its
// target into the bush; a big body in reach it takes on; the calls (a
// gentle bot's care near a mark, a Seedfall, a Clamor, a Rising, the hunt
// of a mark); the nearest cache; a camp when nothing better is near; a
// cache or a Seedfall further off, a wander
// only with none near. Its skill (content/bots/royale_skills.ts), sharpened
// by its score and the Dusk, slows its eye, scatters its aim and sets its
// nerve.

import {
  CALL_HP,
  CALM_NERVE,
  CREATURE_HP,
  ERRAND_NEAR_M,
  ONE_LIFE_PACE,
  PACE_NERVE_MAX,
  PACE_NERVE_MIN,
  PACE_NERVE_PER_SEAT,
  ROYALE_SKILLS,
  type RoyaleSkill,
  type RoyaleSkillId,
  SHARPEN_GENTLE_PHASE,
  SHARPEN_NORMAL_AT,
  SHARPEN_STRONG_AT,
} from '../../content/bots/royale_skills';
import { dirTo, dist, dot, norm, scale, sub, turnLeft, type Vec3 } from '../../geo';
import { KITE_DANGER_FRAC, KITE_STEP, RANGED_MIN_RANGE } from '../../playbook/micro';
import type { Action, Observation, ObsRoyale, ObsSeedfall, ObsUnit } from '../../policy';
import type { Rng } from '../../rng';
import { depthInside, insideCap } from '../dusk';
import { along, type RoyaleLayout } from '../layout';
import { RESPAWN_S } from '../types';
import {
  ambushBush,
  ambushCall,
  type RoyaleCall,
  risingCall,
  risingReachable,
  royaleCall,
  seedfallErrand,
  takesBody,
} from './calls';
import { pickDropPoint } from './drop_pick';
import {
  awayPoint,
  COMMIT_M,
  chaseReach,
  escapeCast,
  exitFrom,
  fightSigil,
  isGraced,
  NO_EXIT_MARGIN,
  pickCast,
  pickTarget,
  royaleOdds,
} from './fight';
import { graftPick } from './graft_pick';
import { buildSense, p3, type Sense } from './sense';
import {
  approachSeedfall,
  beatDusk,
  CACHE_NEAR_M,
  holdStill,
  leaveDark,
  lootCache,
  moveTo,
  pickCache,
  pickCampSpot,
  roam,
  seedfallCache,
  walkVia,
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
// circled one another without a blow (a playtest, 2026-10-03). It backs
// off only toward an exit (fight.ts exitFrom); with none it answers at
// odds down to NO_EXIT_MARGIN under its nerve: One life's early trades,
// where the loser turned its back at 60% and the winner let it go, left
// the duels unended and the losers walked down from behind.
export const LOSING_ODDS = 0.5;
// How long a winning bot follows its target out of sight: to the point it
// was last seen while that sighting is fresher than this.
export const FOLLOW_S = 4;
// An enemy this close is fought on odds this much under the bot's nerve:
// two champions face to face do not walk past each other.
export const CLOSE_M = 6;
export const CLOSE_MARGIN = 0.08;
// An ambush waits this close to its bush's heart.
export const AMBUSH_HOLD_M = 0.8;
// A camp body this close is worth hitting.
export const CAMP_FIGHT_M = 14;
// A bot that passes on a fight gives an enemy this close room, a step of
// ROOM_STEP_M away.
export const ROOM_M = 8;
export const ROOM_STEP_M = 6;
// No camp is taken, nor walked to, with an enemy champion this close: at
// the camp the sim's idle defense turns the bot on whoever stands in
// reach, a fight nobody chose (one first blow in three, a probe,
// 2026-10-03).
export const CAMP_CLEAR_M = 12;

function enemyBeside(sense: Sense): boolean {
  const e = sense.enemies[0];
  return e !== undefined && dist(sense.me, p3(e)) <= CAMP_CLEAR_M;
}
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
    const rel = sub(me, pos) as Vec3;
    const ahead = dot(rel, dir);
    if (ahead < 0 || ahead / Math.max(1, p.speed) > DODGE_ETA_S) continue;
    const lat = sub(rel, scale(dir, ahead)) as Vec3;
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
  const rel = sub(sense.me, from) as Vec3;
  const n = norm(rel);
  if (n < 1e-6) return sense.me;
  return along(sense.me, scale(rel, 1 / n) as Vec3, Math.max(0.5, len), R);
}

// A walk ending this close is all but over.
export const SETTLE_M = 2.5;
// A slot whose eye is elsewhere: the bot keeps to its order (a walk, the
// fight it is in), but one standing idle holds its fire rather than let
// the sim's idle defense start a fight it never looked at.
function unnoticed(sense: Sense): Action {
  const s = sense.s;
  if (s.holding === true || sense.struck) return NOOP;
  if (s.dest) {
    // About to arrive: hold here instead, before the walk's end leaves it
    // idle in an enemy's reach. A walk to a cache goes on.
    const end = p3(s.dest);
    if (dist(sense.me, end) > SETTLE_M) return NOOP;
    if (sense.r.caches.some((c) => dist(end, c) <= 2)) return NOOP;
    return { kind: 'stop' };
  }
  if (s.attackSwingUntil != null && s.attackSwingUntil > sense.obs.time) return NOOP;
  return { kind: 'stop' };
}

// Out of the dark with an enemy on it: the escape when there is one.
function darkEscape(sense: Sense): Action | null {
  return sense.struck && sense.enemies.length > 0 ? escapeCast(sense) : null;
}

function fight(sense: Sense, target: ObsUnit, rng: Rng): Action {
  const { s, obs } = sense;
  if (s.attackSwingUntil != null && s.attackSwingUntil > obs.time) return NOOP;
  const c = pickCast(sense, target, rng);
  if (c) return c;
  const sigil = fightSigil(sense, target);
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

// A camp body, or a big body (a Rising standing) the bot takes on, in
// reach: a creature-taking skill at RISING_LEVEL and CREATURE_HP, any
// skill to steal one under STEAL_BODY_HP (calls.ts takesBody).
// An enemy beside the bot keeps it off a camp, never off a big body: the
// race for its last hit is the Rising's gamble (two bots that each waited
// for the other to leave stood a minute beside a Pyrefang nobody touched,
// a probe, tranche 2).
export function neutralTarget(sense: Sense): ObsUnit | null {
  if (sense.s.hpFrac < CAMP_HP) return null;
  const beside = enemyBeside(sense);
  for (const n of sense.neutrals) {
    const d = dist(sense.me, p3(n));
    if (d > CAMP_FIGHT_M) break;
    if (n.kind === 'camp') {
      if (!beside && depthInside(sense.now, p3(n)) >= 2) return n;
      continue;
    }
    if (risingReachable(sense, p3(n)) && takesBody(sense, n.hpFrac, CREATURE_HP)) return n;
  }
  return null;
}

// A bot in the dark on a Rising's errand (calls.ts risingReachable): a big
// body it takes on in reach, or a Rising it answers; it stays out there,
// neither leaving the dark nor walking ahead of the Dusk, while it holds.
export function risingInDark(sense: Sense): boolean {
  if (sense.now.radius <= 0 || depthInside(sense.now, sense.me) >= 1) return false;
  const body = neutralTarget(sense);
  if (body && body.kind !== 'camp') return true;
  return sense.s.hpFrac >= CALL_HP && risingCall(sense) !== null;
}

function hitNeutral(sense: Sense, n: ObsUnit, rng: Rng): Action {
  const c = pickCast(sense, n, rng, true, false);
  if (c && sense.s.mana > sense.s.maxMana * 0.4) return c;
  return { kind: 'attack', targetId: n.id };
}

const RANK: Readonly<Record<RoyaleSkillId, number>> = { gentle: 0, normal: 1, strong: 2 };

// The sharpening: the skill a seat plays this slot, at least its own. A
// score of SHARPEN_NORMAL_AT plays as normal, SHARPEN_STRONG_AT as strong,
// and from the Dusk's SHARPEN_GENTLE_PHASE a gentle seat plays as normal.
export function effectiveSkill(skill: RoyaleSkill, r: ObsRoyale): RoyaleSkill {
  let id: RoyaleSkillId = skill.id;
  const raise = (to: RoyaleSkillId) => {
    if (RANK[to] > RANK[id]) id = to;
  };
  if (r.score >= SHARPEN_STRONG_AT) raise('strong');
  else if (r.score >= SHARPEN_NORMAL_AT) raise('normal');
  if (r.dusk.phase >= SHARPEN_GENTLE_PHASE) raise('normal');
  return id === skill.id ? skill : ROYALE_SKILLS[id];
}

// The champions One life's pace expects still in at sim time `time`.
export function paceAlive(r: ObsRoyale, time: number): number {
  const minutes = Math.max(0, (time - r.dropEndsAt) / 60);
  const i = Math.floor(minutes);
  const last = ONE_LIFE_PACE.length - 1;
  if (i >= last) return ONE_LIFE_PACE[last]!;
  const f = minutes - i;
  return ONE_LIFE_PACE[i]! * (1 - f) + ONE_LIFE_PACE[i + 1]! * f;
}

// How much more a fight's odds must show in One life for the field's
// pace: more when champions fell ahead of it, less when behind.
export function paceNerve(r: ObsRoyale, time: number): number {
  if (r.variant !== 'one_life') return 0;
  const ahead = paceAlive(r, time) - r.alive;
  return Math.min(PACE_NERVE_MAX, Math.max(PACE_NERVE_MIN, ahead * PACE_NERVE_PER_SEAT));
}

// The odds a fight must show for this bot to start it: its skill's, less
// in the last light; in One life, unless it was struck, more in the calm
// (the first minute a loot, not a cull) and by the field's pace.
export function nerveOf(sense: Sense, cornered: boolean): number {
  const r = sense.r;
  const base = sense.skill.fightOdds - (cornered ? LAST_LIGHT_NERVE : 0);
  if (r.variant !== 'one_life' || sense.struck) return base;
  const calm = r.dusk.phase === 0 ? CALM_NERVE : 0;
  return base + calm + paceNerve(r, sense.obs.time);
}

// Whether an ambush's cue becomes a strike: always in Respawn, and in One
// life while the field is on or behind its pace; with champions fallen
// ahead of it, only on odds within AMBUSH_MARGIN of the bot's nerve, the
// pace included. Struck on every cue, a Seedfall's cache drew the field to
// one point and emptied One life a minute after the first landing (the
// tranche 1 merge, 2026-10-04: 32 alive at 2:00, 12 at 3:00); held on the
// odds alone, the last few waited in their bushes around a cache nobody
// opened. A cue passed on holds where the ambush waits.
export const AMBUSH_MARGIN = 0.1;
export function strikesFromAmbush(sense: Sense, target: ObsUnit): boolean {
  if (sense.r.variant !== 'one_life') return true;
  if (paceNerve(sense.r, sense.obs.time) <= 0) return true;
  return royaleOdds(sense, target) >= nerveOf(sense, false) - AMBUSH_MARGIN;
}

// Whether the bot is in a fight it struck in: its own swing in the air or
// its attack still recovering from one. What a Respawn Seedfall errand
// does not walk out of; a fight it only took hits in, it does.
export function inOwnFight(sense: Sense): boolean {
  const { s, obs } = sense;
  return (s.attackSwingUntil ?? 0) > obs.time || (s.attackReadyAt ?? 0) > obs.time;
}

// A Respawn Seedfall cache this bot is opening (its opening held,
// caches.ts openingHeld): it keeps to the reach. Struck, it hits back at
// the nearest enemy already in its attack reach and out of its Grace (an
// order the sim drops would only slow its own clock), never a step or a cast
// that would carry it out; else it holds still, its fire held. Null when
// the bot opens no such cache.
export const HELD_REACH_SLACK_M = 0.3;
export function heldOpening(sense: Sense): Action | null {
  const r = sense.r;
  const opening = r.opening;
  if (!opening || r.variant !== 'respawn') return null;
  const c = r.caches.find((k) => k.id === opening.cacheId);
  if (c?.kind !== 'seedfall') return null;
  if (sense.struck) {
    const s = sense.s;
    if (s.attackSwingUntil != null && s.attackSwingUntil > sense.obs.time) return NOOP;
    const e = sense.enemies.find((x) => !isGraced(sense, x.id));
    if (e && dist(sense.me, p3(e)) <= sense.attackRange + HELD_REACH_SLACK_M) {
      return { kind: 'attack', targetId: e.id };
    }
  }
  return holdStill(sense);
}

// Respawn's Seedfall errand, with enemies in sight: a bot that heard a
// Seedfall (calls.ts seedfallErrand) and is not in a fight it struck in
// walks on past the fight while farther than ERRAND_NEAR_M from the
// point. Null when no errand holds: the bot's own rules decide (near the
// point, the fight for the cache). Measured against two other ways (the
// report, seeds 1 to 8): finishing a low enemy in reach on the way made
// more of the takedowns steals, and facing an enemy within CLOSE_M
// shortened lives for no fewer steals.
export function errandPast(sense: Sense, errand: RoyaleCall | null): Action | null {
  if (!errand || inOwnFight(sense)) return null;
  const sf = sense.r.seedfalls?.find((x) => x.id === errand.seedfallId);
  if (!sf || dist(sense.me, p3(sf)) <= ERRAND_NEAR_M) return null;
  return approachSeedfall(sense, sf, seedfallCache(sense, sf));
}

// The walk of a Respawn Seedfall errand: toward the point and its cache.
function errandWalk(sense: Sense, errand: RoyaleCall): Action | null {
  const sf = sense.r.seedfalls?.find((x) => x.id === errand.seedfallId);
  return sf ? approachSeedfall(sense, sf, seedfallCache(sense, sf)) : null;
}

// Why a slot chose its action: what scripts/royale_report.ts counts (the
// roam share). Never read by the bot itself.
export type DecideTrace = (why: string) => void;
type Why = (why: string, a: Action) => Action;

// A losing bot: an exit when there is one; with none, it answers at odds
// down to NO_EXIT_MARGIN under its nerve, and only past that steps away.
function losing(sense: Sense, foe: ObsUnit | null, nerve: number, rng: Rng, why: Why): Action {
  const pursuer = foe ?? sense.enemies[0] ?? null;
  const exit = exitFrom(sense, pursuer);
  if (exit) return why('exit', exit);
  if (pursuer && royaleOdds(sense, pursuer) >= nerve - NO_EXIT_MARGIN) {
    return why('answer', fight(sense, pursuer, rng));
  }
  return why('back-off', moveTo(sense, awayPoint(sense, 6)));
}

// A winning bot after a target that left its sight: to the point the
// target was last seen while that sighting is fresher than FOLLOW_S, in
// the light, within the chase and a commit, the target worse off than the
// bot. Null when none.
export function followLastSeen(sense: Sense): Action | null {
  let best: Vec3 | null = null;
  let bestD = sense.skill.chase + COMMIT_M;
  for (const rec of sense.obs.lastSeen ?? []) {
    if (rec.y === undefined || sense.obs.time - rec.at >= FOLLOW_S) continue;
    if (rec.hpFrac >= sense.s.hpFrac) continue;
    const at = p3(rec);
    if (sense.now.radius > 0 && !insideCap(sense.now, at)) continue;
    const d = dist(sense.me, at);
    if (d > bestD) continue;
    best = at;
    bestD = d;
  }
  return best ? moveTo(sense, best) : null;
}

// How far within the window of a Seedfall's landing a dead Respawn seat
// asks to come back beside it.
export const RESPAWN_PICK_S = 20;

// A dead Respawn seat's pick of where to come back (the 'drop' action,
// while dead): beside the Seedfall whose landing falls within
// RESPAWN_PICK_S of its return (RESPAWN_S at the latest, the death timer
// every player reads), at the point inside the light nearest it; else no
// pick.
export function respawnPick(obs: Observation, r: ObsRoyale): Action | null {
  if (r.variant !== 'respawn' || r.stage !== 'play') return null;
  const backAt = obs.time + RESPAWN_S;
  let best: ObsSeedfall | null = null;
  let bestGap = RESPAWN_PICK_S + 1e-9;
  for (const sf of r.seedfalls ?? []) {
    const gap = Math.abs(sf.landsAt - backAt);
    if (gap > bestGap || (gap === bestGap && best !== null && sf.id > best.id)) continue;
    best = sf;
    bestGap = gap;
  }
  if (!best) return null;
  const now = r.dusk.now;
  let at: Vec3 = p3(best);
  if (now.radius > 0 && !insideCap(now, at)) {
    const dir = dirTo(now.center, at);
    if (dir) at = along(now.center, dir as Vec3, Math.max(0, now.radius - 2), norm(now.center));
  }
  if (r.drop && dist(p3(r.drop), at) < 1) return NOOP;
  return { kind: 'drop', x: at.x, y: at.y, z: at.z };
}

export function decide(
  obs: Observation,
  rng: Rng,
  layout: RoyaleLayout,
  seatSkill: RoyaleSkill,
  trace?: DecideTrace,
): Action {
  const why: Why = (w, a) => {
    trace?.(w);
    return a;
  };
  const r = obs.royale;
  if (!r) return NOOP;
  // An open Graft offer is answered first, dead, flying or dropping.
  const graft = graftPick(obs);
  if (graft) return why('graft', graft);
  if (r.stage === 'drop') {
    if (r.drop) return NOOP;
    const p = pickDropPoint(layout, rng);
    return { kind: 'drop', x: p.x, y: p.y, z: p.z };
  }
  if (obs.self.dead) return respawnPick(obs, r) ?? NOOP;
  if (r.stage !== 'play' || r.flying) return NOOP;
  const skill = effectiveSkill(seatSkill, r);
  const sense = buildSense(obs, r, layout, skill);

  // Once the last light is out there is nowhere to go: no way out of the
  // dark, every fight is the last one.
  const lightsOut = sense.now.radius <= 0;
  // A Rising's errand may stand a little way into the dark while it burns
  // mildly (risingInDark); otherwise out of it at once.
  const errandInDark = !lightsOut && risingInDark(sense);
  const dark = lightsOut || errandInDark ? null : leaveDark(sense);
  if (dark) return why('dark', darkEscape(sense) ?? dark);

  // A held opening keeps to its reach: no sidestep out of it.
  const held = heldOpening(sense);
  if (held) return why('opening-held', held);
  const errand = seedfallErrand(sense);

  // A swing in the air is never thrown away but to run (the house bots'
  // orb walk, playbook/behaviors.ts): a sidestep or a kite step mid-swing
  // canceled one strike in five, and two bots circled each other without
  // a blow (a playtest, 2026-10-03).
  const swing = sense.s.attackSwingUntil;
  const sidestep = swing != null && swing > obs.time ? null : dodge(sense, rng);
  if (sidestep) return why('dodge', sidestep);

  if (sense.enemies.length > 0) {
    // An ambush waits in its bush with the champion it waits on in sight,
    // and strikes on its cue; a hit taken ends the wait.
    const ambush = sense.s.hpFrac >= CALL_HP && !sense.struck ? ambushCall(sense) : null;
    if (ambush?.strike) {
      if (strikesFromAmbush(sense, ambush.strike)) {
        return why('ambush-strike', fight(sense, ambush.strike, rng));
      }
      // The cue passed on: the bot keeps to its bush (or where it stands)
      // until the odds or the field's pace let it strike.
      const sf = r.seedfalls?.find((x) => x.id === ambush.seedfallId);
      const bush = sf ? ambushBush(sense, p3(sf)) : null;
      const far = bush !== null && dist(sense.me, bush) > AMBUSH_HOLD_M;
      return why('ambush-hold', far ? moveTo(sense, bush) : holdStill(sense));
    }
    if (ambush) {
      const bush = { x: ambush.x, y: ambush.y, z: ambush.z };
      const wait = dist(sense.me, bush) <= AMBUSH_HOLD_M ? holdStill(sense) : moveTo(sense, bush);
      return why('ambush-wait', wait);
    }
    // Respawn's Seedfall errand walks past a fight it did not strike in.
    const past = errandPast(sense, errand);
    if (past) return why('errand', past);
    // The skill's eye: on a slot it does not take the enemies in, the bot
    // keeps to its order, the fight it is in included. Falling through to
    // the loot instead walked bots off mid-fight, and two bots passed each
    // other by (a playtest, 2026-10-03).
    const noticed = sense.struck || rng.next() < skill.attention;
    if (!noticed) return why('unnoticed', unnoticed(sense));
    const near = sense.enemies.some((e) => dist(sense.me, p3(e)) <= DANGER_M);
    // The last light leaves nowhere to go: everyone's nerve rises, and a
    // hit is answered rather than run from.
    const cornered = lightsOut || sense.now.radius <= LAST_LIGHT_M;
    const nerve = nerveOf(sense, cornered);
    const backOff = cornered ? skill.retreatHp / 2 : skill.retreatHp;
    // Every skill takes a fight its odds reach its nerve on, in either
    // variant and from the landing on: an even duel is fought, a weaker
    // enemy hunted, a low one finished, a hit answered, a leaving one
    // chased while it can be caught.
    const target = pickTarget(sense, (e) => chaseReach(sense, e));
    if (near && sense.s.hpFrac < backOff && royaleOdds(sense) < LOSING_ODDS) {
      return losing(sense, target, nerve, rng, why);
    }
    if (!cornered) {
      const close = sense.enemies[0];
      if (close && dist(sense.me, p3(close)) <= FLEE_M && royaleOdds(sense, close, 0) < FLEE_ODDS) {
        return losing(sense, close, nerve, rng, why);
      }
    }
    if (target) {
      const odds = royaleOdds(sense, target);
      const finish = target.hpFrac < FINISH_HP && sense.s.hpFrac > target.hpFrac;
      const answer = sense.struck && (cornered || odds >= nerve - ANSWER_MARGIN);
      const margin = dist(sense.me, p3(target)) <= CLOSE_M ? CLOSE_MARGIN : 0;
      const go =
        odds >= nerve - margin ? 'fight' : finish ? 'finish' : answer ? 'struck-back' : null;
      if (go) return why(go, fight(sense, target, rng));
    }
    if (near && sense.struck && !cornered) return losing(sense, target, nerve, rng, why);
    // A fight passed on beside the Seedfall it came for: on to its cache.
    const walk = errand ? errandWalk(sense, errand) : null;
    if (walk) return why('errand', walk);
    // A fight passed on: room given rather than loot beside the enemy,
    // where the first stray blow starts it anyway.
    const close = sense.enemies[0];
    if (!cornered && close && dist(sense.me, p3(close)) <= ROOM_M) {
      return why('give-room', moveTo(sense, awayPoint(sense, ROOM_STEP_M)));
    }
  }

  if (r.opening) return why('opening', holdStill(sense));

  const ahead = errandInDark ? null : beatDusk(sense);
  if (ahead) return why('beat-dusk', ahead);

  const follow = followLastSeen(sense);
  if (follow) return why('follow', follow);

  // A big body in reach comes before the calls (a Rising's call walks the
  // bot here), a camp after the near caches.
  const neutral = neutralTarget(sense);
  if (neutral && neutral.kind !== 'camp')
    return why('rising-fight', hitNeutral(sense, neutral, rng));

  const call = royaleCall(sense, nerveOf(sense, false)) ?? errand;
  if (call) {
    const id = call.seedfallId;
    const sf = id !== undefined ? r.seedfalls?.find((x) => x.id === id) : undefined;
    if (call.kind === 'seedfall' && sf) {
      return why('seedfall', approachSeedfall(sense, sf, seedfallCache(sense, sf)));
    }
    return why(call.kind, walkVia(sense, { x: call.x, y: call.y, z: call.z }));
  }

  const cache = pickCache(sense, CACHE_NEAR_M);
  if (cache) return why('cache-near', lootCache(sense, cache));

  if (neutral) return why('neutral', hitNeutral(sense, neutral, rng));

  const camp = enemyBeside(sense) ? null : pickCampSpot(sense);
  if (camp && sense.s.hpFrac >= CAMP_HP) return why('camp', moveTo(sense, camp));

  const far = pickCache(sense);
  if (far) return why('cache-far', lootCache(sense, far));
  return why('roam', roam(sense));
}
