// The battle royale run by the sim (ADR 0031): the mode's state and the
// steps the sim's fixed tick calls, each a thin driver over the pure rules
// beside this file. The sim owns one when it is built with
// SimOptions.royale; the 5v5 never constructs it. In the tick:
//   the drop (only decisions run, then everyone lands) ->
//   [play] before the tick: health noted for One life's ties ->
//   after the walk: the launch pads ->
//   after the zones: the Dusk's burn, then a Seedfall's impact ->
//   in the deaths: takedowns, loot, experience, places ->
//   after the deaths: caches, Seedfalls, Risings, marks, Clamors, Grafts,
//   the Last light, the leader, the end.
// Everything here moves with the match and is in the world checkpoint
// (snapshot, restore); the schedule and the layout are fixed at the start.

import { POLICY_PERIOD_TICKS } from '../bot_driver';
import { dealDamage } from '../combat/damage';
import { addStatus, cancelRecall } from '../combat/status';
import type { RoyaleSkillId } from '../content/bots/royale_skills';
import { GRAFT_TRIGGERS, recoveryOf, takedownHealOf } from '../content/grafts';
import { planetTuning } from '../content/royale_tuning';
import { outOfCombat } from '../favors';
import { copy, dist2, type Vec3 } from '../geo';
import type { Ground } from '../ground';
import type { ObsRoyale } from '../policy';
import type { Rng } from '../rng';
import type { Sim } from '../sim';
import type { CombatCtx } from '../sim_context';
import { DT } from '../types';
import type { Unit } from '../unit';
import { payAssists } from './assists';
import { burrTakedown, clearBurrs, observeBurr, stepBurrs } from './burr';
import { drawCacheSpots, openingBy, stepCaches } from './caches';
import { noteClamor, observeClamors, stepClamors } from './clamors';
import { dealEscorts, ESCORTS, escortLandings, normalizePick, resolveLandings } from './drop';
import { type DuskSchedule, drawDusk, duskAt, insideCap } from './dusk';
import { arrive, beginGrace, type Grace, observeGrace, stepGraces } from './grace';
import {
  clearOffers,
  type GraftTally,
  hasOpenOffer,
  observeGrafts,
  offerCreatureHeartwood,
  offerDrop,
  offerOnLevels,
  offerOnTrigger,
  pickGraft,
  stepGrafts,
  tallyOf,
} from './grafts';
import { lastLightFactor, stepLastLight } from './last_light';
import type { RoyaleGround, RoyaleLayout } from './layout';
import { creatureXp, grantXp, landingLevels, takedownXp } from './levels';
import { GOLDEN_PIECES, grantPieces, healShare, manaShare, seatBuild, streakShare } from './loot';
import { markOf, markPayout, markSlayer, observeMarks, stepMarks } from './marks';
import { flightOver, flightPos, type PadFlight, padSites, padUnder, startFlight } from './pads';
import { returnSpot, takesReturnPick } from './return_pick';
import {
  grantRoyaleWrath,
  observeRisings,
  risingReward,
  stepRisings,
  wrathOnDeath,
} from './risings';
import {
  edgeOfLight,
  type Fallen,
  oneLifeRanking,
  placeFallen,
  respawnRanking,
  returnCap,
  type Standing,
} from './score';
import {
  observeSeedfalls,
  openedSeedfall,
  type SeedfallCall,
  seedfallImpact,
  seedfallSchedule,
  seedfallSpots,
  stepSeedfalls,
} from './seedfall';
import {
  CACHE_MANA,
  CAMP_BACK_S,
  CAMP_HEAL,
  CAMP_MANA,
  DROP_S,
  MARK_SHOWN_S,
  OUT_OF_COMBAT_HEAL,
  OUT_OF_COMBAT_MANA,
  OUT_OF_COMBAT_S,
  OUT_OF_COMBAT_SPEED,
  PAD_REACH_M,
  PLAY_S,
  RESPAWN_S,
  ROYALE_HP_SCALE,
  type RoyaleEvent,
  type RoyaleState,
  type RoyaleVariant,
  TAKEDOWN_HEAL,
  TAKEDOWN_MANA,
} from './types';

export interface RoyaleOptions {
  variant: RoyaleVariant;
  layout: RoyaleLayout;
}

