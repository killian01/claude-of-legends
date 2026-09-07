// The model reference, checked by machine before a build spends on it.
//
// The 3D builder reconstructs whatever the image shows: a two-view sheet
// becomes a two-bodied model, a bust becomes a bust, a fused weapon
// becomes fused geometry. The rules for a good reference are written on
// the panel, but reading an image against them is a judgement the
// creator makes by eye, and they discover they got it wrong AFTER the
// build has spent and come back wrong. So the same eye looks first: one
// small vision call, at the build's own classify stage, before anything
// expensive runs.
//
// It refuses only what it is sure about, and says what it saw in one
// sentence, because a wall that cannot explain itself is worse than the
// mistake it prevents. The creator can build anyway (the editor sends
// `force`), which is the last word on their own picture: the check is an
// eye, not a gate with a key.

import type { SuggestDeps } from './suggest';
import { askModel, imageMediaType } from './suggest';

// What the check answers with. `usable` is the only decision; the rest
// is what it saw, kept so the refusal can name it.
export interface ReferenceVerdict {
  usable: boolean;
  // How many characters it counted; null when it could not tell.
  figures: number | null;
  fullBody: boolean;
  plainBackground: boolean;
  // One sentence to the creator, in plain words: what is wrong and what
  // to ask for instead.
  note: string;
}

// The prefix a failed build's error wears when the reference is why, so
// the editor can offer to build anyway instead of just reporting a
// failure (server/generation/pipeline.ts throws it, src/ui reads it).
export const REFERENCE_REFUSAL = 'this reference will not build:';

const RULES =
  'You are checking ONE image before it is turned into a 3D model, for a small game. The ' +
  'builder reconstructs literally what the image shows, so the image must be: exactly ONE ' +
  'character, alone; the WHOLE body, head to feet, nothing cropped; seen from the front; on ' +
  'a plain, empty background. Answer with ONLY a JSON object: { "figures": integer (how many ' +
  'separate characters or views of a character you see, counting a multi-view sheet as one ' +
  'per view), "fullBody": boolean, "front": boolean, "plainBackground": boolean, "note": ' +
  'string }. "note" is ONE short sentence for the person who made the image, naming what is ' +
  'wrong and what to ask for instead; empty when nothing is wrong. Judge only what you can ' +
  'plainly see: when in doubt, say it is fine.';

interface RawVerdict {
  figures?: unknown;
  fullBody?: unknown;
  front?: unknown;
  plainBackground?: unknown;
  note?: unknown;
}

function parse(answer: string): RawVerdict | null {
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const raw = JSON.parse(answer.slice(start, end + 1)) as RawVerdict;
    return typeof raw === 'object' && raw !== null ? raw : null;
  } catch {
    return null;
  }
}

// The reading, from the model's answer: only two faults are worth a
// refusal, because only two of them make a model nobody can use. More
// than one figure is the one that ruins a build outright (the reason
// the single-view rule exists at all), and a cropped body makes a
// champion with no legs. A busy background and a three-quarter view cost
// quality, not usability, so they ride in the note and never refuse.
export function readVerdict(raw: RawVerdict): ReferenceVerdict {
  const figures =
    typeof raw.figures === 'number' && Number.isFinite(raw.figures)
      ? Math.round(raw.figures)
      : null;
  const fullBody = raw.fullBody !== false;
  const plainBackground = raw.plainBackground !== false;
  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, 300) : '';
  const usable = (figures === null || figures <= 1) && fullBody;
  return { usable, figures, fullBody, plainBackground, note };
}

// The refusal in the creator's words: what was seen, and nothing more.
// What to do about it is the editor's line to say, next to the buttons
// that do it, so the two never say it twice.
export function refusalMessage(v: ReferenceVerdict): string {
  const seen =
    v.figures !== null && v.figures > 1
      ? `it shows ${v.figures} figures, and the builder makes a body out of each`
      : 'the body is cut off, and the builder makes exactly what it sees';
  const note = v.note !== '' ? ` ${v.note}` : '';
  return `${REFERENCE_REFUSAL} ${seen}.${note}`;
}

// Looks at the chosen reference. A server with no key, a call that
// fails, or an answer that is not the asked JSON all return null: the
// check is a courtesy, and a courtesy that breaks must never stop a
// build the creator paid for.
export async function checkReference(
  deps: SuggestDeps,
  image: Buffer,
): Promise<ReferenceVerdict | null> {
  if (!deps.apiKey) return null;
  try {
    const answer = await askModel(deps, [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: imageMediaType(image),
              data: image.toString('base64'),
            },
          },
          { type: 'text', text: RULES },
        ],
      },
    ]);
    const raw = parse(answer);
    return raw === null ? null : readVerdict(raw);
  } catch {
    return null;
  }
}
