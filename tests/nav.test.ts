// Navigation (src/game/nav.ts, ADR 0020): the browser history mirrors the
// stack of open layers, Back closes the top one, a guarded layer refuses,
// and nothing here needs a window. The fake history below behaves like
// the browser's: pushState truncates the entries ahead, and go() is a
// traversal that lands later, as a popstate, when the test flushes it.

import { describe, expect, it } from 'vitest';
import { createNav, type HistoryLike, type Nav, sectionFromHash } from '../src/game/nav';

class FakeHistory implements HistoryLike {
  entries: { state: unknown; url: string }[] = [{ state: null, url: '/' }];
  index = 0;
  pending: number[] = [];
  // Set when a traversal went past the first entry: the site was left.
  left = false;

  get url(): string {
    return this.entries[this.index]!.url;
  }
  // The depths of the entries up to the current one; what lies ahead of it
  // is dead until a push truncates it, as in a browser.
  get depths(): number[] {
    return this.entries
      .slice(0, this.index + 1)
      .map((e) => (e.state as { loc?: number } | null)?.loc ?? -1);
  }
  pushState(state: unknown, _unused: string, url?: string): void {
    this.entries.splice(this.index + 1);
    this.entries.push({ state, url: url ?? this.url });
    this.index++;
  }
  replaceState(state: unknown, _unused: string, url?: string): void {
    this.entries[this.index] = { state, url: url ?? this.url };
  }
  go(delta: number): void {
    this.pending.push(delta);
  }
  // The browser runs each traversal as its own task and reports where it
  // landed; a press of Back is one more traversal in the same queue.
  flush(nav: Nav): void {
    while (this.pending.length > 0) {
      const to = this.index + this.pending.shift()!;
      if (to < 0) {
        this.left = true;
        this.pending.length = 0;
        return;
      }
      this.index = Math.min(to, this.entries.length - 1);
      nav.onPopState(this.entries[this.index]!.state);
    }
  }
  back(nav: Nav): void {
    this.go(-1);
    this.flush(nav);
  }
  forward(nav: Nav): void {
    this.go(1);
    this.flush(nav);
  }
}

function setup(): { h: FakeHistory; nav: Nav; guards: boolean[] } {
  const h = new FakeHistory();
  const guards: boolean[] = [];
  const nav = createNav(h, {
    urlFor: (hash) => (hash ? `/#${hash}` : '/'),
    onGuardChange: (g) => guards.push(g),
  });
  return { h, nav, guards };
}

