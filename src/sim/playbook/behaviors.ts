// Behavior execution: a play's macro intent turned into one action through
// the shared micro. A behavior that cannot act this slot returns null and
// the interpreter moves on to the next play. Every default below is the
// number the scripted Laner shipped with (see micro.ts for the findings
// that set them); the playbook overrides them per play.

import { GOTO_DONE_RADIUS } from '../coach';
import { GAME_MAP } from '../content/map';
import type { Action, ObsUnit } from '../policy';
import {
  affordablePurchase,
  CAST_RANGE,
  CHAMPION_ATTACK_RANGE,
  dist,
  ESCORT_MIN,
  FARM_RANGE,
  homewardPoint,
  KILL_SECURE_HP_FRAC,
  laneDistance,
  nearest,
  pickCast,
  RECALL_MIN_HOME_DIST,
  REGROUP_AT_S,
  readySigil,
  type SlotContext,
  TOWER_DANGER_RANGE,
  towardHome,
  WARDEN_APPROACH_RANGE,
  WARDEN_FIGHT_HP_FRAC,
  WARDEN_PREP_RANGE,
  WARDEN_PREP_S,
} from './micro';
import type { Behavior, LaneId } from './types';

export function runBehavior(b: Behavior, ctx: SlotContext): Action | null {
  switch (b.kind) {
    case 'retreat':
      return retreat(ctx);
    case 'hold':
      return { kind: 'noop' };
    case 'shop':
      return shop(ctx);
    case 'goShop':
      return goShop(ctx);
    case 'avoidTower':
      return avoidTower(ctx, b.escortMin ?? ESCORT_MIN, b.hpBelow ?? 0.65);
    case 'finishSanctum':
      return finishSanctum(ctx);
    case 'fight':
      return fight(ctx);
    case 'hunt':
      return hunt(ctx, b.hpAbove ?? 0.5);
    case 'answerVanish':
      return answerVanish(ctx, b.hpAtLeast ?? 0.55);
    case 'contestWarden':
      return contestWarden(
        ctx,
        b.hpAtLeast ?? WARDEN_FIGHT_HP_FRAC,
        b.prepSeconds ?? WARDEN_PREP_S,
      );
    case 'farm':
      return farm(ctx);
    case 'takeCamp':
      return takeCamp(ctx);
    case 'siege':
      return siege(ctx, b.escortMin ?? ESCORT_MIN);
    case 'push':
      return push(
        ctx,
        b.lane ?? 'assigned',
        b.regroupAt === undefined ? REGROUP_AT_S : b.regroupAt,
      );
    case 'obeyOrder':
      return obeyOrder(ctx);
    case 'followAlly':
      return followAlly(ctx, b.keep ?? 3);
    case 'holdPosition':
      return holdPosition(ctx, b.x, b.z, b.within ?? 2);
  }
}

// Survive: with a chaser on top of it, the kit's own escape key toward home
// (hints.ts), else Riftstep toward home, else Zephyr to outrun; otherwise
// Mend if ready; otherwise recall once clear and far enough out; otherwise
// run. A hunter that just slipped into a brush is still a hunter (lastSeen
// memory).
function retreat(ctx: SlotContext): Action {
  const { s, obs, hints, fountain } = ctx;
  const chaser =
    obs.units.some(
      (u) => !u.friendly && u.kind === 'champion' && Math.hypot(u.x - s.x, u.z - s.z) <= 6,
    ) ||
    (obs.lastSeen ?? []).some(
      (ls) => obs.time - ls.at <= 2 && Math.hypot(ls.x - s.x, ls.z - s.z) <= 6,
    );
  if (chaser) {
    const escapeKey = (['Q', 'W', 'E'] as const).find(
      (k) => hints.keys[k] === 'escape' && s.abilityReady[k],
    );
    if (escapeKey) {
      const p = homewardPoint(ctx, 6);
      return { kind: 'cast', key: escapeKey, x: p.x, z: p.z };
    }
    const rift = readySigil(s, 'riftstep');
    if (rift !== -1) {
      const p = homewardPoint(ctx, 6);
      return { kind: 'sigil', slot: rift, x: p.x, z: p.z };
    }
    const zephyr = readySigil(s, 'zephyr');
    if (zephyr !== -1) return { kind: 'sigil', slot: zephyr, x: s.x, z: s.z };
  }
  if (!s.recalling) {
    // Mend before a channel, never during one: casting a sigil cancels it.
    const mendSlot = readySigil(s, 'mend');
    if (mendSlot !== -1) return { kind: 'sigil', slot: mendSlot, x: s.x, z: s.z };
    // Recall home instead of the whole walk (playtest: bots never pressed
    // B), but only once truly disengaged AND far enough out for the
    // channel to beat walking: inside RECALL_MIN_HOME_DIST the walk is
    // faster, and the whole home base sits inside that band.
    if (ctx.recallClear() && ctx.distHome() > RECALL_MIN_HOME_DIST) return { kind: 'recall' };
  }
  // On the pad, just heal: re-issuing a move to the pad center every slot
  // cleared the path and re-pathed for nothing.
  if (ctx.atFountain) return { kind: 'noop' };
  return { kind: 'move', x: fountain.x, z: fountain.z };
}

