// The Grafts on the screen (ui/royale_grafts.ts, render/planet_graft_aura.ts,
// the mirror in src/net/client_world.ts): what the cards say, the title and
// the grade hints, the fold (put off, a fight, the first seconds after
// landing) and the chip, the keys, the
// end card's list, where the cards and the chip stand (a row across the top
// with the champion in sight, the chip clear of the thumbs' corners), the
// aura's breath and color, and the mirror keeping the Grafts and the
// Heartwoods and sending a pick.

import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/client_world';
import type { ClientMsg } from '../src/net/protocol';
import type { SnapGraftOffer, SnapRoyale } from '../src/net/royale_wire';
import { auraOpacity, heartwoodColor } from '../src/render/planet_graft_aura';
import { GRAFT_LIST, GRAFTS } from '../src/sim/content/grafts';
import { Sim } from '../src/sim/sim';
import {
  cardOfKey,
  cardsBox,
  cardsLeaveChampionInSight,
  chipBox,
  GRADE_HINTS,
  GRAFT_SETTLE_S,
  GRAFT_TITLE,
  graftCards,
  graftChip,
  graftFolded,
  graftNames,
} from '../src/ui/royale_grafts';
import {
  announceBox,
  COMPACT_DONE_MAX_W_PX,
  championBox,
  compactNotesBox,
  compactNoteWidth,
  feedBox,
  notesLane,
  overlaps,
  type ScreenBox,
  slainBox,
  spotBox,
  stepsBox,
  topLineBox,
} from '../src/ui/royale_layout';
import { royaleEnd } from '../src/ui/royale_result';
import type { Snap } from './royale_contract_fixture';

const OFFER: SnapGraftOffer = { g: 'sprout', c: ['keen_edge', 'quick_sap', 'deep_roots'], u: 30 };

const inside = (b: ScreenBox, w: number, h: number): boolean =>
  b.left >= 0 && b.top >= 0 && b.right <= w && b.bottom <= h;

