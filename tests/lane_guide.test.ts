// The in-match lane guidance (src/ui/lane_guide.ts; ADR 0026), on the Star
// Orchard for both teams: the card's words, the spot it walks to (the own
// front tower of the lane, the own first camp for the forest), arrival
// (the corridor on the world's own map, clear of the base where the lanes
// meet), the card's life before the feedback nudge, and the arrow's place.

import { describe, expect, it } from 'vitest';
import { starOrchard } from '../server/star_orchard';
import { buildMatchSim } from '../src/net/replay';
import { CAMP_FIRST_SPAWN_S } from '../src/sim/content/camps';
import type { LaneId } from '../src/sim/content/map';
import { laneOf } from '../src/sim/lanes';
import type { TeamId } from '../src/sim/types';
import { NUDGE_START, nudgeVisible, stepNudge } from '../src/ui/feedback_box';
import {
  ARRIVE_FROM_SANCTUM_M,
  ARROW_GAP_PX,
  ARROW_MAX_PX,
  ARROW_MIN_PX,
  arrowPlace,
  arrowWanted,
  clearOfCard,
  closeLaneCard,
  LANE_CARD_GAP,
  LANE_CARD_HOLD,
  LANE_CARD_MIN,
  LANE_CARD_START,
  type LaneCardState,
  laneArrived,
  laneCall,
  laneCardAhead,
  laneCardVisible,
  laneTarget,
  leadToward,
  onScreen,
  ownCamps,
  stepGuide,
  stepLaneCard,
} from '../src/ui/lane_guide';

const orchard = starOrchard();
const map = orchard.map;
const TEAMS: readonly TeamId[] = [0, 1];
const LANES: readonly LaneId[] = ['top', 'mid', 'bot'];

// A Sim on the export with its towers standing and no seats.
const towersOf = () => [...buildMatchSim(orchard, 5, []).sim.units.values()];

const firstTower = (team: TeamId, lane: LaneId) =>
  map.towers.find((t) => t.team === team && t.lane === lane && t.tier === 1)!;

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

describe('the words', () => {
  it('says every lane in full, and the forest as the forest', () => {
    const at = { touch: false, time: 0, arrived: false };
    expect(LANES.map((l) => laneCall(l, 'play', at).title)).toEqual([
      'Top lane',
      'Mid lane',
      'Bot lane',
    ]);
    expect(laneCall(null, 'play', at).title).toBe('The forest');
  });

  it('sends the player to the first tower, by the device in hand', () => {
    const mouse = laneCall('top', 'play', { touch: false, time: 0, arrived: false });
    expect(mouse.line).toBe('Head for your first tower. Click here to walk there.');
    expect(mouse.walk).toBe(true);
    const touch = laneCall('bot', 'play', { touch: true, time: 0, arrived: false });
    expect(touch.line).toBe('Head for your first tower. Tap here to walk there.');
  });

  it('gives the forest its camp clock', () => {
    const early = laneCall(null, 'play', { touch: false, time: 3, arrived: false });
    expect(CAMP_FIRST_SPAWN_S).toBe(30);
    expect(early.line).toBe('Your camps rise at 0:30. Click here to walk to the first.');
    const late = laneCall(null, 'play', { touch: true, time: 40, arrived: false });
    expect(late.line).toBe('Your camps are up. Tap here to walk to the first.');
  });

  it('offers no walk once the player is there (a newcomer dropped into a seat in its lane)', () => {
    const there = laneCall('mid', 'play', { touch: false, time: 200, arrived: true });
    expect(there).toEqual({
      title: 'Mid lane',
      line: 'You are in it. Hold it with your team.',
      walk: false,
    });
    expect(laneCall(null, 'play', { touch: false, time: 10, arrived: true }).walk).toBe(false);
  });

  it('tells a coach where the bot plays, with no walk: the bot walks itself', () => {
    const coach = laneCall('top', 'coach', { touch: false, time: 0, arrived: false });
    expect(coach).toEqual({
      title: 'Your bot holds top lane',
      line: 'It walks there on its own.',
      walk: false,
    });
    expect(laneCall(null, 'coach', { touch: true, time: 0, arrived: false }).title).toBe(
      'Your bot holds the forest',
    );
  });
});

