// Navigation: the browser's history mirrors the stack of layers the app has
// open, so Back closes the top one instead of leaving the site (ADR 0020).
//
// The client is one page. Every screen is a DOM swap over the same
// document: the home, a section under its bar, a drawer, a pre-game card,
// the match itself. None of that used to touch the history, so the
// browser's Back, the one navigation control every visitor already knows,
// left the game for whatever site came before it, mid-match included.
//
// A layer is anything that opens over what was there and can be closed
// back to it. Each open layer owns one history entry above the root's, in
// stack order; the entry's state carries the layer's depth. A Back pop
// then names a depth, and the layers above it close, top first. A layer
// that closes on its own (its Back button, Escape, a scrim click) says so,
// and the history is walked back to match. A guarded layer refuses the
// pop: nothing above it survives, it stays, its entry is put back, and it
// is told; the match uses that to open its pause menu, where Leave match
// is the deliberate way out. While anything is guarded, closing the tab
// asks first (the glue in installNav).
//
// Only the home's sections carry an address (#ladder): a reload lands back
// in the section, and the entries under a match or a drawer keep the
// address they were opened on. The stale entries a reload leaves behind
// can only be reached by Back, and Back into one reloads the page into
// what it names, which is the ordinary shape of a one-page app.
//
// The core is pure: it is handed the history and told about pops, so it
// runs under Node with a fake history (tests/nav.test.ts). installNav wires
// it to the window.

export interface HistoryLike {
  pushState(data: unknown, unused: string, url?: string): void;
  replaceState(data: unknown, unused: string, url?: string): void;
  go(delta: number): void;
}

export interface Frame {
  readonly key: string;
  // Called by the layer on its own way out. Idempotent, and a no-op for a
  // layer the nav closed itself.
  closed(): void;
  // While guarded, a Back pop does not close this layer: `onBack` runs
  // instead, and closing the tab asks first. Layers above it still close.
  guard(onBack: () => void): void;
  unguard(): void;
}

export interface Nav {
  // Opens a layer over the current top. `hash` gives it an address
  // ('#hash'); null keeps the address the page has.
  push(key: string, close: () => void, hash?: string | null): Frame;
  // Swaps `old` (and whatever is open above it) for another layer at its
  // depth: one section of the home for the next, in one history entry.
  // Pushes when `old` is not open.
  replace(old: Frame, key: string, close: () => void, hash?: string | null): Frame;
  depth(): number;
  top(): Frame | null;
  guarded(): boolean;
  // What the browser reports when it lands on an entry: the state it
  // carries. Anything that is not one of ours counts as the root.
  onPopState(state: unknown): void;
}

export interface NavHooks {
  // The address for a layer: its hash, or the page's own when null.
  urlFor(hash: string | null): string;
  // Fires when the first layer is guarded and when the last one stops
  // being guarded; installNav hangs the unload prompt on it.
  onGuardChange?(guarded: boolean): void;
}

interface Layer {
  frame: Frame;
  close: () => void;
  hash: string | null;
  onBack: (() => void) | null;
}

interface EntryState {
  loc: number;
}

function depthOf(state: unknown): number {
  if (typeof state === 'object' && state !== null && 'loc' in state) {
    const loc = (state as EntryState).loc;
    if (typeof loc === 'number' && Number.isInteger(loc) && loc >= 0) return loc;
  }
  return 0;
}

