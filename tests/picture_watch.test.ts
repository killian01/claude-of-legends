// A lost WebGL context and the way back (src/render/picture_watch.ts): the
// browser is asked for the context back, nothing is drawn until it is
// back with the terrain's pictures, a notice says so meanwhile, and a
// reload is offered when the picture does not come back.

import { describe, expect, it } from 'vitest';
import {
  type PictureNotice,
  pictureNotice,
  RELOAD_OFFER_MS,
  watchPicture,
} from '../src/render/picture_watch';

// A canvas, a clock, a timer and a restore that resolves when told.
function stage() {
  const canvas = new EventTarget();
  let clock = 1000;
  const timers: { at: number; run: () => void; live: boolean }[] = [];
  const shown: (PictureNotice | null)[] = [];
  const restores: { resolve: () => void; reject: () => void }[] = [];
  const watch = watchPicture(canvas, {
    restore: () =>
      new Promise<void>((resolve, reject) => {
        restores.push({ resolve, reject });
      }),
    show: (n) => shown.push(n),
    now: () => clock,
    later: (run, ms) => {
      const timer = { at: clock + ms, run, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
  });
  const lose = (): Event => {
    const event = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(event);
    return event;
  };
  const restore = (): void => {
    canvas.dispatchEvent(new Event('webglcontextrestored'));
  };
  const wait = (ms: number): void => {
    clock += ms;
    for (const t of timers) {
      if (t.live && t.at <= clock) {
        t.live = false;
        t.run();
      }
    }
  };
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
  return { watch, shown, restores, lose, restore, wait, settle };
}

describe('a lost picture', () => {
  it('asks the browser for the context back, and stops the drawing', () => {
    const s = stage();
    expect(s.watch.blocked()).toBe(false);
    const event = s.lose();
    expect(event.defaultPrevented).toBe(true);
    expect(s.watch.blocked()).toBe(true);
    expect(s.shown.at(-1)).toMatchObject({ title: 'Picture lost', reload: false });
  });

  it('offers a reload once it has been waited for long enough', () => {
    const s = stage();
    s.lose();
    s.wait(RELOAD_OFFER_MS - 1);
    expect(s.shown.at(-1)?.reload).toBe(false);
    s.wait(1);
    expect(s.shown.at(-1)?.reload).toBe(true);
  });

  it('draws again only once the terrain is back, and takes the notice down', async () => {
    const s = stage();
    s.lose();
    s.restore();
    expect(s.watch.state().kind).toBe('restoring');
    expect(s.watch.blocked()).toBe(true);
    expect(s.shown.at(-1)).toMatchObject({ reload: false });
    // The offer from the loss is off: the picture is on its way.
    s.wait(RELOAD_OFFER_MS);
    expect(s.shown.at(-1)?.reload).toBe(false);
    s.restores[0]!.resolve();
    await s.settle();
    expect(s.watch.blocked()).toBe(false);
    expect(s.shown.at(-1)).toBeNull();
  });

  it('stays down when it is lost again before the terrain is back', async () => {
    const s = stage();
    s.lose();
    s.restore();
    s.lose();
    s.restores[0]!.resolve();
    await s.settle();
    expect(s.watch.state().kind).toBe('lost');
    expect(s.watch.blocked()).toBe(true);
    // The next return is the one that counts.
    s.restore();
    s.restores[1]!.resolve();
    await s.settle();
    expect(s.watch.blocked()).toBe(false);
  });

  it('offers a reload when the terrain cannot be redrawn', async () => {
    const s = stage();
    s.lose();
    s.restore();
    s.restores[0]!.reject();
    await s.settle();
    expect(s.watch.state().kind).toBe('failed');
    expect(s.watch.blocked()).toBe(true);
    expect(s.shown.at(-1)).toMatchObject({ reload: true });
  });

  it('hears nothing more once the match is over', async () => {
    const s = stage();
    s.lose();
    s.restore();
    s.watch.dispose();
    s.restores[0]!.resolve();
    await s.settle();
    const count = s.shown.length;
    s.lose();
    s.restore();
    expect(s.shown).toHaveLength(count);
    expect(s.restores).toHaveLength(1);
  });
});

describe('the notice', () => {
  it('says nothing while the picture is shown', () => {
    expect(pictureNotice({ kind: 'shown' }, 0)).toBeNull();
  });

  it('waits before it offers a reload, and offers one when the redraw failed', () => {
    expect(pictureNotice({ kind: 'lost', since: 0 }, RELOAD_OFFER_MS - 1)?.reload).toBe(false);
    expect(pictureNotice({ kind: 'lost', since: 0 }, RELOAD_OFFER_MS)?.reload).toBe(true);
    expect(pictureNotice({ kind: 'restoring' }, 0)?.reload).toBe(false);
    expect(pictureNotice({ kind: 'failed' }, 0)?.reload).toBe(true);
  });
});