// What a match measured of itself: the numbers a test reads to tell a fun
// match from a dull one. Not part of any rule.
export interface RoyaleTally {
  firstTakedownAt: number | null;
  takedowns: number;
  cachesOpened: number;
  duskDeaths: number;
  padsUsed: number;
  campsTaken: number;
  // The Seedfalls (seedfall.ts): landed, their cache opened, and opened
  // with two or more champions within 12 m (contested).
  seedfallsLanded: number;
  seedfallsOpened: number;
  seedfallsContested: number;
  // The Risings and the hunted (risings.ts, marks.ts): big creatures and
  // Wardens taken, and takedowns on a marked champion (the Lodestar, an
  // Ablaze run, the Wrath's holder).
  creaturesTaken: number;
  wardensTaken: number;
  markTakedowns: number;
  // Respawn takedowns that settled a Burr (burr.ts).
  burrTakedowns: number;
  // Respawn Arrivals that came down beside a fair first fight (grace.ts).
  fairArrivals: number;
  // Respawn returns set down at the seat's own pick (return_pick.ts).
  returnsPicked: number;
}

// The ground's answers as the mode's rules ask them.
export function royaleGround(ground: Ground): RoyaleGround {
  return {
    walkable: (p) => ground.isWalkableAt(p),
    nearestWalkable: (p) => {
      const q = ground.nearestWalkable(p, 24);
      return q && q.y !== undefined ? { x: q.x, y: q.y, z: q.z } : null;
    },
  };
}

// The skills a person's company is drawn from, in order: a normal bot
// first, one that fights the other escort too; a newcomer (a person who
// never banked a battle royale award) gets the gentle ones first.
export const ESCORT_ORDER: readonly RoyaleSkillId[] = ['normal', 'strong', 'gentle'];
export const NEWCOMER_ESCORT_ORDER: readonly RoyaleSkillId[] = ['gentle', 'normal', 'strong'];

export class RoyaleMode {
  readonly variant: RoyaleVariant;
  readonly layout: RoyaleLayout;
  readonly ground: RoyaleGround;
  readonly schedule: DuskSchedule;
  // The Seedfalls' calls and the spots a seed may land on, fixed at the
  // start like the Dusk's schedule (seedfall.ts).
  readonly seedfallCalls: readonly SeedfallCall[];
  readonly seedfallSpots: readonly Vec3[];
  state: RoyaleState;
  // Moving parts beside the public state.
  flights = new Map<number, PadFlight>();
  // Landed from a pad and not yet off every pad's reach.
  padHold = new Set<number>();
  // The build each seat walks, fixed at seating.
  builds = new Map<number, string[]>();
  // The skill each seat's bot plays (a stand-in plays the seat's).
  skills = new Map<number, RoyaleSkillId>();
  // The seats of people new to the battle royale (never banked an award),
  // fixed before the first tick by the builder (src/net/replay.ts
  // buildRoyaleSim): their escorts are dealt gentle first (stepDrop).
  newcomers: ReadonlySet<number> = new Set();
  // When each seat last pressed a cast or a sigil or ordered an attack:
  // what disturbs a cache's opening beside a hit, and ends a Grace.
  lastActAt = new Map<number, number>();
  // The fresh champions in their Grace (grace.ts), by unit id, in the
  // order they began; RoyaleState.arriving lists the same seats.
  graces = new Map<number, Grace>();
  // What each seat did toward its Graft offers (grafts.ts GraftTally).
  graftTally = new Map<number, GraftTally>();
  tally: RoyaleTally = {
    firstTakedownAt: null,
    takedowns: 0,
    cachesOpened: 0,
    duskDeaths: 0,
    padsUsed: 0,
    campsTaken: 0,
    seedfallsLanded: 0,
    seedfallsOpened: 0,
    seedfallsContested: 0,
    creaturesTaken: 0,
    wardensTaken: 0,
    markTakedowns: 0,
    burrTakedowns: 0,
    fairArrivals: 0,
    returnsPicked: 0,
  };
  private hpBefore = new Map<number, number>();
  private aliveBefore = 0;
  private fallen: Fallen[] = [];
  private fallenKiller = new Map<number, number>();
  private duskHit = new Set<number>();
  // Champions a Seedfall's impact finished this tick (no Wrath passes on
  // a fall the world dealt: risings.ts wrathOnDeath).
  private impactHit = new Set<number>();
  private obsTick = -1;
  private obsShared: Pick<ObsRoyale, 'caches' | 'pads' | 'dusk' | 'alive'> | null = null;

