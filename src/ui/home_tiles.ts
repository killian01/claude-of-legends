// What the play tiles on the home are (CONTEXT.md: Home): one per way to
// get into a match, in the order they stand. Pure data, no DOM, so a test
// reads the row without a browser; ui/play_tiles.ts draws it.
//
// Each tile wears a painted scene of its own (docs/design/tile-art-prompts.md),
// not a champion's portrait: a tile says what the mode IS, and a champion
// standing in it only says which champion. The file is loaded when it is
// there and the tile falls back to its accent wash otherwise, the same way
// the tier emblem falls back to its CSS banner.

// What pressing a tile does. A mode resolves the home's promise and takes
// the page down; a section opens under the bar and the home stays.
export type PlayMode = 'queue' | 'forge-queue' | 'create' | 'practice';
export type TileId = 'ranked' | 'bots' | 'forge' | 'lobby' | 'practice';

export type TileGoes = { to: 'mode'; mode: PlayMode } | { to: 'section'; key: string };

export interface PlayTile {
  id: TileId;
  title: string;
  line: string;
  goes: TileGoes;
  // The words on the tile's pill, or none: the tile itself is the button
  // either way, and the pill only says so louder on the big ones.
  cta: string | null;
  // A banner reads across rather than up: its words sit in a column
  // against a scrim, with the painting clear beside them. The two modes
  // nothing else in the genre has, Bots and the Forge, are the banners.
  banner: boolean;
  // Painted behind the tile: /art/tiles/<art>.webp.
  art: string;
  // The wash under the art, and what shows when the file is missing.
  accent: string;
  hero: boolean;
}

export const PLAY_TILES: readonly PlayTile[] = [
  {
    id: 'ranked',
    title: 'Ranked',
    line: 'The public queue. House bots fill any seat nobody takes; only a human on each side moves your rating.',
    goes: { to: 'mode', mode: 'queue' },
    cta: 'Play online',
    art: 'ranked',
    accent: '#c9a84a',
    banner: false,
    hero: true,
  },
  {
    id: 'bots',
    title: 'Bots',
    line: 'Field a bot instead of playing by hand. Write its playbook by talking to the coach, spar it in seconds, then seat it and coach it live.',
    goes: { to: 'section', key: 'academy' },
    cta: 'Open the Academy',
    art: 'bots',
    accent: '#5b9dd9',
    banner: true,
    hero: false,
  },
  {
    id: 'forge',
    title: 'Forge queue',
    line: 'The queue for champions built in the Forge, kit and all, on a ladder of its own. Bring yours, or come and meet other people\u2019s.',
    goes: { to: 'mode', mode: 'forge-queue' },
    cta: 'Play the Forge queue',
    art: 'forge',
    accent: '#d98a5c',
    banner: true,
    hero: false,
  },
  {
    id: 'lobby',
    title: 'Private lobby',
    line: 'Friends, one shared code, never rated.',
    goes: { to: 'mode', mode: 'create' },
    cta: null,
    art: 'lobby',
    accent: '#8f7ad9',
    banner: false,
    hero: false,
  },
  {
    id: 'practice',
    title: 'Practice',
    line: 'A full 5v5 against house bots, offline in this tab.',
    goes: { to: 'mode', mode: 'practice' },
    cta: null,
    art: 'practice',
    accent: '#6fb08a',
    banner: false,
    hero: false,
  },
];

export function tileArtUrl(art: string): string {
  return `/art/tiles/${art}.webp`;
}
