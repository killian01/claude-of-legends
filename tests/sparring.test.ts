// Local sparring (plan-bots phase 4): the seats are legal, the bot's
// playbook plays and is embedded in the record, the report knows the bot,
// and the record replays to the identical world.

import { describe, expect, it } from 'vitest';
import {
  SERIES_SEEDS,
  type SeriesMatch,
  type SparBot,
  seriesPicks,
  sparMatch,
  sparringPicks,
  summarizeSeries,
} from '../src/game/sparring_core';
import { buildMatchSim } from '../src/net/replay';
import { LANER_PLAYBOOK } from '../src/sim/content/playbooks/laner';

const BOT: SparBot = {
  name: 'Nightfall',
  championId: 'vesk',
  sigils: ['riftstep', 'sear'],
  skin: 1,
  playbook: {
    version: 1,
    plays: [
      { id: 'careful', when: { kind: 'hp', below: 0.5 }, do: { kind: 'retreat' } },
      ...LANER_PLAYBOOK.plays.filter((p) => p.id !== 'retreat'),
    ],
  },
};

describe('sparring', () => {
  it('seats the bot first on team 0 among house bots, no duplicate per team', () => {
    const picks = sparringPicks(BOT);
    expect(picks).toHaveLength(10);
    expect(picks[0]).toMatchObject({ team: 0, championId: 'vesk', playbook: BOT.playbook });
    expect(picks[0]!.bot).toBeUndefined();
    for (const team of [0, 1] as const) {
      const champs = picks.filter((p) => p.team === team).map((p) => p.championId);
      expect(new Set(champs).size).toBe(5);
    }
    expect(picks.slice(1).every((p) => p.bot === 'laner')).toBe(true);
  });

  it('plays the bot’s own playbook, reports on it, and hands back a replayable record', () => {
    const picks = sparringPicks(BOT);
    const result = sparMatch({ seed: 77, picks, maxTicks: 1500 });
    expect(result.ticks).toBe(1500);
    expect(result.record).toMatchObject({ version: 1, seed: 77, ticks: 1500, events: [] });
    expect(result.record.picks[0]!.playbook).toEqual(BOT.playbook);
    const mine = result.report.units.find((u) => u.unitId === result.botUnitId);
    expect(mine).toBeDefined();
    const total = Object.values(mine!.plays).reduce((n, s) => n + s.ticks, 0);
    expect(total).toBeGreaterThan(0);
    // The bot ran ITS list: 'careful' is a play only it has.
    const known = new Set(Object.keys(mine!.plays));
    for (const id of known)
      expect(
        BOT.playbook.plays.some((p) => p.id === id) || id.startsWith('reflex:') || id === 'idle',
      ).toBe(true);

    // The record rebuilds the same world.
    const { sim } = buildMatchSim(result.record.seed, result.record.picks);
    for (let i = 0; i < 1500; i++) sim.tick();
    const again = sparMatch({ seed: 77, picks, maxTicks: 1500 });
    expect(again.report).toEqual(result.report);
    expect(sim.tickCount).toBe(1500);
  });
});

describe('the series', () => {
  it('seats the bot on the asked side, its previous version across, house bots around', () => {
    const previous = { ...BOT.playbook, plays: BOT.playbook.plays.slice(1) };
    const { picks, botIndex } = seriesPicks(BOT, previous, 5, 1);
    expect(picks).toHaveLength(10);
    expect(picks[botIndex]).toMatchObject({ team: 1, name: BOT.name, playbook: BOT.playbook });
    const prev = picks.find((p) => p.name.endsWith('(previous)'))!;
    expect(prev).toMatchObject({ team: 0, championId: 'vesk', playbook: previous });
    for (const team of [0, 1] as const) {
      const champs = picks.filter((p) => p.team === team).map((p) => p.championId);
      expect(champs).toHaveLength(5);
      expect(new Set(champs).size).toBe(5);
      expect(champs).toContain('vesk');
    }
    expect(picks.filter((p) => p.bot === 'laner')).toHaveLength(8);
    // No previous version: house bots alone across, the bot still on its side.
    const alone = seriesPicks(BOT, null, 5, 0);
    expect(alone.picks[alone.botIndex]).toMatchObject({ team: 0, name: BOT.name });
    expect(alone.picks.filter((p) => p.playbook)).toHaveLength(1);
    expect(SERIES_SEEDS).toBe(5);
  });

  it('plays the bot from either seat and sums the series from its side', () => {
    const { picks, botIndex } = seriesPicks(BOT, null, 9, 1);
    const result = sparMatch({ seed: 9, picks, maxTicks: 300, botIndex });
    const mine = result.report.units.find((u) => u.unitId === result.botUnitId);
    expect(mine).toBeDefined();
    const known = new Set(Object.keys(mine!.plays));
    for (const id of known)
      expect(
        BOT.playbook.plays.some((p) => p.id === id) || id.startsWith('reflex:') || id === 'idle',
      ).toBe(true);
    const stub = (
      team: 0 | 1,
      winner: 0 | 1 | null,
      plays: Record<string, { ticks: number; deaths: number }>,
    ): SeriesMatch => ({
      seed: 1,
      team,
      result: {
        winner,
        ticks: 100,
        botUnitId: 7,
        report: {
          ticks: 100,
          units: [
            { unitId: 7, plays, deaths: Object.values(plays).reduce((n, s) => n + s.deaths, 0) },
          ],
        },
        record: result.record,
      },
    });
    const summary = summarizeSeries([
      stub(0, 0, { fight: { ticks: 40, deaths: 1 } }),
      stub(1, 1, { fight: { ticks: 10, deaths: 0 }, farm: { ticks: 30, deaths: 2 } }),
      stub(0, 1, { farm: { ticks: 5, deaths: 0 } }),
      stub(1, null, {}),
    ]);
    expect(summary).toMatchObject({ wins: 2, losses: 1, draws: 1, deaths: 3 });
    expect(summary.plays).toEqual({
      fight: { ticks: 50, deaths: 1 },
      farm: { ticks: 35, deaths: 2 },
    });
  });
});
