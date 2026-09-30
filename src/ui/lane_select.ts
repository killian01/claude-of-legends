// The lane row at champion select (CONTEXT.md: Lane preference; ADR 0026),
// without the DOM: the four choices and the words every screen says them
// in, the lane preselected before the player chooses, which buttons are
// greyed because the team has no room left there, the forest's warning,
// and the own team's lane board. src/ui/menu.ts draws what this decides.
// The rules for what is open are the server's own (src/sim/lane_picks.ts),
// so the select never offers a lane the matchmaker would refuse.

import type { SelectClaim, SelectPlayer } from '../net/protocol';
import type { ChampionRole } from '../sim/content/champions';
import { defaultLane, forestFit, LANE_CHOICES, laneOpen } from '../sim/lane_picks';
import type { LanePreference } from '../sim/playbook/types';
import type { TeamId } from '../sim/types';

export { LANE_CHOICES };

// A lane is always said in full: a bare "bot" is the owned bot (CONTEXT.md,
// Bot lane), and the Jungler's post is "the forest" on screen.
const TITLES: Readonly<Record<LanePreference, string>> = {
  top: 'Top lane',
  mid: 'Mid lane',
  bot: 'Bot lane',
  jungle: 'The forest',
};

// The lane as a label or at the start of a line: "Top lane", "The forest".
export function laneTitle(lane: LanePreference): string {
  return TITLES[lane];
}

// The lane inside a sentence: "top lane", "the forest".
export function laneWords(lane: LanePreference): string {
  return lane === 'jungle' ? 'the forest' : `${lane} lane`;
}

// The player's lane at select: the lane on screen, and whether they chose
// it. Until they do, it is the preselection, and follows the champion.
export interface LaneChoice {
  lane: LanePreference;
  chosen: boolean;
}

// The lanes the other seats of the player's own team claim (select_update's
// claims, which carry the own team only); self is the player's seat, null
// offline, where nobody else claims anything.
export function claimsBeside(
  claims: readonly SelectClaim[],
  self: number | null,
): LanePreference[] {
  const out: LanePreference[] = [];
  for (const c of claims) if (c.seat !== self && c.lane !== null) out.push(c.lane);
  return out;
}

// What the select opens on: the lane the server would default the seat to.
export function preselect(role: ChampionRole | null, taken: readonly LanePreference[]): LaneChoice {
  return { lane: defaultLane(role, taken), chosen: false };
}

// A champion picked: the preselection follows its home lane; a lane the
// player chose stays.
export function onChampion(
  choice: LaneChoice,
  role: ChampionRole | null,
  taken: readonly LanePreference[],
): LaneChoice {
  return choice.chosen ? choice : preselect(role, taken);
}

// A lane clicked: it is the player's while the team has room there; a full
// lane changes nothing (its button is greyed anyway).
export function chooseLane(
  choice: LaneChoice,
  lane: LanePreference,
  taken: readonly LanePreference[],
): LaneChoice {
  return laneOpen(taken, lane) ? { lane, chosen: true } : choice;
}

// The team's claims moved (a select_update): the player's lane stands while
// it has room beside the others' claims. A chosen lane a teammate filled
// first (first come, first served) falls back to the seat's own claim on
// the server when that one still has room, else to the preselection; the
// preselection itself is recomputed, since what is open changed.
export function reconcile(
  choice: LaneChoice,
  role: ChampionRole | null,
  taken: readonly LanePreference[],
  own: LanePreference | null,
): LaneChoice {
  if (!choice.chosen) return preselect(role, taken);
  if (laneOpen(taken, choice.lane)) return choice;
  if (own !== null && laneOpen(taken, own)) return { lane: own, chosen: true };
  return preselect(role, taken);
}

// Whether a lane's button is greyed: the team has no room left there
// beside the other seats' claims.
export function laneFull(taken: readonly LanePreference[], lane: LanePreference): boolean {
  return !laneOpen(taken, lane);
}

// The line under the row when the forest is chosen for a champion the fill
// would never post there (anyone may go; nothing is blocked), else null.
export function forestWarning(
  lane: LanePreference,
  name: string | null,
  role: ChampionRole | null,
): string | null {
  if (lane !== 'jungle' || name === null || forestFit(role)) return null;
  return `${name} is not built for the forest: camps will be slow.`;
}

// The lane an account's bot plays (ADR 0013): its playbook's first, which
// the sim seats ahead of anything chosen at select, else what the server
// settles the seat on. Shown in the row, which the bot card disables.
export function botLane(
  lanes: readonly LanePreference[] | undefined,
  role: ChampionRole | null,
  taken: readonly LanePreference[],
): LanePreference {
  return lanes?.[0] ?? defaultLane(role, taken);
}

export interface BoardRow {
  lane: LanePreference;
  label: string;
  // Who claimed it: "You" first, then teammates by name, in seat order.
  who: string[];
  // The player's own lane.
  own: boolean;
}

// The own team's lane board: one row per lane with who claimed it. The
// player is shown on the lane on their screen (claimed or preselected);
// teammates by their claims, by seat index in select_start's players,
// never by name (two Guests can share one). Seats that claim nothing are
// not listed: the bots and the defaults fill the rest.
export function laneBoard(
  claims: readonly SelectClaim[],
  players: readonly SelectPlayer[],
  self: number | null,
  own: LanePreference,
): BoardRow[] {
  return LANE_CHOICES.map((lane) => {
    const who: string[] = lane === own ? ['You'] : [];
    for (const c of claims) {
      if (c.seat === self || c.lane !== lane) continue;
      who.push(players[c.seat]?.name ?? 'A teammate');
    }
    return { lane, label: laneTitle(lane), who, own: lane === own };
  });
}

// The player's teammates in the select who claim no lane yet, in seat
// order: the people the board does not list under a lane.
export function stillChoosing(
  claims: readonly SelectClaim[],
  players: readonly SelectPlayer[],
  self: number | null,
  team: TeamId,
): string[] {
  const out: string[] = [];
  for (const [seat, p] of players.entries()) {
    if (seat === self || p.team !== team) continue;
    const lane = claims.find((c) => c.seat === seat)?.lane ?? null;
    if (lane === null) out.push(p.name);
  }
  return out;
}
