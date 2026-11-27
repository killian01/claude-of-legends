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
    day: '2026-11-28',
    title: 'Mauldrum, a new Thornfray bout',
    body: [
      'A fourth kind of bout joins the Thornfray. Mauldrum is fought in the Cliffs, where the ' +
        'Voidmaul rises twelve seconds after the landing, and the bout is a race on it: every ' +
        'blow you land on the Voidmaul counts its damage, and the blow that fells it counts ' +
        '400 more.',
      "Everyone else is racing you to it. A takedown takes a fifth of the fallen champion's " +
        'count, and a fall costs five seconds and the walk back, so the fight around the ' +
        'creature matters as much as the blows on it. Watch its slam. The most struck when ' +
        'the clock runs out at 1:40 wins the bout.',
      'The house bots come for the Voidmaul like everyone else.',
    ],
    link: { label: 'Play a Thornfray', to: 'play' },
  },
  {
    day: '2026-11-27',
    title: 'The classic 5v5 starts by itself',
    body: [
      'Pressing Classic 5v5 used to leave you on a queue card that read 1 / 10, waiting ' +
        'until you found Start now with bots. Now the queue starts on its own eight seconds ' +
        'after you join it, filled with bots, and the card counts the seconds down. Anyone ' +
        'who queues in those seconds plays in the same match, and Start still skips the wait.',
    ],
    link: { label: 'Play the classic 5v5', to: 'play' },
  },
  {
    day: '2026-11-27',
    title: 'Ysmer, the Turnlamp',
    body: [
      'A thirteenth champion takes the field: Ysmer, the Turnlamp, a hooded lamplighter ' +
        'whose lantern trades places. She and another champion stand, in one beat, each ' +
        'where the other stood, with a thread of amber light between the two spots.',
      'Wick Shot is a bolt of lamplight that slows. Hung Lantern hangs a lantern just ahead ' +
        'of her that mends allies and shows enemies under it; press it again and she is back ' +
        'where she stood when she hung it. Changeling Spark trades her with the first enemy champion it ' +
        'strikes, so their marksman suddenly stands among her team. And In My Stead reaches ' +
        'the champion nearest her aim, friend or foe: an ally in trouble is taken out under ' +
        'a shield while she takes their place, an enemy is pulled in and held. Allies near ' +
        'her move faster while badly hurt.',
      'She plays bot lane as a Support, in 5v5 and on the Wanderseed alike, and the house ' +
        'bots play her too. She costs 500 laurels and comes with four looks: Default, ' +
        'Ashlantern, Mirelamp and Gloamglass.',
    ],
    image: 'ysmer.webp',
    link: { label: 'See the champions', to: 'champions' },
  },
  {
    day: '2026-11-26',
    title: 'Smoother battle royales and Thornfrays online',
    body: [
      'The 5v5 has played its updates out at the pace the match runs for a few days. The ' +
        'battle royale, the Thornfray and watching a live match now do the same: over a long ' +
        'connection, champions, bots and spells on the planet move smoothly instead of ' +
        'jumping and pausing.',
      'Your own champion still answers your click at once.',
    ],
    link: { label: 'Play', to: 'play' },
  },
  {
    day: '2026-11-26',
    title: 'The way back to your lane',
    body: [
      'In a 5v5, a champion who falls comes back at the fountain, far from where the fight was. ' +
        'The lane card now comes back with it: one click, or one tap on a phone, walks you back ' +
        'to your lane, or to your camps in the forest, and the gold arrow beside your champion ' +
        'and the lane on the minimap point the way until you are there.',
      'It waits until you close the shop, and if you close the card with its button it stays ' +
        'away for the rest of the match.',
    ],
    link: { label: 'Play', to: 'play' },
  },
  {
    day: '2026-11-25',
    title: 'Smooth from the first seconds on a slower machine',
    body: [
      'On a computer or phone that draws a match only a few frames a second, the game used to ' +
        'wait twenty seconds or more, the drop over the planet included, before drawing more ' +
        'lightly.',
      'It now sees that within the first few seconds, even while the planet turns under the ' +
        'drop, and draws lighter at once, so the landing and the first fight are smooth. A ' +
        'machine that only stalled while the match loaded gets its full picture back as soon as ' +
        'it shows it can.',
      'And it remembers: after two such matches, even short ones, the next starts lighter from ' +
        'its very first frame.',
    ],
    link: { label: 'Play', to: 'play' },
  },
  {
    day: '2026-11-23',
    title: 'Smoother 5v5 matches online',
    body: [
      'Over a long connection the updates of a 5v5 match can arrive unevenly, two at once and ' +
        'then none for a moment, and everything on screen jumped and paused with them.',
      'The game now plays them out at the pace the match runs, holding one back a few ' +
        'hundredths of a second when it must, so champions, minions and spells move smoothly. ' +
        'Your own champion still answers your click at once.',
    ],
    link: { label: 'Play', to: 'play' },
  },
  {
    day: '2026-11-23',
    title: 'Shop while you wait',
    body: [
      'A fall in a 5v5 is shopping time: a fallen champion buys from anywhere on the map. ' +
        'When your gold reaches the item the shop suggests, the screen over your fall now says ' +
        'so, with the key or the button that opens the shop.',
      'It also says when you stand at your fountain again, and the pause menu opened over a ' +
        'fall counts the same seconds.',
    ],
    link: { label: 'Play', to: 'play' },
  },
  {
    day: '2026-11-23',
    title: 'Emberstray, a new Thornfray bout',
    body: [
      'A third kind of bout joins the Thornfray. In Emberstray a ring of light, the Glow, ' +
        'stands at the heart of the Thornyard. It rests for twelve seconds, then drifts at a ' +
        'walk to its next stop, rests, and drifts again.',
      'Every second you stand inside it counts. Anyone inside counts too, so the way to count ' +
        'alone is to clear it, and to keep it while it moves. A fall costs five seconds and the ' +
        'walk back: pick the side it is drifting to. The most seconds held when the clock runs ' +
        'out at 1:40 wins the bout.',
      'The ring is gold while you are the one nearest its heart, red while someone else is, ' +
        'and the house bots come for it like everyone else.',
    ],
    link: { label: 'Play a Thornfray', to: 'play' },
  },
  {
    day: '2026-11-22',
    title: 'Tempest Core opens the fight: Firstbolt',
    body: [
      "The mages' finished item now has a signature of its own. Firstbolt: your abilities deal 12% more damage to a target above 70% of its health. Deathmark finishes a fight; Firstbolt starts one, so the spell you open with hits hardest.",
      'Tempest Core gives 160 ability power instead of 175 to make room for it. The house bots that build it get Firstbolt too, in the lanes and on the Wanderseed.',
    ],
    link: { label: 'Play', to: 'play' },
  },
  {
    day: '2026-11-19',
    title: 'Back from a fall, beside a cache',
    body: [
      'In Respawn, a champion who falls and picks no point on the globe now comes back a step from a cache, at least ten meters from every enemy, instead of at the edge of the light. Stand still for a second and a half and your next piece is on its way while you get your bearings.',
      'The house bots come back the same way. Tap the globe during the wait and you return exactly where you chose, as before; with no cache standing in the light, you return at its edge.',
    ],
    link: { label: 'Play', to: 'play' },
  },
  {
    day: '2026-11-17',
    title: 'No landing point? You come down beside a cache',
    body: [
      'On the Wanderseed, a champion who picks no landing point during the drop now comes down a step from a cache instead of in an empty field. Take one step, stand still for a second and a half, and the first piece of your build is yours.',
      'Your company lands close by as always, so you may have to win that cache first. Pick a point on the globe and you land exactly where you chose, as before.',
    ],
    link: { label: 'Play', to: 'play' },
  },
  {
    day: '2026-11-15',
    title: 'Play with friends, no account needed',
    body: [
      'A private lobby no longer needs an account. Press Play with friends on the front page, or the Private lobby tile on your home, and share the invite link or its six-letter code.',
      'A friend who opens the link sees whose lobby it is and how many are already in. They pick the name they will play under, which is also their name on the ladder, and press Join the lobby. If they would rather sign in or make an account first, the invitation waits for them. A code typed under the ways to play on the front page works too.',
      'The lobby also stays open after its match. On the end screen, Back to the lobby takes you back to the same lobby with the same code, on the side you played, and the host starts the next one. The link keeps working: a friend who opens it during a match waits in the lobby and plays the next one. A party you queue from the lobby comes back to it after its match too.',
      'As host, you can remove someone from your lobby. As before, a lobby match is never rated and scores no points on the ladder.',
    ],
    link: { label: 'Play with friends', to: 'play' },
  },
  {
    day: '2026-11-15',
    title: 'Gloamglass: a fourth look for every champion',
    body: [
      'All twelve champions now have a fourth skin, Gloamglass: a body of dark glass lit from within, each champion in their own glow. It is the same line across the whole roster, so a crew can match.',
      'Pick it under the champion card before a match, in the battle royale, in Thornfray and in a 5v5, or for your own bot in the Academy. In the battle royale, the house bots wear it too.',
    ],
    link: { label: 'Play', to: 'play' },
  },
  {
    day: '2026-11-10',
    title: 'The Pyrefang and the Voidmaul wake early in Respawn',
    body: [
      'In Respawn, the two big creatures of the Wanderseed now rise at 1:40 instead of 3:00. They are called at 1:10, just after the first Seedfall lands, and their markers count down at the edge of your screen.',
      'The last hit pays two pieces of your build, all your health and mana, and a Heartwood Graft, and everyone sees who took it. Coming back is cheap in Respawn, so go for the steal. Once one falls, it rises again two and a half minutes later. One life keeps its 3:00.',
    ],
    link: { label: 'Play', to: 'play' },
  },
  {
    day: '2026-11-09',
    title: 'A warning before a bot takes your champion',
    body: [
      'In a 5v5 with other people in it, a champion left without orders for two minutes goes to a bot, so the match stays fair for everyone else. Until now that happened without a word.',
      'Now, after a minute and a half of silence, the game tells you so, and the tab title says "Still there?" if you are on another tab. Any order in the next 30 seconds keeps your champion yours.',
    ],
    link: { label: 'Play', to: 'play' },
  },
  {
    day: '2026-11-06',
    title: 'Your spells light up in your first fight',
    body: [
      'On the Wanderseed, a champion that only swings loses most duels. Now, when you take a hit and have not cast a spell yet this match, every spell you could cast right then glows gold on your bar.',
      'Press it, or tap it on a phone, and the glow is gone for the rest of the match.',
    ],
    link: { label: 'Play', to: 'play' },
  },
  {
    day: '2026-11-05',
    title: 'Walk with the arrow keys',
    body: [
      'Clicking the ground is still how most of us walk, but now the arrow keys walk too. Hold one and your champion keeps going that way on the screen; hold two for a diagonal, and let go to stop.',
      'It works in 5v5, on the Wanderseed and in Thornfray. Q W E R, A, S and the sigils keep their keys.',
    ],
    link: { label: 'Play', to: 'play' },
  },
  {
    day: '2026-11-03',
    title: 'The Star Orchard loads faster on a slow connection',
    body: [
      'The Star Orchard is a big download, and on a slow connection the loading card could stay up for minutes while your match went on without you.',
      'Now the game watches how fast the map is coming in. When the full map would take too long, it fetches the lighter one phones already use, the same orchard with smaller textures, so you reach your lane in a fraction of the time.',
    ],
  },
  {
    day: '2026-11-02',
    title: 'Every champion on the battle royale pick',
    body: [
      'The battle royale pick now lays all twelve champions in two rows. On a phone held sideways, Nisk and Ostrand had slipped below the card and could not be chosen; now they sit beside the rest.',
      'On a short desktop window the rows no longer overlap, and Random and Back stay on the card.',
    ],
    link: { label: 'Play', to: 'play' },
  },
  {
    day: '2026-11-01',
    title: 'Ostrand, the Pledgeblade',
    body: [
      'A twelfth champion takes the field: Ostrand, the Pledgeblade, a knight who picks one ' +
        'enemy and will not let go. The first enemy champion he strikes becomes his Sworn, ' +
        'marked by a red pennant both teams can see. Near his Sworn he runs faster and hits ' +
        'harder, and taking it down heals him and readies his Lance Drive again.',
      'Lance Drive thrusts down a line and slows, hardest on the Sworn. Standard plants a ' +
        'banner that hardens his allies and reveals enemies around it. Gauntlet Throw names ' +
        'whoever it strikes as the Sworn; cast it again to charge straight at them. And the ' +
        'Oathfield raises a ring of stone around him and his Sworn: nobody walks ' +
        'or dashes in or out for a few seconds, arrows still fly over, and inside it he takes ' +
        'less from champions outside.',
      'He plays top as a Fighter, in 5v5 and on the Wanderseed alike, and the house bots ' +
        'play him too. He costs 500 laurels and comes with three looks: Default, Ashlar and ' +
        'Winterpledge.',
    ],
    image: 'ostrand.webp',
    link: { label: 'See the champions', to: 'champions' },
  },
  {
    day: '2026-10-28',
    title: 'More time to look around when you join',
    body: [
      'When you join a Respawn match already under way, your champion now stays Untouchable ' +
        'for up to 15 seconds until your first order, up from 6. Take your time with the guide ' +
        'and the screen before the fight beside you begins. Your first move, attack or spell ' +
        'ends it as before.',
    ],
  },
  {
    day: '2026-10-24',
    title: 'Click a cache to open it',
    body: [
      'A click or a tap on a glowing cache, or on the ground just beside it, now walks your ' +
        'champion right up to it, close enough to open it. Before, a click on the chest itself ' +
        'could stop you a step short, where standing opened nothing. Stand still there and the ' +
        'cache opens.',
    ],
  },
  {
    day: '2026-10-21',
    title: 'A cache opening keeps through a passing enemy',
    body: [
      'Standing by a cache to open it, your champion no longer swings by itself at an enemy ' +
        'who walks into reach, a swing that used to break the opening. The champion holds its ' +
        'fire until the cache opens, unless something strikes it: then it fights back as before. ' +
        'The same rule holds for every champion, the house bots included.',
    ],
  },
  {
    day: '2026-10-20',
    title: 'Thornfray: eight champions, six bouts',
    body: [
      'A new way to play on the Wanderseed. Eight champions land on a Thornyard, a small part ' +
        "of the planet around one region's heart, and play a bout of a minute and a half or so " +
        'to a rule of its own. Each bout pays bushels by place, five to the first down to none ' +
        'for the last three. Five bouts, then the Final, where every place pays double, and the ' +
        'most bushels wins the Thornfray.',
      'Two kinds of bout to start with. In Lastwick you have one life, the light closes fast, ' +
        'and the last one standing wins. In Starglean a fall costs five seconds: open caches for ' +
        'one each, a golden one for two and a Seedfall cache for three, take one from whoever ' +
        'you bring down, and the most gleaned when the clock runs out wins.',
      'You keep your champion for the whole match, and every bout lands you a level higher with ' +
        "more of your build. Between two bouts, ten seconds over the globe show everyone's " +
        'bushels and the next rule while you pick where to land, and the last winner picks a ' +
        'Graft for the next bout. House bots take every seat nobody does.',
      'Takedowns, assists and caches score on the ladder as in the battle royale, and the end ' +
        'pays the top three. Press Thornfray under the gold button on the front page, or its ' +
        'tile on your home.',
    ],
    image: 'thornfray.webp',
    link: { label: 'Play a Thornfray', to: 'play' },
  },
  {
    day: '2026-10-18',
    title: 'The Opening Seedfall',
    body: [
      'Respawn on the Wanderseed no longer waits two minutes for its first Seedfall. Thirty ' +
        'seconds after landing, two seeds are called; a minute in, they hit the ground.',
      'Each leaves a Seedfall cache: a piece of your build, a full heal and the pick of a Heartwood ' +
        'Graft for whoever opens it first. The five Seedfalls that follow keep their times, and One ' +
        'life keeps its calm.',
    ],
    link: { label: 'Play a match', to: 'play' },
  },
  {
    day: '2026-10-18',
    title: 'A pointer to your first cache',
    body: [
      'Caches hold the pieces of your build on the Wanderseed. Until you open your first one ' +
        'in a match, a pale blue pointer at the edge of the screen shows the way to the nearest ' +
        'cache in the light, with how far it is.',
      'Walk up to it and stand still beside it: the ring fills, and the piece is yours.',
    ],
    link: { label: 'Play a match', to: 'play' },
  },
  {
    day: '2026-10-15',
    title: 'Crews on the Wanderseed',
    body: [
      'The battle royale plays in crews now, as well as alone. On the card where you pick your ' +
        'champion, choose Solo, Trios or Fives: sixteen crews of three, or ten crews of five, in ' +
        'Respawn and in One life.',
      'A crew shares its sight and cannot hurt itself. It lands together, and a fall in Respawn ' +
        'brings you back beside a crewmate who is clear of a fight. Your crewmates wear the blue ' +
        'of an ally, and the bots in your crew keep close to you.',
      'Respawn counts every takedown your crew lands, and the crew with the most when the last ' +
        'light goes out wins. In One life a fall is still final: you watch your crew fight on, ' +
        'and the last crew standing wins.',
    ],
    image: 'crews.webp',
    link: { label: 'Play a match', to: 'play' },
  },
  {
    day: '2026-10-15',
    title: 'The Range: try a champion on the Strikeposts',
    body: [
      'Practice has a third choice under Enemy bots: None (Range). Your champion starts alone ' +
        'in its base, with no minions, no camps and no bots, and two Strikeposts standing just ' +
        'past the Sanctum.',
      'The Bare Strikepost has no armor and no magic resist, the Plated one has plenty of both, ' +
        'so you can see how a spell lands on a carry and on a tank. Neither ever falls: leave ' +
        'one alone for four seconds and it fills up again.',
    ],
    link: { label: 'Open Practice', to: 'play' },
  },
  {
    day: '2026-10-11',
    title: 'The Voidmaul rises in its own body',
    body: [
      'The creature of the top ring has its own body at last: some fourteen metres of stone ' +
        'and void that climbs out of a rift in the ground when it rises, at six and a half ' +
        'minutes into a match.',
      'It strikes slowly and hard, and it alternates two blows: a slam of one forepaw, then the ' +
        'Crush, where it rears and brings both paws down. Whoever stands in the disk under the ' +
        'paw takes the hit; step out while the paw is still rising and it lands on nothing.',
      'Each blow also throws a rain of stones across the ring. Every stone lands on its own ' +
        'mark a couple of seconds later and hurts whoever is under it, so a fight with the ' +
        'Voidmaul is a fight with the ground too.',
    ],
    image: 'voidmaul.webp',
    link: { label: 'Play a match', to: 'play' },
  },
  {
    day: '2026-10-06',
    title: 'The Sapdraught: a drink for a rough lane',
    body: [
      'The shop sells its first drink. A Sapdraught costs 50 gold and gives back 150 health ' +
        'over ten seconds, wherever you are. A hit does not stop it, so a lost trade is no ' +
        'longer a walk home. One works at a time, and you can carry two.',
      'Click it in your bag or press its number to drink it; on a phone, a Drink button joins ' +
        'the touch bar while you carry one. The house bots drink by the same rule: they leave ' +
        'the fountain with one and reach for it when a fight goes badly.',
    ],
    link: { label: 'Play a match', to: 'play' },
  },
  {
    day: '2026-10-03',
    title: 'The Wanderseed: a battle royale for fifty champions',
    body: [
      'A new way to play: fifty champions on the Wanderseed, a small planet you can walk all ' +
        'the way round. Pick where you land, open the glowing caches for the next piece of your ' +
        'build, take the launch pads across the world, and stay in the light: the Dusk closes in ' +
        'five phases and burns whoever it catches outside.',
      'Two rule sets. In Respawn a death costs five seconds, and the most takedowns when the ' +
        'last light goes out wins. In One life you get one, and the last one standing wins.',
      'House bots fill every seat nobody takes, each with a name of its own and a bot mark ' +
        'beside it, so you always know who is a person. Play now on the front page lands you in ' +
        'Respawn, and the classic 5v5 is one click away.',
    ],
    image: 'wanderseed.webp',
    link: { label: 'Play the battle royale', to: 'play' },
  },
  {
    day: '2026-09-30',
    title: 'Every match puts you on the ladder',
    body: [
      'The ladder now counts everyone who plays, accounts and Guests on one list. Every public ' +
        'match scores points for what you do in it: a last hit, a kill, an assist, a tower your ' +
        'team takes, a creature, the win. Points are banked the moment they land, so a match you ' +
        'leave early keeps what it gave you.',
      'None of it needs an account. Press Play on the front page, and your first last hit puts ' +
        'your name on the ladder. At the end of the match, or in the pause menu, pick the name you ' +
        'want beside your points.',
      'Points count double when a person plays against you, and half again when one plays beside ' +
        'you; against the gentle bots a first match meets, they count half. An account keeps your ' +
        'points on every device, and making one in the same browser brings them along.',
    ],
    link: { label: 'See the ladder', to: 'ladder' },
  },
  {
    day: '2026-09-30',
    title: 'The Pyrefang rises out of its fire',
    body: [
      'The Pyrefang, the creature of the bot ring, has a body of its own. The stand-in shape ' +
        'is retired; in its place prowls a rigged beast with lava in the cracks of its hide, ' +
        'flames flickering along its back and embers rising off it. It walks like a big cat, ' +
        'watches while it waits, and turns to face whoever comes for it.',
      'It no longer simply appears. A column of fire bursts from the ring, crowned where the ' +
        'platform ends, and the Pyrefang uncurls inside it, gets to its feet and roars. Its ' +
        'bite is timed so the jaws close when the hit lands, and when it falls it plays its ' +
        'death before the body fades. The Ascendant rises through the same fire.',
      'Nothing in the numbers moved: its size on the ground, its reach, its health and its ' +
        'rewards are the ones you fought yesterday.',
    ],
    image: 'pyrefang.webp',
    link: { label: 'Play now', to: 'play' },
  },
  {
    day: '2026-09-30',
    title: 'Pick your lane before the match',
    body: [
      'Champion select now asks where you are going: top lane, mid lane, bot lane or the ' +
        "forest. Your champion's own lane is picked for you until you pick another, and your " +
        'teammates see your choice as you make it. A lane that is full is greyed out for the ' +
        'rest of your team: first come, first served. Any champion may take the forest; one ' +
        'that is not built for it is told the camps will be slow.',
      'The bots now line up around what the people on their team chose. Take the forest and ' +
        'there is no house Jungler beside you; take mid and the house brings a top laner ' +
        'instead. Bot teams also stopped leaving mid empty now and then.',
      'Once the match starts, a card names your lane and a tap on it walks you there, the lane ' +
        'is drawn on the minimap, and an arrow beside your champion points the way until you ' +
        "arrive. Joining a match in progress in place of a bot tells you that bot's lane the " +
        'same way.',
    ],
    link: { label: 'Play now', to: 'play' },
  },
  {
    day: '2026-09-18',
    title: 'Elowen, in a body of her own',
    body: [
      'Elowen, Mistward, has a body of her own, the fourth of the roster after Korrath, Vesk ' +
        'and Sylra. The ghost she borrowed from a shared pack is retired; in her place hovers ' +
        'the spirit of the splash art, halo above her head, her sleeves, skirt and hair on ' +
        'chains of their own that swing with every gesture. Eight movements were made for her: ' +
        'the levitation she idles in, the glide she moves by, the open hand of a basic attack, ' +
        'one gesture per spell, and the death, in which she folds and dissipates upward.',
      'Her mist is modelled beside her rather than drawn on the fly. The auto leaves her ' +
        'hand as a wisp and bursts where it lands, the Mist Lance flies from her palm and ' +
        'unfurls on what it hits, the Veil is laid down as a curtain over the ground, the ' +
        'Drifting Step flashes at both ends of the blink with a streak between them, and the ' +
        'Whiteout comes down as a storm that fills her circle.',
      'Nothing in the numbers moved: her ranges, damage and durations are the ones you ' +
        'played last week. Six champions still wear the shared bodies; they will get theirs ' +
        'one at a time.',
    ],
    image: 'elowen.webp',
    link: { label: 'See the champions', to: 'champions' },
  },
  {
    day: '2026-09-16',
    title: 'Sylra, in her own body',
    body: [
      'Sylra, Thornweaver, has a body of her own, after Korrath and Vesk. The hooded mage ' +
        'she borrowed from a shared pack is retired; in her place stands the witch of the ' +
        'splash art, thorn-wrapped, with her staff in hand and eight movements authored for ' +
        'her: the idle, the cane walk, the swing of a basic attack, one gesture per spell, ' +
        'and the fall, which drops the staff.',
      'Her spells wear effects drawn beside the model. The thorn bolt leaves the tip of the ' +
        'staff and bursts on what it hits, the bramble field grows out of the ground where ' +
        'she plants it, the verdant shell rides whoever she gives it to and bursts when it ' +
        'goes, and the overgrowth erupts into roots where she calls it.',
      'Nothing in the numbers moved: her ranges, damage and durations are the ones you ' +
        'played last week. Seven champions still wear the shared bodies; they will get ' +
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
