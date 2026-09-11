// The shared unit model. Champions, minions, towers, and Sanctums are all

// units; what varies is data (stats, kind), not the entity shape.

import type { CoachOrder } from './coach';
import type { Status } from './combat/status';
import type { ChampionDef } from './content/champions';
import type { LaneId } from './content/map';
import type { AspectId, CreatureDef, CreatureId } from './content/rings';
import type { DashState } from './dashes';
import { type FavorStacks, NO_FAVORS } from './favors';
import type { AbilityKey, TeamId, Vec2 } from './types';

export type UnitKind = 'champion' | 'minion' | 'tower' | 'sanctum' | 'warden' | 'camp' | 'creature';

export type MinionVariant = 'melee' | 'caster' | 'siege' | 'vanguard';

export interface UnitStats {
  ad: number;
  ap: number;
  armor: number;
  mr: number;
  attackRange: number;
  attackSpeed: number;
  hpRegen: number;
  manaRegen: number;
  // Penetration from items: pct shreds the resist first, flat subtracts.
  armorPen: number;
  mrPen: number;
  armorPenPct: number;
  mrPenPct: number;
}

export interface StructureMeta {
  lane: LaneId | 'sanctum';
  tier: 1 | 2 | 3;
}

export interface Unit {
  id: number;
  team: TeamId;
  // Neutral units (the Warden) carry a nominal team but are hostile to
  // everyone; use hostile() instead of comparing teams directly.
  neutral: boolean;
  kind: UnitKind;
  championId: string | null;
  // The resolved definition this champion was created from, roster or
  // forged: stats, passives, casting, and observations read it from here,
  // so nothing downstream consults a global table (champion resolution is
  // match-scoped, plan-forge phase 2). Data only; safe to share.
  champion: ChampionDef | null;
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
  // Ability ranks (basics start at 1, R unlocks at champion level 6) and
  // unspent skill points (one per level-up past 1).
  abilityRanks: Record<AbilityKey, number>;
  skillPoints: number;
  // Cosmetic skin index (champions; CONTEXT.md "Skin"). Never read by the
  // sim or by Policies.
  skin: number;
  // Generic per-champion passive counter (Heat, Twinshot...).
  passiveStacks: number;
  // Last time ANY damage landed (Shieldskin-style passives).
  lastDamagedAt: number;
  // Last time this unit's damage landed on anyone; with lastDamagedAt,
  // what "out of combat" means (favors.ts outOfCombat).
  lastDealtDamageAt: number;
  // The favors the unit's team holds (CONTEXT.md: Favor), mirrored from
  // the sim's Favors record whenever one is granted, so the stat
  // recalculation and the effect seam read the unit alone. Champions
  // only; everything else carries none.
  favors: FavorStacks;
  // A ring creature's identity and the aspect it carries (content/rings.ts);
  // null on every other unit.
  creatureId: CreatureId | null;
  aspect: AspectId | null;
  // The playbook play acting for this seat right now (bots, ADR 0013),
  // null for seats played by hand. Presentation and reports read it; no
  // sim rule ever does.
  play: string | null;
  // The owner's live coach order (ADR 0013), null when none, and for a
  // focus the last sim time its target was in sight.
  coachOrder: CoachOrder | null;
  coachOrderSeenAt: number;
  attackTargetId: number | null;
  attackReadyAt: number;
  // Attack-move destination; enemies encountered on the way are engaged.
  attackMoveTarget: Vec2 | null;
  // Stop order (S): while held, idle defense keeps its hands off; any
  // movement or attack order clears it. Freezing a wave is a verb again.
  holding: boolean;
  // A paid cast waiting out its windup; stuns cancel it.
  pendingSpell: { key: AbilityKey; aim: Vec2; resolveAt: number } | null;
  // A traveling dash in flight (kits-v2): committed, visible, wall-stopped.
  activeDash: DashState | null;
  // A recast window armed by a cast (ADR 0005): pressing the same key again
  // before `until` resolves the follow-up. v2's only recast returns the
  // caster to `origin`.
  recastArmed: { key: AbilityKey; until: number; origin: Vec2 } | null;
  // An auto-attack strike winding up: locked to its target, landing at
  // resolveAt. Moving, a stun, a dash, or losing the target cancels it and
  // refunds the attack timer (the orb-walk rule).
  pendingAttack: { targetId: number; resolveAt: number; startX: number; startZ: number } | null;
  // Remaining waypoints toward the current move order; empty when idle.
  path: Vec2[];
  // Progression and economy (champions).
  level: number;
  xp: number;
  gold: number;
  items: string[];
  kills: number;
  deaths: number;
  assists: number;
  // Creep score: minions last-hit by this champion.
  cs: number;
  // Kills since last death; feeds the shutdown bounty on this unit's head.
  killStreak: number;
  // Enemy champions that damaged this champion recently, newest timestamp
  // per attacker; consumed for assist credit on death.
  recentDamagers: { id: number; at: number }[];
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
  // A bot's lane preferences (plan-bots phase 12), ahead of the home lane
  // at seating; null for a seat that states none.
  lanePrefer: LaneId[] | null;
  laneProgress: number;
}

