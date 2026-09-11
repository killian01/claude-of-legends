// A flight whose line is blocked is refused before anything is paid
// (src/sim/combat/casting.ts): Fenn against a wall pressed Lunge, paid its
// cooldown and its mana, and went nowhere. The same gate for every
// champion's flight, humans and bots alike; a blink keeps hopping over
// terrain.

import { describe, expect, it } from 'vitest';
import { GAME_MAP } from '../src/sim/content/map';
import { Sim } from '../src/sim/sim';

describe('a blocked flight', () => {
  it('is refused unpaid when a wall stands on its line, and flies when the line is open', () => {
    const wall = GAME_MAP.walls[0]!;
    const sim = new Sim(11);
    const fenn = sim.addChampion(0, { x: wall.x - wall.r - 1.5, z: wall.z }, 'fenn');
    fenn.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    expect(sim.nav.isWalkableAt(fenn.pos.x, fenn.pos.z)).toBe(true);
    expect(sim.nav.isWalkableAt(wall.x, wall.z)).toBe(false);
    const mana = fenn.mana;
    // Through the wall: refused, nothing paid, nobody moved.
    expect(sim.castAbility(fenn.id, 'Q', { x: wall.x + wall.r, z: wall.z })).toBe(false);
    expect(fenn.cooldowns.Q ?? 0).toBe(0);
    expect(fenn.mana).toBe(mana);
    expect(fenn.activeDash).toBeNull();
    // Away from it: the flight starts and is paid.
    const start = { ...fenn.pos };
    expect(sim.castAbility(fenn.id, 'Q', { x: fenn.pos.x - 10, z: fenn.pos.z })).toBe(true);
    expect(fenn.cooldowns.Q ?? 0).toBeGreaterThan(0);
    expect(fenn.mana).toBeLessThan(mana);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(Math.hypot(fenn.pos.x - start.x, fenn.pos.z - start.z)).toBeGreaterThan(5);
  });
});
