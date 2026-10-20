// A Thornfray's server on fake sims (server/thornfray_service.ts over
// tests/royale_fake.ts), for the tests of the service and of the wire: the
// deps faked and kept (what each connection was sent, the points banked,
// the seat reports, the replays saved), connections made and closed, the
// clock stepped, and a bout's counts set on its fake sim so a test decides
// who wins it.

import type { RoyaleReplay } from '../server/royale_match';
import type { RoyaleClient } from '../server/royale_service';
import type { SeatReport } from '../server/seat_report';
import { ThornfrayService } from '../server/thornfray_service';
import type { ClientMsg, ServerMsg } from '../src/net/protocol';
import { BOUT_KINDS } from '../src/sim/content/bouts';
import type { BoutKind } from '../src/sim/content/bouts/types';
import { DROP_S } from '../src/sim/royale/types';
import { DT } from '../src/sim/types';
import { type FakeRoyaleSim, fakeFactory } from './royale_fake';

export type Msg<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;

// A fake bout's play, seconds from its landing to its clock: six bouts
// with their Lulls run past the three minutes of the end's "still playing".
export const FAKE_BOUT_S = 25;
// Ticks from a fake bout's start to its end.
export const FAKE_BOUT_TICKS = Math.round((DROP_S + FAKE_BOUT_S) / DT) + 1;

export function thornfrayHarness(
  opts: { pool?: readonly BoutKind[]; capacity?: number; open?: boolean } = {},
) {
  const sent: { to: number; msg: ServerMsg }[] = [];
  const clients = new Map<number, RoyaleClient>();
  const seats: SeatReport[] = [];
  const banked = new Map<number, number>();
  const replays = new Map<number, RoyaleReplay>();
  const logs: string[] = [];
  const fake = fakeFactory({ boutS: FAKE_BOUT_S });
  let now = 1_000_000;
  let nextId = 100;
  // Snapshots are many: the last few per connection are kept.
  const keep = (to: number, msg: ServerMsg): void => {
    sent.push({ to, msg });
    if (msg.t !== 'snap') return;
    const snaps = sent.filter((s) => s.to === to && s.msg.t === 'snap');
    if (snaps.length > 20) sent.splice(sent.indexOf(snaps[0]!), 1);
  };
  const service: ThornfrayService = new ThornfrayService({
    send: keep,
    client: (id) => clients.get(id),
    factory: opts.open === false ? null : fake.factory,
    pool: opts.pool ?? BOUT_KINDS,
    newMatchId: () => nextId++,
    newSeed: (id) => id * 7,
    capacityLeft: () => (opts.capacity ?? 50) - service.load(),
    leaveQueues: () => undefined,
    bank: (owner, delta) => {
      const total = (banked.get(owner) ?? 0) + delta;
      banked.set(owner, total);
      return total;
    },
    appendSeat: (rec) => seats.push(rec),
    saveReplay: (id, record) => replays.set(id, record),
    now: () => now,
    log: (line) => logs.push(line),
  });
  const connect = (id: number, name: string, account = id, guest = false): RoyaleClient => {
    const c: RoyaleClient = {
      id,
      accountId: guest ? -account : account,
      name,
      guest,
      matchId: null,
      country: null,
      mobile: false,
      pings: [],
      fps: [],
      quality: null,
    };
    clients.set(id, c);
    return c;
  };
  // The socket closes: the service hears it, the connection is gone.
  const close = (c: RoyaleClient): void => {
    service.disconnect(c);
    clients.delete(c.id);
  };
  const say = (c: RoyaleClient, msg: ClientMsg): boolean => service.handle(c, msg);
  const enter = (c: RoyaleClient, championId = 'fenn'): boolean =>
    say(c, { t: 'thornfray', championId, sigils: ['zephyr', 'sear'], skin: 0 });
  const to = <T extends ServerMsg['t']>(id: number, t: T): Msg<T>[] =>
    sent.filter((s) => s.to === id && s.msg.t === t).map((s) => s.msg as Msg<T>);
  const last = <T extends ServerMsg['t']>(id: number, t: T): Msg<T> | undefined => to(id, t).at(-1);
  const step = (ticks: number): void => {
    for (let i = 0; i < ticks; i++) {
      now += 50;
      service.tick();
    }
  };
  // The bout being played: its fake sim, the last one built.
  const sim = (): FakeRoyaleSim => fake.sims.at(-1)!;
  // Steps until the next bout's sim is built (or the match ends).
  const nextBout = (): void => {
    const built = fake.sims.length;
    for (let i = 0; i < FAKE_BOUT_TICKS * 2 && fake.sims.length === built; i++) step(1);
  };
  // Steps until the drop of the bout being played is over.
  const land = (): void => {
    while (sim().royale.stage === 'drop') step(1);
  };
  // The bout's counts, by seat: the higher, the better its place.
  const counts = (byseat: readonly number[]): void => {
    const b = sim().royale.bout!;
    byseat.forEach((n, seat) => {
      b.counts[seat] = n;
    });
  };
  return {
    service,
    fake,
    sent,
    clients,
    seats,
    banked,
    replays,
    logs,
    connect,
    close,
    say,
    enter,
    to,
    last,
    step,
    sim,
    nextBout,
    land,
    counts,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
