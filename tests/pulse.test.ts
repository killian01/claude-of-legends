// The counter behind PRIVACY.md. Two things are worth pinning here and the
// rest is arithmetic: that a day rolls over on its own, since nothing
// schedules it and a launch spans midnight, and that a reload is told from
// an arrival, since telling those two apart is the whole reason the file
// exists. Who a visitor is is no longer this file's business at all: the
// browser says so (src/net/pulse_ping.ts) and server/visit_guard.ts bounds
// how often one network may.

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
    p.load(DAY_ONE);
    p.visit(DAY_ONE);
    p.account(DAY_ONE);
    p.matchStarted(DAY_ONE);
    p.matchFinished(DAY_ONE);
    expect(p.days()).toEqual([
      {
        day: '2026-09-06',
        loads: 1,
        strays: 0,
        visitors: 1,
        newcomers: 0,
        accounts: 1,
        matches: 1,
        finished: 1,
        restarts: 1,
      },
    ]);
  });

  it('separate a reload from an arrival', () => {
    // Three loads and two browsers: the second one is the only thing that
    // says anybody new turned up, and it says it once each.
    const p = new Pulse(DAY_ONE);
    p.load(DAY_ONE);
    p.visit(DAY_ONE);
    p.load(DAY_ONE);
    p.load(DAY_ONE);
    p.visit(DAY_ONE);
    expect(day(p).loads).toBe(3);
    expect(day(p).visitors).toBe(2);
  });

  it('keep a door being tried apart from a page somebody asked for', () => {
    // Both are shells served, so both are loads; only one of them is a
    // person. Without the split, 350 scanned paths and 350 arrivals are
    // the same row, which is how a launch day gets misread in the good
    // direction and in the bad one alike.
    const p = new Pulse(DAY_ONE);
    p.load(DAY_ONE);
    p.load(DAY_ONE, true);
    p.load(DAY_ONE, true);
    expect(day(p)).toMatchObject({ loads: 3, strays: 2 });
  });

  it('keep a first arrival apart from somebody coming back', () => {
    // A newcomer is a visitor too: the counter is a subset and never a
    // second column to add up. Three visitors of whom none is new is one
    // contributor reloading; three of whom three are is a launch.
    const p = new Pulse(DAY_ONE);
    p.visit(DAY_ONE, true);
    p.visit(DAY_ONE);
    p.visit(DAY_ONE, true);
    expect(day(p)).toMatchObject({ visitors: 3, newcomers: 2 });
  });

  it('file a new day the moment the clock passes midnight', () => {
    // Nothing schedules the rollover: the next thing to happen carries the
    // time, and a server left running for a week must not pile a week into
    // one row.
    const p = new Pulse(DAY_ONE);
    p.load(DAY_ONE);
    p.load(T('2026-09-07T00:00:01Z'));
    expect(p.days().map((d) => d.day)).toEqual(['2026-09-06', '2026-09-07']);
    expect(day(p, 0).loads).toBe(1);
    expect(day(p, 1).loads).toBe(1);
  });

  it('file the same person twice when they come back tomorrow', () => {
    // A returning visitor is an arrival again on the new day: the browser
    // stores the date it last pinged, so it pings once more at midnight.
    const p = new Pulse(DAY_ONE);
    p.visit(DAY_ONE);
    p.visit(T('2026-09-07T09:00:00Z'));
    expect(day(p, 0).visitors).toBe(1);
    expect(day(p, 1).visitors).toBe(1);
  });

  it('skip the days on which nothing happened', () => {
    const p = new Pulse(DAY_ONE);
    p.load(T('2026-09-09T09:00:00Z'));
    expect(p.days().map((d) => d.day)).toEqual(['2026-09-06', '2026-09-09']);
  });

  it('drop the oldest day once the history is full', () => {
    const history = ['2026-09-01', '2026-09-02', '2026-09-03'].map(emptyDay);
    const p = new Pulse(DAY_ONE, { history, keep: 3 });
    expect(p.days().map((d) => d.day)).toEqual(['2026-09-02', '2026-09-03', '2026-09-06']);
  });

  it('count a restart, because a deploy is under most odd afternoons', () => {
    const history = [{ ...emptyDay('2026-09-06'), loads: 4, visitors: 2, restarts: 1 }];
    const p = new Pulse(DAY_ONE, { history });
    expect(day(p)).toMatchObject({ loads: 4, visitors: 2, restarts: 2 });
  });
});

describe('the file on disk', () => {
  it('survives a round trip', () => {
    const p = new Pulse(DAY_ONE);
    p.load(DAY_ONE);
    p.visit(DAY_ONE);
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
        // Counted before the counter existed, which is the same as zero
        // and must not throw the day away (server/pulse.ts keeps the
        // version at 1 for exactly this).
        strays: 0,
        visitors: 2,
        newcomers: 0,
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
      first.load(DAY_ONE);
      first.load(DAY_ONE);
      first.visit(DAY_ONE);
      first.visit(DAY_ONE);
      first.account(DAY_ONE);
      first.matchStarted(DAY_ONE);
      first.matchFinished(DAY_ONE);
      first.flush();

      const second = new Pulse(DAY_ONE, { file });
      expect(second.days()).toEqual([
        {
          day: '2026-09-06',
          loads: 2,
          strays: 0,
          visitors: 2,
          newcomers: 0,
          accounts: 1,
          matches: 1,
          finished: 1,
          restarts: 2,
        },
      ]);
      // And a restart no longer costs anything: a browser that pinged
      // this morning does not ping again this afternoon, so the deploy
      // that made this second process cannot count anybody twice.
      second.load(DAY_ONE);
      expect(day(second)).toMatchObject({ loads: 3, visitors: 2 });
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
