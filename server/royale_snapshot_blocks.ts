// The battle royale snapshot's optional blocks (src/net/royale_wire.ts
// SnapRoyale), one builder each, beside royale_snapshot.ts which calls them
// all through addRoyaleBlocks: the recipient's Graft offer and Grafts, the
// Seedfalls, the Risings, the marks, the Clamors, the Respawn rank and gap,
// the Reprieve, the Arrival, the Last light's final seconds and the watched
// champion; and a cache's kind and its opening time. A builder answers
// undefined to leave its block off the wire, which every one does until its
// rules ship. A block sent on change keeps what it last sent per viewer in
// its own memory here (a WeakMap keyed by the viewer), never in the shared
// snapshot code.

import type {
  SnapCache,
  SnapClamor,
  SnapGraftOffer,
  SnapMark,
  SnapRising,
  SnapRoyale,
  SnapSeedfall,
} from '../src/net/royale_wire';
import type { CacheState } from '../src/sim/royale/types';
import type { RoyaleSim } from './royale_sim';
import type { RoyaleSnapContext, RoyaleViewer } from './royale_snapshot';

// A cache's kind on the wire: 0 plain, 1 golden, 2 a Seedfall's.
export function cacheKindOf(c: CacheState): SnapCache[4] {
  return c.kind === 'golden' ? 1 : c.kind === 'seedfall' ? 2 : 0;
}

// How long the recipient's opening takes, when it is not CACHE_OPEN_S.
export function openingDuration(_sim: RoyaleSim, _c: CacheState): number | undefined {
  return undefined;
}

type Builder<T> = (sim: RoyaleSim, viewer: RoyaleViewer, ctx: RoyaleSnapContext) => T | undefined;

export const offerBlock: Builder<SnapGraftOffer> = () => undefined;
export const graftsBlock: Builder<string[]> = () => undefined;
export const seedfallsBlock: Builder<SnapSeedfall[]> = () => undefined;
export const risingsBlock: Builder<SnapRising[]> = () => undefined;
export const marksBlock: Builder<SnapMark[]> = () => undefined;
export const clamorsBlock: Builder<SnapClamor[]> = () => undefined;
export const rankBlock: Builder<number> = () => undefined;
export const gapBlock: Builder<number> = () => undefined;
export const reprieveBlock: Builder<number> = () => undefined;
export const arrivalBlock: Builder<number> = () => undefined;
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
