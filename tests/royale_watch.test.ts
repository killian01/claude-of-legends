// The Death beat's killer on the wire (CONTEXT.md: Death beat;
// server/royale_snapshot_blocks.ts watchBlock, src/net/watch_body.ts): a
// fallen Respawn seat is sent its killer's champion and where it stands
// through the wait, while the killer stands; the mirror draws the body from
// it, the beat's camera follows that body, and a bot's observation reads
// nothing new.

import { describe, expect, it } from 'vitest';
import { waitKiller } from '../server/royale_snapshot_blocks';
import { starOrchard } from '../server/star_orchard';
import { BeatCamera, type BeatLens } from '../src/game/death_beat';
import { ClientWorld } from '../src/net/client_world';
import type { ServerMsg, SnapUnit } from '../src/net/protocol';
import type { SnapRoyale, SnapWatch } from '../src/net/royale_wire';
import { dealDamage } from '../src/sim/combat/damage';
import { buildObservation } from '../src/sim/observe';
import { BURR_S } from '../src/sim/royale/burr';
import { RESPAWN_S } from '../src/sim/royale/types';
import type { Sim } from '../src/sim/sim';
import type { CombatCtx } from '../src/sim/sim_context';
import { TerrainNavGrid } from '../src/sim/terrain_nav';
import type { Unit } from '../src/sim/unit';
import { fakeSnap, landed } from './royale_contract_fixture';

// A fake Respawn match in play, the viewer fallen at `fellAt` to the seat
// beside it (its Burr hung by that fall), the killer standing.
function fallen(fellAt = 300) {
  const f = fakeSnap();
  f.sim.royale.stage = 'play';
  f.sim.time = fellAt + 0.5;
  const killer = f.sim.units.get(f.self.id + 1)!;
  killer.pos = { x: 1.234, y: 79.5, z: 2.345 };
  killer.skin = 1;
  f.self.dead = true;
  f.self.respawnAt = fellAt + RESPAWN_S;
  f.sim.royale.burrs.set(f.self.id, { carrierId: killer.id, until: fellAt + BURR_S });
  return { ...f, killer };
}

describe('the wa block', () => {
  it("sends the fallen seat its killer's champion and point through the wait", () => {
    const { snap, killer } = fallen();
    expect(snap().royale?.wa).toEqual({
      i: killer.id,
      c: killer.championId,
      sk: 1,
      t: killer.team,
      at: [1.23, 79.5, 2.35],
      h: Math.round(killer.hp),
      m: Math.round(killer.maxHp),
    });
    // Every snapshot of the wait, not on change.
    expect(snap().royale?.wa?.i).toBe(killer.id);
  });

  it('sends nothing once the killer is down, nor once the champion stands again', () => {
    const a = fallen();
    a.killer.dead = true;
    expect(a.snap().royale).not.toHaveProperty('wa');
    const b = fallen();
    b.self.dead = false;
    expect(b.snap().royale).not.toHaveProperty('wa');
  });

  it("sends nothing for a fall nobody landed: an older Burr is not this fall's", () => {
    const { sim, self, snap } = fallen();
    // The Burr was hung by a fall ten seconds before this one.
    sim.royale.burrs.set(self.id, { carrierId: self.id + 2, until: 290 + BURR_S });
    expect(snap().royale).not.toHaveProperty('wa');
    sim.royale.burrs.delete(self.id);
    expect(snap().royale).not.toHaveProperty('wa');
  });

  it('sends nothing to another seat, outside the play, or in One life', () => {
    const a = fallen();
    a.sim.royale.burrs.set(a.self.id + 2, { carrierId: a.killer.id, until: 300 + BURR_S });
    a.self.dead = false;
    expect(a.snap().royale).not.toHaveProperty('wa');
    const b = fallen();
    b.sim.royale.stage = 'over';
    expect(b.snap().royale).not.toHaveProperty('wa');
    const c = fallen();
    (c.sim.royale as { variant: string }).variant = 'one_life';
    expect(c.snap().royale).not.toHaveProperty('wa');
  });
});

