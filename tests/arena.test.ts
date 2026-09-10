// The Arena (ADR 0013, plan-bots phase 6): rounds seat every deposited bot
// once by rating with balanced sides, one bot per account and no duplicate
// champion per team; play now draws the nearest ratings; a finished match
// moves the Arena ratings, saves its replay and is recorded; the runner
// serializes and bounds its queue; the daily allocation holds.

import { describe, expect, it } from 'vitest';
import {
  ARENA_MATCH_SIZE,
  arenaPicks,
  dueRound,
  planPlayNow,
  planRound,
  playNowAllowed,
} from '../server/arena';
import { ArenaRunner } from '../server/arena_runner';
import {
  type ArenaDeps,
  challenge,
  playNow,
  roundDue,
  runArenaMatch,
  runArenaRound,
} from '../server/arena_service';
import { type BotRow, BotStore } from '../server/bot_store';
import { BASE_RATING } from '../server/rating';
import type { MatchRecord } from '../server/records';
import { starOrchard } from '../server/star_orchard';
import { type FastMatchRequest, runFastMatch } from '../src/fast_match';
import { HOUSE_STYLE_IDS } from '../src/sim/content/bots/house';
import { NEW_BOT_PLAYBOOK } from '../src/sim/content/playbooks/new_bot';

const CHAMPS = [
  'korrath',
  'dain',
  'sylra',
  'fenn',
  'elowen',
  'vesk',
  'ashvyn',
  'maera',
  'torv',
  'rhoka',
];

function bot(n: number, accountId = n, championId = CHAMPS[n % CHAMPS.length]!): BotRow {
  return {
    id: `bot_${n.toString(16).padStart(16, '0')}`,
    accountId,
    name: `Bot ${n}`,
    championId,
    sigils: ['riftstep', 'mend'],
    skin: 0,
    playbook: NEW_BOT_PLAYBOOK,
    version: 1,
    deposited: true,
    autoApply: false,
    openPlaybook: false,
    createdAt: n,
    updatedAt: n,
  };
}

// Ratings are keyed by bot id now (ADR 0016); the tests still index them
// by the bot's number, so the helper maps one to the other.
const botId = (n: number): string => `bot_${n.toString(16).padStart(16, '0')}`;
const pool = (ratings: Record<number, number> = {}) => ({
  ratingOf: (id: string) => {
    const n = Object.keys(ratings).find((k) => botId(Number(k)) === id);
    return n === undefined ? BASE_RATING : (ratings[Number(n)] ?? BASE_RATING);
  },
  nameOf: (id: number) => (id === 99 ? null : `acc${id}`),
});

describe('planning a round', () => {
  it('seats ten bots by rating with snaked sides, the rest in a smaller match', () => {
    const bots = Array.from({ length: 12 }, (_, i) => bot(i + 1));
    const ratings: Record<number, number> = {};
    bots.forEach((b, i) => {
      ratings[b.accountId] = 1300 - i * 10;
    });
    const plans = planRound(bots, pool(ratings));
    expect(plans).toHaveLength(2);
    expect(plans[0]!.seats).toHaveLength(ARENA_MATCH_SIZE);
    expect(plans[0]!.seats.filter((s) => s.team === 0)).toHaveLength(5);
    expect(plans[0]!.seats.map((s) => s.team).slice(0, 4)).toEqual([0, 1, 1, 0]);
    expect(plans[0]!.seats[0]!.bot.name).toBe('Bot 1');
    expect(plans[1]!.seats.map((s) => s.bot.name)).toEqual(['Bot 11', 'Bot 12']);
    for (const plan of plans) {
      for (const team of [0, 1] as const) {
        const champs = plan.seats.filter((s) => s.team === team).map((s) => s.bot.championId);
        expect(new Set(champs).size).toBe(champs.length);
      }
    }
  });

  it('never seats two bots of one account together, nor two of one champion on a side', () => {
    const bots = [bot(1, 1, 'vesk'), bot(2, 1, 'korrath'), bot(3, 3, 'vesk'), bot(4, 4, 'vesk')];
    const plans = planRound(bots, pool());
    // Account 1's second bot waits for the next match; three Vesks split
    // two sides and one match more.
    expect(plans.map((p) => p.seats.map((s) => s.bot.name))).toEqual([
      ['Bot 1', 'Bot 3'],
      ['Bot 2', 'Bot 4'],
    ]);
    const first = plans[0]!.seats;
    expect(first.find((s) => s.bot.name === 'Bot 1')!.team).not.toBe(
      first.find((s) => s.bot.name === 'Bot 3')!.team,
    );
    const second = plans[1]!.seats;
    expect(second.find((s) => s.bot.name === 'Bot 2')!.team).not.toBe(
      second.find((s) => s.bot.name === 'Bot 4')!.team,
    );
  });

  it('skips a bot whose account vanished, and an empty pool plans nothing', () => {
    expect(planRound([bot(99, 99)], pool())).toEqual([]);
    expect(planRound([], pool())).toEqual([]);
  });
});

