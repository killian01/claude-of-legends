// The client that reloads itself on a new build.
//
// The page never reloads between screens (ADR 0020), so a player whose tab
// was open before a deployment keeps the old code until they reload by
// hand: the deploy that took the Live entry out of the bar was seen by
// nobody already signed in. And nothing told the client: /api/public/build
// carried the replay version and the content fingerprint, neither of which
// moves for a change to the interface.
//
// So the server says which bundle it serves (server/build_info.ts) and the
// client compares it to its own. The checks sit where a deployment shows:
// a WebSocket that closes (the server restarted), the tab regaining focus,
// and a slow poll for a tab with no socket open, since a practice match
// against bots runs in the browser alone. On a different build the page
// reloads, everywhere, after a short notice (src/ui/reload_notice.ts):
// nobody plays on the old version once a new one is up.
//
// No DOM here: the wiring is in src/main.ts, and this file is what the
// tests run.

// The build id is the entry bundle's name, index-XXXX, found in the text
// given: the server hands it dist/index.html, the client its own module
// URL. Vite fingerprints the bundle, so the name moves with every build
// and with nothing else. The dev server serves /src/main.ts, which has no
// bundle in it: null, and nothing ever reloads in development.
const BUNDLE = /\/assets\/(index-[A-Za-z0-9_-]+)\.js(?![A-Za-z0-9_.-])/;

export function buildIdIn(text: string): string | null {
  const m = BUNDLE.exec(text);
  return m ? (m[1] ?? null) : null;
}

// Both sides known and different. An unknown on either side is not a new
// build: a development server, a failed request, a server without dist.
export function isNewBuild(own: string | null, served: string | null | undefined): boolean {
  return own !== null && typeof served === 'string' && served !== '' && served !== own;
}

export interface BuildWatch {
  // Check now: a socket closed, the tab came back.
  poke(): void;
  stop(): void;
}

export interface BuildWatchOptions {
  // This page's own bundle, null in development.
  own: string | null;
  // The served bundle, null when the server did not answer or has none.
  fetchBuild: () => Promise<string | null>;
  // Called once, the first time the served build differs.
  onNew: () => void;
  // The slow poll, for a tab with no socket to close.
  everyMs: number;
}

export function startBuildWatch(o: BuildWatchOptions): BuildWatch {
  let done = o.own === null;
  let checking = false;
  const check = async (): Promise<void> => {
    if (done || checking) return;
    checking = true;
    try {
      const served = await o.fetchBuild();
      if (!done && isNewBuild(o.own, served)) {
        done = true;
        if (timer !== null) clearInterval(timer);
        o.onNew();
      }
    } catch {
      // The next check asks again.
    } finally {
      checking = false;
    }
  };
  const timer = done ? null : setInterval(() => void check(), o.everyMs);
  return {
    poke: () => void check(),
    stop: () => {
      done = true;
      if (timer !== null) clearInterval(timer);
    },
  };
}
