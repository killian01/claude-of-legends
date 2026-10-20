// The client's side of a Thornfray on the wire (src/net/thornfray_client.ts):
// the enter and Start now messages, and tolerant readers of the gathering,
// a bout's start, the snapshot's line and the result, on the pattern of
// tests/royale_client.test.ts. And the flow it drives
// (src/game/thornfray_flow.ts): one screen across the bouts, and what
// comes after the end.

import { describe, expect, it } from 'vitest';
import { boutArrival, thornfrayNext } from '../src/game/thornfray_flow';
import { goalOnWire } from '../src/net/goal_wire';
import type { BoutStart, ThornfrayResult } from '../src/net/royale_wire';
import {
  boutLineOf,
  boutStartOf,
  isThornfrayGather,
  thornfrayEnterMsg,
  thornfrayOpenMsgs,
  thornfrayResultOf,
  thornfrayStartMsg,
} from '../src/net/thornfray_client';
import { BOUT_KINDS } from '../src/sim/content/bouts';
import { REGION_IDS } from '../src/sim/royale/layout';
import { buildBout } from './thornfray_fixture';

const START: BoutStart = {
  b: 1,
  k: ['lastwick', 'starglean', 'lastwick', 'starglean', 'lastwick', 'starglean'],
  s: 2,
  t: [
    [2, 3, 'Wren', 'torv', 0, 5, 5, 1],
    [0, 1, 'Fogtinder', 'vesk', 1, 4, 4, 0],
  ],
  p: 2,
};

const RESULT: ThornfrayResult = {
  t: 'thornfray_result',
  place: 2,
  of: 8,
  seat: 2,
  bushels: 17,
  won: 1,
  points: 45,
  table: [
    [0, 'Fogtinder', 'vesk', 1, 21, 2],
    [2, 'Wren', 'torv', 0, 17, 1],
  ],
  bouts: [{ k: 'lastwick', pl: 1, paid: 5 }],
  replays: [41, 42],
};

describe('entering a Thornfray', () => {
  it("sends the quick pick's champion, skin and sigils, and the opener's Start now", () => {
    expect(
      thornfrayEnterMsg({ championId: 'torv', sigils: ['mend', 'riftstep'], skin: 2 }),
    ).toEqual({ t: 'thornfray', championId: 'torv', sigils: ['mend', 'riftstep'], skin: 2 });
    expect(thornfrayStartMsg()).toEqual({ t: 'thornfray_start' });
  });

  it('opens its socket with the entry alone, never a hello', () => {
    // A hello takes back any other seat the account holds (a 5v5's, a
    // battle royale's): that match would play on the Thornfray's screen,
    // and the entry be ignored. The entry takes back a held Thornfray seat
    // by itself.
    const pick = { championId: 'torv', sigils: ['mend', 'riftstep'] as [string, string], skin: 2 };
    expect(thornfrayOpenMsgs(pick)).toEqual([thornfrayEnterMsg(pick)]);
  });
});

describe('reading a Thornfray off the wire', () => {
  it('reads the gathering, and nothing else as one', () => {
    const g = { t: 'thornfray_gather', people: 2, of: 8, startsIn: 13.5, opener: true };
    expect(isThornfrayGather(g)).toBe(true);
    expect(isThornfrayGather({ ...g, people: '2' })).toBe(false);
    expect(isThornfrayGather({ ...g, t: 'royale_result' })).toBe(false);
    expect(isThornfrayGather(null)).toBe(false);
  });

  it("reads a bout's start from match_start's royale block", () => {
    expect(boutStartOf({ v: 'respawn', seats: 8, tf: START })).toEqual(START);
    // A battle royale's carries none.
    expect(boutStartOf({ v: 'respawn', seats: 50 })).toBeNull();
    expect(boutStartOf(undefined)).toBeNull();
    // A bout out of range, or a kind list that does not name it.
    expect(boutStartOf({ tf: { ...START, b: 6 } })).toBeNull();
    expect(boutStartOf({ tf: { ...START, k: ['lastwick'] } })).toBeNull();
    // A row that cannot be read is left out; none at all is no table.
    const odd = { ...START, t: [...START.t, [1, 2, 'x'], 'row'] };
    expect(boutStartOf({ tf: odd })?.t).toEqual(START.t);
    expect(boutStartOf({ tf: { ...START, t: [] } })).toBeNull();
    // No prize in the first bout.
    const { p: _p, ...first } = START;
    expect(boutStartOf({ tf: { ...first, b: 0 } })).toEqual({ ...first, b: 0 });
  });

  it("reads the snapshot's line of the bout, its goals back from the wire", () => {
    const goal = goalOnWire({ shape: 'circle', at: { x: 1, y: 2, z: 3 }, radius: 6, holder: 4 });
    expect(
      boutLineOf({ tf: { c: 7, pl: 2, bc: 9, g: [goal, ['square', 0, 0, 0, 1, null]] } }),
    ).toEqual({
      c: 7,
      pl: 2,
      bc: 9,
      goals: [{ shape: 'circle', at: { x: 1, y: 2, z: 3 }, radius: 6, holder: 4 }],
    });
    expect(boutLineOf({ tf: { c: 0, pl: 1, bc: 0 } })?.goals).toEqual([]);
    expect(boutLineOf({})).toBeNull();
    expect(boutLineOf(null)).toBeNull();
    expect(boutLineOf({ tf: { c: 'x', pl: 1, bc: 0 } })).toBeNull();
  });

  it('reads the result, leaving out what cannot be read', () => {
    expect(thornfrayResultOf(RESULT)).toEqual(RESULT);
    const odd = {
      ...RESULT,
      table: [...RESULT.table, [9, 'x']],
      bouts: [...RESULT.bouts, { k: 'lastwick' }],
      replays: [41, 'x', 42],
    };
    expect(thornfrayResultOf(odd)).toEqual(RESULT);
    expect(thornfrayResultOf({ ...RESULT, place: 'second' })).toBeNull();
    expect(thornfrayResultOf({ ...RESULT, t: 'royale_result' })).toBeNull();
  });
});

describe("a Thornfray's flow", () => {
  it('follows one unit id per seat in every bout, whatever its kind and region', () => {
    // The screen keeps its champion from bout to bout (boutArrival's
    // 'switch'): buildBoutSim seats the eight in seat order on a map no
    // bout adds a unit to before them.
    const seen = new Set<string>();
    for (const kind of BOUT_KINDS) {
      for (const region of REGION_IDS) {
        if (kind.thornyard.regions && !kind.thornyard.regions.includes(region)) continue;
        seen.add(buildBout({ kind, region, seed: 9 }).unitIds.join(','));
      }
    }
    expect([...seen]).toHaveLength(1);
  });

  it('opens on the first bout, switches the screen at every later one', () => {
    expect(boutArrival(null, 3)).toBe('open');
    expect(boutArrival(3, 3)).toBe('switch');
    // Another unit to follow: the screen is built again on it.
    expect(boutArrival(3, 4)).toBe('rebuild');
  });

  it('plays again into a gathering, or opens the battle royale, or goes home', () => {
    expect(thornfrayNext('again')).toEqual({ to: 'thornfray' });
    expect(thornfrayNext('other')).toEqual({ to: 'royale', variant: 'respawn' });
    expect(thornfrayNext('menu')).toEqual({ to: 'home' });
  });
});