  constructor(rng: Rng, ground: Ground, options: RoyaleOptions) {
    this.variant = options.variant;
    this.layout = options.layout;
    this.ground = royaleGround(ground);
    const landAt = DROP_S;
    this.schedule = drawDusk(rng, this.layout, this.ground, landAt);
    const drawn = drawCacheSpots(this.layout.cacheSpots, rng);
    this.seedfallCalls = seedfallSchedule(this.variant, landAt);
    this.seedfallSpots = seedfallSpots(
      this.layout.cacheSpots,
      drawn.unused,
      this.layout,
      this.ground,
    );
    this.state = {
      variant: this.variant,
      stage: 'drop',
      dropEndsAt: landAt,
      endsAt: landAt + PLAY_S,
      dusk: duskAt(this.schedule, 0),
      caches: drawn.caches,
      pads: padSites(this.layout.pads),
      drops: new Map(),
      scores: new Map(),
      eliminated: [],
      winnerId: null,
      leaderId: null,
      leaderShownAt: landAt,
      seedfalls: [],
      risings: [],
      marks: [],
      burrs: new Map(),
      clamors: [],
      wrathHolder: null,
      offers: new Map(),
      grafts: new Map(),
      reprieveUsed: new Set(),
      duskOffset: 0,
      respawnPicks: new Map(),
      arriving: new Set(),
    };
  }

  // A champion seated for the mode: no gold, the planet's health and
  // damage (the planet's share times the champion's own tuning, content/
  // royale_tuning.ts), landing at level 3 with Q, W and E, the out of
  // combat speed, its build fixed.
  seat(u: Unit, kitBuild?: readonly string[], skill?: RoyaleSkillId): void {
    const tuning = planetTuning(u.championId);
    u.gold = 0;
    u.outOfCombatBonus = OUT_OF_COMBAT_SPEED;
    u.hpScale = ROYALE_HP_SCALE * tuning.hp;
    u.dmgScale = tuning.dmg;
    landingLevels(u);
    this.builds.set(u.id, seatBuild(u.championId, kitBuild));
    if (skill) this.skills.set(u.id, skill);
    this.state.scores.set(u.id, 0);
  }

  // The newcomers' unit ids, set once by the builder before the first tick.
  setNewcomers(unitIds: readonly number[]): void {
    this.newcomers = new Set(unitIds);
  }

  skillOf(unitId: number): RoyaleSkillId {
    return this.skills.get(unitId) ?? 'normal';
  }

  isOver(): boolean {
    return this.state.stage === 'over';
  }

  isFlying(unitId: number): boolean {
    return this.flights.has(unitId);
  }

  noteAct(unitId: number, time: number): void {
    this.lastActAt.set(unitId, time);
  }

  // A landing pick during the drop, or in Respawn's play a dead seat's
  // pick of where it comes back (return_pick.ts; the last pick wins); false
  // otherwise or for a bad point.
  pickDrop(unitId: number, p: Vec3, time: number, dead = false): boolean {
    const s = this.state;
    if (s.stage === 'play') {
      if (!takesReturnPick(this.variant, s.stage, dead)) return false;
      const back = normalizePick(p, this.layout.radius);
      if (back) s.respawnPicks.set(unitId, back);
      return back !== null;
    }
    if (s.stage !== 'drop' || time >= s.dropEndsAt) return false;
    const pick = normalizePick(p, this.layout.radius);
    if (!pick) return false;
    s.drops.set(unitId, pick);
    return true;
  }

  // A seat's pick of its open Graft offer (the 'graft' action, Sim.pickGraft):
  // free like the drop's pick, taken while dead, flying or dropping. False
  // when nothing was taken (grafts.ts).
  pickGraft(sim: Sim, unitId: number, pick: number): boolean {
    return pickGraft(this, sim, unitId, pick);
  }

  // A drop-in's Arrival (CONTEXT.md; Sim.beginArrival, the replay's
  // 'arrive' event): the seat a person takes from its bot comes down fresh
  // inside the light, in Respawn at the field's level beside a fair first
  // fight, else at a quiet spot, in its Grace, its tally from zero
  // (grace.ts arrive). Only in play.
  beginArrival(sim: Sim, unitId: number): void {
    // The bot's pick of where to come back is not the person's.
    this.state.respawnPicks.delete(unitId);
    const u = sim.units.get(unitId);
    if (!u || !arrive(this, sim, u)) return;
    // It never fell and took nobody down: no Burr either way (burr.ts).
    clearBurrs(this.state, unitId);
    offerOnTrigger(this, sim, unitId, 'arrival');
  }

  // A champion back from a Respawn death (the sim's respawn loop, once its
  // statuses are cleared): in its Grace.
  onRespawn(sim: Sim, u: Unit): void {
    beginGrace(this, u, sim.time);
  }

  // Whether the bot driver runs a dead seat's policy on this decision slot:
  // while its Graft offer is open (a Respawn seat; One life's elimination
  // clears the queue), and in Respawn's play on its first slot after the
  // fall, to pick where it comes back (the 'drop' while dead, the pick a
  // person makes on the globe through the wait; the house brain picks
  // nothing, bot/brain.ts): once a wait, not every slot of it, since every
  // slot cost an observation per dead seat (some 3 percent of a match's
  // time). Never in the 5v5.
  wantsDeadDecision(u: Pick<Unit, 'id' | 'respawnAt'>, time: number): boolean {
    if (hasOpenOffer(this, u.id)) return true;
    if (!takesReturnPick(this.variant, this.state.stage, true)) return false;
    if (this.state.respawnPicks.has(u.id)) return false;
    return time - (u.respawnAt - RESPAWN_S) <= POLICY_PERIOD_TICKS * DT + 1e-6;
  }

