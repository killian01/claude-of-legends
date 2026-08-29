// What an account name may be, and when two of them are the same name
// (CONTEXT.md). Pure and total: no I/O, no clock, no registry. The
// registry asks two questions of this module and nothing else, so the
// rules live in one place and are pinned by their own test.
//
// ASCII only, deliberately. The whole game is written in English (ADR
// 0004) and a Unicode name space would mean carrying NFKC plus a
// homoglyph table just to stop one player from dressing up as another;
// the confusable range is the point, not the alphabet.

export const NAME_MIN = 3;
export const NAME_MAX = 16;

// Letters, digits, and the two separators people expect in a handle.
const ALLOWED = /^[A-Za-z0-9_-]+$/;

export type NameError = 'too_short' | 'too_long' | 'charset';

// The reading uniqueness is judged on: case and separators removed, so
// Bob, bob, b_o_b and b-o-b all fold to "bob" and only one may exist.
// Never shown to anyone; what the owner typed is what everyone sees.
export function foldName(raw: string): string {
  return raw.toLowerCase().replace(/[_-]/g, '');
}

// null when the name is usable. Length is measured on the raw name so the
// bound means what a player sees, but a name made only of separators
// folds to nothing and is refused as too short.
export function validateName(raw: string): NameError | null {
  if (raw.length > NAME_MAX) return 'too_long';
  if (!ALLOWED.test(raw)) return 'charset';
  if (raw.length < NAME_MIN || foldName(raw).length < NAME_MIN) return 'too_short';
  return null;
}

export function nameErrorMessage(err: NameError): string {
  switch (err) {
    case 'too_short':
      return `A name needs at least ${NAME_MIN} letters or digits.`;
    case 'too_long':
      return `A name is at most ${NAME_MAX} characters.`;
    case 'charset':
      return 'A name may use letters, digits, underscores and hyphens only.';
  }
}
