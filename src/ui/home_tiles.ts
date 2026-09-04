// What the play tiles on the home are (CONTEXT.md: Home): one per way into
// a match, in the order they stand, with the champion whose illustration
// stands behind each. Pure data, no DOM, so a test reads the row without a
// browser; ui/play_tiles.ts draws it.
//
// The Ranked tile is the large one and wears a different champion on
// every visit, drawn from the roster minus the faces the three small
// tiles keep, so the row never shows one champion twice.

export type PlayMode = 'queue' | 'forge-queue' | 'create' | 'practice';

export interface PlayTile {
  mode: PlayMode;
  title: string;
  line: string;
  // The words on the hero's gold pill; the small tiles have none, the
  // tile itself is the button.
  cta: string | null;
  // Champion ids whose illustrations stand behind the tile, side by side.
  art: readonly string[];
  hero: boolean;
}

export const RANKED_ART: readonly string[] = [
  'korrath',
  'dain',
  'elowen',
  'maera',
  'rhoka',
  'ashvyn',
];

export function rankedArt(visit: number): string {
  const n = RANKED_ART.length;
  const i = Number.isFinite(visit) ? Math.floor(visit) : 0;
  return RANKED_ART[((i % n) + n) % n] as string;
}

export function playTiles(visit: number): PlayTile[] {
  return [
    {
      mode: 'queue',
      title: 'Ranked',
      line: 'The public queue. Bots fill the empty seats; only a human on each side moves your rating.',
      cta: 'Play online',
      art: [rankedArt(visit)],
      hero: true,
    },
    {
      mode: 'forge-queue',
      title: 'Forge queue',
      line: 'Forged champions welcome, on a ladder of its own.',
      cta: null,
      art: ['vesk'],
      hero: false,
    },
    {
      mode: 'create',
      title: 'Private lobby',
      line: 'Friends, one shared code, never rated.',
      cta: null,
      art: ['fenn', 'sylra'],
      hero: false,
    },
    {
      mode: 'practice',
      title: 'Practice',
      line: 'Offline against dummies, in this tab. Nothing saved.',
      cta: null,
      art: ['torv'],
      hero: false,
    },
  ];
}

// Which visit this is, counted in the browser so the Ranked tile moves on
// between two loads. Storage can be missing, refused or full of junk; then
// every visit is the first, which costs one champion seen twice.
const VISIT_KEY = 'loc:home-visits';

export function nextVisit(storage: Pick<Storage, 'getItem' | 'setItem'> | null): number {
  try {
    if (!storage) return 0;
    const seen = Number(storage.getItem(VISIT_KEY) ?? '0');
    const visit = Number.isFinite(seen) && seen >= 0 ? Math.floor(seen) : 0;
    storage.setItem(VISIT_KEY, String(visit + 1));
    return visit;
  } catch {
    return 0;
  }
}

export function portraitUrl(championId: string): string {
  return `/portraits/${championId}.webp`;
}
