// The contract the battle royale's Seedfalls, Risings, marks, Grafts,
// Reprieves and Arrivals stand on, before any of their rules: the state's
// new fields at their defaults, an observation and a snapshot that carry
// none of them, the Graft pick and the Arrival accepted and changing
// nothing (no state, no rng), the mode's hooks answering as the sim always
// did, the events forwarded and read back, the mirror keeping the blocks
// sent on change, and a royale replay refused under other rules.

import { describe, expect, it } from 'vitest';
import { buildRoyaleSnapshot, type RoyaleViewer } from '../server/royale_snapshot';
import { ClientWorld } from '../src/net/client_world';
import type { ServerMsg } from '../src/net/protocol';
import {
  applyReplayEvent,
  applySimCommand,
  buildRoyaleSim,
  loadRoyaleReplay,
  REPLAY_VERSION,
  type ReplayPick,
  royaleReplayPlayable,
} from '../src/net/replay';
import { royaleNotes } from '../src/net/royale_client';
import type { SnapRoyale } from '../src/net/royale_wire';
import { dispatchAction } from '../src/sim/action_dispatch';
import { buildObservation } from '../src/sim/observe';
import {
  DROP_S,
  ROYALE_RULES_VERSION,
  type RoyaleEvent,
  type RoyaleVariant,
} from '../src/sim/royale/types';
import { Sim } from '../src/sim/sim';
import { FakeRoyaleSim, spot } from './royale_fake';
import { loadPlanet } from './royale_planet';

type Snap = Extract<ServerMsg, { t: 'snap' }>;

function picks(n: number): ReplayPick[] {
  const ids = ['dain', 'vesk', 'sylra', 'korrath', 'maera'];
  return Array.from({ length: n }, (_, i) => ({
    name: `seat${i}`,
    team: i,
    championId: ids[i % ids.length]!,
    sigils: ['riftstep', 'mend'] as [string, string],
  }));
}

// A small match of people (no bot decides), landed and a second into play.
function landed(variant: RoyaleVariant = 'respawn') {
  const built = buildRoyaleSim(loadPlanet(), 4, picks(4), variant);
  while (built.sim.time < DROP_S + 1) built.sim.tick();
  return built;
}

// What a royale sim holds that a rule could move: the mode's state, the
// rng, the units' places and health.
function fingerprint(sim: Sim) {
  return {
    checksum: sim.checksum(),
    rng: sim.rng.state,
    royale: structuredClone(sim.royale),
    tokens: [...sim.units.values()].map((u) => u.decisionTokens),
  };
}

const NEW_OBS_KEYS = [
  'offer',
  'grafts',
  'seedfalls',
  'risings',
  'marks',
  'clamors',
  'arriving',
  'reprieveAt',
];

const NEW_BLOCK_KEYS = ['offer', 'gr', 'sf', 'ri', 'mk', 'cl', 'rk', 'gap', 'rp', 'ar', 'fi', 'wa'];

describe('the state and the observation', () => {
  it('holds every new field at its default, in the sim and on the fake', () => {
    for (const r of [landed().sim.royale!, new FakeRoyaleSim('one_life').royale]) {
      expect(r.seedfalls).toEqual([]);
      expect(r.risings).toEqual([]);
      expect(r.marks).toEqual([]);
      expect(r.clamors).toEqual([]);
      expect(r.wrathHolder).toBeNull();
      expect(r.offers.size).toBe(0);
      expect(r.grafts.size).toBe(0);
      expect(r.reprieveUsed.size).toBe(0);
      expect(r.duskOffset).toBe(0);
      expect(r.respawnPicks.size).toBe(0);
      expect(r.arriving.size).toBe(0);
    }
  });

  it('keeps every cache plain or golden, as the layout drew it', () => {
    const { sim } = landed();
    const kinds = new Set(sim.royale!.caches.map((c) => c.kind));
    expect([...kinds].sort()).toEqual(['golden', 'plain']);
  });

  it('leaves the new observation fields out', () => {
    const { sim, unitIds } = landed();
    const obs = buildObservation(sim, unitIds[0]!)!;
    for (const key of NEW_OBS_KEYS) expect(obs.royale).not.toHaveProperty(key);
    for (const c of obs.royale!.caches) expect(c).not.toHaveProperty('kind');
  });

  it('answers the hooks as the sim always did', () => {
    const { sim, unitIds } = landed('one_life');
    const mode = sim.royaleMode!;
    const u = sim.units.get(unitIds[1]!)!;
    expect(mode.wantsDeadDecision(u.id)).toBe(false);
    expect(mode.respawnHealth(u)).toBe(u.maxHp);
    expect(mode.pickGraft(u.id, 0, sim.time)).toBe(false);
  });
});

