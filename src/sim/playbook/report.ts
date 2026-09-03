// The play report: what a bot did with its time and where it died, built
// from the sim's own events (ADR 0013). Pure bookkeeping over the event
// stream, one tick at a time; the Academy's sparring, the Arena's replays
// and the Briefing all feed it the same way. This is the mechanism that
// turns watching into learning: "six deaths on the chase play" is a rule
// the owner can go and fix.

import type { Sim, SimEvent } from '../sim';
import { type DeathScene, deathScene } from './death_context';

export interface PlayStats {
  // Ticks spent with this play active.
  ticks: number;
  // Deaths while this play was active.
  deaths: number;
}

// One death, dated: the tick, the play that held, and who landed it. What
// the Match sheet links into the replay (playtest round 3).
export interface DeathNote {
  tick: number;
  play: string | null;
  killerId: number;
  // What stood around (death_context.ts), when the ledger had the sim.
  scene?: DeathScene;
}

export interface UnitPlayReport {
  unitId: number;
  plays: Record<string, PlayStats>;
  deaths: number;
  // Every death in order; absent on reports written before it existed.
  deathsAt?: DeathNote[];
}

export interface PlayReport {
  // The last tick observed.
  ticks: number;
  units: UnitPlayReport[];
}

interface Span {
  playId: string;
  since: number;
}

export class PlayLedger {
  private readonly current = new Map<number, Span>();
  private readonly stats = new Map<number, Map<string, PlayStats>>();
  private readonly deaths = new Map<number, DeathNote[]>();
  private lastTick = 0;

  private slot(unitId: number, playId: string): PlayStats {
    let byPlay = this.stats.get(unitId);
    if (!byPlay) {
      byPlay = new Map();
      this.stats.set(unitId, byPlay);
    }
    let s = byPlay.get(playId);
    if (!s) {
      s = { ticks: 0, deaths: 0 };
      byPlay.set(playId, s);
    }
    return s;
  }

  // Feed one tick's events. The tick is the sim's tickCount after the tick
  // ran, the same number a replay event carries. With the sim at hand,
  // every death is noted with its scene (the Death card).
  observe(tick: number, events: readonly SimEvent[], sim?: Sim): void {
    this.lastTick = tick;
    for (const ev of events) {
      if (ev.type === 'play') {
        const open = this.current.get(ev.unitId);
        if (open) this.slot(ev.unitId, open.playId).ticks += tick - open.since;
        this.current.set(ev.unitId, { playId: ev.playId, since: tick });
        this.slot(ev.unitId, ev.playId);
      } else if (ev.type === 'death') {
        const open = this.current.get(ev.unitId);
        if (open) this.slot(ev.unitId, open.playId).deaths += 1;
        // Only the units with plays are reported; a death before any play
        // (or a unit without one) is noted but never surfaces.
        let notes = this.deaths.get(ev.unitId);
        if (!notes) {
          notes = [];
          this.deaths.set(ev.unitId, notes);
        }
        const scene = sim ? deathScene(sim, ev.unitId) : null;
        notes.push({
          tick,
          play: open?.playId ?? null,
          killerId: ev.killerId,
          ...(scene ? { scene } : {}),
        });
      }
    }
  }

  // The report so far; the open spans count up to the last tick observed.
  // Reading never mutates, so a report can be taken mid-match.
  report(): PlayReport {
    const units: UnitPlayReport[] = [];
    for (const [unitId, byPlay] of this.stats) {
      const plays: Record<string, PlayStats> = {};
      let deaths = 0;
      for (const [playId, s] of byPlay) {
        plays[playId] = { ...s };
        deaths += s.deaths;
      }
      const open = this.current.get(unitId);
      if (open) {
        const s = plays[open.playId] ?? { ticks: 0, deaths: 0 };
        plays[open.playId] = { ...s, ticks: s.ticks + (this.lastTick - open.since) };
      }
      units.push({
        unitId,
        plays,
        deaths,
        deathsAt: (this.deaths.get(unitId) ?? []).map((d) => ({ ...d })),
      });
    }
    units.sort((a, b) => a.unitId - b.unitId);
    return { ticks: this.lastTick, units };
  }
}
