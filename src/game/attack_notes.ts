// Swing choices originate in the sim, whether it is local, replayed or
// mirrored through a snapshot. No viewer decides the creature's sequence.
import type { SnapEvent } from '../net/protocol';
import type { SimEvent } from '../sim/sim';

export type AttackNote = Omit<Extract<SimEvent, { type: 'attack' }>, 'type'>;

export function attacksFrom(events: readonly (SimEvent | SnapEvent)[]): AttackNote[] {
  return events.flatMap((event) => {
    if (('type' in event && event.type === 'attack') || ('e' in event && event.e === 'atk')) {
      return [
        {
          unitId: event.unitId,
          targetId: event.targetId,
          ...(event.voidmaulAttack !== undefined ? { voidmaulAttack: event.voidmaulAttack } : {}),
        },
      ];
    }
    return [];
  });
}