describe('the spot the card walks to', () => {
  const units = towersOf();

  it("is the own team's first tower on the lane, for both teams", () => {
    for (const team of TEAMS) {
      for (const lane of LANES) {
        const t = firstTower(team, lane);
        expect(laneTarget(map, team, lane, units)).toEqual({ x: t.x, z: t.z });
      }
    }
  });

  it('moves back to the next tower when the first has fallen', () => {
    const fallen = units.map((u) =>
      u.kind === 'tower' && u.team === 0 && u.structure?.lane === 'top' && u.structure.tier === 1
        ? { ...u, dead: true }
        : u,
    );
    const second = map.towers.find((t) => t.team === 0 && t.lane === 'top' && t.tier === 2)!;
    expect(laneTarget(map, 0, 'top', fallen)).toEqual({ x: second.x, z: second.z });
    // The other team's towers of that lane are never the target.
    expect(laneTarget(map, 1, 'top', fallen)).toEqual({
      x: firstTower(1, 'top').x,
      z: firstTower(1, 'top').z,
    });
  });

  it("falls back to the map's first tower when the world shows none", () => {
    for (const team of TEAMS) {
      const t = firstTower(team, 'mid');
      expect(laneTarget(map, team, 'mid', [])).toEqual({ x: t.x, z: t.z });
    }
  });

  it('is the own camp nearest the own fountain for the forest', () => {
    for (const team of TEAMS) {
      const own = map.fountains.find((f) => f.team === team)!;
      const enemy = map.fountains.find((f) => f.team !== team)!;
      const camps = ownCamps(map, team);
      expect(camps.length).toBeGreaterThan(0);
      for (const c of camps) expect(dist(c, own)).toBeLessThanOrEqual(dist(c, enemy));
      const target = laneTarget(map, team, null, units)!;
      expect(camps).toContainEqual(target);
      for (const c of camps) expect(dist(target, own)).toBeLessThanOrEqual(dist(c, own));
    }
    // The two forests share no camp.
    const mine = ownCamps(map, 0).map((c) => `${c.x},${c.z}`);
    for (const c of ownCamps(map, 1)) expect(mine).not.toContain(`${c.x},${c.z}`);
  });
});

describe('arrival', () => {
  it('is never read on the spawn terrace, where every lane meets', () => {
    for (const team of TEAMS) {
      const sanctum = map.sanctums.find((s) => s.team === team)!;
      const fountain = map.fountains.find((f) => f.team === team)!;
      // The trap the Sanctum guard is for: the corridor alone reads a lane
      // there.
      expect(laneOf(sanctum.x, sanctum.z, map)).not.toBeNull();
      for (const lane of LANES) {
        expect(laneArrived(map, team, lane, sanctum, null)).toBe(false);
        expect(laneArrived(map, team, lane, fountain, null)).toBe(false);
      }
    }
  });

  it('is read at the first tower of the own lane and nowhere else, for both teams', () => {
    for (const team of TEAMS) {
      for (const lane of LANES) {
        const t = firstTower(team, lane);
        for (const other of LANES) {
          expect(laneArrived(map, team, other, t, t)).toBe(other === lane);
        }
      }
    }
  });

  it('starts past the Sanctum ring, along the lane', () => {
    for (const team of TEAMS) {
      const sanctum = map.sanctums.find((s) => s.team === team)!;
      for (const lane of LANES) {
        // Walk the lane out of the own base and find the first point read
        // as arrived: it lies just past the ring, inside the corridor.
        const points = team === 0 ? map.lanes[lane] : [...map.lanes[lane]].reverse();
        let found: { x: number; z: number } | null = null;
        for (let i = 0; i + 1 < points.length && !found; i++) {
          const a = points[i]!;
          const b = points[i + 1]!;
          for (let k = 0; k <= 40 && !found; k++) {
            const p = { x: a.x + ((b.x - a.x) * k) / 40, z: a.z + ((b.z - a.z) * k) / 40 };
            if (laneArrived(map, team, lane, p, null)) found = p;
          }
        }
        expect(found).not.toBeNull();
        expect(dist(found!, sanctum)).toBeGreaterThan(ARRIVE_FROM_SANCTUM_M);
        expect(dist(found!, sanctum)).toBeLessThan(ARRIVE_FROM_SANCTUM_M + 3);
      }
    }
  });

  it('is near the first camp for the forest', () => {
    for (const team of TEAMS) {
      const target = laneTarget(map, team, null, [])!;
      expect(laneArrived(map, team, null, target, target)).toBe(true);
      const fountain = map.fountains.find((f) => f.team === team)!;
      expect(laneArrived(map, team, null, fountain, target)).toBe(false);
    }
  });

  it('holds once read, and a lane that changes starts it over', () => {
    const t = firstTower(0, 'top');
    const fountain = map.fountains.find((f) => f.team === 0)!;
    let g = stepGuide(null, map, 0, 'top', fountain, []);
    expect(g.arrived).toBe(false);
    g = stepGuide(g, map, 0, 'top', t, []);
    expect(g.arrived).toBe(true);
    // Recalled home: still arrived.
    g = stepGuide(g, map, 0, 'top', fountain, []);
    expect(g.arrived).toBe(true);
    // Dealt another lane mid-match: guided again, to the new lane.
    g = stepGuide(g, map, 0, 'bot', fountain, []);
    expect(g).toEqual({
      lane: 'bot',
      target: { x: firstTower(0, 'bot').x, z: firstTower(0, 'bot').z },
      arrived: false,
    });
    // Dead: no arrival read from where the body lies.
    expect(stepGuide(null, map, 0, 'top', null, []).arrived).toBe(false);
  });

  it('is reached by the one move order the card gives, before the tower, for both teams', () => {
    for (const [team, lane] of [
      [0, 'top'],
      [1, 'bot'],
      [1, 'mid'],
    ] as const) {
      const { sim, unitIds } = buildMatchSim(orchard, 7, [
        { name: 'p', team, championId: 'vesk', sigils: ['riftstep', 'mend'], lanes: [lane] },
      ]);
      const self = sim.units.get(unitIds[0]!)!;
      expect(self.lane).toBe(lane);
      let guide = stepGuide(null, map, team, self.lane, self.pos, sim.units.values());
      expect(guide.arrived).toBe(false);
      const target = guide.target!;
      sim.orderMove(self.id, target.x, target.z);
      let arrivedAt: number | null = null;
      for (let i = 0; i < 20 * 60 && arrivedAt === null; i++) {
        sim.tick();
        guide = stepGuide(guide, map, team, self.lane, self.pos, sim.units.values());
        if (guide.arrived) arrivedAt = sim.time;
      }
      expect(arrivedAt).not.toBeNull();
      // Arrived in the lane well before the walk's end at the tower.
      expect(dist(self.pos, target)).toBeGreaterThan(10);
    }
  });
});

