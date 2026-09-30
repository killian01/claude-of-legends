// Lane preferences at champion select (src/sim/lane_picks.ts; CONTEXT.md:
// Lane preference; ADR 0026): the five-seat caps, the lane a seat is
// offered before it chooses, and how a team's asks settle, first come
// first served, with every seat ending on a lane the team has room for.

import { describe, expect, it } from 'vitest';
import type { ChampionRole } from '../src/sim/content/champions';
import {
  defaultLane,
  forestFit,
  isLanePreference,
  LANE_CHOICES,
  laneOpen,
  laneRoom,
  settleLanes,
} from '../src/sim/lane_picks';
import type { LanePreference } from '../src/sim/playbook/types';

const ROLES: readonly (ChampionRole | null)[] = [
  'Tank',
  'Fighter',
  'Mage',
  'Assassin',
  'Battlemage',
  'Marksman',
  'Support',
  'Skirmisher',
  null,
];

function within(lanes: readonly LanePreference[]): boolean {
  const n = (lane: LanePreference): number => lanes.filter((l) => l === lane).length;
  return (
    n('top') <= 2 &&
    n('mid') <= 1 &&
    n('bot') <= 2 &&
    n('jungle') <= 1 &&
    n('top') + n('jungle') <= 2
  );
}

describe('the lane caps', () => {
  it('offers the four choices, the forest last', () => {
    expect(LANE_CHOICES).toEqual(['top', 'mid', 'bot', 'jungle']);
    for (const lane of LANE_CHOICES) expect(isLanePreference(lane)).toBe(true);
    for (const junk of ['forest', 'bottom', '', null, undefined, 3, ['mid']]) {
      expect(isLanePreference(junk)).toBe(false);
    }
  });

  it('holds two top, one mid, two bot, one forest, and two between top and the forest', () => {
    expect(LANE_CHOICES.map((lane) => laneRoom([], lane))).toEqual([2, 1, 2, 1]);
    expect(laneOpen(['mid'], 'mid')).toBe(false);
    expect(laneOpen(['bot'], 'bot')).toBe(true);
    expect(laneOpen(['bot', 'bot'], 'bot')).toBe(false);
    expect(laneOpen(['top'], 'top')).toBe(true);
    expect(laneOpen(['top', 'top'], 'top')).toBe(false);
    // Top and the forest share the fill's two seats.
    expect(laneOpen(['top', 'top'], 'jungle')).toBe(false);
    expect(laneOpen(['top'], 'jungle')).toBe(true);
    expect(laneOpen(['jungle'], 'jungle')).toBe(false);
    expect(laneRoom(['jungle'], 'top')).toBe(1);
    expect(laneOpen(['jungle', 'top'], 'top')).toBe(false);
    // What one lane holds never closes another.
    expect(laneOpen(['mid', 'bot', 'bot'], 'top')).toBe(true);
    expect(laneOpen(['mid', 'bot', 'bot'], 'jungle')).toBe(true);
  });
});

describe('the default lane', () => {
  it('is the home lane while it has room', () => {
    expect(defaultLane('Mage', [])).toBe('mid');
    expect(defaultLane('Tank', ['top'])).toBe('top');
    expect(defaultLane('Marksman', ['bot'])).toBe('bot');
    expect(defaultLane('Support', [])).toBe('bot');
  });

  it('else the lane with the most room left, ties to top, then bot, then mid', () => {
    expect(defaultLane('Mage', ['mid'])).toBe('top');
    expect(defaultLane('Mage', ['mid', 'top'])).toBe('bot');
    expect(defaultLane('Skirmisher', [])).toBe('top');
    expect(defaultLane(null, ['top', 'top'])).toBe('bot');
    expect(defaultLane('Skirmisher', ['jungle', 'bot'])).toBe('top');
    expect(defaultLane('Skirmisher', ['top', 'jungle', 'bot', 'bot'])).toBe('mid');
    expect(defaultLane('Tank', ['top', 'jungle'])).toBe('bot');
  });

  it('never sends anyone to the forest', () => {
    const asks: LanePreference[][] = [[]];
    for (let depth = 0; depth < 5; depth++) {
      for (const taken of [...asks]) {
        for (const lane of LANE_CHOICES) asks.push([...taken, lane]);
      }
    }
    for (const taken of asks) {
      for (const role of ROLES) expect(defaultLane(role, taken)).not.toBe('jungle');
    }
  });
});

