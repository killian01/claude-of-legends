// What the queue's card says (the Ranked queue, the Forge queue) (ui/menu.ts showQueue), pure. The
// queue starts with bots by itself a few seconds after the first person
// queues (server/matchmaker.ts QUEUE_START_MS), so the card counts that
// down and says who else is in, rather than a tally toward ten that
// reads as a wait for nine strangers. Start skips the count.

export interface QueueText {
  status: string;
  button: string;
}

export function queueText(count: number, startsIn: number | null, ready: boolean): QueueText {
  const who = count <= 1 ? 'You are the only one queued.' : `${count} people queued together.`;
  if (ready) return { status: `${who} Starting with bots...`, button: 'Starting...' };
  if (startsIn === null) return { status: who, button: 'Start now with bots' };
  const when = startsIn <= 0 ? 'now' : `in ${startsIn}s`;
  return {
    status: `${who} The match fills with bots and starts ${when}; anyone who queues meanwhile plays in it too.`,
    button: 'Start now with bots',
  };
}