describe('the killer of a wait in a match', () => {
  function takedown(sim: Sim, killer: Unit, victim: Unit): void {
    killer.pos = { ...victim.pos };
    killer.path = [];
    const ctx = (sim as unknown as { ctx(): CombatCtx }).ctx();
    dealDamage(ctx, killer.id, victim, victim.maxHp * 10, 'true');
    sim.tick();
  }

  it('is the champion the takedown credited, and the observation reads nothing new', () => {
    const { sim, unitIds } = landed('respawn');
    const [a, b] = unitIds.map((id) => sim.units.get(id)!);
    const before = Object.keys(buildObservation(sim, b!.id)!.royale!).sort();
    takedown(sim, a!, b!);
    expect(b!.dead).toBe(true);
    expect(waitKiller(sim.royale!, b!)).toBe(a!.id);
    const keys = Object.keys(buildObservation(sim, b!.id)!.royale!);
    for (const k of keys) expect([...before, 'burr']).toContain(k);
    expect(waitKiller(sim.royale!, a!)).toBeNull();
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

const SELF = 1;
const KILLER = 4;

function mirror() {
  const orchard = starOrchard();
  const world = new ClientWorld(
    () => {},
    orchard.map,
    new TerrainNavGrid(orchard.navigation),
    () => 0,
  );
  world.applyServer({
    t: 'match_start',
    selfUnitId: SELF,
    team: 0,
    royale: { v: 'respawn', seats: 50 },
  });
  let time = 100;
  const snap = (royale: SnapRoyale, units: SnapUnit[] = []): ServerMsg => {
    time += 0.05;
    return {
      t: 'snap',
      time,
      units,
      gone: [],
      projectiles: [],
      zones: [],
      walls: [],
      self: null,
      events: [],
      winner: null,
      royale,
    };
  };
  return { world, snap };
}

const watch = (x: number): SnapWatch => ({
  i: KILLER,
  c: 'fenn',
  sk: 0,
  t: 3,
  at: [x, 79, 2],
  h: 500,
  m: 900,
});

describe('the mirror', () => {
  it('draws the killer from wa, moves it, and lets it go when wa ends', () => {
    const { world, snap } = mirror();
    world.applyServer(snap(block({ wa: watch(1) })));
    const body = world.units.get(KILLER)!;
    expect(body).toMatchObject({ kind: 'champion', championId: 'fenn', team: 3, dead: false });
    expect(body.pos).toEqual({ x: 1, y: 79, z: 2 });
    expect([body.hp, body.maxHp]).toEqual([500, 900]);
    world.applyServer(snap(block({ wa: watch(3) })));
    expect(world.units.get(KILLER)).toBe(body);
    expect(body.pos.x).toBe(3);
    world.applyServer(snap(block()));
    expect(world.units.has(KILLER)).toBe(false);
  });

  it("hands the body over to the killer's own record once it is back in sight", () => {
    const { world, snap } = mirror();
    world.applyServer(snap(block({ wa: watch(1) })));
    const own: SnapUnit = {
      i: KILLER,
      x: 5,
      y: 79,
      z: 2,
      h: 400,
      m: 900,
      k: 'champion',
      t: 3,
      c: 'fenn',
    };
    world.applyServer(snap(block(), [own]));
    expect(world.units.get(KILLER)?.pos.x).toBe(5);
    world.applyServer(snap(block(), [{ ...own, x: 6 }]));
    expect(world.units.get(KILLER)?.pos.x).toBe(6);
  });

  it('puts the beat camera on the drawn killer through the wait', () => {
    const { world, snap } = mirror();
    world.applyServer(
      snap(block(), [
        { i: SELF, x: 0, y: 80, z: 0, h: 100, m: 900, k: 'champion', t: 0, c: 'dain' },
      ]),
    );
    const calls: string[] = [];
    const lens: BeatLens = {
      watchUnit: (id) => calls.push(`watch ${id}`),
      lookAtPoint: () => calls.push('look'),
      recenterCamera: () => calls.push('recenter'),
    };
    const camera = new BeatCamera(world, lens, SELF);
    camera.tick([]);
    world.applyServer(
      snap(block({ wa: watch(1) }), [{ i: SELF, x: 0, y: 80, z: 0, h: 0, m: 900, d: 1 }]),
    );
    camera.tick([{ unitId: SELF, killerId: KILLER, kn: 'Pinetinder' }]);
    expect(calls).toEqual([`watch ${KILLER}`, 'recenter']);
  });
});
