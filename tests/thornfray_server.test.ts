// A Thornfray's whole server path on the real sim (ADR 0035): the service
// (server/thornfray_service.ts) over the battle royale's factory handed each
// bout (server/royale_build.ts, buildBoutSim on the shipped Wanderseed), one
// person's socket faked and seven house bots. The person enters, starts it
// at once, picks a landing in every Lull and gives an order now and then; a
// second person takes a bot's seat in the second Lull; every bout starts
// with its table and plays to its end, every snapshot of a bout carries its
// line, the result comes once after the Final, and each bout's replay is
// kept under its own id and plays back to the very sim that ran it, the
// second Lull built again included.

import { describe, expect, it } from 'vitest';
import { royaleFactory } from '../server/royale_build';
import type { RoyaleReplay } from '../server/royale_match';
import type { RoyaleClient } from '../server/royale_service';
import type { RoyaleBuild, RoyaleSimFactory } from '../server/royale_sim';
import type { SeatReport } from '../server/seat_report';
import { ThornfrayService } from '../server/thornfray_service';
import type { ServerMsg } from '../src/net/protocol';
import { applyReplayEvent, loadRoyaleReplay, royaleReplayPlayable } from '../src/net/replay';
import { BOUT_KINDS } from '../src/sim/content/bouts';
import { BOUT_SEATS, BOUTS } from '../src/sim/content/bouts/match';
import type { Sim } from '../src/sim/sim';
import { loadPlanet } from './royale_planet';

type Msg<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;

const connection = (id: number, accountId: number, name: string): RoyaleClient => ({
  id,
  accountId,
  name,
  guest: false,
  matchId: null,
  country: null,
  mobile: false,
  pings: [],
  fps: [],
  quality: null,
});

describe('a Thornfray on the real sim', () => {
  it('plays six bouts to one result, each bout kept and played back alike', () => {
    // What each connection was sent, the snapshots trimmed; and the bout
    // each was last started on.
    const inbox = new Map<number, ServerMsg[]>([
      [1, []],
      [2, []],
    ]);
    const bouts = new Map<number, number>();
    const replays = new Map<number, RoyaleReplay>();
    const seats: SeatReport[] = [];
    // The last sim the factory built for each bout, by its index.
    const built = new Map<number, RoyaleBuild>();
    let builds = 0;
    const real = royaleFactory(loadPlanet);
    const factory: RoyaleSimFactory = (...args) => {
      const b = real(...args);
      built.set(b.replay.royale.bout!.index, b);
      builds += 1;
      return b;
    };
    const ash = connection(1, 41, 'ash');
    const birch = connection(2, 42, 'birch');
    let now = 1_000_000;
    let nextId = 700;
    const service: ThornfrayService = new ThornfrayService({
      send: (to, msg) => {
        if (msg.t === 'match_start') bouts.set(to, msg.royale?.tf?.b ?? -1);
        const box = inbox.get(to)!;
        box.push(msg);
        if (box.length > 2000) {
          const old = box.splice(0, 1000).filter((m) => m.t !== 'snap');
          box.unshift(...old);
        }
      },
      client: (id) => [ash, birch].find((c) => c.id === id),
      factory,
      pool: BOUT_KINDS,
      newMatchId: () => nextId++,
      newSeed: (id) => id * 13,
      capacityLeft: () => 50 - service.load(),
      leaveQueues: () => undefined,
      bank: () => 0,
      appendSeat: (rec) => seats.push(rec),
      saveReplay: (id, record) => replays.set(id, record),
      now: () => now,
      log: () => undefined,
    });
    service.handle(ash, { t: 'thornfray', championId: 'torv', sigils: ['riftstep', 'mend'] });
    service.handle(ash, { t: 'thornfray_start' });
    const of = <T extends ServerMsg['t']>(to: number, t: T): Msg<T>[] =>
      inbox.get(to)!.filter((m) => m.t === t) as Msg<T>[];
    let picked = -1;
    let lines = 0;
    let lateAt = -1;
    for (let tick = 0; tick < 20 * 60 * 20 && of(1, 'thornfray_result').length === 0; tick++) {
      now += 50;
      service.tick();
      const last = inbox.get(1)!.at(-1);
      const r = last?.t === 'snap' ? last.royale : undefined;
      if (r?.tf) lines += 1;
      // A landing in each Lull, at its Thornyard's heart; an order now and
      // then once landed; birch comes in the second Lull.
      const bout = bouts.get(1) ?? -1;
      if (r?.st === 'drop' && picked !== bout) {
        picked = bout;
        const [x, y, z] = r.dusk.c;
        service.handle(ash, { t: 'drop', x, y, z });
      } else if (r?.st === 'drop' && bout === 1 && lateAt < 0 && tick % 20 === 0) {
        lateAt = built.get(1)!.sim.tickCount;
        service.handle(birch, {
          t: 'thornfray',
          championId: 'maera',
          sigils: ['zephyr', 'sear'],
          skin: 1,
        });
      } else if (r?.st === 'play' && tick % 200 === 0) {
        const [x, y, z] = r.dusk.c;
        service.handle(ash, { t: 'move', x, y, z });
      }
    }
    const result = of(1, 'thornfray_result')[0]!;
    expect(result).toBeDefined();
    expect(result.of).toBe(BOUT_SEATS);
    expect(result.bouts).toHaveLength(BOUTS);
    expect(result.table).toHaveLength(BOUT_SEATS);
    expect(of(1, 'royale_result')).toEqual([]);
    expect(lines).toBeGreaterThan(BOUTS);
    expect(ash.matchId).toBeNull();
    // Birch took a seat in the second Lull and played on to the end.
    expect(lateAt).toBeGreaterThan(0);
    expect(builds).toBe(BOUTS + 1);
    const late = of(2, 'match_start')[0]!.royale!.tf!;
    expect(late.b).toBe(1);
    expect(built.get(1)!.replay.picks[late.s]).toMatchObject({
      name: 'birch',
      championId: 'maera',
    });
    expect(of(2, 'thornfray_result')).toHaveLength(1);
    // Ash's landing, picked before the Lull was built again, stood through
    // it: played up to where it stood and kept in the bout's record.
    const before = replays.get(result.replays[1]!)!.events.filter((e) => e.k < lateAt);
    expect(before.map((e) => e.c?.t)).toContain('drop');
    expect(seats.map((s) => [s.queue, s.how, s.dropIn])).toEqual([
      ['thornfray', 'ended', false],
      ['thornfray', 'ended', true],
    ]);
    // Six bouts kept, each its own sim; each plays back to where it ended.
    expect(result.replays).toHaveLength(BOUTS);
    result.replays.forEach((id, i) => {
      const record = replays.get(id)!;
      expect(record.royale.bout?.index).toBe(i);
      expect(royaleReplayPlayable(record)).toBe(true);
      const again = loadRoyaleReplay(loadPlanet(), { ...record, picks: [...record.picks] })!;
      const teams = new Map<number, number>();
      for (const u of again.sim.units.values()) teams.set(u.id, u.team);
      const queue = [...record.events];
      while (again.sim.tickCount < record.ticks) {
        while (queue.length > 0 && queue[0]!.k === again.sim.tickCount) {
          applyReplayEvent(again.sim, teams, queue.shift()!);
        }
        again.sim.tick();
      }
      const live = built.get(i)!.sim as unknown as Sim;
      expect(again.sim.checksum()).toBe(live.checksum());
    });
  }, 300_000);
});
