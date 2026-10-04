// The Grafts (CONTEXT.md: Graft; ADR 0032): the offers of three cards a
// seat gets on the drop and on events, queued at most three deep, the head
// open for ten seconds (the drop's until three seconds after the landing)
// before card 0 is taken for it, and the Grafts each seat holds. The mode
// drives it: an offer on its triggers (offerGraft, offerOnTrigger,
// offerOnLevels), the deadlines from stepAfterDeaths (stepGrafts), a
// seat's pick (Sim.pickGraft, the 'graft' action). The cards are data
// (content/grafts.ts).
//
// The draw, at offer time, from the match's stream: three distinct Grafts
// of the grade, each weighing GRAFT_ROLE_WEIGHT when its role tag matches
// the champion's and 1 otherwise, drawn one after another without putting
// back. Never drawn: a Sprout the seat holds (or has queued) at
// SPROUT_STACKS, a Bough or Heartwood it holds or has queued, a card whose
// offer rule says no. With fewer than three of the grade, the rest come
// from the grade below; still short of three, the offer becomes one piece
// of loot instead.
//
// The queue: a fourth offer drops, among the waiting ones and itself (never
// the open head a person is reading), the lowest grade, the newest of
// equals. The next head opens at max(its offer time, the last pick) +
// GRAFT_PICK_S. One life's elimination clears the seat's queue.

import {
  GRADE_ORDER,
  GRAFT_DROP_LAND_S,
  GRAFT_LEVELS,
  GRAFT_LIST,
  GRAFT_PICK_S,
  GRAFT_QUEUE_MAX,
  GRAFT_ROLE_WEIGHT,
  GRAFT_TRIGGERS,
  GRAFTS,
  type GraftDef,
  type GraftOfferCtx,
  type GraftTrigger,
  graftRoleOf,
  SPROUT_STACKS,
} from '../content/grafts';
import type { ObsGraftOffer, ObsRoyale } from '../policy';
import type { Rng } from '../rng';
import type { Sim } from '../sim';
import { recalcChampion } from '../stats';
import type { Unit } from '../unit';
import type { RoyaleMode } from './mode';
import type { GraftGrade, GraftOffer } from './types';

// What a seat has done toward its event offers: caches opened, camps
// taken, takedowns (One life's triggers count them), and whether its
// drop's offer was made.
export interface GraftTally {
  caches: number;
  camps: number;
  takedowns: number;
  drop: boolean;
}

export function tallyOf(mode: RoyaleMode, unitId: number): GraftTally {
  let t = mode.graftTally.get(unitId);
  if (!t) {
    t = { caches: 0, camps: 0, takedowns: 0, drop: false };
    mode.graftTally.set(unitId, t);
  }
  return t;
}

const gradeRank = (g: GraftGrade): number => GRADE_ORDER.indexOf(g);

// The grades a draw walks: its own, then each below it.
function gradesFrom(grade: GraftGrade): GraftGrade[] {
  return GRADE_ORDER.slice(0, gradeRank(grade) + 1).reverse();
}

// How many of each Graft a seat holds or has waiting in its queue.
function claimed(held: readonly string[], queue: readonly GraftOffer[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of held) out.set(id, (out.get(id) ?? 0) + 1);
  for (const o of queue) for (const id of o.cards) out.set(id, (out.get(id) ?? 0) + 1);
  return out;
}

function eligible(def: GraftDef, taken: ReadonlyMap<string, number>, ctx: GraftOfferCtx): boolean {
  const n = taken.get(def.id) ?? 0;
  if (def.grade === 'sprout' ? n >= SPROUT_STACKS : n > 0) return false;
  return def.offerIf ? def.offerIf(ctx) : true;
}

