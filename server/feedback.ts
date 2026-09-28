// What players write in the feedback box (src/ui/feedback_box.ts), as the
// server keeps it: one line per message in feedback.jsonl under the data
// directory, with the time it arrived and nothing else added. The route
// takes no session, since the players worth hearing from are exactly the
// ones who never made an account, so the parse is strict and bounded: a
// stored line is only ever a message a box could have sent.

import { readFileSync } from 'node:fs';
import type { Feedback, FeedbackWhere } from '../src/ui/feedback_box';
import { FEEDBACK_MAX, FEEDBACK_VERSION } from '../src/ui/feedback_box';
import { appendJsonl } from './store';

const WHERE: readonly FeedbackWhere[] = ['end', 'pause'];
const MODES = ['practice', 'online'] as const;
// Longer than any match the sim ends on its own.
export const FEEDBACK_MINUTES_MAX = 240;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Null for anything that is not a message a box could have sent; the
// caller answers 400 and stores nothing.
export function parseFeedback(raw: unknown): Feedback | null {
  if (!isRecord(raw)) return null;
  if (raw.v !== FEEDBACK_VERSION) return null;
  const where = WHERE.find((w) => w === raw.where);
  const mode = MODES.find((m) => m === raw.mode);
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (!where || !mode || text.length === 0 || text.length > FEEDBACK_MAX) return null;
  if (
    typeof raw.minutes !== 'number' ||
    !Number.isInteger(raw.minutes) ||
    raw.minutes < 0 ||
    raw.minutes > FEEDBACK_MINUTES_MAX
  ) {
    return null;
  }
  if (typeof raw.finished !== 'boolean' || typeof raw.signedIn !== 'boolean') return null;
  return {
    v: FEEDBACK_VERSION,
    text,
    where,
    mode,
    minutes: raw.minutes,
    finished: raw.finished,
    signedIn: raw.signedIn,
  };
}

export interface StoredFeedback extends Feedback {
  at: number;
}

export class FeedbackStore {
  constructor(private readonly file: string) {}

  append(feedback: Feedback, at: number): void {
    const stored: StoredFeedback = { at, ...feedback };
    appendJsonl(this.file, stored);
  }

  // Every message on disk, oldest first; a torn last line (a crash mid
  // write) is skipped rather than fatal.
  readAll(): StoredFeedback[] {
    let text: string;
    try {
      text = readFileSync(this.file, 'utf8');
    } catch {
      return [];
    }
    return readFeedbackLines(text);
  }
}

export function readFeedbackLines(text: string): StoredFeedback[] {
  const out: StoredFeedback[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const raw = JSON.parse(line) as Record<string, unknown>;
      const feedback = parseFeedback(raw);
      if (feedback && typeof raw.at === 'number') out.push({ at: raw.at, ...feedback });
    } catch {
      // A torn line.
    }
  }
  return out;
}

// One message as a maintainer reads it: the day, where it was written,
// the match it came out of, then the words.
export function formatFeedback(f: StoredFeedback): string {
  const when = new Date(f.at).toISOString().slice(0, 16).replace('T', ' ');
  const match = `${f.mode}, ${f.minutes} min, ${f.finished ? 'played through' : 'left'}`;
  const who = f.signedIn ? 'account' : 'visitor';
  const body = f.text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
  return `${when}  ${who}, ${match}, from the ${f.where === 'end' ? 'end screen' : 'pause menu'}\n${body}`;
}
