// What the HUD says about points (src/ui/points_text.ts, ADR 0027), and
// what the ladder box asks the server and makes of the answer
// (src/ui/ladder_box.ts).

import { describe, expect, it } from 'vitest';
import { fetchPlace, LADDER_ROUTE, NAME_ROUTE, saveName } from '../src/ui/ladder_box';
import {
  earnedText,
  firstPointsText,
  nameHint,
  placeText,
  pointsCount,
  popText,
} from '../src/ui/points_text';

describe('the pop', () => {
  it('says the number, and the reason when it is more than a last hit', () => {
    expect(popText(1, 'last_hit')).toBe('+1');
    expect(popText(2, 'last_hit')).toBe('+2');
    expect(popText(10, 'kill')).toBe('+10 kill');
    expect(popText(8, 'assist')).toBe('+8 assist');
    expect(popText(15, 'tower')).toBe('+15 tower');
    expect(popText(15, 'creature')).toBe('+15 creature');
    expect(popText(25, 'ascendant')).toBe('+25 Ascendant');
    expect(popText(50, 'victory')).toBe('+50 victory');
    expect(popText(15, 'finish')).toBe('+15 played out');
  });

  it("says plainly, on a Guest's first points, that the match is on a ladder", () => {
    expect(firstPointsText(1)).toBe('+1 point. You are on the ladder');
    expect(firstPointsText(2)).toBe('+2 points. You are on the ladder');
  });
});

describe('the ladder box', () => {
  const guest = { rank: 12, points: 340, name: 'Wanderer 4821', guest: true, named: false };

  it('says where the player stands, or that the first points put them there', () => {
    expect(placeText(guest)).toBe('You are #12 on the ladder with 340 points.');
    expect(placeText({ ...guest, rank: 1, points: 1 })).toBe(
      'You are #1 on the ladder with 1 point.',
    );
    expect(placeText({ ...guest, rank: null, points: 0 })).toMatch(/first points/);
    expect(pointsCount(12_500)).toBe('12,500 points');
  });

  it('says what this match has banked, and nothing before its first points', () => {
    expect(earnedText(0)).toBe('');
    expect(earnedText(1)).toBe('+1 this match');
    expect(earnedText(1_250)).toBe('+1,250 this match');
  });

  it('asks a Guest for a name, and tells an account its name is its own', () => {
    expect(nameHint(guest)).toMatch(/pick the name/i);
    expect(nameHint({ ...guest, named: true, name: 'Starling' })).toMatch(/change it/i);
    expect(nameHint({ ...guest, guest: false, named: true, name: 'bob' })).toContain('bob');
  });

  it("reads the reader's own place off the public ladder", async () => {
    const asked: string[] = [];
    const get = (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return new Response(JSON.stringify({ total: 3, rows: [], me: guest }), { status: 200 });
    }) as typeof fetch;
    expect(await fetchPlace(get)).toEqual(guest);
    expect(asked).toEqual([LADDER_ROUTE]);
    const nobody = (async () =>
      new Response(JSON.stringify({ total: 0, rows: [], me: null }))) as typeof fetch;
    expect(await fetchPlace(nobody)).toBeNull();
  });

  it("saves a name, and brings back the server's words when it refuses", async () => {
    const sent: unknown[] = [];
    const ok = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push([String(input), init?.method, init?.body]);
      return new Response(JSON.stringify({ name: 'Starling' }), { status: 200 });
    }) as typeof fetch;
    expect(await saveName('Starling', ok)).toEqual({ ok: true, name: 'Starling' });
    expect(sent).toEqual([[NAME_ROUTE, 'POST', JSON.stringify({ name: 'Starling' })]]);
    const refused = (async () =>
      new Response(JSON.stringify({ error: 'Somebody already plays under that name.' }), {
        status: 409,
      })) as typeof fetch;
    expect(await saveName('bob', refused)).toEqual({
      ok: false,
      error: 'Somebody already plays under that name.',
    });
    const down = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    expect((await saveName('bob', down)).ok).toBe(false);
  });
});