describe('the cards', () => {
  it('say the key, the name, the grade and a short concrete line', () => {
    const cards = graftCards(OFFER, null);
    expect(cards.map((c) => c.key)).toEqual(['1', '2', '3']);
    expect(cards[0]).toMatchObject({
      name: 'Keen Edge',
      grade: 'sprout',
      text: '+15% attack damage and ability power',
    });
    for (const g of GRAFT_LIST) {
      expect(g.text.length).toBeLessThanOrEqual(56);
      for (const dash of [0x2013, 0x2014]) {
        expect(g.text.includes(String.fromCharCode(dash))).toBe(false);
      }
    }
    expect(GRAFTS.reaping_graft!.text).toBe('A takedown resets your Q, W and E');
  });

  it('say what a Sprout adds to the own champion now, its stacks counted', () => {
    const me = { ad: 115, maxHp: 2000, grafts: ['keen_edge'] };
    const cards = graftCards(OFFER, me);
    // 115 is 100 with one stack: one more adds 15.
    expect(cards[0]!.delta).toBe('+15 attack damage now');
    expect(cards[1]!.delta).toBeNull();
    expect(cards[2]!.delta).toBe('+300 health now');
  });

  it('say what they are and what each grade does, with no clock: the offer waits', () => {
    // The maintainer (2026-10-04): the cards were not understood, and a
    // card taken after ten seconds left no time to read them.
    expect(GRAFT_TITLE).toBe('Choose a Graft');
    expect(graftChip()).toBe('Choose a Graft');
    expect(Object.values(GRADE_HINTS).every((h) => h.length > 0 && h.length <= 26)).toBe(true);
  });

  it('fold when put off or in a fight, never over the globe, and open again from the chip', () => {
    // sinceHit, dropping, put off, reopened, since landing
    const settled = GRAFT_SETTLE_S + 1;
    expect(graftFolded(1, false, false, false, settled)).toBe(true);
    expect(graftFolded(5, false, false, false, settled)).toBe(false);
    expect(graftFolded(null, false, false, false, settled)).toBe(false);
    expect(graftFolded(1, true, false, false, null)).toBe(false);
    expect(graftFolded(null, false, true, false, settled)).toBe(true);
    expect(graftFolded(null, false, true, true, settled)).toBe(false);
    expect(graftFolded(1, false, false, true, settled)).toBe(false);
  });

  it('fold while the champion waits to come back, unless opened from the chip', () => {
    // The death wash's four lines and the globe are the wait's: the cards
    // open covered them (a phone at 844x390, a playthrough, 2026-10-08).
    const settled = GRAFT_SETTLE_S + 1;
    expect(graftFolded(null, false, false, false, settled, true)).toBe(true);
    expect(graftFolded(30, false, false, false, settled, true)).toBe(true);
    expect(graftFolded(null, false, false, true, settled, true)).toBe(false);
    expect(graftFolded(null, false, false, false, settled, false)).toBe(false);
  });

  it('wait folded for the first seconds after landing, then open', () => {
    // Open on landing, the cards covered the first fight.
    expect(GRAFT_SETTLE_S).toBe(12);
    expect(graftFolded(null, false, false, false, 0)).toBe(true);
    expect(graftFolded(null, false, false, false, GRAFT_SETTLE_S - 0.1)).toBe(true);
    expect(graftFolded(null, false, false, false, GRAFT_SETTLE_S)).toBe(false);
    // Opened from the chip meanwhile, they stay open.
    expect(graftFolded(null, false, false, true, 3)).toBe(false);
    // Never over the globe: the drop has no landing yet.
    expect(graftFolded(null, true, false, false, null)).toBe(false);
    expect(graftFolded(null, true, false, false, 0)).toBe(false);
  });

  it('pick by the keys 1, 2 and 3 only', () => {
    expect(['1', '2', '3', '4', 'q'].map(cardOfKey)).toEqual([0, 1, 2, null, null]);
  });

  it('list the Grafts taken on the end card, a second stack once', () => {
    expect(graftNames(['keen_edge', 'chainsap', 'keen_edge'])).toEqual([
      'Keen Edge x2',
      'Chainsap',
    ]);
    const base = {
      t: 'royale_result' as const,
      v: 'one_life' as const,
      place: 3,
      of: 50,
      score: 2,
      winner: 'x',
      top: [],
    };
    expect(royaleEnd({ ...base, grafts: ['bloodsap', 'chainsap'] }).grafts).toBe(
      'Grafts: Bloodsap, Chainsap',
    );
    expect(royaleEnd(base).grafts).toBeNull();
  });
});