describe('the layer stack in the history', () => {
  it('marks the root and gives each layer one entry above it', () => {
    const { h, nav } = setup();
    expect(h.depths).toEqual([0]);
    nav.push('ladder', () => {}, 'ladder');
    expect(nav.depth()).toBe(1);
    expect(h.depths).toEqual([0, 1]);
    expect(h.url).toBe('/#ladder');
    nav.push('bot', () => {});
    expect(h.depths).toEqual([0, 1, 2]);
    // No address of its own: it keeps the one it was opened on.
    expect(h.url).toBe('/');
  });

  it('closes the top layer on Back and nothing else', () => {
    const { h, nav } = setup();
    const closed: string[] = [];
    nav.push('ladder', () => closed.push('ladder'), 'ladder');
    nav.push('bot', () => closed.push('bot'));
    h.back(nav);
    expect(closed).toEqual(['bot']);
    expect(nav.depth()).toBe(1);
    expect(h.url).toBe('/#ladder');
    h.back(nav);
    expect(closed).toEqual(['bot', 'ladder']);
    expect(nav.depth()).toBe(0);
    expect(h.left).toBe(false);
  });

  it('lets Back leave the site from the root, where there is nothing to close', () => {
    const { h, nav } = setup();
    h.back(nav);
    expect(h.left).toBe(true);
  });

  it('walks the history back when a layer closes on its own, without closing it twice', () => {
    const { h, nav } = setup();
    let closes = 0;
    const frame = nav.push('ladder', () => closes++, 'ladder');
    frame.closed();
    expect(nav.depth()).toBe(0);
    // The traversal is asked for, and lands as a pop the nav recognises.
    expect(h.pending).toEqual([-1]);
    h.flush(nav);
    expect(h.index).toBe(0);
    expect(closes).toBe(0);
    // Saying so twice is harmless.
    frame.closed();
    expect(h.pending).toEqual([]);
  });

  it('takes the layers above a closing one down with it, top first', () => {
    const { h, nav } = setup();
    const closed: string[] = [];
    const ladder = nav.push('ladder', () => closed.push('ladder'), 'ladder');
    nav.push('bot', () => closed.push('bot'));
    nav.push('drawer', () => closed.push('drawer'));
    ladder.closed();
    expect(closed).toEqual(['drawer', 'bot']);
    expect(nav.depth()).toBe(0);
    expect(h.pending).toEqual([-3]);
    h.flush(nav);
    expect(h.index).toBe(0);
  });

  it('holds a push until the traversal it asked for has landed', () => {
    const { h, nav } = setup();
    const closed: string[] = [];
    const ladder = nav.push('ladder', () => closed.push('ladder'), 'ladder');
    // The home switching sections the slow way: close one, open the next
    // before the browser has moved. The push must not land ahead of it.
    ladder.closed();
    nav.push('academy', () => closed.push('academy'), 'academy');
    expect(h.depths).toEqual([0, 1]);
    expect(h.url).toBe('/#ladder');
    h.flush(nav);
    expect(h.depths).toEqual([0, 1]);
    expect(h.url).toBe('/#academy');
    expect(h.index).toBe(1);
    expect(closed).toEqual([]);
    expect(nav.depth()).toBe(1);
    // And Back now closes the academy, as if nothing had happened in between.
    h.back(nav);
    expect(closed).toEqual(['academy']);
    expect(h.index).toBe(0);
  });

  it('swaps one section for the next in the same entry', () => {
    const { h, nav } = setup();
    const closed: string[] = [];
    const ladder = nav.push('ladder', () => closed.push('ladder'), 'ladder');
    nav.replace(ladder, 'academy', () => closed.push('academy'), 'academy');
    expect(closed).toEqual(['ladder']);
    expect(h.depths).toEqual([0, 1]);
    expect(h.url).toBe('/#academy');
    expect(h.pending).toEqual([]);
    h.back(nav);
    expect(closed).toEqual(['ladder', 'academy']);
    expect(h.index).toBe(0);
  });

  it('replaces from the swapped layer down, whatever sits above it', () => {
    const { h, nav } = setup();
    const closed: string[] = [];
    const ladder = nav.push('ladder', () => closed.push('ladder'), 'ladder');
    nav.push('bot', () => closed.push('bot'));
    nav.replace(ladder, 'academy', () => closed.push('academy'), 'academy');
    expect(closed).toEqual(['bot', 'ladder']);
    expect(nav.depth()).toBe(1);
    h.flush(nav);
    expect(h.depths).toEqual([0, 1]);
    expect(h.url).toBe('/#academy');
  });

  it('pushes when the layer to replace is not open', () => {
    const { h, nav } = setup();
    const ladder = nav.push('ladder', () => {}, 'ladder');
    ladder.closed();
    h.flush(nav);
    nav.replace(ladder, 'academy', () => {}, 'academy');
    expect(h.depths).toEqual([0, 1]);
    expect(h.url).toBe('/#academy');
  });

  it('closes every layer above a jump down the history, top first', () => {
    const { h, nav } = setup();
    const closed: string[] = [];
    nav.push('a', () => closed.push('a'));
    nav.push('b', () => closed.push('b'));
    nav.push('c', () => closed.push('c'));
    // The history menu, straight to the root.
    h.go(-3);
    h.flush(nav);
    expect(closed).toEqual(['c', 'b', 'a']);
    expect(nav.depth()).toBe(0);
    expect(h.index).toBe(0);
  });

  it('snaps back out of a dead entry ahead instead of showing nothing', () => {
    const { h, nav } = setup();
    let closes = 0;
    nav.push('ladder', () => closes++, 'ladder');
    h.back(nav);
    expect(closes).toBe(1);
    h.forward(nav);
    expect(h.index).toBe(0);
    expect(nav.depth()).toBe(0);
    expect(closes).toBe(1);
    expect(h.left).toBe(false);
  });

  it('reads any state that is not its own as the root', () => {
    const { nav } = setup();
    let closes = 0;
    nav.push('a', () => closes++);
    nav.onPopState(undefined);
    expect(closes).toBe(1);
    nav.push('b', () => closes++);
    nav.onPopState({ something: 'else' });
    expect(closes).toBe(2);
    nav.push('c', () => closes++);
    nav.onPopState({ loc: -2 });
    expect(closes).toBe(3);
  });
});

