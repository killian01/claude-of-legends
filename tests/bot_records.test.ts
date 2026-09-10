// The Record (playtest round 3, CONTEXT.md): entries on the bots store,
// newest first, the tally, the cap that drops the oldest with the replays
// only they held, the held replays kept out of the global prune, and the
// upload door for the Academy's sparring: bounded, validated, refused when
// it is not the shape of a local sparring.

import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addEntry,
  getEntry,
  listEntries,
  type NewRecordEntry,
  parseUpload,
  RECORD_CAP,
  wonBy,
} from '../server/bot_records';
import { BotStore } from '../server/bot_store';
import { starOrchard } from '../server/star_orchard';
import { pruneNumberedJson } from '../server/store';
import { sparMatch, sparringPicks } from '../src/game/sparring_core';
import { LANER_PLAYBOOK } from '../src/sim/content/playbooks/laner';
import type { ScoreRow } from '../src/sim/types';

const row = (unitId: number, team: 0 | 1, kills = 0): ScoreRow => ({
  unitId,
  name: 'Vesk',
  championId: 'vesk',
  player: null,
  team,
  level: 6,
  kills,
  deaths: 1,
  assists: 2,
  cs: 30,
  items: ['warbrand'],
});

const tenRows = (): ScoreRow[] => Array.from({ length: 10 }, (_, i) => row(i + 1, i < 5 ? 0 : 1));

function entry(at: number, winner: 0 | 1 | null, replayId: number | null): NewRecordEntry {
  return {
    kind: 'sparring',
    at,
    seed: 7,
    team: 0,
    winner,
    ticks: 1200,
    version: 2,
    edited: false,
    botUnitId: 1,
    score: tenRows(),
    report: {
      ticks: 1200,
      units: [{ unitId: 1, plays: { farm: { ticks: 1200, deaths: 1 } }, deaths: 1 }],
    },
    replayId,
  };
}

describe('the Record on the store', () => {
  it('lists newest first with the line, tallies won and lost, hands back one entry whole', () => {
    const store = new BotStore(':memory:');
    const a = addEntry(store, 'bot_a', 1, entry(1000, 0, 11)).id;
    const b = addEntry(store, 'bot_a', 1, entry(2000, 1, 12)).id;
    const c = addEntry(store, 'bot_a', 1, entry(3000, null, null)).id;
    addEntry(store, 'bot_b', 1, entry(4000, 0, 13));
    const rows = listEntries(store, 'bot_a');
    expect(rows.map((r) => r.id)).toEqual([c, b, a]);
    expect(rows[2]).toMatchObject({ kind: 'sparring', winner: 0, team: 0, replayId: 11 });
    expect(rows[2]!.line).toMatchObject({ unitId: 1, kills: 0, items: ['warbrand'] });
    expect('score' in rows[2]!).toBe(false);
    expect(store.tally('bot_a')).toEqual({ wins: 1, losses: 1 });
    expect(store.tally('bot_b')).toEqual({ wins: 1, losses: 0 });
    expect(store.tally('bot_none')).toEqual({ wins: 0, losses: 0 });
    const whole = getEntry(store, 'bot_a', a);
    expect(whole?.score).toHaveLength(10);
    expect(whole?.report.units[0]?.plays.farm).toEqual({ ticks: 1200, deaths: 1 });
    // Another bot's entry is not this bot's.
    expect(getEntry(store, 'bot_b', a)).toBeNull();
    expect(wonBy({ team: 1, winner: 1 })).toBe(true);
    expect(wonBy({ team: 1, winner: null })).toBeNull();
  });

  it('caps a bot at RECORD_CAP entries, the oldest leaving with their replays', () => {
    const store = new BotStore(':memory:');
    const dropped: number[] = [];
    for (let i = 0; i < RECORD_CAP + 3; i++) {
      dropped.push(...addEntry(store, 'bot_a', 1, entry(1000 + i, 0, 100 + i)).dropped);
    }
    expect(listEntries(store, 'bot_a')).toHaveLength(RECORD_CAP);
    expect(dropped).toEqual([100, 101, 102]);
    expect(store.heldReplayIds().has(100)).toBe(false);
    expect(store.heldReplayIds().has(103)).toBe(true);
    // Deleting the bot's Record hands back every replay it held.
    const gone = store.deleteRecordsOf('bot_a');
    expect(gone).toHaveLength(RECORD_CAP);
    expect(listEntries(store, 'bot_a')).toEqual([]);
  });
});

