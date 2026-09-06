// Scoring a match for the thirty seconds worth filming.
//
// A promotion clip has one job: someone scrolling has to know what they
// are looking at before they decide to keep looking. That rules out most
// of a MOBA. Laning is legible only to people who already play one, a
// chase is two dots, and an empty river is nothing at all. What reads
// instantly, to anyone, is several champions in one place hitting each
// other and somebody dying.
//
// So a window is scored on exactly that, and the weights say what a clip
// is for rather than what a match is about: a death is worth thirty casts,
// because a death is the thing a stranger recognises.

export interface ClipTick {
  // Champions that died on this tick.
  deaths: number;
  // Towers that fell. A structure coming down is the other thing that
  // reads without knowing the game: something large stops existing.
  towers: number;
  // The Warden. Rare, big, and the only neutral worth a frame.
  warden: number;
  // Champion ability casts: the colour under the fight.
  casts: number;
  // Champions in the largest group that holds both teams, so a team
  // walking down a lane alone scores nothing.
  clustered: number;
}

export const CLIP_WEIGHTS = {
  death: 60,
  tower: 45,
  warden: 80,
  cast: 2,
  // Per champion past the third, PER TICK, so it accumulates over a window
  // while the others fire once. Tiny on purpose: it is a tie-breaker
  // between windows that hold the same kills, not a reason to pick one.
  // At 0.05 a whole window of five champions on top of each other is worth
  // one kill. The first weights tried made it worth a hundred, and the
  // scout duly chose a lane full of people not fighting.
  crowd: 0.05,
} as const;

export function tickScore(t: ClipTick): number {
  const crowd = t.clustered > 3 ? (t.clustered - 3) * CLIP_WEIGHTS.crowd : 0;
  return (
    t.deaths * CLIP_WEIGHTS.death +
    t.towers * CLIP_WEIGHTS.tower +
    t.warden * CLIP_WEIGHTS.warden +
    t.casts * CLIP_WEIGHTS.cast +
    crowd
  );
}

export interface Window {
  // Index of the first tick in the window.
  start: number;
  total: number;
}

// The best contiguous run of `width` ticks. A plain sliding sum: the
// series is one match long and this is not the slow part.
export function bestWindow(scores: readonly number[], width: number): Window {
  if (width <= 0 || scores.length === 0) return { start: 0, total: 0 };
  const span = Math.min(width, scores.length);
  let sum = 0;
  for (let i = 0; i < span; i++) sum += scores[i] ?? 0;
  let best: Window = { start: 0, total: sum };
  for (let i = span; i < scores.length; i++) {
    sum += (scores[i] ?? 0) - (scores[i - span] ?? 0);
    if (sum > best.total) best = { start: i - span + 1, total: sum };
  }
  return best;
}

// The largest set of champions within `radius` of one of them that holds
// at least one from each team. Positions only: the caller has already
// dropped the dead.
export interface Spot {
  team: number;
  x: number;
  z: number;
}

export function mixedCluster(spots: readonly Spot[], radius: number): number {
  let best = 0;
  for (const centre of spots) {
    let count = 0;
    const teams = new Set<number>();
    for (const other of spots) {
      const dx = other.x - centre.x;
      const dz = other.z - centre.z;
      if (dx * dx + dz * dz <= radius * radius) {
        count += 1;
        teams.add(other.team);
      }
    }
    if (teams.size > 1 && count > best) best = count;
  }
  return best;
}
