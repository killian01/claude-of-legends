// What a battle royale of fifty seats looks like on the Wanderseed (ADR
// 0031, docs/plan-royale.md): plays N seeds of each variant headless on
// the shipped planet and prints, per match, its length, the first
// takedown, the takedowns and deaths minute by minute, One life's alive
// by minute, the winner (champion, skill, kills, level), the top five
// killers, the deaths to the Dusk, the pads used, the caches opened minute
// by minute, the camps taken, the final levels, the fights between the bot
// skills, how long each skill lasted in One life, the Seedfalls (landed,
// opened, contested, landing to opening), what the bots decided (the roam
// share by stretch of the match), how many One life duels ended in a
// death, and the tick's cost; then one line per match to compare a tuning
// against, and the acceptance numbers of the bots with intent.
//
// Two kinds of stand-in seats measure what a person meets:
// - --passive N (default 1): a passive seat (it only walks to caches,
//   keeps to the light, and backs off when hit: a newcomer who never
//   fights back), with how long it lasted, its place, and its longest
//   stretch with no enemy in sight (and when that stretch began);
// - --standin N (default 1): a person's seat played by the normal brain:
//   it picks its landing like a person, takes no part in the bots' drop
//   (so the house bots escort it, ESCORTS by variant), and the report
//   says how long each of its lives lasted, and in Respawn the median by
//   the minute each life began (where the short ones are).
// It also measures what a player sees of the bots: of the seconds a bot
// had an enemy in its sight within ENGAGE_M, the share it spent fighting a
// champion (dealt one damage in the last ENGAGED_S), and the share of
// takedowns that were steals (the killer dealt under STEAL_SHARE of the
// champion damage the victim took in its last STEAL_WINDOW_S).
//
// --dropin 60,180,300,420 (seconds after landing, default none) drops a
// person into the running match at each listed time the server would take
// one (Respawn until JOIN_UNTIL_END_S before the end, One life in the
// calm): one bot seat taken the way the server does (chooseBotSeat with
// DEFAULT_CHAMPION_ID and, in Respawn, the field's level), its bot
// detached, its Arrival begun, then the --standin brain attached. Each
// drop-in tells its level at landing, the nearest enemy then, whether a
// fair first fight was found (RoyaleTally.fairArrivals), whether it sees
// an enemy on the first tick after landing (team vision), the seconds to
// the first damage it dealt to a champion (an enemy's recentDamagers
// naming it, read off the damage events) and to the first it took from
// one, its first takedown and its takedowns in the first DROPIN_EARLY_S,
// and its first life; then the shares by join time, and one compare line
// (the stand-in median life, the fighting share, the steals, the final
// level median) to hold a change against. Bundled and run by
// scripts/royale_report.mjs:
//   node scripts/royale_report.mjs [--seeds 4] [--from 1]
//     [--variant both|respawn|one_life] [--passive 1] [--standin 1]
//     [--dropin 60,180,300,420] [--quiet]

import { readFileSync } from 'node:fs';
import { chooseBotSeat } from '../server/royale_join';
import { buildRoyaleSim, type ReplayPick, type RoyalePlanet } from '../src/net/replay';
import { ROYALE_SKILLS, type RoyaleSkillId } from '../src/sim/content/bots/royale_skills';
import { DEFAULT_CHAMPION_ID } from '../src/sim/content/champions';
import { GRAFT_LIST, GRAFTS } from '../src/sim/content/grafts';
import { assemblePlanet } from '../src/sim/content/planet';
import { dist } from '../src/sim/geo';
import { SphereGround } from '../src/sim/ground';
import type { Action, Observation, Policy } from '../src/sim/policy';
import { Rng } from '../src/sim/rng';
import { decide } from '../src/sim/royale/bot/brain';
import { pickDropPoint } from '../src/sim/royale/bot/drop_pick';
import { awayPoint, escapeCast } from '../src/sim/royale/bot/fight';
import { buildSense, p3 } from '../src/sim/royale/bot/sense';
import {
  beatDusk,
  leaveDark,
  lootCache,
  moveTo,
  pickCache,
  roam,
} from '../src/sim/royale/bot/travel';
import { royaleHouseChampions } from '../src/sim/royale/fill';
import type { RoyaleLayout } from '../src/sim/royale/layout';
import { lowerMedian } from '../src/sim/royale/levels';
import {
  CALM_S,
  DROP_S,
  JOIN_UNTIL_END_S,
  PLAY_S,
  type RoyaleVariant,
} from '../src/sim/royale/types';
import { decodeSphereNav, findSpherePath, SphereNavGrid } from '../src/sim/sphere_nav';
import { TICK_RATE } from '../src/sim/types';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};
const seeds = Number(opt('--seeds', '4'));
const firstSeed = Number(opt('--from', '1'));
const variantArg = opt('--variant', 'both');
const passiveSeats = Number(opt('--passive', '1'));
const standinSeats = Number(opt('--standin', '1'));
const dropinTimes = opt('--dropin', '')
  .split(',')
  .filter((x) => x.trim() !== '')
  .map(Number)
  .filter((x) => Number.isFinite(x) && x >= 0)
  .sort((a, b) => a - b);
const quiet = args.includes('--quiet');
const variants: RoyaleVariant[] =
  variantArg === 'respawn' || variantArg === 'one_life' ? [variantArg] : ['respawn', 'one_life'];

// The acceptance of the bots with intent (and the Seedfall's), read by the
// summary: One life's alive by minute (each within 25%), the first
// minute's deaths, the late roam share, the passive seat's longest stretch
// with no enemy in sight in Respawn, the stand-in's median life in
// Respawn, the share of One life duels after the calm that end in a death
// within DUEL_END_S, and the Seedfall's.
const ALIVE_TARGET = [50, 44, 36, 27, 19, 12, 7, 4, 2, 1];
const ALIVE_TOLERANCE = 0.25;
const FIRST_MINUTE_DEATHS_MAX = 8;
const LATE_ROAM_MAX = 0.4;
const PASSIVE_GAP_MAX_S = 35;
const STANDIN_LIFE_MIN_S = 30;
const STANDIN_EARLY_S = 360;
const DUEL_END_SHARE_MIN = 0.5;
const DUEL_END_S = 45;
// A duel: two champions trading blows with nobody else on either of them
// for DUEL_ALONE_S before it starts; over once neither hits the other for
// DUEL_QUIET_S.
const DUEL_ALONE_S = 5;
const DUEL_QUIET_S = 10;
// A drop-in's takedowns are counted over its first this many seconds, and
// its first hit is one on a champion within DROPIN_HIT_M of it: a bolt or
// a burn the bot left behind lands farther off, in the first second.
const DROPIN_EARLY_S = 60;
const DROPIN_HIT_M = 16;

function loadPlanet(dir = 'public/map/planet/'): RoyalePlanet {
  const planet = assemblePlanet(JSON.parse(readFileSync(`${dir}layout.json`, 'utf8')));
  const bin = readFileSync(`${dir}navigation.bin`);
  const buffer = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer;
  const data = decodeSphereNav(planet.nav, buffer);
  return {
    layout: planet,
    ground: () => new SphereGround(new SphereNavGrid(data), findSpherePath),
  };
}

// The passive stand-in: lands where a bot would, keeps to the light, walks
// to the nearest cache and opens it, and backs off from anyone who hits
// it; it never attacks.
function passivePolicy(layout: RoyaleLayout) {
  const skill = ROYALE_SKILLS.gentle;
  return (obs: Observation, rng: Rng): Action => {
    const r = obs.royale;
    if (!r) return { kind: 'noop' };
    if (r.stage === 'drop') {
      if (r.drop) return { kind: 'noop' };
      const p = pickDropPoint(layout, rng);
      return { kind: 'drop', x: p.x, y: p.y, z: p.z };
    }
    if (r.stage !== 'play' || obs.self.dead || r.flying) return { kind: 'noop' };
    const sense = buildSense(obs, r, layout, skill);
    const dark = sense.now.radius <= 0 ? null : leaveDark(sense);
    if (dark) return dark;
    if (sense.struck && sense.enemies.length > 0) {
      return escapeCast(sense) ?? moveTo(sense, awayPoint(sense, 8));
    }
    const close = sense.enemies.find((e) => dist(sense.me, p3(e)) < 6);
    if (close) return moveTo(sense, awayPoint(sense, 8));
    if (r.opening) return sense.s.dest ? { kind: 'stop' } : { kind: 'noop' };
    const ahead = beatDusk(sense);
    if (ahead) return ahead;
    const c = pickCache(sense);
    if (c) return lootCache(sense, c);
    return roam(sense);
  };
}

