// The battle royale on the server (server/royale_service.ts, ADR 0031) on a
// fake sim (tests/royale_fake.ts): entering starts a match or drops into
// one, the drop and the orders reach the sim, each person gets their own
// snapshots, the end tells each their result, Respawn moves the people into
// the next match, One life offers Play again, a dropped seat waits for its
// owner, and the points bank as they come.

import { describe, expect, it } from 'vitest';
import type { RoyaleReplay } from '../server/royale_match';
import {
  ROYALE_LINGER_MS,
  ROYALE_MATCH_WEIGHT,
  ROYALE_REJOIN_GRACE_MS,
  type RoyaleClient,
  RoyaleService,
} from '../server/royale_service';
import type { SeatReport } from '../server/seat_report';
import type { ClientMsg, ServerMsg } from '../src/net/protocol';
import { CALM_S, DROP_S, PLAY_S, ROYALE_SEATS } from '../src/sim/royale/types';
import { fakeFactory, near } from './royale_fake';

type Msg<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;

function harness(opts: { capacity?: number; open?: boolean } = {}) {
  const sent: { to: number; msg: ServerMsg }[] = [];
  const clients = new Map<number, RoyaleClient>();
  const seats: SeatReport[] = [];
  const banked = new Map<number, number>();
  const replays = new Map<number, RoyaleReplay>();
  const fake = fakeFactory();
  let now = 1_000_000;
  let nextId = 100;
  // Snapshots are many: the last few per person are kept.
  const keep = (to: number, msg: ServerMsg): void => {
    sent.push({ to, msg });
    if (msg.t !== 'snap') return;
    const snaps = sent.filter((s) => s.to === to && s.msg.t === 'snap');
    if (snaps.length > 40) sent.splice(sent.indexOf(snaps[0]!), 1);
  };
  const service: RoyaleService = new RoyaleService({
    send: keep,
    client: (id) => clients.get(id),
    factory: opts.open === false ? null : fake.factory,
    newMatchId: () => nextId++,
    newSeed: (id) => id * 7,
    capacityLeft: () => (opts.capacity ?? 50) - service.load(),
    leaveQueues: () => undefined,
    playable: () => null,
    bank: (owner, delta) => {
      const total = (banked.get(owner) ?? 0) + delta;
      banked.set(owner, total);
      return total;
    },
    appendSeat: (rec) => seats.push(rec),
    saveReplay: (id, record) => replays.set(id, record),
    now: () => now,
    log: () => undefined,
  });
  const connect = (id: number, name: string, guest = false): RoyaleClient => {
    const c: RoyaleClient = {
      id,
      accountId: guest ? -id : id,
      name,
      guest,
      matchId: null,
      country: null,
      mobile: false,
      pings: [],
    };
    clients.set(id, c);
    return c;
  };
  const say = (c: RoyaleClient, msg: ClientMsg): boolean => service.handle(c, msg);
  const enter = (c: RoyaleClient, v: 'respawn' | 'one_life' = 'respawn', championId = 'fenn') =>
    say(c, { t: 'royale', v, championId, sigils: ['zephyr', 'sear'], skin: 1 });
  const to = <T extends ServerMsg['t']>(id: number, t: T): Msg<T>[] =>
    sent.filter((s) => s.to === id && s.msg.t === t).map((s) => s.msg as Msg<T>);
  const last = <T extends ServerMsg['t']>(id: number, t: T): Msg<T> | undefined => to(id, t).at(-1);
  const step = (ticks: number): void => {
    for (let i = 0; i < ticks; i++) {
      now += 50;
      service.tick();
    }
  };
  // Runs the newest match's clock to `time` seconds (or its end).
  const runTo = (time: number): void => {
    const sim = fake.sims.at(-1)!;
    while (sim.time < time && sim.royale.stage !== 'over') step(1);
    if (sim.royale.stage === 'over') step(1);
  };
  return {
    service,
    sent,
    seats,
    banked,
    replays,
    fake,
    connect,
    say,
    enter,
    to,
    last,
    step,
    runTo,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('entering', () => {
  it('says so while the mode is not open', () => {
    const h = harness({ open: false });
    const a = h.connect(1, 'alice');
    h.enter(a);
    expect(h.last(1, 'error')?.message).toMatch(/not open/);
    expect(h.service.owns(1)).toBe(false);
  });

  it('starts a match at once with the person and forty-nine bots', () => {
    const h = harness();
    const a = h.connect(1, 'alice');
    h.enter(a);
    const start = h.last(1, 'match_start')!;
    expect(start.royale).toEqual({ v: 'respawn', seats: ROYALE_SEATS });
    expect(start.teams).toBe(ROYALE_SEATS);
    expect(start.dropIn).toBeUndefined();
    const picks = h.fake.picks[0]!;
    expect(picks).toHaveLength(ROYALE_SEATS);
    expect(picks[0]).toMatchObject({ name: 'alice', championId: 'fenn', skin: 1 });
    expect(picks.filter((p) => p.bot).length).toBe(ROYALE_SEATS - 1);
    expect(a.matchId).toBe(100);
    expect(h.service.owns(1)).toBe(true);
    expect(h.service.load()).toBe(ROYALE_MATCH_WEIGHT);
  });

  it('refuses a new match when the server is full', () => {
    const h = harness({ capacity: ROYALE_MATCH_WEIGHT - 1 });
    const a = h.connect(1, 'alice');
    h.enter(a);
    expect(h.last(1, 'error')?.message).toMatch(/capacity/);
  });

  it('drops a second person into the running match, in a bot seat of their champion', () => {
    const h = harness();
    const a = h.connect(1, 'alice');
    h.enter(a);
    h.step(40);
    const sim = h.fake.sims[0]!;
    const picks = h.fake.picks[0]!;
    const vesk = picks.findIndex((p, i) => i > 0 && p.championId === 'vesk');
    const b = h.connect(2, 'bob');
    h.enter(b, 'respawn', vesk >= 0 ? 'vesk' : 'fenn');
    const start = h.last(2, 'match_start')!;
    expect(start.dropIn).toBe(true);
    expect(h.fake.sims).toHaveLength(1);
    expect(sim.policies.has(start.selfUnitId)).toBe(false);
    if (vesk >= 0) expect(sim.units.get(start.selfUnitId)?.championId).toBe('vesk');
    expect(h.last(1, 'player_joined')?.name).toBe('bob');
    h.step(1);
    expect(h.last(2, 'snap')?.royale?.people).toBe(2);
  });

  it('One life takes no newcomer past the calm: a new match starts instead', () => {
    const h = harness();
    h.enter(h.connect(1, 'alice'), 'one_life');
    h.runTo(DROP_S + CALM_S + 1);
    h.enter(h.connect(2, 'bob'), 'one_life');
    expect(h.fake.sims).toHaveLength(2);
    expect(h.last(2, 'match_start')?.dropIn).toBeUndefined();
  });
});

describe('playing', () => {
  it('hands the drop pick and the orders, y and all, to the sim', () => {
    const h = harness();
    const a = h.connect(1, 'alice');
    h.enter(a);
    const self = h.last(1, 'match_start')!.selfUnitId;
    const sim = h.fake.sims[0]!;
    h.say(a, { t: 'drop', x: 0, y: 80, z: 0 });
    expect(sim.royale.drops.get(self)).toEqual({ x: 0, y: 80, z: 0 });
    h.runTo(DROP_S + 1);
    h.say(a, { t: 'move', x: 1, y: 79.9, z: 2, n: 1 });
    h.say(a, { t: 'cast', key: 'Q', x: 1, y: 79.9, z: 2 });
    // The 5v5's shop and recall are nobody's here.
    h.say(a, { t: 'buy', itemId: 'longblade' });
    h.say(a, { t: 'recall' });
    expect(sim.orders.map((o) => o.kind)).toEqual(['move', 'cast']);
    // Recorded for the replay as applied: the drop, then the two orders,
    // the order number left out.
    const events = h.service.matches.get(a.matchId!)!.match.replayEvents;
    expect(events.map((e) => e.c?.t)).toEqual(['drop', 'move', 'cast']);
    expect(events[1]?.c).toEqual({ t: 'move', x: 1, y: 79.9, z: 2 });
    expect(sim.orders[0]?.p).toEqual({ x: 1, y: 79.9, z: 2 });
    // A drop pick after the drop is nothing.
    h.say(a, { t: 'drop', x: 80, y: 0, z: 0 });
    expect(sim.royale.drops.get(self)).toEqual({ x: 0, y: 80, z: 0 });
  });

  it('sends each person their own snapshots, with the mode and the caches once a second', () => {
    const h = harness();
    const a = h.connect(1, 'alice');
    h.enter(a);
    const sim = h.fake.sims[0]!;
    sim.addCache({ x: 80, y: 0, z: 0 });
    h.step(20);
    const snaps = h.to(1, 'snap');
    expect(snaps.length).toBe(20);
    expect(snaps.filter((s) => s.royale?.caches !== undefined).length).toBe(2);
    expect(snaps.at(-1)?.royale?.st).toBe('drop');
    const self = h.last(1, 'match_start')!.selfUnitId;
    expect(snaps.at(-1)?.units.map((u) => u.i)).toEqual([self]);
    expect(snaps.at(-1)?.units[0]?.y).toBeDefined();
    // The scoreboard at once, every seat named and every bot marked.
    const score = h.to(1, 'score')[0]!;
    expect(score.rows).toHaveLength(ROYALE_SEATS);
    expect(score.rows.find((r) => r.unitId === self)).toMatchObject({ player: 'alice' });
    expect(score.rows.filter((r) => r.b === 1)).toHaveLength(ROYALE_SEATS - 1);
    expect(h.to(1, 'score')).toHaveLength(1);
  });

  it('banks points as they come, and tells the person', () => {
    const h = harness();
    const a = h.connect(1, 'alice');
    h.enter(a);
    h.runTo(DROP_S + 1);
    const sim = h.fake.sims[0]!;
    const self = h.last(1, 'match_start')!.selfUnitId;
    const victim = [...sim.units.values()].find((u) => u.kind === 'champion' && u.id !== self)!;
    sim.takedown(victim.id, self);
    h.step(1);
    expect(h.last(1, 'points')).toEqual({ t: 'points', delta: 10, total: 10, reason: 'kill' });
    expect(h.banked.get(1)).toBe(10);
    // The kill feed: everyone hears it, with the names.
    const death = h.last(1, 'snap')?.events.find((e) => e.e === 'death');
    expect(death).toMatchObject({ e: 'death', unitId: victim.id, kn: 'alice', vb: 1 });
  });
});

describe('the end', () => {
  it('Respawn tells each person their result and moves them into the next match', () => {
    const h = harness();
    const a = h.connect(1, 'alice');
    const b = h.connect(2, 'bob');
    h.enter(a);
    h.enter(b);
    h.runTo(DROP_S + PLAY_S + 0.1);
    const result = h.last(1, 'royale_result')!;
    expect(result).toMatchObject({ v: 'respawn', of: ROYALE_SEATS });
    expect(result.top.length).toBeGreaterThan(0);
    expect(h.last(2, 'royale_result')).toBeDefined();
    // The next match, at once, with both people in its drop.
    expect(h.fake.sims).toHaveLength(2);
    expect(h.service.matches.size).toBe(1);
    expect(h.to(1, 'match_start')).toHaveLength(2);
    expect(h.to(2, 'match_start')).toHaveLength(2);
    const next = h.fake.picks[1]!;
    expect(next.filter((p) => !p.bot).map((p) => p.name)).toEqual(['alice', 'bob']);
    expect(a.matchId).toBe(b.matchId);
    h.step(1);
    expect(h.last(1, 'snap')?.royale?.st).toBe('drop');
    // The finished match's replay: its picks, the drop picks and the mode.
    const replay = h.replays.get(100)!;
    expect(replay.royale).toEqual({ variant: 'respawn', guestsOnly: false });
    expect(replay.picks).toHaveLength(ROYALE_SEATS);
    expect(replay.ticks).toBeGreaterThan(0);
    // Each seat that ended wrote its report, the variant noted.
    expect(h.seats.map((s) => [s.how, s.queue, s.variant])).toEqual([
      ['ended', 'royale', 'respawn'],
      ['ended', 'royale', 'respawn'],
    ]);
  });

  it('One life tells the fallen at once, and Play again enters anew', () => {
    const h = harness();
    const a = h.connect(1, 'alice');
    h.enter(a, 'one_life');
    h.runTo(DROP_S + 1);
    const sim = h.fake.sims[0]!;
    const self = h.last(1, 'match_start')!.selfUnitId;
    const killer = [...sim.units.values()].find((u) => u.kind === 'champion' && u.id !== self)!;
    sim.takedown(self, killer.id);
    h.step(1);
    const result = h.last(1, 'royale_result')!;
    expect(result).toMatchObject({ v: 'one_life', place: ROYALE_SEATS, of: ROYALE_SEATS });
    expect(h.last(1, 'snap')?.royale?.place).toBe(ROYALE_SEATS);
    // Play again: out of the old match, into a new one.
    h.enter(a, 'one_life');
    expect(h.fake.sims).toHaveLength(2);
    expect(h.to(1, 'match_start')).toHaveLength(2);
    expect(h.seats.at(-1)).toMatchObject({ how: 'menu', variant: 'one_life' });
  });

  it('One life lingers on its end, then closes', () => {
    const h = harness();
    const a = h.connect(1, 'alice');
    h.enter(a, 'one_life');
    h.runTo(DROP_S + 1);
    const sim = h.fake.sims[0]!;
    const self = h.last(1, 'match_start')!.selfUnitId;
    sim.finish(self);
    h.step(1);
    expect(h.last(1, 'royale_result')).toMatchObject({ place: 1, winner: 'alice' });
    expect(h.last(1, 'points')?.reason).toBe('last_standing');
    h.advance(ROYALE_LINGER_MS);
    h.step(1);
    expect(h.last(1, 'match_end')).toBeDefined();
    expect(h.service.matches.size).toBe(0);
    expect(a.matchId).toBeNull();
  });
});

describe('leaving and coming back', () => {
  it('a dropped connection leaves the seat to a bot, held for its owner', () => {
    const h = harness();
    const a = h.connect(1, 'alice');
    h.enter(a);
    const self = h.last(1, 'match_start')!.selfUnitId;
    const sim = h.fake.sims[0]!;
    const entry = h.service.matches.get(a.matchId!)!;
    const open = entry.match.openBotSeats;
    h.service.disconnect(a);
    expect(sim.policies.get(self)).toBeDefined();
    expect(entry.match.openBotSeats).toBe(open);
    expect(h.seats.at(-1)?.how).toBe('closed');
    // Back on a new socket: hello claims the seat.
    const again = h.connect(3, 'alice');
    (again as { accountId: number }).accountId = 1;
    expect(h.service.rejoin(again)).toBe(true);
    expect(h.last(3, 'match_start')?.selfUnitId).toBe(self);
    expect(sim.policies.has(self)).toBe(false);
  });

  it('a seat held for nobody after the grace, and a match nobody returns to, go', () => {
    const h = harness();
    const a = h.connect(1, 'alice');
    h.enter(a);
    h.service.disconnect(a);
    h.advance(ROYALE_REJOIN_GRACE_MS + 1);
    h.step(1);
    expect(h.service.matches.size).toBe(0);
    expect(h.service.rejoin(h.connect(1, 'alice'))).toBe(false);
  });

  it('leaving from the menu hands the champion to a bot for good', () => {
    const h = harness();
    const a = h.connect(1, 'alice');
    const b = h.connect(2, 'bob');
    h.enter(a);
    h.enter(b);
    const self = h.last(1, 'match_start')!.selfUnitId;
    const sim = h.fake.sims[0]!;
    h.say(a, { t: 'leave' });
    expect(a.matchId).toBeNull();
    expect(sim.policies.get(self)).toBe('normal');
    expect(h.last(2, 'player_left')?.name).toBe('alice');
    expect(h.service.rejoin(a)).toBe(false);
    // Bob still plays; the first person's seat is anyone's to take now.
    const c = h.connect(3, 'carol');
    h.enter(c, 'respawn', 'fenn');
    expect(h.last(3, 'match_start')?.selfUnitId).toBe(self);
  });
});

describe('the seat changing hands on the wire', () => {
  it('sends the seat identity again with the new name and bot mark', () => {
    const h = harness();
    const a = h.connect(1, 'alice');
    h.enter(a);
    h.runTo(DROP_S + 1);
    const sim = h.fake.sims[0]!;
    const self = h.last(1, 'match_start')!.selfUnitId;
    const other = [...sim.units.values()].find((u) => u.kind === 'champion' && u.id !== self)!;
    other.pos = near(sim.units.get(self)!.pos as never, 3);
    h.step(1);
    const seen = h.last(1, 'snap')!.units.find((u) => u.i === other.id)!;
    expect(seen.b).toBe(1);
    const b = h.connect(2, 'bob');
    h.enter(b, 'respawn', other.championId ?? 'fenn');
    expect(h.last(2, 'match_start')?.selfUnitId).toBe(other.id);
    h.step(1);
    const again = h.last(1, 'snap')!.units.find((u) => u.i === other.id)!;
    expect(again).toMatchObject({ k: 'champion', n: 'bob' });
    expect(again.b).toBeUndefined();
  });
});