function shop(ctx: SlotContext): Action | null {
  const wanted = affordablePurchase(ctx.s);
  return wanted ? { kind: 'buy', itemId: wanted } : null;
}

// Shop trip: the bank covers the next build step and nobody is around, so
// go convert it into a power spike instead of drifting with a full purse
// (snowball review, round 2: bots only ever went home at death's door, so
// kill gold never became items and a lead never showed on the map).
function goShop(ctx: SlotContext): Action | null {
  const { fountain } = ctx;
  if (!affordablePurchase(ctx.s) || !ctx.recallClear()) return null;
  if (ctx.distHome() > RECALL_MIN_HOME_DIST) return { kind: 'recall' };
  return { kind: 'move', x: fountain.x, z: fountain.z };
}

// Tower danger: standing in reach of a live enemy tower is only worth it
// with a minion escort AND a healthy body: the tower switches aggro to any
// champion that brawls under it, so a hurt bot leaves even escorted. Unless
// a kill is right there to secure.
function avoidTower(ctx: SlotContext, escortMin: number, hpBelow: number): Action | null {
  const { s, champ, fountain } = ctx;
  const dangerTower = ctx.enemyTowers.find(
    (t) =>
      dist(s.x, s.z, t) <= TOWER_DANGER_RANGE &&
      (ctx.escortAt(t.x, t.z) < escortMin || s.hpFrac < hpBelow),
  );
  const securingKill =
    champ !== null &&
    s.hpFrac >= 0.4 &&
    champ.hpFrac < KILL_SECURE_HP_FRAC &&
    dist(s.x, s.z, champ) <= CAST_RANGE;
  if (!dangerTower || securingKill) return null;
  // Step OUT of the tower's reach, not a fixed hop: blend away-from-tower
  // with toward-home and walk just past the edge of the danger band
  // (playtest round 2: the fixed 8 toward home could stay under the gun in
  // the bent side lanes, or even walk closer).
  const dt = dist(s.x, s.z, dangerTower);
  const la = Math.hypot(s.x - dangerTower.x, s.z - dangerTower.z) || 1;
  const lh = Math.hypot(fountain.x - s.x, fountain.z - s.z) || 1;
  const dirX = (s.x - dangerTower.x) / la + (fountain.x - s.x) / lh;
  const dirZ = (s.z - dangerTower.z) / la + (fountain.z - s.z) / lh;
  const ld = Math.hypot(dirX, dirZ) || 1;
  const step = TOWER_DANGER_RANGE - dt + 2.5;
  return { kind: 'move', x: s.x + (dirX / ld) * step, z: s.z + (dirZ / ld) * step };
}

// Close out the game: a vulnerable Sanctum in reach beats everything,
// especially once it is low (measured stall: both Sanctums chipped to ~300
// hp with nobody finishing).
function finishSanctum(ctx: SlotContext): Action | null {
  const { s } = ctx;
  const sanctum = ctx.enemies.find((e) => e.kind === 'sanctum' && e.invulnerable !== true);
  if (
    sanctum &&
    dist(s.x, s.z, sanctum) <= FARM_RANGE &&
    (sanctum.hpFrac < 0.5 || ctx.escortAt(sanctum.x, sanctum.z) >= 2)
  ) {
    return { kind: 'attack', targetId: sanctum.id };
  }
  return null;
}

// Fight: Sear a kill-range target (the heal cut closes the escape), then
// the hint-driven kit (each ability at its TRUE range, the ultimate held
// behind its gates), otherwise attack.
function fight(ctx: SlotContext): Action | null {
  const { s, champ } = ctx;
  if (!champ) return null;
  const dc = dist(s.x, s.z, champ);
  if (dc <= CAST_RANGE && champ.hpFrac < KILL_SECURE_HP_FRAC) {
    const sear = readySigil(s, 'sear');
    if (sear !== -1) return { kind: 'sigil', slot: sear, x: champ.x, z: champ.z };
  }
  const cast = pickCast(ctx, champ);
  if (cast) return cast;
  if (dc <= CHAMPION_ATTACK_RANGE) return { kind: 'attack', targetId: champ.id };
  return null;
}

