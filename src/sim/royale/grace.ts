// The Grace and the Arrival (CONTEXT.md: Arrival): a fresh champion on the
// planet cannot be damaged or targeted for ARRIVAL_GRACE_S, so a seat that
// comes back (a Respawn return) or is taken by a person (a drop-in's
// Arrival) is never slain before it has seen where it stands. Its own first
// attack or cast ends it: a cast, a sigil or an attack order pressed
// (RoyaleMode.lastActAt), or a strike starting to wind up, read at the
// start of the next tick, before anyone else acts in it. The champion holds
// its fire meanwhile, whatever it was last ordered: the Stop order's hold is
// put on (let go when the Grace ends, unless the seat pressed Stop of its
// own in the meantime), and the idle defense passes a graced champion by
// (idle_defense.ts), so an enemy walking into its reach after a step never
// draws an idle swing that would end the Grace unasked.
// The Grace is the sim's own untargetable status, so every rule that
// spares an untargetable body (damage, a cast's targets, a bolt, an
// attack) spares a graced one; the mode keeps when each began and ends
// (in its checkpoint) and lists the graced seats in RoyaleState.arriving,
// which the snapshot and the observation read. An Arrival also makes the
// champion fresh where it is set down: full health and mana, every cooldown
// ready, items kept, its level kept unless Respawn lifts it to the field's,
// and the seat's tally (score, kills, deaths, assists, streak) started from
// zero for the person taking it.

import { cancelRecall } from '../combat/status';
import { ROYALE_SKILL_RANK, sharpenedSkill } from '../content/bots/royale_skills';
import { outOfCombat } from '../favors';
import type { Vec3 } from '../geo';
import type { ObsRoyale } from '../policy';
import type { Sim } from '../sim';
import { levelTo } from '../stats';
import type { Unit } from '../unit';
import { inMutualSight } from '../vision';
import { arrivalSpot, deepInLight, type FoeCandidate, fairFoeSpot } from './drop';
import { arrivalLevel, spendSkillPoints } from './levels';
import type { RoyaleMode } from './mode';
import { leaderOf, returnCap } from './score';
import type { DuskCap } from './types';

// Seconds a fresh champion cannot be damaged or targeted.
export const ARRIVAL_GRACE_S = 3;

// One Grace: when it began (an act at or after it ends it), when it runs
// out, and whether the hold is its own to let go at its end (it put the
// hold on, and the seat has not pressed Stop since).
export interface Grace {
  since: number;
  until: number;
  held: boolean;
}

// The Grace begins (an Arrival, a Respawn return): a previous one ends.
export function beginGrace(mode: RoyaleMode, u: Unit, time: number): void {
  endGrace(mode, u);
  const until = time + ARRIVAL_GRACE_S;
  const held = !u.holding;
  u.holding = true;
  mode.graces.set(u.id, { since: time, until, held });
  mode.state.arriving.add(u.id);
  u.statuses.push({ kind: 'untargetable', until });
}

// The Grace ends: its status goes, any other untargetable status (a kit's
// own) stays, and the hold it put on is let go.
export function endGrace(mode: RoyaleMode, u: Unit): void {
  const g = mode.graces.get(u.id);
  if (!g) return;
  mode.graces.delete(u.id);
  mode.state.arriving.delete(u.id);
  if (g.held) u.holding = false;
  u.statuses = u.statuses.filter((s) => !(s.kind === 'untargetable' && s.until === g.until));
}

// A Stop the seat pressed (Sim.orderStop): the hold is its own now, kept
// when the Grace ends.
export function keepHold(mode: RoyaleMode, unitId: number): void {
  const g = mode.graces.get(unitId);
  if (g) g.held = false;
}

// Whether a champion is in its Grace at `time`.
export function inGrace(mode: RoyaleMode, unitId: number, time: number): boolean {
  const g = mode.graces.get(unitId);
  return g !== undefined && time < g.until;
}

