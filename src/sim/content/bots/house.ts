// The house styles (CONTEXT.md: House style; docs/design/bots.md, the
// bar's variety): the brains a house bot may play. One brain on every seat
// made every sparring the same match with other champions; now each seat
// the fill hands out draws one of four from the match seed, on every host
// (the server backfill, the Arena, sparring and the series, offline
// practice, the environment), so two matches on different seeds are not
// played the same way. The styles are drawn on the fill's stream right
// after the team's champions, so the lineup a seed gives stays the fill's.

import { fillTeam, type HeldSeat, TEAM_SIZE } from '../../fill';
import type { Rng } from '../../rng';
import { BRAWLER } from './brawler';
import { type BotDef, LANER } from './laner';
import { OBJECTIVE } from './objective';
import { SIEGER } from './sieger';

export const HOUSE_STYLES: readonly BotDef[] = [LANER, BRAWLER, SIEGER, OBJECTIVE];

export const HOUSE_STYLE_IDS: readonly string[] = HOUSE_STYLES.map((b) => b.id);

// One style, uniform over the four.
export function drawHouseStyle(rng: Rng): string {
  return HOUSE_STYLES[rng.int(HOUSE_STYLES.length)]!.id;
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
// the team holds, then a style per seat, in that order on the one stream.
export function houseSeats(held: readonly HeldSeat[], rng: Rng, size = TEAM_SIZE): HouseSeat[] {
  return fillTeam(held, rng, size).map((championId) => ({
    championId,
    bot: drawHouseStyle(rng),
  }));
}
