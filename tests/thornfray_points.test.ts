// Points in a Thornfray (server/thornfray_points.ts, server/royale_points.ts,
// ADR 0027, ADR 0035): a bout pays its actions as the battle royale does and
// no end of its own; the match's end pays 40 to its first and 20 to its
// second and third, to a seat still playing, doubled by another person.

import { describe, expect, it } from 'vitest';
import { ACTIVE_END_TICKS, POINTS } from '../server/points';
import { RoyalePoints, type RoyalePointsWorld } from '../server/royale_points';
import { thornfrayEndAwards, thornfrayEndReason } from '../server/thornfray_points';

describe('the match end', () => {
  it('names the first, the second and third, and nobody below', () => {
    expect([1, 2, 3, 4, 5, 8].map(thornfrayEndReason)).toEqual([
      'thornfray_first',
      'thornfray_top_three',
      'thornfray_top_three',
      null,
      null,
      null,
    ]);
    expect(POINTS.thornfray_first).toBe(40);
    expect(POINTS.thornfray_top_three).toBe(20);
  });

  it('pays a seat still playing, doubled by another person in the match', () => {
    const places = [3, 1, 2, 4, 5, 6, 7, 8];
    const tick = 10_000;
    const alone = thornfrayEndAwards(
      places,
      [{ clientId: 9, owner: 90, seat: 1, lastOrderAt: tick }],
      tick,
    );
    expect(alone).toEqual([{ clientId: 9, owner: 90, reason: 'thornfray_first', delta: 40 }]);
    const two = thornfrayEndAwards(
      places,
      [
        { clientId: 9, owner: 90, seat: 1, lastOrderAt: tick - 10 },
        { clientId: 8, owner: 80, seat: 0, lastOrderAt: tick - ACTIVE_END_TICKS },
      ],
      tick,
    );
    expect(two).toEqual([
      { clientId: 9, owner: 90, reason: 'thornfray_first', delta: 80 },
      { clientId: 8, owner: 80, reason: 'thornfray_top_three', delta: 40 },
    ]);
  });

  it('pays nothing to a seat silent for three minutes, nor below the third', () => {
    const places = [1, 4, 2, 3, 5, 6, 7, 8];
    const tick = 10_000;
    expect(
      thornfrayEndAwards(
        places,
        [
          { clientId: 1, owner: 10, seat: 0, lastOrderAt: tick - ACTIVE_END_TICKS - 1 },
          { clientId: 2, owner: 20, seat: 1, lastOrderAt: tick },
        ],
        tick,
      ),
    ).toEqual([]);
  });
});

describe('a bout', () => {
  // One champion of One life's bout, then a takedown, its place and its end.
  function world(): RoyalePointsWorld & {
    units: Map<number, { kind: string; kills: number; assists: number }>;
  } {
    return {
      units: new Map([
        [1, { kind: 'champion', kills: 0, assists: 0 }],
        [2, { kind: 'champion', kills: 0, assists: 0 }],
      ]),
      tickCount: 0,
    };
  }
  const seat = { clientId: 5, owner: 50, unitId: 1, lastCommandAt: 0 };

  it('pays takedowns and caches, and no place nor end of its own', () => {
    const w = world();
    const bout = new RoyalePoints(w, 'one_life', null, false);
    const planet = new RoyalePoints(world(), 'one_life');
    for (const points of [bout, planet]) points.observe(w, [], [seat]);
    w.units.get(1)!.kills = 1;
    const events = [
      { type: 'death' as const, unitId: 2, killerId: 1 },
      { type: 'royale_cache' as const, unitId: 1, cacheId: 3 },
      { type: 'royale_out' as const, unitId: 1, killerId: 2, place: 2 },
      { type: 'royale_end' as const, winnerId: 2 },
    ];
    const paid = bout.observe(w, events, [seat]).map((a) => [a.reason, a.delta]);
    expect(paid).toEqual([
      ['kill', 10],
      ['cache', 1],
    ]);
    // The planet's One life pays the place on the same events.
    const whole = planet.observe(w, events, [seat]).map((a) => a.reason);
    expect(whole).toContain('top_five');
    // Over: nothing more.
    w.units.get(1)!.kills = 2;
    expect(bout.observe(w, [], [seat])).toEqual([]);
  });
});
