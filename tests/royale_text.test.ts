// What the battle royale's HUD says (src/ui/royale_text.ts): the Dusk line,
// the count, the drop's banner, the leader's badge, the cache being opened,
// the notices, the places, and the bot mark read off whatever carries it.

import { describe, expect, it } from 'vitest';
import type { SnapRoyale } from '../src/net/royale_wire';
import { ITEM_PASSIVES } from '../src/sim/content/item_passives';
import { ITEMS } from '../src/sim/content/items';
import { nextLootPiece, seatBuild } from '../src/sim/royale/loot';
import { CACHE_OPEN_S, MARK_SHOWN_S } from '../src/sim/royale/types';
import {
  BUILD_COMPLETE,
  buildComplete,
  clockText,
  completedText,
  countLine,
  dropBanner,
  duskLine,
  duskPill,
  duskTurn,
  gapText,
  isBot,
  itemGain,
  LOOT_EMPTY,
  LOOT_LABEL,
  levelText,
  lootNotice,
  lootText,
  markBadge,
  openingFraction,
  ordinal,
  outsideLight,
  passiveLine,
  peopleText,
  placeText,
  royaleHints,
  seatName,
  takedownsText,
} from '../src/ui/royale_text';

const DUSK = {
  p: 0,
  c: [0, 80, 0] as [number, number, number],
  r: 160,
  pe: 100,
  sh: 0 as const,
  b: 0,
};

const snap = (over: Partial<SnapRoyale> = {}): SnapRoyale => ({
  v: 'respawn',
  st: 'play',
  de: 10,
  end: 610,
  dusk: DUSK,
  alive: 50,
  people: 2,
  ...over,
});

describe('the Dusk line', () => {
  it('counts the calm down, then says whether the light holds or closes', () => {
    expect(duskLine(snap(), 35)).toEqual({ text: 'Dusk in 1:05', tone: 'calm' });
    expect(duskLine(snap({ dusk: { ...DUSK, p: 2, pe: 200, sh: 0 } }), 158)).toEqual({
      text: 'Light holds 0:42',
      tone: 'hold',
    });
    expect(duskLine(snap({ dusk: { ...DUSK, p: 3, pe: 300, sh: 1 } }), 282)).toEqual({
      text: 'The Dusk closes 0:18',
      tone: 'close',
    });
  });

  it('says the last light at the end', () => {
    expect(duskLine(snap({ dusk: { ...DUSK, p: 6 } }), 600).text).toBe('Last light');
    expect(duskLine(snap({ st: 'over' }), 600).text).toBe('Last light');
  });

  it('rounds up, and never counts below zero', () => {
    expect(clockText(41.2)).toBe('0:42');
    expect(clockText(60)).toBe('1:00');
    expect(clockText(-3)).toBe('0:00');
  });
});

