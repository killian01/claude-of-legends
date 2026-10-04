// The planet's shader programs linked before its first frame. Three links
// a program the first time something draws with it, and that first draw
// then waits for the link: the planet's first frame linked some thirty
// programs at once, a stall of seconds on a phone at every match's start
// (and on Play the next match). The warm-up hands the whole scene to the
// GPU's compiler in one go (three's compile) and holds the draw until the
// programs report they are linked, which the browser does off the page's
// thread where it offers parallel linking (KHR_parallel_shader_compile):
// meanwhile the HUD, the input and the network keep running while the
// picture waits. The hold is bounded, and a warm-up that fails holds
// nothing. Without parallel linking a program reports ready at once and
// the first draw waits as it always did.

// A three WebGLProgram, as the warm-up reads it: its isReady polls the
// parallel link without waiting on it (three's typings leave it out).
export type LinkingProgram = object;

// Whether a program has nothing left to wait for. Three's isReady answers
// false while the link runs and true once it is done; on a lost context it
// answers null, and keeps answering null, so only a false is worth asking
// again.
function settled(program: LinkingProgram): boolean {
  const ready = (program as { isReady?: () => unknown }).isReady;
  return typeof ready !== 'function' || ready.call(program) !== false;
}

const POLL_MS = 16;

// Resolves once every program in `linking` is settled or gone from the
// renderer's list (`live`), polling through `later`, or as soon as `stop`
// says the wait is over (the renderer went, the hold's bound passed): no
// poll is left running behind it, holding the renderer.
export function whenLinked(
  linking: readonly LinkingProgram[],
  live: () => readonly LinkingProgram[],
  later: (ms: number) => Promise<void>,
  stop: () => boolean = () => false,
): Promise<void> {
  const waiting = new Set(linking);
  const check = (): Promise<void> => {
    if (stop()) return Promise.resolve();
    const present = new Set(live());
    for (const p of waiting) {
      if (!present.has(p) || settled(p)) waiting.delete(p);
    }
    if (waiting.size === 0) return Promise.resolve();
    return later(POLL_MS).then(check);
  };
  return check();
}

// How long the planet's first frame may wait for its programs.
export const WARM_HOLD_MS = 2500;

// A warm-up's hold over the draw.
export class ProgramWarmup {
  private pending = true;
  private readonly until: number;

  // `work` is told when the hold ends, so its own waiting ends with it.
  constructor(work: (until: number) => Promise<unknown>, now: number, maxHoldMs = WARM_HOLD_MS) {
    this.until = now + maxHoldMs;
    let started: Promise<unknown>;
    try {
      started = work(this.until);
    } catch {
      this.pending = false;
      return;
    }
    const done = (): void => {
      this.pending = false;
    };
    started.then(done, done);
  }

  // True while the programs are still linking, within the bound: the
  // renderer skips its draw.
  holds(now: number): boolean {
    if (!this.pending) return false;
    if (now >= this.until) {
      this.pending = false;
      return false;
    }
    return true;
  }
}
