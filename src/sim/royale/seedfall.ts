// The Seedfalls (CONTEXT.md: Seedfall): five a match from two minutes after
// landing, each called twenty seconds ahead, its impact throwing up whoever
// stands under it, its cache opened once. Pure where it can be (the
// schedule, the point drawn, the impact's reach, the reward); the mode
// drives it from stepAfterDeaths (the announce, the landing and its cache)
// and stepSeedfallImpact (the hit, right after the Dusk, so a champion it
// kills dies on the same tick). The numbers are data
// (content/royale_events.ts).
//
// The point: drawn on the announce tick from the match's stream, uniformly
// among the cache spots the draw left empty that stand on walkable ground
// away from the poles, inside the light as it will stand SEEDFALL_FORECAST_S
// after the impact and at least SEEDFALL_DEPTH_M from its edge. Respawn's
// two seeds stand SEEDFALL_PAIR_M apart, or, when the light is too small for
// that, as far apart as its spots allow. With no spot left, a point drawn
// within half the cap's radius of its center, moved to the nearest ground.

import { dealDamage } from '../combat/damage';
import { addStatus } from '../combat/status';
import {
  SEEDFALL_AIRBORNE_S,
  SEEDFALL_AT_S,
  SEEDFALL_CONTEST_M,
  SEEDFALL_CONTEST_MIN,
  SEEDFALL_DEPTH_M,
  SEEDFALL_FORECAST_S,
  SEEDFALL_HEAL,
  SEEDFALL_IMPACT_M,
  SEEDFALL_IMPACT_SHARE,
  SEEDFALL_MANA,
  SEEDFALL_PAIR_M,
  SEEDFALL_PIECES_BEFORE_GRAFTS,
  SEEDFALL_SEEDS,
  SEEDFALL_WARN_S,
} from '../content/royale_events';
import { dirTo, dist2, type Vec3 } from '../geo';
import type { ObsRoyale, ObsSeedfall } from '../policy';
import type { Rng } from '../rng';
import type { Sim } from '../sim';
import type { CombatCtx } from '../sim_context';
import { DT } from '../types';
import type { Unit } from '../unit';
import { type DuskSchedule, depthInside, duskAt } from './dusk';
import {
  along,
  type CacheSpot,
  nearPole,
  type RoyaleGround,
  type RoyaleLayout,
  randomAround,
} from './layout';
import type { RoyaleMode } from './mode';
import type { DuskCap, RoyaleVariant, SeedfallState } from './types';

// One Seedfall of the schedule: its seeds' ids, when it is called and when
// it lands, sim time.
export interface SeedfallCall {
  wave: number;
  ids: number[];
  announceAt: number;
  landsAt: number;
}

// The match's Seedfalls, fixed by the variant and the landing time: the
// same for every seed (only the points are drawn).
export function seedfallSchedule(variant: RoyaleVariant, landAt: number): SeedfallCall[] {
  const seeds = SEEDFALL_SEEDS[variant];
  return SEEDFALL_AT_S.map((at, wave) => ({
    wave,
    ids: Array.from({ length: seeds }, (_, j) => wave * seeds + j),
    announceAt: landAt + at - SEEDFALL_WARN_S,
    landsAt: landAt + at,
  }));
}

// When the first Seedfall is called: before it nobody has a Seedfall to see.
export function firstSeedfallCallAt(landAt: number): number {
  return landAt + (SEEDFALL_AT_S[0] ?? 0) - SEEDFALL_WARN_S;
}

// The light a seed must land in: the Dusk as it will stand
// SEEDFALL_FORECAST_S after the impact, the Hastening's offset applied (the
// Dusk's clock runs `duskOffset` ahead of the match's).
export function seedfallCap(schedule: DuskSchedule, landsAt: number, duskOffset: number): DuskCap {
  const d = duskAt(schedule, landsAt + SEEDFALL_FORECAST_S + duskOffset);
  return d.now.radius > 0 ? d.now : { center: { ...schedule.final }, radius: 0 };
}

