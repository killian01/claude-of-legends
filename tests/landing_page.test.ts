// The landing's request (server/landing_page.ts): the ladder of every
// human (ADR 0027), its top for a visitor, names and numbers only, and a
// returning Guest's own place.

import { describe, expect, it } from 'vitest';
import { buildLandingPage, LANDING_LADDER_ROWS } from '../server/landing_page';
import type { PointsEntry } from '../server/points_ladder';

const line = (key: number, points: number): PointsEntry => ({
  key,
  name: key < 0 ? `Wanderer ${-key}` : `p${key}`,
  points,
  guest: key < 0,
  since: Math.abs(key),
});

describe('the landing page', () => {
  it('shows the points ladder of accounts and Guests together, ranked', () => {
    const page = buildLandingPage({
      entries: [line(1, 120), line(-2, 300), line(3, 45)],
      reader: null,
    });
    expect(page.ladder.rows).toEqual([
      { rank: 1, name: 'Wanderer 2', points: 300, guest: true },
      { rank: 2, name: 'p1', points: 120, guest: false },
      { rank: 3, name: 'p3', points: 45, guest: false },
    ]);
    expect(page.ladder.total).toBe(3);
    expect(page.ladder.me).toBeNull();
  });

  it('caps the rows and still counts everyone on it', () => {
    const many = Array.from({ length: 14 }, (_, i) => line(i + 1, 10 + i));
    const page = buildLandingPage({ entries: many, reader: null });
    expect(page.ladder.rows).toHaveLength(LANDING_LADDER_ROWS);
    expect(page.ladder.total).toBe(14);
    expect(buildLandingPage({ entries: many, reader: null }, { rows: 2 }).ladder.rows).toHaveLength(
      2,
    );
  });

  it('tells a returning Guest where they stand', () => {
    const page = buildLandingPage({
      entries: [line(1, 320), line(-2, 300)],
      reader: { key: -2, name: 'Wanderer 2', guest: true, named: false },
    });
    expect(page.ladder.me).toEqual({
      rank: 2,
      points: 300,
      name: 'Wanderer 2',
      guest: true,
      named: false,
    });
  });

  it('is empty rather than absent on a fresh server', () => {
    const page = buildLandingPage({ entries: [], reader: null });
    expect(page).toEqual({ ladder: { total: 0, rows: [], me: null } });
  });
});
