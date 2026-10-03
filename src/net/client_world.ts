// The online mirror world: implements IWorld by applying server snapshots.
// It never decides outcomes (ADR 0001): commands go up the wire, state comes
// back down. Everything received is visible by construction, because the
// server scopes snapshots to this client's team before sending.
// Transport-agnostic: give it a send function, feed it server messages.

import { ChampionRegistry } from '../sim/champion_registry';
import { specForRank } from '../sim/combat/casting';
import type { Status } from '../sim/combat/status';
import type { ChampionDef } from '../sim/content/champions';
import type { GameMap, WardenPit } from '../sim/content/map';
import { creatureOfRing } from '../sim/content/rings';
import { type FavorStacks, NO_FAVORS } from '../sim/favors';
import type { ForgedChampionDef } from '../sim/forge/forged_def';
import type { NavGrid } from '../sim/navgrid';
import type { Projectile } from '../sim/projectiles';
import type { RingClock } from '../sim/rings';
import { TWO_TEAMS } from '../sim/teams';
import type { AbilityKey, ScoreRow, TeamId, Vec2 } from '../sim/types';
import type { Unit } from '../sim/unit';
import type { Wall } from '../sim/walls';
import type { Zone } from '../sim/zones';
import type { IWorld } from '../world_api';
import type { ClientMsg, SelfSnap, ServerMsg, SnapUnit } from './protocol';
import { type DrawnSelf, pathOfPairs, SelfPredictor } from './self_predict';

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
    neutral: s.k === 'warden' || s.k === 'camp' || s.k === 'creature',
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
    lastDealtDamageAt: -999,
    outOfCombatBonus: 0,
    favors: NO_FAVORS,
    creatureId: s.cr ?? null,
    aspect: s.a ?? null,
    ascendant: s.asc === 1,
    campKind: s.ck ?? null,
    bitePct: 0,
    play: null,
    coachOrder: null,
    coachOrderSeenAt: 0,
    lanePrefer: null,
    pickedLanes: null,
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
  // The match's team count (ADR 0030), told by match_start.
  teamCount = TWO_TEAMS;
  // A coach seat (ADR 0013): the orders translate into coach orders and
  // the hands-on verbs are refused here already; the bot plays by itself.
  coach = false;
  private scoreRows: readonly ScoreRow[] = [];
  private objAt: number | null = null;
  private rings: RingClock[] = [];
  private objPit: number | null = null;
  private favors: FavorStacks = NO_FAVORS;
  private enemyFavors: FavorStacks = NO_FAVORS;
  private boon: { until: number; stacks: number } | null = null;
  private enemyBoon: { until: number; stacks: number } | null = null;
  private wrathUntil: number | null = null;
  private enemyWrathUntil: number | null = null;

  // Match-scoped champion resolution, mirroring the server sim's registry:
  // the Forge queue delivers the match's forged definitions at setup and
  // registerForged() loads them before the first snapshot arrives.
  readonly champions = new ChampionRegistry();

  // The own champion drawn where it is going (src/net/self_predict.ts,
  // ADR 0028), when the host hands in the map's walkability grid; a
  // spectator's mirror has none and draws what the server says.
  private readonly predictor: SelfPredictor | null;

  // The map the match is played on (ADR 0021): the mirror renders and
  // reasons on the record the server's sim runs, handed in by the host.
  constructor(
    private readonly send: (msg: ClientMsg) => void,
    readonly map: GameMap,
    nav: NavGrid | null = null,
    private readonly clock: () => number = () => performance.now(),
  ) {
    this.predictor = nav
      ? new SelfPredictor(nav, (id) => {
          const u = this.units.get(id);
          return u && !u.dead ? { x: u.pos.x, z: u.pos.z, radius: u.radius } : null;
        })
      : null;
  }

  // Where the renderer draws a unit this frame when it is not where the
  // newest snapshot put it: the own champion, ahead by the orders on
  // their way (IWorld). Null draws the snapshot's position.
  predictedPos(unitId: number, now: number): DrawnSelf | null {
    if (unitId !== this.selfUnitId || !this.predictor) return null;
    return this.predictor.drawnAt(now);
  }

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

  // Both teams' Wraths ride the wire, like the Boons (IWorld).
  teamWrath(team: TeamId): number | null {
    const until = team === this.selfTeam ? this.wrathUntil : this.enemyWrathUntil;
    return until !== null && until > this.time ? until : null;
  }

  // The live Warden's pit as the last snapshot named it, on the map's
  // list (IWorld); null while none stands.
  wardenPit(): Readonly<WardenPit> | null {
    return this.objPit === null ? null : (this.map.wardenPits[this.objPit] ?? null);
  }

  objectiveSpawnAt(): number | null {
    return this.objAt;
  }

  // The rings' clocks as the last snapshot carried them, placed by the
  // map's rings (IWorld).
  ringClocks(): readonly RingClock[] {
    return this.rings;
  }

  // Both teams' favors ride the wire, like the Boons (IWorld).
  teamFavors(team: TeamId): FavorStacks {
    return team === this.selfTeam ? this.favors : this.enemyFavors;
  }

  // The server already scoped the snapshot to this team's vision.
  isVisible(_team: TeamId, unitId: number): boolean {
    return this.units.has(unitId);
  }

  // Each order the hands send carries its number for the prediction, which
  // walks it at once; a coach's orders are the bot's to follow.
  orderMove(_unitId: number, x: number, z: number): void {
    if (this.coach) {
      this.send({ t: 'order', kind: 'goto', x, z });
      return;
    }
    const n = this.predictor?.move({ x, z }, this.clock());
    this.send(n === undefined ? { t: 'move', x, z } : { t: 'move', x, z, n });
  }

  orderAttack(_unitId: number, targetId: number): void {
    if (this.coach) {
      this.send({ t: 'order', kind: 'focus', targetId });
      return;
    }
    const n = this.predictor?.chase(targetId, this.clock());
    this.send(n === undefined ? { t: 'attack', targetId } : { t: 'attack', targetId, n });
  }

  // Walked like a move: the server stops it at the first enemy it meets,
  // which the next snapshots tell.
  orderAttackMove(_unitId: number, x: number, z: number): void {
    if (this.coach) {
      this.send({ t: 'order', kind: 'goto', x, z });
      return;
    }
    const n = this.predictor?.move({ x, z }, this.clock());
    this.send(n === undefined ? { t: 'attack_move', x, z } : { t: 'attack_move', x, z, n });
  }

  // A recall stands the champion still to channel (src/sim/recall.ts).
  startRecall(_unitId: number): void {
    if (this.coach) {
      this.send({ t: 'order', kind: 'back' });
      return;
    }
    const n = this.predictor?.stop(this.clock());
    this.send(n === undefined ? { t: 'recall' } : { t: 'recall', n });
  }

  orderStop(_unitId: number): void {
    if (this.coach) {
      this.send({ t: 'order', kind: 'hold' });
      return;
    }
    const n = this.predictor?.stop(this.clock());
    this.send(n === undefined ? { t: 'stop' } : { t: 'stop', n });
  }

  castAbility(_unitId: number, key: AbilityKey, aim: Vec2): boolean {
    if (this.coach) return false;
    const now = this.clock();
    const n = this.predictor?.cast(this.windupOf(key, now), now);
    this.send(
      n === undefined
        ? { t: 'cast', key, x: aim.x, z: aim.z }
        : { t: 'cast', key, x: aim.x, z: aim.z, n },
    );
    return true;
  }

  // The windup a cast sent now will plant the champion for, when the
  // mirror can tell the sim will start it (src/sim/combat/casting.ts): the
  // rank, the cooldown and the mana allow it, no stun stops it, and it
  // needs no unit to aim at, which only the server's sight settles. Null
  // when it will not plant the champion, or when that cannot be told.
  private windupOf(key: AbilityKey, now: number): number | null {
    const self = this.units.get(this.selfUnitId);
    const def = self?.champion?.abilities[key];
    if (!self || !def?.windup || def.windup <= 0 || !this.predictor) return null;
    const rank = self.abilityRanks[key] ?? 0;
    if (rank <= 0) return null;
    const at = this.predictor.landsAt(now);
    if ((self.cooldowns[key] ?? 0) > at || self.mana < def.manaCost) return null;
    if (self.statuses.some((s) => (s.kind === 'stun' || s.kind === 'airborne') && s.until > at)) {
      return null;
    }
    const kind = specForRank(def, rank).kind;
    if (kind === 'enemy_target' || kind === 'dash') return null;
    return def.windup;
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
      this.teamCount = msg.teams ?? TWO_TEAMS;
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
    this.objPit = msg.objPit ?? null;
    this.rings = (msg.rings ?? []).flatMap((r) => {
      const site = this.map.rings?.find((ring) => ring.id === r.r);
      if (!site) return [];
      return [
        {
          ring: r.r,
          creature: creatureOfRing(r.r).id,
          x: site.x,
          z: site.z,
          unitId: r.u,
          riseAt: r.at,
          roseAt: r.ro ?? null,
          aspect: r.a,
          ascendant: r.asc === 1,
        },
      ];
    });
    if (msg.self) {
      this.favors = msg.self.favors ?? NO_FAVORS;
      this.enemyFavors = msg.self.enemyFavors ?? NO_FAVORS;
      this.boon =
        msg.self.boonUntil !== undefined
          ? { until: msg.self.boonUntil, stacks: msg.self.boonStacks ?? 1 }
          : null;
      this.enemyBoon =
        msg.self.enemyBoonUntil !== undefined
          ? { until: msg.self.enemyBoonUntil, stacks: msg.self.enemyBoonStacks ?? 1 }
          : null;
      this.wrathUntil = msg.self.wrathUntil ?? null;
      this.enemyWrathUntil = msg.self.enemyWrathUntil ?? null;
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
        // The seat's assigned lane (ADR 0026): the mirror holds no other
        // unit's lane, but its own is the in-match guidance's to read.
        self.lane = msg.self.lane;
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
        // A bolt born in the fog can come into sight with its victim later.
        if (existing.homingTargetId === null && p.h !== undefined) existing.homingTargetId = p.h;
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
          // What the renderer needs to draw a tower's shot as the authored
          // missile (renderer.ts crownFlight); the sim's own flight is
          // server-side and nothing here steers.
          homingTargetId: p.h ?? null,
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

    if (this.predictor && msg.self) this.observeSelf(msg.self, msg.time, msg.winner !== null);
    return true;
  }

  // The newest state of the own champion's walk, for the prediction.
  private observeSelf(snap: SelfSnap, time: number, over: boolean): void {
    const self = this.units.get(this.selfUnitId);
    if (!self || !this.predictor) return;
    let stillUntil = self.pendingSpell?.resolveAt ?? 0;
    for (const s of snap.statuses) {
      if (s.k === 'root' || s.k === 'stun' || s.k === 'airborne') {
        stillUntil = Math.max(stillUntil, s.until);
      }
    }
    this.predictor.observe(
      {
        time,
        pos: { x: self.pos.x, z: self.pos.z },
        path: pathOfPairs(snap.path),
        speed: snap.ms,
        stillUntil,
        chaseId: snap.tgt ?? null,
        range: snap.rg,
        radius: self.radius,
        // A server that does not tell the walk has nothing to predict on.
        off:
          self.dead ||
          snap.dash === 1 ||
          over ||
          this.coach ||
          typeof snap.ms !== 'number' ||
          typeof snap.ack !== 'number',
        ack: snap.ack ?? 0,
        ackAt: snap.ackAt ?? 0,
      },
      this.clock(),
    );
  }
}
