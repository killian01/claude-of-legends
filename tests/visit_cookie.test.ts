// The visit cookie (server/visit_cookie.ts): the one thing that tells a
// browser coming back from one arriving for the first time, and the
// opt-out that rides in the same place.

import { describe, expect, it } from 'vitest';
import {
  isVisitId,
  nextVisit,
  VISIT_COOKIE,
  VISIT_MAX_AGE_S,
  VISIT_META,
  VISIT_OFF,
  visitChoice,
  visitIdOf,
  visitTag,
  withVisitTag,
} from '../server/visit_cookie';
import { CHOICE_PARAM, visitIdFrom } from '../src/net/stats';

const ID = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);
const mint = (): string => OTHER;

describe('what the browser should end up holding', () => {
  it('mints one for a browser that has none', () => {
    expect(nextVisit(undefined, null, mint)).toEqual({ kind: 'set', value: OTHER });
    expect(nextVisit('', null, mint)).toEqual({ kind: 'set', value: OTHER });
  });

  it('leaves a browser that already has one alone', () => {
    expect(nextVisit(ID, null, mint)).toEqual({ kind: 'keep', value: ID });
  });

  it('replaces anything that is not one of ours', () => {
    expect(nextVisit('not-an-id', null, mint)).toEqual({ kind: 'set', value: OTHER });
    expect(nextVisit('A'.repeat(32), null, mint)).toEqual({ kind: 'set', value: OTHER });
    expect(nextVisit('a'.repeat(31), null, mint)).toEqual({ kind: 'set', value: OTHER });
  });

  it('carries the opt-out in the same place, and holds it', () => {
    expect(nextVisit(ID, 'off', mint)).toEqual({ kind: 'set', value: VISIT_OFF });
    expect(nextVisit(VISIT_OFF, null, mint)).toEqual({ kind: 'keep', value: VISIT_OFF });
    // Asking out and never coming back must not quietly mint a new id on
    // the next page load, which is what a plain "no cookie" would do.
    expect(visitIdOf(nextVisit(VISIT_OFF, null, mint))).toBeNull();
  });

  it('gives a fresh id to a browser that asks back in', () => {
    expect(nextVisit(VISIT_OFF, 'on', mint)).toEqual({ kind: 'set', value: OTHER });
    expect(nextVisit(ID, 'on', mint)).toEqual({ kind: 'set', value: OTHER });
  });

  it('reads the choice off the address, the way the counter does', () => {
    expect(visitChoice(`?${CHOICE_PARAM}=off`)).toBe('off');
    expect(visitChoice(`?${CHOICE_PARAM}=on`)).toBe('on');
    expect(visitChoice(`?${CHOICE_PARAM}=maybe`)).toBeNull();
    expect(visitChoice('')).toBeNull();
    expect(visitChoice('?join=ABCDE')).toBeNull();
  });

  it('is an id, or it is nothing', () => {
    expect(isVisitId(ID)).toBe(true);
    expect(isVisitId(VISIT_OFF)).toBe(false);
    expect(isVisitId(undefined)).toBe(false);
    expect(visitIdOf({ kind: 'set', value: VISIT_OFF })).toBeNull();
    expect(visitIdOf({ kind: 'clear' })).toBeNull();
    expect(visitIdOf({ kind: 'keep', value: ID })).toBe(ID);
  });
});

describe('the life of it', () => {
  it('is thirteen months, the ceiling an audience measure may keep', () => {
    const months = VISIT_MAX_AGE_S / (30 * 24 * 3600);
    expect(months).toBe(13);
  });

  it('is named the same in the cookie and on the page', () => {
    expect(VISIT_COOKIE).toBe('col_visit');
    expect(VISIT_META).toBe('visit');
  });
});

describe('the id on the page', () => {
  it('is written into the head, and read back from it', () => {
    const html = withVisitTag('<html><head><title>x</title></head><body></body></html>', ID);
    expect(html).toContain(visitTag(ID));
    const doc = {
      querySelector: (sel: string) =>
        sel === `meta[name="${VISIT_META}"]` ? { getAttribute: () => ID } : null,
    } as unknown as Document;
    expect(visitIdFrom(doc)).toBe(ID);
  });

  it('writes nothing for a browser that asked out, or a page with no head', () => {
    const page = '<html><head></head><body></body></html>';
    expect(withVisitTag(page, null)).toBe(page);
    expect(withVisitTag(page, VISIT_OFF)).toBe(page);
    expect(withVisitTag('<body>no head</body>', ID)).toBe('<body>no head</body>');
  });

  it('reads nothing off a page that carries no id, or a junk one', () => {
    const empty = { querySelector: () => null } as unknown as Document;
    expect(visitIdFrom(empty)).toBeNull();
    const junk = {
      querySelector: () => ({ getAttribute: () => 'not-an-id' }),
    } as unknown as Document;
    expect(visitIdFrom(junk)).toBeNull();
  });
});
