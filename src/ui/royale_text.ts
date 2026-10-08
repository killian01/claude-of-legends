// What the battle royale's HUD says (ADR 0031): the Dusk line and the count
// at the top of the screen, the drop's banner, the badge of a mark the
// viewer carries,
// the cache being opened, the loot and level notices, the kill feed's
// names with their bot marks, a Respawn death's recap and its life line,
// and the place a champion finished in. Pure:
// the HUD hands in the mode's state as the last snapshot told it
// (SnapRoyale, src/net/royale_wire.ts) and draws the words this answers
// (ui/royale_hud.ts).

import type { SnapDusk, SnapRoyale } from '../net/royale_wire';
import { ITEM_PASSIVES } from '../sim/content/item_passives';
import { ITEMS, type ItemDef, type ItemStats } from '../sim/content/items';
import { nextLootPiece, seatBuild } from '../sim/royale/loot';
import { CACHE_OPEN_S, MARK_SHOWN_S, type MarkKind } from '../sim/royale/types';

// Seconds as a clock, rounded up so it reads 0:01 until the moment passes.
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// The Dusk's phase in a word, for the line's color.
export type DuskTone = 'calm' | 'hold' | 'close' | 'dark';

// The Dusk line: the calm counting down, the light holding, the Dusk
// closing, and the last light once it is out.
export function duskLine(
  r: Pick<SnapRoyale, 'st' | 'dusk'>,
  time: number,
): {
  text: string;
  tone: DuskTone;
} {
  const d = r.dusk;
  if (r.st === 'over' || d.p >= 6) return { text: 'Last light', tone: 'dark' };
  const left = clockText(d.pe - time);
  // The calm says what it is waiting for: the Dusk, holding off.
  if (d.p === 0) return { text: `Dusk in ${left}`, tone: 'calm' };
  if (d.sh === 1) return { text: `The Dusk closes ${left}`, tone: 'close' };
  return { text: `Light holds ${left}`, tone: 'hold' };
}

export function peopleText(n: number): string {
  return n === 1 ? '1 person' : `${n} people`;
}

// The count beside the Dusk line. One life: who is still in and the own
// takedowns. Respawn: the own rank of everyone in the match, the own
// takedowns, and how far behind the seat above (the lead, when first),
// "#14 of 50 · 3 takedowns · 2 behind #13"; for a drop-in (rs) the rank
// since they landed, "#4 since you landed · 3 takedowns · 1 behind #3",
// which the server sends from their first takedown since then. Before
// anyone lands, how many are in the match. On a phone (`compact`) the top
// is one row beside the Dusk line and the minimap: the rank line leaves
// the takedowns out.
export function countLine(
  r: Pick<SnapRoyale, 'v' | 'st' | 'alive' | 'people' | 'score' | 'rk' | 'gap' | 'rs'>,
  compact = false,
): string {
  if (r.st === 'drop') return `${r.alive} in the match, ${peopleText(r.people)}`;
  const takedowns = takedownsText(r.score ?? 0);
  if (r.v === 'one_life') return `${r.alive} left · ${takedowns}`;
  if (r.rk === undefined) return takedowns;
  const gap = gapText(r.rk, r.gap ?? 0);
  const rank = r.rs === 1 ? `#${r.rk} since you landed` : `#${r.rk} of ${r.alive}`;
  return compact ? `${rank} · ${gap}` : `${rank} · ${takedowns} · ${gap}`;
}

// Who ended a Respawn life, on the wash of the death: the seat's name and,
// while the killer's body was in sight, its level, champion and health
// then, "Taken down by Pinetinder, a level 6 Korrath on 31% health" (a
// whole percent, at least 1%: it still stood). The champion's title after
// its comma is left out, and the champion itself when it is the name.
export function royaleRecap(
  killerName: string,
  killer: { champion: string; level: number; hpShare: number } | null,
): string {
  if (!killer) return `Taken down by ${killerName}`;
  const champion = killer.champion.split(',')[0]?.trim() || killer.champion;
  const pct = Math.min(100, Math.max(1, Math.round(killer.hpShare * 100)));
  const body =
    champion === killerName ? `level ${killer.level}` : `a level ${killer.level} ${champion}`;
  return `Taken down by ${killerName}, ${body} on ${pct}% health`;
}

