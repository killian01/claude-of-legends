// The online mirror world: implements IWorld by applying server snapshots.
// It never decides outcomes (ADR 0001): commands go up the wire, state comes
// back down. Everything received is visible by construction, because the
// server scopes snapshots to this client's team before sending.
// Transport-agnostic: give it a send function, feed it server messages.

import { ChampionRegistry } from '../sim/champion_registry';
import type { Status } from '../sim/combat/status';
import type { ChampionDef } from '../sim/content/champions';
import type { GameMap } from '../sim/content/map';
import type { ForgedChampionDef } from '../sim/forge/forged_def';
import type { Projectile } from '../sim/projectiles';
import type { AbilityKey, ScoreRow, TeamId, Vec2 } from '../sim/types';
import type { Unit } from '../sim/unit';
import type { Wall } from '../sim/walls';
import type { Zone } from '../sim/zones';
import type { IWorld } from '../world_api';
import type { ClientMsg, ServerMsg, SnapUnit } from './protocol';

// Rebuilds a displayable Status from its wire chip.
function toStatus(k: string, until: number, v: number | undefined): Status | null {
  switch (k) {
    case 'stun':
      return { kind: 'stun', until };
    case 'root':
      return { kind: 'root', until };
    case 'recall':
      return { kind: 'recall', until };
    case 'airborne':
      return { kind: 'airborne', until };
    case 'untargetable':
      return { kind: 'untargetable', until };
    case 'stealth':
      return { kind: 'stealth', until };
    case 'slow':
      return { kind: 'slow', until, pct: v ?? 0 };
    case 'shield':
      return { kind: 'shield', until, remaining: v ?? 0 };
    case 'mark':
      // Display-only mirror: the source pool is server business.
      return { kind: 'mark', until, stacks: v ?? 1, sourceId: 0 };
    case 'dot':
      return { kind: 'dot', until, perSecond: v ?? 0, sourceId: 0, dtype: 'magic' };
    case 'grievous':
      return { kind: 'grievous', until, factor: v ?? 0 };
    case 'taunt':
      return { kind: 'taunt', until, sourceId: 0 };
    case 'buff':
      return { kind: 'buff', until, msPct: 0, asPct: 0, armor: 0, mr: 0 };
    default:
      return null;
  }
}

function applyWireStatuses(
  u: Unit,
  st: { k: string; v?: number }[] | undefined,
  until: number,
): void {
  u.statuses = [];
  if (!st) return;
  for (const entry of st) {
    const status = toStatus(entry.k, until, entry.v);
    if (status) u.statuses.push(status);
  }
}

function materializeUnit(s: SnapUnit): Unit {
  return {
    id: s.i,
    team: s.t ?? 0,
    neutral: s.k === 'warden' || s.k === 'camp',
    kind: s.k ?? 'champion',
    championId: s.c ?? null,
    // Resolved against the match registry by the caller (applyServer).
    champion: null,
    pos: { x: s.x, z: s.z },
    radius: s.r ?? 0.6,
    moveSpeed: 0,
    hp: s.h,
    maxHp: s.m,
    mana: 0,
    maxMana: 0,
    stats: {
      ad: 0,
      ap: 0,
      armor: 0,
      mr: 0,
      attackRange: s.rg ?? 0,
      attackSpeed: 0,
      hpRegen: 0,
      manaRegen: 0,
      armorPen: 0,
      mrPen: 0,
      armorPenPct: 0,
      mrPenPct: 0,
    },
    statuses: [],
    cooldowns: {},
    abilityRanks: { Q: 1, W: 1, E: 1, R: 0 },
    skillPoints: 0,
    skin: s.sk ?? 0,
    passiveStacks: 0,
    lastDamagedAt: -999,
    play: null,
    coachOrder: null,
    coachOrderSeenAt: 0,
    lanePrefer: null,
    attackTargetId: null,
    attackReadyAt: 0,
    attackMoveTarget: null,
    holding: false,
    pendingSpell: null,
    activeDash: null,
    recastArmed: null,
    pendingAttack: null,
    path: [],
    level: s.l ?? 1,
    xp: 0,
    gold: 0,
    items: [],
    kills: 0,
    deaths: 0,
    assists: 0,
    cs: 0,
    killStreak: 0,
    recentDamagers: [],
    dead: false,
    respawnAt: 0,
    lastHitByChampion: 0,
    lastHitAt: -999,
    // Mirrors the sim's per-kind sight so the client fog overlay matches.
    sightRange: s.k === 'champion' ? 12 : s.k === 'tower' ? 10 : 8,
    goldBounty: 0,
    xpBounty: 0,
    sigils: [],
    sigilCooldowns: [],
    decisionTokens: 0,
    decisionRefillAt: 0,
    structure: s.s ?? null,
    lane: null,
    laneProgress: 0,
  };
}

