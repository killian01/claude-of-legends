// Where the fountain is (src/sim/fountain.ts): its pad on every map, and
// the pads a map lists beside it. Healing and the shop cover all of it; the
// burn on enemies covers the fountain's own pad only. The Star Orchard's
// spawn terrace is what the pads exist for; tests/star_orchard.test.ts
// plays it through a match.

import { describe, expect, it } from 'vitest';
import { GAME_MAP } from '../src/sim/content/map';
import { FOUNTAIN_HP_FRAC_PER_S, FOUNTAIN_PAD, withinFountain } from '../src/sim/fountain';
import { Sim } from '../src/sim/sim';
import { DT } from '../src/sim/types';

const HOME = GAME_MAP.fountains[0]!;
const AWAY = GAME_MAP.fountains[1]!;
const REACH = HOME.r + FOUNTAIN_PAD;
const PAD = { x: HOME.x + 20, z: HOME.z, r: 3 };
const PADDED = { ...GAME_MAP, fountains: [{ ...HOME, pads: [PAD] }, AWAY] };

// A sim on the padded map with no towers, so nothing but the fountain
// touches a champion's health.
function quiet() {
  const sim = new Sim(1, { map: PADDED });
  for (const u of [...sim.units.values()]) if (u.kind === 'tower') sim.units.delete(u.id);
  return sim;
}

describe('where the fountain is', () => {
  it('is the pad plus its margin on the launch map, and nowhere else', () => {
    expect(withinFountain(GAME_MAP, 0, { x: HOME.x, z: HOME.z })).toBe(true);
    expect(withinFountain(GAME_MAP, 0, { x: HOME.x + REACH, z: HOME.z })).toBe(true);
    expect(withinFountain(GAME_MAP, 0, { x: HOME.x + REACH + 0.01, z: HOME.z })).toBe(false);
  });

  it('is the own team fountain only', () => {
    expect(withinFountain(GAME_MAP, 1, { x: HOME.x, z: HOME.z })).toBe(false);
  });

  it('reaches every listed pad with the same margin, and not the ground between', () => {
    expect(withinFountain(PADDED, 0, { x: PAD.x, z: PAD.z })).toBe(true);
    expect(withinFountain(PADDED, 0, { x: PAD.x + PAD.r + FOUNTAIN_PAD, z: PAD.z })).toBe(true);
    expect(withinFountain(PADDED, 0, { x: PAD.x + PAD.r + FOUNTAIN_PAD + 0.01, z: PAD.z })).toBe(
      false,
    );
    expect(withinFountain(PADDED, 0, { x: HOME.x + 12, z: HOME.z })).toBe(false);
    expect(withinFountain(PADDED, 0, { x: HOME.x, z: HOME.z })).toBe(true);
  });
});

describe('what the fountain does on a listed pad', () => {
  it('heals a champion standing there, and sells to it', () => {
    const sim = quiet();
    const me = sim.addChampion(0, { x: PAD.x, z: PAD.z });
    me.hp = me.maxHp / 2;
    const before = me.hp;
    sim.tick();
    expect(me.hp).toBeGreaterThanOrEqual(before + me.maxHp * FOUNTAIN_HP_FRAC_PER_S * DT - 1e-9);
    me.gold = 1000;
    expect(sim.buyItem(me.id, 'iron_blade')).toBe(true);
    expect(sim.sellItem(me.id, 0)).toBe(true);
  });

  it('leaves an enemy standing there alone, and burns one on the pad itself', () => {
    const sim = quiet();
    const foe = sim.addChampion(1, { x: PAD.x, z: PAD.z });
    const onPad = foe.hp;
    sim.tick();
    expect(foe.hp).toBeGreaterThanOrEqual(onPad);
    foe.pos = { x: HOME.x, z: HOME.z };
    const onFountain = foe.hp;
    sim.tick();
    expect(foe.hp).toBeLessThan(onFountain);
  });
});
