// The play report: what a bot did with its time and where it died, built
// from the sim's own events (ADR 0013). Pure bookkeeping over the event
// stream, one tick at a time; the Academy's sparring, the Arena's replays
// and the Briefing all feed it the same way. This is the mechanism that
// turns watching into learning: "six deaths on the chase play" is a rule
// the owner can go and fix.

import type { SimEvent } from '../sim';

export interface PlayStats {
  // Ticks spent with this play active.
  ticks: number;
  // Deaths while this play was active.
  deaths: number;
}

export interface UnitPlayReport {
  unitId: number;
  plays: Record<string, PlayStats>;
  deaths: number;
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
  // ran, the same number a replay event carries.
  observe(tick: number, events: readonly SimEvent[]): void {
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
      units.push({ unitId, plays, deaths });
    }
    units.sort((a, b) => a.unitId - b.unitId);
    return { ticks: this.lastTick, units };
  }
}
