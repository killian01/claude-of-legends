// The seat a replay follows (src/game/replay_seat.ts): the Match sheet
// names the unit to follow (the bot the Record belongs to); without one
// the viewer falls back to the first seat that is not a house bot. The
// series regression: both versions of the same bot are playbook seats,
// and the edit does not always sit first (its side alternates seed to
// seed), so the fallback picked the wrong one.

import { describe, expect, it } from 'vitest';
import { followedSeat } from '../src/game/replay_seat';
import type { ReplayPick } from '../src/net/replay';
import type { PlaybookDef } from '../src/sim/playbook/types';

const pb = { version: 1, plays: [] } as unknown as PlaybookDef;

function seat(
  team: 0 | 1,
  name: string,
  opts: { bot?: string; playbook?: PlaybookDef } = {},
): ReplayPick {
  return { name, team, championId: 'vesk', sigils: ['riftstep', 'mend'], ...opts };
}

// A series with the edit on team 1: the previous version sits first.
const seriesPicks: ReplayPick[] = [
  seat(0, 'VeskMaster (previous)', { playbook: pb }),
  seat(0, 'House laner', { bot: 'laner' }),
  seat(1, 'VeskMaster', { playbook: pb }),
  seat(1, 'House sieger', { bot: 'sieger' }),
];
const unitIds = [19, 20, 24, 25];

describe('followedSeat', () => {
  it('follows the unit the Match sheet asked for', () => {
    expect(followedSeat(seriesPicks, unitIds, 24)).toBe(2);
  });

  it('falls back to the first non-house seat without one', () => {
    expect(followedSeat(seriesPicks, unitIds, undefined)).toBe(0);
  });

  it('ignores a follow id no seat holds', () => {
    expect(followedSeat(seriesPicks, unitIds, 99)).toBe(0);
  });

  it('follows seat 0 when every seat is a house bot', () => {
    const all: ReplayPick[] = [seat(0, 'House laner', { bot: 'laner' })];
    expect(followedSeat(all, [19], undefined)).toBe(0);
  });
});