// Ground a static unit (tower, Sanctum) blocks in the NavGrid while it
// stands, slightly padded so champions keep visual separation from it.
// Blocked at spawn, unblocked at death, with this exact same value.
export function staticFootprint(u: Unit): number {
  return u.radius + 0.4;
}

// The one hostility rule: a neutral unit is hostile to every other unit,
// otherwise hostility is being on different teams.
export function hostile(a: Unit, b: Unit): boolean {
  if (a.id === b.id) return false;
  if (a.neutral || b.neutral) return true;
  return a.team !== b.team;
}

function baseUnit(id: number, team: TeamId, kind: UnitKind, pos: Vec2): Unit {
  return {
    id,
    team,
    neutral: false,
    kind,
    championId: null,
    champion: null,
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
      armorPen: 0,
      mrPen: 0,
      armorPenPct: 0,
      mrPenPct: 0,
    },
    statuses: [],
    cooldowns: {},
    // Every rank is earned: level 1 grants one point to place (the level 1
    // skill choice the genre opens with).
    abilityRanks: { Q: 0, W: 0, E: 0, R: 0 },
    skillPoints: 0,
    skin: 0,
    passiveStacks: 0,
    lastDamagedAt: -999,
    lastDealtDamageAt: -999,
    favors: NO_FAVORS,
    creatureId: null,
    aspect: null,
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
    level: 1,
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
  u.champion = def;
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
    armorPen: 0,
    mrPen: 0,
    armorPenPct: 0,
    mrPenPct: 0,
  };
  u.gold = 500;
  u.skillPoints = 1;
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
  } else if (variant === 'siege') {
    // Siege: the wave-breaker that actually threatens towers.
    u.radius = 0.6;
    u.hp = 900;
    u.stats.ad = 45;
    u.stats.attackRange = 4;
    u.stats.attackSpeed = 0.5;
    u.goldBounty = 60;
    u.xpBounty = 90;
  } else {
    // Vanguard: the lane-escalation elite that marches once a lane's towers
    // are down. Slow, huge, and worth answering.
    u.radius = 0.85;
    u.moveSpeed = 3.0;
    u.hp = 1500;
    u.stats.ad = 65;
    u.stats.armor = 20;
    u.stats.mr = 20;
    u.stats.attackRange = 1.2;
    u.stats.attackSpeed = 0.6;
    u.goldBounty = 90;
    u.xpBounty = 130;
  }
  u.hp = Math.round(u.hp * scale);
  u.maxHp = u.hp;
  u.stats.ad = Math.round(u.stats.ad * scale);
  return u;
}

// The Warden (CONTEXT.md): the neutral river monster. Nominal team 0, but
// neutral: true makes it hostile to everyone via hostile(). `scale` grows it
// with the game clock (objectives.ts), the way waves grow.
export function createWarden(id: number, pos: Vec2, scale = 1): Unit {
  const u = baseUnit(id, 0, 'warden', pos);
  u.neutral = true;
  u.radius = 1.1;
  u.moveSpeed = 3.0;
  u.hp = Math.round(2500 * scale);
  u.maxHp = u.hp;
  u.stats.ad = Math.round(80 * scale);
  u.stats.armor = 40;
  u.stats.mr = 40;
  u.stats.attackRange = 2;
  u.stats.attackSpeed = 0.55;
  u.sightRange = 8;
  u.goldBounty = 150;
  u.xpBounty = 200;
  return u;
}

// A ring creature (CONTEXT.md: Pyrefang, Voidmaul): neutral like the
// Warden, hostile to everyone, sized for a duo, grown by `scale` with the
// game clock (rings.ts). It carries the aspect its death hands over.
export function createCreature(
  id: number,
  def: CreatureDef,
  pos: Vec2,
  aspect: AspectId,
  scale = 1,
): Unit {
  const u = baseUnit(id, 0, 'creature', pos);
  u.neutral = true;
  u.creatureId = def.id;
  u.aspect = aspect;
  u.radius = def.radius;
  u.moveSpeed = def.moveSpeed;
  u.hp = Math.round(def.hp * scale);
  u.maxHp = u.hp;
  u.stats.ad = Math.round(def.ad * scale);
  u.stats.armor = def.armor;
  u.stats.mr = def.mr;
  u.stats.attackRange = def.attackRange;
  u.stats.attackSpeed = def.attackSpeed;
  u.sightRange = 8;
  // No last-hit bounty: the favor and the team's gold are the prize.
  u.goldBounty = 0;
  u.xpBounty = def.xpBounty;
  return u;
}

// A jungle camp monster (systems review): neutral map treasure that fights
// back inside a short leash and pays gold, xp, and sometimes a buff.
export function createCamp(id: number, pos: Vec2): Unit {
  const u = baseUnit(id, 0, 'camp', pos);
  u.neutral = true;
  u.radius = 0.7;
  u.moveSpeed = 2.8;
  u.hp = 550;
  u.maxHp = 550;
  u.stats.ad = 40;
  u.stats.armor = 15;
  u.stats.mr = 15;
  u.stats.attackRange = 1.5;
  u.stats.attackSpeed = 0.6;
  u.sightRange = 6;
  u.goldBounty = 80;
  u.xpBounty = 100;
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