type SeatKind = RoyaleSkillId | 'passive' | 'standin' | 'dropin';

// One drop-in, seconds counted from its landing.
interface DropIn {
  // The listed time it joined at, seconds after the match's landing.
  joinAt: number;
  level: number;
  fieldLevel: number;
  nearestM: number | null;
  fair: boolean;
  // An enemy champion in its sight on the first tick after landing; null
  // until that tick.
  seen: boolean | null;
  firstDealt: number | null;
  firstTaken: number | null;
  firstTakedown: number | null;
  earlyTakedowns: number;
  // Its first life: to its first death, or as far as it got, and who
  // ended it: the enemy nearest at landing (the fair foe when one was
  // found), another champion, or the world (the Dusk, a Seedfall).
  firstLife: number;
  endedBy: 'nearest' | 'other' | 'world' | null;
}

interface Seat {
  id: number;
  championId: string;
  skill: SeatKind;
}

// The stretches of a match the bots' decisions are counted over, by
// minutes from landing.
const WINDOWS = ['0-1', '1-3', '3-6', '6+'] as const;
type Window = (typeof WINDOWS)[number];
function windowOf(minute: number): Window {
  return minute < 1 ? '0-1' : minute < 3 ? '1-3' : minute < 6 ? '3-6' : '6+';
}

interface Match {
  variant: RoyaleVariant;
  seed: number;
  duration: number;
  firstTakedown: number | null;
  takedownsByMin: number[];
  deathsByMin: number[];
  aliveByMin: number[];
  cachesByMin: number[];
  takedowns: number;
  winner: { championId: string; skill: string; kills: number; level: number } | null;
  top: {
    championId: string;
    skill: string;
    kills: number;
    deaths: number;
    level: number;
    grafts: string[];
  }[];
  duskDeaths: number;
  pads: number;
  camps: number;
  levels: number[];
  // Every seat's champion, skill and takedowns.
  seats: { championId: string; skill: string; kills: number; deaths: number }[];
  // Takedowns between skills: killer skill -> victim skill -> count.
  duels: Record<string, Record<string, number>>;
  // One life: seconds from landing each seat fell (the end for the last).
  lastedBySkill: Record<string, number[]>;
  tickAvgMs: number;
  tickMaxMs: number;
  // Bot-seconds with an enemy in sight within ENGAGE_M, and those of them
  // spent fighting a champion.
  nearSeconds: number;
  engagedSeconds: number;
  // Takedowns between champions, and those that were steals.
  champTakedowns: number;
  steals: number;
  // The bots' decisions by reason, per stretch of the match.
  reasons: Record<Window, Record<string, number>>;
  // The passive seats: longest stretch alive with no enemy in sight, and
  // (One life) when they fell and their place.
  passiveGaps: number[];
  // When each passive seat's longest stretch began, seconds from landing.
  passiveGapFrom: number[];
  passiveFell: number[];
  // The stand-in seats' lives, seconds each (a life cut by the end
  // counted too), and when each began, seconds from landing.
  standinLives: number[];
  standinLifeStarts: number[];
  standinPlaces: number[];
  // One life duels after the calm: started, and ended in a death within
  // DUEL_END_S.
  duelsAfterCalm: number;
  duelsEnded: number;
  // The Seedfalls.
  seedfallsLanded: number;
  seedfallsOpened: number;
  seedfallsContested: number;
  seedfallOpenDelays: number[];
  // The Risings and the hunted: each big body that fell, what and when
  // (seconds from landing), the Wrath's passings, the takedowns each
  // holder made while it held it, the takedowns on the Lodestar, and the
  // takedowns on a marked champion (the Lodestar, an Ablaze run).
  fallen: { kind: string; at: number }[];
  wrathPasses: number;
  wrathKills: number[];
  lodestarDowns: number;
  markTakedowns: number;
  // Respawn's takedowns that settled a Burr (royale/burr.ts).
  burrTakedowns: number;
  // The Grafts: held per seat at its fall (One life) or the end, every
  // Graft taken by id, the Bough offers and those filled with a Sprout,
  // and the offers of the bots' seats that ran out (card 0 taken for them).
  graftsHeld: number[];
  graftsTaken: Record<string, number>;
  boughOffers: number;
  boughFallbacks: number;
  botTimeouts: number;
  dropIns: DropIn[];
}

const ENGAGE_M = 8;
const ENGAGED_S = 3;
const STEAL_SHARE = 0.25;
const STEAL_WINDOW_S = 10;

