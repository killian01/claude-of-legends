// The Burr on the wire and on the screen (server/royale_snapshot_blocks.ts
// burrBlock, src/net/client_world.ts, src/ui/royale_burr.ts): the bu block
// goes to its owner alone, every snapshot of the play while it lasts, with
// the carrier's point while the carrier stands; the mirror keeps nothing
// between sends; the edge arrow points at the carrier with the seconds
// left; the wash names who carries it.

import { describe, expect, it } from 'vitest';
import { starOrchard } from '../server/star_orchard';
import { ClientWorld } from '../src/net/client_world';
import type { ServerMsg } from '../src/net/protocol';
import type { SnapRoyale } from '../src/net/royale_wire';
import { BURR_S } from '../src/sim/royale/burr';
import { TerrainNavGrid } from '../src/sim/terrain_nav';
import { burrTarget, burrWashLine } from '../src/ui/royale_burr';
import { fakeSnap } from './royale_contract_fixture';

function playing() {
  const f = fakeSnap();
  f.sim.royale.stage = 'play';
  f.sim.time = 300;
  return f;
}

describe('the bu block', () => {
  it('goes to its owner every snapshot while the Burr lasts, the carrier point included', () => {
    const { sim, self, snap } = playing();
    const carrier = sim.units.get(self.id + 1)!;
    carrier.pos = { x: 1.234, y: 79.5, z: 2.345 };
    sim.royale.burrs.set(self.id, { carrierId: carrier.id, until: 330.004 });
    expect(snap().royale?.bu).toEqual({ i: carrier.id, u: 330, at: [1.23, 79.5, 2.35] });
    // Every snapshot, not on change.
    expect(snap().royale?.bu).toEqual({ i: carrier.id, u: 330, at: [1.23, 79.5, 2.35] });
    carrier.dead = true;
    expect(snap().royale?.bu).toEqual({ i: carrier.id, u: 330 });
    sim.time = 330.1;
    expect(snap().royale).not.toHaveProperty('bu');
  });

  it("never carries someone else's Burr, nor any outside the play", () => {
    const { sim, self, snap } = playing();
    sim.royale.burrs.set(self.id + 2, { carrierId: self.id + 1, until: 330 });
    expect(snap().royale).not.toHaveProperty('bu');
    sim.royale.burrs.set(self.id, { carrierId: self.id + 1, until: 330 });
    sim.royale.stage = 'over';
    expect(snap().royale).not.toHaveProperty('bu');
  });
});

const dusk = {
  p: 0,
  c: [0, 80, 0] as [number, number, number],
  r: 160,
  pe: 100,
  sh: 0 as const,
  b: 0.01,
};

function block(over: Partial<SnapRoyale> = {}): SnapRoyale {
  return { v: 'respawn', st: 'play', de: 10, end: 610, dusk, alive: 50, people: 1, ...over };
}

describe('the mirror', () => {
  it('keeps no Burr past the snapshot that stops sending it', () => {
    const orchard = starOrchard();
    const world = new ClientWorld(
      () => {},
      orchard.map,
      new TerrainNavGrid(orchard.navigation),
      () => 0,
    );
    world.applyServer({
      t: 'match_start',
      selfUnitId: 1,
      team: 0,
      royale: { v: 'respawn', seats: 50 },
    });
    const snap = (royale: SnapRoyale): ServerMsg => ({
      t: 'snap',
      time: 100,
      units: [],
      gone: [],
      projectiles: [],
      zones: [],
      walls: [],
      self: null,
      events: [],
      winner: null,
      royale,
    });
    world.applyServer(snap(block({ bu: { i: 4, u: 150, at: [1, 79, 2] } })));
    expect(world.royaleView()?.bu).toEqual({ i: 4, u: 150, at: [1, 79, 2] });
    world.applyServer(snap(block()));
    expect(world.royaleView()?.bu).toBeUndefined();
  });
});

describe('the Burr on the screen', () => {
  it("points the edge arrow at the carrier, with the Burr's seconds left", () => {
    const r = block({ bu: { i: 4, u: 150, at: [1, 79, 2] } });
    expect(burrTarget(r, 120)).toEqual({
      key: 'burr',
      kind: 'burr',
      carrierId: 4,
      at: { x: 1, y: 79, z: 2 },
      secondsLeft: 30,
    });
    // The carrier down, the Burr run out, no Burr, the play over: nothing.
    expect(burrTarget(block({ bu: { i: 4, u: 150 } }), 120)).toBeNull();
    expect(burrTarget(r, 150.1)).toBeNull();
    expect(burrTarget(block(), 120)).toBeNull();
    expect(burrTarget({ ...r, st: 'over' }, 120)).toBeNull();
    expect(BURR_S).toBe(60);
  });

  it('names who carries it on the wash, the carrier down or standing', () => {
    const names = (id: number) => (id === 4 ? 'Pinetinder' : null);
    expect(burrWashLine(block({ bu: { i: 4, u: 150 } }), 120, names)).toBe(
      'Pinetinder carries your Burr: take them down for double',
    );
    expect(burrWashLine(block({ bu: { i: 5, u: 150, at: [1, 79, 2] } }), 120, names)).toBe(
      'Your killer carries your Burr: take them down for double',
    );
    expect(burrWashLine(block(), 120, names)).toBeNull();
    expect(burrWashLine(block({ bu: { i: 4, u: 150 } }), 151, names)).toBeNull();
  });
});