// At the start of a tick: a Grace run out, or ended by its champion's own
// first attack or cast, ends (in the order they began).
export function stepGraces(mode: RoyaleMode, sim: Sim): void {
  if (mode.graces.size === 0) return;
  for (const [id, g] of [...mode.graces]) {
    const u = sim.units.get(id);
    if (!u) {
      mode.graces.delete(id);
      mode.state.arriving.delete(id);
      continue;
    }
    const acted = (mode.lastActAt.get(id) ?? Number.NEGATIVE_INFINITY) >= g.since;
    if (u.dead || sim.time + 1e-9 >= g.until || acted || u.pendingAttack !== null) {
      endGrace(mode, u);
    }
  }
}

// The Grace as a seat reads it (ObsRoyale): its own (arriving), and the
// champions its sight shows in theirs, with when it runs out, so a bot
// does not spend its attacks on a body nothing touches. A person reads the
// same off the screen (the shimmer, render/planet_grace.ts).
export function observeGrace(
  mode: RoyaleMode,
  sim: Sim,
  u: Unit,
): Pick<ObsRoyale, 'arriving' | 'graced'> {
  if (mode.graces.size === 0) return {};
  const out: Pick<ObsRoyale, 'arriving' | 'graced'> = {};
  const graced: { id: number; until: number }[] = [];
  for (const [id, g] of mode.graces) {
    if (sim.time >= g.until) continue;
    if (id === u.id) {
      out.arriving = true;
      continue;
    }
    if (!sim.isVisible(u.team, id)) continue;
    graced.push({ id, until: g.until });
  }
  if (graced.length > 0) out.graced = graced;
  return out;
}

// A drop-in's Arrival (Sim.beginArrival, the replay's 'arrive' event): the
// seat a person takes from its bot comes down fresh, in its Grace, its
// tally started from zero. Only in play; never a seat out for good. False
// when nothing happened. In Respawn it first rises to ARRIVAL_LEVEL_BEHIND
// under the field's middle (levels.ts arrivalLevel; no Graft offer for the
// levels lifted, the Arrival's own Bough stays the one), then comes down a
// few steps from a fair first fight (drop.ts fairFoeSpot): a bot's seat,
// standing, out of its Grace and off any pad, out of combat, no higher in
// level, deep enough inside the light, and the spot in its sight both ways
// (vision.ts inMutualSight). The foe holds its fire only while
// the Grace lasts (bot/fight.ts isGraced), so the person strikes first and
// the bot fights on sight after that. With no such bot, and always in One
// life, a quiet spot (drop.ts arrivalSpot). Either is in the light that
// holds until the phase ends (score.ts returnCap); every draw from the
// match's stream.
export function arrive(mode: RoyaleMode, sim: Sim, u: Unit): boolean {
  const s = mode.state;
  if (s.stage !== 'play' || u.kind !== 'champion') return false;
  if (s.eliminated.includes(u.id)) return false;
  if (mode.variant === 'one_life' && u.dead) return false;
  const time = sim.time;
  const respawn = mode.variant === 'respawn';
  if (respawn) liftToField(sim, u);
  const cap = returnCap(s.dusk);
  const others: { id: number; pos: Vec3 }[] = [];
  for (const o of sim.units.values()) {
    if (o.kind !== 'champion' || o.dead || o.id === u.id || o.pos.y === undefined) continue;
    others.push({ id: o.id, pos: o.pos as Vec3 });
  }
  const sees = (a: Vec3, b: Vec3): boolean => inMutualSight(sim.map, a, b);
  const fair = respawn
    ? fairFoeSpot(sim.rng, cap, fairFoes(mode, sim, u, cap), others, mode.layout, mode.ground, sees)
    : null;
  if (fair) mode.tally.fairArrivals++;
  const at =
    fair?.at ??
    arrivalSpot(
      sim.rng,
      cap,
      others.map((o) => o.pos),
      mode.layout,
      mode.ground,
    );
  mode.flights.delete(u.id);
  mode.padHold.delete(u.id);
  freshen(u, time);
  u.pos = { x: at.x, y: at.y, z: at.z };
  clearTally(mode, sim, u);
  beginGrace(mode, u, time);
  sim.pushEvent({ type: 'royale_land', unitId: u.id });
  return true;
}