  // The health a champion comes back with (the sim's respawn loop): all of
  // it, until a Reprieve brings one back with less.
  respawnHealth(u: Unit): number {
    return u.maxHp;
  }

  // The Wrath handed to a champion on the planet (the Warden's last hit, an
  // Ascendant's): its own, the one holder there is (risings.ts).
  grantWrath(sim: Sim, killer: Unit): void {
    grantRoyaleWrath(this, sim, killer);
  }

  // A Heartwood Graft offered for a big creature's last hit (CONTEXT.md:
  // Graft): whether the seat was paid one (grafts.ts). A draw that came
  // short pays its piece in the offer's place and counts as paid; a seat
  // that can take no offer (out of One life, the match over) is not, and
  // the prize pays a piece in its place (risings.ts risingReward).
  offerHeartwood(sim: Sim, u: Unit): boolean {
    if (!GRAFT_TRIGGERS[this.variant].creature) return false;
    if (this.state.stage === 'over') return false;
    if (this.variant === 'one_life' && (u.dead || this.state.eliminated.includes(u.id))) {
      return false;
    }
    offerCreatureHeartwood(this, sim, u.id);
    return true;
  }

  private champions(sim: Sim): Unit[] {
    const out: Unit[] = [];
    for (const u of sim.units.values()) if (u.kind === 'champion') out.push(u);
    return out;
  }

  private emit(sim: Sim, e: RoyaleEvent): void {
    sim.pushEvent(e);
  }

  // The drop's tick: at its end every seat lands, in id order, and house
  // bots come down beside each person (a seat no policy plays): a normal
  // one first, the gentle first for a newcomer.
  stepDrop(sim: Sim): void {
    // The drop's Graft offer (grafts.ts): the tick after a seat's landing
    // pick, in seat order, then at the drop's end for any that made none.
    for (const id of [...this.state.drops.keys()].sort((a, b) => a - b)) offerDrop(this, sim, id);
    if (sim.time + 1e-9 < this.state.dropEndsAt) return;
    const seats = this.champions(sim).map((u) => u.id);
    for (const id of seats) offerDrop(this, sim, id);
    const at = resolveLandings(seats, this.state.drops, sim.rng, this.layout, this.ground);
    const people = seats.filter((id) => !sim.policies.has(id));
    const bots = seats.filter((id) => sim.policies.has(id));
    const groups = dealEscorts(people, bots, ESCORTS[this.variant], (person) => {
      const order = this.newcomers.has(person) ? NEWCOMER_ESCORT_ORDER : ESCORT_ORDER;
      const rank = (id: number): number => order.indexOf(this.skillOf(id));
      return (a, b) => rank(a) - rank(b) || a - b;
    });
    escortLandings(groups, at, sim.rng, this.layout, this.ground);
    for (const id of seats) {
      const u = sim.units.get(id)!;
      const p = at.get(id);
      if (p) u.pos = copy(p);
      u.path = [];
      this.emit(sim, { type: 'royale_land', unitId: id });
    }
    this.state.stage = 'play';
  }

  beforeTick(sim: Sim): void {
    stepGraces(this, sim);
    this.hpBefore.clear();
    this.aliveBefore = 0;
    for (const u of sim.units.values()) {
      if (u.kind !== 'champion' || u.dead) continue;
      this.hpBefore.set(u.id, u.hp);
      this.aliveBefore++;
    }
    this.fallen = [];
    this.fallenKiller.clear();
    this.duskHit.clear();
    this.impactHit.clear();
  }

