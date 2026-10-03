// The battle royale's whole server path on the real sim (ADR 0031): the
// service (server/royale_service.ts) on buildRoyaleSim over the shipped
// Wanderseed (server/planet.ts), one person's socket faked and forty-nine
// bots. The person enters Respawn, picks a landing during the drop, lands, plays; a second
// person drops into a bot's seat mid-match; every snapshot holds to the
// person's own sight with y on every position and the mode's block; the end
// tells both their result, the points add up, and the next match starts at
// once with both people in its drop. One life closes its door after the
// calm. What it costs is printed for the report.

import { describe, expect, it } from 'vitest';
import { planet } from '../server/planet';
import { royaleFactory } from '../server/royale_build';
import { type RoyaleClient, RoyaleService } from '../server/royale_service';
import type { ClientMsg, ServerMsg } from '../src/net/protocol';
import { CALM_S, DROP_S, PLAY_S, ROYALE_SEATS } from '../src/sim/royale/types';
import type { Sim } from '../src/sim/sim';

type Msg<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;

function server() {
  const inbox = new Map<number, ServerMsg[]>();
  const bytes = new Map<number, number>();
  const clients = new Map<number, RoyaleClient>();
  const banked = new Map<number, number>();
  let now = 1_000_000;
  let nextId = 500;
  const service: RoyaleService = new RoyaleService({
    send: (to, msg) => {
      bytes.set(to, (bytes.get(to) ?? 0) + JSON.stringify(msg).length);
      const box = inbox.get(to) ?? [];
      // Snapshots are many: the last few are kept, every other message all.
      if (msg.t === 'snap') {
        const snaps = box.filter((m) => m.t === 'snap');
        if (snaps.length >= 30) box.splice(box.indexOf(snaps[0]!), 1);
      }
      box.push(msg);
      inbox.set(to, box);
    },
    client: (id) => clients.get(id),
    factory: royaleFactory(planet),
    newMatchId: () => nextId++,
    newSeed: (id) => id * 7919,
    capacityLeft: () => 50 - service.load(),
    leaveQueues: () => undefined,
    playable: () => null,
    bank: (owner, delta) => {
      const total = (banked.get(owner) ?? 0) + delta;
      banked.set(owner, total);
      return total;
    },
    appendSeat: () => undefined,
    saveReplay: () => undefined,
    now: () => now,
    log: () => undefined,
  });
  const connect = (id: number, name: string): RoyaleClient => {
    const c: RoyaleClient = {
      id,
      accountId: -id,
      name,
      guest: true,
      matchId: null,
      country: null,
      mobile: false,
      pings: [],
      fps: [],
    };
    clients.set(id, c);
    return c;
  };
  const say = (c: RoyaleClient, msg: ClientMsg) => service.handle(c, msg);
  const all = <T extends ServerMsg['t']>(id: number, t: T): Msg<T>[] =>
    (inbox.get(id) ?? []).filter((m) => m.t === t) as Msg<T>[];
  const last = <T extends ServerMsg['t']>(id: number, t: T): Msg<T> | undefined =>
    all(id, t).at(-1);
  const tick = (): number => {
    now += 50;
    const t0 = performance.now();
    service.tick();
    return performance.now() - t0;
  };
  return { service, connect, say, all, last, tick, bytes, banked };
}

const SEC = 20;