describe('the card', () => {
  const run = (
    steps: readonly { time: number; blocked: boolean; arrived: boolean }[],
  ): { state: LaneCardState; shown: boolean[] } => {
    let state = LANE_CARD_START;
    const shown: boolean[] = [];
    for (const s of steps) {
      state = stepLaneCard(state, s.time, s.blocked, s.arrived);
      shown.push(laneCardVisible(state, s.blocked));
    }
    return { state, shown };
  };

  it('waits for the opening shop, then stays until the player arrives', () => {
    const { state, shown } = run([
      { time: 1, blocked: true, arrived: false },
      { time: 9, blocked: false, arrived: false },
      { time: 20, blocked: false, arrived: false },
      { time: 25, blocked: false, arrived: true },
    ]);
    expect(shown).toEqual([false, true, true, false]);
    expect(state).toEqual({ shownAt: 9, doneAt: 25 });
  });

  it('goes for good when tapped or closed', () => {
    let state = stepLaneCard(LANE_CARD_START, 8, false, false);
    state = closeLaneCard(state, 10);
    expect(state).toEqual({ shownAt: 8, doneAt: 10 });
    expect(closeLaneCard(state, 12)).toEqual(state);
    expect(stepLaneCard(state, 12, false, false)).toEqual(state);
    expect(laneCardVisible(state, false)).toBe(false);
  });

  it('is not tied to the top of the match: a slow load still gets it', () => {
    const { shown } = run([
      { time: 83, blocked: false, arrived: false },
      { time: 90, blocked: false, arrived: false },
    ]);
    expect(shown).toEqual([true, true]);
  });

  it('stays long enough to read when the player is already there, and goes on its clock', () => {
    const there = run([
      { time: 300, blocked: false, arrived: true },
      { time: 300 + LANE_CARD_MIN - 0.5, blocked: false, arrived: true },
      { time: 300 + LANE_CARD_MIN, blocked: false, arrived: true },
    ]);
    expect(there.shown).toEqual([true, true, false]);
    const lost = run([
      { time: 4, blocked: false, arrived: false },
      { time: 4 + LANE_CARD_HOLD - 1, blocked: false, arrived: false },
      { time: 4 + LANE_CARD_HOLD, blocked: false, arrived: false },
    ]);
    expect(lost.shown).toEqual([true, true, false]);
  });

  it('hides under a menu and comes back', () => {
    const { shown } = run([
      { time: 5, blocked: false, arrived: false },
      { time: 6, blocked: true, arrived: false },
      { time: 7, blocked: false, arrived: false },
    ]);
    expect(shown).toEqual([true, false, true]);
  });

  it('goes before the feedback nudge, one card in the slot at a time', () => {
    // The HUD's order: the card steps first, and the nudge waits on it the
    // way it waits on the shop.
    let card = LANE_CARD_START;
    let nudge = NUDGE_START;
    const both: [boolean, boolean][] = [];
    for (let t = 0; t <= 80; t += 0.5) {
      const shop = t < 6;
      const arrived = t >= 24;
      card = stepLaneCard(card, t, shop, arrived);
      const blocked = shop || laneCardAhead(card, 'play', t);
      nudge = stepNudge(nudge, t, blocked);
      both.push([laneCardVisible(card, shop), nudgeVisible(nudge, blocked)]);
    }
    expect(both.some(([c, n]) => c && n)).toBe(false);
    const firstCard = both.findIndex(([c]) => c);
    const firstNudge = both.findIndex(([, n]) => n);
    expect(firstCard).toBe(12);
    // The card goes on arrival at 24; the slot stays empty a moment, so
    // the tap that walked is never taken by the nudge rising under it.
    expect(both[firstNudge - 1]).toEqual([false, false]);
    expect(firstNudge * 0.5).toBe(24 + LANE_CARD_GAP);
    // A replay has no card, so nothing holds the nudge back there.
    expect(laneCardAhead(LANE_CARD_START, 'watch', 0)).toBe(false);
  });

  it('holds the nudge back a moment after a tap too', () => {
    const tapped = closeLaneCard(stepLaneCard(LANE_CARD_START, 7, false, false), 9);
    expect(laneCardAhead(tapped, 'play', 9 + LANE_CARD_GAP - 0.1)).toBe(true);
    expect(laneCardAhead(tapped, 'play', 9 + LANE_CARD_GAP)).toBe(false);
  });
});

