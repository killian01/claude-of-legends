// The one line a browser stores about itself, and everything that can be
// in it.
//
// It began as a date: the day this browser last said hello, which is what
// keeps the visitor count to one ping per browser per day
// (src/net/pulse_ping.ts). Two things then needed the same line. A browser
// that asked to be left out has to stay left out, and the paces a visitor
// reached today have to be reported once each rather than on every reload.
//
// Both live here rather than in keys of their own, because PRIVACY.md
// promises a browser exactly one line of storage and that promise is worth
// more than the convenience of a second key. What the line holds is still
// a date and, at most, two words off a fixed list. It is not an
// identifier: every browser in the world that arrived today and played a
// match holds the same twenty characters, it is overwritten tomorrow, and
// it never leaves the machine.

// The paces past arriving, in the order a visitor reaches them. Each is
// reported at most once per browser per day, which is what makes them
// comparable with the visitor count they are read against.
export const VISIT_STEPS = [
  // Still here half a minute later. The line between a visitor and a
  // click that bounced before the page finished drawing.
  'stayed',
  // A match actually started in this browser: practice, test drive or a
  // live game. Not a replay, which is watching rather than playing.
  'played',
] as const;

export type VisitStep = (typeof VISIT_STEPS)[number];

// What the stored line says: the day, and which paces have been reported
// on it. 'off' is a browser that asked to be left out for good; null is a
// browser that has never stored anything, which is what makes it a
// newcomer when it next arrives.
export interface VisitLine {
  day: string;
  steps: readonly VisitStep[];
}

export const OPT_OUT = 'off';

export function isVisitStep(value: string): value is VisitStep {
  return (VISIT_STEPS as readonly string[]).includes(value);
}

// Reads a line off storage. A shape this build does not understand is read
// as nothing at all rather than repaired: the cost is one browser counted
// as new once, and the alternative is carrying a word nothing can render.
export function parseLine(raw: string | null): VisitLine | 'off' | null {
  if (raw === null) return null;
  if (raw === OPT_OUT) return OPT_OUT;
  const [day, ...rest] = raw.split(' ');
  if (day === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  // Unknown words are dropped rather than kept: a line written by a build
  // that knew a third pace must not grow forever in a browser that does
  // not.
  return { day, steps: rest.filter(isVisitStep) };
}

export function formatLine(line: VisitLine): string {
  return [line.day, ...line.steps].join(' ');
}

// The line with one more pace on it, or null when it is already there and
// there is nothing to report. Order is the order they were reached, and
// duplicates are impossible by construction.
export function withStep(line: VisitLine, step: VisitStep): VisitLine | null {
  if (line.steps.includes(step)) return null;
  return { day: line.day, steps: [...line.steps, step] };
}
