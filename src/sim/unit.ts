// The shared unit model. Champions, minions, towers, and Sanctums are all
// units; what varies is data (stats, kind), not the entity shape.

import type { Status } from './combat/status';
import type { ChampionDef } from './content/champions';
import type { LaneId } from './content/map';
import type { AbilityKey, TeamId, Vec2 } from './types';

export type UnitKind = 'champion' | 'minion' | 'tower' | 'sanctum';

export type MinionVariant = 'melee' | 'caster' | 'siege';

export interface UnitStats {
  ad: number;
  ap: number;
  armor: number;
  mr: number;
  attackRange: number;
  attackSpeed: number;
  hpRegen: number;
  manaRegen: number;
}

export interface StructureMeta {
  lane: LaneId | 'sanctum';
  tier: 1 | 2;
}

export interface Unit {
  id: number;
  team: TeamId;
  kind: UnitKind;
  championId: string | null;
  pos: Vec2;
  radius: number;
  moveSpeed: number;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  stats: UnitStats;
  statuses: Status[];
  // Ready-at sim times per ability key.
  cooldowns: Partial<Record<AbilityKey, number>>;
  attackTargetId: number | null;
  attackReadyAt: number;
  // Attack-move destination; enemies encountered on the way are engaged.
  attackMoveTarget: Vec2 | null;
  // Remaining waypoints toward the current move order; empty when idle.
  path: Vec2[];
  // Progression and economy (champions).
  level: number;
  xp: number;
  gold: number;
  items: string[];
  kills: number;
  deaths: number;
  // Death state: champions stay in the sim while dead; everything else is
  // removed on death.
  dead: boolean;
  respawnAt: number;
  // Aggro memory: the last enemy CHAMPION that damaged this champion, for
  // tower and minion aggro switching (the core laning rules).
  lastHitByChampion: number;
  lastHitAt: number;
  // Vision and rewards.
  sightRange: number;
  goldBounty: number;
  xpBounty: number;
  // The two equipped sigils and their ready-at times (champions).
  sigils: string[];
  sigilCooldowns: number[];
  // Decision budget token bucket (ADR 0003), identical for humans and bots.
  decisionTokens: number;
  decisionRefillAt: number;
  // Structure metadata (towers only; the Sanctum core is identified by kind).
  structure: StructureMeta | null;
  // Lane minion state.
  lane: LaneId | null;
  laneProgress: number;
}

// Ground a static unit (tower, Sanctum) blocks in the NavGrid while it
// stands, slightly padded so champions keep visual separation from it.
// Blocked at spawn, unblocked at death, with this exact same value.
export function staticFootprint(u: Unit): number {
  return u.radius + 0.4;
}

function baseUnit(id: number, team: TeamId, kind: UnitKind, pos: Vec2): Unit {
  return {
    id,
    team,
    kind,
    championId: null,
    pos: { x: pos.x, z: pos.z },
    radius: 0.6,
    moveSpeed: 0,
    hp: 1,
    maxHp: 1,
    mana: 0,
    maxMana: 0,
    stats: {
      ad: 0,
      ap: 0,
      armor: 0,
      mr: 0,
      attackRange: 0,
      attackSpeed: 0,
      hpRegen: 0,
      manaRegen: 0,
    },
    statuses: [],
    cooldowns: {},
    attackTargetId: null,
    attackReadyAt: 0,
    attackMoveTarget: null,
    path: [],
    level: 1,
    xp: 0,
    gold: 0,
    items: [],
    kills: 0,
    deaths: 0,
    dead: false,
    respawnAt: 0,
    lastHitByChampion: 0,
    lastHitAt: -999,
    sightRange: 8,
    goldBounty: 0,
    xpBounty: 0,
    sigils: [],
    sigilCooldowns: [],
    decisionTokens: 2,
    decisionRefillAt: 0,
    structure: null,
    lane: null,
    laneProgress: 0,
  };
}

export function createChampion(id: number, team: TeamId, pos: Vec2, def: ChampionDef): Unit {
  const b = def.base;
  const u = baseUnit(id, team, 'champion', pos);
  u.championId = def.id;
  u.radius = b.radius;
  u.moveSpeed = b.moveSpeed;
  u.hp = b.hp;
  u.maxHp = b.hp;
  u.mana = b.mana;
  u.maxMana = b.mana;
  u.stats = {
    ad: b.ad,
    ap: b.ap,
    armor: b.armor,
    mr: b.mr,
    attackRange: b.attackRange,
    attackSpeed: b.attackSpeed,
    hpRegen: b.hpRegen,
    manaRegen: b.manaRegen,
  };
  u.gold = 500;
  u.sightRange = 12;
  u.goldBounty = 300;
  u.xpBounty = 200;
  u.sigils = ['riftstep', 'mend'];
  u.sigilCooldowns = [0, 0];
  return u;
}

// `scale` grows minions with game time (review F.0: identical waves
// annihilate each other exactly and no pressure ever reaches a tower).
export function createMinion(
  id: number,
  team: TeamId,
  variant: MinionVariant,
  lane: LaneId,
  pos: Vec2,
  scale = 1,
): Unit {
  const u = baseUnit(id, team, 'minion', pos);
  u.lane = lane;
  u.laneProgress = 1;
  u.moveSpeed = 3.4;
  if (variant === 'melee') {
    u.radius = 0.5;
    u.hp = 455;
    u.stats.ad = 12;
    u.stats.attackRange = 0.5;
    u.stats.attackSpeed = 1.25;
    u.goldBounty = 21;
    u.xpBounty = 60;
  } else if (variant === 'caster') {
    u.radius = 0.4;
    u.hp = 290;
    u.stats.ad = 23;
    u.stats.attackRange = 6;
    u.stats.attackSpeed = 0.67;
    u.goldBounty = 14;
    u.xpBounty = 30;
  } else {
    // Siege: the wave-breaker that actually threatens towers.
    u.radius = 0.6;
    u.hp = 900;
    u.stats.ad = 45;
    u.stats.attackRange = 4;
    u.stats.attackSpeed = 0.5;
    u.goldBounty = 60;
    u.xpBounty = 90;
  }
  u.hp = Math.round(u.hp * scale);
  u.maxHp = u.hp;
  u.stats.ad = Math.round(u.stats.ad * scale);
  return u;
}

export function createTower(id: number, team: TeamId, pos: Vec2, structure: StructureMeta): Unit {
  const u = baseUnit(id, team, 'tower', pos);
  u.radius = 1.4;
  // Tuned down from 2500/40 after review F.0 measured towers as
  // mechanically unkillable (~96 s of uninterrupted champion dps).
  u.hp = 1800;
  u.maxHp = 1800;
  u.stats.ad = 170;
  u.stats.armor = 25;
  u.stats.mr = 25;
  u.stats.attackRange = 9;
  u.stats.attackSpeed = 0.83;
  u.sightRange = 10;
  u.goldBounty = 250;
  u.xpBounty = 100;
  u.structure = structure;
  return u;
}

export function createSanctum(id: number, team: TeamId, pos: Vec2): Unit {
  const u = baseUnit(id, team, 'sanctum', pos);
  u.radius = 2.2;
  u.hp = 3000;
  u.maxHp = 3000;
  u.stats.armor = 25;
  u.stats.mr = 25;
  return u;
}