describe('the count', () => {
  it('says who is left in One life, and the own takedowns', () => {
    expect(countLine(snap({ v: 'one_life', alive: 37, people: 2, score: 3 }))).toBe(
      '37 left · 3 takedowns',
    );
    expect(countLine(snap({ v: 'one_life', alive: 12, people: 1, score: 1 }))).toBe(
      '12 left · 1 takedown',
    );
    expect(peopleText(0)).toBe('0 people');
  });

  it('says the rank, the own takedowns and the gap to the seat above in Respawn', () => {
    expect(countLine(snap({ alive: 50, score: 3, rk: 14, gap: 2 }))).toBe(
      '#14 of 50 · 3 takedowns · 2 behind #13',
    );
    expect(countLine(snap({ alive: 50, score: 50, rk: 50, gap: 9 }))).toBe(
      '#50 of 50 · 50 takedowns · 9 behind #49',
    );
  });

  it('says the lead at the top, and a tie as level', () => {
    expect(countLine(snap({ alive: 50, score: 12, rk: 1, gap: 4 }))).toBe(
      '#1 of 50 · 12 takedowns · Leading by 4',
    );
    expect(countLine(snap({ alive: 50, score: 12, rk: 1, gap: 0 }))).toBe(
      '#1 of 50 · 12 takedowns · Tied for the lead',
    );
    expect(countLine(snap({ alive: 50, score: 7, rk: 3, gap: 0 }))).toBe(
      '#3 of 50 · 7 takedowns · Level with #2',
    );
    expect(gapText(2, 1)).toBe('1 behind #1');
  });

  it('leaves the takedowns out of the rank line on a phone', () => {
    expect(countLine(snap({ alive: 50, score: 3, rk: 14, gap: 2 }), true)).toBe(
      '#14 of 50 · 2 behind #13',
    );
    expect(countLine(snap({ alive: 50, score: 9, rk: 1, gap: 2 }), true)).toBe(
      '#1 of 50 · Leading by 2',
    );
    expect(countLine(snap({ v: 'one_life', alive: 9, score: 2 }), true)).toBe(
      '9 left · 2 takedowns',
    );
  });

  it('says only the takedowns before the first rank arrives', () => {
    expect(countLine(snap({ score: 0 }))).toBe('0 takedowns');
  });

  it('says how many are in the match during the drop', () => {
    expect(countLine(snap({ st: 'drop', alive: 50, people: 2 }))).toBe('50 in the match, 2 people');
  });
});

describe('the drop', () => {
  it('asks where to land in the words of the hands, with the seconds left', () => {
    expect(dropBanner(snap({ st: 'drop', de: 10 }), 2.4, false)).toEqual({
      text: 'Pick where to land: click the planet',
      left: '8 s',
      picked: false,
    });
    expect(dropBanner(snap({ st: 'drop', de: 10 }), 2.4, true)?.text).toBe(
      'Pick where to land: tap the planet',
    );
    expect(dropBanner(snap({ st: 'drop', de: 10, drop: [0, 80, 0] }), 9, true)).toEqual({
      text: 'Landing there: tap the planet to change it',
      left: '1 s',
      picked: true,
    });
  });

  it('is gone once everyone landed', () => {
    expect(dropBanner(snap(), 20, false)).toBeNull();
  });
});

describe('the cache being opened', () => {
  it('fills from the moment it started to the opening time', () => {
    expect(openingFraction(snap(), 5)).toBeNull();
    const r = snap({ opening: { c: 3, since: 40 } });
    expect(openingFraction(r, 40)).toBe(0);
    expect(openingFraction(r, 40 + CACHE_OPEN_S / 2)).toBeCloseTo(0.5);
    expect(openingFraction(r, 50)).toBe(1);
    expect(openingFraction(r, 30)).toBe(0);
  });
});

describe('the badge of a mark the viewer carries', () => {
  it('names the Lodestar, the Wrath, a run, and whether the globe shows them now', () => {
    const mk = (id: number, kind: 'lodestar' | 'wrath' | 'ablaze' | 'slayer', at: number) =>
      [id, kind, 0, 80, 0, at] as [number, typeof kind, number, number, number, number];
    expect(markBadge(snap({ mk: [mk(1, 'lodestar', 100)] }), 1, 102)).toEqual({
      text: 'You are the Lodestar',
      kind: 'lodestar',
      shown: true,
    });
    expect(markBadge(snap({ mk: [mk(1, 'wrath', 100)] }), 1, 100 + MARK_SHOWN_S + 1)).toEqual({
      text: 'You hold the Wrath',
      kind: 'wrath',
      shown: false,
    });
    expect(markBadge(snap({ mk: [mk(1, 'ablaze', 100)] }), 1, 101)?.text).toBe('You are Ablaze');
    expect(markBadge(snap({ mk: [mk(1, 'ablaze', 100)] }), 1, 101, true)?.text).toBe('Ablaze');
    expect(
      markBadge(snap({ mk: [mk(1, 'ablaze', 90), mk(1, 'lodestar', 90)] }), 1, 101)?.kind,
    ).toBe('lodestar');
  });

  it('stands only for the viewer, and never for a slayer', () => {
    const others = snap({ mk: [[9, 'lodestar', 0, 80, 0, 100]] });
    expect(markBadge(others, 1, 101)).toBeNull();
    expect(markBadge(snap({ mk: [[1, 'slayer', 0, 80, 0, 100]] }), 1, 101)).toBeNull();
    expect(markBadge(snap(), 1, 101)).toBeNull();
  });
});

