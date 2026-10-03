// Loot and levels in the battle royale (src/sim/royale/loot.ts,
// levels.ts): the next piece of the house build, landed exactly as the
// shop lands it, two for a golden cache, nothing past a finished build;
// the heals; landing at level 3 with Q, W and E, spells ranking
// themselves, experience to the last hit on the sim's own curve.

import { describe, expect, it } from 'vitest';
import { CHAMPION_LIST, CHAMPIONS } from '../src/sim/content/champions';
import { ITEM_PASSIVES } from '../src/sim/content/item_passives';
import { ITEMS } from '../src/sim/content/items';
import { PASSIVE_BY_PIECE, PASSIVE_ITEMS, PLANET_BUILDS } from '../src/sim/content/royale_builds';
import { ownedCount, roleBuild, stepToward, unsatisfied } from '../src/sim/playbook/kit';
import { championXp } from '../src/sim/rewards';
import {
  CAMP_XP_SCALE,
  creatureXp,
  grantXp,
  landingLevels,
  spendSkillPoints,
  TAKEDOWN_XP_SCALE,
  takedownXp,
} from '../src/sim/royale/levels';
import {
  GOLDEN_PIECES,
  grantPiece,
  grantPieces,
  healShare,
  nextLootPiece,
  seatBuild,
} from '../src/sim/royale/loot';
import { START_LEVEL } from '../src/sim/royale/types';
import { Sim } from '../src/sim/sim';
import { effectiveRank, xpForNext } from '../src/sim/stats';
import { createChampion, type Unit } from '../src/sim/unit';

function champ(id: string): Unit {
  const def = CHAMPIONS[id]!;
  const u = createChampion(1, 0, { x: 0, z: 0 }, def);
  u.gold = 0;
  return u;
}

describe('the next piece', () => {
  it('walks the build in order, component by component, without gold', () => {
    const build = roleBuild('vesk');
    const first = build[0]!;
    const piece = nextLootPiece(build, []);
    const comps = ITEMS[first]?.buildsFrom ?? [];
    expect(piece?.itemId).toBe(comps.length > 0 ? stepToward(first, [], false).id : first);
    expect(piece?.sell).toBeNull();
    // Targets finish in the build's order while the bag has room.
    const u = champ('vesk');
    let done = 0;
    for (let n = 0; n < 40 && u.items.length < 6; n++) {
      grantPiece(u, build);
      const left = unsatisfied(build, u.items);
      expect(build.length - left.length).toBeGreaterThanOrEqual(done);
      done = build.length - left.length;
      expect(left).toEqual(build.slice(build.length - left.length));
    }
    expect(done).toBeGreaterThan(0);
  });

  it('lands in the bag exactly as the shop lands the same purchase', () => {
    for (const id of ['vesk', 'maera', 'korrath']) {
      const sim = new Sim(1);
      const shopper = sim.addChampion(0, undefined, id);
      const looter = champ(id);
      const build = seatBuild(id);
      for (let n = 0; n < 60; n++) {
        const piece = nextLootPiece(build, shopper.items);
        if (piece === null) break;
        shopper.gold = 1e9;
        if (piece.sell !== null) expect(sim.sellItem(shopper.id, piece.sell)).toBe(true);
        expect(sim.buyItem(shopper.id, piece.itemId)).toBe(true);
        expect(grantPiece(looter, build)).toBe(piece.itemId);
        expect(looter.items).toEqual(shopper.items);
        expect(looter.maxHp).toBe(shopper.maxHp);
        expect(looter.stats).toEqual(shopper.stats);
      }
    }
  });

  it('takes the seat build, gives two for a golden cache and nothing once done', () => {
    expect(seatBuild('sylra')).toEqual([...PLANET_BUILDS.sylra!]);
    expect(seatBuild('sylra', ['heart_gem'])).toEqual(['heart_gem']);
    expect(seatBuild(null)).toEqual([...roleBuild(null)]);
    const u = champ('sylra');
    const build = seatBuild('sylra');
    expect(GOLDEN_PIECES).toBe(2);
    expect(grantPieces(u, build, GOLDEN_PIECES)).toHaveLength(2);
    let given = 2;
    while (grantPiece(u, build) !== null) {
      given++;
      expect(given).toBeLessThan(80);
    }
    expect(given).toBeGreaterThan(8);
    expect(nextLootPiece(build, u.items)).toBeNull();
    expect(grantPieces(u, build, 2)).toEqual([]);
    expect(u.gold).toBe(0);
    expect(u.items.length).toBeLessThanOrEqual(6);
  });

  it('walks a planet build for every champion, six real items, to the end', () => {
    expect(Object.keys(PLANET_BUILDS).sort()).toEqual(CHAMPION_LIST.map((c) => c.id).sort());
    for (const c of CHAMPION_LIST) {
      const build = PLANET_BUILDS[c.id]!;
      expect(build, c.id).toHaveLength(6);
      for (const id of build) expect(ITEMS[id], `${c.id} ${id}`).toBeDefined();
      const u = champ(c.id);
      let given = 0;
      while (grantPiece(u, build) !== null) {
        given++;
        expect(given).toBeLessThan(60);
      }
      expect([...u.items].sort(), c.id).toEqual([...build].sort());
    }
  });

  it('reaches an item passive by the seventh piece on every planet build', () => {
    expect(PASSIVE_BY_PIECE).toBe(7);
    for (const id of PASSIVE_ITEMS) expect(ITEM_PASSIVES[id], id).toBeDefined();
    for (const c of CHAMPION_LIST) {
      const u = champ(c.id);
      const build = seatBuild(c.id);
      let at: number | null = null;
      for (let piece = 1; piece <= PASSIVE_BY_PIECE && at === null; piece++) {
        expect(grantPiece(u, build)).not.toBeNull();
        if (u.items.some((it) => PASSIVE_ITEMS.includes(it))) at = piece;
      }
      expect(at, c.id).not.toBeNull();
    }
  });

  it('puts the shells on bruiser lines of two Heart Gems at most', () => {
    const shells = CHAMPION_LIST.filter((c) => ['Tank', 'Support', 'Fighter'].includes(c.role)).map(
      (c) => c.id,
    );
    expect(shells.sort()).toEqual(['dain', 'korrath', 'maera', 'torv']);
    for (const id of shells) {
      const build = PLANET_BUILDS[id]!;
      expect(ownedCount(build, 'heart_gem'), id).toBeLessThanOrEqual(2);
      // A bruiser line: damage as well as a body.
      const damage = build.some((it) => {
        const st = ITEMS[it]!.stats;
        return (st.ad ?? 0) > 0 || (st.ap ?? 0) > 0;
      });
      expect(damage, id).toBe(true);
    }
    // The 5v5's shell build stacked five.
    expect(ownedCount(roleBuild('torv'), 'heart_gem')).toBeGreaterThanOrEqual(5);
  });

  it('heals a share of the maximum health, never past it', () => {
    const u = champ('dain');
    u.hp = u.maxHp * 0.5;
    healShare(u, 0.3);
    expect(u.hp).toBeCloseTo(u.maxHp * 0.8, 9);
    healShare(u, 0.3);
    expect(u.hp).toBe(u.maxHp);
  });
});

