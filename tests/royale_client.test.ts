// The client's side of the battle royale on the wire (src/net/royale_client.ts):
// the messages it sends, the result it recognises, and the mode's events
// read off a snapshot, whichever tag they wear and whatever is missing.

import { describe, expect, it } from 'vitest';
import {
  isRoyaleResult,
  royaleEnterMsg,
  royaleKill,
  royaleNotes,
  startRoyale,
} from '../src/net/royale_client';
import type { RoyaleClientMsg } from '../src/net/royale_wire';

describe('entering a battle royale', () => {
  it('sends the rule set and the pick in one message', () => {
    const sent: RoyaleClientMsg[] = [];
    startRoyale((m) => sent.push(m), 'respawn', {
      championId: 'torv',
      sigils: ['zephyr', 'sear'],
      skin: 1,
    });
    expect(sent).toEqual([
      { t: 'royale', v: 'respawn', championId: 'torv', sigils: ['zephyr', 'sear'], skin: 1 },
    ]);
    expect(royaleEnterMsg('one_life', { championId: 'vesk', sigils: ['a', 'b'], skin: 0 }).v).toBe(
      'one_life',
    );
  });
});

describe('the result', () => {
  const good = {
    t: 'royale_result',
    v: 'one_life',
    place: 7,
    of: 50,
    score: 3,
    winner: null,
    top: [{ name: 'Kestrel', championId: 'torv', score: 5, bot: true }],
  };

  it('is recognised when whole', () => {
    expect(isRoyaleResult(good)).toBe(true);
    expect(isRoyaleResult({ ...good, winner: 'Kestrel' })).toBe(true);
  });

  it('is refused when anything it needs is missing', () => {
    expect(isRoyaleResult({ ...good, t: 'match_result' })).toBe(false);
    expect(isRoyaleResult({ ...good, v: 'solo' })).toBe(false);
    expect(isRoyaleResult({ ...good, place: '7' })).toBe(false);
    expect(isRoyaleResult({ ...good, top: [{ name: 'x' }] })).toBe(false);
    expect(isRoyaleResult(null)).toBe(false);
  });
});

describe("the mode's events on a snapshot", () => {
  it('reads the loot, the openings, the pads, the falls and the leader', () => {
    expect(
      royaleNotes([
        { e: 'royale_loot', unitId: 4, itemId: 'storm_staff', source: 'cache' },
        { type: 'royale_loot', unitId: 4, itemId: 'iron_shell', source: 'takedown' },
        { e: 'royale_cache', unitId: 4, cacheId: 12 },
        { e: 'royale_pad', unitId: 4, padId: 2 },
        { e: 'royale_out', unitId: 8, killerId: 4, place: 37 },
        { e: 'royale_leader', unitId: 4 },
        { e: 'royale_dusk', phase: 2 },
        { e: 'royale_land', unitId: 4 },
        { e: 'royale_end', winnerId: null },
      ]),
    ).toEqual([
      { kind: 'loot', unitId: 4, itemId: 'storm_staff', source: 'cache' },
      { kind: 'loot', unitId: 4, itemId: 'iron_shell', source: 'takedown' },
      { kind: 'cache', unitId: 4, cacheId: 12 },
      { kind: 'pad', unitId: 4, padId: 2 },
      { kind: 'out', unitId: 8, killerId: 4, place: 37 },
      { kind: 'leader', unitId: 4 },
      { kind: 'dusk', phase: 2 },
      { kind: 'land', unitId: 4 },
      { kind: 'end', winnerId: null },
    ]);
  });

  it("passes over the 5v5's events, junk, and a server that sends none", () => {
    expect(
      royaleNotes([
        { e: 'death', unitId: 1, killerId: 2 },
        { e: 'royale_loot', unitId: 4 },
        null,
        'royale_loot',
      ]),
    ).toEqual([]);
    expect(royaleNotes(undefined)).toEqual([]);
  });
});

describe('a death on a snapshot', () => {
  it('keeps the names and bot marks the server sends with it', () => {
    expect(
      royaleKill({ unitId: 3, killerId: 7, n: 'Quill', kn: 'Kestrel', vb: 1 } as never),
    ).toEqual({
      unitId: 3,
      killerId: 7,
      n: 'Quill',
      kn: 'Kestrel',
      vb: true,
    });
  });

  it('is the bare death when the server sends no names', () => {
    expect(royaleKill({ unitId: 3, killerId: 7 })).toEqual({ unitId: 3, killerId: 7 });
  });
});
