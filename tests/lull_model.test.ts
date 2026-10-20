// The Lull's card, decided (src/ui/lull_model.ts): its head, its table of
// bushels (all eight on a desktop, five on a phone), its foot, when it
// stands and when the last bout's end beat comes first.

import { describe, expect, it } from 'vitest';
import type { BoutStart, BoutTableRow, SnapRoyale } from '../src/net/royale_wire';
import { BOUT_KINDS, boutKindOf } from '../src/sim/content/bouts';
import { END_BEAT_S } from '../src/ui/bout_text';
import {
  endBeatDue,
  FINAL_LINE,
  lullAsk,
  lullModel,
  lullUp,
  PHONE_ROWS,
  phoneRows,
  prizeLine,
} from '../src/ui/lull_model';

const STARGLEAN = BOUT_KINDS.find((k) => k.id === 'starglean')!;
const LASTWICK = BOUT_KINDS.find((k) => k.id === 'lastwick')!;
const kindName = (id: string): string | null => boutKindOf(id)?.name ?? null;

// Eight seats, best first: seat 3 on 12, seat 5 on 10, ..., seat 0 (the
// person's by default) wherever `own` puts it.
function table(own = 1): BoutTableRow[] {
  const order = [3, 5, 1, 2, 4, 6, 7];
  order.splice(own, 0, 0);
  return order.map(
    (seat, i): BoutTableRow => [
      seat,
      seat + 1,
      seat === 0 ? 'Wren' : `Seat ${seat}`,
      'torv',
      seat === 0 ? 0 : 1,
      12 - i,
      i < 5 ? 5 - i : 0,
      i === 0 ? 2 : 0,
    ],
  );
}

const start = (over: Partial<BoutStart> = {}): BoutStart => ({
  b: 2,
  k: ['lastwick', 'starglean', 'starglean', 'lastwick', 'starglean', 'lastwick'],
  s: 0,
  t: table(),
  p: 3,
  ...over,
});

const drop = (over: Partial<SnapRoyale> = {}): Pick<SnapRoyale, 'de' | 'drop'> & SnapRoyale => ({
  v: 'respawn',
  st: 'drop',
  de: 10,
  end: 115,
  dusk: { p: 0, c: [0, 80, 0], r: 40, pe: 30, sh: 0, b: 0.03 },
  alive: 8,
  people: 1,
  ...over,
});

const desk = { touch: false, compact: false, kindName };
const phone = { touch: true, compact: true, kindName };

describe("the Lull's card", () => {
  it('heads with the bout, its rule and when it lands', () => {
    const m = lullModel(start(), STARGLEAN, drop(), 3.2, desk);
    expect(m.title).toBe('Bout 3 of 6 · Starglean');
    expect(m.rule).toBe('Most gleaned wins');
    expect(m.final).toBeNull();
    expect(m.clock).toBe('Lands in 7');
    expect(lullModel(start(), STARGLEAN, drop(), 3.2, phone).clock).toBe('7 s');
  });

  it('lists all eight on a desktop, best first, the person marked, what the last bout paid', () => {
    const m = lullModel(start(), STARGLEAN, drop(), 3, desk);
    expect(m.rows).toHaveLength(8);
    expect(m.rows.map((r) => r.place)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(m.rows[0]).toMatchObject({ seat: 3, name: 'Seat 3', bot: true, bushels: 12, last: 5 });
    expect(m.rows.filter((r) => r.self).map((r) => r.seat)).toEqual([0]);
  });

  it('shows no last pay in the first Lull, everyone at nothing', () => {
    const first = start({
      b: 0,
      p: undefined,
      t: table().map((r): BoutTableRow => [r[0], r[1], r[2], r[3], r[4], 0, 0, 0]),
    });
    const m = lullModel(first, LASTWICK, drop(), 0, desk);
    expect(m.rows.every((r) => r.last === null && r.bushels === 0)).toBe(true);
    expect(m.prize).toBeNull();
  });

  it("keeps a phone's five rows: the top five, or the top three, the seat above and the person", () => {
    for (const own of [0, 3, 4]) {
      const rows = lullModel(start({ t: table(own) }), STARGLEAN, drop(), 3, phone).rows;
      expect(rows.map((r) => r.place)).toEqual([1, 2, 3, 4, 5]);
    }
    const sixth = lullModel(start({ t: table(5) }), STARGLEAN, drop(), 3, phone).rows;
    expect(sixth.map((r) => r.place)).toEqual([1, 2, 3, 5, 6]);
    const last = lullModel(start({ t: table(7) }), STARGLEAN, drop(), 3, phone).rows;
    expect(last.map((r) => r.place)).toEqual([1, 2, 3, 7, 8]);
    expect(last.at(-1)?.self).toBe(true);
    expect(PHONE_ROWS).toBe(5);
    expect(phoneRows([])).toEqual([]);
  });

  it("names the prize: the last bout's winner and the kind it took", () => {
    const m = lullModel(start(), STARGLEAN, drop(), 3, desk);
    // Bout 3 follows bout 2, a Starglean, won by seat 3.
    expect(m.prize).toBe('Seat 3 took Starglean and picks a Graft');
    expect(lullModel(start(), STARGLEAN, drop(), 3, phone).prize).toBe('Seat 3 picks a Graft');
    const mine = lullModel(start({ p: 0 }), STARGLEAN, drop(), 3, desk);
    expect(mine.prize).toBe('You took Starglean: pick your Graft');
    expect(prizeLine({ name: 'Wren', kind: 'Lastwick', self: true }, true)).toBe('Pick your Graft');
  });

  it('says the Final pays double', () => {
    const m = lullModel(start({ b: 5 }), LASTWICK, drop(), 3, desk);
    expect(m.title).toBe('The Final · Lastwick');
    expect(m.final).toBe(FINAL_LINE);
  });

  it("asks for the globe's tap, and says a landing is picked", () => {
    expect(lullModel(start(), STARGLEAN, drop(), 3, phone).ask).toBe('Tap the globe to land');
    expect(lullModel(start(), STARGLEAN, drop({ drop: [0, 80, 0] }), 3, desk).ask).toBe(
      'Landing picked: click to change it',
    );
    expect(lullAsk(true, true)).toBe('Landing picked: tap to change it');
  });
});

describe("the Lull's beats", () => {
  it('opens on the end beat from the second Lull, then the card', () => {
    expect(endBeatDue(start(), drop(), 0.1)).toBe(true);
    expect(endBeatDue(start(), drop(), END_BEAT_S)).toBe(false);
    expect(endBeatDue(start({ b: 0 }), drop(), 0.1)).toBe(false);
    expect(lullUp(start(), drop(), 0.5)).toBe(false);
    expect(lullUp(start(), drop(), END_BEAT_S)).toBe(true);
    // The first Lull has no beat: its card stands at once.
    expect(lullUp(start({ b: 0 }), drop(), 0)).toBe(true);
  });

  it('stands through the Lull alone', () => {
    expect(lullUp(start(), drop({ st: 'play' }), 30)).toBe(false);
    expect(endBeatDue(start(), drop({ st: 'play' }), 0.1)).toBe(false);
  });
});