// The spots a seed may land on, fixed for the match: those the cache draw
// left empty that stand on walkable ground away from the poles.
export function seedfallSpots(
  spots: readonly CacheSpot[],
  unused: readonly number[],
  layout: RoyaleLayout,
  ground: RoyaleGround,
): Vec3[] {
  const out: Vec3[] = [];
  for (const i of unused) {
    const p = spots[i]?.pos;
    if (!p || nearPole(p, layout.radius) || !ground.walkable(p)) continue;
    out.push({ ...p });
  }
  return out;
}

const FALLBACK_TRIES = 12;
// Points drawn in the deep light when no spot stands far enough from a
// Respawn seed's twin.
const PAIR_TRIES = 24;

function deepEnough(cap: DuskCap, p: Vec3): boolean {
  return cap.radius > 0 && depthInside(cap, p) >= SEEDFALL_DEPTH_M;
}

// A point drawn within `reach` of the cap's center, moved to the nearest
// walkable ground away from the poles; null when it is not deep enough.
function drawnPoint(
  rng: Rng,
  cap: DuskCap,
  reach: number,
  layout: RoyaleLayout,
  ground: RoyaleGround,
): Vec3 | null {
  const R = layout.radius;
  const p = randomAround(rng, cap.center, rng.next() * reach, R);
  const q = ground.nearestWalkable(p);
  if (!q || nearPole(q, R)) return null;
  return deepEnough(cap, q) ? q : null;
}

// A point with no spot: drawn within half the cap's radius of its center,
// moved to the nearest walkable ground, kept when it is deep enough; the
// center's nearest ground after FALLBACK_TRIES misses.
function fallbackPoint(rng: Rng, cap: DuskCap, layout: RoyaleLayout, ground: RoyaleGround): Vec3 {
  for (let i = 0; i < FALLBACK_TRIES; i++) {
    const q = drawnPoint(rng, cap, 0.5 * cap.radius, layout, ground);
    if (q) return q;
  }
  return ground.nearestWalkable(cap.center) ?? { ...cap.center };
}

// The squared chord from p to the nearest of `others` (infinite for none).
function nearest2(p: Vec3, others: readonly Vec3[]): number {
  let d = Number.POSITIVE_INFINITY;
  for (const o of others) d = Math.min(d, dist2(o, p));
  return d;
}

// A Respawn seed with no spot SEEDFALL_PAIR_M from its twin: the farthest
// from it of the free spots, of the points across the light from it, and of
// PAIR_TRIES points drawn in the deep light (the first far enough ends the
// search): as far apart as the light allows. Null when there is none.
function farthestPoint(
  rng: Rng,
  free: readonly Vec3[],
  out: readonly Vec3[],
  cap: DuskCap,
  layout: RoyaleLayout,
  ground: RoyaleGround,
): Vec3 | null {
  const pair2 = SEEDFALL_PAIR_M * SEEDFALL_PAIR_M;
  const R = layout.radius;
  let best: Vec3 | null = null;
  let bestD = -1;
  const consider = (q: Vec3 | null): void => {
    if (!q || nearPole(q, R) || !deepEnough(cap, q)) return;
    const d = nearest2(q, out);
    if (d > bestD) {
      best = q;
      bestD = d;
    }
  };
  for (const p of free) consider(p);
  const reach = cap.radius - SEEDFALL_DEPTH_M;
  if (reach <= 0) return best;
  const toTwin = out[0] ? dirTo(cap.center, out[0]) : null;
  for (const share of [1, 0.75, 0.5]) {
    if (!toTwin || bestD >= pair2) break;
    consider(ground.nearestWalkable(along(cap.center, toTwin as Vec3, -share * reach, R)));
  }
  for (let i = 0; i < PAIR_TRIES && bestD < pair2; i++) {
    consider(drawnPoint(rng, cap, reach, layout, ground));
  }
  return best;
}

