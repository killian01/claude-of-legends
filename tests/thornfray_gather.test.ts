// A Thornfray's gathering (server/thornfray_gather.ts, ADR 0035): who is in,
// when it starts (full, its clock, its opener's Start now), and where it
// stands for each person in it. Pure.

import { describe, expect, it } from 'vitest';
import {
  GATHER_MS,
  gatheringStarts,
  gatherSecondsLeft,
  gatherStatus,
  joinGathering,
  leaveGathering,
  openGathering,
  pressStartNow,
} from '../server/thornfray_gather';
import { BOUT_SEATS } from '../src/sim/content/bouts/match';

describe('who is in', () => {
  it('opens with its opener and takes people up to its seats, each once', () => {
    const g = openGathering(1, 0);
    expect(g.people).toEqual([1]);
    expect(joinGathering(g, 1)).toBe(false);
    for (let id = 2; id <= BOUT_SEATS; id++) expect(joinGathering(g, id)).toBe(true);
    expect(joinGathering(g, 99)).toBe(false);
    expect(g.people).toHaveLength(BOUT_SEATS);
  });

  it('lets a person leave, and a stranger leaves nothing', () => {
    const g = openGathering(1, 0);
    joinGathering(g, 2);
    expect(leaveGathering(g, 3)).toBe(false);
    expect(leaveGathering(g, 1)).toBe(true);
    expect(g.people).toEqual([2]);
  });
});

describe('when it starts', () => {
  it('starts full at once', () => {
    const g = openGathering(1, 0);
    for (let id = 2; id < BOUT_SEATS; id++) joinGathering(g, id);
    expect(gatheringStarts(g, 1)).toBeNull();
    joinGathering(g, BOUT_SEATS);
    expect(gatheringStarts(g, 1)).toBe('full');
  });

  it('starts at its clock, not a moment before', () => {
    const g = openGathering(1, 1000);
    expect(gatheringStarts(g, 1000 + GATHER_MS - 1)).toBeNull();
    expect(gatheringStarts(g, 1000 + GATHER_MS)).toBe('timed_out');
    expect(GATHER_MS).toBe(20_000);
  });

  it('starts on Start now, its opener alone, and hands it on when the opener leaves', () => {
    const g = openGathering(1, 0);
    joinGathering(g, 2);
    joinGathering(g, 3);
    expect(pressStartNow(g, 2)).toBe(false);
    expect(gatheringStarts(g, 5)).toBeNull();
    leaveGathering(g, 1);
    expect(pressStartNow(g, 3)).toBe(false);
    expect(pressStartNow(g, 2)).toBe(true);
    expect(gatheringStarts(g, 5)).toBe('start_now');
  });

  it('never starts with nobody in it', () => {
    const g = openGathering(1, 0);
    leaveGathering(g, 1);
    expect(gatheringStarts(g, GATHER_MS * 2)).toBeNull();
  });
});

describe('where it stands', () => {
  it('tells each person how many are in, the seconds left and who holds Start now', () => {
    const g = openGathering(1, 0);
    joinGathering(g, 2);
    expect(gatherStatus(g, 0, 1)).toEqual({
      people: 2,
      of: BOUT_SEATS,
      startsIn: 20,
      opener: true,
    });
    expect(gatherStatus(g, 6_200, 2)).toEqual({
      people: 2,
      of: BOUT_SEATS,
      startsIn: 14,
      opener: false,
    });
    expect(gatherSecondsLeft(g, GATHER_MS + 500)).toBe(0);
  });
});