describe('the held replays and the prune', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('keeps a replay a Record references past the global window', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'col-replays-'));
    for (let i = 1; i <= 6; i++) writeFileSync(path.join(dir, `${i}.json`), '{}');
    const doomed = pruneNumberedJson(dir, 3, new Set([2]));
    expect(doomed.sort()).toEqual([1, 3]);
    expect(readdirSync(dir).sort()).toEqual(['2.json', '4.json', '5.json', '6.json']);
  });
});

describe('the upload from the Academy', () => {
  const bot = {
    name: 'Nightfall',
    championId: 'vesk',
    sigils: ['riftstep', 'sear'] as [string, string],
    skin: 1,
    playbook: LANER_PLAYBOOK,
  };
  const picks = sparringPicks(bot, 5);
  const result = sparMatch(starOrchard(), { seed: 5, picks, maxTicks: 400 });
  const upload = () => ({
    id: 'bot_x',
    kind: 'sparring',
    seed: 5,
    team: 0,
    winner: result.winner,
    ticks: result.ticks,
    version: 3,
    edited: true,
    botUnitId: result.botUnitId,
    score: result.score,
    report: result.report,
    record: result.record,
  });

  it('accepts a real sparring result, playbooks through the validator', () => {
    const parsed = parseUpload(upload(), 999);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.entry).toMatchObject({
      kind: 'sparring',
      at: 999,
      seed: 5,
      team: 0,
      ticks: 400,
      version: 3,
      edited: true,
    });
    expect(parsed.value.entry.score).toHaveLength(10);
    expect(parsed.value.record.picks[0]?.playbook).toEqual(LANER_PLAYBOOK);
    expect(parsed.value.record.events).toEqual([]);
    // Deaths dated in the report survive the door.
    const mine = parsed.value.entry.report.units.find((u) => u.unitId === result.botUnitId);
    expect(Array.isArray(mine?.deathsAt)).toBe(true);
  });

  it('takes a series with its place, and refuses what is not a sparring', () => {
    const series = parseUpload(
      { ...upload(), kind: 'series', seriesId: 's1', seriesIndex: 2, seriesOf: 5, versus: 'v3 v2' },
      1,
    );
    expect(series.ok).toBe(true);
    if (series.ok) {
      expect(series.value.entry).toMatchObject({ seriesId: 's1', seriesIndex: 2, seriesOf: 5 });
    }
    const bad = (patch: Record<string, unknown>) => {
      const p = parseUpload({ ...upload(), ...patch }, 1);
      return p.ok ? 'accepted' : p.error;
    };
    expect(bad({ kind: 'arena' })).toMatch(/kind/);
    expect(bad({ ticks: 0 })).toMatch(/ticks/);
    expect(bad({ score: result.score.slice(1) })).toMatch(/ten rows/);
    expect(bad({ botUnitId: 99_999 })).toMatch(/its side/);
    expect(bad({ record: { ...result.record, events: [{ k: 1, u: 1, e: 'bot_on' }] } })).toMatch(
      /sparring replay/,
    );
    expect(bad({ record: { ...result.record, seed: 6 } })).toMatch(/sparring replay/);
    expect(
      bad({
        record: {
          ...result.record,
          picks: [{ ...picks[0]!, playbook: { version: 1, plays: 'nope' } }, ...picks.slice(1)],
        },
      }),
    ).toMatch(/sparring replay/);
    expect(bad({ kind: 'series', seriesId: 'S 1', seriesIndex: 1, seriesOf: 5 })).toMatch(
      /seriesId/,
    );
    expect(bad({ report: { ticks: 1, units: 'x' } })).toMatch(/report/);
  });
});