describe('play now', () => {
  it('seats the asking bot first on team 0 among the nearest ratings, never its own account', () => {
    const me = bot(1, 1, 'vesk');
    const others = [bot(2, 1, 'dain'), bot(3, 3, 'sylra'), bot(4, 4, 'fenn'), bot(5, 5, 'elowen')];
    const plan = planPlayNow(me, others, pool({ 1: 1000, 3: 1400, 4: 1010, 5: 990 }))!;
    expect(plan.seats[0]).toMatchObject({ team: 0, bot: { name: 'Bot 1' } });
    expect(plan.seats.map((s) => s.bot.name)).toEqual(['Bot 1', 'Bot 4', 'Bot 5', 'Bot 3']);
    expect(planPlayNow(bot(99, 99), others, pool())).toBeNull();
  });

  it('fills every other seat with house bots and embeds the playbooks', () => {
    const plan = planPlayNow(bot(1, 1, 'vesk'), [bot(3, 3, 'vesk')], pool())!;
    const picks = arenaPicks(plan);
    expect(picks).toHaveLength(10);
    expect(picks[0]).toMatchObject({ name: 'acc1 (Bot 1)', team: 0, playbook: NEW_BOT_PLAYBOOK });
    expect(picks[1]).toMatchObject({ name: 'acc3 (Bot 3)', team: 1 });
    expect(
      picks.slice(2).every((p) => p.bot !== undefined && HOUSE_STYLE_IDS.includes(p.bot)),
    ).toBe(true);
    for (const team of [0, 1] as const) {
      const champs = picks.filter((p) => p.team === team).map((p) => p.championId);
      expect(new Set(champs).size).toBe(5);
    }
  });

  it('counts the daily allocation', () => {
    expect(playNowAllowed(0, 2)).toBe(true);
    expect(playNowAllowed(2, 2)).toBe(false);
    expect(playNowAllowed(500, 0)).toBe(true);
    expect(dueRound(null, 10)).toBe(true);
    expect(dueRound(0, 10, 100)).toBe(false);
    expect(dueRound(0, 100, 100)).toBe(true);
  });
});

// A canned runner: a real short match whose winner is forced, so the
// rating and recording path runs in milliseconds.
function cannedRunner(winner: 0 | 1) {
  return {
    requests: [] as FastMatchRequest[],
    async run(req: FastMatchRequest) {
      this.requests.push(req);
      const r = runFastMatch(starOrchard(), { ...req, maxTicks: 40 });
      return { ...r, winner };
    },
  };
}

function rig(runner: ArenaDeps['runner'], playNowPerDay = 20) {
  const store = new BotStore(':memory:');
  const replays: number[] = [];
  const records: MatchRecord[] = [];
  let next = 500;
  let clock = 1_000_000;
  const deps: ArenaDeps = {
    store,
    runner,
    nameOf: (id) => `acc${id}`,
    nextMatchId: () => next++,
    saveReplay: (id) => {
      replays.push(id);
    },
    recordMatch: (rec) => {
      records.push(rec);
    },
    now: () => (clock += 1000),
    roundMs: 60_000,
    playNowPerDay,
  };
  return { deps, store, replays, records };
}

