// Lanes by role (CONTEXT.md: Home lane; plan-bots phase 11): a champion's
// seat is its role's home lane while the lane has a seat open, the flex
// and the overflow take the most open lane, and every champion of a team
// holds a lane from creation, a human's seat included.

import { describe, expect, it } from 'vitest';
import { HOME_LANES, homeLane } from '../src/sim/content/champions';
import { assignLanes, type LaneSeat } from '../src/sim/lanes';
import { Sim } from '../src/sim/sim';

const seat = (home: LaneSeat['home']): LaneSeat => ({ home });

describe('lanes by role', () => {
  it('names a home lane for every role but the skirmisher', () => {
    expect(HOME_LANES.Tank).toBe('top');
    expect(HOME_LANES.Fighter).toBe('top');
    expect(HOME_LANES.Mage).toBe('mid');
    expect(HOME_LANES.Assassin).toBe('mid');
    expect(HOME_LANES.Battlemage).toBe('mid');
    expect(HOME_LANES.Marksman).toBe('bot');
    expect(HOME_LANES.Support).toBe('bot');
    expect(HOME_LANES.Skirmisher).toBeNull();
    expect(homeLane(null)).toBeNull();
    expect(homeLane(undefined)).toBeNull();
  });

  it('seats a roster lineup in its home lanes whatever the order', () => {
    const lineup = (['Marksman', 'Tank', 'Support', 'Mage', 'Fighter'] as const).map((r) =>
      seat(homeLane(r)),
    );
    expect(assignLanes(lineup)).toEqual(['bot', 'top', 'bot', 'mid', 'top']);
  });

  it('the flex takes the lane with a seat open, even when seated first', () => {
    expect(assignLanes([seat(null), seat('top'), seat('mid'), seat('bot'), seat('bot')])).toEqual([
      'top',
      'top',
      'mid',
      'bot',
      'bot',
    ]);
    expect(assignLanes([seat(null), seat('top'), seat('top'), seat('bot'), seat('bot')])).toEqual([
      'mid',
      'top',
      'top',
      'bot',
      'bot',
    ]);
  });

  it('a role past its lane seats spreads over the most open lanes', () => {
    expect(assignLanes([seat('mid'), seat('mid'), seat('mid')])).toEqual(['mid', 'top', 'bot']);
    expect(assignLanes([seat('mid'), seat('mid'), seat('mid'), seat('mid'), seat('mid')])).toEqual([
      'mid',
      'top',
      'bot',
      'top',
      'bot',
    ]);
  });

  it('a preference beats the home lane, and a sixth seat reopens the lanes', () => {
    expect(assignLanes([{ home: 'bot', prefer: 'mid' }, seat('mid')])).toEqual(['mid', 'top']);
    const six = assignLanes([
      seat('mid'),
      seat('top'),
      seat('top'),
      seat('bot'),
      seat('bot'),
      seat('mid'),
    ]);
    expect(six[5]).toBe('mid');
  });

  it('in the sim every champion holds its home lane from creation, a human seat included', () => {
    const sim = new Sim(3);
    // No policy on the first one: a human's seat, counted all the same.
    const me = sim.addChampion(0, undefined, 'vesk');
    const maera = sim.addChampion(0, undefined, 'maera');
    const korrath = sim.addChampion(0, undefined, 'korrath');
    expect(me.lane).toBe('bot');
    expect(maera.lane).toBe('bot');
    expect(korrath.lane).toBe('top');
    // The flex seated first moves to whatever lane the fixed roles leave.
    const rhoka = sim.addChampion(1, undefined, 'rhoka');
    expect(rhoka.lane).toBe('top');
    const sylra = sim.addChampion(1, undefined, 'sylra');
    expect(sylra.lane).toBe('mid');
    expect(rhoka.lane).toBe('top');
    sim.addChampion(1, undefined, 'dain');
    sim.addChampion(1, undefined, 'korrath');
    expect(rhoka.lane).toBe('bot');
  });
});
