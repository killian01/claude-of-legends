// What the announcer does with a line it is handed: the rules that keep
// the voice from stuttering or talking over itself, as a pure function so
// the wiring (clips, speech synthesis, music ducking) stays thin.

export interface AnnouncerState {
  // The last line that was actually said, and when.
  lastId: string | null;
  lastAt: number;
  // A line is playing right now.
  busy: boolean;
}

export type AnnouncerVerdict = 'play' | 'interrupt' | 'drop';

// The same wording twice inside this window is a stutter, unless the
// caller marks the line repeatable (two enemies dying in one fight).
export const REPEAT_WINDOW_MS = 4000;
// A breath between two ordinary lines.
export const BREATH_MS = 900;

// priority: true lines (kills, objectives) interrupt whatever is playing;
// others are dropped while the voice is busy or still catching its breath.
export function announcerVerdict(
  state: Readonly<AnnouncerState>,
  id: string,
  now: number,
  priority: boolean,
  repeatable: boolean,
): AnnouncerVerdict {
  if (!repeatable && id === state.lastId && now - state.lastAt < REPEAT_WINDOW_MS) return 'drop';
  if (state.busy) return priority ? 'interrupt' : 'drop';
  if (!priority && now - state.lastAt < BREATH_MS) return 'drop';
  return 'play';
}
