// One live match: the authoritative Sim plus its players. The server never
// resolves gameplay itself: every command is validated here, then handed to
// a sim method (ADR 0001). Transport-agnostic and fully testable without a
// socket.

import type { ServerMsg } from '../src/net/protocol';
import { type ClientMsg, isFiniteVec } from '../src/net/protocol';
import { BOTS, DEFAULT_BOT_ID } from '../src/sim/content/bots';
import type { SimEvent } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { TeamId } from '../src/sim/types';
import { buildSnapshot } from './snapshot';

export interface MatchPick {
  clientId: number;
  name: string;
  team: TeamId;
  championId: string;
  sigils: [string, string];
  // Cosmetic skin index; clamped by the sim.
  skin?: number;
  // Bot policy id: this seat is driven in-sim, not by a connection.
  bot?: string;
}

interface MatchPlayer {
  clientId: number;
  name: string;
  team: TeamId;
  unitId: number;
  known: Set<number>;
}

const ABILITY_KEYS = new Set(['Q', 'W', 'E', 'R']);

export class Match {
  readonly sim: Sim;
  readonly players = new Map<number, MatchPlayer>();
  private readonly unitNames = new Map<number, string>();
  private eventsThisTick: SimEvent[] = [];

  constructor(seed: number, picks: readonly MatchPick[]) {
    this.sim = new Sim(seed);
    for (const p of picks) {
      const unit = this.sim.addChampion(p.team, undefined, p.championId, p.skin ?? 0);
      unit.sigils = [...p.sigils];
      this.unitNames.set(unit.id, p.name);
      if (p.bot) {
        const def = BOTS[p.bot] ?? BOTS[DEFAULT_BOT_ID];
        if (def) this.sim.attachPolicy(unit.id, def.policy);
        continue;
      }
      this.players.set(p.clientId, {
        clientId: p.clientId,
        name: p.name,
        team: p.team,
        unitId: unit.id,
        known: new Set(),
      });
    }
  }

  // Scoreboard rows with real player and bot names.
  buildScore(): ServerMsg {
    const rows = this.sim.scoreboard().map((r) => ({
      ...r,
      name: this.unitNames.get(r.unitId) ?? r.name,
    }));
    return { t: 'score', rows };
  }

  tick(): void {
    this.eventsThisTick = this.sim.tick();
  }

  handleCommand(clientId: number, msg: ClientMsg): void {
    const p = this.players.get(clientId);
    if (!p) return;
    switch (msg.t) {
      case 'move':
        if (isFiniteVec(msg.x, msg.z)) this.sim.orderMove(p.unitId, msg.x, msg.z);
        break;
      case 'attack':
        if (typeof msg.targetId === 'number' && this.sim.isVisible(p.team, msg.targetId)) {
          this.sim.orderAttack(p.unitId, msg.targetId);
        }
        break;
      case 'attack_move':
        if (isFiniteVec(msg.x, msg.z)) this.sim.orderAttackMove(p.unitId, msg.x, msg.z);
        break;
      case 'recall':
        this.sim.startRecall(p.unitId);
        break;
      case 'cast':
        if (typeof msg.key === 'string' && ABILITY_KEYS.has(msg.key) && isFiniteVec(msg.x, msg.z)) {
          this.sim.castAbility(p.unitId, msg.key, { x: msg.x, z: msg.z });
        }
        break;
      case 'sigil':
        if ((msg.slot === 0 || msg.slot === 1) && isFiniteVec(msg.x, msg.z)) {
          this.sim.castSigil(p.unitId, msg.slot, { x: msg.x, z: msg.z });
        }
        break;
      case 'buy':
        if (typeof msg.itemId === 'string') this.sim.buyItem(p.unitId, msg.itemId);
        break;
      case 'skill':
        if (msg.key === 'Q' || msg.key === 'W' || msg.key === 'E' || msg.key === 'R') {
          this.sim.levelAbility(p.unitId, msg.key);
        }
        break;
      default:
        break;
    }
  }

  buildSnapshotFor(clientId: number): ServerMsg | null {
    const p = this.players.get(clientId);
    if (!p) return null;
    return buildSnapshot(this.sim, p.team, p.unitId, p.known, this.eventsThisTick);
  }
}
