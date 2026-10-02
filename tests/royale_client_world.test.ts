// The online mirror in a battle royale (src/net/client_world.ts, ADR 0031):
// positions with y, the mode's block and the last caches list, the drop
// pick and the orders carrying y up the wire, who holds each seat, a new
// match starting the mirror over, and the prediction off on the planet.
// End to end on the fake sim too: the service's snapshots read back whole.

import { describe, expect, it } from 'vitest';
import { RoyaleMatch } from '../server/royale_match';
import { starOrchard } from '../server/star_orchard';
import { ClientWorld } from '../src/net/client_world';
import type { ClientMsg, ServerMsg } from '../src/net/protocol';
import { TerrainNavGrid } from '../src/sim/terrain_nav';
import { fakeFactory, near } from './royale_fake';

type Snap = Extract<ServerMsg, { t: 'snap' }>;

const dusk = {
  p: 0,
  c: [0, 80, 0] as [number, number, number],
  r: 160,
  pe: 100,
  sh: 0 as const,
  b: 0.01,
};

function snap(over: Partial<Snap> = {}): Snap {
  return {
    t: 'snap',
    time: 1,
    units: [],
    gone: [],
    projectiles: [],
    zones: [],
    walls: [],
    self: null,
    events: [],
    winner: null,
    ...over,
  };
}