function clock(seconds: number | null): string {
  if (seconds === null) return '-';
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function spread(count: number, offset: number, taken: Set<number>): number[] {
  const out: number[] = [];
  for (let k = 0; k < count; k++) {
    let i = Math.floor(((k + offset) * 50) / count) % 50;
    while (taken.has(i)) i = (i + 1) % 50;
    taken.add(i);
    out.push(i);
  }
  return out;
}

function play(
  planet: RoyalePlanet,
  variant: RoyaleVariant,
  seed: number,
  passive: number,
  standin: number,
  dropins: readonly number[],
): Match {
  const champions = royaleHouseChampions(seed, 50);
  const taken = new Set<number>();
  const passiveAt = new Set(spread(passive, 0, taken));
  const standinAt = new Set(spread(standin, 0.5, taken));
  const picks: ReplayPick[] = champions.map((championId, i) => ({
    name: `house${i}`,
    team: i,
    championId,
    sigils: ['riftstep', 'mend'],
    ...(passiveAt.has(i) || standinAt.has(i) ? {} : { bot: 'royale' }),
  }));
  const { sim, unitIds } = buildRoyaleSim(planet, seed, picks, variant);
  const mode = sim.royaleMode!;
  const landAt = DROP_S;
  const seats = new Map<number, Seat>();
  const reasons = Object.fromEntries(WINDOWS.map((w) => [w, {}])) as Match['reasons'];
  const minuteNow = () => Math.max(0, Math.floor((sim.time - landAt) / 60));
  const traced = (skill: RoyaleSkillId, count: boolean): Policy => {
    const s = ROYALE_SKILLS[skill];
    const trace = count
      ? (why: string) => {
          const row = reasons[windowOf(minuteNow())];
          row[why] = (row[why] ?? 0) + 1;
        }
      : undefined;
    return (obs, rng) => decide(obs, rng, mode.layout, s, trace);
  };
  const standins: number[] = [];
  unitIds.forEach((id, i) => {
    const skill: SeatKind = passiveAt.has(i)
      ? 'passive'
      : standinAt.has(i)
        ? 'standin'
        : mode.skillOf(id);
    seats.set(id, { id, championId: champions[i]!, skill });
    if (skill === 'passive') sim.attachPolicy(id, passivePolicy(mode.layout));
    else if (skill === 'standin') {
      // A person picks a landing over the globe; the stream is the
      // report's own, so the match's is the same as with a person.
      const p = pickDropPoint(mode.layout, new Rng(seed * 131 + i));
      sim.pickDrop(id, p);
      standins.push(id);
    } else sim.attachPolicy(id, traced(skill, true));
  });
  const cap = Math.round((DROP_S + PLAY_S + 90) * TICK_RATE);
  const takedownsByMin: number[] = [];
  const deathsByMin: number[] = [];
  const aliveByMin: number[] = [];
  const cachesByMin: number[] = [];
  const duels: Record<string, Record<string, number>> = {};
  const fellAt = new Map<number, number>();
  const bump = (arr: number[], i: number) => {
    while (arr.length <= i) arr.push(0);
    arr[i]! += 1;
  };
  let tickMs = 0;
  let tickMax = 0;
  let playTicks = 0;
  let ticks = 0;
  // The last time each seat dealt damage to a champion, and the champion
  // damage each seat took lately, by source.
  const lastHit = new Map<number, number>();
  const taken2 = new Map<number, { src: number; amount: number; t: number }[]>();
  let nearSeconds = 0;
  let engagedSeconds = 0;
  let champTakedowns = 0;
  let steals = 0;
  // Stand-ins: when each came back (or landed), and its lives.
  const aliveSince = new Map<number, number>();
  const standinLives: number[] = [];
  const standinLifeStarts: number[] = [];
  const endLife = (since: number) => {
    standinLives.push(sim.time - since);
    standinLifeStarts.push(since - landAt);
  };
  // Passive seats: the current and longest stretch with no enemy in sight.
  const gapNow = new Map<number, number>();
  const gapMax = new Map<number, number>();
  const gapFrom = new Map<number, number>();
  // Duels: the open ones by pair, and the last champion hit on each seat by
  // source.
  const lastHitOn = new Map<number, Map<number, number>>();
  const openDuels = new Map<string, { a: number; b: number; start: number; last: number }>();
  let duelsAfterCalm = 0;
  let duelsEnded = 0;
  // Seedfalls: when each landed, and its cache.
  const landedAt = new Map<number, number>();
  const seedfallOfCache = new Map<number, number>();
  const seedfallOpenDelays: number[] = [];
  let landedSeen = false;
  let lastMinute = -1;
  // The Risings and the hunted.
  const fallen: { kind: string; at: number }[] = [];
  let standing = new Map<string, boolean>();
  let wrathPasses = 0;
  const wrathKills: number[] = [];
  let holder: number | null = null;
  let holderKills = 0;
  let lodestarDowns = 0;
  // The Grafts.
  const heldAtFall = new Map<number, number>();
  const offersSeen = new WeakSet<object>();
  let boughOffers = 0;
  let boughFallbacks = 0;
  let botTimeouts = 0;
  // The drop-ins: the times still to come, and each one taken, with its
  // landing.
  const dropinsLeft = [...dropins];
  const dropIns: {
    id: number;
    nearestId: number;
    landedAt: number;
    row: DropIn;
    alive: boolean;
  }[] = [];
  const dropIn = (joinAt: number): void => {
    const s = mode.state;
    const open =
      variant === 'respawn' ? sim.time < s.endsAt - JOIN_UNTIL_END_S : sim.time < landAt + CALM_S;
    if (!open) return;
    const champs = [...sim.units.values()].filter((u) => u.kind === 'champion');
    const fieldLevel = lowerMedian(champs.map((u) => u.level));
    const candidates = [...seats.values()]
      .filter((seat) => seat.skill in ROYALE_SKILLS)
      .map((seat) => {
        const u = sim.units.get(seat.id)!;
        return {
          unitId: seat.id,
          championId: u.championId ?? seat.championId,
          dead: u.dead,
          out: variant === 'one_life' && s.eliminated.includes(seat.id),
          level: u.level,
        };
      });
    const id = chooseBotSeat(
      candidates,
      DEFAULT_CHAMPION_ID,
      variant === 'respawn' ? fieldLevel : undefined,
    );
    if (id === null) return;
    const seat = seats.get(id)!;
    sim.detachPolicy(id);
    const fairBefore = mode.tally.fairArrivals ?? 0;
    sim.beginArrival(id);
    const fair = (mode.tally.fairArrivals ?? 0) > fairBefore;
    sim.attachPolicy(id, traced('normal', false));
    seat.skill = 'dropin';
    const u = sim.units.get(id)!;
    let nearest: number | null = null;
    let nearestId = 0;
    for (const o of champs) {
      if (o.id === id || o.dead) continue;
      const d = dist(u.pos, o.pos);
      if (nearest === null || d < nearest) {
        nearest = d;
        nearestId = o.id;
      }
    }
    dropIns.push({
      id,
      nearestId,
      landedAt: sim.time,
      alive: true,
      row: {
        joinAt,
        level: u.level,
        fieldLevel,
        nearestM: nearest,
        fair,
        seen: null,
        firstDealt: null,
        firstTaken: null,
        firstTakedown: null,
        earlyTakedowns: 0,
        firstLife: 0,
        endedBy: null,
      },
    });
  };
  while (mode.state.stage !== 'over' && ticks < cap) {
    while (
      mode.state.stage === 'play' &&
      dropinsLeft.length > 0 &&
      sim.time - landAt + 1e-9 >= dropinsLeft[0]!
    ) {
      dropIn(dropinsLeft.shift()!);
    }
    for (const [id, q] of mode.state.offers) {
      const head = q[0];
      if (!head || head.until === null || seats.get(id)?.skill === 'passive') continue;
      if (mode.state.stage === 'play' && sim.time + 1e-9 >= head.until) botTimeouts++;
    }
    const t0 = performance.now();
    const holderBefore = mode.state.wrathHolder?.unitId ?? null;
    const lodestarBefore = mode.state.marks.find((k) => k.kind === 'lodestar')?.unitId ?? null;
    const events = sim.tick();
    for (const q of mode.state.offers.values()) {
      for (const o of q) {
        if (offersSeen.has(o)) continue;
        offersSeen.add(o);
        if (o.grade !== 'bough') continue;
        boughOffers++;
        if (o.cards.some((c) => GRAFTS[c]?.grade === 'sprout')) boughFallbacks++;
      }
    }
    const ms = performance.now() - t0;
    ticks++;
    if (mode.state.stage !== 'drop') {
      tickMs += ms;
      playTicks++;
      if (ms > tickMax) tickMax = ms;
    }
    if (!landedSeen && mode.state.stage === 'play') {
      landedSeen = true;
      for (const id of standins) {
        sim.attachPolicy(id, traced('normal', false));
        aliveSince.set(id, sim.time);
      }
    }
    const minute = minuteNow();
    if (mode.state.stage === 'play' && minute !== lastMinute) {
      lastMinute = minute;
      if (variant === 'one_life') aliveByMin[minute] = mode.alive(sim);
    }
    for (const sf of mode.state.seedfalls) {
      if (sf.cacheId !== null) seedfallOfCache.set(sf.cacheId, sf.id);
    }
    const nowStanding = new Map(mode.state.risings.map((x) => [x.kind as string, x.up]));
    for (const [kind, up] of standing) {
      if (up && !nowStanding.has(kind)) fallen.push({ kind, at: sim.time - landAt });
    }
    standing = nowStanding;
    for (const e of events) {
      if (e.type === 'royale_wrath_passed' && e.to !== null) wrathPasses++;
      if (e.type === 'death' && seats.has(e.unitId) && e.killerId !== e.unitId) {
        if (holderBefore !== null && e.killerId === holderBefore) holderKills++;
        if (lodestarBefore !== null && e.unitId === lodestarBefore && seats.has(e.killerId)) {
          lodestarDowns++;
        }
      }
    }
    for (const d of dropIns) {
      const since = sim.time - d.landedAt;
      // The first tick after landing: does the drop-in see an enemy, as
      // its screen would (team vision: bushes and rocks hide)?
      if (d.row.seen === null) {
        const me = sim.units.get(d.id)!;
        d.row.seen = [...sim.units.values()].some(
          (o) => o.kind === 'champion' && o.id !== d.id && !o.dead && sim.isVisible(me.team, o.id),
        );
      }
      for (const e of events) {
        if (e.type === 'damage' && e.sourceId !== e.targetId) {
          const near = (a: number, b: number) => {
            const ua = sim.units.get(a);
            const ub = sim.units.get(b);
            return ua !== undefined && ub !== undefined && dist(ua.pos, ub.pos) <= DROPIN_HIT_M;
          };
          if (e.sourceId === d.id && seats.has(e.targetId) && near(d.id, e.targetId)) {
            d.row.firstDealt ??= since;
          }
          if (e.targetId === d.id && seats.has(e.sourceId)) d.row.firstTaken ??= since;
        } else if (e.type === 'death' && seats.has(e.unitId)) {
          if (e.killerId === d.id && e.unitId !== d.id) {
            d.row.firstTakedown ??= since;
            if (since <= DROPIN_EARLY_S) d.row.earlyTakedowns++;
          }
          if (e.unitId === d.id && d.alive) {
            d.alive = false;
            d.row.firstLife = since;
            d.row.endedBy =
              e.killerId === d.nearestId ? 'nearest' : seats.has(e.killerId) ? 'other' : 'world';
          }
        }
      }
    }
    const holderNow = mode.state.wrathHolder?.unitId ?? null;
    if (holderNow !== holder) {
      if (holder !== null) wrathKills.push(holderKills);
      holder = holderNow;
      holderKills = 0;
    }
    for (const e of events) {
      if (e.type === 'royale_seedfall_land') landedAt.set(e.seedfallId, sim.time);
      if (e.type === 'royale_cache') {
        bump(cachesByMin, minute);
        const sfId = seedfallOfCache.get(e.cacheId);
        const at = sfId !== undefined ? landedAt.get(sfId) : undefined;
        if (at !== undefined) seedfallOpenDelays.push(sim.time - at);
      }
      if (e.type === 'damage') {
        if (e.sourceId === e.targetId || !seats.has(e.sourceId) || !seats.has(e.targetId)) continue;
        lastHit.set(e.sourceId, sim.time);
        const list = taken2.get(e.targetId) ?? [];
        list.push({ src: e.sourceId, amount: e.amount, t: sim.time });
        while (list.length > 0 && sim.time - list[0]!.t > STEAL_WINDOW_S) list.shift();
        taken2.set(e.targetId, list);
        if (variant === 'one_life') {
          const a = Math.min(e.sourceId, e.targetId);
          const b = Math.max(e.sourceId, e.targetId);
          const key = `${a}:${b}`;
          const open = openDuels.get(key);
          if (open) open.last = sim.time;
          else if (sim.time - landAt >= CALM_S) {
            // Nobody else on either of them lately: a duel starts.
            const alone = [a, b].every((x) => {
              const by = lastHitOn.get(x);
              if (!by) return true;
              for (const [src, t] of by) {
                if (src !== a && src !== b && sim.time - t <= DUEL_ALONE_S) return false;
              }
              return true;
            });
            if (alone) {
              openDuels.set(key, { a, b, start: sim.time, last: sim.time });
              duelsAfterCalm++;
            }
          }
          const by = lastHitOn.get(e.targetId) ?? new Map<number, number>();
          by.set(e.sourceId, sim.time);
          lastHitOn.set(e.targetId, by);
        }
        continue;
      }
      if (e.type !== 'death') continue;
      const victim = seats.get(e.unitId);
      if (!victim) continue;
      if (variant === 'one_life' && !heldAtFall.has(victim.id)) {
        heldAtFall.set(victim.id, sim.units.get(victim.id)?.grafts.length ?? 0);
      }
      bump(deathsByMin, minute);
      if (victim.skill === 'standin') {
        const since = aliveSince.get(victim.id);
        if (since !== undefined) endLife(since);
        aliveSince.delete(victim.id);
      }
      if (variant === 'one_life' && !fellAt.has(e.unitId)) fellAt.set(e.unitId, sim.time - landAt);
      for (const [key, d] of openDuels) {
        if (d.a !== victim.id && d.b !== victim.id) continue;
        if (sim.time - d.start <= DUEL_END_S) duelsEnded++;
        openDuels.delete(key);
      }
      const killer = seats.get(e.killerId);
      if (!killer || killer.id === victim.id) continue;
      champTakedowns++;
      const recent = (taken2.get(victim.id) ?? []).filter((h) => sim.time - h.t <= STEAL_WINDOW_S);
      const all = recent.reduce((a, h) => a + h.amount, 0);
      const own = recent.filter((h) => h.src === killer.id).reduce((a, h) => a + h.amount, 0);
      if (all > 0 && own < all * STEAL_SHARE) steals++;
      taken2.delete(victim.id);
      bump(takedownsByMin, minute);
      duels[killer.skill] ??= {};
      duels[killer.skill]![victim.skill] = (duels[killer.skill]![victim.skill] ?? 0) + 1;
    }
    for (const [key, d] of openDuels) {
      if (sim.time - d.last > DUEL_QUIET_S) openDuels.delete(key);
    }
    // Stand-ins back from a death.
    for (const id of standins) {
      const u = sim.units.get(id);
      if (u && !u.dead && !aliveSince.has(id) && mode.state.stage === 'play') {
        aliveSince.set(id, sim.time);
      }
    }
    if (mode.state.stage === 'play' && sim.tickCount % TICK_RATE === 0) {
      const alive = [...seats.values()]
        .map((seat) => sim.units.get(seat.id))
        .filter((u) => u !== undefined && !u.dead);
      for (const u of alive) {
        if (!u) continue;
        const kind = seats.get(u.id)?.skill;
        if (kind === 'passive') {
          const seen = alive.some((o) => o !== u && o !== undefined && sim.isVisible(u.team, o.id));
          const gap = seen ? 0 : (gapNow.get(u.id) ?? 0) + 1;
          gapNow.set(u.id, gap);
          if (gap > (gapMax.get(u.id) ?? 0)) {
            gapMax.set(u.id, gap);
            gapFrom.set(u.id, sim.time - landAt - gap);
          }
          continue;
        }
        if (kind === 'standin' || kind === 'dropin') continue;
        const near = alive.some(
          (o) =>
            o !== u &&
            o !== undefined &&
            dist(u.pos, o.pos) <= ENGAGE_M &&
            sim.isVisible(u.team, o.id),
        );
        if (!near) continue;
        nearSeconds++;
        if (sim.time - (lastHit.get(u.id) ?? Number.NEGATIVE_INFINITY) <= ENGAGED_S)
          engagedSeconds++;
      }
      for (const [id] of seats) {
        const u = sim.units.get(id);
        if (u?.dead && seats.get(id)?.skill === 'passive') gapNow.set(id, 0);
      }
    }
  }
  const end = sim.time - landAt;
  // A stand-in's life still running at the end counts as far as it got,
  // and a drop-in's first life too.
  for (const [, since] of aliveSince) endLife(since);
  for (const d of dropIns) if (d.alive) d.row.firstLife = sim.time - d.landedAt;
  const champs = [...sim.units.values()].filter((u) => u.kind === 'champion');
  const ranked = [...champs].sort(
    (a, b) => b.kills - a.kills || a.deaths - b.deaths || a.id - b.id,
  );
  const winnerUnit = mode.state.winnerId !== null ? sim.units.get(mode.state.winnerId) : undefined;
  const lastedBySkill: Record<string, number[]> = {};
  if (variant === 'one_life') {
    for (const s of seats.values()) {
      lastedBySkill[s.skill] ??= [];
      lastedBySkill[s.skill]!.push(fellAt.get(s.id) ?? end);
    }
  }
  const order = mode.ranking(sim);
  const placeOf = (id: number) => order.indexOf(id) + 1;
  return {
    variant,
    seed,
    duration: end,
    firstTakedown: mode.tally.firstTakedownAt === null ? null : mode.tally.firstTakedownAt - landAt,
    takedownsByMin,
    deathsByMin,
    aliveByMin,
    cachesByMin,
    takedowns: mode.tally.takedowns,
    winner: winnerUnit
      ? {
          championId: winnerUnit.championId ?? '?',
          skill: seats.get(winnerUnit.id)?.skill ?? '?',
          kills: winnerUnit.kills,
          level: winnerUnit.level,
        }
      : null,
    top: ranked.slice(0, 5).map((u) => ({
      championId: u.championId ?? '?',
      skill: seats.get(u.id)?.skill ?? '?',
      kills: u.kills,
      deaths: u.deaths,
      level: u.level,
      grafts: [...u.grafts],
    })),
    duskDeaths: mode.tally.duskDeaths,
    pads: mode.tally.padsUsed,
    camps: mode.tally.campsTaken,
    levels: champs.map((u) => u.level).sort((a, b) => a - b),
    seats: champs.map((u) => ({
      championId: u.championId ?? '?',
      skill: seats.get(u.id)?.skill ?? '?',
      kills: u.kills,
      deaths: u.deaths,
    })),
    duels,
    lastedBySkill,
    tickAvgMs: playTicks > 0 ? tickMs / playTicks : 0,
    tickMaxMs: tickMax,
    nearSeconds,
    engagedSeconds,
    champTakedowns,
    steals,
    reasons,
    passiveGaps: [...seats.values()]
      .filter((s) => s.skill === 'passive')
      .map((s) => gapMax.get(s.id) ?? 0),
    passiveGapFrom: [...seats.values()]
      .filter((s) => s.skill === 'passive')
      .map((s) => gapFrom.get(s.id) ?? 0),
    passiveFell: [...seats.values()]
      .filter((s) => s.skill === 'passive')
      .map((s) => fellAt.get(s.id) ?? end),
    standinLives,
    standinLifeStarts,
    standinPlaces:
      variant === 'one_life' ? standins.map((id) => placeOf(id)) : standins.map(() => 0),
    duelsAfterCalm,
    duelsEnded,
    seedfallsLanded: mode.tally.seedfallsLanded,
    seedfallsOpened: mode.tally.seedfallsOpened,
    seedfallsContested: mode.tally.seedfallsContested,
    seedfallOpenDelays,
    fallen,
    wrathPasses,
    wrathKills: holder !== null ? [...wrathKills, holderKills] : wrathKills,
    lodestarDowns,
    markTakedowns: mode.tally.markTakedowns,
    burrTakedowns: mode.tally.burrTakedowns,
    graftsHeld: champs.map((u) => heldAtFall.get(u.id) ?? u.grafts.length),
    graftsTaken: [...mode.state.grafts.values()]
      .flat()
      .reduce<Record<string, number>>((acc, id) => {
        acc[id] = (acc[id] ?? 0) + 1;
        return acc;
      }, {}),
    boughOffers,
    boughFallbacks,
    botTimeouts,
    dropIns: dropIns.map((d) => d.row),
  };
}

function pct(a: number, b: number): string {
  return b > 0 ? `${Math.round((100 * a) / b)}%` : '-';
}

function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function histogram(levels: readonly number[]): string {
  const counts = new Map<number, number>();
  for (const l of levels) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([l, n]) => `${l}:${n}`)
    .join(' ');
}

