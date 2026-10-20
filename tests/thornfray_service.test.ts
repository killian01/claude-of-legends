// A Thornfray on the server (server/thornfray_service.ts, ADR 0035) on fake
// sims (tests/royale_fake.ts through tests/thornfray_harness.ts): a
// gathering to a result, Start now, the bouts chained with every person
// moved onto each new sim, a rejoin during a Lull and during a bout with the
// whole table, the second Lull's late seat, a leave played by the seat's
// bot, no royale_result before the end, the six replays saved under numeric
// ids, listed in the result and held from the prune while the match runs.

import { describe, expect, it } from 'vitest';
import { GATHER_MS } from '../server/thornfray_gather';
import { THORNFRAY_MATCH_WEIGHT } from '../server/thornfray_service';
import { BOUT_SEATS, BOUTS } from '../src/sim/content/bouts/match';
import { thornfrayHarness } from './thornfray_harness';

// Plays every bout left to its end, `win` the seat given the best count in
// each (none: the counts stay level).
function playOut(h: ReturnType<typeof thornfrayHarness>, win?: number, order?: () => void): void {
  for (let guard = 0; guard < BOUTS + 1 && h.service.entries.size > 0; guard++) {
    if (win !== undefined)
      h.counts(Array.from({ length: BOUT_SEATS }, (_, s) => (s === win ? 9 : 0)));
    order?.();
    h.nextBout();
  }
}

