// The coach conversation as it travels and as it is kept (ADR 0013): one
// turn per entry, the owner's words or the model's raw answer, stored per
// bot on the server so the next session picks the thread up where the
// last one stopped and the coach remembers what was done.

export interface CoachTurn {
  role: 'user' | 'assistant';
  // What the model saw or wrote, replayed verbatim on the next call.
  text: string;
  // Operations the validator refused in that answer, for the bubble.
  refused?: string[];
}

// The comment a raw answer opens with (its first line, "# ..."): the part
// shown as the bubble; the operation lines below it edit the play list.
export function commentOf(raw: string): string {
  const first = raw.split('\n')[0] ?? '';
  const comment = first.startsWith('#') ? first.slice(1).trim() : '';
  return comment !== '' ? comment : 'Done.';
}