// The points of one Seedfall's `count` seeds: see the header. `taken` are
// the points of the Seedfalls still standing, never drawn again.
export function drawSeedfallPoints(
  rng: Rng,
  spots: readonly Vec3[],
  cap: DuskCap,
  count: number,
  layout: RoyaleLayout,
  ground: RoyaleGround,
  taken: readonly Vec3[] = [],
): Vec3[] {
  const deep = spots.filter((p) => deepEnough(cap, p) && nearest2(p, taken) >= 1);
  const out: Vec3[] = [];
  const pair2 = SEEDFALL_PAIR_M * SEEDFALL_PAIR_M;
  for (let j = 0; j < count; j++) {
    const free = deep.filter((p) => nearest2(p, out) >= 1);
    let apart = free.filter((p) => nearest2(p, out) >= pair2);
    // The first of a pair stands where a twin can stand far enough, when
    // any spot does; else at the spot deepest from the light's center, so
    // its twin across the light stands as far as the light allows.
    if (j === 0 && count > 1 && free.length > 0) {
      const paired = apart.filter((p) => free.some((q) => dist2(p, q) >= pair2));
      if (paired.length > 0) apart = paired;
      else {
        let edge = free[0]!;
        for (const p of free) if (dist2(p, cap.center) > dist2(edge, cap.center)) edge = p;
        out.push({ ...edge });
        continue;
      }
    }
    if (apart.length > 0) {
      out.push({ ...apart[rng.int(apart.length)]! });
      continue;
    }
    const far = out.length > 0 ? farthestPoint(rng, free, out, cap, layout, ground) : null;
    out.push(far ? { ...far } : fallbackPoint(rng, cap, layout, ground));
  }
  return out;
}

// Whether a point stands under a seed's impact.
export function underImpact(at: Vec3, p: Vec3): boolean {
  return dist2(at, p) <= SEEDFALL_IMPACT_M * SEEDFALL_IMPACT_M;
}

// What a Seedfall cache pays. Until Grafts ship: two pieces, all the health
// and all the mana. The Heartwood Graft offer (CONTEXT.md: Graft) replaces
// the second piece then: SEEDFALL_PIECES and heartwood true.
export interface SeedfallReward {
  pieces: number;
  heal: number;
  mana: number;
  heartwood: boolean;
}

export function seedfallReward(): SeedfallReward {
  return {
    pieces: SEEDFALL_PIECES_BEFORE_GRAFTS,
    heal: SEEDFALL_HEAL,
    mana: SEEDFALL_MANA,
    heartwood: false,
  };
}

function due(time: number, at: number): boolean {
  return time + DT / 2 > at && time - DT / 2 <= at;
}

function cacheOf(mode: RoyaleMode, sf: SeedfallState) {
  if (sf.cacheId === null) return null;
  const caches = mode.state.caches;
  const c = caches[sf.cacheId];
  return c && c.id === sf.cacheId ? c : (caches.find((k) => k.id === sf.cacheId) ?? null);
}

// One tick of the Seedfalls after the deaths: a Seedfall called on its tick
// (its points drawn, each seed told to everyone), a seed landing on its
// tick and leaving its cache (the impact itself hit before the deaths).
export function stepSeedfalls(mode: RoyaleMode, sim: Sim): void {
  const s = mode.state;
  if (s.stage !== 'play') return;
  const time = sim.time;
  for (const sf of s.seedfalls) {
    if (sf.landed || time + 1e-9 < sf.landsAt) continue;
    sf.landed = true;
    sf.cacheId = s.caches.length;
    s.caches.push({
      id: sf.cacheId,
      pos: { ...sf.pos },
      kind: 'seedfall',
      present: true,
      respawnAt: null,
      opener: null,
      openSince: 0,
    });
    mode.tally.seedfallsLanded++;
    sim.pushEvent({ type: 'royale_seedfall_land', seedfallId: sf.id, at: { ...sf.pos } });
  }
  for (const call of mode.seedfallCalls) {
    if (!due(time, call.announceAt)) continue;
    const cap = seedfallCap(mode.schedule, call.landsAt, s.duskOffset);
    const taken = s.seedfalls.map((f) => f.pos);
    const points = drawSeedfallPoints(
      sim.rng,
      mode.seedfallSpots,
      cap,
      call.ids.length,
      mode.layout,
      mode.ground,
      taken,
    );
    call.ids.forEach((id, j) => {
      const pos = points[j]!;
      s.seedfalls.push({
        id,
        pos,
        announcedAt: time,
        landsAt: call.landsAt,
        landed: false,
        cacheId: null,
      });
      sim.pushEvent({
        type: 'royale_seedfall',
        seedfallId: id,
        at: { ...pos },
        landsAt: call.landsAt,
      });
    });
  }
}

