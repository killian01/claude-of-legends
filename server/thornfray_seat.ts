// A person's seat over a whole Thornfray, for the seat report
// (server/seat_report.ts, ADR 0035): a seat is held bout after bout, each
// bout a sim of its own counting its ticks from nothing, and a person may
// leave and come back between. Each stint (a bout's seat, from when the
// person sat in it to the bout's end or their leaving) is folded in as it
// ends: its stats moved onto the match's clock (the ticks of the bouts
// before it), its champion's counters counted from where the stint began.
// Pure.

import type { SeatStats } from './match';

export interface UnitCounters {
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
}

export interface SeatTally {
  stats: SeatStats | null;
  unit: UnitCounters;
}

export function newTally(): SeatTally {
  return { stats: null, unit: { level: 0, kills: 0, deaths: 0, assists: 0, cs: 0 } };
}

const later = (tick: number | null, offset: number): number | null =>
  tick === null ? null : tick + offset;

// One stint's stats onto the match's clock, after those before it: the
// first of each moment kept, the counts summed, the steps each once.
export function foldStats(into: SeatStats | null, stint: SeatStats, offset: number): SeatStats {
  const kinds = { ...(into?.kinds ?? {}) };
  for (const [k, n] of Object.entries(stint.kinds)) kinds[k] = (kinds[k] ?? 0) + n;
  const steps = [...(into?.steps ?? [])];
  for (const s of stint.steps) if (!steps.includes(s)) steps.push(s);
  return {
    startTick: into?.startTick ?? stint.startTick + offset,
    loadedTick: into?.loadedTick ?? later(stint.loadedTick, offset),
    orders: (into?.orders ?? 0) + stint.orders,
    kinds,
    firstOrderTick: into?.firstOrderTick ?? later(stint.firstOrderTick, offset),
    steps,
    walked: (into?.walked ?? 0) + stint.walked,
    lastX: stint.lastX,
    lastZ: stint.lastZ,
    ...(stint.lastY !== undefined ? { lastY: stint.lastY } : {}),
    points: (into?.points ?? 0) + stint.points,
    firstHitTick: into?.firstHitTick ?? later(stint.firstHitTick, offset),
    firstHurtTick: into?.firstHurtTick ?? later(stint.firstHurtTick, offset),
    firstTakedownTick: into?.firstTakedownTick ?? later(stint.firstTakedownTick, offset),
    firstDeathTick: into?.firstDeathTick ?? later(stint.firstDeathTick, offset),
    firstCacheTick: into?.firstCacheTick ?? later(stint.firstCacheTick, offset),
  };
}

// A stint folded in: its stats, and its champion's counters from `from`
// (as they stood when the stint began) to `to` (now); the level the last
// stint's.
export function foldStint(
  t: SeatTally,
  stats: SeatStats,
  offset: number,
  from: UnitCounters,
  to: UnitCounters,
): void {
  t.stats = foldStats(t.stats, stats, offset);
  t.unit = {
    level: to.level,
    kills: t.unit.kills + Math.max(0, to.kills - from.kills),
    deaths: t.unit.deaths + Math.max(0, to.deaths - from.deaths),
    assists: t.unit.assists + Math.max(0, to.assists - from.assists),
    cs: t.unit.cs + Math.max(0, to.cs - from.cs),
  };
}

export function countersOf(
  u: { level: number; kills: number; deaths: number; assists: number; cs: number } | undefined,
): UnitCounters {
  return u
    ? { level: u.level, kills: u.kills, deaths: u.deaths, assists: u.assists, cs: u.cs }
    : { level: 0, kills: 0, deaths: 0, assists: 0, cs: 0 };
}