describe('the Graft pick and the Arrival', () => {
  it('accepts the graft action, free, and changes nothing', () => {
    const { sim, unitIds } = landed();
    const before = fingerprint(sim);
    for (const pick of [0, 1, 2] as const) {
      expect(dispatchAction(sim, unitIds[0]!, { kind: 'graft', pick })).toBe(true);
    }
    expect(dispatchAction(sim, unitIds[0]!, { kind: 'graft', pick: 3 as 0 })).toBe(false);
    expect(fingerprint(sim)).toEqual(before);
  });

  it('changes nothing in the 5v5 either', () => {
    const sim = new Sim(31);
    const u = sim.addChampion(0);
    sim.tick();
    const before = { checksum: sim.checksum(), rng: sim.rng.state, tokens: u.decisionTokens };
    expect(dispatchAction(sim, u.id, { kind: 'graft', pick: 0 })).toBe(true);
    expect(sim.pickGraft(u.id, 0)).toBe(false);
    sim.beginArrival(u.id);
    expect({ checksum: sim.checksum(), rng: sim.rng.state, tokens: u.decisionTokens }).toEqual(
      before,
    );
  });

  it('replays a graft command and an arrive event as nothing', () => {
    const { sim, unitIds } = landed();
    const teams = new Map(unitIds.map((id, i) => [id, i]));
    const before = fingerprint(sim);
    applySimCommand(sim, 0, unitIds[0]!, { t: 'graft', pick: 2 });
    applySimCommand(sim, 0, unitIds[0]!, { t: 'watch', next: true });
    applyReplayEvent(sim, teams, { k: sim.tickCount, u: unitIds[1]!, e: 'arrive' });
    expect(fingerprint(sim)).toEqual(before);
    expect(sim.policies.size).toBe(0);
  });

  it('plays the same match with the picks pressed as without', () => {
    const a = landed();
    const b = landed();
    for (let i = 0; i < 100; i++) {
      for (const id of a.unitIds) dispatchAction(a.sim, id, { kind: 'graft', pick: 0 });
      a.sim.tick();
      b.sim.tick();
    }
    expect(a.sim.checksum()).toBe(b.sim.checksum());
  });
});

describe('the wire', () => {
  function fakeSnap() {
    const sim = new FakeRoyaleSim('respawn');
    const self = sim.addChampion(0, 'fenn', spot(0, 4));
    for (let i = 1; i < 4; i++) sim.addChampion(i, 'fenn', spot(i, 4));
    const viewer: RoyaleViewer = {
      unitId: self.id,
      team: self.team,
      known: new Set(),
      seat: { ack: 0, ackAt: 0 },
    };
    const snap = (events: RoyaleEvent[] = []): Snap =>
      buildRoyaleSnapshot(sim, viewer, events, {
        seat: (id) => ({ name: `seat${id}`, bot: id !== self.id }),
        seats: 4,
        people: 1,
        caches: true,
      }) as Snap;
    return { sim, self, snap };
  }

  it('sends none of the new blocks, and the cache kinds as before', () => {
    const { sim, snap } = fakeSnap();
    sim.addCache(spot(2, 4), true);
    sim.addCache(spot(3, 4));
    const r = snap().royale!;
    for (const key of NEW_BLOCK_KEYS) expect(r).not.toHaveProperty(key);
    expect(r.caches!.map((c) => c[4])).toEqual([1, 0]);
  });

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
