// Test fixture: a battle royale sim by shape (server/royale_sim.ts), so the
// server's service, snapshots and points run without the mode's rules. Real
// units on a sphere of radius 80, each champion its own team, a clock that
// runs the drop, the play and the end, and helpers a test calls to make
// things happen (a takedown, a cache, a camp, a projectile).

import type {
  RoyaleBuild,
  RoyaleSeatPick,
  RoyaleSim,
  RoyaleSimEvent,
  RoyaleSkill,
} from '../server/royale_sim';
import type { RoyaleVariant } from '../src/net/royale_wire';
import { CAMPS } from '../src/sim/content/camps';
import { CHAMPIONS } from '../src/sim/content/champions';
import type { Vec3 } from '../src/sim/geo';
import type { Projectile } from '../src/sim/projectiles';
import { DROP_S, PLAY_S, type RoyaleState } from '../src/sim/royale/types';
import { type AbilityKey, DT, type ScoreRow, type TeamId, type Vec2 } from '../src/sim/types';
import { createCamp, createChampion, createWarden, type Unit } from '../src/sim/unit';
import type { Wall } from '../src/sim/walls';
import type { Zone } from '../src/sim/zones';

export const RADIUS = 80;
const SIGHT = 12;

// Seat i's spot: a Fibonacci spiral over the sphere, so the champions stand
// far apart unless a test moves them.
export function spot(i: number, n: number): Vec3 {
  const y = 1 - (2 * (i + 0.5)) / n;
  const r = Math.sqrt(1 - y * y);
  const a = i * 2.399963229728653;
  return { x: RADIUS * r * Math.cos(a), y: RADIUS * y, z: RADIUS * r * Math.sin(a) };
}

// A point `d` meters from `p` (roughly, along a tangent), still on the sphere.
export function near(p: Vec3, d: number): Vec3 {
  const t = Math.abs(p.y) < 70 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const q = { x: p.x + t.x * d, y: p.y + t.y * d, z: p.z + t.z * d };
  const len = Math.hypot(q.x, q.y, q.z);
  return { x: (q.x / len) * RADIUS, y: (q.y / len) * RADIUS, z: (q.z / len) * RADIUS };
}

const dist = (a: Vec2, b: Vec2): number =>
  Math.hypot(a.x - b.x, (a.y ?? 0) - (b.y ?? 0), a.z - b.z);

export interface Order {
  unitId: number;
  kind: string;
  p?: Vec2;
  targetId?: number;
  key?: AbilityKey;
  slot?: number;
}

export class FakeRoyaleSim implements RoyaleSim {
  time = 0;
  tickCount = 0;
  readonly units = new Map<number, Unit>();
  readonly projectiles = new Map<number, Projectile>();
  readonly zones = new Map<number, Zone>();
  readonly walls = new Map<number, Wall>();
  readonly royale: RoyaleState;
  readonly orders: Order[] = [];
  // Who plays each seat now: a skill for a bot, absent for a person.
  readonly policies = new Map<number, RoyaleSkill>();
  // Events the next tick answers with.
  readonly pending: RoyaleSimEvent[] = [];
  private nextId = 1;

  constructor(variant: RoyaleVariant) {
    this.royale = {
      variant,
      stage: 'drop',
      dropEndsAt: DROP_S,
      endsAt: DROP_S + PLAY_S,
      dusk: {
        phase: 0,
        now: { center: { x: 0, y: RADIUS, z: 0 }, radius: 160 },
        next: { center: { x: 0, y: RADIUS, z: 0 }, radius: 120 },
        phaseEndsAt: DROP_S + 90,
        shrinking: false,
        burn: 0.01,
      },
      caches: [],
      pads: [],
      drops: new Map(),
      scores: new Map(),
      eliminated: [],
      winnerId: null,
      leaderId: null,
      leaderShownAt: -999,
    };
  }

  addChampion(team: number, championId: string, at: Vec3): Unit {
    const def = CHAMPIONS[championId] ?? CHAMPIONS.sylra!;
    const u = createChampion(this.nextId++, team as TeamId, { ...at }, def);
    // On the sphere, y and all.
    u.pos = { ...at };
    this.units.set(u.id, u);
    return u;
  }

  addCamp(at: Vec3): Unit {
    const u = createCamp(this.nextId++, CAMPS.spinecrest, { ...at });
    u.pos = { ...at };
    this.units.set(u.id, u);
    return u;
  }

  addCreature(at: Vec3): Unit {
    const u = createWarden(this.nextId++, { ...at });
    u.pos = { ...at };
    this.units.set(u.id, u);
    return u;
  }

  addCache(at: Vec3, golden = false): number {
    const id = this.royale.caches.length + 1;
    this.royale.caches.push({
      id,
      pos: { ...at },
      golden,
      present: true,
      respawnAt: null,
      opener: null,
      openSince: 0,
    });
    return id;
  }

  addProjectile(sourceId: number, team: number, at: Vec3): Projectile {
    const p = {
      id: this.nextId++,
      sourceId,
      team: team as TeamId,
      pos: { ...at },
      dir: { x: 1, z: 0 },
      speed: 0,
      radius: 0.3,
      maxRange: 0,
      traveled: 0,
      homingTargetId: null,
      pierce: false,
      hitIds: new Set<number>(),
      power: { ad: 0, ap: 0 },
      onHit: [],
      allyEffects: [],
      chain: null,
      leaveWall: null,
      aftershock: null,
      splashOnHit: null,
      vfx: null,
    } as Projectile;
    this.projectiles.set(p.id, p);
    return p;
  }

