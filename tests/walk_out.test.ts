import { describe, expect, it } from 'vitest';
import { LEAVER_RATING_PENALTY } from '../server/rating';
import { type WalkOut, walkOutPenalty } from '../server/walk_out';

// A rated 1v1 among bots: the leaver on team 0, one person on team 1.
function walkOut(over: Partial<WalkOut> = {}): WalkOut {
  return {
    ratedEligible: true,
    decided: false,
    coach: false,
    droppedIn: false,
    seats: [
      { team: 0, connected: true },
      { team: 1, connected: true },
    ],
    ...over,
  };
}

describe('walkOutPenalty', () => {
  it('costs a walk-out from a live rated match the flat penalty', () => {
    expect(walkOutPenalty(walkOut())).toBe(LEAVER_RATING_PENALTY);
  });

  it('costs nothing in a match that could never be rated', () => {
    expect(walkOutPenalty(walkOut({ ratedEligible: false }))).toBe(0);
  });

  it('costs nothing once the match has a winner', () => {
    expect(walkOutPenalty(walkOut({ decided: true }))).toBe(0);
  });

  it('costs a coach nothing: the bot plays on', () => {
    expect(walkOutPenalty(walkOut({ coach: true }))).toBe(0);
  });

  it('costs a seat taken mid-match nothing', () => {
    expect(walkOutPenalty(walkOut({ droppedIn: true }))).toBe(0);
  });

  it('costs nothing when the other side has no one connected', () => {
    const seats = [
      { team: 0 as const, connected: true },
      { team: 0 as const, connected: true },
      { team: 1 as const, connected: false },
    ];
    expect(walkOutPenalty(walkOut({ seats }))).toBe(0);
  });

  it('costs nothing when the leaver is the only person in the match', () => {
    expect(walkOutPenalty(walkOut({ seats: [{ team: 0, connected: true }] }))).toBe(0);
  });

  it('counts a person on the other side once anyone there is connected', () => {
    const seats = [
      { team: 0 as const, connected: true },
      { team: 1 as const, connected: false },
      { team: 1 as const, connected: true },
    ];
    expect(walkOutPenalty(walkOut({ seats }))).toBe(LEAVER_RATING_PENALTY);
  });
});
