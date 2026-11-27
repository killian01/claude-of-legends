import { describe, expect, it } from 'vitest';
import { queueText } from '../src/ui/queue_text';

describe('the queue card', () => {
  it('counts down to the bot fill and keeps Start for skipping it', () => {
    const t = queueText(1, 8, false);
    expect(t.status).toBe(
      'You are the only one queued. The match fills with bots and starts in 8s; anyone who queues meanwhile plays in it too.',
    );
    expect(t.button).toBe('Start now with bots');
  });

  it('never reads as a wait for ten people', () => {
    for (const n of [1, 2, 4]) expect(queueText(n, 5, false).status).not.toMatch(/\/ ?10/);
    expect(queueText(3, 2, false).status).toMatch(/^3 people queued together\./);
  });

  it('says starting once Start was pressed or the count ran out', () => {
    expect(queueText(1, 0, false).status).toMatch(/starts now;/);
    expect(queueText(1, 3, true)).toEqual({
      status: 'You are the only one queued. Starting with bots...',
      button: 'Starting...',
    });
  });

  it('with no count told, just who is queued', () => {
    expect(queueText(1, null, false)).toEqual({
      status: 'You are the only one queued.',
      button: 'Start now with bots',
    });
  });
});
