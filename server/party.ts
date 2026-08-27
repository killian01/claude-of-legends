// Party packing: whole groups seated onto two sides of TEAM_CAP each,
// greedy in queue order (first come, first seated), balancing sides so
// solo humans spread across teams (that is what makes a match rateable).
// A group that cannot fit both sides is skipped and simply waits. Pure,
// so the seating rules are pinned by tests.

import type { TeamId } from '../src/sim/types';

export interface PackedGroup {
  // Index into the sizes array handed in.
  index: number;
  team: TeamId;
}

// exact: seat EXACTLY target seats or return null (full-match formation).
// Loose (exact false): seat whatever fits, up to target (bot-filled start).
export function packGroups(
  sizes: readonly number[],
  target: number,
  teamCap: number,
  opts: { exact: boolean },
): PackedGroup[] | null {
  const seated: PackedGroup[] = [];
  const used: [number, number] = [0, 0];
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i]!;
    if (used[0] + used[1] + size > target) continue;
    // Prefer the emptier side; fall back to the other if the group only
    // fits there. Ties go blue.
    const first: TeamId = used[0] <= used[1] ? 0 : 1;
    const second: TeamId = first === 0 ? 1 : 0;
    let team: TeamId | null = null;
    if (used[first] + size <= teamCap) team = first;
    else if (used[second] + size <= teamCap) team = second;
    if (team === null) continue;
    used[team] += size;
    seated.push({ index: i, team });
    if (used[0] + used[1] === target) break;
  }
  if (opts.exact && used[0] + used[1] !== target) return null;
  return seated;
}
