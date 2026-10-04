// The battle royale snapshot's optional blocks (src/net/royale_wire.ts
// SnapRoyale), one builder each, beside royale_snapshot.ts which calls them
// all through addRoyaleBlocks: the recipient's Graft offer and Grafts, the
// Seedfalls, the Risings, the marks, the Clamors, the Respawn rank and gap,
// the Reprieve, the Graces (an Arrival, a return), the Last light's final seconds and the watched
// champion; and a cache's kind and its opening time. A builder answers
// undefined to leave its block off the wire, which every one does until its
// rules ship. A block sent on change (sf, cl) asks sentOnChange below, the
// one memory of what each viewer was last sent, never a tracker of its own
// and never the shared snapshot code.

import type {
  SnapCache,
  SnapClamor,
  SnapGrace,
  SnapGraftOffer,
  SnapMark,
  SnapRising,
  SnapRoyale,
  SnapSeedfall,
} from '../src/net/royale_wire';
import { cacheOpenS } from '../src/sim/royale/caches';
import { firstSeedfallCallAt } from '../src/sim/royale/seedfall';
import { CACHE_OPEN_S, type CacheState } from '../src/sim/royale/types';
import type { RoyaleSim } from './royale_sim';
import type { RoyaleSnapContext, RoyaleViewer } from './royale_snapshot';
import { round2 } from './snapshot';

// A cache's kind on the wire: 0 plain, 1 golden, 2 a Seedfall's.
export function cacheKindOf(c: CacheState): SnapCache[4] {
  return c.kind === 'golden' ? 1 : c.kind === 'seedfall' ? 2 : 0;
}

// How long the recipient's opening takes, when it is not CACHE_OPEN_S (a
// Seedfall cache's): the sim's own rule (caches.ts cacheOpenS).
export function openingDuration(sim: RoyaleSim, c: CacheState): number | undefined {
  const opener = c.opener !== null ? sim.units.get(c.opener) : undefined;
  const d = cacheOpenS(c, opener);
  return Math.abs(d - CACHE_OPEN_S) < 1e-9 ? undefined : round2(d);
}

// What a viewer was last sent of one block: its value as JSON, and when.
interface Sent {
  json: string;
  at: number;
}

// Keyed on viewer.seat, the person's own seat record (server/royale_match.ts
// RoyalePlayer), which lives as long as their seat: the viewer itself is a
// fresh literal every snapshot, so a key on it would never be found again.
const lastSent = new WeakMap<object, Map<string, Sent>>();

// A block sent on change: the value on the tick it differs from what this
// viewer was last sent under that key (or was never sent), and with everyS
// again once that long has passed since the last send; undefined otherwise,
// which leaves the block off the wire (the client keeps the last one).
export function sentOnChange<T>(
  viewer: RoyaleViewer,
  key: string,
  value: T,
  time: number,
  everyS?: number,
): T | undefined {
  let memory = lastSent.get(viewer.seat);
  if (!memory) {
    memory = new Map();
    lastSent.set(viewer.seat, memory);
  }
  const json = JSON.stringify(value);
  const last = memory.get(key);
  const due = everyS !== undefined && last !== undefined && time - last.at >= everyS - 1e-9;
  if (last && last.json === json && !due) return undefined;
  memory.set(key, { json, at: time });
  return value;
}

type Builder<T> = (sim: RoyaleSim, viewer: RoyaleViewer, ctx: RoyaleSnapContext) => T | undefined;

// The recipient's open Graft offer (src/sim/royale/grafts.ts): its grade,
// the three cards and when card 0 is taken; every snapshot while open, so
// its absence says none is.
export const offerBlock: Builder<SnapGraftOffer> = (sim, viewer) => {
  const head = sim.royale.offers.get(viewer.unitId)?.[0];
  if (!head || head.until === null || head.cards.length < 3) return undefined;
  return {
    g: head.grade,
    c: [head.cards[0]!, head.cards[1]!, head.cards[2]!],
    u: round2(head.until),
  };
};
// The Grafts the recipient holds, in the order taken: sent the tick they
// change (the mirror keeps the last list), from the first one on, and
// every GRAFTS_RESEND_S again for a mirror that started over (a rejoin).
export const GRAFTS_RESEND_S = 5;
export const graftsBlock: Builder<string[]> = (sim, viewer) => {
  const held = sim.royale.grafts.get(viewer.unitId);
  if (!held || held.length === 0) return undefined;
  return sentOnChange(viewer, 'gr', [...held], sim.time, GRAFTS_RESEND_S);
};
// The Seedfalls called and not yet opened, everyone's: on the tick the list
// changes and once a second otherwise, from the first call on (an empty
// list once the last is opened, so the mirror lets go of it).
export const seedfallsBlock: Builder<SnapSeedfall[]> = (sim, viewer) => {
  const r = sim.royale;
  if (r.seedfalls.length === 0 && sim.time + 1e-9 < firstSeedfallCallAt(r.dropEndsAt)) {
    return undefined;
  }
  const value = r.seedfalls.map(
    (f): SnapSeedfall => [
      f.id,
      round2(f.pos.x),
      round2(f.pos.y),
      round2(f.pos.z),
      round2(f.landsAt),
      f.landed ? 1 : 0,
    ],
  );
  return sentOnChange(viewer, 'sf', value, sim.time, 1);
};
export const risingsBlock: Builder<SnapRising[]> = () => undefined;
export const marksBlock: Builder<SnapMark[]> = () => undefined;
// How far from the viewer a Clamor is sent: past the client's hearing
// (60 m, ui/royale_moments.ts CLAMOR_HEAR_M) and the minimap's corners
// (planet_minimap.ts, a 110 m square), nobody on that screen can use it.
// A bandwidth bound, not a fog: every seat's observation keeps them all.
export const CLAMOR_SEND_M = 80;

