// What the client adds to the audience counter (src/net/stats.ts): the
// opt-out, what an address is reduced to before it leaves, and the events.

import { describe, expect, it, vi } from 'vitest';
import {
  applyChoice,
  BEFORE_SEND_NAME,
  beforeSend,
  DISABLED_KEY,
  forgetOldLine,
  installStats,
  MATCH_ENDS,
  type MatchState,
  matchEndEvent,
  matchEndReporter,
  OLD_VISIT_KEY,
  type ReporterWindow,
  STATS_STEPS,
  type StatsStore,
  type StatsWindow,
  scrubUrl,
  statsChoice,
  trackStep,
} from '../src/net/stats';

function memory(seed: Record<string, string> = {}): StatsStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    read: (k) => data.get(k) ?? null,
    write: (k, v) => {
      data.set(k, v);
    },
    remove: (k) => {
      data.delete(k);
    },
  };
}

describe('the opt-out', () => {
  it('is read off the query and nothing else', () => {
    expect(statsChoice('?stats=off')).toBe('off');
    expect(statsChoice('?a=1&stats=on')).toBe('on');
    expect(statsChoice('?stats=maybe')).toBeNull();
    expect(statsChoice('')).toBeNull();
    expect(statsChoice('?pulse=off')).toBeNull();
  });

  it("writes the tracker's own key, and removes it on the way back", () => {
    const store = memory();
    applyChoice(store, 'off');
    expect(store.read(DISABLED_KEY)).toBe('1');
    applyChoice(store, null);
    expect(store.read(DISABLED_KEY)).toBe('1');
    applyChoice(store, 'on');
    expect(store.read(DISABLED_KEY)).toBeNull();
  });

  it('survives a store that throws', () => {
    const broken: StatsStore = {
      read: () => {
        throw new Error('denied');
      },
      write: () => {
        throw new Error('denied');
      },
      remove: () => {
        throw new Error('denied');
      },
    };
    expect(() => applyChoice(broken, 'off')).not.toThrow();
    expect(() => forgetOldLine(broken)).not.toThrow();
  });
});

describe("the previous counter's line", () => {
  it('is removed on sight', () => {
    const store = memory({ [OLD_VISIT_KEY]: '2026-09-07 stayed played' });
    forgetOldLine(store);
    expect(store.read(OLD_VISIT_KEY)).toBeNull();
    expect(store.read(DISABLED_KEY)).toBeNull();
  });

  it('carries an opt-out across', () => {
    const store = memory({ [OLD_VISIT_KEY]: 'off' });
    forgetOldLine(store);
    expect(store.read(OLD_VISIT_KEY)).toBeNull();
    expect(store.read(DISABLED_KEY)).toBe('1');
  });

  it('writes nothing for a browser that never had one', () => {
    const store = memory();
    forgetOldLine(store);
    expect(store.data.size).toBe(0);
  });
});

describe('what an address is reduced to', () => {
  it('keeps the path and the section, drops the query', () => {
    expect(scrubUrl('https://claudeoflegends.com/?join=ABCD#ladder')).toBe(
      'https://claudeoflegends.com/#ladder',
    );
    expect(scrubUrl('https://claudeoflegends.com/?confirmed=1')).toBe(
      'https://claudeoflegends.com/',
    );
    expect(scrubUrl('https://claudeoflegends.com/?discord=created')).toBe(
      'https://claudeoflegends.com/',
    );
  });

  it("keeps an announcement's words and nothing beside them", () => {
    expect(
      scrubUrl('https://claudeoflegends.com/?utm_source=reddit&join=ABCD&utm_medium=post'),
    ).toBe('https://claudeoflegends.com/?utm_source=reddit&utm_medium=post');
  });

  it('treats a path like an address and leaves nonsense alone', () => {
    expect(scrubUrl('/?join=ABCD#news')).toBe('/#news');
    expect(scrubUrl('/#news')).toBe('/#news');
    expect(scrubUrl('')).toBe('');
    expect(scrubUrl('not an address')).toBe('not an address');
  });

  it('is applied to the address and the referrer before every send', () => {
    const out = beforeSend('event', {
      url: 'https://claudeoflegends.com/?join=ABCD',
      referrer: 'https://www.reddit.com/r/gamedev/comments/abc/x/?share_id=1',
      name: 'played',
      data: { k: 1 },
    });
    expect(out.url).toBe('https://claudeoflegends.com/');
    expect(out.referrer).toBe('https://www.reddit.com/r/gamedev/comments/abc/x/');
    expect(out.name).toBe('played');
    expect(out.data).toEqual({ k: 1 });
  });

  it('leaves a record with no address alone', () => {
    expect(beforeSend('identify', { id: 'x' })).toEqual({ id: 'x' });
  });
});

