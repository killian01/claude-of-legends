// The in-match lane guidance (CONTEXT.md: Assigned lane; ADR 0026), without
// the DOM: what the lane card says, where the seat's lane starts for it
// (the spot the card walks the champion to and the arrow points at), when
// the player has arrived, the card's life (like the feedback nudge's,
// ui/feedback_box.ts), and where the arrow stands on screen. src/ui/hud.ts
// draws the card, src/ui/minimap.ts the lane, src/ui/lane_arrow.ts the
// arrow; all of them read this. Presentation only: nothing here writes to
// the world, and the one walk the card offers is an ordinary move order.
// Every lane test takes the world's own map (the Star Orchard, ADR 0021):
// laneOf's default is the launch map, which no host plays on.

import { CAMP_FIRST_SPAWN_S } from '../sim/content/camps';
import type { GameMap, LaneId } from '../sim/content/map';
import { laneOf } from '../sim/lanes';
import type { TeamId, Vec2 } from '../sim/types';
import type { Unit } from '../sim/unit';
import { laneTitle, laneWords } from './lane_select';

// Who is in front of the screen: a person playing the seat, a coach whose
// bot plays it (ADR 0013: the bot walks itself, so no walk and no arrow),
// or a replay viewer (nothing at all: the seat is not theirs).
export type GuideMode = 'play' | 'coach' | 'watch';

// What the card says: the lane as its title ("Top lane", "The forest"),
// a line under it, and whether a tap on it walks the champion there.
export interface LaneCall {
  title: string;
  line: string;
  walk: boolean;
}