describe('running the Arena', () => {
  it('rates the bot seats on the Arena way, saves the replay, records the match', async () => {
    const runner = cannedRunner(1);
    const { deps, store, replays, records } = rig(runner);
    for (const b of [bot(1, 1, 'vesk'), bot(2, 2, 'dain')]) store.insertBot(b);
    const round = await runArenaRound(deps);
    expect(round.matches).toBe(1);
    expect(runner.requests[0]!.picks).toHaveLength(10);
    expect(store.botRating(botId(1), 'arena').rating).toBeLessThan(BASE_RATING);
    expect(store.botRating(botId(2), 'arena').rating).toBeGreaterThan(BASE_RATING);
    expect(store.botRating(botId(1), 'live')).toEqual({ rating: BASE_RATING, games: 0 });
    expect(replays).toEqual([500]);
    expect(records).toHaveLength(1);
    const rec = records[0]!;
    expect(rec).toMatchObject({ queue: 'arena', rated: true, winner: 1, replayId: 500 });
    const mine = rec.players.find((p) => p.accountId === 1)!;
    expect(mine).toMatchObject({ name: 'acc1 (Bot 1)', way: 'bot', championId: 'vesk' });
    expect(mine.ratingDelta).toBeLessThan(0);
    expect(rec.players.filter((p) => p.accountId === null)).toHaveLength(8);
    // The round is stamped, so it is not due again before its hour.
    expect(roundDue(deps)).toBe(false);
  });

  it('records nothing for a draw, and a lone bot plays house bots unrated', async () => {
    const draw = {
      run: async (req: FastMatchRequest) => ({
        ...runFastMatch(starOrchard(), { ...req, maxTicks: 40 }),
        winner: null,
      }),
    };
    const { deps, store, records } = rig(draw);
    store.insertBot(bot(1, 1, 'vesk'));
    const plan = planPlayNow(bot(1, 1, 'vesk'), [], {
      ratingOf: () => 1000,
      nameOf: () => 'a',
    })!;
    const out = await runArenaMatch(deps, plan);
    expect(out.rated).toBe(false);
    expect(records).toHaveLength(0);

    const lone = rig(cannedRunner(0));
    lone.store.insertBot(bot(1, 1, 'vesk'));
    const solo = await runArenaMatch(lone.deps, plan);
    // One owned side only: a match nobody else owned a seat in is not rated.
    expect(solo.rated).toBe(false);
    expect(lone.store.botRating(botId(1), 'arena').rating).toBe(BASE_RATING);
  });

  it('play now spends the daily allocation and answers with the seat outcome', async () => {
    const { deps, store } = rig(cannedRunner(0), 1);
    store.insertBot(bot(1, 1, 'vesk'));
    store.insertBot(bot(2, 2, 'dain'));
    const first = await playNow(deps, 1, 'bot_0000000000000001');
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.myTeam).toBe(0);
      expect(first.rated).toBe(true);
      expect(first.seats.find((s) => s.accountId === 1)!.delta).toBeGreaterThan(0);
      expect(first.replayId).toBe(500);
    }
    const second = await playNow(deps, 1, 'bot_0000000000000001');
    expect(!second.ok && second.error).toMatch(/daily limit/);
    expect((await playNow(deps, 2, 'bot_0000000000000001')).ok).toBe(false);
    expect((await playNow(deps, 1, 42)).ok).toBe(false);
  });
});

describe('the runner', () => {
  it('runs inline without a worker file, one match after another, with a bounded queue', async () => {
    const runner = new ArenaRunner(null, 2);
    const req = (seed: number): FastMatchRequest => ({
      seed,
      picks: arenaPicks(
        planPlayNow(bot(1, 1, 'vesk'), [], { ratingOf: () => 1000, nameOf: () => 'a' })!,
      ),
      maxTicks: 20,
    });
    const a = runner.run(req(1));
    const b = runner.run(req(2));
    await expect(runner.run(req(3))).rejects.toThrow(/busy/);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.ticks).toBe(20);
    expect(rb.record.seed).toBe(2);
    expect(runner.queued).toBe(0);
    // Free again once the queue drained.
    expect((await runner.run(req(4))).record.seed).toBe(4);
  });
});

describe('a challenge', () => {
  it('plays the chosen ranked bot now, unrated, on both Records, from the allowance', async () => {
    const runner = cannedRunner(0);
    const { deps, store, replays } = rig(runner, 2);
    const mine = bot(1, 1, 'vesk');
    const theirs = bot(2, 2, 'dain');
    const unranked = { ...bot(3, 3, 'sylra'), deposited: false };
    for (const b of [mine, theirs, unranked]) store.insertBot(b);
    const out = await challenge(deps, 1, mine.id, theirs.id);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out).toMatchObject({ winner: 0, rated: false, myTeam: 0 });
    expect(out.seats.map((s) => s.delta)).toEqual([0, 0]);
    expect(store.botRating(botId(1), 'arena')).toEqual({ rating: BASE_RATING, games: 0 });
    expect(store.botRating(botId(2), 'arena')).toEqual({ rating: BASE_RATING, games: 0 });
    expect(replays).toHaveLength(1);
    // The picks: mine on team 0, theirs on team 1, house bots around.
    const picks = runner.requests[0]!.picks;
    expect(picks[0]).toMatchObject({ team: 0, championId: 'vesk' });
    expect(picks[1]).toMatchObject({ team: 1, championId: 'dain' });
    expect(picks.filter((p) => p.bot !== undefined)).toHaveLength(8);
    // Both Records got the match, kind arena, no rating movement.
    for (const id of [mine.id, theirs.id]) {
      const rows = store.listRecords(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.entry).toMatchObject({ kind: 'arena', replayId: 500 });
      expect((rows[0]!.entry as { ratingDelta?: number }).ratingDelta).toBeUndefined();
    }
    // Refusals: not ranked, own bot, someone else's bot as mine, the allowance.
    expect((await challenge(deps, 1, mine.id, unranked.id)).ok).toBe(false);
    expect((await challenge(deps, 1, mine.id, mine.id)).ok).toBe(false);
    expect((await challenge(deps, 2, mine.id, theirs.id)).ok).toBe(false);
    expect((await challenge(deps, 1, mine.id, theirs.id)).ok).toBe(true);
    const third = await challenge(deps, 1, mine.id, theirs.id);
    expect(!third.ok && third.error).toMatch(/daily limit/);
  });
});
