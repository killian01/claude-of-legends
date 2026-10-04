// The contract the battle royale's Seedfalls, Risings, marks, Grafts,
// Reprieves and Arrivals stand on, the part that holds before and after
// their rules: the state's new fields at their defaults on a fresh landing,
// the events forwarded and read back, the mirror keeping the blocks sent on
// change, a block's memory per seat, the newcomers carried from the person
// to the replay, and a royale replay refused under other rules. What each
// feature leaves inert until its rules land is pinned in its own file
// (tests/royale_contract_<feature>.test.ts, owned by that feature's
// worktree), so no two worktrees edit one test.

import { describe, expect, it } from 'vitest';
import { royaleFactory } from '../server/royale_build';
import { royaleSeats } from '../server/royale_seats';
import type { RoyaleViewer } from '../server/royale_snapshot';
import { sentOnChange } from '../server/royale_snapshot_blocks';
import { ClientWorld } from '../src/net/client_world';
import {
  buildRoyaleSim,
  loadRoyaleReplay,
  REPLAY_VERSION,
  royaleReplayPlayable,
} from '../src/net/replay';
import { royaleNotes } from '../src/net/royale_client';
import type { SnapRoyale } from '../src/net/royale_wire';
import { ROYALE_RULES_VERSION, type RoyaleEvent } from '../src/sim/royale/types';
import { Sim } from '../src/sim/sim';
import { fakeSnap, landed, picks, type Snap } from './royale_contract_fixture';
import { FakeRoyaleSim, fakeFactory, spot } from './royale_fake';
import { loadPlanet } from './royale_planet';

// Every optional block on the wire (src/net/royale_wire.ts SnapRoyale).
const NEW_BLOCK_KEYS = ['offer', 'gr', 'sf', 'ri', 'mk', 'cl', 'rk', 'gap', 'rp', 'ar', 'fi', 'wa'];

describe('the state', () => {
  it('holds every new field at its default, in the sim and on the fake', () => {
    for (const r of [landed().sim.royale!, new FakeRoyaleSim('one_life').royale]) {
      expect(r.seedfalls).toEqual([]);
      expect(r.risings).toEqual([]);
      expect(r.marks).toEqual([]);
      expect(r.clamors).toEqual([]);
      expect(r.wrathHolder).toBeNull();
      // No offer but each seat's drop Bough since the Grafts (grafts.ts).
      for (const q of r.offers.values()) expect(q.map((o) => o.grade)).toEqual(['bough']);
      expect(r.grafts.size).toBe(0);
      expect(r.reprieveUsed.size).toBe(0);
      expect(r.duskOffset).toBe(0);
      expect(r.respawnPicks.size).toBe(0);
      expect(r.arriving.size).toBe(0);
    }
  });

  it('deals no newcomer when none is seated', () => {
    expect(landed().sim.royaleMode!.newcomers.size).toBe(0);
  });
});

describe('the wire', () => {
  it('forwards every new event to everyone, a Pad slam only to who sees it', () => {
    const { self, snap } = fakeSnap();
    const at = spot(3, 4);
    const events: RoyaleEvent[] = [
      { type: 'royale_seedfall', seedfallId: 1, at, landsAt: 130 },
      { type: 'royale_seedfall_land', seedfallId: 1, at },
      { type: 'royale_rising', kind: 'warden', at, risesAt: 280 },
      { type: 'royale_wrath_passed', from: 2, to: 3 },
      { type: 'royale_mark', unitId: 2, kind: 'lodestar' },
      { type: 'royale_snuffed', unitId: 2, killerId: 3, streak: 5 },
      { type: 'royale_reprieve', unitId: 3, backAt: 50 },
      { type: 'royale_dusk_hastens', by: 30, alive: 16 },
      { type: 'royale_last_light', step: 'double' },
      { type: 'royale_pad_slam', unitId: 4, at, hit: [2] },
      { type: 'royale_pad_slam', unitId: self.id, at: self.pos as never, hit: [] },
    ];
    const sent = snap(events).events;
    expect(sent.map((e) => e.e)).toEqual([
      'royale_seedfall',
      'royale_seedfall_land',
      'royale_rising',
      'royale_wrath_passed',
      'royale_mark',
      'royale_snuffed',
      'royale_reprieve',
      'royale_dusk_hastens',
      'royale_last_light',
      'royale_pad_slam',
    ]);
    const notes = royaleNotes(sent);
    expect(notes.map((n) => n.kind)).toEqual([
      'seedfall',
      'seedfall_land',
      'rising',
      'wrath_passed',
      'mark',
      'snuffed',
      'reprieve',
      'hastens',
      'last_light',
      'pad_slam',
    ]);
    // The sim's own shape reads alike.
    expect(royaleNotes(events.slice(0, 3)).map((n) => n.kind)).toEqual([
      'seedfall',
      'seedfall_land',
      'rising',
    ]);
  });

  it('keeps the blocks sent on change in the mirror until a new match', () => {
    const world = new ClientWorld(
      () => undefined,
      new Sim(1).map,
      null,
      () => 0,
    );
    world.applyServer({
      t: 'match_start',
      selfUnitId: 1,
      team: 0,
      royale: { v: 'respawn', seats: 4 },
    });
    const base: SnapRoyale = {
      v: 'respawn',
      st: 'play',
      de: 10,
      end: 610,
      dusk: { p: 0, c: [0, 80, 0], r: 160, pe: 100, sh: 0, b: 0.01 },
      alive: 4,
      people: 1,
    };
    const snap = (royale: SnapRoyale): Snap => ({
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
      royale,
    });
    world.applyServer(snap(base));
    for (const key of NEW_BLOCK_KEYS) expect(world.royaleView()).not.toHaveProperty(key);
    world.applyServer(
      snap({
        ...base,
        sf: [[1, 0, 80, 0, 130, 0]],
        ri: [['warden', 0, 80, 0, 280, 0, 1]],
        mk: [[2, 'lodestar', 0, 80, 0, 50]],
        cl: [[0, 80, 0, 51]],
      }),
    );
    world.applyServer(snap(base));
    const r = world.royaleView()!;
    expect(r.sf).toEqual([[1, 0, 80, 0, 130, 0]]);
    expect(r.ri).toHaveLength(1);
    expect(r.mk).toHaveLength(1);
    expect(r.cl).toHaveLength(1);
    world.applyServer({
      t: 'match_start',
      selfUnitId: 1,
      team: 0,
      royale: { v: 'respawn', seats: 4 },
    });
    world.applyServer(snap(base));
    expect(world.royaleView()).not.toHaveProperty('sf');
  });
});

