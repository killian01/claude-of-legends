// The battle royale's quick pick, decided (ADR 0031): one card, the ten
// champions of the roster with no lanes, no bans and no clock, the last
// one played already chosen, the skin and the two sigils kept from last
// time, a Random button and a big Play. Duplicates are allowed, so nothing
// is ever taken. Pure: ui/royale_pick.ts draws it and the browser's
// settings remember it (game/settings.ts royalePick).

import type { RoyalePickMemory } from '../game/settings';

export interface RoyalePick {
  championId: string;
  skin: number;
  sigils: [string, string];
}

// A first pick's sigils, the ones champion select starts on too.
export const DEFAULT_SIGILS: [string, string] = ['riftstep', 'mend'];

// The champion a browser's first battle royale opens the quick pick on,
// with no pick remembered. A drop-in plays the champion it picked
// (server/royale_join.ts chooseBotSeat), so this is what a first battle
// royale lands with. Dain is a fighter, with a fighter's health and blows that
// land in reach: of the duels on the planet (scripts/royale_duel.ts,
// seeds 1 to 10, 2026-10-08) he wins 71% at landing and 67% after the
// calm, second and third of the ten. Sylra, the house default, wins more
// from a bot's hands, but a Mage keeps her foes off with aimed spells, and
// a first fight on the planet is won with what lands.
export const FIRST_ROYALE_CHAMPION = 'dain';

// What the card opens on: the pick remembered, kept to what exists now (a
// champion still in the roster, a skin it still has, two sigils that still
// exist), else the house default.
export function initialPick(
  memory: RoyalePickMemory | null,
  roster: readonly string[],
  skinsOf: (championId: string) => number,
  sigilIds: readonly string[],
  fallback: string,
): RoyalePick {
  const known = memory !== null && roster.includes(memory.championId);
  const championId = known ? memory.championId : roster.includes(fallback) ? fallback : roster[0]!;
  const skin = known && memory.skin < skinsOf(championId) ? memory.skin : 0;
  const kept = memory?.sigils;
  const sigils: [string, string] =
    kept && kept[0] !== kept[1] && kept.every((id) => sigilIds.includes(id))
      ? [kept[0], kept[1]]
      : [...DEFAULT_SIGILS];
  return { championId, skin, sigils };
}

// The Random button: any champion but the one on screen, so a press always
// changes something. `roll` is a draw in [0, 1).
export function randomChampion(roster: readonly string[], current: string, roll: number): string {
  const others = roster.filter((id) => id !== current);
  if (others.length === 0) return current;
  const i = Math.min(others.length - 1, Math.max(0, Math.floor(roll * others.length)));
  return others[i]!;
}

// A sigil clicked: off when it was on, on otherwise, the older of two
// leaving to make room; the way champion select picks them (ui/menu.ts).
export function toggleSigil(sigils: readonly string[], id: string): string[] {
  if (sigils.includes(id)) return sigils.filter((s) => s !== id);
  const next = [...sigils, id];
  return next.length > 2 ? next.slice(next.length - 2) : next;
}

// Play stands ready once two sigils are chosen.
export function pickReady(sigils: readonly string[]): sigils is [string, string] {
  return sigils.length === 2 && sigils[0] !== sigils[1];
}

// A champion changed: its first skin, since skins are the champion's own.
export function withChampion(pick: RoyalePick, championId: string): RoyalePick {
  return championId === pick.championId ? pick : { ...pick, championId, skin: 0 };
}
