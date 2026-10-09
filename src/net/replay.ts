// Deterministic match replays. The sim is a pure function of (seed, picks,
// command stream), so a full match compresses to kilobytes: the server
// records while the match runs, the browser rebuilds the same sim and
// feeds the same commands at the same ticks. server/match.ts builds its
// live sim and applies live commands THROUGH these functions, so the live
// path and the replay path cannot drift apart.

import { parseCoachOrder } from '../sim/coach';
import { attachBot, botPolicy } from '../sim/content/bots';
import { attachRoyaleBot, royaleBotPolicy } from '../sim/content/bots/royale';
import { contentMatches } from '../sim/content/fingerprint';
import type { StarOrchard } from '../sim/content/star_orchard';
import type { ForgedChampionDef } from '../sim/forge/forged_def';
import type { Ground } from '../sim/ground';
import { NavGrid } from '../sim/navgrid';
import type { LanePreference, PlaybookDef } from '../sim/playbook/types';
import { royaleSeatSkills } from '../sim/royale/fill';
import { type PlanetLayoutRecord, planetGameMap, royaleLayoutOf } from '../sim/royale/planet_map';
import { ROYALE_RULES_VERSION, type RoyaleVariant } from '../sim/royale/types';
import { Sim } from '../sim/sim';
import { TerrainNavGrid } from '../sim/terrain_nav';
import type { TeamId } from '../sim/types';
import { type ClientMsg, isFiniteVec } from './protocol';

// Bumped whenever the sim's own CODE changes behavior (a replay is a
// re-simulation, so an older record would silently play out a different
// match): 2 with the river-reflected lane polylines, 3 with exactly
// rounded lengths and angles (ADR 0019), 4 with the Star Orchard as the
// map (ADR 0021: every earlier record is the launch map's, and the ones
// from before the fingerprint existed carry none to be refused by). What
// the sim READS rather than what it does (champions, items, sigils, the
// map, the house bots) is guarded by the content fingerprint instead,
// which moves on its own (src/sim/content/fingerprint.ts): nobody has to
// remember that one.
// 5: the rings' creatures and the favors (docs/plan-rings.md), and the
// Warden at 12:00; a record from before them plays a match nobody played.
// 6: the bodies grown for a team, the Ascendant and the Wrath (the rings'
// round two): the execute in the damage pipeline and the bite on every
// neutral strike are sim rules, not content.
// 7: the forest round (ADR 0023): the rings' creatures in the fog, the
// Warden's pit drawn from the rng, camps of three kinds with their memory
// in the observation, the Jungler on every house team's fifth seat.
// Not bumped for a seat's lane preference (ADR 0026): ReplayPick.lanes is
// additive, and a record without it seats and stands in exactly as before.
// 8: the rings' creatures revealed to both teams again, like the Warden
// (ADR 0023, amended): what the bots see of a ring changes their play.
// 9: an enemy pod seen only under the team's own reveal zone, never by
// walking near it (traps.ts): what the bots see of a pod changes their play.
export const REPLAY_VERSION = 9;

// The checksum a replay must show at `tick`, or null when the record
// says nothing about that tick (an older record, or a tick that is not
// on the check cadence).
export function expectedCheck(record: ReplayRecord, tick: number): number | null {
  if (!record.checks || tick <= 0 || tick % CHECK_TICKS !== 0) return null;
  return record.checks[tick / CHECK_TICKS - 1] ?? null;
}

// Whether a record still plays out the match it recorded: the version
// this build speaks, and content (the map included) that has not moved
// under it.
export function replayPlayable(
  record: { version?: unknown; content?: string | undefined },
  orchard: StarOrchard,
): boolean {
  return record.version === REPLAY_VERSION && contentMatches(record.content, orchard);
}
// A griefer spamming the rate limit for a whole match could balloon the
// log; past this the match simply has no replay.
export const REPLAY_EVENT_CAP = 200_000;