function shares(row: Record<string, number>): string {
  const total = Object.values(row).reduce((a, b) => a + b, 0);
  return Object.entries(row)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${pct(n, total)}`)
    .join(', ');
}

function roamShare(rows: readonly Record<string, number>[]): { roam: number; total: number } {
  let roam = 0;
  let total = 0;
  for (const row of rows) {
    for (const [k, n] of Object.entries(row)) {
      total += n;
      if (k === 'roam') roam += n;
    }
  }
  return { roam, total };
}

function print(m: Match): void {
  const perMin = m.takedowns / Math.max(1 / 60, m.duration / 60);
  console.log(
    `\n${m.variant} seed ${m.seed}: over at ${clock(m.duration)}, first takedown ${clock(m.firstTakedown)}, ` +
      `${m.takedowns} takedowns (${perMin.toFixed(1)}/min)`,
  );
  console.log(`  takedowns by minute: ${m.takedownsByMin.join(' ')}`);
  console.log(`  deaths by minute:    ${m.deathsByMin.join(' ')}`);
  if (m.variant === 'one_life') console.log(`  alive by minute:     ${m.aliveByMin.join(' ')}`);
  console.log(`  caches by minute:    ${m.cachesByMin.join(' ')}`);
  const w = m.winner;
  console.log(
    `  winner: ${w ? `${w.championId} (${w.skill}) ${w.kills} kills, level ${w.level}` : 'none'}`,
  );
  console.log(
    `  top kills: ${m.top.map((t) => `${t.championId}/${t.skill} ${t.kills}-${t.deaths} L${t.level}`).join(', ')}`,
  );
  console.log(
    `  top grafts: ${m.top.map((t) => `${t.championId} ${t.grafts.join('+') || '-'}`).join(', ')}`,
  );
  console.log(`  dusk deaths ${m.duskDeaths}, pads ${m.pads}, camps ${m.camps}`);
  console.log(
    `  levels: ${histogram(m.levels)} (median ${m.levels[Math.floor(m.levels.length / 2)]})`,
  );
  const d = (a: string, b: string) => m.duels[a]?.[b] ?? 0;
  console.log(
    `  duels: normal beat gentle ${d('normal', 'gentle')}, gentle beat normal ${d('gentle', 'normal')}; ` +
      `strong beat gentle ${d('strong', 'gentle')}, gentle beat strong ${d('gentle', 'strong')}; ` +
      `strong beat normal ${d('strong', 'normal')}, normal beat strong ${d('normal', 'strong')}`,
  );
  if (m.variant === 'one_life') {
    const lasted = Object.entries(m.lastedBySkill)
      .map(([skill, xs]) => `${skill} ${clock(mean(xs))} (n ${xs.length})`)
      .join(', ');
    console.log(`  lasted on average: ${lasted}`);
    console.log(
      `  duels after the calm: ${m.duelsAfterCalm}, ended in a death within ${DUEL_END_S} s ${pct(m.duelsEnded, m.duelsAfterCalm)}`,
    );
  }
  for (const win of WINDOWS) {
    if (Object.keys(m.reasons[win]).length > 0) {
      console.log(`  decisions ${win} min: ${shares(m.reasons[win])}`);
    }
  }
  if (m.passiveGaps.length > 0) {
    console.log(
      `  passive: longest without an enemy in sight ${m.passiveGaps.map((g, i) => `${g} s from ${clock(m.passiveGapFrom[i] ?? 0)}`).join(', ')}` +
        (m.variant === 'one_life' ? `; fell at ${m.passiveFell.map(clock).join(', ')}` : ''),
    );
  }
  if (m.standinLives.length > 0) {
    console.log(
      `  stand-in: lives ${m.standinLives.map((s) => `${Math.round(s)}`).join(' ')} s` +
        (m.variant === 'one_life' ? `; place ${m.standinPlaces.join(', ')}` : ''),
    );
  }
  if (m.seedfallsLanded > 0) {
    console.log(
      `  seedfalls: landed ${m.seedfallsLanded}, opened ${m.seedfallsOpened}, contested ${m.seedfallsContested}, ` +
        `landing to opening ${m.seedfallOpenDelays.map((s) => `${Math.round(s)}`).join(' ')} s`,
    );
  }
  console.log(
    `  risings: ${m.fallen.map((f) => `${f.kind} ${clock(f.at)}`).join(', ') || 'none fell'}; ` +
      `the Wrath passed ${m.wrathPasses} times, takedowns per holder ${m.wrathKills.join(' ') || '-'}; ` +
      `lodestar taken down ${m.lodestarDowns}; takedowns on a mark ${m.markTakedowns} of ${m.takedowns}`,
  );
  console.log(
    `  grafts: held ${histogram(m.graftsHeld)} (mean ${mean(m.graftsHeld).toFixed(1)}), ` +
      `bough offers ${m.boughOffers} (${m.boughFallbacks} with a sprout), bot offers run out ${m.botTimeouts}`,
  );
  console.log(
    `  enemy within ${ENGAGE_M} m in sight: fighting ${pct(m.engagedSeconds, m.nearSeconds)} of ${m.nearSeconds} bot-seconds; ` +
      `steals ${pct(m.steals, m.champTakedowns)} of ${m.champTakedowns} takedowns`,
  );
  for (const d of m.dropIns) {
    const s = (x: number | null) => (x === null ? 'never' : `${Math.round(x)} s`);
    console.log(
      `  drop-in at ${clock(d.joinAt)}: level ${d.level} (field ${d.fieldLevel}), nearest enemy ` +
        `${d.nearestM === null ? '-' : `${d.nearestM.toFixed(1)} m`}, fair foe ${d.fair ? 'yes' : 'no'}, ` +
        `an enemy in sight ${d.seen ? 'yes' : 'no'}, ` +
        `first hit ${s(d.firstDealt)}, first hurt ${s(d.firstTaken)}, first takedown ${s(d.firstTakedown)}, ` +
        `takedowns in ${DROPIN_EARLY_S} s ${d.earlyTakedowns}, first life ${Math.round(d.firstLife)} s` +
        (d.endedBy
          ? ` (ended by ${d.endedBy === 'nearest' ? 'the enemy nearest at landing' : d.endedBy === 'other' ? 'another' : 'the world'})`
          : ''),
    );
  }
  console.log(`  tick ${m.tickAvgMs.toFixed(2)} ms average, ${m.tickMaxMs.toFixed(1)} ms max`);
}

function verdict(ok: boolean): string {
  return ok ? 'ok' : 'MISS';
}

// The bots with intent's acceptance and the Seedfall's, over every match.
function acceptance(all: readonly Match[]): void {
  console.log('\nacceptance (bots with intent, seedfall):');
  const ol = all.filter((m) => m.variant === 'one_life');
  const rs = all.filter((m) => m.variant === 'respawn');
  if (ol.length > 0) {
    const curve = ALIVE_TARGET.map((target, i) => {
      const xs = ol.map((m) => m.aliveByMin[i] ?? 1);
      return { target, got: mean(xs) };
    });
    const within = curve.every(
      (c) => Math.abs(c.got - c.target) <= c.target * ALIVE_TOLERANCE + 1e-9,
    );
    console.log(
      `  one life alive by minute (mean): ${curve.map((c) => c.got.toFixed(1)).join(' ')}` +
        `  target ${ALIVE_TARGET.join(' ')} within ${ALIVE_TOLERANCE * 100}%: ${verdict(within)}`,
    );
    const firstMin = ol.map((m) => m.deathsByMin[0] ?? 0);
    console.log(
      `  one life first-minute deaths: ${firstMin.join(' ')} (max ${FIRST_MINUTE_DEATHS_MAX}): ${verdict(firstMin.every((n) => n <= FIRST_MINUTE_DEATHS_MAX))}`,
    );
    const second = ol.map((m) => (m.deathsByMin[1] ?? 0) <= (m.deathsByMin[0] ?? 0));
    console.log(
      `  one life minute-2 deaths not above minute 1's: ${ol.map((m) => `${m.deathsByMin[1] ?? 0}/${m.deathsByMin[0] ?? 0}`).join(' ')}: ${verdict(second.every(Boolean))}`,
    );
    const late = roamShare(ol.flatMap((m) => [m.reasons['3-6'], m.reasons['6+']]));
    console.log(
      `  one life late roam share (from 3:00): ${pct(late.roam, late.total)} (max ${LATE_ROAM_MAX * 100}%): ${verdict(late.total === 0 || late.roam / late.total <= LATE_ROAM_MAX)}`,
    );
    const duels = ol.reduce((a, m) => a + m.duelsAfterCalm, 0);
    const ended = ol.reduce((a, m) => a + m.duelsEnded, 0);
    console.log(
      `  one life duels after the calm ended in a death within ${DUEL_END_S} s: ${ended} of ${duels} (${pct(ended, duels)}, min ${DUEL_END_SHARE_MIN * 100}%): ${verdict(duels > 0 && ended / duels >= DUEL_END_SHARE_MIN)}`,
    );
    const lasted: Record<string, number[]> = {};
    for (const m of ol) {
      for (const [k, xs] of Object.entries(m.lastedBySkill))
        lasted[k] = [...(lasted[k] ?? []), ...xs];
    }
    const avg = (k: string) => (lasted[k] ? mean(lasted[k]!) : null);
    const order = ['strong', 'normal', 'gentle', 'passive'].map((k) => ({ k, s: avg(k) }));
    const ordered = order.every((o, i) => {
      const next = order[i + 1];
      return !next || o.s === null || next.s === null || o.s > next.s;
    });
    const normalMedian = median(lasted.normal ?? []);
    const passiveMedian = median(lasted.passive ?? []);
    console.log(
      `  one life lasted strong > normal > gentle > passive: ${order.map((o) => `${o.k} ${clock(o.s)}`).join(', ')}: ${verdict(ordered)}; ` +
        `passive median ${clock(passiveMedian)} before normal median ${clock(normalMedian)}: ${verdict(passiveMedian === null || normalMedian === null || passiveMedian < normalMedian)}`,
    );
    const td36 = ol.map(
      (m) =>
        ((m.takedownsByMin[3] ?? 0) + (m.takedownsByMin[4] ?? 0) + (m.takedownsByMin[5] ?? 0)) / 3,
    );
    console.log(
      `  one life takedowns a minute in minutes 3 to 6: ${td36.map((x) => x.toFixed(1)).join(' ')} (seedfall's min 2)`,
    );
    const places = ol.flatMap((m) => m.standinPlaces);
    if (places.length > 0) console.log(`  one life stand-in places: ${places.join(' ')}`);
  }
  if (rs.length > 0) {
    const gaps = rs.flatMap((m) => m.passiveGaps);
    const g = median(gaps);
    console.log(
      `  respawn passive longest stretch with no enemy in sight, median: ${g ?? '-'} s (max ${PASSIVE_GAP_MAX_S}): ${verdict(g === null || g <= PASSIVE_GAP_MAX_S)}`,
    );
    const lives = rs.flatMap((m) => m.standinLives);
    const l = median(lives);
    // Before the last two closings, and after: the light's last caps pack
    // fifty seats into a few hundred square meters.
    const early = rs.flatMap((m) =>
      m.standinLives.filter((_, i) => (m.standinLifeStarts[i] ?? 0) < STANDIN_EARLY_S),
    );
    const e = median(early);
    console.log(
      `  respawn stand-in median life: ${l === null ? '-' : l.toFixed(0)} s over ${lives.length} lives (min ${STANDIN_LIFE_MIN_S}): ${verdict(l === null || l >= STANDIN_LIFE_MIN_S)}; ` +
        `of the lives begun before ${clock(STANDIN_EARLY_S)}: ${e === null ? '-' : e.toFixed(0)} s over ${early.length}`,
    );
    // The same by the minute each life began: where the short ones are.
    const byMinute: string[] = [];
    for (let minute = 0; minute < PLAY_S / 60; minute++) {
      const of = rs.flatMap((m) =>
        m.standinLives.filter((_, i) => Math.floor((m.standinLifeStarts[i] ?? 0) / 60) === minute),
      );
      const med = median(of);
      byMinute.push(`${minute}: ${med === null ? '-' : med.toFixed(0)} (${of.length})`);
    }
    console.log(`  respawn stand-in median life by the minute it began: ${byMinute.join(', ')}`);
  }
  for (const variant of ['one_life', 'respawn'] as const) {
    const ms = all.filter((m) => m.variant === variant);
    const landed = ms.reduce((a, m) => a + m.seedfallsLanded, 0);
    if (landed === 0) {
      if (ms.length > 0) console.log(`  ${variant} seedfalls: none landed`);
      continue;
    }
    const opened = ms.reduce((a, m) => a + m.seedfallsOpened, 0);
    const contested = ms.reduce((a, m) => a + m.seedfallsContested, 0);
    const delay = median(ms.flatMap((m) => m.seedfallOpenDelays));
    console.log(
      `  ${variant} seedfalls: ${landed} landed, opened ${pct(opened, landed)} (min 90%), contested ${pct(contested, opened)} (min 50%), ` +
        `landing to opening median ${delay === null ? '-' : delay.toFixed(0)} s (10 to 45)`,
    );
  }
}

