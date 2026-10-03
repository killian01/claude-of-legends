// Points in a battle royale (ADR 0027, ADR 0031): what a person's seat
// earns there, banked as it comes like the 5v5's. The same actions pay the
// same (a champion takedown 10, an assist 5, a camp last hit 1, a big
// creature's last hit 15) and a cache opened pays 1; the same weight by the
// people present, where every other person is an opponent (ADR 0030): two
// when another person is connected in the match, one alone. The end pays a
// seat still playing (a command in the last three minutes): One life 50 to
// the last standing, 25 to the rest of the top five, 15 to the rest of the
// top ten, each paid when the place is known; Respawn 50 to the best
// score. Pure over what the sim counts and the mode's events.

import type { RoyaleVariant } from '../src/net/royale_wire';
import { activeNearEnd, POINTS, type PointsAward, weighted } from './points';
import type { RoyaleSimEvent } from './royale_sim';

// One person's seat connected now.
export interface RoyalePointsSeat {
  clientId: number;
  // Who banks: an account id, or a Guest's negative id.
  owner: number;
  unitId: number;
  // sim.tickCount of the seat's last command.
  lastCommandAt: number;
}

export interface RoyalePointsUnit {
  kind: string;
  kills: number;
  assists: number;
}

export interface RoyalePointsWorld {
  readonly units: ReadonlyMap<number, RoyalePointsUnit>;
  readonly tickCount: number;
}

// The weight the people put on an award: another person in the match is an
// opponent, and doubles it.
export function royaleWeight(peopleConnected: number): number {
  return peopleConnected > 1 ? 2 : 1;
}

// The end's award for a place in One life, or null below the top ten.
export function placeReason(place: number): 'last_standing' | 'top_five' | 'top_ten' | null {
  if (place === 1) return 'last_standing';
  if (place <= 5) return 'top_five';
  if (place <= 10) return 'top_ten';
  return null;
}

export class RoyalePoints {
  private readonly seen = new Map<number, { owner: number; kills: number; assists: number }>();
  // The camp bodies and the big creatures alive after the last tick: a
  // body is gone from the sim by the time its death is read.
  private readonly camps = new Set<number>();
  private readonly creatures = new Set<number>();
  // Seats already paid for their place (One life), and the end, once.
  private readonly placed = new Set<number>();
  private ended = false;

  constructor(
    world: RoyalePointsWorld,
    private readonly variant: RoyaleVariant,
  ) {
    this.note(world);
  }

  observe(
    world: RoyalePointsWorld,
    events: readonly RoyaleSimEvent[],
    seats: readonly RoyalePointsSeat[],
  ): PointsAward[] {
    if (this.ended) return [];
    const weight = royaleWeight(seats.length);
    const bySeat = new Map(seats.map((s) => [s.unitId, s]));
    const earned = new Map<string, PointsAward>();
    const give = (seat: RoyalePointsSeat, reason: PointsAward['reason'], count = 1): void => {
      if (count <= 0) return;
      const delta = count * weighted(POINTS[reason], weight);
      if (delta <= 0) return;
      const key = `${seat.clientId}:${reason}`;
      const had = earned.get(key);
      if (had) had.delta += delta;
      else earned.set(key, { clientId: seat.clientId, owner: seat.owner, reason, delta });
    };
    const ending = (seat: RoyalePointsSeat): boolean =>
      activeNearEnd(world.tickCount, seat.lastCommandAt);

    for (const seat of seats) {
      const u = world.units.get(seat.unitId);
      if (!u) continue;
      const before = this.seen.get(seat.unitId);
      if (before && before.owner === seat.owner) {
        give(seat, 'kill', u.kills - before.kills);
        give(seat, 'assist', u.assists - before.assists);
      }
      this.seen.set(seat.unitId, { owner: seat.owner, kills: u.kills, assists: u.assists });
    }
    for (const unitId of [...this.seen.keys()]) if (!bySeat.has(unitId)) this.seen.delete(unitId);

    for (const ev of events) {
      if (ev.type === 'death') {
        const seat = bySeat.get(ev.killerId);
        if (this.camps.delete(ev.unitId)) {
          if (seat) give(seat, 'last_hit');
        } else if (this.creatures.delete(ev.unitId)) {
          if (seat) give(seat, 'creature');
        }
      } else if (ev.type === 'royale_cache') {
        const seat = bySeat.get(ev.unitId);
        if (seat) give(seat, 'cache');
      } else if (ev.type === 'royale_out') {
        if (this.variant !== 'one_life') continue;
        const seat = bySeat.get(ev.unitId);
        const reason = placeReason(ev.place);
        if (seat && reason && !this.placed.has(seat.unitId) && ending(seat)) {
          this.placed.add(seat.unitId);
          give(seat, reason);
        }
      } else if (ev.type === 'royale_end') {
        this.ended = true;
        const seat = ev.winnerId !== null ? bySeat.get(ev.winnerId) : undefined;
        if (seat && !this.placed.has(seat.unitId) && ending(seat)) {
          this.placed.add(seat.unitId);
          give(seat, this.variant === 'one_life' ? 'last_standing' : 'best_score');
        }
      }
    }
    this.note(world);
    return [...earned.values()];
  }

  private note(world: RoyalePointsWorld): void {
    for (const [id, u] of world.units) {
      if (u.kind === 'camp') this.camps.add(id);
      else if (u.kind === 'creature' || u.kind === 'warden') this.creatures.add(id);
    }
  }
}
