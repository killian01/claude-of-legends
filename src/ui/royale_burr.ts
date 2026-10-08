// The Burr as the screen shows it (CONTEXT.md: Burr), decided without the
// DOM: the edge arrow toward its carrier while the own champion stands and
// the carrier is off the screen (ui/royale_edges.ts places it), and the line
// on the wash of a Respawn death that names who carries it. Pure: the mode's
// block as the last snapshot told it (SnapRoyale's bu, the recipient's own,
// absent while none lasts) and the clock in.

import type { SnapRoyale } from '../net/royale_wire';
import type { Vec3 } from '../sim/geo';

// The Burr's color: a thorn's red, apart from the marks' golds and embers.
export const BURR_COLOR = '#ff6f8e';

// What the edge arrow points at: the carrier where it stands, and the
// seconds the Burr has left, read under the arrow.
export interface BurrTarget {
  key: 'burr';
  kind: 'burr';
  carrierId: number;
  at: Vec3;
  secondsLeft: number;
}

export function burrTarget(
  r: Pick<SnapRoyale, 'st' | 'bu'> | null,
  time: number,
): BurrTarget | null {
  const b = r?.st === 'play' ? r.bu : undefined;
  if (!b?.at || time > b.u) return null;
  return {
    key: 'burr',
    kind: 'burr',
    carrierId: b.i,
    at: { x: b.at[0], y: b.at[1], z: b.at[2] },
    secondsLeft: Math.max(0, b.u - time),
  };
}

// The wash's line while the Burr lasts: "Pinetinder carries your Burr: take
// them down for double", the carrier by the name its seat plays under; null
// while none lasts.
export function burrWashLine(
  r: Pick<SnapRoyale, 'st' | 'bu'> | null,
  time: number,
  nameOf: (unitId: number) => string | null,
): string | null {
  const b = r?.st === 'play' ? r.bu : undefined;
  if (!b || time > b.u) return null;
  const name = nameOf(b.i) ?? 'Your killer';
  return `${name} carries your Burr: take them down for double`;
}
