// The counter behind PRIVACY.md. Two things are worth pinning here and the
// rest is arithmetic: that a day rolls over on its own, since nothing
// schedules it and a launch spans midnight, and that the visitor set is
// thrown away with its salt when it does, since that promise is the only
// reason the file is allowed to exist without a consent banner.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  dayKey,
  emptyDay,
  fromFile,
  Pulse,
  type PulseDay,
  toFile,
  tokenMatches,
} from '../server/pulse';

const T = (iso: string) => Date.parse(iso);
const DAY_ONE = T('2026-09-06T10:00:00Z');
// The day at an index, asserted present: every caller below has just put
// it there, and the alternative is a non-null assertion on every line.
const day = (p: Pulse, i = 0): PulseDay => {
  const d = p.days()[i];
  if (!d) throw new Error(`no day at ${i}`);
  return d;
};

describe('the UTC day', () => {
  it('is the same day either side of a local midnight', () => {
    // 00:30 in Paris on the 7th is still the 6th in UTC. The boundary has
    // to be somewhere; it must not be somewhere that moves twice a year.
    expect(dayKey(T('2026-09-06T22:30:00Z'))).toBe('2026-09-06');
    expect(dayKey(T('2026-09-06T23:59:59Z'))).toBe('2026-09-06');
    expect(dayKey(T('2026-09-07T00:00:00Z'))).toBe('2026-09-07');
  });
});

describe('the counters', () => {
  it('land on the day the thing happened', () => {
    const p = new Pulse(DAY_ONE);
    p.load(DAY_ONE, '10.0.0.1');
    p.account(DAY_ONE);
    p.matchStarted(DAY_ONE);
    p.matchFinished(DAY_ONE);
    expect(p.days()).toEqual([
      {
        day: '2026-09-06',
        loads: 1,
        visitors: 1,
        accounts: 1,
        matches: 1,
        finished: 1,
        restarts: 1,
      },
    ]);
  });

  it('separate a reload from a second visitor', () => {
    const p = new Pulse(DAY_ONE);
    p.load(DAY_ONE, '10.0.0.1');
    p.load(DAY_ONE, '10.0.0.1');
    p.load(DAY_ONE, '10.0.0.2');
    expect(day(p).loads).toBe(3);
    expect(day(p).visitors).toBe(2);
  });

  it('file a new day the moment the clock passes midnight', () => {
    // Nothing schedules the rollover: the next thing to happen carries the
    // time, and a server left running for a week must not pile a week into
    // one row.
    const p = new Pulse(DAY_ONE);
    p.load(DAY_ONE, '10.0.0.1');
    p.load(T('2026-09-07T00:00:01Z'), '10.0.0.1');
    expect(p.days().map((d) => d.day)).toEqual(['2026-09-06', '2026-09-07']);
    expect(day(p, 0).loads).toBe(1);
    expect(day(p, 1).loads).toBe(1);
  });

  it('forget who they saw when the day turns over', () => {
    // The salt and the set die together at midnight, so yesterday's hashes
    // cannot be reproduced even here. What is observable is the
    // consequence: the same person tomorrow is a new visitor.
    const p = new Pulse(DAY_ONE);
    p.load(DAY_ONE, '10.0.0.1');
    p.load(T('2026-09-07T09:00:00Z'), '10.0.0.1');
    expect(day(p, 0).visitors).toBe(1);
    expect(day(p, 1).visitors).toBe(1);
  });

  it('skip the days on which nothing happened', () => {
    const p = new Pulse(DAY_ONE);
    p.load(T('2026-09-09T09:00:00Z'), '10.0.0.1');
    expect(p.days().map((d) => d.day)).toEqual(['2026-09-06', '2026-09-09']);
  });

  it('drop the oldest day once the history is full', () => {
    const history = ['2026-09-01', '2026-09-02', '2026-09-03'].map(emptyDay);
    const p = new Pulse(DAY_ONE, { history, keep: 3 });
    expect(p.days().map((d) => d.day)).toEqual(['2026-09-02', '2026-09-03', '2026-09-06']);
  });

  it('count a restart, because it is what inflates that day', () => {
    const history = [{ ...emptyDay('2026-09-06'), loads: 4, visitors: 2, restarts: 1 }];
    const p = new Pulse(DAY_ONE, { history });
    // The counts carry across the restart; the set of seen visitors does
    // not, so the reader is told how often that happened.
    expect(day(p)).toMatchObject({ loads: 4, visitors: 2, restarts: 2 });
    p.load(DAY_ONE, '10.0.0.1');
    expect(day(p)).toMatchObject({ loads: 5, visitors: 3 });
  });

  it('stop counting distinct visitors at the cap, and say so', () => {
    const p = new Pulse(DAY_ONE, { cap: 2 });
    p.load(DAY_ONE, '10.0.0.1');
    p.load(DAY_ONE, '10.0.0.2');
    expect(p.cappedToday()).toBe(false);
    p.load(DAY_ONE, '10.0.0.3');
    expect(p.cappedToday()).toBe(true);
    // Loads keep counting: only the set is bounded.
    expect(day(p)).toMatchObject({ loads: 3, visitors: 2 });
  });

  it('lift the cap with the new day', () => {
    const p = new Pulse(DAY_ONE, { cap: 1 });
    p.load(DAY_ONE, '10.0.0.1');
    p.load(DAY_ONE, '10.0.0.2');
    expect(p.cappedToday()).toBe(true);
    p.load(T('2026-09-07T09:00:00Z'), '10.0.0.3');
    expect(p.cappedToday()).toBe(false);
  });
});

