// Match exit routing: every (action, mode) pair lands on the right screen.

import { describe, expect, it } from 'vitest';
import { type GameMode, nextStep } from '../src/game/flow';

const ALL_MODES: readonly GameMode[] = [
  'practice',
  'orchard',
  'queue',
  'create',
  'join',
  'replay',
  'spectate',
];

describe('post-match flow', () => {
  it('returning to the menu always goes home, whatever the mode', () => {
    for (const mode of ALL_MODES) expect(nextStep('menu', mode)).toBe('home');
  });

  it('play again replays the same offline pick after practice', () => {
    expect(nextStep('again', 'practice')).toBe('replay');
    // The Star Orchard test mode is a practice match on another map.
    expect(nextStep('again', 'orchard')).toBe('replay');
  });

  it('play again restarts the same replay after watching one', () => {
    expect(nextStep('again', 'replay')).toBe('replay');
    expect(nextStep('again', 'spectate')).toBe('replay');
  });

  it('play again re-enters the public queue after every online mode', () => {
    expect(nextStep('again', 'queue')).toBe('requeue');
    // A private lobby dies with its match: 'again' cannot go back to it.
    expect(nextStep('again', 'create')).toBe('requeue');
    expect(nextStep('again', 'join')).toBe('requeue');
  });
});