describe('a guarded layer', () => {
  it('refuses Back: it stays, its entry is put back, and it is told', () => {
    const { h, nav } = setup();
    let closes = 0;
    let told = 0;
    const match = nav.push('match', () => closes++);
    match.guard(() => told++);
    h.back(nav);
    expect(closes).toBe(0);
    expect(told).toBe(1);
    expect(nav.depth()).toBe(1);
    expect(h.depths).toEqual([0, 1]);
    expect(h.index).toBe(1);
    expect(h.left).toBe(false);
    // Again, for as long as it is guarded.
    h.back(nav);
    expect(told).toBe(2);
    expect(h.index).toBe(1);
  });

  it('lets the layers above it close, then holds', () => {
    const { h, nav } = setup();
    const closed: string[] = [];
    let told = 0;
    const match = nav.push('match', () => closed.push('match'));
    match.guard(() => told++);
    nav.push('notice', () => closed.push('notice'));
    h.back(nav);
    expect(closed).toEqual(['notice']);
    expect(told).toBe(0);
    expect(h.depths).toEqual([0, 1]);
    // A jump over both: the notice goes, the match stays and is told.
    nav.push('notice', () => closed.push('notice'));
    h.go(-2);
    h.flush(nav);
    expect(closed).toEqual(['notice', 'notice']);
    expect(told).toBe(1);
    expect(nav.depth()).toBe(1);
    expect(h.depths).toEqual([0, 1]);
    expect(h.index).toBe(1);
  });

  it('closes like any other once the guard is lifted', () => {
    const { h, nav } = setup();
    let closes = 0;
    const match = nav.push('match', () => closes++);
    match.guard(() => {});
    match.unguard();
    h.back(nav);
    expect(closes).toBe(1);
    expect(nav.depth()).toBe(0);
  });

  it('can still be closed by the app while guarded', () => {
    const { h, nav, guards } = setup();
    const match = nav.push('match', () => {});
    match.guard(() => {});
    match.closed();
    expect(nav.depth()).toBe(0);
    h.flush(nav);
    expect(h.index).toBe(0);
    expect(guards).toEqual([true, false]);
  });

  it('reports the first guard raised and the last one lowered, once each', () => {
    const { nav, guards } = setup();
    const a = nav.push('a', () => {});
    const b = nav.push('b', () => {});
    a.guard(() => {});
    b.guard(() => {});
    expect(nav.guarded()).toBe(true);
    b.unguard();
    expect(guards).toEqual([true]);
    a.unguard();
    expect(guards).toEqual([true, false]);
    expect(nav.guarded()).toBe(false);
  });
});

describe('the address of a section', () => {
  const KEYS = ['ladder', 'academy'];
  it('names a section, with or without the hash mark', () => {
    expect(sectionFromHash('#ladder', KEYS)).toBe('ladder');
    expect(sectionFromHash('academy', KEYS)).toBe('academy');
  });
  it('is the home itself for anything else', () => {
    expect(sectionFromHash('', KEYS)).toBeNull();
    expect(sectionFromHash('#', KEYS)).toBeNull();
    expect(sectionFromHash('#forge', KEYS)).toBeNull();
    expect(sectionFromHash('#ladder/x', KEYS)).toBeNull();
  });
});
