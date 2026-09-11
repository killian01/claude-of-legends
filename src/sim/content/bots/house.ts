// The house styles (CONTEXT.md: House style; docs/design/bots.md, the
// bar's variety): the brains a house bot may play. One brain on every seat
// made every sparring the same match with other champions; now each lane
// seat the fill hands out draws one of four from the match seed, on every
// host (the server backfill, the Arena, sparring and the series, offline
// practice, the environment), so two matches on different seeds are not
// played the same way; the forest's seat plays the Jungler, the fifth
// style, by post rather than by draw (ADR 0023). The styles are drawn on
// the fill's stream right after the team's champions, so the lineup a
// seed gives stays the fill's.

import { fillSeats, type HeldSeat, TEAM_SIZE } from '../../fill';
import type { Rng } from '../../rng';
import { BRAWLER } from './brawler';
import { JUNGLER } from './jungler';
import { type BotDef, LANER } from './laner';
import { OBJECTIVE } from './objective';
import { SIEGER } from './sieger';

// The four a lane seat draws among.
export const LANE_STYLES: readonly BotDef[] = [LANER, BRAWLER, SIEGER, OBJECTIVE];

export const HOUSE_STYLES: readonly BotDef[] = [...LANE_STYLES, JUNGLER];

export const HOUSE_STYLE_IDS: readonly string[] = HOUSE_STYLES.map((b) => b.id);

// One lane style, uniform over the four.
export function drawHouseStyle(rng: Rng): string {
  return LANE_STYLES[rng.int(LANE_STYLES.length)]!.id;
}

// A house bot's seat name with its style said, "House sieger", so the
// scoreboard and the replay tell the styles apart. Named by no one still:
// the name is the style's.
export function houseName(botId: string): string {
  const def = HOUSE_STYLES.find((b) => b.id === botId) ?? LANER;
  return `House ${def.name.toLowerCase()}`;
}

export interface HouseSeat {
  championId: string;
  bot: string;
}

// The seats house bots take on one team: the fill's champions around what
// the team holds, then a style per seat, in that order on the one stream:
// the Jungler on the forest's seat, a draw on every lane seat.
export function houseSeats(held: readonly HeldSeat[], rng: Rng, size = TEAM_SIZE): HouseSeat[] {
  return fillSeats(held, rng, size).map((seat) => ({
    championId: seat.championId,
    bot: seat.kind === 'jungle' ? JUNGLER.id : drawHouseStyle(rng),
  }));
}
