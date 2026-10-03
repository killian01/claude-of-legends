// One battle royale snapshot for one person (server/royale_snapshot.ts,
// ADR 0031): their own champion's sight, y on every position, the seat's
// name and bot mark, the mode's block, the events for the kill feed, and
// what fifty champions cost on the wire.

import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  buildRoyaleSnapshot,
  CACHES_EVERY_TICKS,
  type RoyaleSnapContext,
  type RoyaleViewer,
} from '../server/royale_snapshot';
import type { ServerMsg, SnapEvent } from '../src/net/protocol';
import type { SeatLabel } from '../src/net/royale_wire';
import { FakeRoyaleSim, near, spot } from './royale_fake';

type Snap = Extract<ServerMsg, { t: 'snap' }>;

function setup(n = 50, variant: 'respawn' | 'one_life' = 'respawn') {
  const sim = new FakeRoyaleSim(variant);
  const champions = Array.from({ length: n }, (_, i) => sim.addChampion(i, 'fenn', spot(i, n)));
  const labels = new Map<number, SeatLabel>(
    champions.map((u, i) => [u.id, { name: i === 0 ? 'alice' : `Bot${i}`, bot: i !== 0 }]),
  );
  const self = champions[0]!;
  const viewer: RoyaleViewer = {
    unitId: self.id,
    team: self.team,
    known: new Set(),
    seat: { ack: 0, ackAt: 0 },
  };
  const ctx = (caches = false): RoyaleSnapContext => ({
    seat: (id) => labels.get(id),
    seats: n,
    people: 1,
    caches,
  });
  const snap = (events: Parameters<typeof buildRoyaleSnapshot>[2] = [], caches = false): Snap =>
    buildRoyaleSnapshot(sim, viewer, events, ctx(caches)) as Snap;
  return { sim, champions, self, viewer, labels, snap };
}

describe('what a person sees', () => {
  it('is their own champion alone until another comes within sight', () => {
    const { sim, champions, self, snap } = setup();
    sim.royale.stage = 'play';
    let s = snap();
    expect(s.units.map((u) => u.i)).toEqual([self.id]);
    const other = champions[7]!;
    other.pos = near(self.pos as never, 5);
    s = snap();
    expect(s.units.map((u) => u.i).sort((a, b) => a - b)).toEqual([self.id, other.id]);
  });

  it('carries y on every position, and the seat name and bot mark once', () => {
    const { sim, champions, self, snap } = setup();
    sim.royale.stage = 'play';
    const other = champions[3]!;
    other.pos = near(self.pos as never, 4);
    const first = snap();
    const rec = first.units.find((u) => u.i === other.id)!;
    expect(rec.y).toBeCloseTo(other.pos.y!, 1);
    expect(rec).toMatchObject({ k: 'champion', n: 'Bot3', b: 1 });
    const mine = first.units.find((u) => u.i === self.id)!;
    expect(mine.n).toBe('alice');
    expect(mine.b).toBeUndefined();
    // Identity once: the next snapshot carries the lite fields only.
    const second = snap().units.find((u) => u.i === other.id)!;
    expect(second.n).toBeUndefined();
    expect(second.y).toBeDefined();
  });

  it('shows nobody else during the drop, only their picks, with the caches', () => {
    const { sim, champions, self, snap } = setup();
    champions[5]!.pos = near(self.pos as never, 3);
    sim.pickDrop(self.id, { x: 0, y: 80, z: 0 });
    sim.pickDrop(champions[5]!.id, { x: 80, y: 0, z: 0 });
    sim.addCache({ x: 0, y: -80, z: 0 }, true);
    const s = snap([], true);
    expect(s.units.map((u) => u.i)).toEqual([self.id]);
    expect(s.royale?.drop).toEqual([0, 80, 0]);
    expect(s.royale?.picks).toEqual([[80, 0, 0]]);
    expect(s.royale?.caches).toEqual([[1, 0, -80, 0, 1]]);
    // Between two lists, no list.
    expect(snap([], false).royale?.caches).toBeUndefined();
  });

  it('fogs a neutral bolt for the seat that shares its nominal team', () => {
    const { sim, self, snap } = setup();
    sim.royale.stage = 'play';
    // A camp's bolt carries team 0, which seat 0 holds too.
    const camp = sim.addCamp(spot(25, 50));
    sim.addProjectile(camp.id, 0, spot(25, 50));
    const own = sim.addProjectile(self.id, self.team, near(self.pos as never, 2));
    expect(snap().projectiles.map((p) => p.i)).toEqual([own.id]);
    expect(snap().projectiles[0]!.y).toBeDefined();
  });
});

