// The fill around the lanes a team's seats ask for (src/sim/fill.ts;
// CONTEXT.md: Fill, Lane preference; ADR 0026): an ask takes its lane's
// seat before any role does, the forest's ask (or a second top) leaves no
// seat for a house Jungler, bot lane goes by role, an ask whose seat is
// gone goes by its role, and a team that asks nothing is filled exactly as
// before, seat for seat and draw for draw.

import { describe, expect, it } from 'vitest';
import { houseSeats } from '../src/sim/content/bots/house';
import { JUNGLER } from '../src/sim/content/bots/jungler';
import { CHAMPION_LIST, CHAMPIONS, type ChampionRole } from '../src/sim/content/champions';
import {
  ELIGIBLE,
  type FilledSeat,
  fillSeats,
  type HeldSeat,
  type SeatKind,
  seatLane,
  TEAM_SIZE,
} from '../src/sim/fill';
import { Rng } from '../src/sim/rng';

const kinds = (seats: readonly FilledSeat[]): SeatKind[] => seats.map((s) => s.kind);

// The fill as it was before a seat could ask for a lane, kept here whole:
// the no-ask path of the live one must stay this, seat for seat and draw
// for draw, or every seed-pinned lineup and replay would move.
function roleRuleFill(held: readonly HeldSeat[], rng: Rng, size = TEAM_SIZE): FilledSeat[] {
  const open: SeatKind[] = (['mid', 'top', 'carry', 'support', 'jungle'] as SeatKind[]).slice(
    0,
    size,
  );
  const used = new Set<string>(held.map((h) => h.championId));
  const roleOf = (seat: HeldSeat): ChampionRole | null =>
    seat.role ?? CHAMPIONS[seat.championId]?.role ?? null;
  const consume = (kind: SeatKind | undefined): void => {
    if (kind === undefined) return;
    open.splice(open.indexOf(kind), 1);
  };
  const later: HeldSeat[] = [];
  for (const seat of held) {
    const role = roleOf(seat);
    const own =
      role !== null && role !== 'Skirmisher'
        ? open.find((k) => ELIGIBLE[k].includes(role))
        : undefined;
    if (own !== undefined) consume(own);
    else later.push(seat);
  }
  for (const seat of later) {
    const role = roleOf(seat);
    const fit = role !== null ? open.find((k) => ELIGIBLE[k].includes(role)) : undefined;
    consume(fit ?? open[0]);
  }
  const out: FilledSeat[] = [];
  for (const kind of open) {
    const unused = CHAMPION_LIST.filter((c) => !used.has(c.id));
    const eligible = unused.filter((c) => ELIGIBLE[kind].includes(c.role));
    const pool = eligible.length > 0 ? eligible : unused;
    if (pool.length === 0) break;
    const pick = pool[rng.int(pool.length)]!;
    used.add(pick.id);
    out.push({ championId: pick.id, kind });
  }
  return out;
}

