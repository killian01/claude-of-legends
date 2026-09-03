// The night coach, the sparring gate and the Briefing (ADR 0013, plan-bots
// phase 7): the record and the plays feed one model call per bot per
// night; a proposal applies only if it wins the sparring, and only on its
// own with the owner's opt-in; the Briefing carries it all.

import { describe, expect, it } from 'vitest';
import { type BotRow, BotStore } from '../server/bot_store';
import {
  answerProposal,
  botMatchesSince,
  briefingPrompt,
  buildBriefing,
  coachBotOvernight,
  type NightCoachDeps,
  nightDue,
  sparringGate,
  sumPlays,
} from '../server/night_coach';
import type { CoachAnswer } from '../server/playbook_suggest';
import { BASE_RATING } from '../server/rating';
import type { MatchRecord } from '../server/records';
import { type FastMatchRequest, runFastMatch } from '../src/fast_match';
import type { ReplayPick } from '../src/net/replay';
import { NEW_BOT_PLAYBOOK } from '../src/sim/content/playbooks/new_bot';
import type { PatchOp } from '../src/sim/playbook/patch';
import type { PlaybookDef } from '../src/sim/playbook/types';

const BOT: BotRow = {
  id: 'bot_00000000000000aa',
  accountId: 1,
  name: 'Nightfall',
  championId: 'vesk',
  sigils: ['riftstep', 'mend'],
  skin: 0,
  playbook: NEW_BOT_PLAYBOOK,
  version: 1,
  deposited: true,
  autoApply: false,
    openPlaybook: false,
  createdAt: 0,
  updatedAt: 0,
};

const CHAMPS = ['dain', 'sylra', 'fenn', 'elowen', 'korrath', 'ashvyn', 'maera', 'torv', 'rhoka'];
const PICKS: ReplayPick[] = [
  {
    name: 'acc1 (Nightfall)',
    team: 0,
    championId: 'vesk',
    sigils: ['riftstep', 'mend'],
    playbook: NEW_BOT_PLAYBOOK,
  },
  ...CHAMPS.map(
    (c, i): ReplayPick => ({
      name: `${c} (bot)`,
      team: i < 4 ? 0 : 1,
      championId: c,
      sigils: ['riftstep', 'mend'],
      bot: 'laner',
    }),
  ),
];

function record(at: number, win: boolean, delta: number, replayId?: number): MatchRecord {
  return {
    at,
    durationS: 900,
    winner: win ? 0 : 1,
    rated: true,
    queue: 'arena',
    ...(replayId !== undefined ? { replayId } : {}),
    players: [
      {
        accountId: 1,
        name: 'acc1 (Nightfall)',
        championId: 'vesk',
        team: 0,
        level: 12,
        kills: 3,
        deaths: 2,
        assists: 1,
        cs: 80,
        ratingDelta: delta,
        way: 'bot',
      },
      {
        accountId: null,
        name: 'dain (bot)',
        championId: 'dain',
        team: 1,
        level: 12,
        kills: 2,
        deaths: 3,
        assists: 0,
        cs: 70,
      },
    ],
  };
}

// The gate's runner: the seat wins when its playbook carries the marker
// play, so a candidate with it beats a current without it.
function markedRunner(marker: string) {
  return {
    calls: 0,
    async run(req: FastMatchRequest) {
      this.calls += 1;
      const r = runFastMatch({ ...req, maxTicks: 20 });
      const seat = req.picks.find((p) => p.playbook);
      const wins = seat?.playbook?.plays.some((p) => p.id === marker) ?? false;
      return { ...r, winner: (wins ? 0 : 1) as 0 | 1 };
    },
  };
}

const MARKED: PlaybookDef = {
  version: 1,
  plays: [
    { id: 'careful', when: { kind: 'hp', below: 0.5 }, do: { kind: 'retreat' } },
    ...NEW_BOT_PLAYBOOK.plays,
  ],
};
const OPS: PatchOp[] = [
  {
    op: 'add',
    play: { id: 'careful', when: { kind: 'hp', below: 0.5 }, do: { kind: 'retreat' } },
    before: 'retreat',
  },
];

function rig(
  opts: { coachOps?: PatchOp[] | null; autoApply?: boolean; records?: MatchRecord[] } = {},
) {
  const store = new BotStore(':memory:');
  store.insertBot({ ...BOT, autoApply: opts.autoApply ?? false });
  const records = opts.records ?? [record(5_000, true, 12, 41), record(6_000, false, -9, 42)];
  let clock = 10_000;
  const runner = markedRunner('careful');
  const coachCalls: string[] = [];
  const deps: NightCoachDeps = {
    store,
    runner,
    coach:
      opts.coachOps === null
        ? null
        : async (_a, _b, message) => {
            coachCalls.push(message);
            const answer: CoachAnswer = {
              comment: 'Plus prudent.',
              ops: opts.coachOps ?? OPS,
              refused: [],
              playbook: NEW_BOT_PLAYBOOK,
              raw: '# Plus prudent.',
            };
            return { ok: true, ...answer };
          },
    records: () => records,
    now: () => (clock += 100),
    sparringPerSide: 2,
    maxTicks: 20,
  };
  const reportFor = (matchId: number, at: number) => {
    const r = runFastMatch({ seed: matchId, picks: PICKS, maxTicks: 20 });
    store.addBotReport({
      matchId,
      botId: BOT.id,
      seatIndex: 0,
      unitId: r.unitIds[0]!,
      picks: PICKS,
      report: r.report,
      at,
    });
  };
  return { deps, store, runner, coachCalls, reportFor };
}