describe('a block sent on change', () => {
  const viewer = (seat: { ack: number; ackAt: number }): RoyaleViewer => ({
    unitId: 1,
    team: 0,
    known: new Set(),
    seat,
  });

  it('remembers what each seat was sent, across fresh viewer literals', () => {
    const seat = { ack: 0, ackAt: 0 };
    expect(sentOnChange(viewer(seat), 'sf', [1, 2], 10)).toEqual([1, 2]);
    expect(sentOnChange(viewer(seat), 'sf', [1, 2], 10.05)).toBeUndefined();
    expect(sentOnChange(viewer(seat), 'sf', [1, 3], 10.1)).toEqual([1, 3]);
    // Another block, and another seat, have their own memory.
    expect(sentOnChange(viewer(seat), 'cl', [1, 3], 10.1)).toEqual([1, 3]);
    expect(sentOnChange(viewer({ ack: 0, ackAt: 0 }), 'sf', [1, 3], 10.1)).toEqual([1, 3]);
  });

  it('sends an unchanged block again once its period has passed', () => {
    const seat = { ack: 0, ackAt: 0 };
    expect(sentOnChange(viewer(seat), 'sf', [], 20, 1)).toEqual([]);
    expect(sentOnChange(viewer(seat), 'sf', [], 20.95, 1)).toBeUndefined();
    expect(sentOnChange(viewer(seat), 'sf', [], 21, 1)).toEqual([]);
    expect(sentOnChange(viewer(seat), 'sf', [], 21.5, 1)).toBeUndefined();
  });
});

describe('the newcomers', () => {
  it('flags a newcomer seat from the person through the builder to the record', () => {
    const pick = { championId: 'dain', sigils: ['riftstep', 'mend'] as [string, string], skin: 0 };
    const people = [
      { clientId: 1, owner: 1, name: 'one', guest: false, pick },
      { clientId: 2, owner: 2, name: 'two', guest: false, pick, newcomer: true },
    ];
    const seats = royaleSeats(people, 4, 4);
    expect(seats.map((s) => s.newcomer === true)).toEqual([false, true, false, false]);
    const fake = fakeFactory();
    expect(fake.factory(4, 'one_life', seats).replay.royale.newcomers).toEqual([1]);
    const build = royaleFactory(loadPlanet)(4, 'one_life', seats);
    expect(build.replay.royale.newcomers).toEqual([1]);
    const mode = (build.sim as unknown as Sim).royaleMode!;
    expect([...mode.newcomers]).toEqual([build.unitIds[1]]);
    const none = royaleFactory(loadPlanet)(4, 'one_life', royaleSeats(people.slice(0, 1), 4, 4));
    expect(none.replay.royale).not.toHaveProperty('newcomers');
  });

  it('replays a record with newcomers onto the same seats', () => {
    const record = {
      version: REPLAY_VERSION,
      seed: 4,
      picks: picks(4),
      royale: { variant: 'one_life' as const, rules: ROYALE_RULES_VERSION, newcomers: [0, 2] },
    };
    const { sim: royale, unitIds } = loadRoyaleReplay(loadPlanet(), record)!;
    expect([...royale.royaleMode!.newcomers]).toEqual([unitIds[0], unitIds[2]]);
  });
});

describe('a royale replay', () => {
  it('records the rules it ran under and is refused under others', () => {
    const record = {
      version: REPLAY_VERSION,
      seed: 4,
      picks: picks(4),
      royale: { variant: 'respawn' as const, rules: ROYALE_RULES_VERSION },
    };
    expect(royaleReplayPlayable(record)).toBe(true);
    expect(royaleReplayPlayable({ ...record, royale: { variant: 'respawn' } })).toBe(false);
    expect(
      royaleReplayPlayable({
        ...record,
        royale: { variant: 'respawn', rules: ROYALE_RULES_VERSION + 1 },
      }),
    ).toBe(false);
    expect(royaleReplayPlayable({ ...record, version: REPLAY_VERSION - 1 })).toBe(false);
    expect(
      loadRoyaleReplay(loadPlanet(), { ...record, royale: { variant: 'respawn' } }),
    ).toBeNull();
    const { sim: royale } = loadRoyaleReplay(loadPlanet(), record)!;
    const { sim: live } = buildRoyaleSim(loadPlanet(), 4, picks(4), 'respawn');
    for (let i = 0; i < 400; i++) {
      royale.tick();
      live.tick();
    }
    expect(royale.checksum()).toBe(live.checksum());
  });
});