export interface ReplayPick {
  name: string;
  team: TeamId;
  championId: string;
  sigils: [string, string];
  skin?: number;
  // Bot policy id; seats without it are humans driven by recorded events.
  bot?: string;
  // An account's own bot (ADR 0013): the playbook that played, embedded
  // whole like a forged definition, so the replay runs what ran.
  playbook?: PlaybookDef;
  // The seat's own lane preference (ADR 0026; Sim.pickLanes): a person's
  // choice at champion select, the lane of the fill seat a house bot was
  // drawn for. Additive: absent on older records and on a seat that asked
  // nothing, which then seats exactly as it did before the field existed.
  lanes?: LanePreference[];
}

export interface ReplayEvent {
  // sim.tickCount at the moment the event applied live: replays apply it
  // at the same boundary, before the next tick runs.
  k: number;
  // The unit the event concerns.
  u: number;
  // cmd: a player command. bot_on and bot_off: a disconnect handing the
  // seat to the default bot, and a rejoin taking it back. Both change
  // how the sim evolves, so both must replay. kit: the sigils and skin a
  // person who took a battle royale bot's seat brought (Sim.setLoadout).
  // arrive: a Respawn drop-in's Arrival over the globe (Sim.beginArrival).
  e: 'cmd' | 'bot_on' | 'bot_off' | 'kit' | 'arrive';
  c?: ClientMsg;
  kit?: { sigils: [string, string]; skin: number };
}

// How often a match writes down where it stood. Every ten seconds of
// play: a hundred and twenty numbers on a twenty-minute match, about a
// kilobyte, against the five megabytes a recorded match would weigh
// (measured 2026-09-07: the wire snapshot at 20 Hz, gzipped). It buys
// the one thing re-simulation cannot give itself, which is knowing when
// it has gone wrong.
export const CHECK_TICKS = 200;

export interface ReplayRecord {
  version: number;
  // The fingerprint of the content the match ran on (champions, items,
  // sigils, the map, the house bots, the tick rate). A replay is a
  // re-simulation, so a record whose content has moved since would play
  // out a DIFFERENT match; the viewer refuses it instead. Absent on
  // records written before the fingerprint existed.
  content?: string;
  seed: number;
  picks: ReplayPick[];
  events: ReplayEvent[];
  // Total ticks the live match ran to its winner.
  ticks: number;
  // Where the match stood every CHECK_TICKS ticks, as the sim's own
  // checksum. A replay compares as it plays: the first number that
  // differs is the moment it stopped being the match it claims to be,
  // and it stops there rather than showing a match nobody played.
  // Absent on records written before this existed.
  checks?: number[];
  // The match's forged champion definitions, embedded whole (ADR 0010): a
  // forged id means nothing outside its match, so the replay carries the
  // data, not the reference. Absent for roster-only matches.
  forged?: ForgedChampionDef[];
  // A battle royale on the Wanderseed (ADR 0031), built by buildRoyaleSim
  // from the same seed and picks (each pick's team its seat index), absent
  // on every 5v5. Additive: a record without it is a 5v5 as it always was.
  // `rules` is the ROYALE_RULES_VERSION it ran under: the planet's rules
  // move without REPLAY_VERSION, and royaleReplayPlayable checks them.
  // `newcomers` are the seats (pick indices) of the people who had never
  // banked a battle royale award, whose escorts are dealt differently;
  // absent when there were none.
  royale?: RoyaleRecord;
}

// A bare Sim on the Star Orchard: a fresh walkability grid over the shared
// export, strict navigation. buildMatchSim seats a match on it; the
// practice match (src/main.ts) and the dev showcase seat their own.
export function orchardSim(orchard: StarOrchard, seed: number): Sim {
  return new Sim(seed, {
    map: orchard.map,
    nav: new TerrainNavGrid(orchard.navigation),
    strictNavigation: true,
  });
}

