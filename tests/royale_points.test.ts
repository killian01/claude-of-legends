// Points in a battle royale (server/royale_points.ts, ADR 0027, ADR 0031).

import { describe, expect, it } from 'vitest';
import { ACTIVE_END_TICKS } from '../server/points';
import { placeReason, RoyalePoints, royaleWeight } from '../server/royale_points';
import { FakeRoyaleSim, spot } from './royale_fake';

function world(variant: 'respawn' | 'one_life' = 'respawn') {
  const sim = new FakeRoyaleSim(variant);
  const a = sim.addChampion(0, 'fenn', spot(0, 4));
  const b = sim.addChampion(1, 'torv', spot(1, 4));
  const c = sim.addChampion(2, 'vesk', spot(2, 4));
  const camp = sim.addCamp(spot(3, 4));
  const creature = sim.addCreature(spot(3, 4));
  return { sim, a, b, c, camp, creature };
}

const seat = (clientId: number, unitId: number, lastCommandAt = 0) => ({
  clientId,
  owner: clientId * 10,
  unitId,
  lastCommandAt,
});

describe('the weight', () => {
  it('doubles with another person in the match, each an opponent', () => {
    expect(royaleWeight(1)).toBe(1);
    expect(royaleWeight(2)).toBe(2);
    expect(royaleWeight(5)).toBe(2);
  });

  it('pays One life by place: the last standing, the top five, the top ten', () => {
    expect(placeReason(1)).toBe('last_standing');
    expect(placeReason(2)).toBe('top_five');
    expect(placeReason(5)).toBe('top_five');
    expect(placeReason(6)).toBe('top_ten');
    expect(placeReason(10)).toBe('top_ten');
    expect(placeReason(11)).toBeNull();
  });
});

describe('the actions', () => {
  it('pays takedowns and assists off the counters, from the second look on', () => {
    const { sim, a } = world();
    const points = new RoyalePoints(sim, 'respawn');
    a.kills = 2;
    expect(points.observe(sim, [], [seat(1, a.id)])).toEqual([]);
    a.kills = 3;
    a.assists = 1;
    expect(points.observe(sim, [], [seat(1, a.id)])).toEqual([
      { clientId: 1, owner: 10, reason: 'kill', delta: 10 },
      { clientId: 1, owner: 10, reason: 'assist', delta: 5 },
    ]);
  });

  it('pays a camp 1, a big creature 15 and a cache 1, to the last hit', () => {
    const { sim, a, b, camp, creature } = world();
    const points = new RoyalePoints(sim, 'respawn');
    const seats = [seat(1, a.id), seat(2, b.id)];
    points.observe(sim, [], seats);
    sim.units.delete(camp.id);
    sim.units.delete(creature.id);
    const awards = points.observe(
      sim,
      [
        { type: 'death', unitId: camp.id, killerId: a.id },
        { type: 'death', unitId: creature.id, killerId: b.id },
        { type: 'royale_cache', unitId: a.id, cacheId: 4 },
      ],
      seats,
    );
    // Two people: every award doubled.
    expect(awards).toEqual([
      { clientId: 1, owner: 10, reason: 'last_hit', delta: 2 },
      { clientId: 2, owner: 20, reason: 'creature', delta: 30 },
      { clientId: 1, owner: 10, reason: 'cache', delta: 2 },
    ]);
  });

  it('earns nothing for a bot, and a seat taken over starts from what it holds', () => {
    const { sim, a } = world();
    const points = new RoyalePoints(sim, 'respawn');
    points.observe(sim, [], [seat(1, a.id)]);
    a.kills = 5;
    // The person left: the bot's takedowns are nobody's.
    expect(points.observe(sim, [], [])).toEqual([]);
    // Back again: the line starts over from the unit's counters.
    expect(points.observe(sim, [], [seat(1, a.id)])).toEqual([]);
    a.kills = 6;
    expect(points.observe(sim, [], [seat(1, a.id)])).toEqual([
      { clientId: 1, owner: 10, reason: 'kill', delta: 10 },
    ]);
  });
});

describe('the end', () => {
  it('pays One life by place when the place is known, to a seat still playing', () => {
    const { sim, a, b } = world('one_life');
    const points = new RoyalePoints(sim, 'one_life');
    sim.tickCount = ACTIVE_END_TICKS + 100;
    const seats = [seat(1, a.id, sim.tickCount - 10), seat(2, b.id, 0)];
    points.observe(sim, [], seats);
    const awards = points.observe(
      sim,
      [
        { type: 'royale_out', unitId: a.id, killerId: b.id, place: 4 },
        { type: 'royale_out', unitId: b.id, killerId: a.id, place: 3 },
      ],
      seats,
    );
    // b gave no command in the last three minutes: nothing for the place.
    expect(awards).toEqual([{ clientId: 1, owner: 10, reason: 'top_five', delta: 50 }]);
  });

  it('pays the last standing once, and nothing after the end', () => {
    const { sim, a } = world('one_life');
    const points = new RoyalePoints(sim, 'one_life');
    const seats = [seat(1, a.id)];
    points.observe(sim, [], seats);
    expect(points.observe(sim, [{ type: 'royale_end', winnerId: a.id }], seats)).toEqual([
      { clientId: 1, owner: 10, reason: 'last_standing', delta: 50 },
    ]);
    a.kills = 9;
    expect(points.observe(sim, [], seats)).toEqual([]);
  });

  it('pays Respawn 50 to the best score', () => {
    const { sim, a } = world('respawn');
    const points = new RoyalePoints(sim, 'respawn');
    const seats = [seat(1, a.id)];
    points.observe(sim, [], seats);
    expect(points.observe(sim, [{ type: 'royale_end', winnerId: a.id }], seats)).toEqual([
      { clientId: 1, owner: 10, reason: 'best_score', delta: 50 },
    ]);
  });
});
