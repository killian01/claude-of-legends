// The battle royale's ranking and result (server/royale_ranking.ts), and a
// drop-in's standing since they landed (windowStanding, the result's
// window and near miss, server/royale_match.ts resultFor).

import { describe, expect, it } from 'vitest';
import { RoyaleMatch } from '../server/royale_match';
import {
  NEAR_MISS_BY,
  placeOf,
  type RankedSeat,
  royaleRanking,
  royaleResult,
  windowStanding,
} from '../server/royale_ranking';
import type { RoyalePerson } from '../server/royale_seats';
import { DROP_S, PLAY_S } from '../src/sim/royale/types';
import { fakeFactory } from './royale_fake';

const seats: RankedSeat[] = [1, 2, 3, 4, 5].map((id) => ({
  unitId: id,
  name: `s${id}`,
  championId: 'fenn',
  bot: id !== 1,
  deaths: id === 3 ? 4 : 1,
}));

describe('One life', () => {
  const state = {
    variant: 'one_life' as const,
    stage: 'play' as const,
    scores: new Map([[2, 3]]),
    eliminated: [4, 5],
    winnerId: null,
  };

  it('ranks the standing first, then the fallen, the last to fall first', () => {
    expect(royaleRanking(state, seats)).toEqual([2, 1, 3, 5, 4]);
  });

  it('knows a place the moment a champion is out, and the winner first', () => {
    expect(placeOf(state, 5, 4)).toBe(5);
    expect(placeOf(state, 5, 5)).toBe(4);
    expect(placeOf(state, 5, 1)).toBeNull();
    expect(placeOf({ ...state, winnerId: 2 }, 5, 2)).toBe(1);
  });

  it('tells the fallen their place and the top', () => {
    const r = royaleResult(state, seats, 4);
    expect(r).toMatchObject({ t: 'royale_result', v: 'one_life', place: 5, of: 5, score: 0 });
    expect(r.winner).toBeNull();
    expect(r.top.map((t) => t.name)).toEqual(['s2', 's1', 's3', 's5', 's4']);
    expect(r.top[1]).toEqual({ name: 's1', championId: 'fenn', score: 0, bot: false });
  });
});

describe('Respawn', () => {
  const state = {
    variant: 'respawn' as const,
    stage: 'over' as const,
    scores: new Map([
      [1, 4],
      [2, 6],
      [3, 4],
    ]),
    eliminated: [],
    winnerId: 2,
  };

  it('ranks by score, fewer deaths first on a tie, the winner on top', () => {
    expect(royaleRanking(state, seats)).toEqual([2, 1, 3, 4, 5]);
  });

  it('tells the place at the end and names the winner', () => {
    const r = royaleResult(state, seats, 3);
    expect(r).toMatchObject({ v: 'respawn', place: 3, of: 5, score: 4, winner: 's2' });
  });
});

describe('the standing since a drop-in landed', () => {
  // Since the landing: 1 scored 6, 2 scored 2, 3 scored 5, 4 and 5 scored
  // 3 each, 6 nothing.
  const scores = new Map([
    [1, 10],
    [2, 8],
    [3, 5],
    [4, 5],
    [5, 3],
    [6, 0],
  ]);
  const base = new Map([
    [1, 4],
    [2, 6],
    [4, 2],
  ]);
  const ids = [1, 2, 3, 4, 5, 6];

  it('ranks on the takedowns since then, a tie sharing its rank', () => {
    const rank = (id: number) => windowStanding(scores, base, ids, id).rank;
    expect(ids.map(rank)).toEqual([1, 5, 2, 3, 3, 6]);
    expect(windowStanding(scores, base, ids, 4)).toMatchObject({ of: 6, score: 3 });
  });

  it('tells the gap to the next better score and the seat holding it', () => {
    expect(windowStanding(scores, base, ids, 4)).toMatchObject({ gap: 2, aboveId: 3 });
    expect(windowStanding(scores, base, ids, 3)).toMatchObject({ gap: 1, aboveId: 1 });
    // The next better score is 3, held by 4 and 5: the lowest id.
    expect(windowStanding(scores, base, ids, 2)).toMatchObject({ gap: 1, aboveId: 4 });
  });

  it('tells the first its lead, and a tie for the lead as none', () => {
    expect(windowStanding(scores, base, ids, 1)).toMatchObject({ rank: 1, gap: 1, aboveId: null });
    const tied = new Map([
      [1, 3],
      [2, 3],
    ]);
    expect(windowStanding(tied, new Map(), [1, 2], 2)).toEqual({
      rank: 1,
      of: 2,
      score: 3,
      gap: 0,
      aboveId: null,
    });
  });

  it('counts a seat under its base (a newcomer came down on it) from zero, never below', () => {
    const fresh = new Map([
      [1, 0],
      [2, 1],
    ]);
    const was = new Map([[1, 9]]);
    expect(windowStanding(fresh, was, [1, 2], 1)).toMatchObject({ score: 0, rank: 2 });
    expect(windowStanding(fresh, was, [1, 2], 2)).toMatchObject({ score: 1, rank: 1, gap: 1 });
  });
});