export class ClientWorld implements IWorld {
  readonly units = new Map<number, Unit>();
  readonly projectiles = new Map<number, Projectile>();
  readonly zones = new Map<number, Zone>();
  readonly walls = new Map<number, Wall>();
  time = 0;
  winner: TeamId | null = null;
  selfUnitId = 0;
  selfTeam: TeamId = 0;
  // A coach seat (ADR 0013): the orders translate into coach orders and
  // the hands-on verbs are refused here already; the bot plays by itself.
  coach = false;
  private scoreRows: readonly ScoreRow[] = [];
  private objAt: number | null = null;
  private boon: { until: number; stacks: number } | null = null;
  private enemyBoon: { until: number; stacks: number } | null = null;

  // Match-scoped champion resolution, mirroring the server sim's registry:
  // the Forge queue delivers the match's forged definitions at setup and
  // registerForged() loads them before the first snapshot arrives.
  readonly champions = new ChampionRegistry();

  // The map the match is played on (ADR 0021): the mirror renders and
  // reasons on the record the server's sim runs, handed in by the host.
  constructor(
    private readonly send: (msg: ClientMsg) => void,
    readonly map: GameMap,
  ) {}

  championDef(championId: string): ChampionDef | null {
    return this.champions.get(championId);
  }

  // Idempotent on purpose: match_start can arrive again on a rejoin, and
  // re-registering the same match's definitions must not throw the mirror
  // down mid-claim.
  registerForged(defs: readonly ForgedChampionDef[]): void {
    for (const def of defs) {
      if (this.champions.get(def.id) === null) this.champions.addForged(def);
    }
  }

  scoreboard(): readonly ScoreRow[] {
    return this.scoreRows;
  }

  // Both teams' Boons ride the wire (the HUD shows the enemy's threat too).
  teamBuff(team: TeamId): { until: number; stacks: number } | null {
    const b = team === this.selfTeam ? this.boon : this.enemyBoon;
    return b && b.until > this.time ? b : null;
  }

  objectiveSpawnAt(): number | null {
    return this.objAt;
  }

  // The server already scoped the snapshot to this team's vision.
  isVisible(_team: TeamId, unitId: number): boolean {
    return this.units.has(unitId);
  }

  orderMove(_unitId: number, x: number, z: number): void {
    this.send(this.coach ? { t: 'order', kind: 'goto', x, z } : { t: 'move', x, z });
  }

  orderAttack(_unitId: number, targetId: number): void {
    this.send(this.coach ? { t: 'order', kind: 'focus', targetId } : { t: 'attack', targetId });
  }

  orderAttackMove(_unitId: number, x: number, z: number): void {
    this.send(this.coach ? { t: 'order', kind: 'goto', x, z } : { t: 'attack_move', x, z });
  }

  startRecall(_unitId: number): void {
    this.send(this.coach ? { t: 'order', kind: 'back' } : { t: 'recall' });
  }

  orderStop(_unitId: number): void {
    this.send(this.coach ? { t: 'order', kind: 'hold' } : { t: 'stop' });
  }

  castAbility(_unitId: number, key: AbilityKey, aim: Vec2): boolean {
    if (this.coach) return false;
    this.send({ t: 'cast', key, x: aim.x, z: aim.z });
    return true;
  }

  castSigil(_unitId: number, slot: number, aim: Vec2): boolean {
    if (this.coach) return false;
    this.send({ t: 'sigil', slot, x: aim.x, z: aim.z });
    return true;
  }

  buyItem(_unitId: number, itemId: string): boolean {
    if (this.coach) return false;
    this.send({ t: 'buy', itemId });
    return true;
  }

  sellItem(_unitId: number, slot: number): boolean {
    if (this.coach) return false;
    this.send({ t: 'sell', slot });
    return true;
  }

  levelAbility(_unitId: number, key: AbilityKey): boolean {
    if (this.coach) return false;
    this.send({ t: 'skill', key });
    return true;
  }