// A life's length on the wash: seconds under a minute, "42 s", the clock
// past it, "2:05".
function lifeClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function assistsText(n: number): string {
  return n === 1 ? '1 assist' : `${n} assists`;
}

// What the Respawn life that just ended held, under the wash's subtitle:
// "This life: 42 s · 1 takedown · 2 assists", a count of zero left out.
export function lifeLine(seconds: number, takedowns: number, assists: number): string {
  const parts = [`This life: ${lifeClock(seconds)}`];
  if (takedowns > 0) parts.push(takedownsText(takedowns));
  if (assists > 0) parts.push(assistsText(assists));
  return parts.join(' · ');
}

// The gap of the rank line: behind the seat above, level with it, or the
// lead when first.
export function gapText(rank: number, gap: number): string {
  if (rank <= 1) return gap > 0 ? `Leading by ${gap}` : 'Tied for the lead';
  return gap > 0 ? `${gap} behind #${rank - 1}` : `Level with #${rank - 1}`;
}

// The drop's banner: the ask, in the words of the hands on the screen, and
// the seconds left to answer it.
export function dropBanner(
  r: Pick<SnapRoyale, 'st' | 'de' | 'drop'>,
  time: number,
  touch: boolean,
): { text: string; left: string; picked: boolean } | null {
  if (r.st !== 'drop') return null;
  const left = `${Math.max(0, Math.ceil(r.de - time))} s`;
  const picked = r.drop !== undefined;
  const verb = touch ? 'tap' : 'click';
  return {
    text: picked
      ? `Landing there: ${verb} the planet to change it`
      : `Pick where to land: ${verb} the planet`,
    left,
    picked,
  };
}

// How far the own cache is opened, 0 to 1, or null while none is: over
// the opening's own length when the server sends one (a Seedfall cache's),
// else CACHE_OPEN_S.
export function openingFraction(r: Pick<SnapRoyale, 'opening'>, time: number): number | null {
  if (!r.opening) return null;
  const d = r.opening.d !== undefined && r.opening.d > 0 ? r.opening.d : CACHE_OPEN_S;
  return Math.max(0, Math.min(1, (time - r.opening.since) / d));
}

// The badge of what the viewer carries that shows them to everyone
// (src/sim/royale/marks.ts): the Lodestar, the Wrath, an Ablaze run, the
// first that applies, and whether the globe shows them right now (for
// MARK_SHOWN_S after each show). Null when they carry none.
const MARK_BADGE: Readonly<Partial<Record<MarkKind, [string, string]>>> = {
  lodestar: ['You are the Lodestar', 'Lodestar'],
  wrath: ['You hold the Wrath', 'Wrath'],
  ablaze: ['You are Ablaze', 'Ablaze'],
};

export function markBadge(
  r: Pick<SnapRoyale, 'st' | 'mk'>,
  selfId: number,
  time: number,
  compact = false,
): { text: string; kind: MarkKind; shown: boolean } | null {
  if (r.st !== 'play') return null;
  for (const kind of ['lodestar', 'wrath', 'ablaze'] as const) {
    const m = (r.mk ?? []).find((x) => x[0] === selfId && x[1] === kind);
    if (!m) continue;
    const words = MARK_BADGE[kind]!;
    return { text: compact ? words[1] : words[0], kind, shown: time - m[5] <= MARK_SHOWN_S };
  }
  return null;
}

// A loot notice: the piece, and what it adds, "+ Iron Blade · +10 attack
// damage".
export function lootText(itemName: string, gain = ''): string {
  return gain ? `+ ${itemName} · ${gain}` : `+ ${itemName}`;
}