// The hunt into the dark: a nearly dead enemy that broke line of sight a
// breath ago is worth walking to its last seen spot, but never on low
// health and never into tower fire (lastSeen memory, playtest round 2).
function hunt(ctx: SlotContext, hpAbove: number): Action | null {
  const { s, obs } = ctx;
  if (ctx.champ || !(s.hpFrac > hpAbove)) return null;
  const prey = (obs.lastSeen ?? []).find(
    (ls) =>
      ls.hpFrac < KILL_SECURE_HP_FRAC &&
      obs.time - ls.at <= 3 &&
      Math.hypot(ls.x - s.x, ls.z - s.z) <= 12 &&
      !ctx.inTowerReach(ls.x, ls.z),
  );
  return prey ? { kind: 'move', x: prey.x, z: prey.z } : null;
}

// The vanish response: an enemy that slipped into a brush right in front
// of the bot did not stop existing. Healthy, walk the last seen spot to
// force it back into sight; hurt, give ground instead of standing where it
// disappeared (playtest: bots shrugged and went back to farming).
function answerVanish(ctx: SlotContext, hpAtLeast: number): Action | null {
  const { s, obs } = ctx;
  if (ctx.champ) return null;
  const vanished = (obs.lastSeen ?? []).find(
    (ls) => obs.time - ls.at <= 2.5 && Math.hypot(ls.x - s.x, ls.z - s.z) <= 9,
  );
  if (!vanished) return null;
  if (s.hpFrac >= hpAtLeast && !ctx.inTowerReach(vanished.x, vanished.z)) {
    return { kind: 'move', x: vanished.x, z: vanished.z };
  }
  return towardHome(ctx, 6);
}

// Contest the Warden: a live one is the team's one rendezvous. Walk to it
// healthy, fight it in reach. Shortly before the spawn clock strikes,
// healthy bots pre-position at the nearest pit; both teams read the same
// clock, so the pit becomes the mid game's fight (obs.objectiveSpawnAt).
function contestWarden(ctx: SlotContext, hpAtLeast: number, prepSeconds: number): Action | null {
  const { s, obs } = ctx;
  const { jx, jz } = ctx.jitter();
  const warden = ctx.enemies.find((u) => u.kind === 'warden');
  if (warden) {
    const dw = dist(s.x, s.z, warden);
    if (dw <= FARM_RANGE) return { kind: 'attack', targetId: warden.id };
    if (dw <= WARDEN_APPROACH_RANGE && s.hpFrac >= hpAtLeast) {
      return { kind: 'move', x: warden.x + jx, z: warden.z + jz };
    }
    return null;
  }
  if (obs.objectiveSpawnAt != null && s.hpFrac >= hpAtLeast) {
    const untilSpawn = obs.objectiveSpawnAt - obs.time;
    if (untilSpawn >= 0 && untilSpawn <= prepSeconds) {
      let pit = GAME_MAP.wardenPits[0]!;
      for (const p of GAME_MAP.wardenPits) {
        if (Math.hypot(p.x - s.x, p.z - s.z) < Math.hypot(pit.x - s.x, pit.z - s.z)) pit = p;
      }
      const dp = Math.hypot(pit.x - s.x, pit.z - s.z);
      if (dp <= 6) return { kind: 'noop' };
      if (dp <= WARDEN_PREP_RANGE) return { kind: 'move', x: pit.x + jx, z: pit.z + jz };
    }
  }
  return null;
}

function farm(ctx: SlotContext): Action | null {
  const { s } = ctx;
  const minion = nearest(
    ctx.enemies.filter((u) => u.kind === 'minion'),
    s.x,
    s.z,
  );
  if (minion && dist(s.x, s.z, minion) <= FARM_RANGE) {
    return { kind: 'attack', targetId: minion.id };
  }
  return null;
}

// Jungle detour: with no enemy champion in sight and no minion to farm, a
// visible camp nearby is free income (systems review v1: one dumb rule).
function takeCamp(ctx: SlotContext): Action | null {
  const { s } = ctx;
  if (ctx.champ) return null;
  const camp = nearest(
    ctx.enemies.filter((u) => u.kind === 'camp'),
    s.x,
    s.z,
  );
  if (camp && dist(s.x, s.z, camp) <= FARM_RANGE) return { kind: 'attack', targetId: camp.id };
  return null;
}

function siege(ctx: SlotContext, escortMin: number): Action | null {
  const { s } = ctx;
  const structure = nearest(
    ctx.enemies.filter(
      (u) => (u.kind === 'tower' || u.kind === 'sanctum') && u.invulnerable !== true,
    ),
    s.x,
    s.z,
  );
  if (
    structure &&
    dist(s.x, s.z, structure) <= FARM_RANGE &&
    ctx.escortAt(structure.x, structure.z) >= escortMin
  ) {
    return { kind: 'attack', targetId: structure.id };
  }
  return null;
}

