// Dev-only: a stand-in world on the Wanderseed for the planet's renderer
// (planet.html), until the sim plays on the sphere. Twenty champions of the
// roster walk great circles (src/sim/geo.ts), pick fights, swing and cast
// their real spells so their real effects play: bolts flying the sphere,
// zones on it, windups telegraphed, damage and deaths. A drop over the
// globe opens the match, the Dusk closes slowly, caches and pads stand
// where the layout puts them. Nothing here is the game's rules: it only
// has to look like a match. Never imported by the game.

import type { WorldNotes } from '../game/boot';
import type { SnapCache, SnapRoyale, WirePoint } from '../net/royale_wire';
import type { PlanetGround } from '../render/planet_terrain';
import { RANGED_THRESHOLD } from '../sim/combat/auto_attack';
import { CHAMPION_LIST, CHAMPIONS } from '../sim/content/champions';
import type { GameMap } from '../sim/content/map';
import { GAME_MAP } from '../sim/content/map';
import { NO_FAVORS } from '../sim/favors';
import {
  advance,
  copy,
  dirTo,
  dist,
  lerp,
  offset,
  rotate,
  settle,
  stepToward,
  turnLeft,
  type Vec3,
} from '../sim/geo';
import type { Projectile } from '../sim/projectiles';
import type { AbilityKey, ScoreRow, TeamId, Vec2 } from '../sim/types';
import { DT } from '../sim/types';
import { createChampion, type Unit } from '../sim/unit';
import type { Wall } from '../sim/walls';
import type { Zone } from '../sim/zones';
import type { IWorld } from '../world_api';

const R = 80;
const KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];
const NAMES = [
  'Bramblewick',
  'Ostra Vey',
  'Kettlemoor',
  'Sable Quill',
  'Hollin',
  'Marrowgate',
  'Tamsin Ode',
  'Fallowmere',
  'Grisk',
  'Ivory Lark',
  'Dunmarrow',
  'Pell Ashby',
  'Quorra',
  'Wexley Fen',
  'Thistledown',
  'Corvin Hale',
  'Lumen',
  'Saffra',
  'Brindle',
  'Oakhart',
];

export interface DemoOptions {
  // Where the player starts, a direction; absent, off a crossroads.
  at?: Vec3;
  // How many champions land around the player (9, a crowded fight).
  near?: number;
  // Seconds of the drop over the globe at the start; 0 lands at once.
  dropS: number;
  // The Dusk's edge a few meters from the player's start (for a look at it).
  duskNear: boolean;
  seed: number;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function unit3(v: Vec3): Vec3 {
  const d = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / d, y: v.y / d, z: v.z / d };
}

function onSphere(v: Vec3): Vec3 {
  const u = unit3(v);
  return { x: u.x * R, y: u.y * R, z: u.z * R };
}

function wire(p: Vec3): WirePoint {
  return [p.x, p.y, p.z];
}