// The Risings and the hunted (risings-and-the-hunted's acceptance): each of
// the Pyrefang and the Voidmaul taken in 80% of the matches, the Warden in
// 70% of Respawn's and 40% of One life's, the Wrath passed at least once in
// half of Respawn's, a holder's takedowns with it at most 4 at the median,
// Respawn's Lodestar taken down 8 times a match, and a tenth of the
// takedowns on a marked champion; Respawn's share that settled a Burr
// beside them, with no bar.
function risingsAcceptance(all: readonly Match[]): void {
  for (const variant of ['respawn', 'one_life'] as const) {
    const ms = all.filter((m) => m.variant === variant);
    if (ms.length === 0) continue;
    const share = (kind: string) => ms.filter((m) => m.fallen.some((f) => f.kind === kind)).length;
    const wardenMin = variant === 'respawn' ? 0.7 : 0.4;
    const line = (kind: string, min: number) => {
      const n = share(kind);
      return `${kind} ${n}/${ms.length} (min ${min * 100}%): ${verdict(n / ms.length >= min)}`;
    };
    console.log(
      `  ${variant} risings taken: ${line('pyrefang', 0.8)}, ${line('voidmaul', 0.8)}, ${line('warden', wardenMin)}`,
    );
    const firsts = (kind: string) =>
      ms.map((m) => m.fallen.find((f) => f.kind === kind)?.at ?? null).filter((x) => x !== null);
    console.log(
      `  ${variant} first falls: pyrefang ${firsts('pyrefang').map(clock).join(' ')}, voidmaul ${firsts('voidmaul').map(clock).join(' ')}, warden ${firsts('warden').map(clock).join(' ')}`,
    );
    const perHolder = median(ms.flatMap((m) => m.wrathKills));
    const passed = ms.filter((m) => m.wrathPasses > 0).length;
    console.log(
      `  ${variant} the Wrath: passed in ${passed}/${ms.length}` +
        (variant === 'respawn' ? ` (min 50%): ${verdict(passed / ms.length >= 0.5)}` : '') +
        `; takedowns per holder median ${perHolder === null ? '-' : perHolder} (max 4): ${verdict(perHolder === null || perHolder <= 4)}`,
    );
    const marked = ms.reduce((a, m) => a + m.markTakedowns, 0);
    const td = ms.reduce((a, m) => a + m.takedowns, 0);
    const downs = mean(ms.map((m) => m.lodestarDowns));
    const burrs = ms.reduce((a, m) => a + m.burrTakedowns, 0);
    console.log(
      `  ${variant} the hunted: takedowns on a mark ${pct(marked, td)} (min 10%): ${verdict(td > 0 && marked / td >= 0.1)}` +
        (variant === 'respawn'
          ? `; the Lodestar taken down ${downs.toFixed(1)} a match (min 8): ${verdict(downs >= 8)}` +
            `; Burrs settled ${pct(burrs, td)} of the takedowns`
          : `; the Lodestar taken down ${downs.toFixed(1)} a match`),
    );
  }
}