// The one sim construction for a match, live and replayed alike, on the
// Star Orchard the host has read (ADR 0021): a fresh walkability grid over
// the shared export, strict navigation, then the same seed, the same forged
// definitions in the same order, the same picks in the same order, the same
// policy attachments. Nothing else in the game constructs a match's Sim
// (tests/architecture.test.ts).
export function buildMatchSim(
  orchard: StarOrchard,
  seed: number,
  picks: readonly ReplayPick[],
  forged: readonly ForgedChampionDef[] = [],
): { sim: Sim; unitIds: number[] } {
  const sim = orchardSim(orchard, seed);
  for (const def of forged) sim.addForgedChampion(def);
  const unitIds: number[] = [];
  for (const p of picks) {
    const unit = sim.addChampion(p.team, undefined, p.championId, p.skin ?? 0);
    unit.sigils = [...p.sigils];
    unitIds.push(unit.id);
    // The seat's ask before its brain: a playbook's own lanes still go
    // ahead of it, and the forest ask names the seat's default stand-in.
    if (p.lanes) sim.pickLanes(unit.id, p.lanes);
    if (p.playbook) sim.attachPlaybook(unit.id, p.playbook);
    else if (p.bot) attachBot(sim, unit.id, p.bot);
  }
  return { sim, unitIds };
}

// The Wanderseed as a host has read it (ADR 0031): the layout record and a
// maker of its ground, the SphereGround over a fresh decode of the planet's
// grid (sphere_nav.ts): a match's walls block cells, so no two sims share
// one.
export interface RoyalePlanet {
  layout: PlanetLayoutRecord;
  ground: () => Ground;
}

export interface RoyaleBuildOptions {
  // Only Guests among the people: the bots play softer (the server knows).
  guestsOnly?: boolean;
  // The seats (pick indices) of the people new to the battle royale (the
  // server knows; RoyaleMode.newcomers). Nothing reads them yet.
  newcomers?: readonly number[];
}

// A battle royale's own part of a replay record (ReplayRecord.royale), the
// server's record and its builder's alike.
export interface RoyaleRecord {
  variant: RoyaleVariant;
  guestsOnly?: boolean;
  rules?: number;
  newcomers?: number[];
}

// The one sim construction for a battle royale, live and replayed alike,
// beside buildMatchSim: one team per seat (ADR 0030), the planet's map and
// ground, the mode's rules, every seat seated in pick order (team = the
// seat's index): no gold, level 3 with Q, W and E, its build fixed, its bot
// skill dealt from the seed; the house seats' bots attached. Seats that
// name no bot are people, driven by their commands.
export function buildRoyaleSim(
  planet: RoyalePlanet,
  seed: number,
  picks: readonly ReplayPick[],
  variant: RoyaleVariant,
  options: RoyaleBuildOptions = {},
): { sim: Sim; unitIds: number[] } {
  const layout = royaleLayoutOf(planet.layout);
  const sim = new Sim(seed, {
    map: planetGameMap(planet.layout),
    // The 5v5's own systems never run here; their grid is a token.
    nav: new NavGrid(1, [], 0),
    ground: planet.ground(),
    teamCount: Math.max(1, picks.length),
    separation: ['minion', 'champion'],
    royale: { variant, layout },
  });
  const mode = sim.royaleMode!;
  const skills = royaleSeatSkills(seed, picks.length, options.guestsOnly === true);
  // Where everyone waits while the drop runs: no system reads it.
  const waiting = layout.regions[0]?.heart ?? { x: layout.radius, y: 0, z: 0 };
  const unitIds: number[] = [];
  picks.forEach((p, i) => {
    const unit = sim.addChampion(i, { ...waiting }, p.championId, p.skin ?? 0);
    unit.sigils = [...p.sigils];
    mode.seat(unit, p.playbook?.kit?.build, skills[i]);
    unitIds.push(unit.id);
    if (p.bot !== undefined || p.playbook) attachRoyaleBot(sim, unit.id);
  });
  const newcomers = options.newcomers ?? [];
  mode.setNewcomers(unitIds.filter((_, i) => newcomers.includes(i)));
  return { sim, unitIds };
}

// Whether a battle royale's record still plays out the match it recorded:
// the version this build speaks and the royale rules it runs (a record
// without them was made before they were written down, and is refused).
export function royaleReplayPlayable(record: {
  version?: unknown;
  royale?: { variant?: unknown; guestsOnly?: unknown; rules?: unknown } | undefined;
}): boolean {
  return record.version === REPLAY_VERSION && record.royale?.rules === ROYALE_RULES_VERSION;
}

