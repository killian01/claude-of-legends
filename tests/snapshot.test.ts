// The world checkpoint (src/sim/snapshot.ts, playtest round 3): restore at
// k then step to n is the same world as stepping straight to n, bots
// deciding and all; a checkpoint survives being restored twice; and it
// crosses a structured clone whole, which is how a worker ships it.

import { describe, expect, it } from 'vitest';
import { fillWithBots } from '../server/bot_fill';
import { buildMatchSim } from '../src/net/replay';
import type { Sim } from '../src/sim/sim';

function fingerprint(sim: Sim): string {
  return JSON.stringify({
    time: sim.time.toFixed(4),
    tick: sim.tickCount,
    winner: sim.winner,
    rng: sim.rng.state,
    units: [...sim.units.values()].map((u) => ({
      id: u.id,
      x: u.pos.x.toFixed(4),
      z: u.pos.z.toFixed(4),
      hp: u.hp.toFixed(4),
      level: u.level,
      gold: Math.round(u.gold),
      dead: u.dead,
      play: u.play,
      items: u.items,
    })),
    projectiles: sim.projectiles.size,
    zones: sim.zones.size,
    score: sim.scoreboard(),
  });
}

function stepTo(sim: Sim, tick: number): void {
  while (sim.tickCount < tick) sim.tick();
}

describe('the world checkpoint', () => {
  it('restores at k and reaches the same world at n as a straight run', () => {
    const seed = 21;
    const { sim } = buildMatchSim(seed, fillWithBots([], seed));
    stepTo(sim, 600);
    const atSix = sim.snapshot();
    expect(atSix.tick).toBe(600);
    stepTo(sim, 1400);
    const atFourteen = sim.snapshot();
    stepTo(sim, 2400);
    const straight = fingerprint(sim);

    // Back to six hundred, forward again: identical.
    sim.restore(atSix);
    expect(sim.tickCount).toBe(600);
    stepTo(sim, 2400);
    expect(fingerprint(sim)).toBe(straight);

    // The nearer checkpoint, and a second restore of the same snapshot.
    sim.restore(atFourteen);
    stepTo(sim, 2400);
    expect(fingerprint(sim)).toBe(straight);
    sim.restore(atSix);
    stepTo(sim, 2400);
    expect(fingerprint(sim)).toBe(straight);
  });

  it('keeps the attached policies driving after a restore', () => {
    const seed = 8;
    const { sim } = buildMatchSim(seed, fillWithBots([], seed));
    stepTo(sim, 400);
    const snap = sim.snapshot();
    stepTo(sim, 900);
    const plays = [...sim.units.values()].filter((u) => u.kind === 'champion').map((u) => u.play);
    sim.restore(snap);
    stepTo(sim, 900);
    const again = [...sim.units.values()].filter((u) => u.kind === 'champion').map((u) => u.play);
    expect(again).toEqual(plays);
    expect(sim.policies.size).toBe(10);
    // Definitions re-linked: every champion reads its own def again.
    for (const u of sim.units.values()) {
      if (u.kind === 'champion') expect(u.champion?.id).toBe(u.championId);
    }
  });

  it('crosses a structured clone, as a worker ships it', () => {
    const seed = 5;
    const { sim } = buildMatchSim(seed, fillWithBots([], seed));
    stepTo(sim, 300);
    const snap = structuredClone(sim.snapshot());
    stepTo(sim, 700);
    const straight = fingerprint(sim);
    sim.restore(snap);
    stepTo(sim, 700);
    expect(fingerprint(sim)).toBe(straight);
  });
});
