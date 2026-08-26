// The online mirror world: implements IWorld by applying server snapshots.
// It never decides outcomes (ADR 0001): commands go up the wire, state comes
// back down. Everything received is visible by construction, because the
// server scopes snapshots to this client's team before sending.
// Transport-agnostic: give it a send function, feed it server messages.

import type { Status } from '../sim/combat/status';
import { CHAMPIONS, type ChampionDef } from '../sim/content/champions';
import { GAME_MAP, type GameMap } from '../sim/content/map';
import type { Projectile } from '../sim/projectiles';
import type { AbilityKey, ScoreRow, TeamId, Vec2 } from '../sim/types';
import type { Unit } from '../sim/unit';
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
    case 'stealth':
      return { kind: 'stealth', until };
    case 'slow':
      return { kind: 'slow', until, pct: v ?? 0 };
    case 'shield':
      return { kind: 'shield', until, remaining: v ?? 0 };
    case 'mark':
      return { kind: 'mark', until, stacks: v ?? 1 };
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
    kind: s.k ?? 'champion',
    championId: s.c ?? null,
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
    },
    statuses: [],
    cooldowns: {},
    abilityRanks: { Q: 1, W: 1, E: 1, R: 0 },
    skillPoints: 0,
    skin: s.sk ?? 0,
    passiveStacks: 0,
    lastDamagedAt: -999,
    attackTargetId: null,
    attackReadyAt: 0,
    attackMoveTarget: null,
    path: [],
    level: s.l ?? 1,
    xp: 0,
    gold: 0,
    items: [],
    kills: 0,
    deaths: 0,
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
  readonly map: GameMap = GAME_MAP;
  readonly units = new Map<number, Unit>();
  readonly projectiles = new Map<number, Projectile>();
  readonly zones = new Map<number, Zone>();
  time = 0;
  winner: TeamId | null = null;
  selfUnitId = 0;
  selfTeam: TeamId = 0;
  private scoreRows: readonly ScoreRow[] = [];

  constructor(private readonly send: (msg: ClientMsg) => void) {}

  championDef(championId: string): ChampionDef | null {
    return CHAMPIONS[championId] ?? null;
  }

  scoreboard(): readonly ScoreRow[] {
    return this.scoreRows;
  }

  // The server already scoped the snapshot to this team's vision.
  isVisible(_team: TeamId, unitId: number): boolean {
    return this.units.has(unitId);
  }

  orderMove(_unitId: number, x: number, z: number): void {
    this.send({ t: 'move', x, z });
  }

  orderAttack(_unitId: number, targetId: number): void {
    this.send({ t: 'attack', targetId });
  }

  orderAttackMove(_unitId: number, x: number, z: number): void {
    this.send({ t: 'attack_move', x, z });
  }

  startRecall(_unitId: number): void {
    this.send({ t: 'recall' });
  }

  castAbility(_unitId: number, key: AbilityKey, aim: Vec2): boolean {
    this.send({ t: 'cast', key, x: aim.x, z: aim.z });
    return true;
  }

  castSigil(_unitId: number, slot: number, aim: Vec2): boolean {
    this.send({ t: 'sigil', slot, x: aim.x, z: aim.z });
    return true;
  }

  buyItem(_unitId: number, itemId: string): boolean {
    this.send({ t: 'buy', itemId });
    return true;
  }

  levelAbility(_unitId: number, key: AbilityKey): boolean {
    this.send({ t: 'skill', key });
    return true;
  }

  // Returns true when the message changed world state (a new snapshot).
  applyServer(msg: ServerMsg): boolean {
    if (msg.t === 'match_start') {
      this.selfUnitId = msg.selfUnitId;
      this.selfTeam = msg.team;
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
        this.units.set(s.i, unit);
      } else {
        unit.pos.x = s.x;
        unit.pos.z = s.z;
        unit.hp = s.h;
        unit.maxHp = s.m;
        if (s.l !== undefined) unit.level = s.l;
      }
      unit.dead = s.d === 1;
      applyWireStatuses(unit, s.st, ccUntil);
    }

    if (msg.self) {
      const self = this.units.get(this.selfUnitId);
      if (self) {
        self.mana = msg.self.mana;
        self.maxMana = msg.self.maxMana;
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
          sourceId: 0,
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
          vfx: z.v ?? null,
        });
      }
    }
    for (const id of [...this.zones.keys()]) {
      if (!seenZ.has(id)) this.zones.delete(id);
    }

    return true;
  }
}