// The royale replay loader: a battle royale's record rebuilt on the
// Wanderseed by the one construction (buildRoyaleSim), or null when the
// record is not a royale's or was made under other rules. The recorded
// events are then applied as they come (applyReplayEvent).
export function loadRoyaleReplay(
  planet: RoyalePlanet,
  record: Pick<ReplayRecord, 'version' | 'seed' | 'picks' | 'royale'>,
): { sim: Sim; unitIds: number[] } | null {
  const royale = record.royale;
  if (!royale || !royaleReplayPlayable(record)) return null;
  return buildRoyaleSim(planet, record.seed, record.picks, royale.variant, {
    guestsOnly: royale.guestsOnly === true,
    ...(royale.newcomers ? { newcomers: royale.newcomers } : {}),
  });
}

const ABILITY_KEYS = new Set(['Q', 'W', 'E', 'R']);

// The third coordinate a command may carry on the planet (ADR 0029):
// undefined when absent, null when it is there and not a number.
function thirdOf(msg: unknown): number | undefined | null {
  const y = (msg as { y?: unknown }).y;
  if (y === undefined) return undefined;
  return typeof y === 'number' && Number.isFinite(y) ? y : null;
}

// The one validated command application path, live and replayed alike.
// Validation is deterministic given identical sim state, so recording the
// raw message is enough: an invalid command no-ops identically both times.
export function applySimCommand(sim: Sim, team: TeamId, unitId: number, msg: ClientMsg): void {
  switch (msg.t) {
    case 'move': {
      const y = thirdOf(msg);
      if (isFiniteVec(msg.x, msg.z) && y !== null) sim.orderMove(unitId, msg.x, msg.z, y);
      break;
    }
    case 'attack':
      if (typeof msg.targetId === 'number' && sim.isVisible(team, msg.targetId)) {
        sim.orderAttack(unitId, msg.targetId);
      }
      break;
    case 'attack_move': {
      const y = thirdOf(msg);
      if (isFiniteVec(msg.x, msg.z) && y !== null) sim.orderAttackMove(unitId, msg.x, msg.z, y);
      break;
    }
    case 'stop':
      sim.orderStop(unitId);
      break;
    case 'sell':
      if (typeof msg.slot === 'number') sim.sellItem(unitId, msg.slot);
      break;
    case 'drink':
      if (typeof msg.slot === 'number') sim.drinkItem(unitId, msg.slot);
      break;
    case 'recall':
      sim.startRecall(unitId);
      break;
    case 'cast': {
      const y = thirdOf(msg);
      if (
        typeof msg.key === 'string' &&
        ABILITY_KEYS.has(msg.key) &&
        isFiniteVec(msg.x, msg.z) &&
        y !== null
      ) {
        sim.castAbility(
          unitId,
          msg.key,
          y === undefined ? { x: msg.x, z: msg.z } : { x: msg.x, y, z: msg.z },
        );
      }
      break;
    }
    case 'sigil': {
      const y = thirdOf(msg);
      if ((msg.slot === 0 || msg.slot === 1) && isFiniteVec(msg.x, msg.z) && y !== null) {
        sim.castSigil(
          unitId,
          msg.slot,
          y === undefined ? { x: msg.x, z: msg.z } : { x: msg.x, y, z: msg.z },
        );
      }
      break;
    }
    case 'buy':
      if (typeof msg.itemId === 'string') sim.buyItem(unitId, msg.itemId);
      break;
    case 'skill':
      if (msg.key === 'Q' || msg.key === 'W' || msg.key === 'E' || msg.key === 'R') {
        sim.levelAbility(unitId, msg.key);
      }
      break;
    case 'order': {
      const u = sim.units.get(unitId);
      if (!u) break;
      const order = parseCoachOrder(msg, u.pos);
      if (order === undefined) break;
      // Fogged like an attack: a focus names only what the team sees.
      if (order?.kind === 'focus' && !sim.isVisible(team, order.targetId)) break;
      sim.setCoachOrder(unitId, order);
      break;
    }
    default: {
      // The battle royale's landing pick (royale_wire.ts RoyaleClientMsg),
      // recorded and replayed like any command.
      const m = msg as { t: string; x?: unknown; y?: unknown; z?: unknown };
      if (
        m.t === 'drop' &&
        typeof m.x === 'number' &&
        typeof m.y === 'number' &&
        typeof m.z === 'number' &&
        Number.isFinite(m.x) &&
        Number.isFinite(m.y) &&
        Number.isFinite(m.z)
      ) {
        sim.pickDrop(unitId, { x: m.x, y: m.y, z: m.z });
      }
      // A card of the open Graft offer (royale_wire.ts), likewise.
      const g = msg as { t: string; pick?: unknown };
      if (g.t === 'graft' && (g.pick === 0 || g.pick === 1 || g.pick === 2)) {
        sim.pickGraft(unitId, g.pick);
      }
      break;
    }
  }
}