const STAT_WORDS: readonly [keyof ItemStats, string, boolean][] = [
  ['ad', 'attack damage', false],
  ['ap', 'ability power', false],
  ['hp', 'health', false],
  ['mana', 'mana', false],
  ['armor', 'armor', false],
  ['mr', 'magic resist', false],
  ['attackSpeedPct', 'attack speed', true],
  ['moveSpeed', 'move speed', false],
  ['armorPen', 'armor penetration', false],
  ['mrPen', 'magic penetration', false],
  ['armorPenPct', 'armor penetration', true],
  ['mrPenPct', 'magic penetration', true],
];

// Stats in words, "+10 attack damage, +12% attack speed"; only what rises.
export function statText(s: ItemStats): string {
  const parts: string[] = [];
  for (const [key, word, pct] of STAT_WORDS) {
    const v = s[key] ?? 0;
    if (v <= 0) continue;
    const n = pct ? `${Math.round(v * 100)}%` : `${Math.round(v * 100) / 100}`;
    parts.push(`+${n} ${word}`);
  }
  return parts.join(', ');
}

// What a piece adds to the bag: its stats, less those of the components it
// consumes on the way in (a finished item's gain over its parts).
export function itemGain(def: ItemDef): ItemStats {
  const out: ItemStats = { ...def.stats };
  for (const partId of def.buildsFrom ?? []) {
    const part = ITEMS[partId];
    if (!part) continue;
    for (const [k, v] of Object.entries(part.stats) as [keyof ItemStats, number][]) {
      out[k] = (out[k] ?? 0) - v;
    }
  }
  return out;
}

// A finished item's signature, in a line a phone holds; the passive's own
// description is the fallback (src/sim/content/item_passives.ts).
const PASSIVE_SHORT: Readonly<Record<string, string>> = {
  worldheart: '2% health a second after 5 s unhurt',
  doombrand: '+12% damage to targets under 30%',
  skyshear: '+12% move speed for 1.5 s on champion hits',
};

export function passiveLine(itemId: string): string | null {
  const p = ITEM_PASSIVES[itemId];
  if (!p) return null;
  return `${p.name}, ${PASSIVE_SHORT[itemId] ?? p.description.replace(/\.$/, '')}`;
}

// An item finished from its components: "Completed: Doombrand · Deathmark,
// +12% damage to targets under 30%", or its gain when it has no passive.
// On a phone (`compact`) only the names: the long line wraps across the
// playfield. Null for a component, which completes nothing.
export function completedText(def: ItemDef, compact = false): string | null {
  if (!def.buildsFrom || def.buildsFrom.length === 0) return null;
  const tail = compact
    ? (ITEM_PASSIVES[def.id]?.name ?? null)
    : (passiveLine(def.id) ?? statText(itemGain(def)));
  return tail ? `Completed: ${def.name} · ${tail}` : `Completed: ${def.name}`;
}

// The loot notice for a piece by id: the plain line for a component, the
// completed line for a finished item (its short form on a phone).
export function lootNotice(itemId: string, compact = false): { text: string; completed: boolean } {
  const def = ITEMS[itemId];
  if (!def) return { text: lootText(itemId), completed: false };
  const done = completedText(def, compact);
  if (done) return { text: done, completed: true };
  return { text: lootText(def.name, statText(itemGain(def))), completed: false };
}

// The bag is the whole build: nothing left for a cache to give. A person's
// seat walks its champion's build (src/sim/royale/loot.ts seatBuild, the
// same rule the sim seats it with), so the client reads it off the bag.
// Said once, when the last piece lands.
export const BUILD_COMPLETE = 'Build complete';
export function buildComplete(championId: string | null, bag: readonly string[]): boolean {
  return bag.length > 0 && nextLootPiece(seatBuild(championId), bag) === null;
}

// The pill while the champion stands in the Dusk: what it costs a second.
export function duskPill(burn: number): string {
  return `In the Dusk -${Math.max(1, Math.round(burn * 100))}%/s`;
}

