// Where a replay stands and how it gets anywhere else (playtest round 3):
// the seeking behind the bar, over the world checkpoints the worker ships
// (src/game/replay_worker.ts) and the sim's own snapshot door. Forward a
// short way is stepping; anything else restores the nearest checkpoint at
// or below the target and steps the remainder, at most one checkpoint's
// worth of ticks. Reverse playback restores a denser ring built on demand
// around the current window, then steps at most a few ticks per frame.
// DOM-free: the viewer owns the frames, this owns the arithmetic.

import type { Sim } from '../sim/sim';
import type { SimSnapshot } from '../sim/snapshot';

// A checkpoint every ten seconds of match: a seek steps at most two
// hundred ticks, about a tenth of a second of work.
export const CHECKPOINT_TICKS = 200;
// The ring behind reverse playback: a snapshot every half second, so a
// frame going backward restores one and steps at most nine ticks.
export const RING_TICKS = 10;

export interface CursorHost {
  sim: Sim;
  // One silent tick: the replay's own commands applied, then the sim.
  step(): void;
  // After a restore: the replay's command cursor back to the tick.
  restored(tick: number): void;
}

export class ReplayCursor {
  private readonly checkpoints = new Map<number, SimSnapshot>();
  // The ring: one window of dense snapshots, keyed by tick.
  private ring = new Map<number, SimSnapshot>();
  private ringWindow = -1;

  constructor(private readonly host: CursorHost) {}

  addCheckpoint(snap: SimSnapshot): void {
    this.checkpoints.set(snap.tick, snap);
  }

  // The last tick a checkpoint covers, for the bar's coverage strip.
  get covered(): number {
    let best = 0;
    for (const t of this.checkpoints.keys()) if (t > best) best = t;
    return best;
  }

  get checkpointCount(): number {
    return this.checkpoints.size;
  }

  // The nearest checkpoint at or below `tick`, or null.
  private nearest(tick: number): SimSnapshot | null {
    let best: SimSnapshot | null = null;
    for (const [t, s] of this.checkpoints) {
      if (t <= tick && (best === null || t > best.tick)) best = s;
    }
    return best;
  }

  private restore(snap: SimSnapshot): void {
    this.host.sim.restore(snap);
    this.host.restored(snap.tick);
  }

  // Positions the sim so that stepping reaches `tick` soonest: restores
  // the nearest checkpoint when that beats stepping from where the sim
  // stands. Returns false when the target is behind and no checkpoint
  // covers it (the caller then rebuilds from the start).
  prepare(tick: number): boolean {
    const sim = this.host.sim;
    const best = this.nearest(tick);
    if (tick >= sim.tickCount) {
      // Ahead: restore only if a checkpoint is nearer than the sim is.
      if (best !== null && best.tick > sim.tickCount) this.restore(best);
      return true;
    }
    if (best === null) return false;
    this.restore(best);
    return true;
  }

  // Steps toward `tick`, at most `budget` ticks; true once there.
  advance(tick: number, budget: number): boolean {
    const sim = this.host.sim;
    for (let i = 0; i < budget && sim.tickCount < tick; i++) this.host.step();
    return sim.tickCount >= tick;
  }

  // The world at `tick` exactly, for reverse playback: from the ring of
  // the window holding it, built on demand from the checkpoint below.
  // Returns false when no checkpoint covers the tick yet.
  backTo(tick: number): boolean {
    const t = Math.max(0, Math.floor(tick));
    const window = Math.floor(t / CHECKPOINT_TICKS) * CHECKPOINT_TICKS;
    if (this.ringWindow !== window) {
      const base = this.nearest(t);
      if (base === null || base.tick !== window) return false;
      this.buildRing(base);
    }
    const entryTick = Math.floor(t / RING_TICKS) * RING_TICKS;
    const entry = this.ring.get(entryTick) ?? this.ring.get(window);
    if (!entry) return false;
    this.restore(entry);
    while (this.host.sim.tickCount < t) this.host.step();
    return true;
  }

  // The ring for one window: the checkpoint, then a snapshot every
  // RING_TICKS up to the window's end (or the record's end).
  private buildRing(base: SimSnapshot): void {
    this.ring = new Map();
    this.ringWindow = base.tick;
    this.restore(base);
    this.ring.set(base.tick, base);
    const end = base.tick + CHECKPOINT_TICKS;
    const sim = this.host.sim;
    while (sim.tickCount < end) {
      this.host.step();
      if (sim.tickCount % RING_TICKS === 0) this.ring.set(sim.tickCount, sim.snapshot());
    }
  }

  // Drop the ring (leaving reverse playback), keeping the checkpoints.
  dropRing(): void {
    this.ring = new Map();
    this.ringWindow = -1;
  }
}