// The draw (pure over the rng): up to three distinct cards for a champion
// of `championId` (its role), the grade's first, filled from below.
export function drawCards(
  rng: Rng,
  championId: string | null,
  grade: GraftGrade,
  held: readonly string[],
  queue: readonly GraftOffer[],
  ctx: GraftOfferCtx,
): string[] {
  const role = graftRoleOf(championId);
  const taken = claimed(held, queue);
  const cards: string[] = [];
  for (const g of gradesFrom(grade)) {
    const pool = GRAFT_LIST.filter((d) => d.grade === g && eligible(d, taken, ctx));
    while (cards.length < 3 && pool.length > 0) {
      const weights = pool.map((d) => (d.roles.includes(role) ? GRAFT_ROLE_WEIGHT : 1));
      let total = 0;
      for (const w of weights) total += w;
      let r = rng.next() * total;
      let i = 0;
      while (i < pool.length - 1 && r >= weights[i]!) {
        r -= weights[i]!;
        i++;
      }
      cards.push(pool[i]!.id);
      pool.splice(i, 1);
    }
    if (cards.length >= 3) break;
  }
  return cards;
}

function offerCtx(mode: RoyaleMode, sim: Sim): GraftOfferCtx {
  return { variant: mode.variant, phase: mode.state.dusk.phase, alive: mode.alive(sim) };
}

// The queue made room in: a fourth offer drops, among the waiting offers
// and the new one (never the open head), the lowest grade, the newest of
// equals. Pure over the list.
export function trimQueue(queue: GraftOffer[]): void {
  while (queue.length > GRAFT_QUEUE_MAX) {
    let drop = -1;
    for (let i = 1; i < queue.length; i++) {
      if (drop < 0) {
        drop = i;
        continue;
      }
      const a = gradeRank(queue[i]!.grade);
      const b = gradeRank(queue[drop]!.grade);
      if (a < b || (a === b && queue[i]!.offeredAt >= queue[drop]!.offeredAt)) drop = i;
    }
    queue.splice(drop, 1);
  }
}

// An offer of `grade` to a seat, drawn now. False when no offer was made:
// the match is over, the seat is out of One life, or the draw came short
// (then one piece of loot is paid instead, `source` naming it).
export function offerGraft(
  mode: RoyaleMode,
  sim: Sim,
  unitId: number,
  grade: GraftGrade,
  source: 'cache' | 'camp' | 'takedown' = 'cache',
  dropOffer = false,
): boolean {
  const s = mode.state;
  if (s.stage === 'over') return false;
  const u = sim.units.get(unitId);
  if (u?.kind !== 'champion') return false;
  if (mode.variant === 'one_life' && (u.dead || s.eliminated.includes(unitId))) return false;
  const queue = s.offers.get(unitId) ?? [];
  const held = s.grafts.get(unitId) ?? [];
  const cards = drawCards(sim.rng, u.championId, grade, held, queue, offerCtx(mode, sim));
  if (cards.length < 3) {
    mode.lootPieces(sim, u, 1, source);
    return false;
  }
  const time = sim.time;
  const offer: GraftOffer = { grade, cards, offeredAt: time, until: null };
  if (queue.length === 0) {
    offer.until = dropOffer ? s.dropEndsAt + GRAFT_DROP_LAND_S : time + GRAFT_PICK_S;
  }
  queue.push(offer);
  trimQueue(queue);
  s.offers.set(unitId, queue);
  return true;
}

// The offer an event makes in this variant, if any.
export function offerOnTrigger(
  mode: RoyaleMode,
  sim: Sim,
  unitId: number,
  trigger: GraftTrigger,
  source: 'cache' | 'camp' | 'takedown' = 'cache',
): boolean {
  const grade = GRAFT_TRIGGERS[mode.variant][trigger];
  if (!grade) return false;
  return offerGraft(mode, sim, unitId, grade, source, trigger === 'drop');
}

// The drop's offer, once per seat: on its landing pick, or at the drop's
// end for a seat that made none.
export function offerDrop(mode: RoyaleMode, sim: Sim, unitId: number): void {
  const t = tallyOf(mode, unitId);
  if (t.drop) return;
  t.drop = true;
  offerOnTrigger(mode, sim, unitId, 'drop');
}

