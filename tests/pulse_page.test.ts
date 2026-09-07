// The page exists so a person can act on the counters, so what is pinned
// here is the arithmetic they would act on and the one case that reads as
// a lie: a rate with nothing under it.

import { describe, expect, it } from 'vitest';
import { emptyDay, emptySources } from '../server/pulse';
import { funnelStrip, rate, renderPulsePage, sourceStrip, total } from '../server/pulse_page';

const day = (d: string, over: Partial<ReturnType<typeof emptyDay>>) => ({
  ...emptyDay(d),
  ...over,
});

describe('a rate', () => {
  it('rounds to a whole percent', () => {
    expect(rate(1, 3)).toBe('33%');
    expect(rate(2, 3)).toBe('67%');
    expect(rate(5, 5)).toBe('100%');
  });

  it('is a dash when nothing happened, never zero', () => {
    // The first hour of a launch divides by zero constantly, and "0%"
    // there reads as a front page that is failing rather than as one
    // nobody has reached yet.
    expect(rate(0, 0)).toBe('-');
    expect(rate(3, 0)).toBe('-');
  });
});

describe('the totals', () => {
  it('add every counter across the days given', () => {
    const days = [
      day('2026-09-06', {
        loads: 10,
        strays: 4,
        visitors: 6,
        newcomers: 5,
        sources: { ...emptySources(), reddit: 4, direct: 2 },
        stayed: 4,
        played: 2,
        accounts: 2,
        matches: 3,
        finished: 2,
        restarts: 1,
      }),
      day('2026-09-07', {
        loads: 4,
        strays: 1,
        visitors: 3,
        newcomers: 1,
        sources: { ...emptySources(), reddit: 1, discord: 2 },
        stayed: 2,
        played: 1,
        accounts: 1,
        matches: 1,
        finished: 0,
        restarts: 2,
      }),
    ];
    expect(total(days)).toEqual({
      loads: 14,
      strays: 5,
      visitors: 9,
      newcomers: 6,
      sources: { ...emptySources(), reddit: 5, discord: 2, direct: 2 },
      stayed: 6,
      played: 3,
      accounts: 3,
      matches: 4,
      finished: 2,
      restarts: 3,
    });
  });

  it('are zero for no days at all', () => {
    expect(total([])).toEqual({
      loads: 0,
      strays: 0,
      visitors: 0,
      newcomers: 0,
      sources: emptySources(),
      stayed: 0,
      played: 0,
      accounts: 0,
      matches: 0,
      finished: 0,
      restarts: 0,
    });
  });
});

describe('the page', () => {
  const days = [
    day('2026-09-05', {
      loads: 8,
      strays: 3,
      visitors: 4,
      newcomers: 1,
      sources: { ...emptySources(), direct: 4 },
      stayed: 2,
      played: 1,
      accounts: 1,
      matches: 1,
      finished: 1,
      restarts: 1,
    }),
    day('2026-09-06', {
      loads: 30,
      strays: 12,
      visitors: 20,
      newcomers: 14,
      sources: { ...emptySources(), discord: 12, reddit: 6, other: 2 },
      stayed: 10,
      played: 5,
      accounts: 5,
      matches: 6,
      finished: 4,
      restarts: 1,
    }),
  ];

  it('leads with the day being lived', () => {
    const html = renderPulsePage(days);
    expect(html.indexOf('2026-09-06')).toBeLessThan(html.indexOf('2026-09-05'));
  });

  it('shows the sign-up rate over the whole week, not the last day', () => {
    // 6 accounts from 24 visitors across both days.
    expect(renderPulsePage(days)).toContain('<b>25%</b>');
  });

  it('renders with no days at all', () => {
    // The first boot after a deploy: the page must not throw and must not
    // claim a rate it cannot have.
    const html = renderPulsePage([]);
    expect(html).toContain('<b>-</b>');
    expect(html).toContain('Pulse');
  });

  it('says what the two columns are, since they never agree', () => {
    // Loads is always the bigger number and the reader will ask why. The
    // page has to answer it in place: a foot note is cheaper than a
    // maintainer deciding the counter is broken.
    const html = renderPulsePage(days);
    expect(html).toContain('reload');
    expect(html).toContain('once a day');
  });

  it('shows the scanners apart from the pages, since the sum is meaningless', () => {
    // 30 loads of which 12 were paths this site does not have: the row
    // must read 18, or the reader goes on believing 30 people came.
    const html = renderPulsePage(days);
    expect(html).toContain('>18<');
    expect(html).toContain('>12<');
  });

  it('says where the week came from, biggest first', () => {
    // The one line that decides what to do next: 18 from Discord and 6
    // from Reddit is an announcement that landed, and the same twenty-four
    // visitors with nothing beside them is not readable at all.
    const html = renderPulsePage(days);
    const strip = html.slice(html.indexOf('Came from'), html.indexOf('<div class="wrap"'));
    expect(strip).toContain('discord');
    expect(strip.indexOf('discord')).toBeLessThan(strip.indexOf('reddit'));
    expect(strip.indexOf('reddit')).toBeLessThan(strip.indexOf('direct'));
  });

  it('says so in words when nobody came, rather than showing an empty line', () => {
    expect(sourceStrip(total([]))).toContain('No visitor counted');
  });

  it('leaves out the buckets that nothing landed in', () => {
    // Nine names of which seven are zero is a shape that hides the two
    // that are not.
    const strip = sourceStrip(total(days));
    expect(strip).not.toContain('youtube');
    expect(strip).not.toContain('hn');
  });

  it('says how far the visitors of the week got', () => {
    // 12 of 24 stayed and 6 of 24 played: the shape of the drop, which is
    // what the counters could not show while they were independent.
    const html = renderPulsePage(days);
    expect(html).toContain('<b>50%</b> stayed');
    expect(html).toContain('<b>25%</b> played a match');
  });

  it('says nothing about a funnel with nobody in it', () => {
    // The strip above already reports the empty week; twice is noise.
    expect(funnelStrip(total([]))).toBe('');
  });

  it('escapes what it prints', () => {
    // The days come off disk, and the read validates their shape today.
    // A page that trusts that forever is a page that breaks the day the
    // validation is relaxed.
    const html = renderPulsePage([day('<script>x</script>', {})]);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('tells a reader nothing about any person', () => {
    // The whole promise, held at the last place the numbers pass through.
    const html = renderPulsePage(days);
    expect(html).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
    expect(html.toLowerCase()).not.toMatch(/\bip\b|\baddress\b|\bvisitor id\b/);
  });
});