  // A takedown: the victim falls to the killer, and in One life it is out
  // for good with its place.
  takedown(victimId: number, killerId: number): void {
    const v = this.units.get(victimId);
    const k = this.units.get(killerId);
    if (!v) return;
    v.dead = true;
    v.deaths += 1;
    if (k) {
      k.kills += 1;
      this.royale.scores.set(killerId, (this.royale.scores.get(killerId) ?? 0) + 1);
    }
    this.pending.push({ type: 'death', unitId: victimId, killerId });
    if (this.royale.variant === 'one_life') {
      this.royale.eliminated.push(victimId);
      const champions = [...this.units.values()].filter((u) => u.kind === 'champion').length;
      const place = champions - this.royale.eliminated.length + 1;
      this.pending.push({ type: 'royale_out', unitId: victimId, killerId, place });
      const standing = [...this.units.values()].filter(
        (u) => u.kind === 'champion' && !this.royale.eliminated.includes(u.id),
      );
      if (standing.length === 1) this.finish(standing[0]!.id);
    }
  }

  // The match ends now, with this winner.
  finish(winnerId: number | null): void {
    this.royale.stage = 'over';
    this.royale.winnerId = winnerId;
    this.pending.push({ type: 'royale_end', winnerId });
  }

  tick(): readonly RoyaleSimEvent[] {
    this.tickCount += 1;
    this.time = this.tickCount * DT;
    const out: RoyaleSimEvent[] = this.pending.splice(0);
    const r = this.royale;
    if (r.stage === 'drop' && this.time >= r.dropEndsAt) {
      r.stage = 'play';
      for (const u of this.units.values()) {
        if (u.kind !== 'champion') continue;
        const at = r.drops.get(u.id);
        if (at) u.pos = { ...at };
        out.push({ type: 'royale_land', unitId: u.id });
      }
    } else if (r.stage === 'play' && this.time >= r.endsAt) {
      let best: number | null = null;
      for (const [id, s] of r.scores) if (best === null || s > (r.scores.get(best) ?? 0)) best = id;
      r.stage = 'over';
      r.winnerId = best;
      out.push({ type: 'royale_end', winnerId: best });
    }
    return out;
  }

  private sightOf(team: number): Unit[] {
    return [...this.units.values()].filter((u) => u.team === team && !u.neutral && !u.dead);
  }

  isVisible(team: number, unitId: number): boolean {
    const u = this.units.get(unitId);
    if (!u) return false;
    if (!u.neutral && u.team === team) return true;
    return this.sightOf(team).some((s) => dist(s.pos, u.pos) <= SIGHT);
  }

  isPointVisible(team: number, x: number, z: number, y?: number): boolean {
    const p = { x, y, z };
    return this.sightOf(team).some((s) => dist(s.pos, p) <= SIGHT);
  }

  scoreboard(): readonly ScoreRow[] {
    return [...this.units.values()]
      .filter((u) => u.kind === 'champion')
      .map((u) => ({
        unitId: u.id,
        name: u.champion?.name ?? '',
        championId: u.championId ?? '',
        player: null,
        team: u.team,
        level: u.level,
        kills: u.kills,
        deaths: u.deaths,
        assists: u.assists,
        cs: u.cs,
        items: [...u.items],
      }));
  }

  pickDrop(unitId: number, p: Vec3): void {
    this.royale.drops.set(unitId, { ...p });
  }

  orderMove(unitId: number, x: number, z: number, y?: number): void {
    this.orders.push({ unitId, kind: 'move', p: y === undefined ? { x, z } : { x, y, z } });
  }

  orderAttack(unitId: number, targetId: number): void {
    this.orders.push({ unitId, kind: 'attack', targetId });
  }

  orderAttackMove(unitId: number, x: number, z: number, y?: number): void {
    this.orders.push({ unitId, kind: 'attack_move', p: y === undefined ? { x, z } : { x, y, z } });
  }

  orderStop(unitId: number): void {
    this.orders.push({ unitId, kind: 'stop' });
  }

  castAbility(unitId: number, key: AbilityKey, aim: Vec2): boolean {
    this.orders.push({ unitId, kind: 'cast', key, p: aim });
    return true;
  }

  castSigil(unitId: number, slot: number, aim: Vec2): boolean {
    this.orders.push({ unitId, kind: 'sigil', slot, p: aim });
    return true;
  }

  detachPolicy(unitId: number): void {
    this.policies.delete(unitId);
  }
}

// The factory the service takes, keeping every sim it built for the test.
export function fakeFactory(): {
  factory: (seed: number, variant: RoyaleVariant, picks: readonly RoyaleSeatPick[]) => RoyaleBuild;
  sims: FakeRoyaleSim[];
  picks: (readonly RoyaleSeatPick[])[];
} {
  const sims: FakeRoyaleSim[] = [];
  const picksSeen: (readonly RoyaleSeatPick[])[] = [];
  const factory = (
    _seed: number,
    variant: RoyaleVariant,
    picks: readonly RoyaleSeatPick[],
  ): RoyaleBuild => {
    const sim = new FakeRoyaleSim(variant);
    const unitIds = picks.map((p, i) => {
      const u = sim.addChampion(p.team, p.championId, spot(i, picks.length));
      u.skin = p.skin;
      u.sigils = [...p.sigils];
      if (p.bot) sim.policies.set(u.id, p.bot.skill);
      return u.id;
    });
    sims.push(sim);
    picksSeen.push(picks);
    return {
      sim,
      unitIds,
      standIn: (unitId, skill) => {
        sim.policies.set(unitId, skill);
      },
    };
  };
  return { factory, sims, picks: picksSeen };
}
