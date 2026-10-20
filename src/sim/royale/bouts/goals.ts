// A bout's goals and its count, driven (ADR 0035, A bout kind is data with
// references): the view a kind's scorer and goals read (BoutView), the
// start at landing (the count's own start, then each goal's on the bout's
// stream), and every tick after the deaths: what the tie-breaks read
// (falls, Seedfall caches opened, a fallen seat's health before its fall),
// each goal stepped, the count fed the tick's events, the tick each count
// was last reached. Every piece of state lives on RoyaleState.bout, plain
// data the checkpoint carries.

import type { BoutView, GoalPrimitive, GoalSlot } from '../../content/bouts/types';
import type { Sim, SimEvent } from '../../sim';
import type { RoyaleMode } from '../mode';
import type { BoutState } from '../types';

// The view of the bout a scorer or a goal reads, over the mode and the sim.
export function boutView(mode: RoyaleMode, sim: Sim): BoutView {
  const b = mode.state.bout!;
  const bySeat = new Map<number, number>();
  b.seats.forEach((id, seat) => {
    bySeat.set(id, seat);
  });
  const thornyard = mode.schedule.caps[0]!;
  const view: BoutView = {
    time: sim.time,
    tick: sim.tickCount,
    landAt: mode.state.dropEndsAt,
    index: b.index,
    thornyard: { center: { ...thornyard.center }, radius: thornyard.radius },
    rng: sim.rng,
    seatCount: b.seats.length,
    counts: b.counts,
    seatOf: (unitId) => bySeat.get(unitId) ?? null,
    seat: (seat) => {
      const id = b.seats[seat];
      const u = id !== undefined ? sim.units.get(id) : undefined;
      if (!u) return null;
      const p = u.pos;
      return {
        seat,
        unitId: u.id,
        pos: p.y !== undefined ? { x: p.x, y: p.y, z: p.z } : null,
        hp: u.hp,
        maxHp: u.maxHp,
        dead: u.dead,
      };
    },
    hpBefore: (seat) => {
      const id = b.seats[seat];
      return id !== undefined ? mode.hpBeforeTick(id) : 0;
    },
    cacheKind: (cacheId) => {
      const caches = mode.state.caches;
      const c =
        caches[cacheId]?.id === cacheId ? caches[cacheId] : caches.find((k) => k.id === cacheId);
      return c ? c.kind : null;
    },
    goal: (id) => slotOf(b, id),
    primitives: () => primitivesOf(b),
  };
  return view;
}

function slotOf(b: BoutState, id: string): GoalSlot {
  let slot = b.goals.find((g) => g.id === id);
  if (!slot) {
    slot = { id, prims: [], nums: [] };
    b.goals.push(slot);
  }
  return slot;
}

function primitivesOf(b: BoutState): GoalPrimitive[] {
  const out: GoalPrimitive[] = [];
  for (const g of b.goals) for (const p of g.prims) out.push(p);
  return out;
}

// Every goal primitive standing in the bout, in the kind's order.
export function boutPrimitives(mode: RoyaleMode): GoalPrimitive[] {
  const b = mode.state.bout;
  return b ? primitivesOf(b) : [];
}

// At landing: the count started, then each goal on the bout's stream; the
// counts reached at the landing's tick.
export function startBout(mode: RoyaleMode, sim: Sim): void {
  const b = mode.state.bout;
  const kind = mode.bout?.kind;
  if (!b || !kind || b.started) return;
  b.started = true;
  const view = boutView(mode, sim);
  kind.count.start?.(view);
  for (const g of kind.goals ?? []) {
    slotOf(b, g.id);
    g.start(view, sim.rng);
  }
  b.reached.fill(sim.tickCount);
}

// One tick after the deaths (see the header).
export function stepBout(mode: RoyaleMode, sim: Sim, events: readonly SimEvent[]): void {
  const b = mode.state.bout;
  const kind = mode.bout?.kind;
  if (!b || !kind || !b.started) return;
  const view = boutView(mode, sim);
  for (const e of events) {
    if (e.type === 'death') {
      const seat = view.seatOf(e.unitId);
      if (seat === null) continue;
      b.falls[seat] = b.falls[seat]! + 1;
      if (mode.variant === 'one_life' && b.fellHp[seat] === null) {
        b.fellHp[seat] = view.hpBefore(seat);
      }
    } else if (e.type === 'royale_cache' && view.cacheKind(e.cacheId) === 'seedfall') {
      const seat = view.seatOf(e.unitId);
      if (seat !== null) b.seedfalls[seat] = b.seedfalls[seat]! + 1;
    }
  }
  for (const g of kind.goals ?? []) g.step(view, events);
  const before = [...b.counts];
  kind.count.onEvents(events, view);
  b.counts.forEach((c, seat) => {
    if (c !== before[seat]) b.reached[seat] = sim.tickCount;
  });
}
