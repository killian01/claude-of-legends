// The one line a browser stores (src/net/visit_line.ts). PRIVACY.md
// promises exactly one, so everything the client needs to remember has to
// fit in it, and nothing that fits in it may be able to name a person.

import { describe, expect, it } from 'vitest';
import {
  formatLine,
  isVisitStep,
  OPT_OUT,
  parseLine,
  VISIT_STEPS,
  withStep,
} from '../src/net/visit_line';

describe('reading the line', () => {
  it('reads a bare date, which is what every browser here already holds', () => {
    // The format before the paces existed. A browser that has not
    // reloaded since must keep working exactly as it did.
    expect(parseLine('2026-09-06')).toEqual({ day: '2026-09-06', steps: [] });
  });

  it('reads the paces reported on the day', () => {
    expect(parseLine('2026-09-06 stayed played')).toEqual({
      day: '2026-09-06',
      steps: ['stayed', 'played'],
    });
  });

  it('reads the browser that asked to be left out', () => {
    expect(parseLine(OPT_OUT)).toBe(OPT_OUT);
  });

  it('reads nothing at all as nothing at all', () => {
    // Which is what makes the next arrival a newcomer.
    expect(parseLine(null)).toBeNull();
  });

  it('drops a word it does not know rather than carrying it', () => {
    // A line written by a build that knew a third pace must not grow
    // forever in a browser that does not.
    expect(parseLine('2026-09-06 stayed danced')).toEqual({
      day: '2026-09-06',
      steps: ['stayed'],
    });
  });

  it('refuses a shape that is not a date, rather than repairing it', () => {
    expect(parseLine('today')).toBeNull();
    expect(parseLine('')).toBeNull();
    expect(parseLine('2026-9-6')).toBeNull();
  });
});

describe('writing the line', () => {
  it('round trips', () => {
    const line = { day: '2026-09-06', steps: ['stayed'] as const };
    expect(parseLine(formatLine(line))).toEqual(line);
  });

  it('is a date and at most two known words, and never anything else', () => {
    // The whole privacy claim in one assertion: what a browser holds is
    // the same string as every other browser that did the same things
    // today.
    const full = formatLine({ day: '2026-09-06', steps: [...VISIT_STEPS] });
    expect(full).toBe('2026-09-06 stayed played');
    expect(full.length).toBeLessThan(32);
  });

  it('adds a pace once and then has nothing more to say', () => {
    const first = withStep({ day: '2026-09-06', steps: [] }, 'stayed');
    expect(first).toEqual({ day: '2026-09-06', steps: ['stayed'] });
    expect(withStep(first ?? { day: '', steps: [] }, 'stayed')).toBeNull();
  });
});

describe('the word that arrives over the wire', () => {
  it('is refused unless it is a pace this build knows', () => {
    expect(isVisitStep('stayed')).toBe(true);
    expect(isVisitStep('played')).toBe(true);
    expect(isVisitStep('Played')).toBe(false);
    expect(isVisitStep('toString')).toBe(false);
    expect(isVisitStep('')).toBe(false);
  });
});
