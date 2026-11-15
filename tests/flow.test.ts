// Match exit routing: every (action, mode) pair lands on the right screen,
// and a match whose private lobby lives on goes back to that lobby.

import { describe, expect, it } from 'vitest';
import { type GameMode, nextStep } from '../src/game/flow';

const ALL_MODES: readonly GameMode[] = [
  'practice',
  'queue',
  'forge-queue',
  'create',
  'join',
  'replay',
  'spectate',
  'royale',
  'thornfray',
];

describe('post-match flow', () => {
  it('returning to the menu always goes home, whatever the mode', () => {
    for (const mode of ALL_MODES) {
      expect(nextStep('menu', mode)).toBe('home');
      expect(nextStep('menu', mode, 'KMNPQR')).toBe('home');
      expect(nextStep('other', mode, 'KMNPQR')).toBe('home');
    }
  });

  it('play again replays the same offline pick after practice', () => {
    expect(nextStep('again', 'practice')).toBe('replay');
    expect(nextStep('again', 'practice', 'KMNPQR')).toBe('replay');
  });

  it('play again restarts the same replay after watching one', () => {
    expect(nextStep('again', 'replay')).toBe('replay');
    expect(nextStep('again', 'spectate')).toBe('replay');
    expect(nextStep('again', 'replay', 'KMNPQR')).toBe('replay');
    expect(nextStep('again', 'spectate', 'KMNPQR')).toBe('replay');
  });

  it('play again re-enters the public queue when no lobby lives on', () => {
    expect(nextStep('again', 'queue')).toBe('requeue');
    expect(nextStep('again', 'forge-queue')).toBe('requeue');
    // A lobby session whose match named no lobby: nothing to go back to.
    expect(nextStep('again', 'create')).toBe('requeue');
    expect(nextStep('again', 'join')).toBe('requeue');
  });

  it('goes back into the lobby the match came from', () => {
    // The lobby's own match, a party it queued, and a lobby match taken
    // back after a reload, which arrives through a queue session.
    expect(nextStep('again', 'create', 'KMNPQR')).toBe('lobby');
    expect(nextStep('again', 'join', 'KMNPQR')).toBe('lobby');
    expect(nextStep('again', 'queue', 'KMNPQR')).toBe('lobby');
  });

  // Each runs its own loop, Play again included (game/royale_flow.ts,
  // game/thornfray_flow.ts), and is asked here only once it is over.
  it('goes home once a battle royale or a Thornfray loop is over', () => {
    for (const action of ['again', 'other', 'menu'] as const) {
      expect(nextStep(action, 'royale')).toBe('home');
      expect(nextStep(action, 'thornfray')).toBe('home');
      expect(nextStep(action, 'royale', 'KMNPQR')).toBe('home');
      expect(nextStep(action, 'thornfray', 'KMNPQR')).toBe('home');
    }
  });
});
