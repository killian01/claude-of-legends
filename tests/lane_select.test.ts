// The lane row at champion select (src/ui/lane_select.ts; ADR 0026): the
// words, the preselection that follows the champion until the player
// chooses, a full lane greyed and a chosen one given up when a teammate
// filled it first, the forest's warning, and the own team's board keyed by
// seat, never by name.

import { describe, expect, it } from 'vitest';
import type { SelectClaim, SelectPlayer } from '../src/net/protocol';
import {
  botLane,
  chooseLane,
  claimsBeside,
  forestWarning,
  LANE_CHOICES,
  laneBoard,
  laneFull,
  laneTitle,
  laneWords,
  onChampion,
  preselect,
  reconcile,
  stillChoosing,
} from '../src/ui/lane_select';

describe('the words', () => {
  it('says every lane in full, and the forest as the forest', () => {
    expect(LANE_CHOICES.map(laneTitle)).toEqual(['Top lane', 'Mid lane', 'Bot lane', 'The forest']);
    expect(LANE_CHOICES.map(laneWords)).toEqual(['top lane', 'mid lane', 'bot lane', 'the forest']);
  });
});

describe('the preselection', () => {
  it("is the champion's home lane while it is open", () => {
    expect(preselect('Mage', [])).toEqual({ lane: 'mid', chosen: false });
    expect(preselect('Marksman', [])).toEqual({ lane: 'bot', chosen: false });
    expect(preselect('Tank', [])).toEqual({ lane: 'top', chosen: false });
  });

  it('is the most open lane for a skirmisher, or when the home lane is full, never the forest', () => {
    expect(preselect('Skirmisher', []).lane).toBe('top');
    expect(preselect('Mage', ['mid']).lane).toBe('top');
    expect(preselect('Skirmisher', ['top', 'top']).lane).toBe('bot');
    expect(preselect('Skirmisher', ['jungle', 'top', 'bot', 'bot']).lane).toBe('mid');
  });

  it('follows every champion click until the player chooses a lane, then stays', () => {
    let choice = preselect(null, []);
    choice = onChampion(choice, 'Mage', []);
    expect(choice.lane).toBe('mid');
    choice = onChampion(choice, 'Support', []);
    expect(choice.lane).toBe('bot');
    choice = chooseLane(choice, 'jungle', []);
    expect(choice).toEqual({ lane: 'jungle', chosen: true });
    expect(onChampion(choice, 'Mage', [])).toEqual({ lane: 'jungle', chosen: true });
  });
});

describe('a full lane', () => {
  it('is greyed and a click on it changes nothing (first come, first served)', () => {
    const start = preselect('Tank', []);
    expect(laneFull(['mid'], 'mid')).toBe(true);
    expect(chooseLane(start, 'mid', ['mid'])).toBe(start);
    // Top and the forest share two seats.
    expect(laneFull(['top', 'jungle'], 'top')).toBe(true);
    expect(laneFull(['top', 'top'], 'jungle')).toBe(true);
    expect(laneFull(['top'], 'jungle')).toBe(false);
    expect(laneFull(['bot'], 'bot')).toBe(false);
  });

  it('gives a chosen lane up when a teammate claimed it first', () => {
    const mine = chooseLane(preselect('Mage', []), 'mid', []);
    // Still open: it stands.
    expect(reconcile(mine, 'Mage', ['bot'], null)).toBe(mine);
    // A teammate's mid landed first: back to the seat's own claim on the
    // server when it has one with room, else to the preselection.
    expect(reconcile(mine, 'Mage', ['mid'], 'bot')).toEqual({ lane: 'bot', chosen: true });
    expect(reconcile(mine, 'Mage', ['mid'], null)).toEqual({ lane: 'top', chosen: false });
    expect(reconcile(mine, 'Mage', ['mid'], 'mid')).toEqual({ lane: 'top', chosen: false });
  });

  it('moves the preselection with the claims', () => {
    const pre = preselect('Mage', []);
    expect(reconcile(pre, 'Mage', ['mid'], null)).toEqual({ lane: 'top', chosen: false });
  });
});

describe('the claims beside the player', () => {
  it("are every other seat's, without the player's own or the seats that claim nothing", () => {
    const claims: SelectClaim[] = [
      { seat: 0, lane: 'mid', locked: false },
      { seat: 2, lane: 'jungle', locked: true },
      { seat: 4, lane: null, locked: false },
    ];
    expect(claimsBeside(claims, 0)).toEqual(['jungle']);
    expect(claimsBeside(claims, null)).toEqual(['mid', 'jungle']);
  });
});

describe('the forest warning', () => {
  it('warns a champion the fill would never post there, and nobody else', () => {
    expect(forestWarning('jungle', 'Sylra', 'Mage')).toBe(
      'Sylra is not built for the forest: camps will be slow.',
    );
    expect(forestWarning('jungle', 'Torv', 'Support')).not.toBeNull();
    expect(forestWarning('jungle', 'Korrath', 'Tank')).toBeNull();
    expect(forestWarning('jungle', 'Rhoka', 'Skirmisher')).toBeNull();
    expect(forestWarning('mid', 'Sylra', 'Mage')).toBeNull();
    // No champion yet: nothing to warn.
    expect(forestWarning('jungle', null, null)).toBeNull();
  });
});

describe("a bot's lane", () => {
  it("is its playbook's first, else what the seat settles on", () => {
    expect(botLane(['jungle', 'top'], 'Mage', [])).toBe('jungle');
    expect(botLane(undefined, 'Mage', [])).toBe('mid');
    expect(botLane([], 'Mage', ['mid'])).toBe('top');
  });
});

describe('the lane board', () => {
  // Two Guests can share a name: the board goes by seat.
  const players: SelectPlayer[] = [
    { name: 'Wanderer 0421', team: 0 },
    { name: 'Kira', team: 1 },
    { name: 'Wanderer 0421', team: 0 },
    { name: 'Oren', team: 0 },
  ];

  it('lists the player on the lane on their screen and teammates on their claims', () => {
    const claims: SelectClaim[] = [
      { seat: 0, lane: 'top', locked: false },
      { seat: 2, lane: 'mid', locked: true },
      { seat: 3, lane: null, locked: false },
    ];
    const board = laneBoard(claims, players, 0, 'bot');
    expect(board.map((r) => r.label)).toEqual(['Top lane', 'Mid lane', 'Bot lane', 'The forest']);
    // The player's own claim is not repeated: they are where their row says.
    expect(board.map((r) => r.who)).toEqual([[], ['Wanderer 0421'], ['You'], []]);
    expect(board.map((r) => r.own)).toEqual([false, false, true, false]);
  });

  it('puts the player first beside a teammate on the same lane', () => {
    const claims: SelectClaim[] = [{ seat: 3, lane: 'bot', locked: true }];
    expect(laneBoard(claims, players, 0, 'bot')[2]?.who).toEqual(['You', 'Oren']);
  });

  it('names the teammates who claim no lane yet, never the other team', () => {
    const claims: SelectClaim[] = [
      { seat: 0, lane: 'top', locked: false },
      { seat: 2, lane: null, locked: false },
      { seat: 3, lane: 'bot', locked: false },
    ];
    expect(stillChoosing(claims, players, 0, 0)).toEqual(['Wanderer 0421']);
    // Before the first update, everyone beside the player is still choosing.
    expect(stillChoosing([], players, 0, 0)).toEqual(['Wanderer 0421', 'Oren']);
  });
});
