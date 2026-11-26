// Trades of places (CONTEXT.md: Trade places) as the presentation hears
// them, the same from a local tick, a replay or a snapshot: the sim names
// the two units, and the renderer draws the thread of light between them.
import type { SnapEvent } from '../net/protocol';
import type { SimEvent } from '../sim/sim';

export type SwapNote = Omit<Extract<SimEvent, { type: 'swap' }>, 'type'>;

export function swapsFrom(events: readonly (SimEvent | SnapEvent)[]): SwapNote[] {
  return events.flatMap((event) => {
    if (('type' in event && event.type === 'swap') || ('e' in event && event.e === 'swap')) {
      return [{ unitId: event.unitId, otherId: event.otherId }];
    }
    return [];
  });
}