describe('the mode block', () => {
  it('tells the stage, the clocks, the Dusk, the counts and the own score', () => {
    const { sim, self, snap } = setup(50, 'one_life');
    sim.royale.stage = 'play';
    sim.royale.scores.set(self.id, 3);
    sim.royale.eliminated.push(9, 10);
    const r = snap().royale!;
    expect(r).toMatchObject({ v: 'one_life', st: 'play', de: 10, end: 610, alive: 48, people: 1 });
    expect(r.score).toBe(3);
    expect(r.place).toBeUndefined();
    expect(r.dusk).toMatchObject({ p: 0, c: [0, 80, 0], r: 160, nc: [0, 80, 0], nr: 120, sh: 0 });
    sim.royale.eliminated.push(self.id);
    expect(snap().royale?.place).toBe(48);
  });

  it('shows the score leader, and where only while shown', () => {
    const { sim, champions, snap } = setup();
    sim.royale.stage = 'play';
    const leader = champions[4]!;
    sim.royale.leaderId = leader.id;
    sim.royale.scores.set(leader.id, 7);
    sim.time = 100;
    sim.royale.leaderShownAt = 99;
    expect(snap().royale?.leader?.at).toBeDefined();
    sim.royale.leaderShownAt = 60;
    expect(snap().royale?.leader).toEqual({ i: leader.id, s: 7 });
  });

  it('tells the cache being opened by the recipient', () => {
    const { sim, self, snap } = setup();
    sim.royale.stage = 'play';
    const id = sim.addCache(near(self.pos as never, 1));
    sim.royale.caches[0]!.opener = self.id;
    sim.royale.caches[0]!.openSince = 12.5;
    expect(snap().royale?.opening).toEqual({ c: id, since: 12.5 });
  });
});

describe('the events', () => {
  it('names the fallen and their killer for everyone, bot marks included', () => {
    const { sim, champions, snap } = setup(50, 'one_life');
    sim.royale.stage = 'play';
    const victim = champions[20]!;
    const killer = champions[21]!;
    const s = snap([
      { type: 'death', unitId: victim.id, killerId: killer.id },
      { type: 'royale_out', unitId: victim.id, killerId: killer.id, place: 50 },
      { type: 'royale_end', winnerId: killer.id },
      { type: 'royale_dusk', phase: 2 },
      { type: 'royale_leader', unitId: killer.id },
    ]);
    expect(s.events).toEqual<SnapEvent[]>([
      { e: 'death', unitId: victim.id, killerId: killer.id, n: 'Bot20', kn: 'Bot21', vb: 1, kb: 1 },
      {
        e: 'royale_out',
        unitId: victim.id,
        killerId: killer.id,
        place: 50,
        n: 'Bot20',
        kn: 'Bot21',
        vb: 1,
        kb: 1,
      },
      { e: 'royale_end', winnerId: killer.id, n: 'Bot21', b: 1 },
      { e: 'royale_dusk', phase: 2 },
      { e: 'royale_leader', unitId: killer.id, n: 'Bot21', b: 1 },
    ]);
  });

  it('keeps loot to its owner and landings, caches and pads to who sees them', () => {
    const { sim, champions, self, snap } = setup();
    sim.royale.stage = 'play';
    const far = champions[30]!;
    const s = snap([
      { type: 'royale_loot', unitId: self.id, itemId: 'longblade', source: 'cache' },
      { type: 'royale_loot', unitId: far.id, itemId: 'longblade', source: 'cache' },
      { type: 'royale_land', unitId: self.id },
      { type: 'royale_land', unitId: far.id },
      { type: 'royale_cache', unitId: far.id, cacheId: 3 },
      { type: 'royale_pad', unitId: self.id, padId: 2 },
    ]);
    expect(s.events).toEqual<SnapEvent[]>([
      { e: 'royale_loot', unitId: self.id, itemId: 'longblade', source: 'cache' },
      { e: 'royale_land', unitId: self.id },
      { e: 'royale_pad', unitId: self.id, padId: 2 },
    ]);
  });
});

describe('the bandwidth with fifty champions', () => {
  // A crowded fight: a dozen champions in sight of the recipient, the rest
  // spread over the planet, three bolts in the air, the caches list once a
  // second. What one person's socket carries in a second of it.
  it('stays within budget for one person', () => {
    const { sim, champions, self, snap } = setup(50);
    sim.royale.stage = 'play';
    for (let i = 1; i <= 12; i++) champions[i]!.pos = near(self.pos as never, 1 + i * 0.7);
    for (let c = 0; c < 150; c++) sim.addCache(spot(c, 150));
    for (let i = 1; i <= 3; i++) sim.addProjectile(champions[i]!.id, i, near(self.pos as never, i));
    let bytes = 0;
    let deflated = 0;
    const ticks = 20;
    for (let t = 0; t < ticks; t++) {
      sim.tickCount = t + 1;
      sim.time = sim.tickCount / 20;
      for (const u of champions.slice(1, 13)) {
        u.pos = near(u.pos as never, 0.2);
        u.hp -= 1;
      }
      const text = JSON.stringify(snap([], t % CACHES_EVERY_TICKS === 0));
      bytes += text.length;
      deflated += deflateRawSync(text).length;
    }
    // Recorded for the report: about 32 kB/s raw and 6 kB/s deflated on
    // this scene (2026-10-02). The budget leaves room for the real sim's
    // statuses and windups.
    console.log(`royale snapshot: ${bytes} B/s raw, ${deflated} B/s deflated, one person`);
    expect(bytes).toBeLessThan(60_000);
    expect(deflated).toBeLessThan(15_000);
  });
});
