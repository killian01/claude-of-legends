// The thread of light a trade of places draws (docs/design/ysmer.md, slice
// 3): the sim tells each trade it makes as a 'swap' event and nothing for a
// trade refused; the 5v5 and battle royale snapshots carry it to whoever
// sees either end, and the presentation reads the same notes from a local
// tick and from the wire. Her spells have their own looks in the catalog.

import { describe, expect, it } from 'vitest';
import { buildRoyaleSnapshot } from '../server/royale_snapshot';
import { buildSnapshot } from '../server/snapshot';
import { swapsFrom } from '../src/game/swap_notes';
import type { ServerMsg } from '../src/net/protocol';
import { buildChampionProp } from '../src/render/champions/props';
import { SPELL_VFX } from '../src/render/vfx/catalog';
import { tradePlaces } from '../src/sim/combat/swap';
import { Sim, type SimEvent } from '../src/sim/sim';
import type { TeamId, Vec2 } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';
import { FakeRoyaleSim, near, spot } from './royale_fake';

type Snap = Extract<ServerMsg, { t: 'snap' }>;
type Ctx = Parameters<typeof tradePlaces>[0];
const ctxOf = (sim: Sim): Ctx => (sim as unknown as { ctx(): Ctx }).ctx();

const C: Vec2 = { x: 75, z: 75 };

function seat(sim: Sim, team: number, at: Vec2, id: string): Unit {
  const u = sim.addChampion(team as TeamId, at, id);
  u.abilityRanks = { Q: 1, W: 1, E: 1, R: 1 };
  u.level = 6;
  u.mana = u.maxMana;
  return u;
}

function swapsOver(sim: Sim, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...sim.tick().filter((e) => e.type === 'swap'));
  return out;
}

describe('a trade of places is told', () => {
  it('once, naming Ysmer and the champion her spark traded her with', () => {
    const sim = new Sim(43);
    const y = seat(sim, 0, C, 'ysmer');
    const foe = seat(sim, 1, { x: 81, z: 75 }, 'torv');
    expect(sim.castAbility(y.id, 'E', { x: 85, z: 75 })).toBe(true);
    expect(swapsOver(sim, 20)).toEqual([{ type: 'swap', unitId: y.id, otherId: foe.id }]);
  });

  it('never for a trade refused', () => {
    const sim = new Sim(43);
    const y = seat(sim, 0, C, 'ysmer');
    const foe = seat(sim, 1, { x: 80, z: 75 }, 'torv');
    sim.tick();
    const ctx = ctxOf(sim);
    const before = ctx.events.length;
    foe.hp = 0;
    expect(tradePlaces(ctx, y, foe)).toBe(false);
    expect(tradePlaces(ctx, y, y)).toBe(false);
    expect(ctx.events.length).toBe(before);
    foe.hp = foe.maxHp;
    expect(tradePlaces(ctx, y, foe)).toBe(true);
    expect(ctx.events.slice(before)).toEqual([{ type: 'swap', unitId: y.id, otherId: foe.id }]);
  });
});

describe('the trade on the wire', () => {
  it('reaches a 5v5 side that sees either end, and a local tick reads the same notes', () => {
    const sim = new Sim(43);
    const y = seat(sim, 0, C, 'ysmer');
    const foe = seat(sim, 1, { x: 81, z: 75 }, 'torv');
    sim.tick();
    const events: SimEvent[] = [{ type: 'swap', unitId: y.id, otherId: foe.id }];
    for (const [team, self] of [
      [0, y.id],
      [1, foe.id],
    ] as const) {
      const snap = JSON.parse(
        JSON.stringify(buildSnapshot(sim, team, self, new Set(), events)),
      ) as Snap;
      expect(swapsFrom(snap.events)).toEqual(swapsFrom(events));
    }
    expect(swapsFrom(events)).toEqual([{ unitId: y.id, otherId: foe.id }]);
    // Two of the other side far in the fog: their trade stays theirs.
    const far = seat(sim, 1, { x: 140, z: 140 }, 'ysmer');
    const far2 = seat(sim, 1, { x: 141, z: 138 }, 'torv');
    sim.tick();
    expect(sim.isVisible(0, far.id)).toBe(false);
    expect(sim.isVisible(0, far2.id)).toBe(false);
    const hidden: SimEvent[] = [{ type: 'swap', unitId: far.id, otherId: far2.id }];
    const snap = buildSnapshot(sim, 0, y.id, new Set(), hidden) as Snap;
    expect(swapsFrom(snap.events)).toEqual([]);
  });

  it('is kept from a battle royale viewer who sees neither end', () => {
    const planet = new FakeRoyaleSim('respawn');
    planet.royale.stage = 'play';
    const me = planet.addChampion(0, 'fenn', spot(0, 50));
    const close = planet.addChampion(1, 'torv', near(me.pos as never, 5));
    const a = planet.addChampion(2, 'ysmer', spot(25, 50));
    const b = planet.addChampion(3, 'torv', near(spot(25, 50) as never, 4));
    const seen: SimEvent = { type: 'swap', unitId: a.id, otherId: close.id };
    const unseen: SimEvent = { type: 'swap', unitId: a.id, otherId: b.id };
    expect(planet.isVisible(me.team, close.id)).toBe(true);
    expect(planet.isVisible(me.team, a.id)).toBe(false);
    expect(planet.isVisible(me.team, b.id)).toBe(false);
    const snap = buildRoyaleSnapshot(
      planet,
      { unitId: me.id, team: me.team, known: new Set(), seat: { ack: 0, ackAt: 0 } },
      [seen, unseen],
      { seat: () => undefined, seats: 4, people: 1, caches: false },
    ) as Snap;
    expect(swapsFrom(snap.events)).toEqual([{ unitId: a.id, otherId: close.id }]);
  });
});

describe('her looks', () => {
  it('gives every spell and her attack an authored visual, and her lantern a prop', () => {
    for (const key of ['A', 'Q', 'W', 'E', 'R']) {
      expect(SPELL_VFX[`ysmer_${key}`], key).toBeDefined();
    }
    expect(SPELL_VFX.ysmer_W?.zone).toBeDefined();
    expect(SPELL_VFX.ysmer_E?.projectile).toBeDefined();
    expect(buildChampionProp('lantern', 0x88aaff).children.length).toBeGreaterThan(3);
  });
});