describe('the notices and the places', () => {
  it('says the loot and the level', () => {
    expect(lootText('Storm Staff')).toBe('+ Storm Staff');
    expect(levelText(5)).toBe('Level 5');
  });

  it('says what a component adds, in words', () => {
    expect(lootNotice('iron_blade')).toEqual({
      text: '+ Iron Blade · +10 attack damage',
      completed: false,
    });
    expect(lootNotice('swift_fang').text).toBe('+ Swift Fang · +12% attack speed');
    expect(lootNotice('heart_gem').text).toBe('+ Heart Gem · +150 health');
  });

  it('says a finished item completed, with its passive, and never a component', () => {
    expect(completedText(ITEMS.iron_blade!)).toBeNull();
    expect(completedText(ITEMS.doombrand!)).toBe(
      'Completed: Doombrand · Deathmark, +12% damage to targets under 30%',
    );
    expect(lootNotice('doombrand').completed).toBe(true);
    // No passive: what it adds over its parts (two Iron Blades into 56).
    expect(itemGain(ITEMS.warbrand!).ad).toBe(36);
    expect(completedText(ITEMS.warbrand!)).toBe('Completed: Warbrand · +36 attack damage');
  });

  it("says only the item and its passive's name on a phone, where the long line wraps", () => {
    expect(completedText(ITEMS.doombrand!, true)).toBe('Completed: Doombrand · Deathmark');
    expect(lootNotice('doombrand', true)).toEqual({
      text: 'Completed: Doombrand · Deathmark',
      completed: true,
    });
    expect(completedText(ITEMS.warbrand!, true)).toBe('Completed: Warbrand');
    // A component's line is short already.
    expect(lootNotice('iron_blade', true).text).toBe('+ Iron Blade · +10 attack damage');
  });

  it("keeps each passive's short line true to its description", () => {
    for (const [id, p] of Object.entries(ITEM_PASSIVES)) {
      const line = passiveLine(id)!;
      expect(line.startsWith(`${p.name}, `)).toBe(true);
      for (const n of line.match(/[0-9.]+/g) ?? []) {
        expect(p.description, `${id}: ${n}`).toContain(n);
      }
    }
  });

  it("says Build complete once the seat's build has nothing left to give", () => {
    expect(BUILD_COMPLETE).toBe('Build complete');
    expect(buildComplete('dain', [])).toBe(false);
    // Walk the build the way the caches do.
    let bag: string[] = [];
    for (let i = 0; i < 40; i++) {
      const step = nextLootPiece(seatBuild('dain'), bag);
      if (!step) break;
      expect(buildComplete('dain', bag)).toBe(false);
      if (step.sell !== null) bag = bag.filter((_, j) => j !== step.sell);
      const def = ITEMS[step.itemId]!;
      for (const part of def.buildsFrom ?? []) {
        const at = bag.indexOf(part);
        if (at >= 0) bag.splice(at, 1);
      }
      bag.push(step.itemId);
    }
    expect(buildComplete('dain', bag)).toBe(true);
  });

  it('prices the Dusk per second on its pill', () => {
    expect(duskPill(0.03)).toBe('In the Dusk -3%/s');
    expect(duskPill(0.001)).toBe('In the Dusk -1%/s');
  });

  it('says a place in English', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 50, 101, 111].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '50th',
      '101st',
      '111th',
    ]);
    expect(placeText(7, 50)).toBe('7th of 50');
    expect(takedownsText(1)).toBe('1 takedown');
    expect(takedownsText(3)).toBe('3 takedowns');
  });
});