// A Respawn drop-in's level: at least ARRIVAL_LEVEL_BEHIND under the
// lower median of every other seat's level, the fallen too, its points
// spent (the ultimate from level 6, levels.ts).
function liftToField(sim: Sim, u: Unit): void {
  const field: number[] = [];
  for (const o of sim.units.values()) {
    if (o.kind === 'champion' && o.id !== u.id) field.push(o.level);
  }
  levelTo(u, arrivalLevel(u.level, field));
  spendSkillPoints(u);
}

// The bots an Arrival may come down beside, as fairFoeSpot weighs them.
function fairFoes(mode: RoyaleMode, sim: Sim, u: Unit, cap: DuskCap): FoeCandidate[] {
  const s = mode.state;
  const R = mode.layout.radius;
  const out: FoeCandidate[] = [];
  for (const o of sim.units.values()) {
    if (o.kind !== 'champion' || o.dead || o.id === u.id || o.pos.y === undefined) continue;
    if (!sim.policies.has(o.id)) continue;
    if (inGrace(mode, o.id, sim.time) || mode.isFlying(o.id)) continue;
    if (!outOfCombat(o, sim.time) || o.level > u.level) continue;
    const pos = o.pos as Vec3;
    if (!deepInLight(cap, pos, R)) continue;
    const skill = sharpenedSkill(mode.skillOf(o.id), s.scores.get(o.id) ?? 0, s.dusk.phase);
    out.push({
      id: o.id,
      pos,
      soft: ROYALE_SKILL_RANK[skill],
      hpShare: o.maxHp > 0 ? o.hp / o.maxHp : 0,
      level: o.level,
    });
  }
  return out;
}

// A fresh champion: up if it was down, full health and mana, every
// cooldown ready, nothing pending, no status, out of combat. Level, items,
// ranks and the build stay.
function freshen(u: Unit, time: number): void {
  cancelRecall(u);
  u.dead = false;
  u.respawnAt = time;
  u.hp = u.maxHp;
  u.mana = u.maxMana;
  u.cooldowns = {};
  u.sigilCooldowns = u.sigilCooldowns.map(() => 0);
  u.recastArmed = null;
  u.statuses = [];
  u.path = [];
  u.attackTargetId = null;
  u.attackMoveTarget = null;
  u.attackReadyAt = time;
  u.holding = false;
  u.pendingSpell = null;
  u.pendingAttack = null;
  u.activeDash = null;
  u.lastDamagedAt = -999;
  u.lastDealtDamageAt = -999;
}

// The seat's tally from zero for the person taking it: score, kills,
// deaths, assists and streak, the bot's hits on others forgotten (no
// assist or late takedown credit inherited, combat/damage.ts), and its own
// last attacker too, and the leader read again at once
// when it was this seat. The match's own count (RoyaleTally) keeps what
// happened.
function clearTally(mode: RoyaleMode, sim: Sim, u: Unit): void {
  const s = mode.state;
  u.kills = 0;
  u.deaths = 0;
  u.assists = 0;
  u.killStreak = 0;
  u.recentDamagers = [];
  u.lastHitByChampion = 0;
  u.lastHitAt = -999;
  s.scores.set(u.id, 0);
  for (const o of sim.units.values()) {
    if (o.kind !== 'champion' || o.id === u.id) continue;
    if (o.recentDamagers.length > 0) {
      o.recentDamagers = o.recentDamagers.filter((r) => r.id !== u.id);
    }
    if (o.lastHitByChampion === u.id) {
      o.lastHitByChampion = 0;
      o.lastHitAt = -999;
    }
  }
  if (s.leaderId === u.id) s.leaderId = leaderOf(mode.standings(sim));
}