describe('the events', () => {
  it('name what the privacy page names', () => {
    expect([...STATS_STEPS]).toEqual(['stayed', 'played', 'offer', 'form', 'account']);
  });

  it('reach the tracker when there is one, and nobody otherwise', () => {
    const track = vi.fn();
    trackStep('played', { umami: { track } });
    expect(track).toHaveBeenCalledWith('played');
    expect(() => trackStep('played', {})).not.toThrow();
    expect(() =>
      trackStep('played', {
        umami: {
          track: () => {
            throw new Error('down');
          },
        },
      }),
    ).not.toThrow();
  });
});

describe('how a match ended', () => {
  it('is finished with a winner and left without one, in minutes, by mode', () => {
    expect(matchEndEvent(1, 25 * 60 + 20, 'practice')).toEqual({
      name: 'finished',
      data: { minutes: 25, mode: 'practice' },
    });
    expect(matchEndEvent(null, 95, 'online')).toEqual({
      name: 'left',
      data: { minutes: 2, mode: 'online' },
    });
    expect(matchEndEvent(null, 0, 'practice').data.minutes).toBe(0);
    expect(matchEndEvent(null, Number.NaN, 'practice').data.minutes).toBe(0);
    expect([...MATCH_ENDS]).toEqual(['finished', 'left']);
  });

  // A window with a tracker and the page's lifecycle events, both fakes.
  function fakeWindow(): ReporterWindow & { track: ReturnType<typeof vi.fn>; fire(): void } {
    const track = vi.fn();
    const listeners = new Map<string, () => void>();
    return {
      umami: { track },
      track,
      addEventListener: (type, listener) => {
        listeners.set(type, listener);
      },
      removeEventListener: (type) => {
        listeners.delete(type);
      },
      fire: () => listeners.get('pagehide')?.(),
    };
  }

  it('is said once, when the winner shows, and never again on the way out', () => {
    const win = fakeWindow();
    const state: MatchState = { winner: null, seconds: 0 };
    const ends = matchEndReporter('practice', () => state, win);
    state.winner = 1;
    state.seconds = 20 * 60;
    ends.report();
    // The exit, minutes later: the same match, already told.
    state.seconds = 23 * 60;
    ends.report();
    ends.dispose();
    win.fire();
    expect(win.track).toHaveBeenCalledTimes(1);
    expect(win.track).toHaveBeenCalledWith('finished', { minutes: 20, mode: 'practice' });
  });

  it('is left when the page goes away mid-match, with the clock as it stood', () => {
    const win = fakeWindow();
    const state: MatchState = { winner: null, seconds: 4 * 60 + 40 };
    matchEndReporter('online', () => state, win);
    win.fire();
    win.fire();
    expect(win.track).toHaveBeenCalledTimes(1);
    expect(win.track).toHaveBeenCalledWith('left', { minutes: 5, mode: 'online' });
  });

  it('stops listening once disposed, and still reports on the way out', () => {
    const win = fakeWindow();
    const state: MatchState = { winner: null, seconds: 90 };
    const ends = matchEndReporter('practice', () => state, win);
    ends.report();
    ends.dispose();
    win.fire();
    expect(win.track).toHaveBeenCalledTimes(1);
    expect(win.track).toHaveBeenCalledWith('left', { minutes: 2, mode: 'practice' });
  });

  it('asks nothing of a window with no tracker and no events', () => {
    const state: MatchState = { winner: 0, seconds: 600 };
    const ends = matchEndReporter('practice', () => state, {});
    expect(() => {
      ends.report();
      ends.dispose();
    }).not.toThrow();
  });
});

describe('the install', () => {
  it('drops the old line, applies the choice, and hangs the hook on the window', () => {
    const store = memory({ [OLD_VISIT_KEY]: '2026-09-07' });
    const win: StatsWindow = {};
    installStats(win, '?stats=off', store);
    expect(store.read(OLD_VISIT_KEY)).toBeNull();
    expect(store.read(DISABLED_KEY)).toBe('1');
    expect(win[BEFORE_SEND_NAME]).toBe(beforeSend);
  });
});
