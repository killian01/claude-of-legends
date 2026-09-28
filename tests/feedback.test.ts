// The feedback box, end to end and without a browser: what is worth
// sending (src/ui/feedback_box.ts), what the server takes and keeps
// (server/feedback.ts), and that nothing about who wrote it rides along.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FEEDBACK_MINUTES_MAX,
  FeedbackStore,
  formatFeedback,
  parseFeedback,
  readFeedbackLines,
} from '../server/feedback';
import {
  buildFeedback,
  cleanFeedback,
  FEEDBACK_ASK,
  FEEDBACK_CALL,
  FEEDBACK_MAX,
  FEEDBACK_ROUTE,
  type FeedbackContext,
  NUDGE_FROM,
  NUDGE_HOLD,
  NUDGE_START,
  nudgeCall,
  nudgeVisible,
  sendFeedback,
  stepNudge,
} from '../src/ui/feedback_box';

const context: FeedbackContext = {
  where: 'end',
  mode: 'practice',
  minutes: 12.4,
  finished: false,
  signedIn: false,
};

describe('what is worth sending', () => {
  it('keeps the words and trims the rest', () => {
    expect(cleanFeedback('  the bots are too strong  ')).toBe('the bots are too strong');
    expect(cleanFeedback('one\r\ntwo')).toBe('one\ntwo');
    expect(cleanFeedback('one\n\n\n\n\ntwo')).toBe('one\n\ntwo');
  });

  it('is nothing at all when nothing was typed', () => {
    expect(cleanFeedback('')).toBeNull();
    expect(cleanFeedback('   \n  \t ')).toBeNull();
    expect(buildFeedback('  ', context)).toBeNull();
  });

  it('drops the control characters a pasted line carries', () => {
    expect(cleanFeedback('a\u0000b\u001bc')).toBe('abc');
    // A newline and a tab are typing, not control noise.
    expect(cleanFeedback('a\nb\tc')).toBe('a\nb\tc');
  });

  it('caps the length rather than refusing a long one', () => {
    const long = 'x'.repeat(FEEDBACK_MAX + 500);
    expect(cleanFeedback(long)?.length).toBe(FEEDBACK_MAX);
  });

  it('carries the match it was written in, and nobody', () => {
    const f = buildFeedback('more champions please', context);
    expect(f).toEqual({
      v: 1,
      text: 'more champions please',
      where: 'end',
      mode: 'practice',
      minutes: 12,
      finished: false,
      signedIn: false,
    });
    const json = JSON.stringify(f);
    for (const forbidden of ['name', 'account', 'id', 'ip']) {
      expect(`${forbidden}: ${json.includes(`"${forbidden}"`)}`).toBe(`${forbidden}: false`);
    }
  });

  it('posts with keepalive and swallows the answer', () => {
    const post = vi.fn(() => Promise.reject(new Error('down')));
    const f = buildFeedback('the phone wall', context);
    expect(f).not.toBeNull();
    sendFeedback(f!, post as unknown as typeof fetch);
    expect(post).toHaveBeenCalledTimes(1);
    const [url, init] = post.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(FEEDBACK_ROUTE);
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual(f);
  });

  it('says who is asking, since that is why it is answered', () => {
    expect(FEEDBACK_ASK).toContain('One person');
    expect(FEEDBACK_CALL).toContain('improve');
  });
});

describe('the server side', () => {
  const good = buildFeedback('the shop covers my screen', context)!;

  it('takes a message a box could have sent, and nothing else', () => {
    expect(parseFeedback(good)).toEqual(good);
    expect(parseFeedback(null)).toBeNull();
    expect(parseFeedback({ ...good, v: 2 })).toBeNull();
    expect(parseFeedback({ ...good, where: 'inbox' })).toBeNull();
    expect(parseFeedback({ ...good, mode: 'ranked' })).toBeNull();
    expect(parseFeedback({ ...good, text: '' })).toBeNull();
    expect(parseFeedback({ ...good, text: '   ' })).toBeNull();
    expect(parseFeedback({ ...good, text: 'x'.repeat(FEEDBACK_MAX + 1) })).toBeNull();
    expect(parseFeedback({ ...good, minutes: -1 })).toBeNull();
    expect(parseFeedback({ ...good, minutes: FEEDBACK_MINUTES_MAX + 1 })).toBeNull();
    expect(parseFeedback({ ...good, minutes: 1.5 })).toBeNull();
    expect(parseFeedback({ ...good, finished: 'yes' })).toBeNull();
    expect(parseFeedback({ ...good, signedIn: 1 })).toBeNull();
  });

  it('keeps nothing the message did not say', () => {
    const parsed = parseFeedback({ ...good, name: 'somebody', ip: '1.2.3.4' });
    expect(parsed).toEqual(good);
    expect(Object.keys(parsed as object).sort()).toEqual([
      'finished',
      'minutes',
      'mode',
      'signedIn',
      'text',
      'v',
      'where',
    ]);
  });

  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('appends one line per message and reads them back, skipping a torn line', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'feedback-'));
    const file = path.join(dir, 'data', 'feedback.jsonl');
    const store = new FeedbackStore(file);
    store.append(good, 1000);
    store.append({ ...good, text: 'and the bots feed', where: 'pause' }, 2000);
    const text = readFileSync(file, 'utf8');
    expect(text.split('\n').filter(Boolean)).toHaveLength(2);
    writeFileSync(file, `${text}{"at": 3000, "v": 1, "te`);
    expect(store.readAll().map((f) => [f.at, f.where])).toEqual([
      [1000, 'end'],
      [2000, 'pause'],
    ]);
    expect(new FeedbackStore(path.join(dir, 'missing.jsonl')).readAll()).toEqual([]);
    expect(readFeedbackLines('')).toEqual([]);
  });

  it('reads back as one block a maintainer can scan', () => {
    const line = formatFeedback({ at: Date.parse('2026-09-28T10:30:00Z'), ...good });
    expect(line).toContain('2026-09-28 10:30');
    expect(line).toContain('visitor, practice, 12 min, left, from the end screen');
    expect(line).toContain('    the shop covers my screen');
  });
});

// The line at the start of a match that says the box exists: most matches
// end with the tab closed, so the end screen alone asks almost nobody.
describe('the feedback nudge', () => {
  it('waits for the opening shop, then stays its moment and goes', () => {
    let s = NUDGE_START;
    s = stepNudge(s, NUDGE_FROM + 1, true);
    expect(nudgeVisible(s, true)).toBe(false);
    expect(s.shownAt).toBeNull();
    s = stepNudge(s, NUDGE_FROM + 5, false);
    expect(nudgeVisible(s, false)).toBe(true);
    s = stepNudge(s, NUDGE_FROM + 5 + NUDGE_HOLD - 1, false);
    expect(nudgeVisible(s, false)).toBe(true);
    s = stepNudge(s, NUDGE_FROM + 5 + NUDGE_HOLD, false);
    expect(nudgeVisible(s, false)).toBe(false);
    expect(stepNudge(s, 999, false)).toBe(s);
  });

  it('does not show before the match has begun, and hides under a menu', () => {
    let s = stepNudge(NUDGE_START, NUDGE_FROM - 1, false);
    expect(s.shownAt).toBeNull();
    s = stepNudge(s, NUDGE_FROM, false);
    expect(nudgeVisible(s, true)).toBe(false);
    expect(nudgeVisible(s, false)).toBe(true);
  });

  it('names the way to the menu for the device in hand', () => {
    expect(nudgeCall(false)).toContain('Esc');
    expect(nudgeCall(true)).toContain('Menu');
    expect(nudgeCall(true)).not.toContain('Esc');
  });
});