describe('the arrow', () => {
  // A champion standing at (400, 300) with the top of its bar 90 px up.
  const feet = { x: 400, y: 300 };
  const head = { x: 400, y: 210 };

  it('rides a ring round the body, clear of the bar above and the feet below', () => {
    const r = 45 + ARROW_GAP_PX;
    const right = arrowPlace(feet, head, { x: 430, y: 300 })!;
    expect(right).toEqual({ x: 400 + r, y: 255, angle: 0 });
    const up = arrowPlace(feet, head, { x: 400, y: 280 })!;
    expect(up.x).toBeCloseTo(400);
    expect(up.y).toBeCloseTo(head.y - ARROW_GAP_PX);
    expect(up.angle).toBeCloseTo(-Math.PI / 2);
    const down = arrowPlace(feet, head, { x: 400, y: 320 })!;
    expect(down.y).toBeCloseTo(feet.y + ARROW_GAP_PX);
    expect(arrowPlace(feet, head, feet)).toBeNull();
  });

  it('keeps its ring between bounds at any zoom', () => {
    const tiny = arrowPlace(feet, { x: 400, y: 296 }, { x: 430, y: 300 })!;
    expect(tiny.x - 400).toBeCloseTo(ARROW_MIN_PX);
    const huge = arrowPlace(feet, { x: 400, y: -300 }, { x: 430, y: 300 })!;
    expect(huge.x - 400).toBeCloseTo(ARROW_MAX_PX);
  });

  it('stops under the card rather than slipping beneath it, still turned to the lane', () => {
    const card = { left: 259, right: 585, bottom: 138 };
    const up = { x: 424, y: 137, angle: -Math.PI / 2 };
    expect(clearOfCard(up, card, 11)).toEqual({ x: 424, y: 153, angle: -Math.PI / 2 });
    // Beside the card, or below it already, or no card up: where it was.
    expect(clearOfCard({ ...up, x: 620 }, card, 11)).toEqual({ ...up, x: 620 });
    expect(clearOfCard({ ...up, y: 200 }, card, 11)).toEqual({ ...up, y: 200 });
    expect(clearOfCard(up, null, 11)).toEqual(up);
  });

  it('reads its direction off a lead point a few meters along the ground', () => {
    const lead = leadToward({ x: 10, z: 10 }, { x: 10, z: 110 }, 3)!;
    expect(lead).toEqual({ x: 10, z: 13 });
    expect(leadToward({ x: 5, z: 5 }, { x: 5, z: 5 })).toBeNull();
  });

  it('knows a point on screen from one past its edge', () => {
    const view = { width: 844, height: 390 };
    expect(onScreen({ x: 422, y: 195 }, view)).toBe(true);
    expect(onScreen({ x: 830, y: 195 }, view)).toBe(false);
    expect(onScreen(null, view)).toBe(false);
  });

  it("shows for a person's seat only, until arrival, and not over a target in view nearby", () => {
    const target = { x: 50, z: 50 };
    const guide = { lane: 'top' as const, target, arrived: false };
    const far = { x: 10, z: 10 };
    expect(arrowWanted('play', guide, far, false)).toBe(true);
    expect(arrowWanted('coach', guide, far, false)).toBe(false);
    expect(arrowWanted('watch', guide, far, false)).toBe(false);
    expect(arrowWanted('play', { ...guide, arrived: true }, far, false)).toBe(false);
    expect(arrowWanted('play', guide, null, false)).toBe(false);
    expect(arrowWanted('play', guide, { x: 45, z: 45 }, true)).toBe(false);
    expect(arrowWanted('play', guide, { x: 45, z: 45 }, false)).toBe(true);
    expect(arrowWanted('play', guide, far, true)).toBe(true);
  });
});