function clockOf(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function laneCall(
  lane: LaneId | null,
  mode: 'play' | 'coach',
  at: { touch: boolean; time: number; arrived: boolean },
): LaneCall {
  const where = lane ?? 'jungle';
  if (mode === 'coach') {
    return {
      title: `Your bot holds ${laneWords(where)}`,
      line: 'It walks there on its own.',
      walk: false,
    };
  }
  const tap = at.touch ? 'Tap here' : 'Click here';
  const campsUp = at.time >= CAMP_FIRST_SPAWN_S;
  if (lane === null) {
    const camps = campsUp
      ? 'Your camps are up.'
      : `Your camps rise at ${clockOf(CAMP_FIRST_SPAWN_S)}.`;
    return at.arrived
      ? { title: laneTitle(where), line: campsUp ? 'Clear your camps.' : camps, walk: false }
      : { title: laneTitle(where), line: `${camps} ${tap} to walk to the first.`, walk: true };
  }
  return at.arrived
    ? { title: laneTitle(where), line: 'You are in it. Hold it with your team.', walk: false }
    : {
        title: laneTitle(where),
        line: `Head for your first tower. ${tap} to walk there.`,
        walk: true,
      };
}

// What the target and the arrival read off a unit: a tower's lane and
// tier, where it stands, and whether it still does.
export type GuideUnit = Pick<Unit, 'kind' | 'team' | 'dead' | 'structure' | 'pos'>;

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

// The team's own forest: the camp spots nearer its fountain than the
// enemy's, the rule the Jungler bot walks by (sim/playbook/behaviors.ts).
export function ownCamps(map: GameMap, team: TeamId): Vec2[] {
  const own = map.fountains.find((f) => f.team === team);
  const enemy = map.fountains.find((f) => f.team !== team);
  if (!own) return [];
  return map.camps
    .filter((c) => !enemy || dist(c, own) <= dist(c, enemy))
    .map((c) => ({ x: c.x, z: c.z }));
}

// Where the seat's lane starts for it: the team's own front tower on that
// lane still standing (the lowest tier alive; own structures are always in
// sight, so the mirror has them too), the lane's first tower on the map
// when none stands; for the forest, the own camp nearest the own fountain.
// Null on a map that has neither.
export function laneTarget(
  map: GameMap,
  team: TeamId,
  lane: LaneId | null,
  units: Iterable<GuideUnit>,
): Vec2 | null {
  if (lane === null) {
    const fountain = map.fountains.find((f) => f.team === team);
    let best: Vec2 | null = null;
    for (const c of ownCamps(map, team)) {
      if (!fountain || !best || dist(c, fountain) < dist(best, fountain)) best = c;
    }
    return best;
  }
  let front: GuideUnit | null = null;
  for (const u of units) {
    if (u.kind !== 'tower' || u.team !== team || u.dead || u.structure?.lane !== lane) continue;
    if (!front || (u.structure?.tier ?? 3) < (front.structure?.tier ?? 3)) front = u;
  }
  if (front) return { x: front.pos.x, z: front.pos.z };
  const spot = map.towers.find((t) => t.team === team && t.lane === lane && t.tier === 1);
  return spot ? { x: spot.x, z: spot.z } : null;
}

// How far out of the base a champion in its lane's corridor has left it:
// all three lanes meet at each Sanctum, so the corridor alone reads true
// on the spawn terrace. Past the tier-3 towers on the Star Orchard.
export const ARRIVE_FROM_SANCTUM_M = 35;
// How near its first camp a forest seat has arrived.
export const ARRIVE_AT_CAMP_M = 12;

export function laneArrived(
  map: GameMap,
  team: TeamId,
  lane: LaneId | null,
  pos: Vec2,
  target: Vec2 | null,
): boolean {
  if (lane === null) return target !== null && dist(pos, target) <= ARRIVE_AT_CAMP_M;
  const sanctum = map.sanctums.find((s) => s.team === team);
  if (sanctum && dist(pos, sanctum) <= ARRIVE_FROM_SANCTUM_M) return false;
  return laneOf(pos.x, pos.z, map) === lane;
}

// The guidance as it stands: the seat's lane, its target, and whether the
// player got there, which holds for good once true (a recall later is not
// a player lost). A lane that changes under the seat starts it over.
export interface LaneGuide {
  lane: LaneId | null;
  target: Vec2 | null;
  arrived: boolean;
}

// pos is where the champion stands, null while it is dead.
export function stepGuide(
  prev: LaneGuide | null,
  map: GameMap,
  team: TeamId,
  lane: LaneId | null,
  pos: Vec2 | null,
  units: Iterable<GuideUnit>,
): LaneGuide {
  const target = laneTarget(map, team, lane, units);
  const kept = prev !== null && prev.lane === lane && prev.arrived;
  const arrived = kept || (pos !== null && laneArrived(map, team, lane, pos, target));
  return { lane, target, arrived };
}

// The card's life, in match seconds. It waits for whatever covers the
// middle of the screen (the opening shop, a menu), whenever the match
// time is by then: a slow load online starts late, and it is exactly the
// new player on a phone who needs the card. Then it stays until the player
// arrives, at least long enough to read (a newcomer who drops into a seat
// already in its lane is still told which), or until HOLD runs out, or
// until it is tapped or closed.
export const LANE_CARD_MIN = 6;
export const LANE_CARD_HOLD = 45;
// The slot stays empty a moment after the card goes, so the tap that
// walked the champion is never taken again by the feedback nudge rising
// in the same place.
export const LANE_CARD_GAP = 3;

export interface LaneCardState {
  shownAt: number | null;
  // Match time it went at, null while it has not.
  doneAt: number | null;
}

export const LANE_CARD_START: LaneCardState = { shownAt: null, doneAt: null };

export function stepLaneCard(
  state: LaneCardState,
  time: number,
  blocked: boolean,
  arrived: boolean,
): LaneCardState {
  if (state.doneAt !== null) return state;
  if (state.shownAt === null) return blocked ? state : { shownAt: time, doneAt: null };
  const up = time - state.shownAt;
  if (up >= LANE_CARD_HOLD || (arrived && up >= LANE_CARD_MIN)) return { ...state, doneAt: time };
  return state;
}

// Tapped or closed.
export function closeLaneCard(state: LaneCardState, time: number): LaneCardState {
  return state.doneAt !== null ? state : { ...state, doneAt: time };
}

export function laneCardVisible(state: LaneCardState, blocked: boolean): boolean {
  return state.shownAt !== null && state.doneAt === null && !blocked;
}

// The feedback nudge comes after the card, never beside it: one card in
// the slot at a time. True while the card is still to show, up, or just
// gone.
export function laneCardAhead(state: LaneCardState, mode: GuideMode, time: number): boolean {
  if (mode === 'watch') return false;
  return state.doneAt === null || time - state.doneAt < LANE_CARD_GAP;
}

// The arrow near the champion: a screen point, and the angle it points at
// (radians, screen axes, y down). It runs on a ring round the champion's
// body, from its feet to the top of its nameplate (the renderer knows how
// high its model's bar and name ride; HEAD_M when it does not), with a gap:
// above the name when the lane lies up the screen, below the feet when it
// lies down, beside the body otherwise. The ring is read off the screen
// each frame, so it follows the zoom and the phone's smaller figures.
export const ARROW_LEAD_M = 3;
export const ARROW_HEAD_M = 4.3;
export const ARROW_GAP_PX = 16;
export const ARROW_MIN_PX = 30;
export const ARROW_MAX_PX = 120;
// Nearer than this with the target in view, the arrow has nothing to add.
export const ARROW_NEAR_M = 24;

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ArrowPlace {
  x: number;
  y: number;
  angle: number;
}

// The ground point the arrow's direction is read from: a few meters from
// the champion toward the target. Projecting the target itself can fail
// (behind the far plane) when it is a hundred meters away.
export function leadToward(from: Vec2, to: Vec2, meters = ARROW_LEAD_M): Vec2 | null {
  const d = dist(from, to);
  if (d < 1e-6) return null;
  return { x: from.x + ((to.x - from.x) / d) * meters, z: from.z + ((to.z - from.z) / d) * meters };
}

// feet and head are the champion's feet and the top of its bar on screen,
// lead the projected lead point: the direction is the ground's, as seen.
export function arrowPlace(
  feet: ScreenPoint,
  head: ScreenPoint,
  lead: ScreenPoint,
): ArrowPlace | null {
  const dx = lead.x - feet.x;
  const dy = lead.y - feet.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const cx = (feet.x + head.x) / 2;
  const cy = (feet.y + head.y) / 2;
  const half = Math.hypot(feet.x - head.x, feet.y - head.y) / 2;
  const r = Math.max(ARROW_MIN_PX, Math.min(ARROW_MAX_PX, half + ARROW_GAP_PX));
  return { x: cx + (dx / len) * r, y: cy + (dy / len) * r, angle: Math.atan2(dy, dx) };
}

// The arrow never slips under the card above it (the card sits over the
// champion's head on a phone held sideways, where a lane up the screen
// would put the arrow): it stops just below the card's foot, still turned
// toward the lane. half is half the arrow's size in pixels.
export function clearOfCard(
  at: ArrowPlace,
  card: { left: number; right: number; bottom: number } | null,
  half: number,
): ArrowPlace {
  if (!card || at.x + half < card.left || at.x - half > card.right) return at;
  const floor = card.bottom + 4 + half;
  return at.y < floor ? { ...at, y: floor } : at;
}

// Whether a projected point lies on screen, a margin inside its edges.
export function onScreen(
  p: ScreenPoint | null,
  view: { width: number; height: number },
  margin = 40,
): boolean {
  return (
    p !== null &&
    p.x >= margin &&
    p.y >= margin &&
    p.x <= view.width - margin &&
    p.y <= view.height - margin
  );
}

// Whether the arrow shows at all: a person's seat (not a coach's, not a
// replay), alive, not arrived, with a target that is not already in view
// and close.
export function arrowWanted(
  mode: GuideMode,
  guide: LaneGuide | null,
  self: Vec2 | null,
  targetInView: boolean,
): boolean {
  if (mode !== 'play' || !guide || guide.arrived || !guide.target || !self) return false;
  return !(targetInView && dist(self, guide.target) <= ARROW_NEAR_M);
}