describe('the Respawn result: the window and the near miss', () => {
  const six: RankedSeat[] = [1, 2, 3, 4, 5, 6].map((id) => ({
    unitId: id,
    name: `s${id}`,
    championId: 'fenn',
    bot: true,
    deaths: 1,
  }));
  const state = {
    variant: 'respawn' as const,
    stage: 'over' as const,
    scores: new Map([
      [1, 10],
      [2, 8],
      [3, 5],
      [4, 5],
      [5, 3],
      [6, 0],
    ]),
    eliminated: [],
    winnerId: 1,
  };
  const base = new Map([
    [1, 4],
    [2, 6],
    [4, 2],
  ]);

  it('fills the window for a drop-in, and the near miss in it', () => {
    const r = royaleResult(state, six, 4, base);
    expect(r.window).toEqual({ rank: 3, of: 6, score: 3 });
    expect(r.gap).toEqual({ name: 's3', by: 2 });
    // The whole match's place is untouched.
    expect(r.place).toBe(royaleResult(state, six, 4).place);
    expect(r.place).toBe(4);
    expect(r.score).toBe(5);
  });

  it('fills no window for a seat from the drop, its near miss in the whole match', () => {
    expect(royaleResult(state, six, 5).window).toBeUndefined();
    expect(royaleResult(state, six, 5).gap).toEqual({ name: 's4', by: 2 });
    expect(royaleResult(state, six, 2).gap).toEqual({ name: 's1', by: 2 });
    // Level with the seat above on takedowns, behind it on the id: no
    // takedown short. Past NEAR_MISS_BY, no near miss.
    expect(royaleResult(state, six, 4).gap).toBeUndefined();
    expect(NEAR_MISS_BY).toBe(2);
    expect(royaleResult(state, six, 6).gap).toBeUndefined();
    // The first has nobody above.
    expect(royaleResult(state, six, 1).gap).toBeUndefined();
  });

  it('leaves One life without either', () => {
    const one = { ...state, variant: 'one_life' as const, eliminated: [6, 5, 4, 3, 2] };
    const r = royaleResult(one, six, 3, base);
    expect(r.window).toBeUndefined();
    expect(r.gap).toBeUndefined();
  });
});

describe('a drop-in in a Respawn match', () => {
  function person(clientId: number, championId = 'fenn'): RoyalePerson {
    return {
      clientId,
      owner: clientId,
      name: `p${clientId}`,
      guest: true,
      pick: { championId, sigils: ['zephyr', 'sear'], skin: 0 },
    };
  }

  function started(variant: 'respawn' | 'one_life' = 'respawn') {
    const fake = fakeFactory();
    const match = new RoyaleMatch(1, 3, variant, [person(1)], fake.factory, 6);
    const sim = fake.sims[0]!;
    while (match.stage === 'drop') match.tick();
    return { match, sim, self: match.players.get(1)!.unitId };
  }

  it('keeps the window from the landing, with every score then', () => {
    const { match, sim, self } = started();
    const bots = [...sim.units.values()].filter((u) => u.id !== self);
    for (const [i, u] of bots.entries()) sim.royale.scores.set(u.id, i + 1);
    const before = new Map(sim.royale.scores);
    const p = match.takeBotSeat(person(2))!;
    expect(p.window?.from).toBe(sim.time);
    expect(p.window?.base).toEqual(before);
    // The seat from the drop counts the whole match.
    expect(match.players.get(1)!.window).toBeNull();
  });

  it('has none for a seat taken during the drop, in One life, or on a rejoin', () => {
    const fake = fakeFactory();
    const match = new RoyaleMatch(1, 3, 'respawn', [person(1)], fake.factory, 6);
    expect(match.takeBotSeat(person(2))!.window).toBeNull();
    expect(started('one_life').match.takeBotSeat(person(2))!.window).toBeNull();
    const { match: live } = started();
    const p = live.takeBotSeat(person(2))!;
    live.leave(2, true);
    expect(live.rejoin(person(2), p.unitId)!.window).toBeNull();
  });

  it('counts a seat another newcomer comes down on from that Arrival', () => {
    const { match, sim, self } = started();
    const first = match.takeBotSeat(person(2))!;
    const next = [...sim.units.values()].find((u) => u.id !== first.unitId && u.id !== self)!;
    sim.royale.scores.set(next.id, 9);
    const third = match.takeBotSeat(person(3, next.championId!))!;
    expect(third.unitId).toBe(next.id);
    expect(first.window?.base.get(next.id)).toBe(sim.royale.scores.get(next.id));
  });

  it('tells the drop-in its window, its near miss and how long it held at the end', () => {
    const { match, sim, self } = started();
    const bots = [...sim.units.values()].filter((u) => u.id !== self);
    for (const u of bots) sim.royale.scores.set(u.id, 20);
    const p = match.takeBotSeat(person(2))!;
    const landed = sim.time;
    // Since the landing: the drop-in 3, one bot 4, the rest nothing. The
    // fake's Arrival keeps the bot's tally; the window counts from it.
    sim.royale.scores.set(p.unitId, 23);
    const rival = bots.find((u) => u.id !== p.unitId)!;
    sim.royale.scores.set(rival.id, 24);
    while (sim.time < landed + 61) match.tick();
    sim.finish(rival.id);
    match.tick();
    const r = match.resultFor(2)!;
    expect(r.window).toEqual({ rank: 2, of: 6, score: 3 });
    expect(r.gap?.by).toBe(1);
    expect(r.held).toBe(Math.round(sim.time - landed));
    // The person who started it: the whole match, held from the drop's end.
    const mine = match.resultFor(1)!;
    expect(mine.window).toBeUndefined();
    expect(mine.held).toBe(Math.round(sim.time - DROP_S));
    expect(sim.time).toBeLessThan(DROP_S + PLAY_S);
  });

  it('adds nothing to a One life result', () => {
    const { match, sim, self } = started('one_life');
    match.takeBotSeat(person(2));
    sim.finish(self);
    match.tick();
    const r = match.resultFor(2)!;
    expect(r.window).toBeUndefined();
    expect(r.gap).toBeUndefined();
    expect(r.held).toBeUndefined();
  });
});
