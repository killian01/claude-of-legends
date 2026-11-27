// The Ranked queue (and the Forge queue) starts with bots by itself (ADR 0025: nobody queues here
// to wait for ten people): a short count runs from the moment the first
// group queues, the queue card shows it, and when it runs out the whole
// queue goes into a bot-filled select, as if Start had been pressed.

import { describe, expect, it } from 'vitest';
import { Matchmaker, QUEUE_START_MS } from '../server/matchmaker';
import type { ServerMsg } from '../src/net/protocol';

function harness(): { mm: Matchmaker; sent: Map<number, ServerMsg[]> } {
  const sent = new Map<number, ServerMsg[]>();
  const mm = new Matchmaker(
    (clientId, msg) => {
      const list = sent.get(clientId) ?? [];
      list.push(msg);
      sent.set(clientId, list);
    },
    () => 1,
  );
  return { mm, sent };
}

const last = (msgs: ServerMsg[] | undefined, t: string): ServerMsg | undefined =>
  msgs?.filter((m) => m.t === t).at(-1);

const startsIn = (msgs: ServerMsg[] | undefined): number | null | undefined => {
  const m = last(msgs, 'queue_status');
  return m?.t === 'queue_status' ? m.startsIn : undefined;
};

describe('the queue starts with bots by itself', () => {
  it('a lone player is seated once the count runs out, not before', () => {
    const { mm, sent } = harness();
    mm.addToQueue(1, 'alice', 1000);
    expect(startsIn(sent.get(1))).toBe(QUEUE_START_MS / 1000);
    mm.tickClock(1000 + QUEUE_START_MS - 1);
    expect(last(sent.get(1), 'select_start')).toBeUndefined();
    mm.tickClock(1000 + QUEUE_START_MS);
    expect(last(sent.get(1), 'select_start')).toBeDefined();
  });

  it('the card counts the seconds down as the clock runs', () => {
    const { mm, sent } = harness();
    mm.addToQueue(1, 'alice', 0);
    mm.tickClock(1500);
    expect(startsIn(sent.get(1))).toBe(QUEUE_START_MS / 1000 - 1);
    const before = sent.get(1)?.length ?? 0;
    mm.tickClock(1600);
    // Within the same second nothing new is sent.
    expect(sent.get(1)?.length).toBe(before);
  });

  it("a later arrival rides the first one's count, onto the other side", () => {
    const { mm, sent } = harness();
    mm.addToQueue(1, 'alice', 0);
    mm.addToQueue(2, 'bob', 3000);
    expect(startsIn(sent.get(2))).toBe(QUEUE_START_MS / 1000 - 3);
    mm.tickClock(QUEUE_START_MS);
    expect(last(sent.get(1), 'select_start')).toMatchObject({ team: 0 });
    expect(last(sent.get(2), 'select_start')).toMatchObject({ team: 1 });
  });

  it('Start still skips the count', () => {
    const { mm, sent } = harness();
    mm.addToQueue(1, 'alice', 0);
    mm.startNow(1, 10);
    expect(last(sent.get(1), 'select_start')).toBeDefined();
  });

  it('a player who leaves takes the count along; the next one starts their own', () => {
    const { mm, sent } = harness();
    mm.addToQueue(1, 'alice', 0);
    mm.removeEverywhere(1, 2000);
    mm.addToQueue(2, 'bob', 5000);
    mm.tickClock(QUEUE_START_MS);
    expect(last(sent.get(2), 'select_start')).toBeUndefined();
    mm.tickClock(5000 + QUEUE_START_MS);
    expect(last(sent.get(2), 'select_start')).toBeDefined();
  });
});