describe('the bot mark and the names', () => {
  it('reads the flag from the snapshot, the client world or a row, and tolerates none', () => {
    expect(isBot({ b: 1 })).toBe(true);
    expect(isBot({ bot: true })).toBe(true);
    expect(isBot({ bot: false })).toBe(false);
    expect(isBot({})).toBe(false);
    expect(isBot(undefined)).toBe(false);
  });

  it("names a seat by the name it was given, else by its champion's", () => {
    expect(seatName({ player: 'Kestrel', name: 'Torv' })).toBe('Kestrel');
    expect(seatName({ player: null, name: 'Torv' })).toBe('Torv');
  });
});

describe('the light and its turns', () => {
  it('tells outside from inside by the chord, and says nothing without a height', () => {
    const dusk = { p: 2, c: [0, 80, 0] as [number, number, number], r: 40 };
    expect(outsideLight({ x: 10, y: 79, z: 0 }, dusk)).toBe(false);
    expect(outsideLight({ x: 0, y: -80, z: 0 }, dusk)).toBe(true);
    expect(outsideLight({ x: 0, z: 0 }, dusk)).toBeNull();
    // The calm burns nobody.
    expect(outsideLight({ x: 0, y: -80, z: 0 }, { ...dusk, p: 0 })).toBe(false);
  });

  it('announces the calm ending, the light closing and the last of it going out', () => {
    expect(duskTurn(null, { p: 1, sh: 1 })).toBeNull();
    expect(duskTurn({ p: 0, sh: 0 }, { p: 1, sh: 1 })).toBe('The calm is over: the Dusk closes');
    expect(duskTurn({ p: 0, sh: 0 }, { p: 1, sh: 0 })).toBe('The calm is over: stay in the light');
    expect(duskTurn({ p: 2, sh: 0 }, { p: 2, sh: 1 })).toBe('The Dusk closes');
    expect(duskTurn({ p: 5, sh: 0 }, { p: 5, sh: 1 })).toBe('The Dusk closes on the last light');
    expect(duskTurn({ p: 5, sh: 1 }, { p: 6, sh: 0 })).toBe('The last light is out');
    expect(duskTurn({ p: 2, sh: 1 }, { p: 2, sh: 1 })).toBeNull();
    expect(duskTurn({ p: 6, sh: 0 }, { p: 6, sh: 0 })).toBeNull();
  });
});

describe('the keys and the bag in a battle royale', () => {
  it("say the mode's own verbs and none of the 5v5's", () => {
    const all = [
      royaleHints('mouse', true),
      royaleHints('mouse', false),
      royaleHints('tap', true),
      royaleHints('thumbs', true),
    ];
    for (const line of all) {
      expect(line).toMatch(/cache/);
      expect(line).not.toMatch(/shop|recall|gold|scoreboard|tower|minion|\bB\b|\bP\b|Tab/i);
    }
    expect(royaleHints('mouse', true)).toMatch(/^Click: move/);
    expect(royaleHints('mouse', false)).toMatch(/^Right-click: move/);
    expect(royaleHints('mouse', true)).toMatch(/Q W E R/);
    expect(royaleHints('mouse', true)).toMatch(/stay in the light/);
    expect(royaleHints('thumbs', true)).toMatch(/Left thumb walks/);
    // As short as the 5v5's, in the thumbs' narrow corner.
    expect(royaleHints('thumbs', true).length).toBeLessThanOrEqual(120);
  });

  it('calls the bag loot, filled by caches, camps and takedowns', () => {
    expect(LOOT_LABEL).toBe('Loot');
    expect(LOOT_EMPTY.join(' ')).toMatch(/cache/i);
    expect(LOOT_EMPTY.join(' ')).toMatch(/camps/);
    expect(LOOT_EMPTY.join(' ')).toMatch(/takedowns/);
    expect(LOOT_EMPTY.join(' ')).not.toMatch(/shop|buy|gold|sell/i);
  });
});
