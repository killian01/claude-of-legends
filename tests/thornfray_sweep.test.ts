// Where each seat of a bout has looked (src/sim/royale/bouts/sweep.ts;
// docs/design/thornfray.md, How a bot plays a bout), on the real Wanderseed
// through buildBoutSim: the Thornyard's lookouts stand inside it on
// walkable ground, half a step apart, every bush in it among them; a seat
// remembers a lookout when its own sight takes it in as it would a
// champion standing there (a bush looked into only from inside it or a
// step away), never another seat's sight; its observation shows its own
// memory and nobody else's; a battle royale has none; a checkpoint carries
// it, and a Lastwick restored midway plays on alike.

import { describe, expect, it } from 'vitest';
import { buildRoyaleSim } from '../src/net/replay';
import { LASTWICK } from '../src/sim/content/bouts/lastwick';
import { STARGLEAN } from '../src/sim/content/bouts/starglean';
import { dist, heading, type Vec3 } from '../src/sim/geo';
import { buildObservation } from '../src/sim/observe';
import { boutResult } from '../src/sim/royale/bouts/end';
import { NEVER_SEEN, SWEEP_EVERY_TICKS, SWEEP_STEP_M } from '../src/sim/royale/bouts/sweep';
import { insideCap } from '../src/sim/royale/dusk';
import { along, REGION_IDS } from '../src/sim/royale/layout';
import { royaleGround } from '../src/sim/royale/mode';
import { royaleLayoutOf } from '../src/sim/royale/planet_map';
import type { Sim } from '../src/sim/sim';
import { brushIndexAt, seesSpot, sightBlocked } from '../src/sim/vision';
import { picks } from './royale_contract_fixture';
import { loadPlanet } from './royale_planet';
import { buildBout, land, playOut } from './thornfray_fixture';

const planet = loadPlanet();
const layout = royaleLayoutOf(planet.layout);
const ground = royaleGround(planet.ground());

// Every seat left where it landed: no bot decides.
function idle(sim: Sim, unitIds: readonly number[]): void {
  for (const id of unitIds) sim.policies.delete(id);
}

// Ticks on through the next tick the memory is written (its step runs
// before the tick's clock moves on); the sim time it wrote.
function toSweepTick(sim: Sim): number {
  let at = sim.time;
  do {
    at = sim.time;
    sim.tick();
  } while ((sim.tickCount - 1) % SWEEP_EVERY_TICKS !== 0);
  return at;
}

describe("a bout's lookouts", () => {
  it('stand inside the Thornyard on walkable ground, half a step apart, its bushes among them', () => {
    for (const region of REGION_IDS) {
      const { sim } = buildBout({ kind: LASTWICK, region });
      const mode = sim.royaleMode!;
      const yard = mode.schedule.caps[0]!;
      const at = mode.lookouts;
      // About one for every 64 square meters of a 40 m Thornyard.
      expect(at.length).toBeGreaterThan(60);
      expect(at.length).toBeLessThan(140);
      for (const p of at) {
        expect(insideCap(yard, p)).toBe(true);
        expect(ground.walkable(p)).toBe(true);
      }
      for (let i = 0; i < at.length; i++) {
        for (let j = i + 1; j < at.length; j++) {
          expect(dist(at[i]!, at[j]!)).toBeGreaterThanOrEqual(SWEEP_STEP_M / 2);
        }
      }
      // Every bush standing in it on walkable ground has one at its heart
      // or within half a step.
      for (const b of layout.bushes ?? []) {
        if (!insideCap(yard, b.at) || !ground.walkable(b.at)) continue;
        expect(Math.min(...at.map((p) => dist(p, b.at)))).toBeLessThan(SWEEP_STEP_M / 2);
      }
      // Every seat starts having seen none of them.
      expect(sim.royale!.bout!.swept.every((s) => s.length === at.length)).toBe(true);
      expect(sim.royale!.bout!.swept.flat().every((t) => t === NEVER_SEEN)).toBe(true);
    }
  });

  it('are none in a battle royale, and nothing of them is observed there', () => {
    const { sim, unitIds } = buildRoyaleSim(planet, 4, picks(4), 'one_life');
    expect(sim.royaleMode!.lookouts).toEqual([]);
    while (sim.royale!.stage === 'drop') sim.tick();
    sim.tick();
    expect(buildObservation(sim, unitIds[0]!)!.royale?.bout).toBeUndefined();
  });
});

