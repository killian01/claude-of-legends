// A goal across battle royales, on Respawn's end card: the points this
// browser's seats have earned on the Wanderseed, climbed as levels, the bar
// running from the last level reached to the next. Kept per browser
// (game/settings.ts royaleGoal), so it names nobody: not a ladder entry,
// not another player. Pure; ui/royale_goal_bar.ts draws it and ui/hud.ts
// counts the points as they come.
//
// The points are the ones a seat banks (server/royale_points.ts): a
// champion taken down 10, an assist 5, a camp's last hit or a cache opened
// 1, a big creature 15, Respawn's best score 50 at the end, each doubled
// while another person plays the match. A visitor's short stay earns a
// few, a match played through 50 to 250 (three takedowns and five assists
// alone are 55), so the first level is a match's worth and each after it
// asks a little more.

// The points from level 1 to level 2, and how much longer each next span is.
export const GOAL_FIRST_SPAN = 50;
export const GOAL_SPAN_GROWTH = 25;
// The first bar starts this much filled, so a first card never shows an
// empty goal; the points it asks for stay the same.
export const GOAL_HEAD_START = 0.2;
// A stored total past this is junk, not points.
export const GOAL_MAX_POINTS = 10_000_000;

// A level's span: the level, its first point, and the next level's.
export interface GoalStep {
  level: number;
  from: number;
  to: number;
}

export function goalStep(points: number): GoalStep {
  const p = Math.max(0, Math.min(GOAL_MAX_POINTS, Math.floor(points)));
  let level = 1;
  let from = 0;
  let span = GOAL_FIRST_SPAN;
  while (p >= from + span) {
    from += span;
    level += 1;
    span += GOAL_SPAN_GROWTH;
  }
  return { level, from, to: from + span };
}

// How full the bar of a step stands at `points`, 0 to 1: the share of the
// span, the first level's from its head start.
export function goalShare(points: number, step: GoalStep): number {
  const raw = Math.min(1, Math.max(0, (points - step.from) / (step.to - step.from)));
  return step.level === 1 ? GOAL_HEAD_START + (1 - GOAL_HEAD_START) * raw : raw;
}

// What the card shows.
export interface GoalModel {
  // The level stood at now, and the one the bar runs to.
  level: number;
  next: number;
  // A level reached this match (the highest), else null.
  reached: number | null;
  // The bar before this match's points and after them, 0 to 1, on the
  // step now shown: a level reached this match starts it from its floor.
  was: number;
  now: number;
  // This match's points, and those still wanted for the next level.
  earned: number;
  left: number;
  // The words: the level line over the bar and the line under it.
  title: string;
  line: string;
}

export function goalModel(before: number, earned: number): GoalModel {
  const from = Math.max(0, Math.min(GOAL_MAX_POINTS, Math.floor(before)));
  const gain = Math.max(0, Math.floor(earned));
  const after = Math.min(GOAL_MAX_POINTS, from + gain);
  const was = goalStep(from);
  const step = goalStep(after);
  const reached = step.level > was.level ? step.level : null;
  const left = step.to - after;
  const got =
    gain === 0 ? 'No points this match' : `+${gain} ${gain === 1 ? 'point' : 'points'} this match`;
  return {
    level: step.level,
    next: step.level + 1,
    reached,
    was: reached !== null ? goalShare(step.from, step) : goalShare(from, step),
    now: goalShare(after, step),
    earned: gain,
    left,
    title: reached !== null ? `Level ${reached} reached` : `Level ${step.level}`,
    line: `${got} · ${left} more to Level ${step.level + 1}`,
  };
}

// A match's count: the total kept before it, read once when it begins,
// and the points its seat banks, written as they come so a tab closed
// mid-match keeps them.
export class GoalTrack {
  private readonly before: number;
  private earned = 0;

  constructor(
    read: () => number,
    private readonly write: (total: number) => void,
  ) {
    this.before = Math.max(0, Math.min(GOAL_MAX_POINTS, Math.floor(read())));
  }

  earn(delta: number): void {
    if (!(delta > 0)) return;
    this.earned += Math.round(delta);
    this.write(Math.min(GOAL_MAX_POINTS, this.before + this.earned));
  }

  model(): GoalModel {
    return goalModel(this.before, this.earned);
  }
}
