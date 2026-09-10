// Where the shop answers (src/sim/shop.ts): at the fountain pad on every
// map, and on the discs a map lists beside it. The Star Orchard's spawn
// terrace is what the discs exist for; tests/star_orchard.test.ts plays it
// through the sim.

import { describe, expect, it } from 'vitest';
import { GAME_MAP } from '../src/sim/content/map';
import { atShop, SHOP_RANGE_PAD } from '../src/sim/shop';

const HOME = GAME_MAP.fountains[0]!;
const REACH = HOME.r + SHOP_RANGE_PAD;

describe('the shop on the launch map', () => {
  it('answers within the pad plus its reach, and nowhere else', () => {
    expect(atShop(GAME_MAP, 0, { x: HOME.x, z: HOME.z })).toBe(true);
    expect(atShop(GAME_MAP, 0, { x: HOME.x + REACH, z: HOME.z })).toBe(true);
    expect(atShop(GAME_MAP, 0, { x: HOME.x + REACH + 0.01, z: HOME.z })).toBe(false);
  });

  it('is the own team fountain only', () => {
    expect(atShop(GAME_MAP, 1, { x: HOME.x, z: HOME.z })).toBe(false);
  });
});

describe('a map that lists shop discs beside the fountain', () => {
  const disc = { x: HOME.x + 20, z: HOME.z, r: 3 };
  const map = { ...GAME_MAP, fountains: [{ ...HOME, shop: [disc] }] };

  it('answers on a disc as on the pad, reach included', () => {
    expect(atShop(map, 0, { x: disc.x, z: disc.z })).toBe(true);
    expect(atShop(map, 0, { x: disc.x + disc.r + SHOP_RANGE_PAD, z: disc.z })).toBe(true);
    expect(atShop(map, 0, { x: disc.x + disc.r + SHOP_RANGE_PAD + 0.01, z: disc.z })).toBe(false);
  });

  it('leaves the ground between the pad and the disc alone', () => {
    expect(atShop(map, 0, { x: HOME.x + 12, z: HOME.z })).toBe(false);
  });

  it('still answers at the pad itself', () => {
    expect(atShop(map, 0, { x: HOME.x, z: HOME.z })).toBe(true);
  });
});
