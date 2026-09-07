// The client half of the visitor count (src/net/pulse_ping.ts). Two rules
// carry the whole feature: a browser says hello once a day and never
// twice, whatever happens to its storage, and it says whether it had ever
// said hello before. The old counter got the first wrong by asking the
// network instead, and turned one person reloading into twenty arrivals;
// without the second, three visitors and one contributor with three
// machines are the same row.

import { describe, expect, it } from 'vitest';
import {
  applyChoice,
  type DayStore,
  OPT_OUT,
  pingUrl,
  pulseChoice,
  utcDay,
  VISIT_KEY,
  VISIT_URL,
  visitToday,
} from '../src/net/pulse_ping';

// A store that behaves, and one that throws where a real browser throws:
// storage denied to a page, or full.
function memory(seed: string | null = null): DayStore & { value: string | null } {
  return {
    value: seed,
    read() {
      return this.value;
    },
    write(day: string) {
      this.value = day;
    },
  };
}

describe('the day the client picks', () => {
  it('is the UTC day, the one the server files under', () => {
    // Both sides spell it the same way or a browser in Los Angeles pings
    // twice at its own midnight and once again at the server's.
    expect(utcDay(Date.parse('2026-09-06T22:30:00Z'))).toBe('2026-09-06');
    expect(utcDay(Date.parse('2026-09-07T00:00:01Z'))).toBe('2026-09-07');
  });
});

describe('the first load of the day', () => {
  it('is the first one only', () => {
    const store = memory();
    expect(visitToday(store, '2026-09-06')).not.toBeNull();
    expect(visitToday(store, '2026-09-06')).toBeNull();
    expect(visitToday(store, '2026-09-06')).toBeNull();
  });

  it('comes round again tomorrow', () => {
    const store = memory('2026-09-06');
    expect(visitToday(store, '2026-09-06')).toBeNull();
    expect(visitToday(store, '2026-09-07')).not.toBeNull();
    expect(store.value).toBe('2026-09-07');
  });

  it('claims the day before saying anything, never after', () => {
    // Storage is what makes the ping happen once. If the claim came after
    // the ping, a page closed in between would ping again on the next
    // load, which is the bug this whole file exists to remove.
    const store = memory();
    visitToday(store, '2026-09-06');
    expect(store.value).toBe('2026-09-06');
  });

  it('stays quiet when the browser will not let it remember', () => {
    // Private windows and pages with storage denied. Without a place to
    // write the date there is no way to ping once, so it does not ping at
    // all: one visitor missing beats one visitor per reload.
    const denied: DayStore = {
      read() {
        throw new Error('denied');
      },
      write() {
        throw new Error('denied');
      },
    };
    expect(visitToday(denied, '2026-09-06')).toBeNull();
    const readOnly: DayStore = {
      read: () => null,
      write() {
        throw new Error('full');
      },
    };
    expect(visitToday(readOnly, '2026-09-06')).toBeNull();
  });

  it('writes one date under one key, and nothing else', () => {
    // What PRIVACY.md promises is in the browser: a date, not an id. If
    // this ever stores something per person, the page stops being true.
    const store = memory();
    visitToday(store, '2026-09-06');
    expect(store.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(VISIT_KEY).toBe('col.visit');
  });
});

describe('the one bit the ping carries', () => {
  it('is set for a browser that has nothing stored', () => {
    expect(visitToday(memory(), '2026-09-06')).toEqual({ newcomer: true });
  });

  it('is clear for a browser that was here on an earlier day', () => {
    // The whole question this answers: three visitors who have all been
    // here before are somebody's habit, not somebody's launch.
    expect(visitToday(memory('2026-08-30'), '2026-09-06')).toEqual({ newcomer: false });
  });

  it('is derived from the date already stored, and needs nothing more', () => {
    // Nothing is added to storage to answer it. A browser is new when the
    // key is empty, which is the same one line PRIVACY.md already names.
    const store = memory();
    visitToday(store, '2026-09-06');
    expect(store.value).toBe('2026-09-06');
    expect(visitToday(store, '2026-09-07')).toEqual({ newcomer: false });
  });
});

describe('the request itself', () => {
  it('carries the two flags and nothing else', () => {
    expect(pingUrl({ newcomer: true }, 'reddit')).toBe(`${VISIT_URL}?from=reddit&new=1`);
    expect(pingUrl({ newcomer: false }, 'direct')).toBe(`${VISIT_URL}?from=direct`);
  });

  it('sends a word and never a link', () => {
    // The referrer is read in the browser and reduced there
    // (src/net/pulse_source.ts). What leaves the machine is the name of a
    // bucket, which is what makes PRIVACY.md's paragraph true.
    const url = pingUrl({ newcomer: true }, 'other');
    expect(url).not.toContain('http%3A');
    expect(url).not.toContain('https');
    expect(url).toContain('from=other');
  });
});

describe('the browser that asked to be left out', () => {
  it('is recognised in the address bar and nowhere else', () => {
    expect(pulseChoice('?pulse=off')).toBe('off');
    expect(pulseChoice('?join=ABCD&pulse=on')).toBe('on');
    expect(pulseChoice('')).toBeNull();
    expect(pulseChoice('?pulse=maybe')).toBeNull();
    expect(pulseChoice('?join=ABCD')).toBeNull();
  });

  it('never counts again, however many days pass', () => {
    // The maintainer's own browser is otherwise a stranger's, and on a day
    // with three visitors that is the difference between a launch and a
    // habit.
    const store = memory('2026-09-05');
    expect(applyChoice(store, 'off', '2026-09-06')).toBe(false);
    expect(store.value).toBe(OPT_OUT);
    expect(visitToday(store, '2026-09-06')).toBeNull();
    expect(visitToday(store, '2027-01-01')).toBeNull();
  });

  it('comes back as a browser that has been here before, not as a new one', () => {
    // Turning it back on writes today rather than clearing the key: the
    // count resumes tomorrow, and this browser is not new, because it is
    // not.
    const store = memory(OPT_OUT);
    expect(applyChoice(store, 'on', '2026-09-06')).toBe(false);
    expect(store.value).toBe('2026-09-06');
    expect(visitToday(store, '2026-09-07')).toEqual({ newcomer: false });
  });

  it('is left alone by a load that asked for nothing', () => {
    const store = memory('2026-09-05');
    expect(applyChoice(store, null, '2026-09-06')).toBe(true);
    expect(store.value).toBe('2026-09-05');
  });

  it('does not break a browser that cannot remember the choice', () => {
    const denied: DayStore = {
      read: () => null,
      write() {
        throw new Error('denied');
      },
    };
    expect(applyChoice(denied, 'off', '2026-09-06')).toBe(false);
  });
});
