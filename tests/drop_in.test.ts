// Dropping in (server/drop_in.ts, Match.takeBotSeat, ADR 0025): which live
// match a newcomer joins, on which side, which bot hands its seat over, and
// what the landing is told is going on.

import { describe, expect, it } from 'vitest';
import { fillWithBots } from '../server/bot_fill';
import type { BotRow } from '../server/bot_store';
import {
  chooseDropIn,
  DROP_IN_WINDOW_S,
  type DropInCandidate,
  dropInTeam,
  presenceOf,
} from '../server/drop_in';
import { Match, type MatchPick } from '../server/match';
import { LANER_PLAYBOOK } from '../src/sim/content/playbooks/laner';

const live = (over: Partial<DropInCandidate>): DropInCandidate => ({
  matchId: 1,
  time: 60,
  humans: 1,
  openSeats: 9,
  joinable: true,
  ...over,
});

describe('choosing a match to drop into', () => {
  it('takes a public match with people in it, early enough, with a bot seat left', () => {
    expect(chooseDropIn([live({})])).toBe(1);
    expect(chooseDropIn([live({ humans: 0 })])).toBeNull();
    expect(chooseDropIn([live({ openSeats: 0 })])).toBeNull();
    expect(chooseDropIn([live({ joinable: false })])).toBeNull();
    expect(chooseDropIn([live({ time: DROP_IN_WINDOW_S })])).toBeNull();
    expect(chooseDropIn([])).toBeNull();
  });

  it('prefers the most people, then the youngest match', () => {
    const cands = [
      live({ matchId: 1, humans: 1, time: 30 }),
      live({ matchId: 2, humans: 2, time: 200 }),
      live({ matchId: 3, humans: 2, time: 100 }),
    ];
    expect(chooseDropIn(cands)).toBe(3);
  });
});

describe('the side a newcomer joins', () => {
  it('is the side with fewer people, so strangers meet as opponents', () => {
    expect(dropInTeam([1, 0], [4, 5])).toBe(1);
    expect(dropInTeam([0, 1], [5, 4])).toBe(0);
  });

  it('falls back to the side with seats left, and null when there are none', () => {
    expect(dropInTeam([0, 1], [0, 3])).toBe(1);
    expect(dropInTeam([1, 1], [2, 3])).toBe(1);
    expect(dropInTeam([1, 1], [0, 0])).toBeNull();
  });
});

describe('presence', () => {
  it('counts the people in public matches and says whether one is joinable', () => {
    const p = presenceOf(
      [
        live({ matchId: 1, humans: 2 }),
        live({ matchId: 2, humans: 1, time: DROP_IN_WINDOW_S + 1 }),
        live({ matchId: 3, humans: 4, joinable: false }),
      ],
      1,
    );
    expect(p).toEqual({ playing: 3, queued: 1, joinable: true });
    expect(presenceOf([live({ time: DROP_IN_WINDOW_S + 1 })], 0).joinable).toBe(false);
  });
});

const HUMAN: MatchPick = {
  clientId: 1,
  name: 'alice',
  team: 0,
  championId: 'vesk',
  sigils: ['riftstep', 'mend'],
};

function rankedBot(id: string, accountId: number, championId: string): BotRow {
  return {
    id,
    accountId,
    name: `Bot ${id}`,
    championId,
    sigils: ['riftstep', 'sear'],
    skin: 1,
    playbook: LANER_PLAYBOOK,
    version: 3,
    deposited: true,
    autoApply: false,
    openPlaybook: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('taking a bot seat in a live match', () => {
  it('hands a newcomer a house bot on the other side, as the bot left it', () => {
    const match = new Match(7, fillWithBots([HUMAN], 7, 5));
    expect(match.openBotSeats).toBe(9);
    for (let i = 0; i < 40; i++) match.tick();
    const seat = match.takeBotSeat(2, 'Wanderer 0042');
    expect(seat).not.toBeNull();
    if (!seat) return;
    expect(seat.team).toBe(1);
    expect(seat.pool).toBe(false);
    // The newcomer drives it now: no policy, a player row, a snapshot.
    expect(match.sim.policies.has(seat.unitId)).toBe(false);
    expect(match.players.get(2)?.unitId).toBe(seat.unitId);
    match.tick();
    expect(match.buildSnapshotFor(2)).not.toBeNull();
    const score = match.buildScore() as { t: 'score'; rows: { player: string | null }[] };
    expect(score.rows.some((r) => r.player === 'Wanderer 0042')).toBe(true);
    expect(match.openBotSeats).toBe(8);
    // A third person goes to the side that now has fewer people: even, so
    // the side with more seats left, which is alice's.
    const third = match.takeBotSeat(3, 'bob');
    expect(third?.team).toBe(0);
  });

  it('takes a house bot before a ranked one, and a ranked one when that is all', () => {
    const pool = [
      { bot: rankedBot('a', 10, 'korrath'), owner: 'ann' },
      { bot: rankedBot('c', 11, 'sylra'), owner: 'cid' },
      { bot: rankedBot('d', 12, 'dain'), owner: 'dee' },
      { bot: rankedBot('e', 13, 'fenn'), owner: 'eve' },
      { bot: rankedBot('f', 14, 'torv'), owner: 'fay' },
    ];
    const match = new Match(3, fillWithBots([HUMAN], 3, 5, pool));
    const kinds: boolean[] = [];
    for (let id = 2; ; id++) {
      const seat = match.takeBotSeat(id, `p${id}`);
      if (!seat) break;
      kinds.push(seat.pool);
    }
    expect(kinds).toHaveLength(9);
    // On each side every house bot goes before the first ranked one.
    expect(kinds).toContain(true);
    expect(match.openBotSeats).toBe(0);
    expect(match.takeBotSeat(99, 'late')).toBeNull();
  });

  it('never hands out a seat held for a dropped player', () => {
    const match = new Match(5, fillWithBots([HUMAN], 5, 5));
    const held = match.handleDisconnect(1);
    expect(held).not.toBeNull();
    for (let id = 2; id < 20; id++) {
      const seat = match.takeBotSeat(id, `p${id}`);
      if (!seat) break;
      expect(seat.unitId).not.toBe(held?.unitId);
    }
  });
});

// A newcomer inherits the seat's assigned lane (ADR 0026) and is told it
// by the self block of every snapshot, the forest's seat included.
describe('the lane a newcomer drops into', () => {
  it("reads the house seat's lane, and null on the Jungler's seat", () => {
    const picks = fillWithBots([HUMAN], 7, 5);
    const match = new Match(7, picks);
    for (let i = 0; i < 20; i++) match.tick();
    const seen: (string | null)[] = [];
    for (let id = 2; ; id++) {
      const seat = match.takeBotSeat(id, `p${id}`);
      if (!seat) break;
      match.tick();
      const snap = match.buildSnapshotFor(id);
      if (snap?.t !== 'snap') throw new Error('no snapshot');
      const unit = match.sim.units.get(seat.unitId);
      expect(snap.self?.lane).toBe(unit?.lane);
      // The house Jungler's seat is the forest's: no lane to hold.
      const pick = picks.find((_, i) => match.unitIdOfPick(i) === seat.unitId);
      if (pick?.bot === 'jungler') expect(snap.self?.lane).toBeNull();
      else expect(snap.self?.lane).toBe(pick?.lanes?.[0]);
      seen.push(snap.self?.lane ?? null);
    }
    expect(seen).toHaveLength(9);
    expect(seen.filter((l) => l === null)).toHaveLength(2);
  });
});
