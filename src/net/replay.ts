// Deterministic match replays. The sim is a pure function of (seed, picks,
// command stream), so a full match compresses to kilobytes: the server
// records while the match runs, the browser rebuilds the same sim and
// feeds the same commands at the same ticks. server/match.ts builds its
// live sim and applies live commands THROUGH these functions, so the live
// path and the replay path cannot drift apart.

import { attachBot } from '../sim/content/bots';
import type { ForgedChampionDef } from '../sim/forge/forged_def';
import type { PlaybookDef } from '../sim/playbook/types';
import { Sim } from '../sim/sim';
import type { TeamId } from '../sim/types';
import { type ClientMsg, isFiniteVec } from './protocol';

export const REPLAY_VERSION = 1;
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
}

export interface ReplayEvent {
  // sim.tickCount at the moment the event applied live: replays apply it
  // at the same boundary, before the next tick runs.
  k: number;
  // The unit the event concerns.
  u: number;
  // cmd: a player command. bot_on and bot_off: a disconnect handing the
  // seat to the default bot, and a rejoin taking it back. Both change
  // how the sim evolves, so both must replay.
  e: 'cmd' | 'bot_on' | 'bot_off';
  c?: ClientMsg;
}

export interface ReplayRecord {
  version: number;
  seed: number;
  picks: ReplayPick[];
  events: ReplayEvent[];
  // Total ticks the live match ran to its winner.
  ticks: number;
  // The match's forged champion definitions, embedded whole (ADR 0010): a
  // forged id means nothing outside its match, so the replay carries the
  // data, not the reference. Absent for roster-only matches.
  forged?: ForgedChampionDef[];
}

// The one sim construction for a match, live and replayed alike: same
// seed, same forged definitions in the same order, same picks in the same
// order, same policy attachments.
export function buildMatchSim(
  seed: number,
  picks: readonly ReplayPick[],
  forged: readonly ForgedChampionDef[] = [],
): { sim: Sim; unitIds: number[] } {
  const sim = new Sim(seed);
  for (const def of forged) sim.addForgedChampion(def);
  const unitIds: number[] = [];
  for (const p of picks) {
    const unit = sim.addChampion(p.team, undefined, p.championId, p.skin ?? 0);
    unit.sigils = [...p.sigils];
    unitIds.push(unit.id);
    if (p.playbook) sim.attachPlaybook(unit.id, p.playbook);
    else if (p.bot) attachBot(sim, unit.id, p.bot);
  }
  return { sim, unitIds };
}

const ABILITY_KEYS = new Set(['Q', 'W', 'E', 'R']);

// The one validated command application path, live and replayed alike.
// Validation is deterministic given identical sim state, so recording the
// raw message is enough: an invalid command no-ops identically both times.
export function applySimCommand(sim: Sim, team: TeamId, unitId: number, msg: ClientMsg): void {
  switch (msg.t) {
    case 'move':
      if (isFiniteVec(msg.x, msg.z)) sim.orderMove(unitId, msg.x, msg.z);
      break;
    case 'attack':
      if (typeof msg.targetId === 'number' && sim.isVisible(team, msg.targetId)) {
        sim.orderAttack(unitId, msg.targetId);
      }
      break;
    case 'attack_move':
      if (isFiniteVec(msg.x, msg.z)) sim.orderAttackMove(unitId, msg.x, msg.z);
      break;
    case 'stop':
      sim.orderStop(unitId);
      break;
    case 'sell':
      if (typeof msg.slot === 'number') sim.sellItem(unitId, msg.slot);
      break;
    case 'recall':
      sim.startRecall(unitId);
      break;
    case 'cast':
      if (typeof msg.key === 'string' && ABILITY_KEYS.has(msg.key) && isFiniteVec(msg.x, msg.z)) {
        sim.castAbility(unitId, msg.key, { x: msg.x, z: msg.z });
      }
      break;
    case 'sigil':
      if ((msg.slot === 0 || msg.slot === 1) && isFiniteVec(msg.x, msg.z)) {
        sim.castSigil(unitId, msg.slot, { x: msg.x, z: msg.z });
      }
      break;
    case 'buy':
      if (typeof msg.itemId === 'string') sim.buyItem(unitId, msg.itemId);
      break;
    case 'skill':
      if (msg.key === 'Q' || msg.key === 'W' || msg.key === 'E' || msg.key === 'R') {
        sim.levelAbility(unitId, msg.key);
      }
      break;
    default:
      break;
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
  if (ev.e === 'bot_on') {
    attachBot(sim, ev.u, undefined);
    return;
  }
  sim.detachPolicy(ev.u);
}
