// The battle royale run by the sim (ADR 0031): the mode's state and the
// steps the sim's fixed tick calls, each a thin driver over the pure rules
// beside this file. The sim owns one when it is built with
// SimOptions.royale; the 5v5 never constructs it. In the tick:
//   the drop (only decisions run, then everyone lands) ->
//   [play] before the tick: health noted for One life's ties ->
//   after the walk: the launch pads ->
//   after the zones: the Dusk's burn, then a Seedfall's impact ->
//   in the deaths: takedowns, loot, experience, places ->
//   after the deaths: caches, Seedfalls, Risings, marks, Grafts, the
//   leader, the end.
// Everything here moves with the match and is in the world checkpoint
// (snapshot, restore); the schedule and the layout are fixed at the start.

import { dealDamage } from '../combat/damage';
import { addStatus, cancelRecall } from '../combat/status';
import type { RoyaleSkillId } from '../content/bots/royale_skills';
import { outOfCombat } from '../favors';
import { copy, dist2, type Vec3 } from '../geo';
import type { Ground } from '../ground';
import type { ObsRoyale } from '../policy';
import type { Rng } from '../rng';
import type { Sim } from '../sim';
import type { CombatCtx } from '../sim_context';
import { DT } from '../types';
import type { Unit } from '../unit';
import { drawCaches, openingBy, stepCaches } from './caches';
import { escortLandings, normalizePick, resolveLandings } from './drop';
import { type DuskSchedule, drawDusk, duskAt, insideCap } from './dusk';
import { observeGrafts, pickGraft, stepGrafts } from './grafts';
import type { RoyaleGround, RoyaleLayout } from './layout';
import { creatureXp, grantXp, landingLevels, takedownXp } from './levels';
import { GOLDEN_PIECES, grantPieces, healShare, manaShare, seatBuild, streakShare } from './loot';
import { observeMarks, stepMarks } from './marks';
import { flightOver, flightPos, type PadFlight, padSites, padUnder, startFlight } from './pads';
import { observeRisings, stepRisings } from './risings';
import {
  edgeOfLight,
  type Fallen,
  leaderOf,
  oneLifeRanking,
  placeFallen,
  respawnRanking,
  type Standing,
  takedownScore,
} from './score';
import { observeSeedfalls, stepSeedfalls } from './seedfall';
import {
  CACHE_MANA,
  CAMP_BACK_S,
  CAMP_HEAL,
  CAMP_MANA,
  DROP_S,
  LEADER_SHOW_EVERY_S,
  OUT_OF_COMBAT_HEAL,
  OUT_OF_COMBAT_MANA,
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

// How long the leader stays shown on the globe after each show.
export const LEADER_SHOWN_FOR_S = 4;

// What a match measured of itself: the numbers a test reads to tell a fun
// match from a dull one. Not part of any rule.
export interface RoyaleTally {
  firstTakedownAt: number | null;
  takedowns: number;
  cachesOpened: number;
  duskDeaths: number;
  padsUsed: number;
  campsTaken: number;
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

// The skills a person's company is drawn from, in order.
const ESCORT_ORDER: readonly RoyaleSkillId[] = ['gentle', 'normal', 'strong'];

export class RoyaleMode {
  readonly variant: RoyaleVariant;
  readonly layout: RoyaleLayout;
  readonly ground: RoyaleGround;
  readonly schedule: DuskSchedule;
  state: RoyaleState;
  // Moving parts beside the public state.
  flights = new Map<number, PadFlight>();
  // Landed from a pad and not yet off every pad's reach.
  padHold = new Set<number>();
  // The build each seat walks, fixed at seating.
  builds = new Map<number, string[]>();
  // The skill each seat's bot plays (a stand-in plays the seat's).
  skills = new Map<number, RoyaleSkillId>();
  // When each seat last pressed a cast or a sigil or ordered an attack:
  // what disturbs a cache's opening beside a hit.
  lastActAt = new Map<number, number>();
  tally: RoyaleTally = {
    firstTakedownAt: null,
    takedowns: 0,
    cachesOpened: 0,
    duskDeaths: 0,
    padsUsed: 0,
    campsTaken: 0,
  };
  private hpBefore = new Map<number, number>();
  private aliveBefore = 0;
  private fallen: Fallen[] = [];
  private fallenKiller = new Map<number, number>();
  private duskHit = new Set<number>();
  private obsTick = -1;
  private obsShared: Pick<ObsRoyale, 'caches' | 'pads' | 'dusk' | 'alive'> | null = null;

  constructor(rng: Rng, ground: Ground, options: RoyaleOptions) {
    this.variant = options.variant;
    this.layout = options.layout;
    this.ground = royaleGround(ground);
    const landAt = DROP_S;
    this.schedule = drawDusk(rng, this.layout, this.ground, landAt);
    this.state = {
      variant: this.variant,
      stage: 'drop',
      dropEndsAt: landAt,
      endsAt: landAt + PLAY_S,
      dusk: duskAt(this.schedule, 0),
      caches: drawCaches(this.layout.cacheSpots, rng),
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

  // A champion seated for the mode: no gold, the planet's health, landing
  // at level 3 with Q, W and E, the out of combat speed, its build fixed.
  seat(u: Unit, kitBuild?: readonly string[], skill?: RoyaleSkillId): void {
    u.gold = 0;
    u.outOfCombatBonus = OUT_OF_COMBAT_SPEED;
    u.hpScale = ROYALE_HP_SCALE;
    landingLevels(u);
    this.builds.set(u.id, seatBuild(u.championId, kitBuild));
    if (skill) this.skills.set(u.id, skill);
    this.state.scores.set(u.id, 0);
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

  // A landing pick during the drop; false outside it or for a bad point.
  pickDrop(unitId: number, p: Vec3, time: number): boolean {
    if (this.state.stage !== 'drop' || time >= this.state.dropEndsAt) return false;
    const pick = normalizePick(p, this.layout.radius);
    if (!pick) return false;
    this.state.drops.set(unitId, pick);
    return true;
  }

  // A seat's pick of its open Graft offer (the 'graft' action, Sim.pickGraft):
  // free like the drop's pick, taken while dead, flying or dropping. False
  // when nothing was taken (grafts.ts).
  pickGraft(unitId: number, pick: number, time: number): boolean {
    return pickGraft(this, unitId, pick, time);
  }

  // A Respawn drop-in's Arrival (CONTEXT.md): the seat a person takes from
  // its bot hangs over the globe before it lands where it picks. Nothing
  // happens yet: the seat is handed over in place (ADR 0025).
  beginArrival(_unitId: number, _time: number): void {}

  // Whether the bot driver runs a dead seat's policy this tick (a Graft
  // offer to pick, a Respawn landing to choose). Never yet: a dead seat
  // decides nothing, in the royale as in the 5v5.
  wantsDeadDecision(_unitId: number): boolean {
    return false;
  }

  // The health a champion comes back with (the sim's respawn loop): all of
  // it, until a Reprieve brings one back with less.
  respawnHealth(u: Unit): number {
    return u.maxHp;
  }

  // The Wrath handed to a champion on the planet (an Ascendant's last hit):
  // its team's, as everywhere, until the mode tracks a holder.
  grantWrath(sim: Sim, killer: Unit): void {
    sim.grantWrath(killer.team);
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
  // bots, the gentle first, come down beside each person (a seat no
  // policy plays).
  stepDrop(sim: Sim): void {
    if (sim.time + 1e-9 < this.state.dropEndsAt) return;
    const seats = this.champions(sim).map((u) => u.id);
    const at = resolveLandings(seats, this.state.drops, sim.rng, this.layout, this.ground);
    const people = seats.filter((id) => !sim.policies.has(id));
    const gentleFirst = (id: number): number => ESCORT_ORDER.indexOf(this.skillOf(id));
    const bots = seats
      .filter((id) => sim.policies.has(id))
      .sort((a, b) => gentleFirst(a) - gentleFirst(b) || a - b);
    escortLandings(people, bots, at, sim.rng, this.layout, this.ground);
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
  stepRecovery(ctx: CombatCtx): void {
    for (const u of ctx.units.values()) {
      if (u.kind !== 'champion' || u.dead) continue;
      if (!outOfCombat(u, ctx.time)) continue;
      if (u.maxMana > 0) {
        u.mana = Math.min(u.maxMana, u.mana + u.maxMana * OUT_OF_COMBAT_MANA * DT);
      }
      if (u.pos.y !== undefined && !insideCap(this.state.dusk.now, u.pos as Vec3)) continue;
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * OUT_OF_COMBAT_HEAL * DT);
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
  // Nothing falls yet.
  stepSeedfallImpact(_ctx: CombatCtx, _sim: Sim): void {}

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
      if (champ && champ.team !== victim.team) {
        this.tally.takedowns++;
        if (this.tally.firstTakedownAt === null) this.tally.firstTakedownAt = sim.time;
        grantXp(champ, takedownXp(this.variant, victim.level, champ.level));
        this.loot(sim, champ, 1, 'takedown');
        const share = streakShare(champ.killStreak);
        healShare(champ, TAKEDOWN_HEAL * share);
        manaShare(champ, TAKEDOWN_MANA * share);
        const score = takedownScore(victim.id, this.state.leaderId);
        this.state.scores.set(champ.id, (this.state.scores.get(champ.id) ?? 0) + score);
      }
      if (this.variant === 'one_life') {
        this.fallen.push({ id: victim.id, hpBefore: this.hpBefore.get(victim.id) ?? 0 });
        this.fallenKiller.set(victim.id, champ && champ.team !== victim.team ? champ.id : 0);
      }
      return;
    }
    if (!champ) return;
    if (victim.kind === 'camp') {
      grantXp(champ, creatureXp(victim.xpBounty));
      if (lastOfCamp) {
        this.tally.campsTaken++;
        this.loot(sim, champ, 1, 'camp');
        healShare(champ, CAMP_HEAL);
        manaShare(champ, CAMP_MANA);
      }
      return;
    }
    if (victim.kind === 'creature' || victim.kind === 'warden') {
      grantXp(champ, creatureXp(victim.xpBounty));
    }
  }

  // A camp spot's return in the mode: CAMP_BACK_S whatever its kind.
  campBackAt(time: number): number {
    return time + CAMP_BACK_S;
  }

  private loot(sim: Sim, u: Unit, count: number, source: 'cache' | 'camp' | 'takedown'): void {
    const build = this.builds.get(u.id) ?? seatBuild(u.championId);
    for (const itemId of grantPieces(u, build, count)) {
      this.emit(sim, { type: 'royale_loot', unitId: u.id, itemId, source });
    }
  }

  // The respawn's delay and place (SimOptions.respawnDelay, respawnPoint):
  // RESPAWN_S and the edge of the light in Respawn, never in One life.
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
    return edgeOfLight(sim.rng, this.state.dusk.now, enemies, this.layout, this.ground);
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
      this.loot(sim, u, o.kind === 'golden' ? GOLDEN_PIECES : 1, 'cache');
      manaShare(u, CACHE_MANA);
    }
    // What makes a match a story, each its own module.
    stepSeedfalls(this, sim);
    stepRisings(this, sim);
    stepMarks(this, sim);
    stepGrafts(this, sim);
    // The leader.
    if (this.variant === 'respawn') {
      s.leaderId = leaderOf(this.standings(sim));
      if (s.leaderId !== null && time - s.leaderShownAt >= LEADER_SHOW_EVERY_S - 1e-9) {
        s.leaderShownAt = time;
        this.emit(sim, { type: 'royale_leader', unitId: s.leaderId });
      }
    }
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
          })),
        pads: s.pads,
        alive: this.alive(sim),
      };
    }
    const opening = openingBy(s.caches, u.id);
    const drop = s.drops.get(u.id) ?? null;
    let leader: ObsRoyale['leader'] = null;
    if (s.leaderId !== null) {
      const lu = sim.units.get(s.leaderId);
      const shown =
        sim.time - s.leaderShownAt <= LEADER_SHOWN_FOR_S && s.leaderShownAt > s.dropEndsAt;
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
    this.tally = s.tally;
    this.obsTick = -1;
    this.obsShared = null;
  }
}