describe('the file on disk', () => {
  it('survives a round trip', () => {
    const p = new Pulse(DAY_ONE);
    p.load(DAY_ONE, '10.0.0.1');
    p.account(DAY_ONE);
    const written = JSON.parse(JSON.stringify(toFile(p.days())));
    expect(fromFile(written)).toEqual([...p.days()]);
  });

  it('starts clean rather than guess at a shape it does not know', () => {
    // A wrong count read back as truth is worse than no history: it would
    // be reported for a year with nothing to contradict it.
    // loadJson already turns unreadable bytes into the fallback, so what
    // reaches here is a parsed value of any shape at all.
    expect(fromFile(null)).toEqual([]);
    expect(fromFile('not an object')).toEqual([]);
    expect(fromFile({ version: 2, days: [] })).toEqual([]);
    expect(fromFile({ version: 1 })).toEqual([]);
    expect(fromFile({ version: 1, days: [{ day: 'today', loads: 1 }] })).toEqual([]);
  });

  it('repairs a missing or impossible counter without losing the day', () => {
    const written = {
      version: 1,
      days: [{ day: '2026-09-06', loads: -3, visitors: 2.7, accounts: 'many' }],
    };
    expect(fromFile(written)).toEqual([
      {
        day: '2026-09-06',
        loads: 0,
        visitors: 2,
        accounts: 0,
        matches: 0,
        finished: 0,
        restarts: 0,
      },
    ]);
  });

  it('hands the days back oldest first whatever order they were written in', () => {
    const written = { version: 1, days: [emptyDay('2026-09-09'), emptyDay('2026-09-06')] };
    expect(fromFile(written).map((d) => d.day)).toEqual(['2026-09-06', '2026-09-09']);
  });
});

describe('the counts across a restart', () => {
  it('come back from the file the last process left', () => {
    // The whole point of the feature is a number read days after the day
    // it counted, so the one path that must not be theoretical is this
    // one: two processes, one file.
    const dir = mkdtempSync(path.join(tmpdir(), 'loc-pulse-'));
    const file = path.join(dir, 'pulse.json');
    try {
      const first = new Pulse(DAY_ONE, { file });
      first.load(DAY_ONE, '10.0.0.1');
      first.load(DAY_ONE, '10.0.0.2');
      first.account(DAY_ONE);
      first.matchStarted(DAY_ONE);
      first.matchFinished(DAY_ONE);
      first.flush();

      const second = new Pulse(DAY_ONE, { file });
      expect(second.days()).toEqual([
        {
          day: '2026-09-06',
          loads: 2,
          visitors: 2,
          accounts: 1,
          matches: 1,
          finished: 1,
          restarts: 2,
        },
      ]);
      // The set of seen visitors did not survive, by design: the same
      // address is a new visitor to the new process, and `restarts` is
      // what warns the reader that it happened.
      second.load(DAY_ONE, '10.0.0.1');
      expect(day(second)).toMatchObject({ loads: 3, visitors: 3 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('starts from nothing when there is no file yet', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'loc-pulse-'));
    try {
      const p = new Pulse(DAY_ONE, { file: path.join(dir, 'nested', 'pulse.json') });
      expect(p.days()).toEqual([emptyDay('2026-09-06')].map((d) => ({ ...d, restarts: 1 })));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the token on the report', () => {
  it('refuses everything while the secret is unset', () => {
    // The endpoint is off by default. An empty token satisfying an empty
    // secret would publish the counts on any deployment that forgot it.
    expect(tokenMatches('', '')).toBe(false);
    expect(tokenMatches('anything', '')).toBe(false);
  });

  it('accepts only the exact token', () => {
    expect(tokenMatches('s3cret', 's3cret')).toBe(true);
    expect(tokenMatches('s3cre', 's3cret')).toBe(false);
    expect(tokenMatches('s3crett', 's3cret')).toBe(false);
    expect(tokenMatches('S3CRET', 's3cret')).toBe(false);
    expect(tokenMatches('', 's3cret')).toBe(false);
  });

  it('compares tokens of any length without throwing', () => {
    // timingSafeEqual throws on a length mismatch, which is exactly what a
    // guessed token produces; hashing both sides first is what stops a
    // wrong length from becoming a 500 and an oracle.
    expect(() => tokenMatches('x'.repeat(4096), 's3cret')).not.toThrow();
    expect(tokenMatches('x'.repeat(4096), 's3cret')).toBe(false);
  });
});