describe('levels', () => {
  it('lands at level 3 with Q, W and E learned', () => {
    const u = champ('elowen');
    landingLevels(u);
    expect(u.level).toBe(START_LEVEL);
    expect(u.abilityRanks).toEqual({ Q: 1, W: 1, E: 1, R: 0 });
    expect(u.skillPoints).toBe(0);
    expect(u.xp).toBe(0);
    expect(u.maxHp).toBeGreaterThan(CHAMPIONS.elowen!.base.hp);
  });

  it('ranks the basics in turn and the ultimate at its gates', () => {
    const u = champ('torv');
    landingLevels(u);
    const ranks: string[] = [];
    while (u.level < 16) {
      grantXp(u, xpForNext(u.level) - u.xp);
      ranks.push(
        `${u.level}:${u.abilityRanks.Q}${u.abilityRanks.W}${u.abilityRanks.E}${effectiveRank(u, 'R')}`,
      );
    }
    expect(ranks.slice(0, 4)).toEqual(['4:2110', '5:2210', '6:2221', '7:3221']);
    expect(effectiveRank(u, 'R')).toBe(3);
    expect(u.skillPoints).toBe(0);
    // Past rank five on every basic the points wait.
    const capped = champ('torv');
    capped.abilityRanks = { Q: 5, W: 5, E: 5, R: 0 };
    capped.skillPoints = 2;
    spendSkillPoints(capped);
    expect(capped.skillPoints).toBe(2);
  });

  it('pays the sim bounties, scaled, to the last hit', () => {
    expect(takedownXp('one_life', 5)).toBeCloseTo(championXp(5) * TAKEDOWN_XP_SCALE.one_life, 9);
    expect(takedownXp('respawn', 5)).toBeLessThan(takedownXp('one_life', 5));
    // A fed killer learns little from a low victim, a low one much from a fed one.
    expect(takedownXp('one_life', 4, 12)).toBeLessThan(takedownXp('one_life', 4, 4) / 2);
    expect(takedownXp('one_life', 12, 4)).toBeGreaterThan(takedownXp('one_life', 12, 12));
    expect(creatureXp(110)).toBeCloseTo(110 * CAMP_XP_SCALE, 9);
  });
});