// The Grafts' acceptance (ADR 0032): every One life seat holds one, the
// mean held at a seat's fall or the end, each Graft's share of its grade's
// picks against an even share, the Bough offers filled with a Sprout, and
// no bot offer run out.
function graftAcceptance(all: readonly Match[]): void {
  console.log('\ngrafts:');
  const band = { one_life: [1.5, 3], respawn: [4, 7] } as const;
  for (const variant of ['one_life', 'respawn'] as const) {
    const ms = all.filter((m) => m.variant === variant);
    if (ms.length === 0) continue;
    const held = ms.flatMap((m) => m.graftsHeld);
    const avg = mean(held);
    const [lo, hi] = band[variant];
    const none = held.filter((n) => n === 0).length;
    console.log(
      `  ${variant} held at the fall or the end: mean ${avg.toFixed(2)} (${lo} to ${hi}): ${verdict(avg >= lo && avg <= hi)}` +
        (variant === 'one_life'
          ? `; seats holding none ${none} of ${held.length} (0): ${verdict(none === 0)}`
          : ''),
    );
    const offers = ms.reduce((a, m) => a + m.boughOffers, 0);
    const fell = ms.reduce((a, m) => a + m.boughFallbacks, 0);
    console.log(
      `  ${variant} bough offers filled with a sprout: ${pct(fell, offers)} of ${offers} (max 30%): ${verdict(fell <= offers * 0.3)}`,
    );
    const late = ms.reduce((a, m) => a + m.botTimeouts, 0);
    console.log(`  ${variant} bot offers run out: ${late} (0): ${verdict(late === 0)}`);
    const taken: Record<string, number> = {};
    for (const m of ms) {
      for (const [id, n] of Object.entries(m.graftsTaken)) taken[id] = (taken[id] ?? 0) + n;
    }
    for (const grade of ['sprout', 'bough', 'heartwood'] as const) {
      const ids = GRAFT_LIST.filter((g) => g.grade === grade).map((g) => g.id);
      const total = ids.reduce((a, id) => a + (taken[id] ?? 0), 0);
      if (total === 0) continue;
      const even = 1 / ids.length;
      const top = Math.max(...ids.map((id) => (taken[id] ?? 0) / total));
      console.log(
        `  ${variant} ${grade} picks (${total}): ${ids.map((id) => `${id} ${pct(taken[id] ?? 0, total)}`).join(', ')}; ` +
          `top ${(top * 100).toFixed(0)}% against an even ${(even * 100).toFixed(0)}% (max 1.5x): ${verdict(top <= even * 1.5)}`,
      );
    }
  }
}

