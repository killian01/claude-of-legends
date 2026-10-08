// The battle royale snapshot's optional blocks (src/net/royale_wire.ts
// SnapRoyale), one builder each, beside royale_snapshot.ts which calls them
// all through addRoyaleBlocks: the recipient's Graft offer and Grafts, the
// Seedfalls, the Risings, the marks, the recipient's Burr, the Clamors, the
// Respawn rank and gap
// (a drop-in's since they landed, with rs), the Reprieve, the Graces (an Arrival, a return) and the Respawn wait's
// killer; and a cache's kind and its opening time. A builder answers
// undefined to leave its block off the wire, which every one does until its
// rules ship. A block sent on change (sf, cl) asks sentOnChange below, the
// one memory of what each viewer was last sent, never a tracker of its own
// and never the shared snapshot code.

import type {
  SnapBurr,
  SnapCache,
  SnapClamor,
  SnapGrace,
  SnapGraftOffer,
  SnapMark,
  SnapRising,
  SnapRoyale,
  SnapSeedfall,
  SnapWatch,
} from '../src/net/royale_wire';
import { RING_RISE_AT_S, RISING_WARN_S } from '../src/sim/content/royale_events';
import { BURR_S, liveBurr } from '../src/sim/royale/burr';
import { cacheOpenS } from '../src/sim/royale/caches';
import { firstSeedfallCallAt } from '../src/sim/royale/seedfall';
import {
  CACHE_OPEN_S,
  type CacheState,
  RESPAWN_S,
  type RoyaleState,
} from '../src/sim/royale/types';
import type { Unit } from '../src/sim/unit';
import { type RankedSeat, rankAndGapIn, royaleRanking, windowStanding } from './royale_ranking';
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
// the three cards and when it was offered; every snapshot while open, so
// its absence says none is. Nothing once the match is over: no pick is
// taken then.
export const offerBlock: Builder<SnapGraftOffer> = (sim, viewer) => {
  if (sim.royale.stage === 'over') return undefined;
  const head = sim.royale.offers.get(viewer.unitId)?.[0];
  if (!head || head.cards.length < 3) return undefined;
  return {
    g: head.grade,
    c: [head.cards[0]!, head.cards[1]!, head.cards[2]!],
    u: round2(head.offeredAt),
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
// A standing body's health share on the wire, in steps of this: the bar
// moves visibly, and the block is not resent for every point of damage.
export const RISING_HP_STEP = 0.02;

// The Risings called and standing, everyone's (src/sim/royale/risings.ts):
// on the tick the list changes, from the first call on (an empty list
// once none stands, so the mirror lets go of it).
export const risingsBlock: Builder<SnapRising[]> = (sim, viewer) => {
  const r = sim.royale;
  if (r.stage !== 'play') return undefined;
  if (r.risings.length === 0 && sim.time + 1e-9 < r.dropEndsAt + RING_RISE_AT_S - RISING_WARN_S) {
    return undefined;
  }
  const value = r.risings.map((x): SnapRising => {
    const body = x.unitId !== null ? sim.units.get(x.unitId) : undefined;
    const frac = body && body.maxHp > 0 ? body.hp / body.maxHp : 1;
    return [
      x.kind,
      round2(x.pos.x),
      round2(x.pos.y),
      round2(x.pos.z),
      round2(x.risesAt),
      x.up ? 1 : 0,
      round2(Math.ceil(frac / RISING_HP_STEP) * RISING_HP_STEP),
    ];
  });
  return sentOnChange(viewer, 'ri', value, sim.time);
};

// The marks, everyone's (src/sim/royale/marks.ts): who, why, the last point
// shown and when, on the tick the list changes (a shown mark's point
// follows its champion while the show lasts; hidden, it holds still).
export const marksBlock: Builder<SnapMark[]> = (sim, viewer) => {
  const r = sim.royale;
  if (r.stage !== 'play') return undefined;
  const value = r.marks.map(
    (m): SnapMark => [
      m.unitId,
      m.kind,
      round2(m.at.x),
      round2(m.at.y),
      round2(m.at.z),
      round2(m.shownAt),
    ],
  );
  return sentOnChange(viewer, 'mk', value, sim.time);
};
// The recipient's own Burr (src/sim/royale/burr.ts), every snapshot of the
// play while it lasts: the carrier, when it runs out, and where the carrier
// stands while it stands, the one point the sim shows the owner alone (its
// observation's burr reads the same). Nobody else is ever sent it.
export const burrBlock: Builder<SnapBurr> = (sim, viewer) => {
  const r = sim.royale;
  if (r.stage !== 'play') return undefined;
  const b = liveBurr(r.burrs, viewer.unitId, sim.time);
  if (!b) return undefined;
  const out: SnapBurr = { i: b.carrierId, u: round2(b.until) };
  const c = sim.units.get(b.carrierId);
  if (c && !c.dead && c.pos.y !== undefined) {
    out.at = [round2(c.pos.x), round2(c.pos.y), round2(c.pos.z)];
  }
  return out;
};
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
// Respawn's ranking, made once a tick for every viewer of the match.
const rankings = new WeakMap<RoyaleSim, { tick: number; ranking: number[] }>();

function respawnRankingOf(sim: RoyaleSim): number[] {
  const kept = rankings.get(sim);
  if (kept && kept.tick === sim.tickCount) return kept.ranking;
  const seats: RankedSeat[] = [];
  for (const u of sim.units.values()) {
    if (u.kind !== 'champion') continue;
    seats.push({ unitId: u.id, name: '', championId: '', bot: false, deaths: u.deaths });
  }
  const ranking = royaleRanking(sim.royale, seats);
  rankings.set(sim, { tick: sim.tickCount, ranking });
  return ranking;
}

// The standing the top line tells: in the whole match, or for a drop-in
// (ctx.windowBase) since they landed, from their first takedown since
// then (before it, a rank among the seats that scored reads as a verdict
// on seconds of play).
function standing(
  sim: RoyaleSim,
  viewer: RoyaleViewer,
  ctx: RoyaleSnapContext,
): { rank: number; gap: number; since?: 1 } | null {
  const r = sim.royale;
  if (r.variant !== 'respawn' || r.stage !== 'play') return null;
  const ranking = respawnRankingOf(sim);
  if (ctx.windowBase) {
    const w = windowStanding(r.scores, ctx.windowBase, ranking, viewer.unitId);
    return w.score > 0 ? { rank: w.rank, gap: w.gap, since: 1 } : null;
  }
  return rankAndGapIn(ranking, r, viewer.unitId);
}

// Respawn: the recipient's rank and its gap (server/royale_ranking.ts
// rankAndGap, or windowStanding for a drop-in, then with rs), every
// snapshot of the play: the HUD's top line.
export const rankBlock: Builder<number> = (sim, viewer, ctx) => standing(sim, viewer, ctx)?.rank;
export const gapBlock: Builder<number> = (sim, viewer, ctx) => standing(sim, viewer, ctx)?.gap;
export const sinceBlock: Builder<1> = (sim, viewer, ctx) => standing(sim, viewer, ctx)?.since;
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
    const g: SnapGrace = [id, round2(until), round2(u.pos.x), round2(u.pos.y), round2(u.pos.z)];
    // A Grace that waits on the seat's order: from when one ends it.
    const floor = sim.graceFloor?.(id) ?? null;
    if (floor !== null) g.push(round2(floor));
    out.push(g);
  }
  return out.length > 0 ? out : undefined;
};
// Who took a waiting Respawn champion down: the carrier of its Burr when
// that Burr was hung by this very fall (burr.ts hangs one on every
// takedown, at the fall's time); null for a fall nobody landed (the Dusk,
// a creature), whose Burr, if any, is an older one.
export function waitKiller(r: Pick<RoyaleState, 'burrs'>, u: Unit): number | null {
  if (!u.dead || !Number.isFinite(u.respawnAt)) return null;
  const b = r.burrs.get(u.id);
  if (!b) return null;
  const hungAt = b.until - BURR_S;
  const fellAt = u.respawnAt - RESPAWN_S;
  return Math.abs(hungAt - fellAt) < 1e-6 ? b.carrierId : null;
}