describe('the fill around lane asks', () => {
  it('a seat asking for the forest takes the Jungler seat: no house Jungler beside it', () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const championId of ['sylra', 'vesk', 'korrath', 'torv']) {
        const held = [{ championId, lane: 'jungle' as const }];
        expect(kinds(fillSeats(held, new Rng(seed))), `${championId} seed ${seed}`).toEqual([
          'mid',
          'top',
          'carry',
          'support',
        ]);
        const house = houseSeats(held, new Rng(seed));
        expect(house.some((s) => s.bot === JUNGLER.id)).toBe(false);
        expect(house.map((s) => s.lane).sort()).toEqual(['bot', 'bot', 'mid', 'top']);
      }
    }
  });

  it('a mid ask takes mid whatever the role, and the fill completes the rest', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const seats = fillSeats([{ championId: 'vesk', lane: 'mid' }], new Rng(seed));
      expect(kinds(seats)).toEqual(['top', 'carry', 'support', 'jungle']);
      // A marksman beside them still, never vesk twice.
      const carry = seats.find((s) => s.kind === 'carry')!;
      expect(CHAMPIONS[carry.championId]!.role).toBe('Marksman');
      expect(carry.championId).not.toBe('vesk');
    }
    // Without the ask the same marksman takes the carry seat.
    expect(kinds(fillSeats([{ championId: 'vesk' }], new Rng(1)))).toEqual([
      'mid',
      'top',
      'support',
      'jungle',
    ]);
  });

  it('a second top takes the forest seat: two top laners and no house Jungler', () => {
    const held: HeldSeat[] = [
      { championId: 'korrath', lane: 'top' },
      { championId: 'sylra', lane: 'top' },
    ];
    for (let seed = 1; seed <= 20; seed++) {
      expect(kinds(fillSeats(held, new Rng(seed)))).toEqual(['mid', 'carry', 'support']);
      expect(houseSeats(held, new Rng(seed)).some((s) => s.bot === JUNGLER.id)).toBe(false);
    }
  });

  it('bot lane goes by role: the carry for a marksman, the support for a support, else the support first', () => {
    expect(kinds(fillSeats([{ championId: 'ashvyn', lane: 'bot' }], new Rng(4)))).toEqual([
      'mid',
      'top',
      'support',
      'jungle',
    ]);
    expect(kinds(fillSeats([{ championId: 'maera', lane: 'bot' }], new Rng(4)))).toEqual([
      'mid',
      'top',
      'carry',
      'jungle',
    ]);
    expect(kinds(fillSeats([{ championId: 'korrath', lane: 'bot' }], new Rng(4)))).toEqual([
      'mid',
      'top',
      'carry',
      'jungle',
    ]);
    // A second bot ask from anyone takes the carry's seat.
    expect(
      kinds(
        fillSeats(
          [
            { championId: 'korrath', lane: 'bot' },
            { championId: 'sylra', lane: 'bot' },
          ],
          new Rng(4),
        ),
      ),
    ).toEqual(['mid', 'top', 'jungle']);
  });

  it('an ask whose seat is gone goes by its role', () => {
    // Two mids: the first holds it, the mage after goes by the role rule,
    // which finds no mid seat and takes the first one open.
    expect(
      kinds(
        fillSeats(
          [
            { championId: 'fenn', lane: 'mid' },
            { championId: 'sylra', lane: 'mid' },
          ],
          new Rng(2),
        ),
      ),
    ).toEqual(['carry', 'support', 'jungle']);
    // A forest ask on a team too small for one is a seat asking nothing.
    expect(kinds(fillSeats([{ championId: 'korrath', lane: 'jungle' }], new Rng(2), 4))).toEqual([
      'mid',
      'carry',
      'support',
    ]);
  });

  it('asks go before roles: a seat asking nothing never takes the seat an ask wanted', () => {
    // The support asking for bot lane takes the support's seat even held
    // after a support who asked nothing, who then goes by the role rule.
    expect(
      kinds(fillSeats([{ championId: 'torv' }, { championId: 'maera', lane: 'bot' }], new Rng(6))),
    ).toEqual(['top', 'carry', 'jungle']);
  });

  it('every house seat carries the lane of its seat', () => {
    expect(seatLane('mid')).toBe('mid');
    expect(seatLane('top')).toBe('top');
    expect(seatLane('carry')).toBe('bot');
    expect(seatLane('support')).toBe('bot');
    expect(seatLane('jungle')).toBe('jungle');
    for (let seed = 1; seed <= 30; seed++) {
      const house = houseSeats([], new Rng(seed));
      const seats = fillSeats([], new Rng(seed));
      expect(house.map((s) => s.lane)).toEqual(seats.map((s) => seatLane(s.kind)));
      expect(house.find((s) => s.lane === 'jungle')?.bot).toBe(JUNGLER.id);
    }
  });

  it('a team that asks nothing is filled exactly as before, seat for seat and draw for draw', () => {
    const ids = CHAMPION_LIST.map((c) => c.id);
    let compared = 0;
    for (let seed = 1; seed <= 200; seed++) {
      // A held set drawn from the seed: none to four roster champions,
      // sometimes a forged one known only by its role.
      const pick = new Rng(seed * 7919);
      const held: HeldSeat[] = [];
      const count = pick.int(5);
      for (let i = 0; i < count; i++) {
        const id = ids[pick.int(ids.length)]!;
        if (held.some((h) => h.championId === id)) continue;
        held.push({ championId: id });
      }
      if (pick.int(4) === 0) held.push({ championId: 'forged-x', role: 'Skirmisher' });
      for (const size of [TEAM_SIZE, 4, 3]) {
        const before = new Rng(seed);
        const expected = roleRuleFill(held, before, size);
        for (const lane of [undefined, null] as const) {
          const now = new Rng(seed);
          const asked = held.map((h) => (lane === undefined ? h : { ...h, lane }));
          expect(fillSeats(asked, now, size), `seed ${seed} size ${size}`).toEqual(expected);
          expect(now.state).toBe(before.state);
          compared += 1;
        }
      }
    }
    expect(compared).toBe(200 * 3 * 2);
  });
});