export function createNav(history: HistoryLike, hooks: NavHooks): Nav {
  const stack: Layer[] = [];
  // What we believe the browser holds: the depth of its current entry and
  // the address of every entry we wrote, by depth.
  let histDepth = 0;
  const urls: string[] = [hooks.urlFor(null)];
  // A traversal we asked for and have not seen land yet, and where it
  // should land. Nothing else is written to the history until it does,
  // because a push that beats the traversal would land on the wrong side
  // of it.
  let inFlight: number | null = null;
  let wasGuarded = false;

  history.replaceState({ loc: 0 } satisfies EntryState, '', urls[0]);

  const guarded = (): boolean => stack.some((l) => l.onBack !== null);
  const tellGuard = (): void => {
    const now = guarded();
    if (now === wasGuarded) return;
    wasGuarded = now;
    hooks.onGuardChange?.(now);
  };

  // Brings the browser to the stack: back past dead entries, forward with
  // the missing ones, and the top entry's address put right.
  const reconcile = (): void => {
    if (inFlight !== null) return;
    const want = stack.length;
    if (histDepth > want) {
      inFlight = want;
      history.go(want - histDepth);
      return;
    }
    while (histDepth < want) {
      histDepth++;
      const url = hooks.urlFor(stack[histDepth - 1]!.hash);
      urls.length = histDepth;
      urls.push(url);
      history.pushState({ loc: histDepth } satisfies EntryState, '', url);
    }
    if (want > 0) {
      const url = hooks.urlFor(stack[want - 1]!.hash);
      if (urls[want] !== url) {
        urls[want] = url;
        history.replaceState({ loc: want } satisfies EntryState, '', url);
      }
    }
    tellGuard();
  };

  const makeFrame = (key: string, close: () => void, hash: string | null): Layer => {
    const layer: Layer = {
      close,
      hash,
      onBack: null,
      frame: {
        key,
        closed(): void {
          const i = stack.indexOf(layer);
          if (i < 0) return;
          // Whatever was open above it went with it; their close is the
          // nav's to call, since nobody else will.
          const above = stack.splice(i);
          for (let j = above.length - 1; j >= 1; j--) above[j]!.close();
          reconcile();
        },
        guard(onBack): void {
          layer.onBack = onBack;
          tellGuard();
        },
        unguard(): void {
          layer.onBack = null;
          tellGuard();
        },
      },
    };
    return layer;
  };

  return {
    push(key, close, hash = null): Frame {
      const layer = makeFrame(key, close, hash);
      stack.push(layer);
      reconcile();
      return layer.frame;
    },
    replace(old, key, close, hash = null): Frame {
      const layer = makeFrame(key, close, hash);
      const i = stack.findIndex((l) => l.frame === old);
      const gone = i < 0 ? [] : stack.splice(i);
      stack.push(layer);
      for (let j = gone.length - 1; j >= 0; j--) gone[j]!.close();
      reconcile();
      return layer.frame;
    },
    depth: () => stack.length,
    top: () => stack[stack.length - 1]?.frame ?? null,
    guarded,
    onPopState(state): void {
      const target = depthOf(state);
      histDepth = target;
      if (inFlight !== null) {
        const expected = inFlight;
        inFlight = null;
        // Our own traversal landing: the stack already says so.
        if (target === expected) {
          reconcile();
          return;
        }
      }
      // A Back (or a jump down the history menu) below the stack: the
      // layers above the target close, top first, until one refuses.
      let refused: Layer | null = null;
      while (stack.length > target && refused === null) {
        const top = stack[stack.length - 1]!;
        if (top.onBack !== null) {
          refused = top;
          break;
        }
        stack.pop();
        top.close();
      }
      reconcile();
      if (refused) refused.onBack?.();
    },
  };
}

// The browser glue: the one Nav of the page, made on first use so the
// module can be imported under Node.
let installed: Nav | null = null;

export function installNav(win: Window = window): Nav {
  if (installed) return installed;
  const nav = createNav(win.history, {
    urlFor: (hash) => `${win.location.pathname}${win.location.search}${hash ? `#${hash}` : ''}`,
    onGuardChange: (guarded) => {
      if (guarded) win.addEventListener('beforeunload', askBeforeUnload);
      else win.removeEventListener('beforeunload', askBeforeUnload);
    },
  });
  win.addEventListener('popstate', (e) => nav.onPopState(e.state));
  installed = nav;
  return nav;
}

// The one Nav; installNav must have run (boot does, before anything opens).
export function appNav(): Nav {
  if (!installed) throw new Error('nav not installed: call installNav() first');
  return installed;
}

// The browser's own "Leave site?" dialog, the only thing a page may put
// between a reload or a closed tab and the player. The text is the
// browser's; returnValue is what older engines read.
function askBeforeUnload(e: BeforeUnloadEvent): void {
  e.preventDefault();
  e.returnValue = '';
}

// The section a page's address names at boot, if it is one of `keys`:
// '#ladder' reopens the ladder, anything else is the home itself.
export function sectionFromHash<K extends string>(hash: string, keys: readonly K[]): K | null {
  const key = hash.startsWith('#') ? hash.slice(1) : hash;
  return (keys as readonly string[]).includes(key) ? (key as K) : null;
}