// The median with the ones that never came (null) counted last, so a
// median that falls on them reads 'never'.
function medianOrNever(xs: readonly (number | null)[]): string {
  if (xs.length === 0) return '-';
  const inf = Number.POSITIVE_INFINITY;
  const s = [...xs].sort((a, b) => (a ?? inf) - (b ?? inf));
  const m = Math.floor(s.length / 2);
  const lo = s.length % 2 === 1 ? s[m]! : s[m - 1]!;
  const hi = s[m]!;
  if (lo === null || hi === null) return 'never';
  return `${((lo + hi) / 2).toFixed(1)} s`;
}

// The drop-ins by the time they joined, then all of them.
function dropInSummary(all: readonly Match[]): void {
  for (const variant of ['respawn', 'one_life'] as const) {
    const rows = all.filter((m) => m.variant === variant).flatMap((m) => m.dropIns);
    if (rows.length === 0) continue;
    console.log(`\ndrop-ins (${variant}), by the time they joined:`);
    const times = [...new Set(rows.map((d) => d.joinAt))].sort((a, b) => a - b);
    const line = (label: string, ds: readonly DropIn[]) => {
      const nearest = median(ds.flatMap((d) => (d.nearestM === null ? [] : [d.nearestM])));
      const level = median(ds.map((d) => d.level));
      const field = median(ds.map((d) => d.fieldLevel));
      const life = median(ds.map((d) => d.firstLife));
      console.log(
        `  ${label}: n ${ds.length}, fair foe ${pct(ds.filter((d) => d.fair).length, ds.length)}, ` +
          `an enemy in sight at landing ${pct(ds.filter((d) => d.seen === true).length, ds.length)}, ` +
          `level median ${level ?? '-'} (field ${field ?? '-'}), ` +
          `nearest enemy median ${nearest === null ? '-' : nearest.toFixed(1)} m, ` +
          `first hit median ${medianOrNever(ds.map((d) => d.firstDealt))}, ` +
          `first hurt median ${medianOrNever(ds.map((d) => d.firstTaken))}, ` +
          `takedown within ${DROPIN_EARLY_S} s ${pct(ds.filter((d) => d.earlyTakedowns > 0).length, ds.length)}, ` +
          `takedowns in ${DROPIN_EARLY_S} s mean ${mean(ds.map((d) => d.earlyTakedowns)).toFixed(2)}, ` +
          `first life median ${life === null ? '-' : life.toFixed(0)} s, ` +
          `ended by the enemy nearest at landing ${pct(ds.filter((d) => d.endedBy === 'nearest').length, ds.length)}`,
      );
    };
    for (const t of times) {
      line(
        clock(t),
        rows.filter((d) => d.joinAt === t),
      );
    }
    line('all', rows);
  }
}