describe('the gathering', () => {
  it('gathers people, tells them where it stands, and starts at its clock', () => {
    const h = thornfrayHarness();
    const a = h.connect(1, 'ash');
    const b = h.connect(2, 'birch');
    expect(h.enter(a)).toBe(true);
    expect(h.last(1, 'thornfray_gather')).toEqual({
      t: 'thornfray_gather',
      people: 1,
      of: BOUT_SEATS,
      startsIn: 20,
      opener: true,
    });
    h.enter(b);
    expect(h.last(1, 'thornfray_gather')?.people).toBe(2);
    expect(h.last(2, 'thornfray_gather')).toMatchObject({ people: 2, opener: false });
    // A second a tell, nothing started yet.
    h.step(20);
    expect(h.last(2, 'thornfray_gather')?.startsIn).toBe(19);
    expect(h.service.entries.size).toBe(0);
    h.step(GATHER_MS / 50);
    expect(h.service.entries.size).toBe(1);
    const start = h.last(1, 'match_start')!;
    expect(start.royale?.tf?.b).toBe(0);
    expect(h.last(2, 'match_start')?.royale?.tf?.s).toBe(1);
    expect(a.matchId).not.toBeNull();
    expect(b.matchId).toBe(a.matchId);
    expect(h.service.load()).toBe(THORNFRAY_MATCH_WEIGHT);
    // The two people sit on the first two seats, the bots on the rest.
    expect(h.fake.picks[0]!.map((p) => p.bot === undefined)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('starts at once on the opener Start now, and only theirs', () => {
    const h = thornfrayHarness();
    const a = h.connect(1, 'ash');
    const b = h.connect(2, 'birch');
    h.enter(a);
    h.enter(b);
    h.say(b, { t: 'thornfray_start' });
    expect(h.service.entries.size).toBe(0);
    h.say(a, { t: 'thornfray_start' });
    expect(h.service.entries.size).toBe(1);
    expect(h.to(1, 'match_start')).toHaveLength(1);
    expect(h.to(2, 'match_start')).toHaveLength(1);
  });

  it('starts full, and the next person opens the next gathering', () => {
    const h = thornfrayHarness();
    for (let i = 1; i <= BOUT_SEATS; i++) h.enter(h.connect(i, `p${i}`));
    expect(h.service.entries.size).toBe(1);
    expect(h.fake.picks[0]!.every((p) => p.bot === undefined)).toBe(true);
    const late = h.connect(20, 'late');
    h.enter(late);
    expect(h.last(20, 'thornfray_gather')).toMatchObject({ people: 1, opener: true });
  });

  it('hands Start now on when its opener leaves, and closes empty', () => {
    const h = thornfrayHarness();
    const a = h.connect(1, 'ash');
    const b = h.connect(2, 'birch');
    h.enter(a);
    h.enter(b);
    h.say(a, { t: 'leave' });
    expect(h.last(2, 'thornfray_gather')).toMatchObject({ people: 1, opener: true });
    h.close(b);
    expect(h.service.presence()).toEqual({ playing: 0, gathering: 0 });
    h.step(GATHER_MS / 50 + 1);
    expect(h.service.entries.size).toBe(0);
  });

  it('is closed with no released kind, and refused at capacity', () => {
    const closed = thornfrayHarness({ pool: [] });
    closed.enter(closed.connect(1, 'ash'));
    expect(closed.last(1, 'error')?.message).toBe('Thornfray is not open yet.');
    const full = thornfrayHarness({ capacity: 0 });
    full.enter(full.connect(1, 'ash'));
    expect(full.last(1, 'error')?.message).toMatch(/capacity/);
  });
});

describe('the bouts', () => {
  it('chains six bouts to one result, moving every person onto each new sim', () => {
    const h = thornfrayHarness();
    const a = h.connect(1, 'ash');
    h.enter(a);
    h.say(a, { t: 'thornfray_start' });
    const id = a.matchId;
    playOut(h, 0, () => h.say(a, { t: 'move', x: 1, y: 80, z: 0 }));
    const starts = h.to(1, 'match_start');
    expect(starts.map((s) => s.royale?.tf?.b)).toEqual([0, 1, 2, 3, 4, 5]);
    // Each bout its own sim and its own unit ids for the same seat 0; the
    // matchId held on the Thornfray's id through every Lull.
    expect(h.fake.sims).toHaveLength(BOUTS);
    expect(new Set(starts.map((s) => s.royale?.tf?.s))).toEqual(new Set([0]));
    // The kinds' variants, bout by bout, each read at its start.
    const kinds = starts[0]!.royale!.tf!.k;
    expect(kinds).toHaveLength(BOUTS);
    starts.forEach((s, i) => {
      expect(s.royale?.v).toBe(kinds[i] === 'lastwick' ? 'one_life' : 'respawn');
    });
    // The prize's seat from the second bout on: the last bout's winner.
    expect(starts.map((s) => s.royale?.tf?.p)).toEqual([undefined, 0, 0, 0, 0, 0]);
    expect(h.fake.bouts.map((b) => b?.prize)).toEqual([null, 0, 0, 0, 0, 0]);
    // No bout's end sends a royale_result: only the match's result.
    expect(h.to(1, 'royale_result')).toEqual([]);
    const result = h.last(1, 'thornfray_result')!;
    expect(result).toMatchObject({ place: 1, of: BOUT_SEATS, seat: 0, won: BOUTS });
    expect(result.bushels).toBe(5 * 5 + 10);
    expect(result.bouts.map((b) => b.pl)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(result.bouts.map((b) => b.k)).toEqual(kinds);
    expect(result.table).toHaveLength(BOUT_SEATS);
    expect(result.table[0]).toEqual([0, 'ash', 'fenn', 0, 35, 6]);
    // The first's end on the ladder, the one person alone: 40.
    expect(h.to(1, 'points').filter((p) => p.reason === 'thornfray_first')).toEqual([
      { t: 'points', delta: 40, total: expect.any(Number), reason: 'thornfray_first' },
    ]);
    expect(result.points).toBe(h.banked.get(1));
    expect(h.last(1, 'match_end')).toBeDefined();
    expect(a.matchId).toBeNull();
    expect(id).not.toBeNull();
    expect(h.service.entries.size).toBe(0);
  });

  it('saves each bout under its own numeric id, held from the prune while it runs', () => {
    const h = thornfrayHarness();
    const a = h.connect(1, 'ash');
    h.enter(a);
    h.say(a, { t: 'thornfray_start' });
    h.nextBout();
    h.nextBout();
    const held = h.service.heldReplayIds();
    expect(held).toHaveLength(2);
    expect([...h.replays.keys()]).toEqual(held);
    expect(held).not.toContain(a.matchId);
    playOut(h);
    const result = h.last(1, 'thornfray_result')!;
    expect(result.replays).toHaveLength(BOUTS);
    expect(result.replays.every((r) => Number.isInteger(r))).toBe(true);
    expect(new Set(result.replays).size).toBe(BOUTS);
    expect([...h.replays.keys()]).toEqual(result.replays);
    // Each record is the bout's: its seed and its picks.
    for (const [i, r] of result.replays.entries()) {
      expect(h.replays.get(r)?.seed).toBe(h.fake.seeds[i]);
    }
    expect(h.service.heldReplayIds()).toEqual([]);
    // One seat report, the Thornfray's, with its bouts.
    expect(h.seats).toHaveLength(1);
    expect(h.seats[0]).toMatchObject({ queue: 'thornfray', how: 'ended', replays: result.replays });
  });

  it("hands the next bout the prizes a bout left open and its winner's seat", () => {
    const h = thornfrayHarness();
    const a = h.connect(1, 'ash');
    h.enter(a);
    h.say(a, { t: 'thornfray_start' });
    h.counts([0, 0, 9]);
    h.sim().openPrizes = [{ seat: 4, cards: ['bloodsap', 'thornhide', 'emberroot'] }];
    h.nextBout();
    expect(h.fake.bouts.at(-1)).toMatchObject({
      index: 1,
      prize: 2,
      pendingPrize: [{ seat: 4, cards: ['bloodsap', 'thornhide', 'emberroot'] }],
      guestsOnly: false,
    });
    h.nextBout();
    expect(h.fake.bouts.at(-1)).toMatchObject({ index: 2, pendingPrize: [] });
  });

  it('pays no end inside a bout, and the match end only to a seat still playing', () => {
    const h = thornfrayHarness();
    const a = h.connect(1, 'ash');
    h.enter(a);
    h.say(a, { t: 'thornfray_start' });
    // Never an order: first in every bout, and nothing for the end.
    playOut(h, 0);
    const reasons = h.to(1, 'points').map((p) => p.reason);
    expect(reasons).not.toContain('thornfray_first');
    expect(reasons).not.toContain('last_standing');
    expect(reasons).not.toContain('best_score');
    expect(h.last(1, 'thornfray_result')?.place).toBe(1);
  });
});

describe('the seats over the bouts', () => {
  it('gives a rejoin the whole table, during a bout and during a Lull', () => {
    const h = thornfrayHarness();
    const a = h.connect(1, 'ash', 7);
    const b = h.connect(2, 'birch', 8);
    h.enter(a);
    h.enter(b);
    h.say(a, { t: 'thornfray_start' });
    h.land();
    // A dropped connection during the play: the bot plays the seat.
    h.close(a);
    const unit = h.sim().units.get(h.last(1, 'match_start')!.selfUnitId)!;
    expect(h.sim().policies.has(unit.id)).toBe(true);
    expect(h.last(2, 'player_left')).toMatchObject({ name: 'ash' });
    const back = h.connect(3, 'ash', 7);
    h.enter(back);
    expect(back.matchId).toBe(b.matchId);
    const during = h.last(3, 'match_start')!;
    expect(during.selfUnitId).toBe(unit.id);
    expect(during.royale?.tf).toMatchObject({ b: 0, s: 0 });
    expect(during.royale?.tf?.t).toHaveLength(BOUT_SEATS);
    expect(h.sim().policies.has(unit.id)).toBe(false);
    // Away across the bout's end: the next bout seats its bot, held.
    h.counts([0, 9]);
    h.close(back);
    h.nextBout();
    expect(h.fake.picks.at(-1)![0]!.bot).toBeDefined();
    expect(h.sim().royale.stage).toBe('drop');
    const again = h.connect(4, 'ash', 7);
    h.enter(again);
    const lull = h.last(4, 'match_start')!;
    expect(lull.royale?.tf).toMatchObject({ b: 1, s: 0, p: 1 });
    // The table best first: birch won the first bout.
    const rows = lull.royale!.tf!.t;
    expect(rows).toHaveLength(BOUT_SEATS);
    expect(rows[0]!.slice(0, 3)).toEqual([1, h.to(2, 'match_start').at(-1)!.selfUnitId, 'birch']);
    expect(rows[0]![5]).toBe(5);
    expect(rows[0]![6]).toBe(5);
    expect(rows[0]![7]).toBe(1);
    expect(again.matchId).toBe(b.matchId);
  });

  it('plays a leave by the seat bot until its person enters again', () => {
    const h = thornfrayHarness();
    const a = h.connect(1, 'ash');
    h.enter(a);
    h.say(a, { t: 'thornfray_start' });
    h.land();
    const unit = h.last(1, 'match_start')!.selfUnitId;
    h.say(a, { t: 'leave' });
    expect(a.matchId).toBeNull();
    expect(h.sim().policies.has(unit)).toBe(true);
    // Reported once, from the menu.
    expect(h.seats.map((s) => s.how)).toEqual(['menu']);
    h.nextBout();
    expect(h.fake.picks.at(-1)![0]).toMatchObject({ name: 'ash', bot: { softened: false } });
    // Entering again takes the seat back.
    h.enter(a);
    expect(a.matchId).not.toBeNull();
    expect(h.last(1, 'match_start')?.royale?.tf).toMatchObject({ b: 1, s: 0 });
  });

  it("never gives a held seat back on a socket's hello: only entering again does", () => {
    // Every flow's socket says hello on opening (the 5v5, the battle
    // royale, a spectate): taken back on it, the seat's bout went to a
    // client that never asked for a Thornfray.
    const h = thornfrayHarness();
    const a = h.connect(1, 'ash', 7);
    h.enter(a);
    h.say(a, { t: 'thornfray_start' });
    h.land();
    const unit = h.last(1, 'match_start')!.selfUnitId;
    h.close(a);
    const back = h.connect(2, 'ash', 7);
    expect(h.say(back, { t: 'hello' })).toBe(false);
    expect(back.matchId).toBeNull();
    expect(h.to(2, 'match_start')).toEqual([]);
    expect(h.sim().policies.has(unit)).toBe(true);
    h.enter(back);
    expect(back.matchId).not.toBeNull();
    expect(h.last(2, 'match_start')?.selfUnitId).toBe(unit);
    expect(h.sim().policies.has(unit)).toBe(false);
  });

  it('seats a late person on the fewest-bushels bot seat at the second Lull alone', () => {
    const h = thornfrayHarness();
    const a = h.connect(1, 'ash');
    h.enter(a);
    h.say(a, { t: 'thornfray_start' });
    // Seat 7 last with 0, seats 5 and 6 at 0 too: seat 5 is the lowest.
    h.counts([9, 8, 7, 6, 5, 3, 2, 1]);
    h.nextBout();
    h.step(40);
    const ticks = h.sim().tickCount;
    const c = h.connect(2, 'cedar');
    h.enter(c, 'maera');
    expect(c.matchId).toBe(a.matchId);
    const start = h.last(2, 'match_start')!;
    expect(start.royale?.tf).toMatchObject({ b: 1, s: 5 });
    // The Lull built again with cedar's champion, played to where it stood.
    expect(h.fake.picks.at(-1)![5]).toMatchObject({ name: 'cedar', championId: 'maera' });
    expect(h.fake.picks.at(-1)![5]!.bot).toBeUndefined();
    expect(h.sim().tickCount).toBe(ticks);
    expect(h.sim().units.get(start.selfUnitId)?.championId).toBe('maera');
    // Everyone in it hears the new table; its bushels kept (sixth: none).
    const table = h.last(1, 'match_start')!.royale!.tf!.t;
    const row = table.find((r) => r[0] === 5)!;
    expect(row.slice(2)).toEqual(['cedar', 'maera', 0, 0, 0, 0]);
    expect(h.last(1, 'player_joined')).toMatchObject({ name: 'cedar' });
    // Once the second bout plays, nobody new: a gathering opens instead.
    h.land();
    const d = h.connect(3, 'dew');
    h.enter(d);
    expect(d.matchId).toBeNull();
    expect(h.last(3, 'thornfray_gather')).toMatchObject({ people: 1 });
  });

  it('takes nobody late at the first or the third Lull', () => {
    const h = thornfrayHarness();
    const a = h.connect(1, 'ash');
    h.enter(a);
    h.say(a, { t: 'thornfray_start' });
    // The first Lull, from another gathering's view: a new one opens.
    const b = h.connect(2, 'birch');
    h.enter(b);
    expect(b.matchId).toBeNull();
    h.say(b, { t: 'leave' });
    h.nextBout();
    h.nextBout();
    const c = h.connect(3, 'cedar');
    h.enter(c);
    expect(c.matchId).toBeNull();
    expect(h.last(3, 'thornfray_gather')).toBeDefined();
  });

  it('reaps a Thornfray nobody came back to', () => {
    const h = thornfrayHarness();
    const a = h.connect(1, 'ash');
    h.enter(a);
    h.say(a, { t: 'thornfray_start' });
    h.close(a);
    expect(h.service.entries.size).toBe(1);
    h.advance(61_000);
    h.step(1);
    expect(h.service.entries.size).toBe(0);
  });
});
