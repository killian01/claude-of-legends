// The client half of the visitor count (src/net/pulse_ping.ts). One rule
// carries the whole feature: a browser says hello once a day and never
// twice, whatever happens to its storage. The old counter got this wrong
// by asking the network instead, and turned one person reloading into
// twenty arrivals.

import { describe, expect, it } from 'vitest';
import { type DayStore, firstLoadToday, utcDay, VISIT_KEY } from '../src/net/pulse_ping';

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
    expect(firstLoadToday(store, '2026-09-06')).toBe(true);
    expect(firstLoadToday(store, '2026-09-06')).toBe(false);
    expect(firstLoadToday(store, '2026-09-06')).toBe(false);
  });

  it('comes round again tomorrow', () => {
    const store = memory('2026-09-06');
    expect(firstLoadToday(store, '2026-09-06')).toBe(false);
    expect(firstLoadToday(store, '2026-09-07')).toBe(true);
    expect(store.value).toBe('2026-09-07');
  });

  it('claims the day before saying anything, never after', () => {
    // Storage is what makes the ping happen once. If the claim came after
    // the ping, a page closed in between would ping again on the next
    // load, which is the bug this whole file exists to remove.
    const store = memory();
    firstLoadToday(store, '2026-09-06');
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
    expect(firstLoadToday(denied, '2026-09-06')).toBe(false);
    const readOnly: DayStore = {
      read: () => null,
      write() {
        throw new Error('full');
      },
    };
    expect(firstLoadToday(readOnly, '2026-09-06')).toBe(false);
  });

  it('writes one date under one key, and nothing else', () => {
    // What PRIVACY.md promises is in the browser: a date, not an id. If
    // this ever stores something per person, the page stops being true.
    const store = memory();
    firstLoadToday(store, '2026-09-06');
    expect(store.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(VISIT_KEY).toBe('col.visit');
  });
});
