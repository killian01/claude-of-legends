// The news (CONTEXT.md: News): what changed on the server, an update, an
// event, a decision, written by hand and committed like content. Nothing
// here is generated from the players: the home's panels already show the
// latest from the Forge and the ladder, and a counter reads small on a
// quiet day where a dated note from three days ago reads alive.
//
// A change the player sees adds an entry in the same change
// (CONTRIBUTING.md). Newest first; the gate in tests/news.test.ts holds
// the dates, the images and the links to what the page can show.

// Where a link may point: a tile or a section of the home, never a URL.
export const NEWS_DESTINATIONS = [
  'play',
  'forge',
  'academy',
  'ladder',
  'gallery',
  'champions',
] as const;
export type NewsDestination = (typeof NEWS_DESTINATIONS)[number];

export interface NewsEntry {
  // Published, UTC.
  day: string;
  title: string;
  // Plain text paragraphs. No markdown: the client has no engine for it.
  body: readonly string[];
  // A file under src/ui/news_art/, 1280 wide (news_images.ts ships it).
  image?: string;
  link?: { label: string; to: NewsDestination };
  // An event's time, an ISO instant. While it is ahead, the entry is
  // pinned at the top (src/ui/news.ts).
  at?: string;
}

export const NEWS: readonly NewsEntry[] = [
  {
    day: '2026-09-16',
    title: 'Sylra, in her own body',
    body: [
      'Sylra, Thornweaver, is the first champion of the roster with a model of her own. ' +
        'The hooded mage she borrowed from a shared pack is retired; in her place stands ' +
        'the witch of the splash art, thorn-wrapped, with her staff in hand and eight ' +
        'movements authored for her: the idle, the cane walk, the swing of a basic attack, ' +
        'one gesture per spell, and the fall, which drops the staff.',
      'Her spells wear effects drawn beside the model. The thorn bolt leaves the tip of the ' +
        'staff and bursts on what it hits, the bramble field grows out of the ground where ' +
        'she plants it, the verdant shell rides whoever she gives it to and bursts when it ' +
        'goes, and the overgrowth erupts into roots where she calls it.',
      'Nothing in the numbers moved: her ranges, damage and durations are the ones you ' +
        'played last week. Nine champions still wear the shared bodies; they will get ' +
        'theirs one at a time.',
    ],
    image: 'sylra.webp',
    link: { label: 'See the champions', to: 'champions' },
  },
  {
    day: '2026-09-11',
    title: 'The forest round',
    body: [
      'The two forests of the Star Orchard are no longer empty ground between the lanes. ' +
        'Three kinds of camp stand in them: the Spinecrest, a lone prowler; the Brackenlings, ' +
        'a pack of three; and the Barkmaw, the brute whose death lends its killer a burst of ' +
        'attack speed for a minute and a half.',
      'Every house team fields a Jungler now, a seat that holds no lane and clears the forest ' +
        'on a round of its own, from the first camps at 0:30 to the fights it joins once it ' +
        'has the levels for them.',
      'The Warden rises at the plaza first, then at a pit drawn among the rooms of the ' +
        'forests, told to nobody until it rises. And the fog covers the two rings and their ' +
        'creatures: a clock is public, a body is seen only with sight on the ring.',
    ],
    image: 'forest.webp',
    link: { label: 'Play', to: 'play' },
  },
  {
    day: '2026-09-11',
    title: 'Two rings and the last creature',
    body: [
      'The two raised stone circles at the elbows of the side lanes have creatures on them. ' +
        'The Pyrefang rises on the bottom ring at 4:00, the Voidmaul on the top one at 6:30, ' +
        'each back three minutes after its death, and each is sized for a duo: a lone champion ' +
        'takes a minute and leaves bleeding.',
      'Whoever slays one takes its favor for the whole team, permanent, surviving death: ' +
        'Might, Tide and Tempo from the Pyrefang, Bulwark, Swiftness and Resolve from the ' +
        'Voidmaul, each once a match. The Warden keeps the Boon, bigger and temporary, and ' +
        'moves to 12:00.',
      'Late in the match each creature returns as its Ascendant, a body for a full team, ' +
        'whose death hands the Wrath: for 150 seconds the team finishes any champion it brings ' +
        'under a fifth of its health, and every hit burns.',
    ],
    image: 'rings.webp',
    link: { label: 'Play', to: 'play' },
  },
  {
    day: '2026-09-03',
    title: 'Bots: the Academy and the Arena',
    body: [
      'An account can field a bot in its seat instead of playing by hand. A bot is a playbook, ' +
        'ordered plays that one deterministic Policy reads inside the sim: never code, and never ' +
        'a model call during a match.',
      'The Academy is where it is written, by talking to the coach or by editing the plays, ' +
        'then sparred against the house bots in seconds. Queue with it, coach it live with a ' +
        'right-click, or deposit it in the Arena and read the Briefing in the morning.',
      'Three ladders rank the three ways to play: by hand, your bot, and a forged champion.',
    ],
    image: 'bots.webp',
    link: { label: 'Open the Academy', to: 'academy' },
  },
  {
    day: '2026-09-01',
    title: 'The Forge: build the eleventh champion',
    body: [
      'The Forge builds a champion of your own: a name, a look, stats, four abilities and a ' +
        'passive, described in words and compiled onto the same primitives the ten champions ' +
        'run on. Nothing you write runs as code; the validator and its power budget are the ' +
        'only balance authority.',
      'A forged champion gets a generated model on a turntable, a test drive against bots, ' +
        'and once sealed a place in the gallery where anyone can play it. Everything paid is ' +
        'priced in embers, on one ledger, with every failure refunded.',
    ],
    image: 'forge.webp',
    link: { label: 'Open the Forge', to: 'forge' },
  },
  {
    day: '2026-08-30',
    title: 'v0.1.0: Claude of Legends is open',
    body: [
      'A 5v5 MOBA in a browser tab: three lanes, ten champions with full kits, fog of war, ' +
        'items, sigils and skins, an authoritative server for online play, and a practice match ' +
        'against bots that needs no account.',
      'The whole game was vibe coded with Claude in a 48 hour sprint, then polished in the ' +
        'open. The source is on GitHub under the MIT license, with the commit history kept as ' +
        'the build log.',
    ],
    image: 'open.webp',
    link: { label: 'Play', to: 'play' },
  },
];
