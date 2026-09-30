// The fill (CONTEXT.md): the champions house bots take to complete a team,
// by the roster's lanes (docs/design/roster.md). Five seats: one mid (a
// mage, an assassin or a battlemage), one top (a tank or a fighter), a
// marksman and a support for bot, and the forest's (ADR 0023: a fighter,
// a tank, a skirmisher or an assassin, the Jungler's post); the
// skirmisher is flex, eligible for a top, a mid or the forest's seat. The
// seats a team already holds are consumed first: a seat that asks for a
// lane takes that lane's seat while it is open (CONTEXT.md: Lane
// preference; ADR 0026), the rest by role (a fixed role takes its own
// seat, the flex and the unknown take the first seat open); then each
// open seat draws among the roster champions eligible for it that the
// team does not hold, from the match's Rng: the fill varies by seed and
// complements what the team has, so a lone marksman gets a support
// beside them. A seat with nobody eligible left draws among whatever is
// unused. Duplicates are forbidden inside a team only; the other team may
// hold the same champion. The lane each one then plays is the sim's call
// (src/sim/lanes.ts), from the lane its seat asks for (seatLane: a house
// bot carries its seat's) ahead of its role's home lane. A smaller team
// fills its lanes first and fields no jungler.

import { CHAMPION_LIST, CHAMPIONS, type ChampionRole } from './content/champions';
import type { LanePreference } from './playbook/types';
import type { Rng } from './rng';

export const TEAM_SIZE = 5;

export type SeatKind = 'mid' | 'top' | 'carry' | 'support' | 'jungle';

const SEATS: readonly SeatKind[] = ['mid', 'top', 'carry', 'support', 'jungle'];

export const ELIGIBLE: Readonly<Record<SeatKind, readonly ChampionRole[]>> = {
  mid: ['Mage', 'Assassin', 'Battlemage', 'Skirmisher'],
  top: ['Tank', 'Fighter', 'Skirmisher'],
  carry: ['Marksman'],
  support: ['Support'],
  jungle: ['Fighter', 'Tank', 'Skirmisher', 'Assassin'],
};

const FLEX: ChampionRole = 'Skirmisher';

// The lane a seat of each kind asks for: what a house bot carries as its
// seat's lane preference (ADR 0026), so a skirmisher drawn for mid plays
// mid rather than drifting to the lane its missing home lane ties to.
const SEAT_LANES: Readonly<Record<SeatKind, LanePreference>> = {
  mid: 'mid',
  top: 'top',
  carry: 'bot',
  support: 'bot',
  jungle: 'jungle',
};

export function seatLane(kind: SeatKind): LanePreference {
  return SEAT_LANES[kind];
}

export interface HeldSeat {
  championId: string;
  // The role when the champion is not on the roster (a forged one); a
  // roster champion's role is looked up, an unknown one is flex.
  role?: ChampionRole | null | undefined;
  // The lane the seat asks for (CONTEXT.md: Lane preference): a person's
  // choice at champion select, a bot's playbook's first lane. Absent or
  // null asks nothing, and the role decides as it always did.
  lane?: LanePreference | null | undefined;
}

function roleOf(seat: HeldSeat): ChampionRole | null {
  return seat.role ?? CHAMPIONS[seat.championId]?.role ?? null;
}

// The seat an ask takes while it is open: the forest's for the forest,
// mid's for mid, top's for top and the forest's for a second top (two
// top laners leave no room for a house Jungler), and for bot lane the
// carry's for a marksman, the support's for a support, the support's
// else the carry's for anyone else. Undefined when that seat is gone.
function askedSeat(
  lane: LanePreference,
  role: ChampionRole | null,
  open: readonly SeatKind[],
): SeatKind | undefined {
  const free = (kind: SeatKind): SeatKind | undefined => (open.includes(kind) ? kind : undefined);
  switch (lane) {
    case 'jungle':
      return free('jungle');
    case 'mid':
      return free('mid');
    case 'top':
      return free('top') ?? free('jungle');
    case 'bot':
      if (role === 'Marksman') return free('carry');
      if (role === 'Support') return free('support');
      return free('support') ?? free('carry');
  }
}

export interface FilledSeat {
  championId: string;
  kind: SeatKind;
}

// The champions alone, in seat order.
export function fillTeam(held: readonly HeldSeat[], rng: Rng, size = TEAM_SIZE): string[] {
  return fillSeats(held, rng, size).map((seat) => seat.championId);
}

// The champions with the seat each fills.
export function fillSeats(held: readonly HeldSeat[], rng: Rng, size = TEAM_SIZE): FilledSeat[] {
  const open: SeatKind[] = SEATS.slice(0, size);
  const used = new Set<string>(held.map((h) => h.championId));
  const consume = (kind: SeatKind | undefined): void => {
    if (kind === undefined) return;
    open.splice(open.indexOf(kind), 1);
  };
  // Asks go first, in the order held; an ask whose seat is gone goes by
  // its role with the seats that ask nothing. With no ask anywhere this
  // is the role rule alone, seat for seat and draw for draw.
  const byRole: HeldSeat[] = [];
  for (const seat of held) {
    const asked = seat.lane ? askedSeat(seat.lane, roleOf(seat), open) : undefined;
    if (asked !== undefined) consume(asked);
    else byRole.push(seat);
  }
  // Fixed roles take their own seats first, so a flex or an unknown
  // champion held earlier never steals a seat from a role that needs it.
  const later: HeldSeat[] = [];
  for (const seat of byRole) {
    const role = roleOf(seat);
    const own =
      role !== null && role !== FLEX ? open.find((k) => ELIGIBLE[k].includes(role)) : undefined;
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