describe('the report the coach reads', () => {
  it('collects the bot’s Arena matches since a moment, and sums its plays', () => {
    const records = [record(1, true, 5), record(50, false, -3, 9), record(70, true, 4)];
    const matches = botMatchesSince(records, 1, 40);
    expect(matches.map((m) => [m.at, m.win, m.delta, m.replayId])).toEqual([
      [50, false, -3, 9],
      [70, true, 4, undefined],
    ]);
    expect(botMatchesSince(records, 2, 0)).toEqual([]);
    const r = runFastMatch({ seed: 1, picks: PICKS, maxTicks: 40 });
    const unitId = r.unitIds[0]!;
    const plays = sumPlays([
      { report: r.report, unitId },
      { report: r.report, unitId },
    ]);
    const single = r.report.units.find((u) => u.unitId === unitId)!.plays;
    for (const [id, s] of Object.entries(single))
      expect(plays[id]).toEqual({ ticks: s.ticks * 2, deaths: s.deaths * 2 });
    const prompt = briefingPrompt(BOT, matches, plays);
    expect(prompt).toMatch(/1 won, 1 lost/);
    expect(prompt).toMatch(/Arena rating \+1/);
  });

  it('is due once a day', () => {
    expect(nightDue(null, 5)).toBe(true);
    expect(nightDue(0, 1000, 5000)).toBe(false);
    expect(nightDue(0, 5000, 5000)).toBe(true);
  });
});

describe('the sparring gate', () => {
  it('plays the same opponents with both playbooks and counts the seat’s wins', async () => {
    const { deps, runner } = rig();
    const gate = await sparringGate(deps, 0, PICKS, NEW_BOT_PLAYBOOK, MARKED, 7);
    expect(gate).toEqual({ currentWins: 0, candidateWins: 2, matches: 4 });
    expect(runner.calls).toBe(4);
  });
});

describe('a bot’s night', () => {
  it('stores a passing proposal for the owner, who applies it as a version', async () => {
    const { deps, store, coachCalls, reportFor } = rig();
    reportFor(41, 5_000);
    reportFor(42, 6_000);
    const line = await coachBotOvernight(deps, store.getBot(BOT.id)!);
    expect(line).toMatch(/won the sparring, awaiting the owner/);
    expect(coachCalls).toHaveLength(1);
    expect(coachCalls[0]).toMatch(/1 won, 1 lost/);
    const proposal = store.pendingProposal(BOT.id)!;
    expect(proposal).toMatchObject({
      comment: 'Plus prudent.',
      currentWins: 0,
      candidateWins: 2,
      matches: 4,
      status: 'pending',
    });
    expect(store.getBot(BOT.id)?.version).toBe(1);

    const briefing = buildBriefing(deps, store.getBot(BOT.id)!);
    expect(briefing.wins).toBe(1);
    expect(briefing.losses).toBe(1);
    expect(briefing.ratingDelta).toBe(3);
    expect(briefing.proposal?.id).toBe(proposal.id);
    expect(Object.keys(briefing.plays).length).toBeGreaterThan(0);

    const applied = answerProposal(deps, store.getBot(BOT.id)!, proposal.id, 'apply');
    expect(applied).toEqual({ ok: true, version: 2 });
    const bot = store.getBot(BOT.id)!;
    expect(bot.version).toBe(2);
    expect(bot.playbook.plays[0]!.id).toBe('careful');
    expect(store.listVersions(BOT.id).map((v) => v.author)).toEqual(['coach']);
    expect(store.getProposal(proposal.id)?.status).toBe('applied');
    expect(answerProposal(deps, bot, proposal.id, 'apply').ok).toBe(false);
    // A second night with nothing new to say says so.
    expect(await coachBotOvernight(deps, bot)).toMatch(/no Arena match since/);
  });

  it('applies on its own with auto-apply, dismisses a proposal that loses the sparring', async () => {
    const auto = rig({ autoApply: true });
    auto.reportFor(41, 5_000);
    expect(await coachBotOvernight(auto.deps, auto.store.getBot(BOT.id)!)).toMatch(/applied as v2/);
    expect(auto.store.getBot(BOT.id)?.version).toBe(2);
    expect(auto.store.pendingProposal(BOT.id)).toBeNull();

    const losing = rig({
      coachOps: [{ op: 'set', id: 'farm', play: { enabled: false } }],
    });
    losing.reportFor(41, 5_000);
    expect(await coachBotOvernight(losing.deps, losing.store.getBot(BOT.id)!)).toMatch(
      /lost the sparring/,
    );
    expect(losing.store.pendingProposal(BOT.id)).toBeNull();
    expect(losing.store.getBot(BOT.id)?.version).toBe(1);

    const quiet = rig({ coachOps: null });
    quiet.reportFor(41, 5_000);
    expect(await coachBotOvernight(quiet.deps, quiet.store.getBot(BOT.id)!)).toMatch(
      /no coach configured/,
    );
    expect(buildBriefing(quiet.deps, quiet.store.getBot(BOT.id)!).rating).toBe(BASE_RATING);
  });

  it('lets the owner dismiss, and refuses a stranger’s proposal id', () => {
    const { deps, store } = rig();
    const id = store.addProposal({
      botId: BOT.id,
      at: 1,
      comment: 'x',
      ops: OPS,
      currentWins: 0,
      candidateWins: 2,
      matches: 4,
      status: 'pending',
    });
    expect(answerProposal(deps, store.getBot(BOT.id)!, id, 'dismiss')).toEqual({ ok: true });
    expect(store.getProposal(id)?.status).toBe('dismissed');
    expect(answerProposal(deps, { ...BOT, id: 'bot_00000000000000bb' }, id, 'apply').ok).toBe(
      false,
    );
    expect(answerProposal(deps, store.getBot(BOT.id)!, 'x', 'apply').ok).toBe(false);
  });
});
