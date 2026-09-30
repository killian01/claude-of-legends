// A lost WebGL context, and the way back from it. A phone reclaiming GPU
// memory, a GPU process restarting, a tab the system put to sleep: the
// context goes, the canvas turns black and the match runs on behind it
// with nothing drawn. The browser gives a context back only to a page
// that asked for it on the loss, which three.js does and this does too;
// once it is back three.js uploads everything again from what the page
// still holds, and the terrain's pictures, closed after their first
// upload (terrain_images.ts), are decoded again first, with nothing drawn
// meanwhile. A notice over the match says what is happening, and offers a
// reload when the picture does not come back.
//
// No DOM and no timers of its own: the canvas is any event target, the
// clock and the timer are handed in, so tests/picture_watch.test.ts runs
// the whole story.

export type PictureState =
  | { kind: 'shown' }
  | { kind: 'lost'; since: number }
  | { kind: 'restoring' }
  | { kind: 'failed' };

// How long a lost picture is waited for before the notice offers a reload.
export const RELOAD_OFFER_MS = 8000;

export interface PictureNotice {
  title: string;
  line: string;
  // Whether it offers to reload the page.
  reload: boolean;
}

const TITLE = 'Picture lost';

// What the notice says in each state; null while the picture is shown.
export function pictureNotice(state: PictureState, now: number): PictureNotice | null {
  switch (state.kind) {
    case 'shown':
      return null;
    case 'lost':
      return now - state.since < RELOAD_OFFER_MS
        ? {
            title: TITLE,
            line: 'The device took the graphics away. The match keeps running, and the picture comes back on its own.',
            reload: false,
          }
        : {
            title: TITLE,
            line: 'The graphics have not come back. Reloading the page brings the picture back.',
            reload: true,
          };
    case 'restoring':
      return { title: TITLE, line: 'The graphics are back. Redrawing the map.', reload: false };
    case 'failed':
      return {
        title: TITLE,
        line: 'The map could not be redrawn. Reloading the page brings the picture back.',
        reload: true,
      };
  }
}

export interface PictureHooks {
  // Brings back what the renderer needs before it draws on a restored
  // context: the terrain's pictures, decoded and uploaded again.
  restore(): Promise<void>;
  // Puts the notice up, or takes it down on null.
  show(notice: PictureNotice | null): void;
  now(): number;
  // Runs `run` once after `ms`; returns what cancels it.
  later(run: () => void, ms: number): () => void;
}

export interface PictureWatch {
  // Whether the renderer must not draw: the context is gone, or back with
  // the terrain's pictures still on their way.
  blocked(): boolean;
  state(): PictureState;
  dispose(): void;
}

export function watchPicture(canvas: EventTarget, hooks: PictureHooks): PictureWatch {
  let state: PictureState = { kind: 'shown' };
  // Every loss and every return starts a new story; a restore that ends
  // after a newer one began says nothing.
  let story = 0;
  let cancelOffer: (() => void) | null = null;
  let disposed = false;

  const enter = (next: PictureState): void => {
    state = next;
    cancelOffer?.();
    cancelOffer = null;
    hooks.show(pictureNotice(next, hooks.now()));
    if (next.kind === 'lost') {
      cancelOffer = hooks.later(() => {
        cancelOffer = null;
        if (state === next) hooks.show(pictureNotice(next, hooks.now()));
      }, RELOAD_OFFER_MS);
    }
  };

  const onLost = (event: Event): void => {
    // Without this the browser never gives the context back.
    event.preventDefault();
    story++;
    enter({ kind: 'lost', since: hooks.now() });
  };

  const onRestored = (): void => {
    const mine = ++story;
    enter({ kind: 'restoring' });
    hooks.restore().then(
      () => {
        if (!disposed && mine === story) enter({ kind: 'shown' });
      },
      () => {
        if (!disposed && mine === story) enter({ kind: 'failed' });
      },
    );
  };

  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  return {
    blocked: () => state.kind !== 'shown',
    state: () => state,
    dispose: () => {
      disposed = true;
      story++;
      cancelOffer?.();
      cancelOffer = null;
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
    },
  };
}
