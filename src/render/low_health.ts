// The low-health frame: under 30 percent health the screen's edge turns a
// pulsing red, stronger as death comes closer. The red is painted once, a
// gradient up to full strength, and only its opacity follows the pulse:
// the frame used to get a new gradient every frame, which repaints the
// whole screen at the phone's pixel density right through every fight.
// The opacity of a gradient to full red is the same picture as the same
// gradient to a red that faint (the gradient fades from clear either way).

// The frame over the whole canvas, its red at full strength and hidden;
// its opacity sets how strong it shows.
export const LOW_HEALTH_STYLE =
  'position:absolute;inset:0;pointer-events:none;opacity:0;' +
  'background:radial-gradient(ellipse at center, transparent 45%, rgba(150,20,10,1) 100%);';

// The health fraction below which the frame shows.
export const LOW_HEALTH_FRAC = 0.3;

// How strongly the frame shows at a health fraction, `now` in milliseconds
// for its pulse; null above the threshold.
export function lowHealthOpacity(hpFrac: number, now: number): number | null {
  if (!(hpFrac < LOW_HEALTH_FRAC)) return null;
  const danger = 1 - Math.max(0, hpFrac) / LOW_HEALTH_FRAC;
  return (0.22 + 0.18 * danger + 0.1 * Math.sin(now * 0.008)) * (0.6 + 0.4 * danger);
}
