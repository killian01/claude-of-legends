// The team's memory of who stood in which lane (CONTEXT.md: Lane opponent;
// plan-bots phase 12): for each team, lane and enemy champion, the seconds
// that champion was seen inside the lane's corridor over the last three
// minutes, in ten second buckets. The lane opponent of a lane is the enemy
// seen there the most, nobody when nobody was. Fed by the vision step, so
// it reads only what the team saw; deterministic, ties to the lower id.

import type { LaneId } from './content/map';
import type { TeamId } from './types';

export const SIGHTING_BUCKET_S = 10;
export const SIGHTING_WINDOW_S = 180;
// The window behind a lane's activity (the split push reads the quietest).
export const LANE_ACTIVITY_WINDOW_S = 60;
const BUCKETS = SIGHTING_WINDOW_S / SIGHTING_BUCKET_S;

interface Bucket {
  period: number;
  seconds: number;
}

export class LaneSightings {
  private readonly seen: [Map<string, Bucket[]>, Map<string, Bucket[]>] = [new Map(), new Map()];

  // The memory as plain data, for a world checkpoint (src/sim/snapshot.ts).
  snapshot(): [Map<string, Bucket[]>, Map<string, Bucket[]>] {
    const copy = (m: Map<string, Bucket[]>): Map<string, Bucket[]> =>
      new Map([...m].map(([k, list]) => [k, list.map((b) => ({ ...b }))]));
    return [copy(this.seen[0]), copy(this.seen[1])];
  }

  restore(seen: [Map<string, Bucket[]>, Map<string, Bucket[]>]): void {
    for (const team of [0, 1] as const) {
      this.seen[team].clear();
      for (const [k, list] of seen[team]) {
        this.seen[team].set(
          k,
          list.map((b) => ({ ...b })),
        );
      }
    }
  }

  // One tick of an enemy champion seen inside a lane by a team.
  record(team: TeamId, lane: LaneId, enemyId: number, time: number, dt: number): void {
    const key = `${lane}:${enemyId}`;
    const period = Math.floor(time / SIGHTING_BUCKET_S);
    let list = this.seen[team].get(key);
    if (!list) {
      list = [];
      this.seen[team].set(key, list);
    }
    const last = list[list.length - 1];
    if (last && last.period === period) last.seconds += dt;
    else {
      list.push({ period, seconds: dt });
      if (list.length > BUCKETS) list.shift();
    }
  }

  // Seconds any enemy champion was seen in the lane over the last `windowS`
  // seconds: how busy a lane is, for the split push (the quietest lane).
  activity(team: TeamId, lane: LaneId, time: number, windowS: number): number {
    const oldest =
      Math.floor(time / SIGHTING_BUCKET_S) - Math.ceil(windowS / SIGHTING_BUCKET_S) + 1;
    const prefix = `${lane}:`;
    let total = 0;
    for (const [key, list] of this.seen[team]) {
      if (!key.startsWith(prefix)) continue;
      for (const b of list) if (b.period >= oldest) total += b.seconds;
    }
    return Math.round(total * 10) / 10;
  }

  // The enemy champion seen the most in the lane over the last three minutes.
  opponent(team: TeamId, lane: LaneId, time: number): number | null {
    const oldest = Math.floor(time / SIGHTING_BUCKET_S) - BUCKETS + 1;
    const prefix = `${lane}:`;
    let best: number | null = null;
    let bestSeconds = 0;
    for (const [key, list] of this.seen[team]) {
      if (!key.startsWith(prefix)) continue;
      const id = Number(key.slice(prefix.length));
      let total = 0;
      for (const b of list) if (b.period >= oldest) total += b.seconds;
      if (total <= 0) continue;
      if (best === null || total > bestSeconds || (total === bestSeconds && id < best)) {
        best = id;
        bestSeconds = total;
      }
    }
    return best;
  }
}
