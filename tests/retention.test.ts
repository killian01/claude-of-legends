// Who came back (scripts/retention_report.ts). The report reads two files the
// server was already writing, so what is worth pinning is the arithmetic
// on top of them: which day an account belongs to, what counts as coming
// back, and that a person who played six matches on one day is one person.

import { describe, expect, it } from 'vitest';
import {
  type AccountRow,
  cohorts,
  curve,
  daysBetween,
  type MatchRow,
} from '../scripts/retention_report';

const T = (iso: string) => Date.parse(iso);

const account = (id: number, made: string, seen = made): AccountRow => ({
  id,
  createdAt: T(made),
  seenAt: T(seen),
  ratedGames: 0,
});

const match = (at: string, ...accountIds: number[]): MatchRow => ({ at: T(at), accountIds });

describe('the day one instant is after another', () => {
  it('is counted in UTC days and not in elapsed hours', () => {
    // Signing up at 23:50 and playing at 00:10 is coming back tomorrow,
    // and twenty minutes of arithmetic would call it the same day.
    expect(daysBetween(T('2026-09-06T23:50:00Z'), T('2026-09-07T00:10:00Z'))).toBe(1);
    expect(daysBetween(T('2026-09-06T00:10:00Z'), T('2026-09-06T23:50:00Z'))).toBe(0);
    expect(daysBetween(T('2026-09-06T12:00:00Z'), T('2026-09-13T01:00:00Z'))).toBe(7);
  });
});

describe('a cohort', () => {
  it('is the accounts made on one UTC day', () => {
    const rows = cohorts(
      [
        account(1, '2026-09-06T09:00:00Z'),
        account(2, '2026-09-06T23:00:00Z'),
        account(3, '2026-09-07T01:00:00Z'),
      ],
      [],
    );
    expect(rows.map((r) => [r.day, r.size])).toEqual([
      ['2026-09-06', 2],
      ['2026-09-07', 1],
    ]);
  });

  it('counts a member once however many matches they played', () => {
    const rows = cohorts(
      [account(1, '2026-09-06T09:00:00Z')],
      [
        match('2026-09-06T10:00:00Z', 1),
        match('2026-09-06T11:00:00Z', 1),
        match('2026-09-06T12:00:00Z', 1),
      ],
    );
    expect(rows[0]).toMatchObject({ size: 1, played: 1, playedAgain: 0 });
  });

  it('counts coming back as a later day, not a later match', () => {
    const rows = cohorts(
      [account(1, '2026-09-06T09:00:00Z'), account(2, '2026-09-06T09:00:00Z')],
      [match('2026-09-06T23:00:00Z', 1, 2), match('2026-09-07T09:00:00Z', 2)],
    );
    expect(rows[0]).toMatchObject({ size: 2, played: 2, playedAgain: 1 });
  });

  it('reports the match log above the account, since one of them lags', () => {
    // seenAt moves in memory and reaches disk only when something else
    // persists (server/accounts.ts), so an account can have played
    // yesterday and still read as never seen again. The report says both
    // rather than picking the flattering one.
    const stale = account(1, '2026-09-06T09:00:00Z');
    const rows = cohorts([stale], [match('2026-09-07T09:00:00Z', 1)]);
    expect(rows[0]).toMatchObject({ playedAgain: 1, cameBack: 0 });
  });

  it('leaves out the bot seats, which have no account at all', () => {
    // Every practice match is eight bots and a person; counting the seats
    // would make one player look like a crowd.
    const rows = cohorts([account(1, '2026-09-06T09:00:00Z')], [match('2026-09-06T10:00:00Z', 1)]);
    expect(rows[0]?.played).toBe(1);
  });
});

describe('the curve', () => {
  it('counts people per day after signing up, not matches', () => {
    const accounts = [account(1, '2026-09-06T09:00:00Z'), account(2, '2026-09-06T09:00:00Z')];
    const matches = [
      match('2026-09-06T10:00:00Z', 1, 2),
      match('2026-09-06T11:00:00Z', 1),
      match('2026-09-07T10:00:00Z', 1),
      match('2026-09-13T10:00:00Z', 1),
    ];
    const days = curve(accounts, matches);
    expect(days[0]).toBe(2);
    expect(days[1]).toBe(1);
    expect(days[7]).toBe(1);
    expect(days.length).toBe(8);
  });

  it('ignores a match by an account the file does not know', () => {
    // A deleted account still has its matches in the log, and it must not
    // land in a cohort that never held it.
    expect(
      curve([account(1, '2026-09-06T09:00:00Z')], [match('2026-09-06T10:00:00Z', 99)])[0],
    ).toBe(0);
  });
});
