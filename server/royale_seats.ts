// Who sits in a battle royale (ADR 0031): the people who started it, each
// on the champion they picked, and house bots on every other seat, each
// with an invented name (server/royale_names.ts), a champion of the roster
// drawn from the match seed (duplicates allowed), a pair of sigils and a
// skin. Each bot's skill is the sim's to deal from the seed
// (src/net/replay.ts buildRoyaleSim): about half gentle, a third normal,
// the rest strong, softer when everyone the match started with is a Guest,
// which the seats tell it. Pure: the same seed and people seat the same
// match.

import {
  CHAMPION_LIST,
  CHAMPIONS,
  type ChampionDef,
  DEFAULT_CHAMPION_ID,
} from '../src/sim/content/champions';
import { SIGIL_LIST, SIGILS } from '../src/sim/content/sigils';
import { clampSkin, SKINS } from '../src/sim/content/skins';
import { Rng } from '../src/sim/rng';
import { ROYALE_SEATS } from '../src/sim/royale/types';
import { botNames } from './royale_names';
import type { RoyaleSeatPick } from './royale_sim';

export const DEFAULT_SIGILS: [string, string] = ['riftstep', 'mend'];

// A person's pick off the wire, made valid: a roster champion this person
// may play (ADR 0018; the first they may when not), two distinct sigils,
// a skin of that champion.
export interface RoyalePick {
  championId: string;
  sigils: [string, string];
  skin: number;
}

export function royalePick(
  raw: { championId?: unknown; sigils?: unknown; skin?: unknown },
  playable: readonly string[] | null,
): RoyalePick {
  const mayPick = (id: string): boolean => playable === null || playable.includes(id);
  let championId =
    typeof raw.championId === 'string' && CHAMPIONS[raw.championId]
      ? raw.championId
      : DEFAULT_CHAMPION_ID;
  if (!mayPick(championId)) championId = playable?.find((id) => CHAMPIONS[id]) ?? championId;
  const s = raw.sigils;
  const valid =
    Array.isArray(s) &&
    s.length === 2 &&
    s[0] !== s[1] &&
    s.every((id) => typeof id === 'string' && SIGILS[id] !== undefined);
  return {
    championId,
    sigils: valid ? [s[0] as string, s[1] as string] : [...DEFAULT_SIGILS],
    skin: clampSkin(championId, raw.skin),
  };
}

// One person seated at the start.
export interface RoyalePerson {
  clientId: number;
  // The account, or a Guest's negative id (server/guests.ts).
  owner: number;
  name: string;
  guest: boolean;
  pick: RoyalePick;
  // Never banked a battle royale award (RoyaleDeps.newcomer): the seat is
  // flagged for the builder (RoyaleSeatPick.newcomer). Absent otherwise.
  newcomer?: boolean;
}

// A seat as the match keeps it: the pick the sim was built from, and who
// sat in it at the start (a person's client id, or null for a bot).
export interface RoyaleSeat extends RoyaleSeatPick {
  clientId: number | null;
}

// Every seat of a new match: the people first, in the order given, then
// the bots. Whether they play softer is decided here, once, by the people
// the match starts with (ADR 0027 keeps a match's softening from its
// start).
export function royaleSeats(
  people: readonly RoyalePerson[],
  seed: number,
  seats: number = ROYALE_SEATS,
): RoyaleSeat[] {
  const rng = new Rng(seed ^ 0x5eed);
  const out: RoyaleSeat[] = [];
  for (const p of people.slice(0, seats)) {
    out.push({
      name: p.name,
      team: out.length,
      championId: p.pick.championId,
      sigils: [p.pick.sigils[0], p.pick.sigils[1]],
      skin: p.pick.skin,
      clientId: p.clientId,
      ...(p.newcomer ? { newcomer: true } : {}),
    });
  }
  const botCount = seats - out.length;
  const onlyGuests = people.length > 0 && people.every((p) => p.guest);
  const names = botNames(
    botCount,
    rng,
    people.map((p) => p.name),
  );
  // The house bots' champions: the roster dealt round and shuffled on the
  // seed, so every champion sits in about as many seats as any other and a
  // person dropping into a running match finds a seat playing the champion
  // they picked (royale_join.ts chooseBotSeat). Drawn at random, a match
  // could hold no Dain at all, and a Guest who picked Dain played whoever
  // the seat held (a playtest, 2026-10-03).
  const deck: ChampionDef[] = [];
  while (deck.length < botCount) deck.push(...CHAMPION_LIST);
  deck.length = botCount;
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = t;
  }
  for (let i = 0; i < botCount; i++) {
    const champion = deck[i]!;
    const a = rng.int(SIGIL_LIST.length);
    const b = (a + 1 + rng.int(SIGIL_LIST.length - 1)) % SIGIL_LIST.length;
    const skins = SKINS[champion.id]?.length ?? 1;
    out.push({
      name: names[i]!,
      team: out.length,
      championId: champion.id,
      sigils: [SIGIL_LIST[a]!.id, SIGIL_LIST[b]!.id],
      skin: rng.int(skins),
      clientId: null,
      bot: { softened: onlyGuests },
    });
  }
  return out;
}
