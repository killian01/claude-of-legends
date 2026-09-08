// The announcer's rules (src/game/announcer_policy.ts): no stutter, no
// talking over itself, priority lines cut in. Pure, so plain node.

import { describe, expect, it } from 'vitest';
import {
  type AnnouncerState,
  announcerVerdict,
  BREATH_MS,
  REPEAT_WINDOW_MS,
} from '../src/game/announcer_policy';

const quiet = (over: Partial<AnnouncerState> = {}): AnnouncerState => ({
  lastId: null,
  lastAt: 0,
  busy: false,
  ...over,
});

describe('the announcer policy', () => {
  it('says a line when nothing is playing', () => {
    expect(announcerVerdict(quiet(), 'first_blood', 10_000, false, false)).toBe('play');
    expect(announcerVerdict(quiet(), 'first_blood', 10_000, true, false)).toBe('play');
  });

  it('drops the same wording repeated inside the window', () => {
    const s = quiet({ lastId: 'tower_fallen', lastAt: 10_000 });
    expect(announcerVerdict(s, 'tower_fallen', 10_000 + REPEAT_WINDOW_MS - 1, false, false)).toBe(
      'drop',
    );
    // Even a priority line: a stutter is a stutter.
    expect(announcerVerdict(s, 'tower_fallen', 10_000 + 1000, true, false)).toBe('drop');
    expect(announcerVerdict(s, 'tower_fallen', 10_000 + REPEAT_WINDOW_MS + 1, false, false)).toBe(
      'play',
    );
  });

  it('lets a repeatable line say the same thing twice: two enemies, one fight', () => {
    const s = quiet({ lastId: 'enemy_slain', lastAt: 10_000 });
    expect(announcerVerdict(s, 'enemy_slain', 10_000 + BREATH_MS + 1, false, true)).toBe('play');
  });

  it('interrupts for a priority line and drops the rest while busy', () => {
    const s = quiet({ lastId: 'minions_spawned', lastAt: 10_000, busy: true });
    expect(announcerVerdict(s, 'first_blood', 10_500, true, false)).toBe('interrupt');
    expect(announcerVerdict(s, 'tower_fallen', 10_500, false, false)).toBe('drop');
  });

  it('takes a breath between ordinary lines, not before a priority one', () => {
    const s = quiet({ lastId: 'minions_spawned', lastAt: 10_000 });
    expect(announcerVerdict(s, 'tower_fallen', 10_000 + BREATH_MS - 1, false, false)).toBe('drop');
    expect(announcerVerdict(s, 'tower_fallen', 10_000 + BREATH_MS + 1, false, false)).toBe('play');
    expect(announcerVerdict(s, 'first_blood', 10_000 + 100, true, false)).toBe('play');
  });
});