// The offers of the levels a champion just rose through (levels.ts
// grantXp's `from` to its level now).
export function offerOnLevels(mode: RoyaleMode, sim: Sim, u: Unit, from: number): void {
  const table = GRAFT_LEVELS[mode.variant];
  for (let level = from + 1; level <= u.level; level++) {
    const grade = table[level];
    if (grade) offerGraft(mode, sim, u.id, grade, 'takedown');
  }
}

// A big creature's last hit: its Heartwood offer. Left for the Risings
// (T2-A, CONTEXT.md: Rising) to call from the mode's creature branch.
export function offerCreatureHeartwood(mode: RoyaleMode, sim: Sim, unitId: number): boolean {
  return offerOnTrigger(mode, sim, unitId, 'creature', 'camp');
}

// A champion takes a Graft: held by the seat and on the champion, its stats
// recomputed (a dead champion stays at no health).
export function holdGraft(mode: RoyaleMode, u: Unit, id: string): void {
  const held = mode.state.grafts.get(u.id) ?? [];
  held.push(id);
  mode.state.grafts.set(u.id, held);
  u.grafts.push(id);
  if (GRAFTS[id]?.stat) {
    const dead = u.dead;
    recalcChampion(u);
    if (dead) u.hp = 0;
  }
}

// The head offer answered by `card`: taken, and the next one opened.
function take(mode: RoyaleMode, sim: Sim, unitId: number, card: number): void {
  const queue = mode.state.offers.get(unitId);
  const head = queue?.[0];
  const u = sim.units.get(unitId);
  if (!queue || !head || !u) return;
  queue.shift();
  holdGraft(mode, u, head.cards[card]!);
  const next = queue[0];
  if (next) next.until = Math.max(next.offeredAt, sim.time) + GRAFT_PICK_S;
  else mode.state.offers.delete(unitId);
}

// One tick of the offers: every open offer whose time ran out takes its
// card 0.
export function stepGrafts(mode: RoyaleMode, sim: Sim): void {
  for (const [id, queue] of [...mode.state.offers]) {
    const head = queue[0];
    if (!head) {
      mode.state.offers.delete(id);
      continue;
    }
    if (head.until !== null && sim.time + 1e-9 >= head.until) take(mode, sim, id, 0);
  }
}

// A seat's pick of its open offer's card; false when nothing was taken (no
// open offer, a card out of range, the match over).
export function pickGraft(mode: RoyaleMode, sim: Sim, unitId: number, pick: number): boolean {
  if (mode.state.stage === 'over') return false;
  const head = mode.state.offers.get(unitId)?.[0];
  if (!head || head.until === null) return false;
  if (!Number.isInteger(pick) || pick < 0 || pick >= head.cards.length) return false;
  take(mode, sim, unitId, pick);
  return true;
}

// One life's elimination: the seat's queue goes.
export function clearOffers(mode: RoyaleMode, unitId: number): void {
  mode.state.offers.delete(unitId);
}

// Whether a seat has an offer open (the bot driver asks a dead seat).
export function hasOpenOffer(mode: RoyaleMode, unitId: number): boolean {
  const head = mode.state.offers.get(unitId)?.[0];
  return head !== undefined && head.until !== null;
}

// The seat's own open offer and its Grafts (ObsRoyale.offer, grafts).
export function observeGrafts(
  mode: RoyaleMode,
  _sim: Sim,
  u: Unit,
): Pick<ObsRoyale, 'offer' | 'grafts'> {
  const head = mode.state.offers.get(u.id)?.[0];
  const offer: ObsGraftOffer | null =
    head && head.until !== null
      ? {
          grade: head.grade,
          cards: [head.cards[0]!, head.cards[1]!, head.cards[2]!],
          until: head.until,
        }
      : null;
  return { offer, grafts: [...(mode.state.grafts.get(u.id) ?? [])] };
}
