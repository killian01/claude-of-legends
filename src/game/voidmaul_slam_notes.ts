// The authoritative impact travels unchanged through local ticks and
// snapshots. Presentation never infers a slam from a swing or an HP drop.
import type { SnapEvent } from '../net/protocol';
import type { VoidmaulSlamEvent } from '../sim/combat/voidmaul_slam';
import type { SimEvent } from '../sim/sim';

export type VoidmaulSlamNote = Omit<VoidmaulSlamEvent, 'type'>;

export function voidmaulSlamsFrom(events: readonly (SimEvent | SnapEvent)[]): VoidmaulSlamNote[] {
  return events.flatMap((event) => {
    if (
      ('type' in event && event.type === 'voidmaul_slam') ||
      ('e' in event && event.e === 'voidmaul_slam')
    ) {
      const { unitId, targetId, x, z, radius, at } = event;
      return [
        {
          unitId,
          targetId,
          x,
          z,
          radius,
          at,
          ...(event.y !== undefined ? { y: event.y } : {}),
          ...(event.kind !== undefined ? { kind: event.kind } : {}),
        },
      ];
    }
    return [];
  });
}