// A seed's impact, on the tick it lands, after the Dusk and before the
// deaths: every champion on the ground within SEEDFALL_IMPACT_M takes a
// share of its maximum health as true damage and is thrown up. Like the
// Dusk's burn it is no fight: it leaves the out of combat clock and a
// cache's opening alone, and a kill it makes goes to the last enemy who hit
// the champion inside the credit window, else nobody.
export function seedfallImpact(mode: RoyaleMode, ctx: CombatCtx): void {
  for (const sf of mode.state.seedfalls) {
    if (sf.landed || ctx.time + 1e-9 < sf.landsAt) continue;
    for (const u of ctx.units.values()) {
      if (u.kind !== 'champion' || u.dead || ctx.dead.has(u.id)) continue;
      if (mode.isFlying(u.id) || u.pos.y === undefined) continue;
      if (!underImpact(sf.pos, u.pos as Vec3)) continue;
      const hitAt = u.lastDamagedAt;
      dealDamage(ctx, 0, u, u.maxHp * SEEDFALL_IMPACT_SHARE, 'true');
      u.lastDamagedAt = hitAt;
      if (ctx.dead.has(u.id)) continue;
      addStatus(u, { kind: 'airborne', until: ctx.time + SEEDFALL_AIRBORNE_S });
      u.path = [];
    }
  }
}

// A Seedfall cache opened: the tally (contested when another champion
// stands near), and the Seedfall off the list, never to come back. Returns
// what it pays; the mode hands it out. Null for any other cache.
export function openedSeedfall(mode: RoyaleMode, sim: Sim, cacheId: number): SeedfallReward | null {
  const s = mode.state;
  const i = s.seedfalls.findIndex((f) => f.cacheId === cacheId);
  if (i < 0) return null;
  const sf = s.seedfalls[i]!;
  s.seedfalls.splice(i, 1);
  mode.tally.seedfallsOpened++;
  const reach2 = SEEDFALL_CONTEST_M * SEEDFALL_CONTEST_M;
  let near = 0;
  for (const u of sim.units.values()) {
    if (u.kind !== 'champion' || u.dead || u.pos.y === undefined) continue;
    if (dist2(sf.pos, u.pos as Vec3) <= reach2) near++;
  }
  if (near >= SEEDFALL_CONTEST_MIN) mode.tally.seedfallsContested++;
  return seedfallReward();
}

// The Seedfalls as everyone sees them (ObsRoyale.seedfalls): every one
// called and not yet opened, from its call on. The champion opening a
// landed one's cache shows only while the seat's own sight sees it, or when
// the seat is the opener (ObsSeedfall.opener): the fog holds.
export function observeSeedfalls(
  mode: RoyaleMode,
  sim: Sim,
  u: Unit,
): Pick<ObsRoyale, 'seedfalls'> {
  const out: ObsSeedfall[] = [];
  for (const sf of mode.state.seedfalls) {
    const o: ObsSeedfall = {
      id: sf.id,
      x: sf.pos.x,
      y: sf.pos.y,
      z: sf.pos.z,
      landsAt: sf.landsAt,
      landed: sf.landed,
    };
    const c = cacheOf(mode, sf);
    if (c?.present && c.opener !== null) {
      if (c.opener === u.id || sim.isVisible(u.team, c.opener)) {
        o.opener = { id: c.opener, since: c.openSince };
      }
    }
    out.push(o);
  }
  return { seedfalls: out };
}
