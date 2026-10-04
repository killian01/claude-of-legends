// One battle royale snapshot for one person (ADR 0031): what their own
// champion sees, each champion its own team (ADR 0030), with every position
// on the planet carrying y (ADR 0029), and the mode's block every snapshot:
// the stage and its clocks, the Dusk, the people and champions still in,
// the recipient's score and place, the score leader, the recipient's cache
// being opened and their drop pick; the caches still standing (and during
// the drop everyone's picks) once a second, the client keeping the last
// list in between. The fog holds here as in the 5v5 (server/snapshot.ts,
// whose record builders this reuses): what never reaches the wire can never
// be read off it.

import type { ServerMsg, SnapEvent, SnapMobile, SnapUnit, SnapWall } from '../src/net/protocol';
import type { SeatLabel, SnapCache, SnapDusk, SnapRoyale, WirePoint } from '../src/net/royale_wire';
import { heartwoodOf } from '../src/sim/content/grafts';
import type { Vec3 } from '../src/sim/geo';
import { type DuskState, MARK_SHOWN_S } from '../src/sim/royale/types';
import { placeOf } from './royale_ranking';
import type { RoyaleSim, RoyaleSimEvent } from './royale_sim';
import { addRoyaleBlocks, cacheKindOf, openingDuration } from './royale_snapshot_blocks';
import {
  projectileRecord,
  round2,
  type SeatAck,
  selfRecord,
  unitRecord,
  wallRecord,
  zoneRecord,
} from './snapshot';

// Ticks between two caches lists (one a second at 20 Hz).
export const CACHES_EVERY_TICKS = 20;

export interface RoyaleViewer {
  unitId: number;
  team: number;
  known: Set<number>;
  seat: SeatAck;
}

export interface RoyaleSnapContext {
  // The seat behind a unit, for names and the bot mark.
  seat(unitId: number): SeatLabel | undefined;
  // How many seats the match holds, and how many people are connected.
  seats: number;
  people: number;
  // Send the caches list (and the drop's picks) with this one.
  caches: boolean;
  // The recipient's place in the final ranking, once the match is over
  // (Respawn's places are known only then).
  finalPlace?: number;
}

const point = (p: Vec3): WirePoint => [round2(p.x), round2(p.y), round2(p.z)];

export function duskRecord(d: DuskState): SnapDusk {
  const rec: SnapDusk = {
    p: d.phase,
    c: point(d.now.center),
    r: round2(d.now.radius),
    pe: round2(d.phaseEndsAt),
    sh: d.shrinking ? 1 : 0,
    b: Math.round(d.burn * 10_000) / 10_000,
  };
  if (d.next) {
    rec.nc = point(d.next.center);
    rec.nr = round2(d.next.radius);
  }
  return rec;
}

export function royaleBlock(
  sim: RoyaleSim,
  viewer: RoyaleViewer,
  ctx: RoyaleSnapContext,
): SnapRoyale {
  const r = sim.royale;
  const self = viewer.unitId;
  const block: SnapRoyale = {
    v: r.variant,
    st: r.stage,
    de: round2(r.dropEndsAt),
    end: round2(r.endsAt),
    dusk: duskRecord(r.dusk),
    alive: r.variant === 'one_life' ? ctx.seats - r.eliminated.length : ctx.seats,
    people: ctx.people,
    score: r.scores.get(self) ?? 0,
  };
  const place = placeOf(r, ctx.seats, self) ?? ctx.finalPlace ?? null;
  if (place !== null) block.place = place;
  if (r.variant === 'respawn' && r.leaderId !== null) {
    const leader: NonNullable<SnapRoyale['leader']> = {
      i: r.leaderId,
      s: r.scores.get(r.leaderId) ?? 0,
    };
    const at = sim.units.get(r.leaderId)?.pos;
    // Where only while the Lodestar's show lasts (marks.ts), the one
    // length the observation reads too.
    const shown = sim.time - r.leaderShownAt <= MARK_SHOWN_S && r.leaderShownAt > r.dropEndsAt;
    if (at?.y !== undefined && shown) {
      leader.at = point(at as Vec3);
    }
    block.leader = leader;
  }
  for (const c of r.caches) {
    if (c.present && c.opener === self) {
      const d = openingDuration(sim, c);
      block.opening = { c: c.id, since: round2(c.openSince), ...(d !== undefined ? { d } : {}) };
      break;
    }
  }
  if (r.stage === 'drop') {
    const mine = r.drops.get(self);
    if (mine) block.drop = point(mine);
  }
  if (ctx.caches) {
    block.caches = r.caches
      .filter((c) => c.present)
      .map(
        (c): SnapCache => [c.id, round2(c.pos.x), round2(c.pos.y), round2(c.pos.z), cacheKindOf(c)],
      );
    if (r.stage === 'drop') {
      const picks: WirePoint[] = [];
      for (const [unitId, p] of r.drops) if (unitId !== self) picks.push(point(p));
      block.picks = picks;
    }
  }
  addRoyaleBlocks(block, sim, viewer, ctx);
  return block;
}