// The Clamors ringing within CLAMOR_SEND_M of the viewer, sent the tick
// that list changes. The client hears each once and lets it fall silent
// CLAMOR_S after it rang.
export const clamorsBlock: Builder<SnapClamor[]> = (sim, viewer) => {
  if (sim.royale.stage !== 'play') return undefined;
  const at = sim.units.get(viewer.unitId)?.pos;
  const reach2 = CLAMOR_SEND_M * CLAMOR_SEND_M;
  const list: SnapClamor[] = [];
  for (const c of sim.royale.clamors) {
    if (at && at.y !== undefined) {
      const dx = c.pos.x - at.x;
      const dy = c.pos.y - at.y;
      const dz = c.pos.z - at.z;
      if (dx * dx + dy * dy + dz * dz > reach2) continue;
    }
    list.push([round2(c.pos.x), round2(c.pos.y), round2(c.pos.z), round2(c.at)]);
  }
  return sentOnChange(viewer, 'cl', list, sim.time);
};
export const rankBlock: Builder<number> = () => undefined;
export const gapBlock: Builder<number> = () => undefined;
export const reprieveBlock: Builder<number> = () => undefined;
// The champions in their Grace the viewer sees, itself included
// (src/sim/royale/grace.ts; RoyaleState.arriving), each with when it runs
// out (its untargetable status) and where it stands: what the shimmer
// draws (render/planet_grace.ts). Every snapshot while any is graced, so
// the mirror keeps nothing between sends.
export const arrivalBlock: Builder<SnapGrace[]> = (sim, viewer) => {
  const r = sim.royale;
  if (r.arriving.size === 0) return undefined;
  const out: SnapGrace[] = [];
  for (const id of r.arriving) {
    if (id !== viewer.unitId && !sim.isVisible(viewer.team, id)) continue;
    const u = sim.units.get(id);
    if (!u || u.dead || u.pos.y === undefined) continue;
    let until = Number.NEGATIVE_INFINITY;
    for (const s of u.statuses) {
      if (s.kind === 'untargetable' && s.until > until) until = s.until;
    }
    if (until <= sim.time) continue;
    out.push([id, round2(until), round2(u.pos.x), round2(u.pos.y), round2(u.pos.z)]);
  }
  return out.length > 0 ? out : undefined;
};
export const finalBlock: Builder<1> = () => undefined;
export const watchBlock: Builder<number> = () => undefined;

// Every optional block onto the snapshot's mode block, each only when its
// builder answers.
export function addRoyaleBlocks(
  block: SnapRoyale,
  sim: RoyaleSim,
  viewer: RoyaleViewer,
  ctx: RoyaleSnapContext,
): void {
  const offer = offerBlock(sim, viewer, ctx);
  if (offer !== undefined) block.offer = offer;
  const gr = graftsBlock(sim, viewer, ctx);
  if (gr !== undefined) block.gr = gr;
  const sf = seedfallsBlock(sim, viewer, ctx);
  if (sf !== undefined) block.sf = sf;
  const ri = risingsBlock(sim, viewer, ctx);
  if (ri !== undefined) block.ri = ri;
  const mk = marksBlock(sim, viewer, ctx);
  if (mk !== undefined) block.mk = mk;
  const cl = clamorsBlock(sim, viewer, ctx);
  if (cl !== undefined) block.cl = cl;
  const rk = rankBlock(sim, viewer, ctx);
  if (rk !== undefined) block.rk = rk;
  const gap = gapBlock(sim, viewer, ctx);
  if (gap !== undefined) block.gap = gap;
  const rp = reprieveBlock(sim, viewer, ctx);
  if (rp !== undefined) block.rp = rp;
  const ar = arrivalBlock(sim, viewer, ctx);
  if (ar !== undefined) block.ar = ar;
  const fi = finalBlock(sim, viewer, ctx);
  if (fi !== undefined) block.fi = fi;
  const wa = watchBlock(sim, viewer, ctx);
  if (wa !== undefined) block.wa = wa;
}
