// The environment (CONTEXT.md): a match with no browser and no server,
// stepped one decision slot at a time. This is ADR 0002 phase 2's half of
// the Policy contract: a trainer outside the repo gets exactly the
// observation and action space an in-sim bot gets, and nothing else.
//
// It reuses buildMatchSim, the same builder the live server uses, so an
// environment match is constructed identically to a real one. Transport
// free on purpose: headless/main.ts wraps this in a line stream, and the
// server will wrap the same sim seams in WebSocket frames.

import { buildMatchSim, type ReplayPick } from '../src/net/replay';
import { POLICY_PERIOD_TICKS } from '../src/sim/bot_driver';
import { DEFAULT_BOT_ID } from '../src/sim/content/bots';
import { houseSeats } from '../src/sim/content/bots/house';
import { TEAM_SIZE } from '../src/sim/fill';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import type { Action, Observation } from '../src/sim/policy';
import { POLICY_CONTRACT_VERSION } from '../src/sim/policy';
import { Rng } from '../src/sim/rng';
import type { Sim } from '../src/sim/sim';
import type { TeamId } from '../src/sim/types';

export { TEAM_SIZE };
// A 20 minute match at 20 Hz. A trainer that wants longer says so; the cap
// exists so a stalled self-play run cannot spin forever.
export const DEFAULT_MAX_TICKS = 20 * 60 * 20;

export interface EnvSeatSpec {
  team: TeamId;
  championId: string;
  sigils?: [string, string];
  // A remote seat is stepped by the caller. Anything else runs the named
  // scripted bot in-sim (default: the Laner), which is what makes the nine
  // other seats of a 5v5 exist at all.
  remote?: boolean;
  bot?: string;
}

export interface EnvConfig {
  seed?: number;
  seats?: readonly EnvSeatSpec[];
  maxTicks?: number;
  // Forged champion definitions for this match (plan-forge phase 2): seats
  // may then pick their ids. Validated by the registry inside buildMatchSim,
  // the same seam the live server and replays construct through.
  forged?: readonly ForgedChampionDef[];
}

export interface EnvStepResult {
  tick: number;
  time: number;
  done: boolean;
  winner: TeamId | null;
  // Keyed by seat index, and present only for seats that reached a decision
  // slot this step. A dead seat gets no observation, exactly like a bot.
  observations: Record<number, Observation>;
}

export interface EnvInfo {
  contract: number;
  periodTicks: number;
  seed: number;
  maxTicks: number;
  seats: { index: number; team: TeamId; championId: string; remote: boolean; unitId: number }[];
}

// The default table: a full 5v5 where seat 0 is remote and the other nine
// run a house style. Champions and styles come from the fill
// (src/sim/fill.ts, src/sim/content/bots/house.ts) drawn from the seed,
// the rule server/bot_fill.ts uses, so a default environment match and a
// default server match line up.
export function defaultSeats(remoteSeats = 1, seed = 1): EnvSeatSpec[] {
  const rng = new Rng(seed);
  const out: EnvSeatSpec[] = [];
  for (const team of [0, 1] as const satisfies readonly TeamId[]) {
    for (const seat of houseSeats([], rng)) {
      out.push({
        team,
        championId: seat.championId,
        bot: seat.bot,
        remote: team === 0 && out.length < remoteSeats,
      });
    }
  }
  return out;
}

export class Env {
  readonly seed: number;
  readonly maxTicks: number;
  readonly seats: readonly EnvSeatSpec[];
  readonly sim: Sim;
  readonly unitIds: readonly number[];
  private readonly remoteIndexes: readonly number[];

  readonly forged: readonly ForgedChampionDef[];

  constructor(config: EnvConfig = {}) {
    this.seed = config.seed ?? 1;
    this.maxTicks = config.maxTicks ?? DEFAULT_MAX_TICKS;
    this.seats = config.seats ?? defaultSeats(1, this.seed);
    this.forged = config.forged ?? [];
    const picks: ReplayPick[] = this.seats.map((s, i) => ({
      name: `seat${i}`,
      team: s.team,
      championId: s.championId,
      sigils: s.sigils ?? ['riftstep', 'mend'],
      ...(s.remote ? {} : { bot: s.bot ?? DEFAULT_BOT_ID }),
    }));
    const { sim, unitIds } = buildMatchSim(this.seed, picks, this.forged);
    this.sim = sim;
    this.unitIds = unitIds;
    const remote: number[] = [];
    this.seats.forEach((s, i) => {
      if (!s.remote) return;
      const unitId = unitIds[i];
      if (unitId !== undefined && sim.addRemoteSeat(unitId)) remote.push(i);
    });
    this.remoteIndexes = remote;
  }

  info(): EnvInfo {
    return {
      contract: POLICY_CONTRACT_VERSION,
      periodTicks: POLICY_PERIOD_TICKS,
      seed: this.seed,
      maxTicks: this.maxTicks,
      seats: this.seats.map((s, i) => ({
        index: i,
        team: s.team,
        championId: s.championId,
        remote: s.remote === true,
        unitId: this.unitIds[i] ?? 0,
      })),
    };
  }

  get done(): boolean {
    return this.sim.winner !== null || this.sim.tickCount >= this.maxTicks;
  }

  // Advance one decision slot for every remote seat: POLICY_PERIOD_TICKS
  // ticks, which is exactly one slot each however the stagger falls. Actions
  // are queued before the advance and consumed inside the tick at the same
  // point an in-sim bot decides.
  step(actions: Readonly<Record<number, Action>> = {}): EnvStepResult {
    for (const [key, action] of Object.entries(actions)) {
      const unitId = this.unitIds[Number(key)];
      if (unitId !== undefined) this.sim.queueRemoteAction(unitId, action);
    }
    const observations: Record<number, Observation> = {};
    for (let i = 0; i < POLICY_PERIOD_TICKS; i++) {
      if (this.done) break;
      this.sim.tick();
      for (const index of this.remoteIndexes) {
        const unitId = this.unitIds[index];
        if (unitId === undefined) continue;
        const obs = this.sim.takeRemoteObservation(unitId);
        if (obs) observations[index] = obs;
      }
    }
    return {
      tick: this.sim.tickCount,
      time: this.sim.time,
      done: this.done,
      winner: this.sim.winner,
      observations,
    };
  }

  // The first observations, before any action has been taken.
  reset(): EnvStepResult {
    return this.step();
  }
}