// The names a kill feed line carries, and the bot marks.
function feedNames(
  ctx: RoyaleSnapContext,
  victimId: number,
  killerId: number,
  killerIsChampion: boolean,
): { n: string; kn: string | null; vb?: 1; kb?: 1 } {
  const victim = ctx.seat(victimId);
  const killer = killerIsChampion ? ctx.seat(killerId) : undefined;
  return {
    n: victim?.name ?? '',
    kn: killer?.name ?? null,
    ...(victim?.bot ? { vb: 1 as const } : {}),
    ...(killer?.bot ? { kb: 1 as const } : {}),
  };
}

function royaleEvents(
  sim: RoyaleSim,
  viewer: RoyaleViewer,
  knownBefore: ReadonlySet<number>,
  events: readonly RoyaleSimEvent[],
  ctx: RoyaleSnapContext,
): SnapEvent[] {
  const self = viewer.unitId;
  const sees = (id: number): boolean => id === self || sim.isVisible(viewer.team, id);
  const isChampion = (id: number): boolean => sim.units.get(id)?.kind === 'champion';
  const out: SnapEvent[] = [];
  for (const ev of events) {
    switch (ev.type) {
      case 'death': {
        // A champion's death is everyone's (the kill feed), with the names;
        // anything else only reaches those who could see it.
        if (isChampion(ev.unitId)) {
          const names = feedNames(ctx, ev.unitId, ev.killerId, isChampion(ev.killerId));
          out.push({
            e: 'death',
            unitId: ev.unitId,
            killerId: ev.killerId,
            n: names.n,
            ...(names.kn !== null ? { kn: names.kn } : {}),
            ...(names.vb ? { vb: 1 as const } : {}),
            ...(names.kb ? { kb: 1 as const } : {}),
          });
        } else if (knownBefore.has(ev.unitId)) {
          out.push({ e: 'death', unitId: ev.unitId, killerId: ev.killerId });
        }
        break;
      }
      case 'gold':
        if (ev.unitId === self) out.push({ e: 'gold', amount: ev.amount });
        break;
      case 'damage':
        if (ev.sourceId === self && ev.targetId !== self) {
          out.push({ e: 'dmg', targetId: ev.targetId, amount: Math.round(ev.amount) });
        }
        break;
      case 'cast':
        if (sees(ev.unitId)) out.push({ e: 'cast', unitId: ev.unitId, k: ev.key });
        break;
      case 'sigil':
        if (sees(ev.unitId)) out.push({ e: 'cast', unitId: ev.unitId });
        break;
      case 'attack':
        if (sees(ev.unitId)) out.push({ e: 'atk', unitId: ev.unitId, targetId: ev.targetId });
        break;
      case 'voidmaul_slam': {
        const { type: _type, ...impact } = ev;
        if (sees(ev.unitId)) out.push({ e: 'voidmaul_slam', ...impact });
        break;
      }
      case 'royale_land':
        if (sees(ev.unitId)) out.push({ e: 'royale_land', unitId: ev.unitId });
        break;
      case 'royale_loot':
        // A toast for the recipient's own pieces only.
        if (ev.unitId === self) {
          out.push({ e: 'royale_loot', unitId: ev.unitId, itemId: ev.itemId, source: ev.source });
        }
        break;
      case 'royale_cache':
        if (sees(ev.unitId))
          out.push({ e: 'royale_cache', unitId: ev.unitId, cacheId: ev.cacheId });
        break;
      case 'royale_pad':
        if (sees(ev.unitId)) out.push({ e: 'royale_pad', unitId: ev.unitId, padId: ev.padId });
        break;
      case 'royale_dusk':
        out.push({ e: 'royale_dusk', phase: ev.phase });
        break;
      case 'royale_out':
        out.push({
          e: 'royale_out',
          unitId: ev.unitId,
          killerId: ev.killerId,
          place: ev.place,
          ...feedNames(ctx, ev.unitId, ev.killerId, isChampion(ev.killerId)),
        });
        break;
      case 'royale_leader': {
        const s = ctx.seat(ev.unitId);
        out.push({
          e: 'royale_leader',
          unitId: ev.unitId,
          n: s?.name ?? '',
          ...(s?.bot ? { b: 1 as const } : {}),
        });
        break;
      }
      case 'royale_end': {
        const s = ev.winnerId !== null ? ctx.seat(ev.winnerId) : undefined;
        out.push({
          e: 'royale_end',
          winnerId: ev.winnerId,
          n: s?.name ?? null,
          ...(s?.bot ? { b: 1 as const } : {}),
        });
        break;
      }
      // Everyone's: called on the globe for all to see.
      case 'royale_seedfall':
        out.push({
          e: 'royale_seedfall',
          id: ev.seedfallId,
          at: point(ev.at),
          landsAt: round2(ev.landsAt),
        });
        break;
      case 'royale_seedfall_land':
        out.push({ e: 'royale_seedfall_land', id: ev.seedfallId, at: point(ev.at) });
        break;
      case 'royale_rising':
        out.push({
          e: 'royale_rising',
          kind: ev.kind,
          at: point(ev.at),
          risesAt: round2(ev.risesAt),
        });
        break;
      case 'royale_wrath_passed': {
        const s = ev.to !== null ? ctx.seat(ev.to) : undefined;
        out.push({
          e: 'royale_wrath_passed',
          from: ev.from,
          to: ev.to,
          n: s?.name ?? null,
          ...(s?.bot ? { b: 1 as const } : {}),
        });
        break;
      }
      case 'royale_mark': {
        const s = ctx.seat(ev.unitId);
        out.push({
          e: 'royale_mark',
          unitId: ev.unitId,
          kind: ev.kind,
          n: s?.name ?? '',
          ...(s?.bot ? { b: 1 as const } : {}),
        });
        break;
      }
      case 'royale_snuffed': {
        const names = feedNames(ctx, ev.unitId, ev.killerId, isChampion(ev.killerId));
        out.push({
          e: 'royale_snuffed',
          unitId: ev.unitId,
          killerId: ev.killerId,
          streak: ev.streak,
          n: names.n,
          kn: names.kn,
          ...(names.vb ? { vb: 1 as const } : {}),
          ...(names.kb ? { kb: 1 as const } : {}),
        });
        break;
      }
      case 'royale_reprieve':
        out.push({ e: 'royale_reprieve', unitId: ev.unitId, backAt: round2(ev.backAt) });
        break;
      case 'royale_dusk_hastens':
        out.push({ e: 'royale_dusk_hastens', by: round2(ev.by), alive: ev.alive });
        break;
      case 'royale_last_light':
        out.push({ e: 'royale_last_light', step: ev.step });
        break;
      // Where it lands is where the slammer stands: only to who sees them,
      // as royale_pad. Fogged on purpose, the one new event that is not
      // everyone's: sent to all, it would show a champion through the fog.
      case 'royale_pad_slam':
        if (sees(ev.unitId)) {
          out.push({ e: 'royale_pad_slam', unitId: ev.unitId, at: point(ev.at), hit: [...ev.hit] });
        }
        break;
      default:
        break;
    }
  }
  return out;
}