  // The launch pads, after the walk: fliers carried along their circle and
  // landed exactly at the pad's point; a champion whose walk ends on a pad
  // thrown.
  stepPads(sim: Sim): void {
    const time = sim.time;
    for (const [id, f] of [...this.flights]) {
      const u = sim.units.get(id);
      if (!u || u.dead) {
        this.flights.delete(id);
        continue;
      }
      u.pos = flightPos(f, time);
      u.path = [];
      if (flightOver(f, time)) {
        this.flights.delete(id);
        this.padHold.add(id);
      }
    }
    const pads = this.state.pads;
    if (pads.length === 0) return;
    const r2 = PAD_REACH_M * PAD_REACH_M;
    for (const u of sim.units.values()) {
      if (u.kind !== 'champion' || u.dead || this.flights.has(u.id)) continue;
      if (this.padHold.has(u.id)) {
        if (pads.some((p) => dist2(p.at, u.pos) <= r2)) continue;
        this.padHold.delete(u.id);
      }
      const dest = u.path.length > 0 ? u.path[u.path.length - 1]! : null;
      const pad = padUnder(pads, u.pos, dest);
      if (!pad || u.pos.y === undefined) continue;
      const f = startFlight(u.id, pad, { x: u.pos.x, y: u.pos.y, z: u.pos.z }, time);
      this.flights.set(u.id, f);
      u.path = [];
      u.attackTargetId = null;
      u.attackMoveTarget = null;
      u.activeDash = null;
      u.pendingSpell = null;
      u.pendingAttack = null;
      cancelRecall(u);
      addStatus(u, { kind: 'airborne', until: f.endAt });
      addStatus(u, { kind: 'untargetable', until: f.endAt });
      this.tally.padsUsed++;
      this.emit(sim, { type: 'royale_pad', unitId: u.id, padId: pad.id });
    }
  }