export function levelText(level: number): string {
  return `Level ${level}`;
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const last = n % 10;
  return `${n}${last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th'}`;
}

export function placeText(place: number, of: number): string {
  return `${ordinal(place)} of ${of}`;
}

export function takedownsText(n: number): string {
  return n === 1 ? '1 takedown' : `${n} takedowns`;
}

// A seat played by a bot: the flag the server sets on a snapshot unit's
// identity (b: 1) or on its scoreboard row, mirrored as the client world
// stores it (bot: true). Absent, as on a server that sends neither, it is
// nobody's bot.
export function isBot(x: unknown): boolean {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as { bot?: unknown; b?: unknown };
  return o.bot === true || o.bot === 1 || o.b === 1 || o.b === true;
}

// Who a seat is on the screen: the name the server gave it (a person's, or
// a bot's own), else the champion's.
export function seatName(row: { player: string | null; name: string }): string {
  return row.player ?? row.name;
}

// Whether a point stands outside the lit cap: its chord distance from the
// cap's center past the cap's radius (src/sim/royale/types.ts). Null when
// the point carries no height, as on a client world that keeps x and z
// alone: then nobody can tell.
export function outsideLight(
  pos: { x: number; z: number; y?: number },
  dusk: Pick<SnapDusk, 'c' | 'r' | 'p'>,
): boolean | null {
  if (typeof pos.y !== 'number' || !Number.isFinite(pos.y)) return null;
  if (dusk.p === 0) return false;
  const [cx, cy, cz] = dusk.c;
  const d = Math.hypot(pos.x - cx, pos.y - cy, pos.z - cz);
  return d > dusk.r;
}

// What the Dusk's turns say as they come: the calm ending, the light
// starting to close, the last of it going out. Null between turns.
export function duskTurn(
  prev: Pick<SnapDusk, 'p' | 'sh'> | null,
  next: Pick<SnapDusk, 'p' | 'sh'>,
): string | null {
  if (!prev) return null;
  if (next.p >= 6) return prev.p < 6 ? 'The last light is out' : null;
  if (prev.p === 0 && next.p >= 1) {
    return next.sh === 1
      ? 'The calm is over: the Dusk closes'
      : 'The calm is over: stay in the light';
  }
  if (next.sh === 1 && prev.sh === 0) {
    return next.p >= 5 ? 'The Dusk closes on the last light' : 'The Dusk closes';
  }
  return null;
}

// The keys at the bottom left in a battle royale, in the words of the hands
// on the screen: the mode's own verbs (a cache, the light), and none of the
// 5v5's (no shop, no recall, no gold, no scoreboard).
export function royaleHints(input: 'mouse' | 'tap' | 'thumbs', leftClickMoves: boolean): string {
  // The thumbs' corner is narrow, between the touch bar and the first
  // steps' card: four short lines, as the 5v5's.
  if (input === 'thumbs') {
    return (
      'Left thumb walks. Right thumb: tap a spell to cast, slide to aim. ATK attacks. ' +
      'Stand by a glowing cache to open it.'
    );
  }
  if (input === 'tap') {
    return (
      'Tap: move / attack. Tap a spell, then tap the ground to cast it. Stand by a glowing ' +
      'cache to open it, and stay in the light. Center snaps back to your champion.'
    );
  }
  return (
    `${leftClickMoves ? 'Click' : 'Right-click'}: move / attack. Q W E R: hold to aim, ` +
    'release to cast. D F: sigils. Stand by a glowing cache to open it, and stay in the ' +
    'light. Space recenters. Esc: menu.'
  );
}

// The bag of loot under the bar: its label, and what an empty place in it
// says when asked.
export const LOOT_LABEL = 'Loot';
export const LOOT_EMPTY: readonly string[] = [
  'Loot',
  'Caches, camps and takedowns fill this bag with the next piece of your build, equipped at once.',
];