// Respawn: the killer the fallen recipient watches through its wait (the
// Death beat): its champion and where it stands, every snapshot of the
// wait while it stands, so the mirror can draw it (a dead champion sees
// nothing). Only the fallen seat is sent it, and nothing of it reaches any
// observation: the bots see nothing new.
export const watchBlock: Builder<SnapWatch> = (sim, viewer) => {
  const r = sim.royale;
  if (r.variant !== 'respawn' || r.stage !== 'play') return undefined;
  const me = sim.units.get(viewer.unitId);
  if (!me) return undefined;
  const id = waitKiller(r, me);
  const k = id !== null ? sim.units.get(id) : undefined;
  if (!k || k.dead || k.kind !== 'champion' || !k.championId || k.pos.y === undefined) {
    return undefined;
  }
  return {
    i: k.id,
    c: k.championId,
    sk: k.skin,
    t: k.team,
    at: [round2(k.pos.x), round2(k.pos.y), round2(k.pos.z)],
    h: Math.round(k.hp),
    m: Math.round(k.maxHp),
  };
};

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
  const bu = burrBlock(sim, viewer, ctx);
  if (bu !== undefined) block.bu = bu;
  const cl = clamorsBlock(sim, viewer, ctx);
  if (cl !== undefined) block.cl = cl;
  const rk = rankBlock(sim, viewer, ctx);
  if (rk !== undefined) block.rk = rk;
  const gap = gapBlock(sim, viewer, ctx);
  if (gap !== undefined) block.gap = gap;
  const rs = sinceBlock(sim, viewer, ctx);
  if (rs !== undefined) block.rs = rs;
  const rp = reprieveBlock(sim, viewer, ctx);
  if (rp !== undefined) block.rp = rp;
  const ar = arrivalBlock(sim, viewer, ctx);
  if (ar !== undefined) block.ar = ar;
  const wa = watchBlock(sim, viewer, ctx);
  if (wa !== undefined) block.wa = wa;
}