export function buildRoyaleSnapshot(
  sim: RoyaleSim,
  viewer: RoyaleViewer,
  events: readonly RoyaleSimEvent[],
  ctx: RoyaleSnapContext,
): ServerMsg {
  const { team, known } = viewer;
  const self = viewer.unitId;
  // During the drop the champions are in the air: nobody's position but
  // the recipient's own reaches the wire, only the picks (royaleBlock).
  const dropping = sim.royale.stage === 'drop';
  const units: SnapUnit[] = [];
  const visibleNow = new Set<number>();
  const knownBefore = new Set(known);
  for (const u of sim.units.values()) {
    if (dropping && u.kind === 'champion' && u.id !== self) continue;
    if (!sim.isVisible(team, u.id)) continue;
    visibleNow.add(u.id);
    const rec = unitRecord(u, sim.time, team, known);
    if (rec.k === 'champion') {
      const seat = ctx.seat(u.id);
      if (seat) {
        rec.n = seat.name;
        if (seat.bot) rec.b = 1;
      }
    }
    // The Heartwood a champion carries, in every record, for everyone who
    // sees it.
    const hw = u.grafts.length > 0 ? heartwoodOf(u) : null;
    if (hw) rec.hw = hw;
    units.push(rec);
  }
  const gone: number[] = [];
  for (const id of known) {
    if (!visibleNow.has(id)) {
      gone.push(id);
      known.delete(id);
    }
  }

  // Fog-scoped by who cast it, not by team: only the recipient's own
  // champion's bolts and zones skip the sight test. A neutral's carries a
  // nominal team (0) a seat of the free-for-all may hold too.
  const seesUnit = (id: number): boolean => sim.isVisible(team, id);
  const projectiles: SnapMobile[] = [];
  for (const p of sim.projectiles.values()) {
    if (p.sourceId !== self && !sim.isPointVisible(team, p.pos.x, p.pos.z, p.pos.y)) continue;
    projectiles.push(projectileRecord(p, seesUnit));
  }
  const zones: SnapMobile[] = [];
  for (const z of sim.zones.values()) {
    if (z.sourceId !== self && !sim.isPointVisible(team, z.pos.x, z.pos.z, z.pos.y)) continue;
    zones.push(zoneRecord(z));
  }
  const walls: SnapWall[] = [];
  for (const w of sim.walls.values()) walls.push(wallRecord(w));

  const selfUnit = sim.units.get(self);
  const r = sim.royale;
  const winnerTeam =
    r.stage === 'over' && r.winnerId !== null ? (sim.units.get(r.winnerId)?.team ?? null) : null;
  return {
    t: 'snap',
    time: round2(sim.time),
    units,
    gone,
    projectiles,
    zones,
    walls,
    // The planet's prediction is off (ADR 0028 walks the plane's grid):
    // the path to walk is not sent.
    self: selfUnit ? selfRecord(selfUnit, sim.time, viewer.seat, false) : null,
    events: royaleEvents(sim, viewer, knownBefore, events, ctx),
    winner: winnerTeam,
    royale: royaleBlock(sim, viewer, ctx),
  };
}