function mirror() {
  const sent: ClientMsg[] = [];
  const orchard = starOrchard();
  const world = new ClientWorld(
    (m) => sent.push(m),
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
  return { world, sent };
}

describe('the mirror on the planet', () => {
  it('reads y on units, bolts, zones and walls', () => {
    const { world } = mirror();
    world.applyServer(
      snap({
        units: [
          { i: 1, x: 1, y: 79, z: 2, h: 500, m: 500, k: 'champion', t: 0, c: 'fenn', n: 'alice' },
        ],
        projectiles: [{ i: 5, x: 3, y: 78, z: 4, r: 0.3, t: 0 }],
        zones: [{ i: 6, x: 5, y: 77, z: 6, r: 2, t: 0 }],
        walls: [{ i: 7, x1: 0, y1: 80, z1: 0, x2: 1, y2: 79.9, z2: 1, t: 0, u: 9 }],
      }),
    );
    expect(world.units.get(1)?.pos).toEqual({ x: 1, y: 79, z: 2 });
    expect(world.projectiles.get(5)?.pos).toEqual({ x: 3, y: 78, z: 4 });
    expect(world.zones.get(6)?.pos).toEqual({ x: 5, y: 77, z: 6 });
    expect(world.walls.get(7)?.a).toEqual({ x: 0, y: 80, z: 0 });
    world.applyServer(snap({ units: [{ i: 1, x: 2, y: 78.5, z: 3, h: 400, m: 500 }] }));
    expect(world.units.get(1)?.pos).toEqual({ x: 2, y: 78.5, z: 3 });
  });

  it('keeps the mode block, the last caches list and the drop picks', () => {
    const { world } = mirror();
    expect(world.royale()).toBeNull();
    world.applyServer(
      snap({
        royale: {
          v: 'respawn',
          st: 'drop',
          de: 10,
          end: 610,
          dusk,
          alive: 50,
          people: 2,
          caches: [[1, 0, -80, 0, 1]],
          picks: [[80, 0, 0]],
          drop: [0, 80, 0],
        },
      }),
    );
    world.applyServer(
      snap({ royale: { v: 'respawn', st: 'drop', de: 10, end: 610, dusk, alive: 50, people: 2 } }),
    );
    const r = world.royale()!;
    expect(r.caches).toEqual([[1, 0, -80, 0, 1]]);
    expect(r.picks).toEqual([[80, 0, 0]]);
    expect(r.people).toBe(2);
    expect(r.drop).toBeUndefined();
    world.applyServer(
      snap({ royale: { v: 'respawn', st: 'play', de: 10, end: 610, dusk, alive: 50, people: 2 } }),
    );
    expect(world.royale()?.picks).toEqual([]);
    expect(world.royale()?.caches).toHaveLength(1);
  });

  it('sends the drop pick and the orders with y, and no prediction numbers', () => {
    const { world, sent } = mirror();
    world.pickDrop({ x: 0, y: 80, z: 0 });
    world.orderMove(1, 1, 2, 79);
    world.orderAttackMove(1, 1, 2, 79);
    world.castAbility(1, 'Q', { x: 1, y: 79, z: 2 });
    world.castSigil(1, 0, { x: 1, y: 79, z: 2 });
    world.orderStop(1);
    expect(sent).toEqual<ClientMsg[]>([
      { t: 'drop', x: 0, y: 80, z: 0 },
      { t: 'move', x: 1, y: 79, z: 2 },
      { t: 'attack_move', x: 1, y: 79, z: 2 },
      { t: 'cast', key: 'Q', x: 1, y: 79, z: 2 },
      { t: 'sigil', slot: 0, x: 1, y: 79, z: 2 },
      { t: 'stop' },
    ]);
    expect(world.predictedPos(1, 0)).toBeNull();
  });

  it('knows who holds each seat, from identities, the kill feed and the scoreboard', () => {
    const { world } = mirror();
    world.applyServer(
      snap({
        units: [
          {
            i: 3,
            x: 1,
            y: 79,
            z: 2,
            h: 1,
            m: 1,
            k: 'champion',
            t: 1,
            c: 'torv',
            n: 'Mossmantle',
            b: 1,
          },
        ],
        events: [{ e: 'death', unitId: 9, killerId: 3, n: 'bob', kn: 'Mossmantle', kb: 1 }],
      }),
    );
    expect(world.seat(3)).toEqual({ name: 'Mossmantle', bot: true });
    expect(world.seat(9)).toEqual({ name: 'bob', bot: false });
    // The seat changed hands: the identity comes again.
    world.applyServer(
      snap({
        units: [
          { i: 3, x: 1, y: 79, z: 2, h: 1, m: 1, k: 'champion', t: 1, c: 'torv', n: 'carol' },
        ],
      }),
    );
    expect(world.seat(3)).toEqual({ name: 'carol', bot: false });
    world.applyServer({
      t: 'score',
      rows: [
        {
          unitId: 12,
          name: 'Fenn',
          championId: 'fenn',
          player: 'Quillspark',
          team: 12 as never,
          level: 3,
          kills: 0,
          deaths: 0,
          assists: 0,
          cs: 0,
          items: [],
          b: 1,
        },
      ],
    });
    expect(world.seat(12)).toEqual({ name: 'Quillspark', bot: true });
  });

  it("starts over on Respawn's next match", () => {
    const { world } = mirror();
    world.applyServer(
      snap({
        units: [
          { i: 1, x: 1, y: 79, z: 2, h: 1, m: 1, k: 'champion', t: 0, c: 'fenn', n: 'alice' },
        ],
        royale: {
          v: 'respawn',
          st: 'over',
          de: 10,
          end: 610,
          dusk,
          alive: 50,
          people: 1,
          caches: [],
        },
      }),
    );
    world.applyServer({
      t: 'match_start',
      selfUnitId: 4,
      team: 1,
      royale: { v: 'respawn', seats: 50 },
    });
    expect(world.units.size).toBe(0);
    expect(world.royale()).toBeNull();
    expect(world.seat(1)).toBeNull();
    expect(world.selfUnitId).toBe(4);
  });

  it('keeps the prediction on the plane', () => {
    const sent: ClientMsg[] = [];
    const orchard = starOrchard();
    const world = new ClientWorld(
      (m) => sent.push(m),
      orchard.map,
      new TerrainNavGrid(orchard.navigation),
      () => 0,
    );
    world.applyServer({ t: 'match_start', selfUnitId: 1, team: 0 });
    world.orderMove(1, 1, 2);
    expect(sent).toEqual([{ t: 'move', x: 1, z: 2, n: 1 }]);
  });
});

describe('the server and the mirror together', () => {
  it('reads the whole stream back: the own champion, a neighbour, the block', () => {
    const fake = fakeFactory();
    const person = {
      clientId: 1,
      owner: 1,
      name: 'alice',
      guest: false,
      pick: { championId: 'fenn', sigils: ['zephyr', 'sear'] as [string, string], skin: 0 },
    };
    const match = new RoyaleMatch(1, 5, 'one_life', [person], fake.factory);
    const sim = fake.sims[0]!;
    const self = match.players.get(1)!.unitId;
    const sent: ClientMsg[] = [];
    const world = new ClientWorld(
      (m) => sent.push(m),
      starOrchard().map,
      null,
      () => 0,
    );
    world.applyServer({
      t: 'match_start',
      selfUnitId: self,
      team: 0,
      royale: { v: 'one_life', seats: match.seatCount },
    });
    for (let i = 0; i < 220; i++) {
      match.tick();
      const s = match.snapshotFor(1);
      if (s) world.applyServer(s);
    }
    const other = [...sim.units.values()].find((u) => u.kind === 'champion' && u.id !== self)!;
    other.pos = near(sim.units.get(self)!.pos as never, 4);
    match.tick();
    world.applyServer(match.snapshotFor(1)!);
    expect(world.units.get(self)?.pos.y).toBeDefined();
    expect(world.units.get(other.id)?.pos.y).toBeCloseTo(other.pos.y!, 1);
    expect(world.seat(other.id)?.bot).toBe(true);
    expect(world.royale()).toMatchObject({ v: 'one_life', st: 'play', alive: 50, people: 1 });
    // The mirror's drop pick lands on the server's sim.
    world.pickDrop({ x: 0, y: 80, z: 0 });
    expect(sent).toEqual([{ t: 'drop', x: 0, y: 80, z: 0 }]);
  });
});