  // Returns true when the message changed world state (a new snapshot).
  applyServer(msg: ServerMsg): boolean {
    if (msg.t === 'match_start') {
      this.selfUnitId = msg.selfUnitId;
      this.selfTeam = msg.team;
      this.coach = msg.coach === true;
      // Forge queue: the match's forged definitions land here, before any
      // snapshot can name one of them.
      if (msg.forged) this.registerForged(msg.forged);
      return false;
    }
    if (msg.t === 'score') {
      this.scoreRows = msg.rows;
      return false;
    }
    if (msg.t !== 'snap') return false;

    this.time = msg.time;
    this.winner = msg.winner;

    for (const id of msg.gone) this.units.delete(id);
    const ccUntil = msg.time + 0.35;
    for (const s of msg.units) {
      let unit = this.units.get(s.i);
      if (!unit) {
        unit = materializeUnit(s);
        unit.champion = unit.championId ? this.champions.get(unit.championId) : null;
        this.units.set(s.i, unit);
      } else {
        unit.pos.x = s.x;
        unit.pos.z = s.z;
        unit.hp = s.h;
        unit.maxHp = s.m;
        if (s.l !== undefined) unit.level = s.l;
      }
      unit.dead = s.d === 1;
      unit.play = s.p ?? null;
      unit.coachOrder = s.co ?? null;
      applyWireStatuses(unit, s.st, ccUntil);
      // Windup telegraph mirror: the renderer reads pendingSpell to draw
      // the charge and its aim for every visible champion.
      unit.pendingSpell = s.w
        ? { key: s.w.k, aim: { x: s.w.x, z: s.w.z }, resolveAt: s.w.u }
        : null;
    }

    this.objAt = msg.objAt ?? null;
    if (msg.self) {
      this.boon =
        msg.self.boonUntil !== undefined
          ? { until: msg.self.boonUntil, stacks: msg.self.boonStacks ?? 1 }
          : null;
      this.enemyBoon =
        msg.self.enemyBoonUntil !== undefined
          ? { until: msg.self.enemyBoonUntil, stacks: msg.self.enemyBoonStacks ?? 1 }
          : null;
      const self = this.units.get(this.selfUnitId);
      if (self) {
        self.mana = msg.self.mana;
        self.maxMana = msg.self.maxMana;
        self.stats.ad = msg.self.ad ?? 0;
        self.gold = msg.self.gold;
        self.level = msg.self.level;
        self.xp = msg.self.xp;
        self.dead = msg.self.dead;
        self.respawnAt = msg.self.respawnAt;
        self.cooldowns = msg.self.cooldowns;
        self.abilityRanks = msg.self.abilityRanks;
        self.skillPoints = msg.self.skillPoints;
        self.sigilCooldowns = msg.self.sigilCooldowns;
        self.items = msg.self.items;
        self.sigils = msg.self.sigils;
        self.statuses = [];
        for (const entry of msg.self.statuses) {
          const status = toStatus(entry.k, entry.until, entry.v);
          if (status) self.statuses.push(status);
        }
      }
    }

    const seenP = new Set<number>();
    for (const p of msg.projectiles) {
      seenP.add(p.i);
      const existing = this.projectiles.get(p.i);
      if (existing) {
        existing.pos.x = p.x;
        existing.pos.z = p.z;
      } else {
        this.projectiles.set(p.i, {
          id: p.i,
          sourceId: p.s ?? 0,
          team: p.t,
          pos: { x: p.x, z: p.z },
          dir: { x: 1, z: 0 },
          speed: 0,
          radius: p.r,
          maxRange: 0,
          traveled: 0,
          homingTargetId: null,
          pierce: false,
          hitIds: new Set(),
          power: { ad: 0, ap: 0 },
          onHit: [],
          allyEffects: [],
          chain: null,
          leaveWall: null,
          aftershock: null,
          splashOnHit: null,
          vfx: p.v ?? null,
        });
      }
    }
    for (const id of [...this.projectiles.keys()]) {
      if (!seenP.has(id)) this.projectiles.delete(id);
    }

    const seenZ = new Set<number>();
    for (const z of msg.zones) {
      seenZ.add(z.i);
      const existingZone = this.zones.get(z.i);
      if (existingZone) {
        // Zones rarely move today, but a frozen mirror would silently
        // misplace any future moving zone.
        existingZone.pos.x = z.x;
        existingZone.pos.z = z.z;
      } else {
        this.zones.set(z.i, {
          id: z.i,
          sourceId: 0,
          team: z.t,
          pos: { x: z.x, z: z.z },
          radius: z.r,
          until: 0,
          tickEvery: 0,
          nextTickAt: 0,
          power: { ad: 0, ap: 0 },
          onEnter: [],
          onTick: [],
          allyOnTick: [],
          detonateAt: null,
          onDetonate: [],
          entered: new Set(),
          reveal: false,
          boundary: null,
          boundaryNextAt: new Map(),
          insideIds: new Set(),
          leaveZone: null,
          vfx: z.v ?? null,
        });
      }
    }
    for (const id of [...this.zones.keys()]) {
      if (!seenZ.has(id)) this.zones.delete(id);
    }

    const seenW = new Set<number>();
    for (const w of msg.walls ?? []) {
      seenW.add(w.i);
      if (!this.walls.has(w.i)) {
        this.walls.set(w.i, {
          id: w.i,
          sourceId: 0,
          team: w.t,
          a: { x: w.x1, z: w.z1 },
          b: { x: w.x2, z: w.z2 },
          until: w.u,
          // The mirror never blocks or unblocks: pathing is server truth.
          samples: [],
        });
      }
    }
    for (const id of [...this.walls.keys()]) {
      if (!seenW.has(id)) this.walls.delete(id);
    }

    return true;
  }
}