describe('a Respawn match on the real sim', () => {
  it('runs a person through the drop, the play, a drop in, the end and the next match', () => {
    const s = server();
    const a = s.connect(1, 'Wanderer 1');
    s.say(a, { t: 'royale', v: 'respawn', championId: 'fenn', sigils: ['riftstep', 'mend'] });
    const start = s.last(1, 'match_start')!;
    expect(start.royale).toEqual({ v: 'respawn', seats: ROYALE_SEATS });
    expect(start.teams).toBe(ROYALE_SEATS);
    const entry = s.service.matches.get(a.matchId!)!;
    const sim = entry.match.sim;
    const self = start.selfUnitId;

    // The drop: a pick on open ground, the first cache spot.
    const spot = planet().layout.caches[0]!.at;
    s.say(a, { t: 'drop', x: spot.x, y: spot.y, z: spot.z });
    s.tick();
    const first = s.last(1, 'snap')!;
    expect(first.royale?.st).toBe('drop');
    expect(first.royale?.caches?.length).toBeGreaterThan(0);
    expect(first.royale?.drop).toBeDefined();
    // Nobody else's position during the drop.
    expect(first.units.filter((u) => u.k === 'champion').map((u) => u.i)).toEqual([self]);

    // Landing.
    while (sim.royale.stage === 'drop') s.tick();
    for (let i = 0; i < SEC; i++) s.tick();
    const landed = s.last(1, 'snap')!;
    expect(landed.royale?.st).toBe('play');
    const me = sim.units.get(self)!;
    expect(me.pos.y).toBeDefined();
    const dist = Math.hypot(me.pos.x - spot.x, me.pos.y! - spot.y, me.pos.z - spot.z);
    expect(dist).toBeLessThan(12);

    // Play: an order now and then, and the snapshots checked against the
    // sim's own sight of the person's team.
    const costs: number[] = [];
    let b: RoyaleClient | null = null;
    let bSelf = 0;
    let checked = 0;
    const bytesAt = s.bytes.get(1) ?? 0;
    const timeAt = sim.time;
    while (sim.royale.stage !== 'over') {
      costs.push(s.tick());
      if (sim.tickCount % (2 * SEC) === 0) {
        const u = sim.units.get(self)!;
        s.say(a, { t: 'move', x: u.pos.x + 3, y: u.pos.y, z: u.pos.z });
      }
      if (b === null && sim.time > DROP_S + 60) {
        b = s.connect(2, 'Wanderer 2');
        s.say(b, { t: 'royale', v: 'respawn', championId: 'torv', sigils: ['zephyr', 'sear'] });
        const bStart = s.last(2, 'match_start')!;
        expect(bStart.dropIn).toBe(true);
        expect(b.matchId).toBe(a.matchId);
        bSelf = bStart.selfUnitId;
        expect(sim.units.get(bSelf)?.kind).toBe('champion');
        // The bot stepped aside: the seat is the person's (the real sim's policies).
        expect((sim as unknown as Sim).policies.has(bSelf)).toBe(false);
      }
      if (b && sim.tickCount % (2 * SEC) === 0) s.say(b, { t: 'stop' });
      if (sim.tickCount % (10 * SEC) === 0 && sim.royale.stage === 'play') {
        const snap = s.last(1, 'snap')!;
        const team = sim.units.get(self)!.team;
        const sent = new Set(snap.units.map((u) => u.i));
        for (const id of sent) expect(sim.isVisible(team, id)).toBe(true);
        for (const u of sim.units.values()) {
          if (sim.isVisible(team, u.id)) expect(sent.has(u.id)).toBe(true);
        }
        for (const u of snap.units) expect(u.y).toBeDefined();
        expect(snap.royale?.v).toBe('respawn');
        expect(snap.royale?.people).toBe(b ? 2 : 1);
        expect(snap.royale?.alive).toBe(ROYALE_SEATS);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(sim.time).toBeGreaterThanOrEqual(DROP_S + PLAY_S - 1);

    // The end: each person's result, and the points they were told add up
    // to what was banked.
    const ra = s.last(1, 'royale_result')!;
    const rb = s.last(2, 'royale_result')!;
    expect(ra).toMatchObject({ v: 'respawn', of: ROYALE_SEATS });
    expect(rb).toMatchObject({ v: 'respawn', of: ROYALE_SEATS });
    expect(ra.top.length).toBe(10);
    expect(ra.winner).not.toBeNull();
    const told = s.all(1, 'points').reduce((sum, p) => sum + p.delta, 0);
    expect(s.banked.get(-1) ?? 0).toBe(told);

    // The next match, at once, both people in its drop.
    expect(s.all(1, 'match_start')).toHaveLength(2);
    expect(s.all(2, 'match_start')).toHaveLength(2);
    expect(a.matchId).not.toBe(entry.match.id);
    expect(a.matchId).toBe(b?.matchId);
    s.tick();
    expect(s.last(1, 'snap')?.royale?.st).toBe('drop');

    const sorted = [...costs].sort((x, y) => x - y);
    const avg = costs.reduce((x, y) => x + y, 0) / costs.length;
    const seconds = sim.time - timeAt;
    console.log(
      `royale server tick: avg ${avg.toFixed(2)} ms, p95 ${sorted[Math.floor(sorted.length * 0.95)]!.toFixed(2)} ms, ` +
        `max ${sorted.at(-1)!.toFixed(2)} ms over ${costs.length} ticks; ` +
        `one person ${Math.round(((s.bytes.get(1) ?? 0) - bytesAt) / seconds)} B/s`,
    );
  }, 600_000);
});

describe('a One life match on the real sim', () => {
  it('takes newcomers during the calm only', () => {
    const s = server();
    const a = s.connect(1, 'Wanderer 1');
    s.say(a, { t: 'royale', v: 'one_life', championId: 'sylra', sigils: ['riftstep', 'mend'] });
    const sim = s.service.matches.get(a.matchId!)!.match.sim;
    while (sim.time < DROP_S + 10) {
      s.tick();
      if (sim.tickCount % (2 * SEC) === 0) s.say(a, { t: 'stop' });
    }
    const b = s.connect(2, 'Wanderer 2');
    s.say(b, { t: 'royale', v: 'one_life', championId: 'fenn', sigils: ['riftstep', 'mend'] });
    expect(b.matchId).toBe(a.matchId);
    while (sim.time < DROP_S + CALM_S + 1) s.tick();
    const c = s.connect(3, 'Wanderer 3');
    s.say(c, { t: 'royale', v: 'one_life', championId: 'fenn', sigils: ['riftstep', 'mend'] });
    expect(c.matchId).not.toBe(a.matchId);
    expect(s.service.matches.size).toBe(2);
    expect(s.last(1, 'snap')?.royale).toMatchObject({ v: 'one_life', st: 'play' });
  }, 600_000);
});