// Push a lane: follow the most advanced friendly minion near the lane's
// polyline, else walk that lane's waypoints toward the enemy end, else walk
// at the enemy Sanctum. Unassigned seats keep the any-lane behavior. Past
// the regroup bell, every assigned bot plays mid as ONE push (playtest
// round 3: five solo pushes never converged, one bot sieged top alone all
// match). The jitter differentiates matches across seeds.
function push(ctx: SlotContext, lane: LaneId | 'assigned', regroupAt: number | null): Action {
  const { s, obs, enemySanctum } = ctx;
  const { jx, jz } = ctx.jitter();
  const laneId: LaneId | null =
    lane === 'assigned'
      ? s.lane !== null && regroupAt !== null && obs.time >= regroupAt
        ? 'mid'
        : s.lane
      : lane;
  const myLane = laneId ? GAME_MAP.lanes[laneId] : null;
  let vanguard: ObsUnit | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const m of ctx.friendlyMinions) {
    if (myLane && laneDistance(myLane, m.x, m.z) > 7) continue;
    const d = Math.hypot(m.x - enemySanctum.x, m.z - enemySanctum.z);
    if (d < bestD) {
      bestD = d;
      vanguard = m;
    }
  }
  if (vanguard) return { kind: 'move', x: vanguard.x + jx, z: vanguard.z + jz };
  if (myLane) {
    const oriented = s.team === 0 ? myLane : [...myLane].reverse();
    let idx = 0;
    let best = Number.POSITIVE_INFINITY;
    oriented.forEach((p, i) => {
      const d = Math.hypot(p.x - s.x, p.z - s.z);
      if (d < best) {
        best = d;
        idx = i;
      }
    });
    const next = oriented[Math.min(idx + 1, oriented.length - 1)]!;
    return { kind: 'move', x: next.x + jx, z: next.z + jz };
  }
  return { kind: 'move', x: enemySanctum.x + jx, z: enemySanctum.z + jz };
}

function followAlly(ctx: SlotContext, keep: number): Action | null {
  const { s, obs } = ctx;
  const ally = nearest(
    obs.units.filter((u) => u.friendly && u.kind === 'champion'),
    s.x,
    s.z,
  );
  if (!ally) return null;
  if (dist(s.x, s.z, ally) <= keep) return { kind: 'noop' };
  const { jx, jz } = ctx.jitter();
  return { kind: 'move', x: ally.x + jx, z: ally.z + jz };
}

// The coach's order, done the playbook's way: the bot's own hands, the
// owner's intent. A goto walks there (the sim clears it on arrival), a
// hold stays, a back runs home, a group sticks to the nearest ally, a
// warden goes for it whatever the health, a focus fights the named target
// while it is in sight and passes the turn otherwise.
function obeyOrder(ctx: SlotContext): Action | null {
  const { s } = ctx;
  const order = s.coachOrder ?? null;
  if (!order) return null;
  switch (order.kind) {
    case 'goto':
      return holdPosition(ctx, order.x, order.z, GOTO_DONE_RADIUS);
    case 'hold':
      return holdPosition(ctx, order.x, order.z, 2);
    case 'back':
      return retreat(ctx);
    case 'group':
      return followAlly(ctx, 4);
    case 'warden': {
      const warden = ctx.enemies.find((u) => u.kind === 'warden');
      if (warden) {
        if (dist(s.x, s.z, warden) <= FARM_RANGE) return { kind: 'attack', targetId: warden.id };
        return { kind: 'move', x: warden.x, z: warden.z };
      }
      let pit = GAME_MAP.wardenPits[0]!;
      for (const p of GAME_MAP.wardenPits) {
        if (Math.hypot(p.x - s.x, p.z - s.z) < Math.hypot(pit.x - s.x, pit.z - s.z)) pit = p;
      }
      return holdPosition(ctx, pit.x, pit.z, 6);
    }
    case 'focus': {
      const target = ctx.enemies.find((u) => u.id === order.targetId);
      if (!target) return null;
      if (target.kind === 'champion') {
        const cast = pickCast(ctx, target);
        if (cast) return cast;
      }
      return { kind: 'attack', targetId: target.id };
    }
  }
}

function holdPosition(ctx: SlotContext, x: number, z: number, within: number): Action {
  const { s } = ctx;
  if (Math.hypot(x - s.x, z - s.z) <= within) return { kind: 'noop' };
  return { kind: 'move', x, z };
}