  // Recovery with no fountain: out of combat (neither hit nor hitting for
  // OUT_OF_COMBAT_S), a share of the maximum mana back every second, and
  // of the maximum health while inside the light.
  // A Graft may start the heal sooner and make it stronger (Second Breath,
  // content/grafts.ts recoveryOf); the mana and the speed keep
  // OUT_OF_COMBAT_S.
  stepRecovery(ctx: CombatCtx): void {
    for (const u of ctx.units.values()) {
      if (u.kind !== 'champion' || u.dead) continue;
      const calm = outOfCombat(u, ctx.time);
      if (calm && u.maxMana > 0) {
        u.mana = Math.min(u.maxMana, u.mana + u.maxMana * OUT_OF_COMBAT_MANA * DT);
      }
      const heal =
        u.grafts.length > 0
          ? recoveryOf(u, OUT_OF_COMBAT_S, OUT_OF_COMBAT_HEAL)
          : { afterS: OUT_OF_COMBAT_S, share: OUT_OF_COMBAT_HEAL };
      const healing =
        calm ||
        (ctx.time - u.lastDamagedAt > heal.afterS && ctx.time - u.lastDealtDamageAt > heal.afterS);
      if (!healing) continue;
      if (u.pos.y !== undefined && !insideCap(this.state.dusk.now, u.pos as Vec3)) continue;
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * heal.share * DT);
    }
  }

  // The Dusk's tick: the light now, its phase told when it changes, the
  // burn outside it. The burn is no fight: it leaves the out of combat
  // clock and a cache's opening alone, and a kill it makes goes to the
  // last enemy who hit the champion inside the credit window, else nobody.
  stepDusk(ctx: CombatCtx, sim: Sim): void {
    const before = this.state.dusk.phase;
    const d = duskAt(this.schedule, ctx.time);
    this.state.dusk = d;
    if (d.phase !== before) this.emit(sim, { type: 'royale_dusk', phase: d.phase });
    if (d.burn <= 0) return;
    for (const u of ctx.units.values()) {
      if (u.kind !== 'champion' || u.dead || ctx.dead.has(u.id)) continue;
      if (u.pos.y === undefined || insideCap(d.now, u.pos as Vec3)) continue;
      const hitAt = u.lastDamagedAt;
      dealDamage(ctx, 0, u, u.maxHp * d.burn * DT, 'true');
      u.lastDamagedAt = hitAt;
      if (ctx.dead.has(u.id)) this.duskHit.add(u.id);
    }
  }

  // A Seedfall's impact, right after the Dusk (after the zones, before the
  // deaths), so a champion it kills dies on the same tick (seedfall.ts).
  stepSeedfallImpact(ctx: CombatCtx, _sim: Sim): void {
    const before = ctx.dead.size;
    seedfallImpact(this, ctx);
    if (ctx.dead.size === before) return;
    // The deaths it added are the set's last.
    let i = 0;
    for (const id of ctx.dead) if (i++ >= before) this.impactHit.add(id);
  }

  // A death's rewards, in the sim's death handling instead of the shared
  // bounties: everything to the last hit. A champion's: experience, the
  // next piece, a share of health, the score, One life's place. A camp
  // body's: experience, and for the spot's last body a piece and health.
  // A big creature's: experience (its favor or Boon is the sim's own).
  onDeath(sim: Sim, victim: Unit, killerId: number, lastOfCamp: boolean): void {
    const killer = sim.units.get(killerId);
    const champ = killer && killer.kind === 'champion' ? killer : null;
    if (victim.kind === 'champion') {
      if (this.duskHit.has(victim.id)) this.tally.duskDeaths++;
      const taker = champ && champ.team !== victim.team ? champ : null;
      noteClamor(this, sim, victim, taker);
      // The Wrath passes to a taker who dealt the fall, not the world.
      const world = this.duskHit.has(victim.id) || this.impactHit.has(victim.id);
      wrathOnDeath(this, sim, victim, world ? null : taker);
      if (taker) {
        this.tally.takedowns++;
        if (this.tally.firstTakedownAt === null) this.tally.firstTakedownAt = sim.time;
        const from = taker.level;
        grantXp(taker, takedownXp(this.variant, victim.level, taker.level));
        // A mark taken down pays more (marks.ts): the Lodestar, an Ablaze.
        const marks = this.state.marks;
        const lodestar = markOf(marks, victim.id, 'lodestar') !== null;
        const run = markOf(marks, victim.id, 'ablaze') !== null ? victim.killStreak : null;
        const pay = markPayout(this.variant, lodestar, run);
        const holder = markOf(marks, victim.id, 'wrath') !== null;
        if (lodestar || run !== null || holder) this.tally.markTakedowns++;
        // A Burr settled counts double and pays a piece more (burr.ts).
        const burr = burrTakedown(this, sim, victim, taker);
        if (burr.pieces > 0) this.tally.burrTakedowns++;
        this.lootPieces(sim, taker, 1 + pay.pieces + burr.pieces, 'takedown');
        const share = streakShare(taker.killStreak);
        healShare(taker, takedownHealOf(taker, TAKEDOWN_HEAL) * share);
        manaShare(taker, TAKEDOWN_MANA * share);
        // Respawn's Last light counts it double (last_light.ts).
        const score = pay.score * burr.factor * lastLightFactor(this.state, sim.time);
        this.state.scores.set(taker.id, (this.state.scores.get(taker.id) ?? 0) + score);
        if (pay.snuffed !== null) {
          this.emit(sim, {
            type: 'royale_snuffed',
            unitId: victim.id,
            killerId: taker.id,
            streak: pay.snuffed,
          });
        }
        // The Grafts: One life's first and third takedowns, then the
        // levels passed.
        const t = tallyOf(this, taker.id);
        t.takedowns++;
        if (t.takedowns === 1) offerOnTrigger(this, sim, taker.id, 'first_takedown', 'takedown');
        if (t.takedowns === 3) offerOnTrigger(this, sim, taker.id, 'third_takedown', 'takedown');
        offerOnLevels(this, sim, taker, from);
        // Respawn's assists, a share each (assists.ts).
        payAssists(this, sim, victim, taker);
      }
      if (this.variant === 'one_life') {
        this.fallen.push({ id: victim.id, hpBefore: this.hpBefore.get(victim.id) ?? 0 });
        this.fallenKiller.set(victim.id, champ && champ.team !== victim.team ? champ.id : 0);
      }
      return;
    }
    if (!champ) return;
    const from = champ.level;
    if (victim.kind === 'camp') {
      grantXp(champ, creatureXp(victim.xpBounty));
      if (lastOfCamp) {
        this.tally.campsTaken++;
        this.lootPieces(sim, champ, 1, 'camp');
        healShare(champ, CAMP_HEAL);
        manaShare(champ, CAMP_MANA);
        const t = tallyOf(this, champ.id);
        t.camps++;
        if (t.camps === 1) offerOnTrigger(this, sim, champ.id, 'first_camp', 'camp');
      }
      offerOnLevels(this, sim, champ, from);
      return;
    }
    if (victim.kind === 'creature' || victim.kind === 'warden') {
      grantXp(champ, creatureXp(victim.xpBounty));
      offerOnLevels(this, sim, champ, from);
    }
    // A big creature's last hit (risings.ts): pieces, all the health and
    // mana, the slayer shown to everyone. The Warden's is the Wrath.
    if (victim.kind === 'creature') {
      this.tally.creaturesTaken++;
      const pay = risingReward(this.offerHeartwood(sim, champ));
      this.lootPieces(sim, champ, pay.pieces, 'camp');
      healShare(champ, pay.heal);
      manaShare(champ, pay.mana);
      markSlayer(this, sim, champ);
    } else if (victim.kind === 'warden') {
      this.tally.wardensTaken++;
    }
  }

  // A camp spot's return in the mode: CAMP_BACK_S whatever its kind.
  campBackAt(time: number): number {
    return time + CAMP_BACK_S;
  }

  // The next pieces of a seat's build, told (also what a Graft offer whose
  // draw came short pays instead, grafts.ts).
  lootPieces(sim: Sim, u: Unit, count: number, source: 'cache' | 'camp' | 'takedown'): void {
    const build = this.builds.get(u.id) ?? seatBuild(u.championId);
    for (const itemId of grantPieces(u, build, count)) {
      this.emit(sim, { type: 'royale_loot', unitId: u.id, itemId, source });
    }
  }

  // The respawn's delay and place (SimOptions.respawnDelay, respawnPoint):
  // RESPAWN_S and the edge of the light in Respawn, never in One life. The
  // place is the seat's own pick when it made one during the wait and a
  // point near it will do (return_pick.ts returnSpot: inside the light, at
  // least RETURN_CLEAR_M from every champion standing), else the candidate
  // on the light's edge farthest from every other champion standing
  // (score.ts edgeOfLight), never the first one drawn; while the Dusk
  // closes, in the light it closes to (returnCap), for every seat. The pick
  // is spent either way: each wait picks afresh.
  respawnDelay(): number {
    return this.variant === 'respawn' ? RESPAWN_S : Number.POSITIVE_INFINITY;
  }

  respawnPoint(u: Unit, sim: Sim): Vec3 | null {
    if (this.variant !== 'respawn' || this.state.stage !== 'play') return null;
    const enemies: Vec3[] = [];
    for (const o of sim.units.values()) {
      if (o.kind !== 'champion' || o.dead || o.id === u.id || o.pos.y === undefined) continue;
      enemies.push(o.pos as Vec3);
    }
    const cap = returnCap(this.state.dusk);
    const pick = this.state.respawnPicks.get(u.id);
    this.state.respawnPicks.delete(u.id);
    const at = pick ? returnSpot(pick, cap, enemies, this.layout, this.ground) : null;
    if (at) {
      this.tally.returnsPicked++;
      return at;
    }
    return edgeOfLight(sim.rng, cap, enemies, this.layout, this.ground);
  }

  // After the deaths: One life's places, the caches, the leader, the end.
  stepAfterDeaths(sim: Sim): void {
    const time = sim.time;
    const s = this.state;
    if (this.variant === 'one_life' && this.fallen.length > 0) {
      for (const { id, place } of placeFallen(this.fallen, this.aliveBefore)) {
        if (place === 1) {
          s.winnerId = id;
          continue;
        }
        s.eliminated.push(id);
        clearOffers(this, id);
        const killerId = this.fallenKiller.get(id) ?? 0;
        this.emit(sim, { type: 'royale_out', unitId: id, killerId, place });
      }
    }
    // Caches.
    const seekers = [];
    for (const u of sim.units.values()) {
      if (u.kind !== 'champion' || u.dead || this.flights.has(u.id)) continue;
      seekers.push({
        id: u.id,
        pos: u.pos,
        still: u.path.length === 0 && !u.activeDash && !u.pendingSpell,
        disturbedAt: Math.max(
          u.lastDamagedAt,
          u.lastDealtDamageAt,
          this.lastActAt.get(u.id) ?? -999,
        ),
      });
    }
    for (const o of stepCaches(s.caches, seekers, time, this.variant)) {
      const u = sim.units.get(o.unitId);
      if (!u) continue;
      this.tally.cachesOpened++;
      this.emit(sim, { type: 'royale_cache', unitId: o.unitId, cacheId: o.cacheId });
      const t = tallyOf(this, u.id);
      t.caches++;
      // A Seedfall cache pays its own (seedfall.ts) with a Heartwood offer.
      const seedfall = o.kind === 'seedfall' ? openedSeedfall(this, sim, o.cacheId) : null;
      if (seedfall) {
        this.lootPieces(sim, u, seedfall.pieces, 'cache');
        healShare(u, seedfall.heal);
        manaShare(u, seedfall.mana);
        if (seedfall.heartwood) offerOnTrigger(this, sim, u.id, 'seedfall');
        if (t.caches === 2) offerOnTrigger(this, sim, u.id, 'second_cache');
        continue;
      }
      // Respawn's golden cache trades its second piece for a Bough offer.
      const goldenBough = o.kind === 'golden' && GRAFT_TRIGGERS[this.variant].golden_cache;
      this.lootPieces(sim, u, o.kind === 'golden' && !goldenBough ? GOLDEN_PIECES : 1, 'cache');
      manaShare(u, CACHE_MANA);
      if (goldenBough) offerOnTrigger(this, sim, u.id, 'golden_cache');
      if (t.caches === 2) offerOnTrigger(this, sim, u.id, 'second_cache');
    }
    // What makes a match a story, each its own module.
    stepSeedfalls(this, sim);
    stepRisings(this, sim);
    stepMarks(this, sim);
    stepBurrs(this, sim);
    stepClamors(this, sim);
    stepGrafts(this, sim);
    stepLastLight(this, sim);
    // The end.
    if (s.stage !== 'play') return;
    if (this.variant === 'one_life') {
      const alive = this.champions(sim).filter((u) => !u.dead);
      if (alive.length === 1) s.winnerId = alive[0]!.id;
      if (alive.length <= 1) this.finish(sim);
    } else if (time + 1e-9 >= s.endsAt) {
      s.winnerId = respawnRanking(this.standings(sim))[0] ?? null;
      this.finish(sim);
    }
  }

  private finish(sim: Sim): void {
    this.state.stage = 'over';
    this.emit(sim, { type: 'royale_end', winnerId: this.state.winnerId });
  }

  standings(sim: Sim): Standing[] {
    return this.champions(sim).map((u) => ({
      id: u.id,
      score: this.state.scores.get(u.id) ?? 0,
      deaths: u.deaths,
    }));
  }

  // The final order, best first: by score in Respawn, by survival in One
  // life (the ones still standing first, by health, when it is cut short).
  ranking(sim: Sim): number[] {
    if (this.variant === 'respawn') return respawnRanking(this.standings(sim));
    const out = oneLifeRanking(this.state.winnerId, this.state.eliminated);
    const listed = new Set(out);
    const standing = this.champions(sim)
      .filter((u) => !listed.has(u.id))
      .sort((a, b) => b.hp - a.hp || a.id - b.id)
      .map((u) => u.id);
    return this.state.winnerId === null
      ? [...standing, ...out]
      : [out[0]!, ...standing, ...out.slice(1)];
  }

  // The champions still in: alive in One life, every seat in Respawn.
  alive(sim: Sim): number {
    const champs = this.champions(sim);
    return this.variant === 'one_life' ? champs.filter((u) => !u.dead).length : champs.length;
  }

  // The mode's block of a seat's observation (policy.ts ObsRoyale): what
  // every player knows, shared by every seat on the tick, and the seat's
  // own share.
  observe(sim: Sim, u: Unit): ObsRoyale {
    const s = this.state;
    if (this.obsTick !== sim.tickCount || !this.obsShared) {
      this.obsTick = sim.tickCount;
      this.obsShared = {
        dusk: s.dusk,
        caches: s.caches
          .filter((c) => c.present)
          .map((c) => ({
            id: c.id,
            x: c.pos.x,
            y: c.pos.y,
            z: c.pos.z,
            golden: c.kind === 'golden',
            kind: c.kind,
          })),
        pads: s.pads,
        alive: this.alive(sim),
      };
    }
    const opening = openingBy(s.caches, u.id);
    const drop = (s.stage === 'drop' ? s.drops.get(u.id) : s.respawnPicks.get(u.id)) ?? null;
    let leader: ObsRoyale['leader'] = null;
    if (s.leaderId !== null) {
      const lu = sim.units.get(s.leaderId);
      const shown = sim.time - s.leaderShownAt <= MARK_SHOWN_S && s.leaderShownAt > s.dropEndsAt;
      leader = {
        id: s.leaderId,
        score: s.scores.get(s.leaderId) ?? 0,
        ...(shown && lu && lu.pos.y !== undefined
          ? { at: { x: lu.pos.x, y: lu.pos.y, z: lu.pos.z } }
          : {}),
      };
    }
    return {
      variant: s.variant,
      stage: s.stage,
      dropEndsAt: s.dropEndsAt,
      endsAt: s.endsAt,
      ...this.obsShared,
      drop: drop ? { ...drop } : null,
      opening: opening ? { cacheId: opening.id, since: opening.openSince } : null,
      flying: this.flights.has(u.id),
      score: s.scores.get(u.id) ?? 0,
      leader,
      ...observeGrafts(this, sim, u),
      ...observeSeedfalls(this, sim, u),
      ...observeRisings(this, sim, u),
      ...observeMarks(this, sim, u),
      ...observeBurr(this, sim, u),
      ...observeClamors(this, sim, u),
      ...observeGrace(this, sim, u),
    };
  }

  // The mode's moving parts as plain data, and back (the sim's world
  // checkpoint carries them; snapshot.ts deep-copies).
  snapshot() {
    return {
      state: this.state,
      flights: this.flights,
      padHold: this.padHold,
      builds: this.builds,
      skills: this.skills,
      lastActAt: this.lastActAt,
      graces: this.graces,
      graftTally: this.graftTally,
      tally: this.tally,
    };
  }

  restore(s: ReturnType<RoyaleMode['snapshot']>): void {
    this.state = s.state;
    this.flights = s.flights;
    this.padHold = s.padHold;
    this.builds = s.builds;
    this.skills = s.skills;
    this.lastActAt = s.lastActAt;
    this.graces = s.graces;
    this.graftTally = s.graftTally;
    this.tally = s.tally;
    this.obsTick = -1;
    this.obsShared = null;
  }
}