// A random tangent direction at a sphere point.
function randomHeading(p: Vec3, rand: () => number): Vec3 {
  const n = unit3(p);
  const a = Math.abs(n.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  // e = a x n, normalized: a tangent.
  const e = unit3({ x: a.y * n.z - a.z * n.y, y: a.z * n.x - a.x * n.z, z: a.x * n.y - a.y * n.x });
  return rotate(e, rand() * Math.PI * 2, p) as Vec3;
}

// A point s meters from p along a random great circle.
function around(p: Vec3, s: number, rand: () => number): Vec3 {
  return settle(offset(p, randomHeading(p, rand), s), R) as Vec3;
}

interface Brain {
  heading: Vec3;
  turnAt: number;
  castAt: number;
  attackAt: number;
  targetId: number | null;
  // The player's own orders.
  moveTo: Vec3 | null;
  dash: { to: Vec3; until: number } | null;
  pick: Vec3 | null;
}

interface Pending {
  unitId: number;
  key: AbilityKey;
  aim: Vec3;
  at: number;
}

export class PlanetDemoWorld implements IWorld {
  readonly map: GameMap = GAME_MAP;
  // Past the HUD's opening-shop window: a planet match has no shop.
  time = 5;
  readonly winner: TeamId | null = null;
  readonly units = new Map<number, Unit>();
  readonly projectiles = new Map<number, Projectile>();
  readonly zones = new Map<number, Zone>();
  readonly walls = new Map<number, Wall>();
  readonly selfId = 1;
  private readonly brains = new Map<number, Brain>();
  private readonly names = new Map<number, string>();
  private readonly rand: () => number;
  private nextId = 1000;
  private notes: {
    kills: { unitId: number; killerId: number }[];
    casts: { unitId: number; key?: AbilityKey }[];
    hits: { targetId: number; amount: number }[];
    attacks: { unitId: number; targetId: number }[];
  } = { kills: [], casts: [], hits: [], attacks: [] };
  private readonly pending: Pending[] = [];
  // Champions thrown by a pad: from, to, and when they left.
  private readonly thrown = new Map<number, { from: Vec3; to: Vec3; at: number }>();
  private readonly dropEndsAt: number;
  private readonly start: Vec3;
  private readonly duskCenter: Vec3;
  private readonly nextCenter: Vec3;
  private readonly duskFrom: number;
  private readonly caches: SnapCache[];
  private ownPick: Vec3 | null = null;
  // The player's pick of where to come back while it waits (fall()).
  private ownBack: Vec3 | null = null;

  constructor(
    private readonly ground: PlanetGround,
    private readonly opts: DemoOptions,
  ) {
    this.rand = seeded(opts.seed);
    // No drop: the match is long under way (nobody is still landing).
    this.dropEndsAt = opts.dropS > 0 ? this.time + opts.dropS : -60;
    // The start: off a crossroads, toward the Ruins, where three regions
    // and a pad meet.
    const toward = onSphere({ x: 1, y: 1, z: 1 });
    const corner =
      [...ground.layout.crossroads].sort((a, b) => dist(a, toward) - dist(b, toward))[0] ?? toward;
    this.start = opts.at
      ? onSphere(opts.at)
      : (settle(
          offset(
            corner,
            dirTo(corner, onSphere({ x: 1, y: 0.2, z: 0.15 })) ?? { x: 1, y: 0, z: 0 },
            9,
          ),
          R,
        ) as Vec3);
    for (let i = 0; i < 20; i++) {
      const def = CHAMPION_LIST[i % CHAMPION_LIST.length]!;
      const id = i + 1;
      // Ten land around the player for the fight, ten anywhere.
      const at =
        i === 0
          ? this.start
          : i <= (opts.near ?? 9)
            ? around(this.start, 6 + this.rand() * 14, this.rand)
            : onSphere({ x: this.rand() * 2 - 1, y: this.rand() * 2 - 1, z: this.rand() * 2 - 1 });
      const u = createChampion(id, i as TeamId, copy(at), def);
      // The sim's constructor keeps a plane point; the planet's carries y.
      u.pos = copy(at);
      u.level = 6;
      u.abilityRanks = { Q: 1, W: 1, E: 1, R: 1 };
      u.skillPoints = 0;
      this.units.set(id, u);
      this.names.set(id, i === 0 ? 'You' : NAMES[i]!);
      this.brains.set(id, {
        heading: randomHeading(at, this.rand),
        turnAt: this.rand() * 5,
        castAt: this.time + opts.dropS + 1 + this.rand() * 3,
        attackAt: 0,
        targetId: null,
        moveTo: null,
        dash: null,
        pick: i === 0 ? null : at,
      });
    }
    // The Dusk closes on a point some way off the start.
    this.duskCenter = around(this.start, 40, this.rand);
    this.nextCenter = around(this.duskCenter, 7, this.rand);
    this.duskFrom = opts.duskNear ? dist(this.duskCenter, this.start) + 9 : 150;
    const spots = ground.layout.caches;
    this.caches = spots
      .slice(0, 160)
      .map((c, i) => [i + 1, c.at.x, c.at.y, c.at.z, c.golden ? 1 : 0] as SnapCache);
    // A few caches right by the start, so one is in the first look.
    for (let i = 0; i < 3; i++) {
      const p = around(this.start, 5 + i * 4, this.rand);
      this.caches.push([900 + i, p.x, p.y, p.z, i === 0 ? 1 : 0]);
    }
  }

  get self(): Unit {
    return this.units.get(this.selfId)!;
  }

  // ---------------------------------------------------------------- IWorld

  championDef(id: string) {
    return CHAMPIONS[id] ?? null;
  }

  scoreboard(): readonly ScoreRow[] {
    const rows: ScoreRow[] = [];
    for (const u of this.units.values()) {
      rows.push({
        unitId: u.id,
        name: this.names.get(u.id) ?? '',
        championId: u.championId ?? '',
        player: null,
        team: u.team,
        level: u.level,
        kills: u.kills,
        deaths: u.deaths,
        assists: u.assists,
        cs: 0,
        items: u.items,
      });
    }
    return rows;
  }

  isVisible(team: TeamId, unitId: number): boolean {
    const u = this.units.get(unitId);
    if (!u) return false;
    if (u.team === team || this.thrown.has(unitId)) return true;
    const me = this.self;
    return dist(me.pos, u.pos) <= me.sightRange + 2;
  }

  teamBuff() {
    return null;
  }

  objectiveSpawnAt(): number | null {
    return 1e9;
  }

  wardenPit() {
    return null;
  }

  ringClocks() {
    return [];
  }

  teamFavors() {
    return NO_FAVORS;
  }

  teamWrath(): number | null {
    return null;
  }

  royaleView(): SnapRoyale & { caches: SnapCache[] } {
    const dropping = this.time < this.dropEndsAt;
    const play = Math.max(0, this.time - Math.max(this.dropEndsAt, 5));
    const r = Math.max(24, this.duskFrom - play * 0.35);
    const picks: WirePoint[] = [];
    if (dropping) {
      // The bots' picks show as they make them over the drop.
      let n = 0;
      for (const [id, b] of this.brains) {
        if (id === this.selfId || !b.pick) continue;
        const into = this.time - (this.dropEndsAt - this.opts.dropS);
        if (into > (n / 19) * this.opts.dropS * 0.8) picks.push(wire(b.pick));
        n++;
      }
    }
    return {
      v: 'respawn',
      st: dropping ? 'drop' : 'play',
      de: this.dropEndsAt,
      end: this.dropEndsAt + 600,
      dusk: {
        p: 1,
        c: wire(this.duskCenter),
        r,
        nc: wire(this.nextCenter),
        nr: Math.max(14, r * 0.62),
        pe: this.dropEndsAt + 90,
        sh: 1,
        b: 0.02,
      },
      caches: this.caches,
      alive: this.units.size,
      people: 1,
      score: this.self.kills,
      ...(dropping && this.ownPick ? { drop: wire(this.ownPick) } : {}),
      ...(dropping ? { picks } : {}),
      ...(this.self.dead && this.ownBack ? { bk: wire(this.ownBack) } : {}),
    };
  }

  // The player taken down by the nearest champion, back in `waitS`
  // seconds (the probe's fall(), to look at the Respawn wait's globe).
  fall(waitS = 5): void {
    const me = this.self;
    if (me.dead) return;
    let killer: Unit | null = null;
    for (const o of this.units.values()) {
      if (o.id === me.id || o.dead) continue;
      if (!killer || dist(o.pos, me.pos) < dist(killer.pos, me.pos)) killer = o;
    }
    me.hp = 0;
    me.dead = true;
    me.deaths++;
    me.respawnAt = this.time + waitS;
    me.pendingSpell = null;
    this.ownBack = null;
    if (killer) {
      killer.kills++;
      this.notes.kills.push({ unitId: me.id, killerId: killer.id });
    }
  }

  seat(unitId: number) {
    const name = this.names.get(unitId);
    return name === undefined ? null : { name, bot: unitId !== this.selfId };
  }

  pickDrop(_unitId: number, point: Vec3): void {
    // While the player waits: where it comes back.
    if (this.self.dead) {
      this.ownBack = settle(point, R) as Vec3;
      return;
    }
    if (this.time >= this.dropEndsAt) return;
    this.ownPick = settle(point, R) as Vec3;
  }

  orderMove(unitId: number, x: number, z: number, y?: number): void {
    const b = this.brains.get(unitId);
    if (!b || y === undefined) return;
    b.moveTo = settle({ x, y, z }, R) as Vec3;
    b.targetId = null;
  }

  orderAttack(unitId: number, targetId: number): void {
    const b = this.brains.get(unitId);
    if (!b) return;
    b.targetId = targetId;
    b.moveTo = null;
  }

  orderAttackMove(unitId: number, x: number, z: number, y?: number): void {
    this.orderMove(unitId, x, z, y);
  }

  orderStop(unitId: number): void {
    const b = this.brains.get(unitId);
    if (b) {
      b.moveTo = null;
      b.targetId = null;
    }
  }

  startRecall(): void {}

  castAbility(unitId: number, key: AbilityKey, aim: Vec2): boolean {
    const u = this.units.get(unitId);
    if (!u || u.dead || aim.y === undefined) return false;
    if ((u.cooldowns[key] ?? 0) > this.time) return false;
    this.beginCast(u, key, settle(aim, R) as Vec3);
    return true;
  }

  castSigil(unitId: number, _slot: number, aim: Vec2): boolean {
    const u = this.units.get(unitId);
    if (!u || aim.y === undefined) return false;
    this.notes.casts.push({ unitId });
    return true;
  }

  buyItem(): boolean {
    return false;
  }

  sellItem(): boolean {
    return false;
  }

  drinkItem(): boolean {
    return false;
  }

  levelAbility(): boolean {
    return false;
  }

  // ------------------------------------------------------------ the tick

  step(): WorldNotes {
    this.time += DT;
    const landed = this.time >= this.dropEndsAt && this.time - DT < this.dropEndsAt;
    if (landed) this.land();
    if (this.time < this.dropEndsAt) {
      // No pick by the drop's middle: one is made for the player.
      if (!this.ownPick && this.time > this.dropEndsAt - this.opts.dropS * 0.5) {
        this.ownPick = this.start;
      }
    } else {
      for (const u of this.units.values()) this.think(u);
      this.resolvePending();
      this.stepProjectiles();
      this.stepZones();
    }
    for (const [id, w] of this.walls) if (w.until <= this.time) this.walls.delete(id);
    const out = this.notes;
    this.notes = { kills: [], casts: [], hits: [], attacks: [] };
    return { kills: out.kills, golds: [], casts: out.casts, hits: out.hits, attacks: out.attacks };
  }

  // Everyone lands where they picked; the player's fight lands around them.
  private land(): void {
    const at = this.ownPick ?? this.start;
    let i = 0;
    for (const u of this.units.values()) {
      if (u.id === this.selfId) u.pos = copy(at);
      else if (i < (this.opts.near ?? 9)) u.pos = around(at, 6 + this.rand() * 14, this.rand);
      i++;
    }
  }

  private brain(u: Unit): Brain {
    return this.brains.get(u.id)!;
  }

  private nearestEnemy(u: Unit, reach: number): Unit | null {
    let best: Unit | null = null;
    let bestD = reach;
    for (const o of this.units.values()) {
      if (o.id === u.id || o.dead) continue;
      const d = dist(u.pos, o.pos);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  private think(u: Unit): void {
    const b = this.brain(u);
    const throw_ = this.thrown.get(u.id);
    if (throw_) {
      // 50 m in 1.6 s along the pad's great circle (PAD_THROW_M).
      const t = Math.min(1, (this.time - throw_.at) / 1.6);
      u.pos = settle(lerp(throw_.from, throw_.to, t), R);
      if (t >= 1) this.thrown.delete(u.id);
      return;
    }
    if (u.dead) {
      if (this.time >= u.respawnAt) {
        u.dead = false;
        u.hp = u.maxHp;
        u.mana = u.maxMana;
        u.pos =
          u.id === this.selfId && this.ownBack
            ? copy(this.ownBack)
            : around(this.self.pos as Vec3, 8 + this.rand() * 12, this.rand);
        if (u.id === this.selfId) this.ownBack = null;
        b.heading = randomHeading(u.pos as Vec3, this.rand);
      }
      return;
    }
    u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.012 * DT);
    if (u.id === this.selfId && u.hp < u.maxHp * 0.35) u.hp += u.maxHp * 0.08 * DT;
    u.mana = u.maxMana;
    if (b.dash) {
      const arrived = stepToward(u.pos, b.dash.to, 16 * DT);
      if (arrived || this.time >= b.dash.until) {
        b.dash = null;
        u.activeDash = null;
      }
      return;
    }
    if (u.pendingSpell) return;
    const speed = u.moveSpeed * DT;
    const isSelf = u.id === this.selfId;
    let target = b.targetId !== null ? (this.units.get(b.targetId) ?? null) : null;
    if (target?.dead) target = null;
    if (!isSelf && !target && !b.moveTo) target = this.nearestEnemy(u, 11);
    if (isSelf && !target && b.moveTo) {
      u.path = [b.moveTo];
      if (stepToward(u.pos, b.moveTo, speed)) {
        b.moveTo = null;
        u.path = [];
      }
      return;
    }
    if (target) {
      b.targetId = target.id;
      const d = dist(u.pos, target.pos);
      const reach = u.stats.attackRange + u.radius + target.radius;
      if (d > reach) {
        stepToward(u.pos, target.pos, speed);
      } else if (this.time >= b.attackAt) {
        b.attackAt = this.time + 1 / u.stats.attackSpeed;
        this.notes.attacks.push({ unitId: u.id, targetId: target.id });
        if (u.stats.attackRange > RANGED_THRESHOLD) {
          this.spawnBolt(u, target.pos as Vec3, `${u.championId}_A`, 22, 0.25, d + 2, target.id);
        } else {
          this.damage(u, target, u.stats.ad * 0.6);
        }
      }
      if (!isSelf && this.time >= b.castAt && d < 12) {
        b.castAt = this.time + 2.2 + this.rand() * 2.6;
        const key = KEYS[Math.floor(this.rand() * 4)]!;
        this.beginCast(u, key, copy(target.pos) as Vec3);
      }
      if (!isSelf && d > 16) b.targetId = null;
      return;
    }
    if (isSelf) return;
    // Wander a great circle, turning now and then.
    if (this.time >= b.turnAt) {
      b.turnAt = this.time + 3 + this.rand() * 5;
      b.heading = rotate(b.heading, (this.rand() - 0.5) * 2.2, u.pos) as Vec3;
    }
    // Strays drift back toward the fight around the player.
    if (dist(u.pos, this.self.pos) > 34 && u.id <= 1 + (this.opts.near ?? 9)) {
      b.heading = (dirTo(u.pos, this.self.pos) as Vec3) ?? b.heading;
    }
    // Rock, water or a trunk ahead: turn away.
    if (this.ground.blocked(offset(u.pos, b.heading, 1.2) as Vec3)) {
      b.heading = rotate(b.heading, Math.PI * (0.5 + this.rand()), u.pos) as Vec3;
      return;
    }
    advance(u.pos, b.heading, speed);
    u.path = [offset(u.pos, b.heading, 3)];
  }

  // The champion nearest the player's nearest pad stands on it and is
  // thrown: a look at a flight's arc. Returns the thrown unit's id.
  throwOnPad(): number | null {
    const me = this.self;
    const pad = [...this.ground.layout.pads].sort(
      (a, b) => dist(a.at, me.pos) - dist(b.at, me.pos),
    )[0];
    if (!pad) return null;
    let best: Unit | null = null;
    for (const u of this.units.values()) {
      if (u.id === me.id || u.dead) continue;
      if (!best || dist(u.pos, pad.at) < dist(best.pos, pad.at)) best = u;
    }
    if (!best) return null;
    best.pos = copy(pad.at);
    this.thrown.set(best.id, { from: pad.at, to: pad.to, at: this.time });
    return best.id;
  }

  // Every champion near the player casts its ultimate at once, aimed a
  // few meters off the player: a look at the effects on the curve.
  showcase(): void {
    const me = this.self;
    for (const u of this.units.values()) {
      if (u.id === me.id || u.dead || dist(u.pos, me.pos) > 18) continue;
      this.brain(u).castAt = this.time + 4;
      u.cooldowns = {};
      this.beginCast(u, 'R', around(me.pos as Vec3, 3 + this.rand() * 4, this.rand));
    }
  }

  private beginCast(u: Unit, key: AbilityKey, aim: Vec3): void {
    const def = u.championId ? CHAMPIONS[u.championId]?.abilities[key] : undefined;
    if (!def) return;
    u.cooldowns[key] = this.time + Math.min(def.cooldown, 4);
    this.notes.casts.push({ unitId: u.id, key });
    if (def.windup && def.windup > 0) {
      u.pendingSpell = { key, aim, resolveAt: this.time + def.windup };
      this.pending.push({ unitId: u.id, key, aim, at: this.time + def.windup });
      return;
    }
    this.resolveCast(u, key, aim);
  }

  private resolvePending(): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i]!;
      if (this.time < p.at) continue;
      this.pending.splice(i, 1);
      const u = this.units.get(p.unitId);
      if (!u || u.dead) continue;
      u.pendingSpell = null;
      this.resolveCast(u, p.key, p.aim);
    }
  }

  private resolveCast(u: Unit, key: AbilityKey, aim: Vec3): void {
    const def = u.championId ? CHAMPIONS[u.championId]?.abilities[key] : undefined;
    if (!def) return;
    const spec = def.spec;
    const tag = `${u.championId}_${key}`;
    if (spec.kind === 'skillshot') {
      this.spawnBolt(u, aim, tag, spec.speed, spec.radius, Math.min(spec.range, 40), null);
    } else if (spec.kind === 'zone') {
      const at =
        dist(u.pos, aim) > def.castRange
          ? (offset(u.pos, dirTo(u.pos, aim)!, def.castRange) as Vec3)
          : aim;
      const id = this.nextId++;
      this.zones.set(id, {
        id,
        sourceId: u.id,
        team: u.team,
        pos: settle(at, R),
        radius: spec.radius,
        until: this.time + Math.min(spec.duration, 4),
        tickEvery: 0.5,
        nextTickAt: this.time + 0.5,
        detonateAt: spec.detonateDelay !== undefined ? this.time + spec.detonateDelay : null,
        vfx: tag,
      } as unknown as Zone);
    } else if (spec.kind === 'dash') {
      const dir = dirTo(u.pos, aim);
      if (dir) {
        const to = settle(offset(u.pos, dir, Math.min(spec.range, dist(u.pos, aim))), R) as Vec3;
        this.brain(u).dash = { to, until: this.time + 0.6 };
        u.activeDash = {} as Unit['activeDash'];
      }
    } else if (spec.kind === 'wall') {
      const dir = dirTo(u.pos, aim);
      if (dir) {
        const across = turnLeft(dir, aim);
        const half = (spec as { length?: number }).length ?? 4;
        const id = this.nextId++;
        this.walls.set(id, {
          id,
          sourceId: u.id,
          team: u.team,
          a: settle(offset(aim, across, half / 2), R),
          b: settle(offset(aim, across, -half / 2), R),
          until: this.time + 3,
          samples: [],
        });
      }
    } else {
      // Burst, cone, targeted: the cast note's effect, damage around.
      const reach =
        spec.kind === 'burst' ? spec.radius : spec.kind === 'cone' ? spec.range : def.castRange;
      for (const o of this.units.values()) {
        if (o.id === u.id || o.dead) continue;
        if (dist(o.pos, u.pos) <= reach) this.damage(u, o, 60 + this.rand() * 50);
      }
    }
  }

  private spawnBolt(
    u: Unit,
    aim: Vec3,
    tag: string,
    speed: number,
    radius: number,
    range: number,
    homing: number | null,
  ): void {
    const dir = dirTo(u.pos, aim);
    if (!dir) return;
    const id = this.nextId++;
    this.projectiles.set(id, {
      id,
      sourceId: u.id,
      team: u.team,
      pos: copy(offset(u.pos, dir, 0.6)),
      dir: copy(dir),
      speed,
      radius,
      maxRange: range,
      traveled: 0,
      homingTargetId: homing,
      pierce: false,
      hitIds: new Set(),
      vfx: tag,
    } as unknown as Projectile);
  }

  private stepProjectiles(): void {
    for (const [id, p] of this.projectiles) {
      if (p.homingTargetId !== null) {
        const t = this.units.get(p.homingTargetId);
        if (!t || t.dead) {
          this.projectiles.delete(id);
          continue;
        }
        const d = dirTo(p.pos, t.pos);
        if (d) p.dir = d;
      }
      const step = p.speed * DT;
      advance(p.pos, p.dir, step);
      p.pos = settle(p.pos, R);
      p.traveled += step;
      let hit = false;
      for (const o of this.units.values()) {
        if (o.id === p.sourceId || o.dead) continue;
        if (dist(o.pos, p.pos) <= p.radius + o.radius) {
          const src = this.units.get(p.sourceId);
          if (src) this.damage(src, o, p.vfx?.endsWith('_A') ? src.stats.ad * 0.6 : 90);
          hit = true;
          break;
        }
      }
      if (hit || p.traveled >= p.maxRange) this.projectiles.delete(id);
    }
  }

  private stepZones(): void {
    for (const [id, z] of this.zones) {
      if (this.time >= z.until || (z.detonateAt !== null && this.time >= z.detonateAt)) {
        this.zones.delete(id);
        continue;
      }
      if (this.time < z.nextTickAt) continue;
      z.nextTickAt = this.time + z.tickEvery;
      const src = this.units.get(z.sourceId);
      if (!src) continue;
      for (const o of this.units.values()) {
        if (o.id === z.sourceId || o.dead) continue;
        if (dist(o.pos, z.pos) <= z.radius) this.damage(src, o, 18);
      }
    }
  }

  private damage(from: Unit, to: Unit, amount: number): void {
    if (to.dead) return;
    to.hp -= amount;
    to.lastDamagedAt = this.time;
    if (from.id === this.selfId) this.notes.hits.push({ targetId: to.id, amount });
    if (to.hp > 0) return;
    if (to.id === this.selfId) {
      to.hp = to.maxHp * 0.3;
      return;
    }
    to.hp = 0;
    to.dead = true;
    to.deaths++;
    to.respawnAt = this.time + 4;
    to.pendingSpell = null;
    from.kills++;
    this.notes.kills.push({ unitId: to.id, killerId: from.id });
  }
}
