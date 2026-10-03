// What the battle royale contract's tests share (tests/royale_contract*.test.ts):
// a small landed match of people, the fingerprint of what a rule could move,
// and a fake match's snapshot for one viewer. The contract is split per
// feature, one file each, so the worktree that brings a feature's rules
// deletes its own file and touches no other; this module is nobody's.

import type { RoyaleViewer } from '../server/royale_snapshot';
import { buildRoyaleSnapshot } from '../server/royale_snapshot';
import type { ServerMsg } from '../src/net/protocol';
import { buildRoyaleSim, type ReplayPick } from '../src/net/replay';
import { DROP_S, type RoyaleEvent, type RoyaleVariant } from '../src/sim/royale/types';
import type { Sim } from '../src/sim/sim';
import { FakeRoyaleSim, spot } from './royale_fake';
import { loadPlanet } from './royale_planet';

export type Snap = Extract<ServerMsg, { t: 'snap' }>;

export function picks(n: number): ReplayPick[] {
  const ids = ['dain', 'vesk', 'sylra', 'korrath', 'maera'];
  return Array.from({ length: n }, (_, i) => ({
    name: `seat${i}`,
    team: i,
    championId: ids[i % ids.length]!,
    sigils: ['riftstep', 'mend'] as [string, string],
  }));
}

// A small match of people (no bot decides), landed and a second into play.
export function landed(variant: RoyaleVariant = 'respawn') {
  const built = buildRoyaleSim(loadPlanet(), 4, picks(4), variant);
  while (built.sim.time < DROP_S + 1) built.sim.tick();
  return built;
}

// What a royale sim holds that a rule could move: the mode's state, the
// rng, the units' places and health.
export function fingerprint(sim: Sim) {
  return {
    checksum: sim.checksum(),
    rng: sim.rng.state,
    royale: structuredClone(sim.royale),
    tokens: [...sim.units.values()].map((u) => u.decisionTokens),
  };
}

// A fake Respawn match of four, seen by seat 0, its snapshot built on demand.
export function fakeSnap() {
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