describe('where the cards stand', () => {
  const desks = [
    [960, 540],
    [1280, 720],
    [1920, 1080],
  ] as const;

  it('stand in a row across the top, on the screen, the champion in sight below', () => {
    // The maintainer: "faut quand meme qu'on voit le jeu".
    for (const [w, h] of desks) {
      expect(cardsLeaveChampionInSight(w, h, false)).toBe(true);
      expect(inside(cardsBox(w, false), w, h)).toBe(true);
    }
    expect(cardsLeaveChampionInSight(844, 390, true)).toBe(true);
    expect(inside(cardsBox(844, true), 844, 390)).toBe(true);
  });

  it('sets the chip in the top left corner, on the screen and off the champion', () => {
    for (const [w, h] of [...desks, [844, 390] as const]) {
      const compact = w === 844;
      const chip = chipBox(w, h, compact);
      expect(inside(chip, w, h)).toBe(true);
      expect(overlaps(chip, championBox(w, h))).toBe(false);
      expect(chip.right).toBeLessThan(w / 2);
      expect(chip.bottom).toBeLessThan(h / 4);
    }
  });

  it('keeps the chip off the banners, the badge and the pill, the spotlight, the steps and the feed on a desktop', () => {
    // At 112 px down the announcements came over it, and the badge and the
    // Dusk's pill stacked on it: it shows through every Respawn wait.
    for (const [w, h] of desks) {
      const chip = chipBox(w, h, false);
      const near: [string, ScreenBox][] = [
        ['announcement', announceBox(w)],
        ['top line', topLineBox(w, false)],
        ['spotlight', spotBox(w, h, false)],
        ['first steps', stepsBox(w)],
        ['feed', feedBox(w)],
        ['wash', slainBox(w, h)],
        ['notices', notesLane(w, h)],
      ];
      for (const [name, box] of near) expect(overlaps(chip, box), `${name} ${w}x${h}`).toBe(false);
    }
  });

  it('keeps the chip off the notices and the thumbs on a phone, the Completed line included', () => {
    const [w, h] = [844, 390];
    const chip = chipBox(w, h, true);
    for (const thumbs of [true, false]) {
      expect(overlaps(chip, compactNotesBox(w, h, thumbs)), `thumbs ${thumbs}`).toBe(false);
    }
    // The longest finished item's line fits the column the box counts.
    expect(compactNoteWidth('Completed: Doombrand \u00b7 Deathmark')).toBeLessThanOrEqual(
      COMPACT_DONE_MAX_W_PX,
    );
    const near: [string, ScreenBox][] = [
      ['top line', topLineBox(w, true)],
      ['spotlight', spotBox(w, h, true)],
      // The thumbs' hints, the touch bar's buttons, the stick's quarter
      // and the cluster's corner (ui/hud.ts, ui/thumb_cluster.ts).
      ['hints', { left: 84, top: 44, right: 234, bottom: 117 }],
      ['touch bar', { left: 8, top: 100, right: 74, bottom: 196 }],
      ['stick', { left: 0, top: 230, right: 230, bottom: 390 }],
      ['cluster', { left: w - 300, top: 160, right: w, bottom: 390 }],
    ];
    for (const [name, box] of near) expect(overlaps(chip, box), name).toBe(false);
  });
});

describe('the Heartwood on the planet', () => {
  it('breathes slowly in the Graft color', () => {
    for (let t = 0; t < 3000; t += 100) {
      expect(auraOpacity(t)).toBeGreaterThanOrEqual(0.18 - 1e-9);
      expect(auraOpacity(t)).toBeLessThanOrEqual(0.32 + 1e-9);
    }
    expect(heartwoodColor('chainsap')).toBe(GRAFTS.chainsap!.color);
    for (const g of GRAFT_LIST.filter((d) => d.grade === 'heartwood')) {
      expect(g.color).toBeTypeOf('number');
    }
  });
});

describe('the mirror', () => {
  it('keeps the own Grafts, carries a Heartwood on its champion and sends a pick', () => {
    const sent: ClientMsg[] = [];
    const world = new ClientWorld(
      (m) => sent.push(m),
      new Sim(1).map,
      null,
      () => 0,
    );
    world.applyServer({
      t: 'match_start',
      selfUnitId: 1,
      team: 0,
      royale: { v: 'respawn', seats: 4 },
    });
    const base: SnapRoyale = {
      v: 'respawn',
      st: 'play',
      de: 10,
      end: 610,
      dusk: { p: 0, c: [0, 80, 0], r: 160, pe: 100, sh: 0, b: 0.01 },
      alive: 4,
      people: 1,
    };
    const snap = (royale: SnapRoyale, hw?: string): Snap => ({
      t: 'snap',
      time: 1,
      units: [
        {
          i: 2,
          x: 0,
          y: 80,
          z: 1,
          h: 100,
          m: 100,
          k: 'champion',
          t: 1,
          c: 'dain',
          ...(hw ? { hw } : {}),
        },
      ],
      gone: [],
      projectiles: [],
      zones: [],
      walls: [],
      self: null,
      events: [],
      winner: null,
      royale,
    });
    world.applyServer(snap({ ...base, gr: ['keen_edge'], offer: OFFER }, 'chainsap'));
    expect(world.units.get(2)!.grafts).toEqual(['chainsap']);
    world.applyServer(snap(base));
    expect(world.royaleView()!.gr).toEqual(['keen_edge']);
    expect(world.royaleView()).not.toHaveProperty('offer');
    expect(world.units.get(2)!.grafts).toEqual([]);
    world.pickGraft(1, 2);
    expect(sent.at(-1)).toEqual({ t: 'graft', pick: 2 });
  });
});