describe('settling a team', () => {
  it('honors asks first come, first served, in the order given', () => {
    // Two mids: the first keeps it, the second goes to its default.
    expect(
      settleLanes([
        { role: 'Mage', lane: 'mid' },
        { role: 'Assassin', lane: 'mid' },
      ]),
    ).toEqual(['mid', 'top']);
    // The same asks the other way round.
    expect(
      settleLanes([
        { role: 'Assassin', lane: 'mid' },
        { role: 'Mage', lane: 'mid' },
      ]),
    ).toEqual(['mid', 'top']);
    // Two tops close the forest; a third ask for either is refused.
    expect(
      settleLanes([
        { role: 'Tank', lane: 'top' },
        { role: 'Fighter', lane: 'top' },
        { role: 'Assassin', lane: 'jungle' },
      ]),
    ).toEqual(['top', 'top', 'mid']);
    // The forest first leaves one top; the refused fighter goes where the
    // most room is left.
    expect(
      settleLanes([
        { role: 'Mage', lane: 'jungle' },
        { role: 'Tank', lane: 'top' },
        { role: 'Fighter', lane: 'top' },
      ]),
    ).toEqual(['jungle', 'top', 'bot']);
  });

  it('seats every seat that asked nothing after the asks, on its default over what they took', () => {
    // The unasking mage seated first still yields mid to the ask after it.
    expect(
      settleLanes([
        { role: 'Mage', lane: null },
        { role: 'Marksman', lane: 'mid' },
        { role: 'Support' },
      ]),
    ).toEqual(['top', 'mid', 'bot']);
    expect(
      settleLanes([
        { role: 'Marksman', lane: null },
        { role: 'Support', lane: null },
        { role: 'Tank', lane: null },
        { role: 'Mage', lane: null },
        { role: 'Fighter', lane: null },
      ]),
    ).toEqual(['bot', 'bot', 'top', 'mid', 'top']);
  });

  it('keeps every five-seat team inside the caps, and honors an ask exactly when it had room', () => {
    const choices: (LanePreference | null)[] = [null, ...LANE_CHOICES];
    let teams = 0;
    // Every combination of five asks, over a spread of roles.
    const walk = (asks: (LanePreference | null)[]): void => {
      if (asks.length === 5) {
        const roles = asks.map((_, i) => ROLES[(teams + i * 3) % ROLES.length]!);
        const settled = settleLanes(asks.map((lane, i) => ({ role: roles[i]!, lane })));
        expect(settled).toHaveLength(5);
        expect(within(settled), JSON.stringify({ asks, settled })).toBe(true);
        const taken: LanePreference[] = [];
        for (const [i, lane] of asks.entries()) {
          if (lane === null) continue;
          const room = laneOpen(taken, lane);
          expect(settled[i] === lane || !room, JSON.stringify({ asks, settled })).toBe(true);
          if (room) taken.push(lane);
        }
        teams += 1;
        return;
      }
      for (const lane of choices) walk([...asks, lane]);
    };
    walk([]);
    expect(teams).toBe(5 ** 5);
  });
});

describe('the forest fit', () => {
  it('is the fill forest roles; anyone may still ask', () => {
    expect(forestFit('Fighter')).toBe(true);
    expect(forestFit('Tank')).toBe(true);
    expect(forestFit('Skirmisher')).toBe(true);
    expect(forestFit('Assassin')).toBe(true);
    expect(forestFit('Mage')).toBe(false);
    expect(forestFit('Battlemage')).toBe(false);
    expect(forestFit('Marksman')).toBe(false);
    expect(forestFit('Support')).toBe(false);
    expect(settleLanes([{ role: 'Support', lane: 'jungle' }])).toEqual(['jungle']);
  });
});