// One line per variant to hold a change against: the stand-in median life,
// the bots' fighting share, the steals and the final level median.
function compareLine(all: readonly Match[]): void {
  for (const variant of ['respawn', 'one_life'] as const) {
    const ms = all.filter((m) => m.variant === variant);
    if (ms.length === 0) continue;
    const life = median(ms.flatMap((m) => m.standinLives));
    const near = ms.reduce((a, m) => a + m.nearSeconds, 0);
    const engaged = ms.reduce((a, m) => a + m.engagedSeconds, 0);
    const tds = ms.reduce((a, m) => a + m.champTakedowns, 0);
    const steals = ms.reduce((a, m) => a + m.steals, 0);
    const level = median(ms.flatMap((m) => m.levels));
    console.log(
      `\ncompare ${variant}: stand-in median life ${life === null ? '-' : life.toFixed(1)} s, ` +
        `fighting ${near > 0 ? ((100 * engaged) / near).toFixed(1) : '-'}%, ` +
        `steals ${tds > 0 ? ((100 * steals) / tds).toFixed(1) : '-'}%, final level median ${level ?? '-'}`,
    );
  }
}

function summary(all: readonly Match[]): void {
  console.log(
    '\nvariant   seed  length first  td/min  last2/min peak/min winner                 top5 kills       dusk pads caches(0-3) camps lvl-med tick',
  );
  for (const m of all) {
    const perMin = m.takedowns / Math.max(1 / 60, m.duration / 60);
    const mins = m.takedownsByMin;
    const fullMins = Math.floor(m.duration / 60);
    const last2 = (mins[fullMins - 1] ?? 0) + (mins[fullMins - 2] ?? 0);
    const peak = Math.max(0, ...mins.slice(0, Math.max(1, fullMins)));
    const w = m.winner;
    const win = w ? `${w.championId}/${w.skill} ${w.kills}k L${w.level}` : 'none';
    const top = m.top.map((t) => t.kills).join(',');
    const early = (m.cachesByMin[0] ?? 0) + (m.cachesByMin[1] ?? 0) + (m.cachesByMin[2] ?? 0);
    const median = m.levels[Math.floor(m.levels.length / 2)];
    console.log(
      `${m.variant.padEnd(9)} ${String(m.seed).padStart(4)}  ${clock(m.duration).padStart(5)}  ${clock(m.firstTakedown).padStart(5)} ` +
        `${perMin.toFixed(0).padStart(6)} ${String(last2 / 2).padStart(9)} ${String(peak).padStart(8)} ${win.padEnd(22)} ${top.padEnd(16)} ` +
        `${String(m.duskDeaths).padStart(4)} ${String(m.pads).padStart(4)} ` +
        `${`${m.cachesByMin.reduce((a, b) => a + b, 0)}(${early})`.padStart(11)} ${String(m.camps).padStart(5)} ${String(median).padStart(7)} ${m.tickAvgMs.toFixed(2)}`,
    );
  }
  const totals: Record<string, Record<string, number>> = {};
  for (const m of all) {
    for (const [a, row] of Object.entries(m.duels)) {
      for (const [b, n] of Object.entries(row)) {
        totals[a] ??= {};
        totals[a]![b] = (totals[a]![b] ?? 0) + n;
      }
    }
  }
  for (const variant of ['respawn', 'one_life'] as const) {
    const ms = all.filter((x) => x.variant === variant);
    if (ms.length === 0) continue;
    const near = ms.reduce((a, m) => a + m.nearSeconds, 0);
    const engaged = ms.reduce((a, m) => a + m.engagedSeconds, 0);
    const tds = ms.reduce((a, m) => a + m.champTakedowns, 0);
    const steals = ms.reduce((a, m) => a + m.steals, 0);
    console.log(
      `${variant}: an enemy in sight within ${ENGAGE_M} m, fighting ${pct(engaged, near)} of the time; steals ${pct(steals, tds)} of takedowns`,
    );
    for (const win of WINDOWS) {
      const row: Record<string, number> = {};
      for (const m of ms) {
        for (const [k, n] of Object.entries(m.reasons[win])) row[k] = (row[k] ?? 0) + n;
      }
      if (Object.keys(row).length > 0)
        console.log(`  ${variant} decisions ${win} min: ${shares(row)}`);
    }
  }
  const t = (a: string, b: string) => totals[a]?.[b] ?? 0;
  const share = (a: number, b: number) => (a + b > 0 ? `${Math.round((100 * a) / (a + b))}%` : '-');
  console.log(
    `\nfights won by the stronger skill: normal over gentle ${share(t('normal', 'gentle'), t('gentle', 'normal'))}, ` +
      `strong over gentle ${share(t('strong', 'gentle'), t('gentle', 'strong'))}, ` +
      `strong over normal ${share(t('strong', 'normal'), t('normal', 'strong'))}`,
  );
  const ol = all.filter((m) => m.variant === 'one_life');
  if (ol.length > 0) {
    const lasted: Record<string, number[]> = {};
    for (const m of ol) {
      for (const [k, xs] of Object.entries(m.lastedBySkill)) {
        lasted[k] = [...(lasted[k] ?? []), ...xs];
      }
    }
    console.log(
      `one life, lasted on average: ${Object.entries(lasted)
        .map(([k, xs]) => `${k} ${clock(mean(xs))} (n ${xs.length})`)
        .join(', ')}`,
    );
  }
  for (const variant of ['respawn', 'one_life'] as const) {
    const ms = all.filter((x) => x.variant === variant);
    if (ms.length === 0) continue;
    const by = new Map<string, { kills: number; deaths: number; n: number }>();
    for (const m of ms) {
      for (const s of m.seats) {
        const row = by.get(s.championId) ?? { kills: 0, deaths: 0, n: 0 };
        row.kills += s.kills;
        row.deaths += s.deaths;
        row.n++;
        by.set(s.championId, row);
      }
    }
    const rates = [...by.values()].map((r) => r.kills / r.n);
    const low = Math.min(...rates);
    console.log(
      `${variant} takedowns per seat by champion: ${[...by.entries()]
        .sort((a, b) => b[1].kills / b[1].n - a[1].kills / a[1].n)
        .map(([id, r]) => `${id} ${(r.kills / r.n).toFixed(1)}/${(r.deaths / r.n).toFixed(1)}`)
        .join(', ')}; spread ${low > 0 ? (Math.max(...rates) / low).toFixed(2) : '-'}`,
    );
  }
  const wins = new Map<string, number>();
  for (const m of all.filter((x) => x.variant === 'respawn')) {
    const id = m.winner?.championId ?? 'none';
    wins.set(id, (wins.get(id) ?? 0) + 1);
  }
  if (wins.size > 0) {
    console.log(
      `respawn winners: ${[...wins.entries()].map(([id, n]) => `${id} ${n}`).join(', ')}`,
    );
  }
  acceptance(all);
  console.log('\nacceptance (the Risings and the hunted):');
  risingsAcceptance(all);
  graftAcceptance(all);
  dropInSummary(all);
  compareLine(all);
}

const planet = loadPlanet();
const all: Match[] = [];
for (const variant of variants) {
  for (let seed = firstSeed; seed < firstSeed + seeds; seed++) {
    const m = play(planet, variant, seed, passiveSeats, standinSeats, dropinTimes);
    all.push(m);
    if (!quiet) print(m);
  }
}
summary(all);
