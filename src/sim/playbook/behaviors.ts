// Behavior execution: a play's macro intent turned into one action through
// the shared micro. A behavior that cannot act this slot returns null and
// the interpreter moves on to the next play. Every default below is the
// number the scripted Laner shipped with (see micro.ts for the findings
// that set them); the playbook overrides them per play.

import { GOTO_DONE_RADIUS } from '../coach';
import { CHAMPIONS, type ChampionRole } from '../content/champions';
import { GAME_MAP } from '../content/map';
import type { Action, ObsUnit } from '../policy';
import { nextKitStep } from './kit';
import {
  BESIDE_RANGE,
  CAST_RANGE,
  CHAMPION_ATTACK_RANGE,
  CHASE_RANGE,
  dist,
  ESCORT_MIN,
  FARM_RANGE,
  FIGHT_TARGET_RADIUS,
  hardCCd,
  homewardPoint,
  JOIN_RANGE,
  KILL_SECURE_HP_FRAC,
  KITE_APPROACH,
  KITE_DANGER_FRAC,
  KITE_STEP,
  laneDistance,
  nearest,
  pickCast,
  RANGED_MIN_RANGE,
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
import { fightOdds } from './odds';
import type { Alone, Behavior, LaneId, Stance, TargetRule } from './types';
import { lastHit, manageWave } from './wave';

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
    case 'sell':
      return sellNamed(ctx, b.item);
    case 'avoidTower':
      return avoidTower(ctx, b.escortMin ?? ESCORT_MIN, b.hpBelow ?? 0.65);
    case 'finishSanctum':
      return finishSanctum(ctx);
    case 'fight':
      return fight(ctx, b.stance ?? 'auto', b.target ?? 'nearest', b.alone ?? 'engage', b.commitAt);
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
      return b.mode === 'lastHit' ? lastHit(ctx) : farm(ctx);
    case 'manageWave':
      return manageWave(ctx, b.intent);
    case 'defendTower':
      return defendTower(ctx, b.within ?? 200);
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
    case 'joinAlly':
      return joinAlly(ctx, b.within ?? JOIN_RANGE);
    case 'fallBack':
      return fallBack(ctx);
    case 'splitPush':
      return push(ctx, quietestLane(ctx), null);
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

// The kit's next step (ADR 0014): the next purchase toward the build in
// force, or the sale that makes room for it. Both need the fountain; the
// sim refuses either elsewhere, and a sale is never worth a wasted slot.
function shop(ctx: SlotContext): Action | null {
  const step = nextKitStep(ctx.kit().build, ctx.s.items, ctx.s.gold);
  if (!step || !ctx.atFountain) return null;
  return step;
}

// Sell one named item, the owner's own rule.
function sellNamed(ctx: SlotContext, item: string): Action | null {
  if (!ctx.atFountain) return null;
  const slot = ctx.s.items.indexOf(item);
  return slot === -1 ? null : { kind: 'sell', slot };
}

// Shop trip: the bank covers the next build step and nobody is around, so
// go convert it into a power spike instead of drifting with a full purse
// (snowball review, round 2: bots only ever went home at death's door, so
// kill gold never became items and a lead never showed on the map).
function goShop(ctx: SlotContext): Action | null {
  const { fountain } = ctx;
  if (!nextKitStep(ctx.kit().build, ctx.s.items, ctx.s.gold) || !ctx.recallClear()) return null;
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
// Squishiness by role, for the squishiest target rule: the carries first,
// the front line last.
const SQUISH: Readonly<Record<ChampionRole, number>> = {
  Marksman: 0,
  Mage: 0,
  Assassin: 1,
  Battlemage: 1,
  Skirmisher: 2,
  Support: 2,
  Fighter: 3,
  Tank: 4,
};

// Whom to fight (ADR 0014): a hard-controlled enemy champion in attack
// range beats every rule (each cast against it lands); then the rule: the
// coach's focus target while in sight, the lowest in health nearby, the
// squishiest by role nearby, else the nearest.
function pickTarget(ctx: SlotContext, rule: TargetRule): ObsUnit | null {
  const { s, obs } = ctx;
  const cands = ctx.enemyChampions;
  if (cands.length === 0) return null;
  const ccd = cands
    .filter((u) => hardCCd(u, obs.time) && dist(s.x, s.z, u) <= CHAMPION_ATTACK_RANGE)
    .sort((a, b) => dist(s.x, s.z, a) - dist(s.x, s.z, b))[0];
  if (ccd) return ccd;
  if (rule === 'order') {
    const order = s.coachOrder ?? null;
    const focus = order?.kind === 'focus' ? cands.find((u) => u.id === order.targetId) : undefined;
    if (focus) return focus;
  }
  const near = cands.filter((u) => dist(s.x, s.z, u) <= FIGHT_TARGET_RADIUS);
  const byDistance = (a: ObsUnit, b: ObsUnit): number => dist(s.x, s.z, a) - dist(s.x, s.z, b);
  if (rule === 'lowest' && near.length > 0) {
    return [...near].sort((a, b) => a.hpFrac - b.hpFrac || byDistance(a, b))[0]!;
  }
  if (rule === 'squishiest' && near.length > 0) {
    const squish = (u: ObsUnit): number => {
      const role = u.championId ? CHAMPIONS[u.championId]?.role : undefined;
      return role ? SQUISH[role] : 2;
    };
    return [...near].sort((a, b) => squish(a) - squish(b) || byDistance(a, b))[0]!;
  }
  return nearest(cands, s.x, s.z);
}

// A kite's step: straight away from the threat, never into tower fire
// (home instead when the straight line lands under one).
function kiteStep(ctx: SlotContext, threat: ObsUnit): Action {
  const { s } = ctx;
  const d = dist(s.x, s.z, threat) || 1;
  const mx = s.x + ((s.x - threat.x) / d) * KITE_STEP;
  const mz = s.z + ((s.z - threat.z) / d) * KITE_STEP;
  if (ctx.inTowerReach(mx, mz) && !ctx.inTowerReach(s.x, s.z)) return towardHome(ctx, KITE_STEP);
  return { kind: 'move', x: mx, z: mz };
}

// The fight (ADR 0014): Sear in kill range, the kit by its hints, then
// attacks, holding distance by the stance. Front walks in and chases a
// little. Kite is an orb walk on the auto-attack clock the observation
// carries: never interrupt a swing, strike the moment the clock allows and
// the target is in reach, and between strikes step away from whoever
// closes (the first kite ran from every chaser and never struck back;
// scouting round 1 counted it as deaths on the retreat play). Poke casts
// and steps back and never trades attacks. Auto is kite on a ranged
// champion, front on a melee one. The commit (plan-bots phase 16): under
// the odds a play names, the bot never walks in (no chase, no approach, the
// engage spell held) and passes the turn once nothing is in reach.
function fight(
  ctx: SlotContext,
  stance: Stance,
  rule: TargetRule,
  alone: Alone,
  commitAt?: number,
): Action | null {
  const { s, obs } = ctx;
  const champ = pickTarget(ctx, rule);
  if (!champ) return null;
  const committed = commitAt === undefined || fightOdds(ctx) >= commitAt;
  const dc = dist(s.x, s.z, champ);
  if (dc <= CAST_RANGE && champ.hpFrac < KILL_SECURE_HP_FRAC) {
    const sear = readySigil(s, 'sear');
    if (sear !== -1) return { kind: 'sigil', slot: sear, x: champ.x, z: champ.z };
  }
  const range = ctx.attackRange;
  const mode = stance === 'auto' ? (range >= RANGED_MIN_RANGE ? 'kite' : 'front') : stance;
  const cast = pickCast(ctx, champ, committed);
  if (mode === 'front') {
    if (cast) return cast;
    if (dc <= CHAMPION_ATTACK_RANGE) return { kind: 'attack', targetId: champ.id };
    // Told to hold when alone, or the odds under the commit: no walk-in;
    // the plays below (join, fall back, farm) take the slot instead.
    if (alone === 'hold' && !ctx.besideAlly()) return null;
    if (!committed) return null;
    if (dc <= CHASE_RANGE && !ctx.inTowerReach(champ.x, champ.z)) {
      return { kind: 'move', x: champ.x, z: champ.z };
    }
    return null;
  }
  const threat = nearest(ctx.enemyChampions, s.x, s.z);
  const td = threat ? dist(s.x, s.z, threat) : Number.POSITIVE_INFINITY;
  const securing = champ.hpFrac < KILL_SECURE_HP_FRAC && dc <= range + 1;
  const swinging = s.attackSwingUntil != null && s.attackSwingUntil > obs.time;
  if (swinging) return { kind: 'noop' };
  if (mode === 'poke') {
    if (cast) return cast;
    if (threat && td < range) return kiteStep(ctx, threat);
    return null;
  }
  // kite: the kit's spells first (offensive stats run hot, and a spell
  // held for a strike is damage lost), then the strike on the clock, then
  // the step between strikes.
  if (cast) return cast;
  const ready = (s.attackReadyAt ?? 0) <= obs.time;
  const inReach = dc <= range + 0.5;
  if (ready && inReach) return { kind: 'attack', targetId: champ.id };
  if (threat && td < range * KITE_DANGER_FRAC && !securing) return kiteStep(ctx, threat);
  if (inReach) return { kind: 'noop' };
  if (!committed) return null;
  if (dc <= range + KITE_APPROACH) {
    // Close to the edge of range, not past it.
    const k = (dc - (range - 0.5)) / dc;
    const ax = s.x + (champ.x - s.x) * k;
    const az = s.z + (champ.z - s.z) * k;
    if (!ctx.inTowerReach(ax, az)) return { kind: 'move', x: ax, z: az };
  }
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

// Join the nearest ally in a fight (scouting round 1: fights were taken
// one bot at a time, and a third of the deaths were outnumbered). Beside
// it, or with nobody fighting, the turn passes to the plays below.
function joinAlly(ctx: SlotContext, within: number): Action | null {
  const { s } = ctx;
  const ally = ctx.engagedAllies(within)[0];
  if (!ally || dist(s.x, s.z, ally) <= BESIDE_RANGE) return null;
  const { jx, jz } = ctx.jitter();
  return { kind: 'move', x: ally.x + jx, z: ally.z + jz };
}

// Fall back under the nearest live allied tower instead of all the way
// home: the lane is kept, the tower shoots whoever follows, and the plays
// below (fight, farm) go on there once under it.
// The lane a split pusher takes: the one enemies were seen in the least
// over the last minute (obs.laneActivity), the farthest from the enemy
// champions in sight on a tie, the assigned lane without the field.
export function quietestLane(ctx: SlotContext): LaneId | 'assigned' {
  const activity = ctx.obs.laneActivity;
  if (!activity) return 'assigned';
  const lanes: LaneId[] = ['top', 'mid', 'bot'];
  const foes = ctx.enemyChampions;
  const farness = (lane: LaneId): number => {
    if (foes.length === 0) return 0;
    const path = GAME_MAP.lanes[lane];
    const mid = path[Math.floor(path.length / 2)]!;
    let sum = 0;
    for (const f of foes) sum += Math.hypot(f.x - mid.x, f.z - mid.z);
    return sum / foes.length;
  };
  let best: LaneId = ctx.s.lane ?? 'mid';
  let bestKey = Number.POSITIVE_INFINITY;
  for (const lane of lanes) {
    // Seconds seen weigh; the distance breaks ties (a small term).
    const key = activity[lane] - farness(lane) / 1000;
    if (key < bestKey) {
      bestKey = key;
      best = lane;
    }
  }
  return best;
}

// The collapse (plan-bots phase 16): an allied tower with enemy champions
// at it is where the map is being lost, and a spread enemy is caught there
// with the numbers. Walk to the most threatened tower in range; beside it,
// or with none threatened, the plays below take the slot.
function defendTower(ctx: SlotContext, within: number): Action | null {
  const { s } = ctx;
  const target = ctx.threatenedTowers(within)[0];
  if (!target || dist(s.x, s.z, target.tower) <= BESIDE_RANGE + 4) return null;
  const { jx, jz } = ctx.jitter();
  return { kind: 'move', x: target.tower.x + jx, z: target.tower.z + jz };
}

function fallBack(ctx: SlotContext): Action | null {
  const { s, obs } = ctx;
  const tower = nearest(
    obs.units.filter((u) => u.friendly && u.kind === 'tower'),
    s.x,
    s.z,
  );
  if (!tower || dist(s.x, s.z, tower) <= BESIDE_RANGE) return null;
  const { jx, jz } = ctx.jitter();
  return { kind: 'move', x: tower.x + jx, z: tower.z + jz };
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
