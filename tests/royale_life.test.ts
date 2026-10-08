// A Respawn life on the wash of its death (src/ui/royale_life.ts): when it
// began, what it held when it ended, and the killer's body as last seen,
// which the death takes out of the mirror on the snapshot that tells it.

import { describe, expect, it } from 'vitest';
import { CHAMPIONS } from '../src/sim/content/champions';
import { createChampion } from '../src/sim/unit';
import { RoyaleLife, SEEN_FRESH_S, SeenChampions } from '../src/ui/royale_life';

describe('a Respawn life', () => {
  it('begins on the first update in play and ends at the death, frozen there', () => {
    const life = new RoyaleLife();
    life.step(5, false, false, { assists: 0 });
    expect(life.line({ assists: 0 })).toBeNull();
    life.step(10, true, false, { assists: 0 });
    life.tookDown();
    life.step(52, true, true, { assists: 2 });
    life.step(55, true, true, { assists: 2 });
    expect(life.line({ assists: 2 })).toBe('This life: 42 s · 1 takedown · 2 assists');
  });

  it('says on which update a life begins, so the last recap is let go', () => {
    const life = new RoyaleLife();
    expect(life.step(5, false, false, { assists: 0 })).toBe(false);
    expect(life.step(10, true, false, { assists: 0 })).toBe(true);
    expect(life.step(11, true, false, { assists: 0 })).toBe(false);
    expect(life.step(20, true, true, { assists: 0 })).toBe(false);
    expect(life.step(22, true, true, { assists: 0 })).toBe(false);
    expect(life.step(25, true, false, { assists: 0 })).toBe(true);
    expect(life.step(26, true, false, { assists: 0 })).toBe(false);
  });

  it('begins again on the return, from zero', () => {
    const life = new RoyaleLife();
    life.step(10, true, false, { assists: 0 });
    life.tookDown();
    life.step(20, true, true, { assists: 1 });
    life.step(25, true, false, { assists: 1 });
    life.step(33, true, true, { assists: 1 });
    expect(life.line({ assists: 1 })).toBe('This life: 8 s');
  });

  it('counts the assists from the first row seen, and rebases on a lower one', () => {
    // A rejoin: the row arrives after the life began, with the match's
    // assists so far.
    const late = new RoyaleLife();
    late.step(10, true, false, undefined);
    late.step(11, true, false, { assists: 7 });
    late.step(30, true, true, { assists: 8 });
    expect(late.line({ assists: 8 })).toBe('This life: 20 s · 1 assist');
    // An Arrival: the bot's row, then the seat's fresh one.
    const arrived = new RoyaleLife();
    arrived.step(10, true, false, { assists: 6 });
    arrived.step(11, true, false, { assists: 0 });
    arrived.step(20, true, true, { assists: 1 });
    expect(arrived.line({ assists: 1 })).toBe('This life: 10 s · 1 assist');
  });

  it('starts no life while dead, as a rejoin onto a fallen seat', () => {
    const life = new RoyaleLife();
    life.tookDown();
    life.step(10, true, true, { assists: 0 });
    expect(life.line({ assists: 0 })).toBeNull();
    life.step(14, true, false, { assists: 0 });
    life.step(20, true, true, { assists: 0 });
    expect(life.line({ assists: 0 })).toBe('This life: 6 s');
  });
});

describe('the champions last seen', () => {
  const champion = (id: number, hp: number) => {
    const u = createChampion(id, id, { x: 0, y: 80, z: 0 }, CHAMPIONS.korrath!);
    u.level = 6;
    u.hp = hp;
    return u;
  };

  it('gives the body standing in the mirror, else as seen a moment before', () => {
    const seen = new SeenChampions();
    const killer = champion(7, 0);
    killer.hp = killer.maxHp * 0.31;
    seen.note([champion(1, 100), killer], 1, 100);
    // The death's snapshot: the killer left the mirror.
    expect(seen.body(7, undefined, 100.05)).toEqual({
      championId: 'korrath',
      level: 6,
      hp: killer.hp,
      maxHp: killer.maxHp,
    });
    // Still in sight: as it stands now.
    killer.hp = 10;
    expect(seen.body(7, killer, 100.05)?.hp).toBe(10);
    // Never the own champion; nothing seen too long ago.
    expect(seen.body(1, undefined, 100.05)).toBeNull();
    expect(seen.body(7, undefined, 100 + SEEN_FRESH_S + 0.1)).toBeNull();
  });

  it('keeps nothing of a fallen champion or anything but a champion', () => {
    const seen = new SeenChampions();
    const fallen = champion(4, 0);
    fallen.dead = true;
    seen.note([fallen], 1, 50);
    expect(seen.body(4, undefined, 50)).toBeNull();
    expect(seen.body(9, undefined, 50)).toBeNull();
  });
});