// Feed one recorded event into a replaying sim. unitTeams maps unitId to
// team (from the picks), needed by the attack visibility check.
export function applyReplayEvent(
  sim: Sim,
  unitTeams: ReadonlyMap<number, TeamId>,
  ev: ReplayEvent,
): void {
  if (ev.e === 'cmd') {
    const team = unitTeams.get(ev.u);
    if (team !== undefined && ev.c) applySimCommand(sim, team, ev.u, ev.c);
    return;
  }
  if (ev.e === 'kit') {
    if (ev.kit) sim.setLoadout(ev.u, ev.kit.sigils, ev.kit.skin);
    return;
  }
  if (ev.e === 'arrive') {
    sim.beginArrival(ev.u);
    return;
  }
  // The seat's default bot, as the live stand-in (server/match.ts): the
  // Jungler on a seat that asked for the forest, the Laner elsewhere.
  if (ev.e === 'bot_on') {
    // In a battle royale the stand-in is the seat's royale bot.
    if (sim.royaleMode) attachRoyaleBot(sim, ev.u);
    else attachBot(sim, ev.u, undefined);
    return;
  }
  sim.detachPolicy(ev.u);
}

// The policies a replaying sim holds at a tick, put back after a checkpoint
// restore. A checkpoint carries every container but this one
// (src/sim/snapshot.ts): policies are functions, and in a match nobody
// leaves they never change. A live match's seats do change hands (bot_on,
// bot_off), so a restore across one of those events would leave the wrong
// seats driven: a bot never attached in this sim, or a bot still attached
// from a later tick, fighting the recorded commands for the seat. The map
// is rebuilt with the same operations in the same order live attachment
// made them (the seats in pick order, then every event before the tick),
// so the seats decide in the same order too and draw from the rng alike.
// A checkpoint at `tick` was taken with the events before it applied and
// the ones at it still pending, which is where the event cursor lands too.
export function restorePolicies(
  sim: Sim,
  picks: readonly ReplayPick[],
  unitIds: readonly number[],
  events: readonly ReplayEvent[],
  tick: number,
): void {
  sim.policies.clear();
  picks.forEach((p, i) => {
    const unitId = unitIds[i];
    if (unitId === undefined) return;
    const policy = sim.royaleMode
      ? p.bot !== undefined || p.playbook
        ? royaleBotPolicy(sim, unitId)
        : null
      : p.playbook
        ? sim.policyForPlaybook(p.playbook)
        : p.bot !== undefined
          ? botPolicy(sim, p.bot, unitId)
          : null;
    if (policy) sim.attachPolicy(unitId, policy);
  });
  for (const ev of events) {
    if (ev.k >= tick) break;
    if (ev.e === 'bot_on') {
      const policy = sim.royaleMode ? royaleBotPolicy(sim, ev.u) : botPolicy(sim, undefined, ev.u);
      if (policy) sim.attachPolicy(ev.u, policy);
    } else if (ev.e === 'bot_off') {
      sim.policies.delete(ev.u);
    }
  }
}
