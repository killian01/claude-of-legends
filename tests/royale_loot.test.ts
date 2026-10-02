// Loot and levels in the battle royale (src/sim/royale/loot.ts,
// levels.ts): the next piece of the house build, landed exactly as the
// shop lands it, two for a golden cache, nothing past a finished build;
// the heals; landing at level 3 with Q, W and E, spells ranking
// themselves, experience to the last hit on the sim's own curve.

import { describe, expect, it } from 'vitest';
import { CHAMPIONS } from '../src/sim/content/champions';
import { nextKitStep, roleBuild } from '../src/sim/playbook/kit';
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
  nextPiece,
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
  it('is what the house kit walker buys next with a bottomless purse', () => {
    for (const id of Object.keys(CHAMPIONS)) {
      const step = nextKitStep(roleBuild(id), [], Number.POSITIVE_INFINITY);
      expect(step?.kind).toBe('buy');
      expect(nextPiece(id, [])?.itemId).toBe(step?.kind === 'buy' ? step.itemId : null);
    }
  });

  it('lands in the bag exactly as the shop lands the same purchase', () => {
    for (const id of ['vesk', 'maera', 'korrath']) {
      const sim = new Sim(1);
      const shopper = sim.addChampion(0, undefined, id);
      const looter = champ(id);
      for (let n = 0; n < 30; n++) {
        const step = nextKitStep(roleBuild(id), shopper.items, Number.POSITIVE_INFINITY);
        if (step === null) break;
        shopper.gold = 1e9;
        if (step.kind === 'sell') {
          expect(sim.sellItem(shopper.id, step.slot)).toBe(true);
          continue;
        }
        expect(sim.buyItem(shopper.id, step.itemId)).toBe(true);
        expect(grantPiece(looter)).toBe(step.itemId);
        expect(looter.items).toEqual(shopper.items);
        expect(looter.maxHp).toBe(shopper.maxHp);
        expect(looter.stats).toEqual(shopper.stats);
      }
    }
  });

  it('gives two for a golden cache and nothing once the build is done', () => {
    const u = champ('sylra');
    expect(GOLDEN_PIECES).toBe(2);
    expect(grantPieces(u, GOLDEN_PIECES)).toHaveLength(2);
    let given = 2;
    while (grantPiece(u) !== null) given++;
    expect(given).toBeGreaterThan(8);
    expect(nextPiece('sylra', u.items)).toBeNull();
    expect(grantPiece(u)).toBeNull();
    expect(grantPieces(u, 2)).toEqual([]);
    expect(u.gold).toBe(0);
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
    expect(takedownXp(5)).toBeCloseTo(championXp(5) * TAKEDOWN_XP_SCALE, 9);
    expect(creatureXp(110)).toBeCloseTo(110 * CAMP_XP_SCALE, 9);
  });
});
