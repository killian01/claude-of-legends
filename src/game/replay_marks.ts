// The marks on a replay's timeline (playtest round 3, grill Q6 and Q18):
// the moments worth seeking to, read off the sim's events as the match is
// played once ahead of the viewer. Kills of champions, structures falling,
// the Warden or a ring creature slain; each with its tick and the team that scored it, so the
// bar can tint a density strip by side and draw the rest as ticks. DOM-free
// and deterministic: the same record yields the same marks on any host.

import type { CreatureId } from '../sim/content/rings';
import type { SimEvent } from '../sim/sim';
import type { TeamId } from '../sim/types';
import type { Unit, UnitKind } from '../sim/unit';

export type MarkKind = 'kill' | 'tower' | 'sanctum' | 'warden' | 'creature';

export interface ReplayMark {
  tick: number;
  kind: MarkKind;
  // The team that scored: the killer's side (a structure's fall goes to
  // the side that took it down). Null when nobody's (a minion's tower).
  team: TeamId | null;
  // The victim.
  unitId: number;
  killerId: number;
  // Which ring creature fell, for a creature mark.
  creature?: CreatureId;
}

interface Seat {
  kind: UnitKind;
  team: TeamId;
  creature: CreatureId | null;
}

// Reads deaths as they happen. Units leave the map when they die, so the
// kinds and teams are noted from the map before each tick.
export class MarkCollector {
  readonly marks: ReplayMark[] = [];
  private readonly seats = new Map<number, Seat>();

  // Before the tick: remember what every unit is.
  note(units: ReadonlyMap<number, Unit>): void {
    for (const u of units.values()) {
      if (!this.seats.has(u.id)) {
        this.seats.set(u.id, { kind: u.kind, team: u.team, creature: u.creatureId });
      }
    }
  }

  // After the tick: the deaths that matter, dated.
  observe(tick: number, events: readonly SimEvent[]): void {
    for (const ev of events) {
      if (ev.type !== 'death') continue;
      const victim = this.seats.get(ev.unitId);
      if (!victim) continue;
      const kind: MarkKind | null =
        victim.kind === 'champion'
          ? 'kill'
          : victim.kind === 'tower'
            ? 'tower'
            : victim.kind === 'sanctum'
              ? 'sanctum'
              : victim.kind === 'warden'
                ? 'warden'
                : victim.kind === 'creature'
                  ? 'creature'
                  : null;
      if (kind === null) continue;
      const killer = this.seats.get(ev.killerId);
      const team: TeamId | null =
        killer && killer.kind !== 'warden' && killer.kind !== 'camp' && killer.kind !== 'creature'
          ? killer.team
          : kind === 'tower' || kind === 'sanctum'
            ? ((1 - victim.team) as TeamId)
            : null;
      const mark: ReplayMark = { tick, kind, team, unitId: ev.unitId, killerId: ev.killerId };
      if (kind === 'creature' && victim.creature) mark.creature = victim.creature;
      this.marks.push(mark);
    }
  }
}