describe("a seat's memory of where it looked", () => {
  it('holds what its own sight took in, as it would a champion standing there', () => {
    const { sim, unitIds } = buildBout({ kind: LASTWICK, region: 'groves', seed: 3 });
    idle(sim, unitIds);
    land(sim);
    const at = toSweepTick(sim);
    const mode = sim.royaleMode!;
    const swept = sim.royale!.bout!.swept;
    unitIds.forEach((id, seat) => {
      const u = sim.units.get(id)!;
      const mine = brushIndexAt(sim.map, u.pos);
      mode.lookouts.forEach((p, i) => {
        const sees = seesSpot(sim.map, u, mine, p, brushIndexAt(sim.map, p), at);
        expect(swept[seat]![i] === at).toBe(sees);
        // Past its sight, never.
        if (dist(u.pos, p) > u.sightRange) expect(swept[seat]![i]).toBe(NEVER_SEEN);
      });
      // Its own ground, within the close sight, it has seen.
      expect(mode.lookouts.some((p, i) => dist(u.pos, p) <= 4 && swept[seat]![i] !== at)).toBe(
        false,
      );
    });
  });

  it('looks into a bush only from inside it or a step away', () => {
    const { sim, unitIds } = buildBout({ kind: LASTWICK, region: 'groves', seed: 3 });
    idle(sim, unitIds);
    land(sim);
    const mode = sim.royaleMode!;
    const u = sim.units.get(unitIds[0]!)!;
    // A lookout in a bush, and a spot 6 m off it out of every bush with a
    // clear line to it.
    let found: { i: number; spot: Vec3 } | null = null;
    for (let i = 0; i < mode.lookouts.length && !found; i++) {
      const p = mode.lookouts[i]!;
      if (brushIndexAt(sim.map, p) === -1) continue;
      for (let k = 0; k < 16 && !found; k++) {
        const spot = along(p, heading(p, (k * Math.PI) / 8) as Vec3, 6, layout.radius);
        const q = ground.nearestWalkable(spot);
        if (!q || dist(q, p) < 5 || dist(q, p) > 8) continue;
        if (brushIndexAt(sim.map, q) !== -1 || sightBlocked(sim.map, q, p)) continue;
        found = { i, spot: q };
      }
    }
    if (!found) throw new Error('no bush lookout with a clear spot beside it');
    const seen = () => sim.royale!.bout!.swept[0]![found!.i]!;
    const stand = (p: Vec3): number => {
      u.pos = { ...p };
      u.path = [];
      for (const s of sim.royale!.bout!.swept) s.fill(NEVER_SEEN);
      return toSweepTick(sim);
    };
    // Six meters off, in plain sight of it: the bush hides what stands in it.
    stand(found.spot);
    expect(seen()).toBe(NEVER_SEEN);
    // Inside the bush: seen.
    const at = stand(mode.lookouts[found.i]!);
    expect(seen()).toBe(at);
  });

  it("is the seat's own: its observation shows its memory and nobody else's", () => {
    const { sim, unitIds } = buildBout({ kind: STARGLEAN, region: 'ruins', seed: 5 });
    idle(sim, unitIds);
    land(sim);
    for (let i = 0; i < 40; i++) sim.tick();
    const mode = sim.royaleMode!;
    const b = sim.royale!.bout!;
    const shown = unitIds.map((id) => buildObservation(sim, id)!.royale!.bout!.sweep!);
    unitIds.forEach((_, seat) => {
      expect(shown[seat]).toHaveLength(mode.lookouts.length);
      shown[seat]!.forEach((p, i) => {
        expect({ x: p.x, y: p.y, z: p.z }).toEqual(mode.lookouts[i]);
        expect(p.seen).toBe(b.swept[seat]![i] === NEVER_SEEN ? null : b.swept[seat]![i]);
      });
    });
    // Seats landed apart remember apart.
    expect(shown[0]).not.toEqual(shown[1]);
  });

  it('is carried by a checkpoint, and a Lastwick restored midway plays on alike', () => {
    const { sim } = buildBout({ kind: LASTWICK, region: 'cliffs', matchSeed: 2, seed: 9 });
    land(sim);
    while (sim.time < 40) sim.tick();
    const snap = sim.snapshot();
    const swept = structuredClone(sim.royale!.bout!.swept);
    expect(swept.flat().some((t) => t !== NEVER_SEEN)).toBe(true);
    const a = playOut(sim);
    const end = { checksum: sim.checksum(), ranking: boutResult(sim.royaleMode!, sim).ranking };
    sim.restore(snap);
    expect(sim.royale!.bout!.swept).toEqual(swept);
    const b = playOut(sim);
    expect(b.checks).toEqual(a.checks);
    expect({ checksum: sim.checksum(), ranking: boutResult(sim.royaleMode!, sim).ranking }).toEqual(
      end,
    );
  });
});
