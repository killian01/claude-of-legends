// The planet's builds (ADR 0031: Loot is the build): the six items each
// champion's loot walks on the Wanderseed when its seat names no kit build
// (royale/loot.ts seatBuild). Every build opens on an item with a
// signature passive (content/item_passives.ts: Worldheart, Doombrand,
// Skyshear), so it lands by the seventh piece of loot: the 5v5's role
// builds reached one at the eleventh piece or never. The four shells
// (Dain, Torv, Korrath, Maera) walk bruiser lines with damage first,
// where the 5v5's shell build stacked five Heart Gems and left them
// nothing to finish a fight with. A champion missing here walks its
// role's build (playbook/kit.ts roleBuild).
//
// Planet rules only, like royale_tuning.ts: out of the content
// fingerprint, a change moves ROYALE_RULES_VERSION.

// The item passives a planet build reaches early.
export const PASSIVE_ITEMS: readonly string[] = ['worldheart', 'doombrand', 'skyshear'];

// The piece of loot by which every planet build holds a passive item.
export const PASSIVE_BY_PIECE = 7;

export const PLANET_BUILDS: Readonly<Record<string, readonly string[]>> = {
  // Assassin: the execute first, then armor shred and a body.
  fenn: ['doombrand', 'rendfang', 'titan_cleaver', 'stone_bulwark', 'spirit_ward', 'swift_treads'],
  // Skirmisher: the execute, then the attack speed line.
  rhoka: ['doombrand', 'skyshear', 'titan_cleaver', 'stone_bulwark', 'spirit_ward', 'swift_treads'],
  // Marksmen: the attack speed line and its Gale, then the execute.
  ashvyn: ['skyshear', 'doombrand', 'rendfang', 'titan_cleaver', 'spirit_ward', 'swift_treads'],
  vesk: ['skyshear', 'doombrand', 'rendfang', 'titan_cleaver', 'spirit_ward', 'swift_treads'],
  nisk: ['skyshear', 'doombrand', 'rendfang', 'titan_cleaver', 'spirit_ward', 'swift_treads'],
  // Mages: the Heartbeat's sustain first (no magic item carries a
  // passive), then the magic line.
  sylra: ['worldheart', 'tempest_core', 'null_engine', 'archmind', 'spirit_ward', 'swift_treads'],
  elowen: ['worldheart', 'tempest_core', 'null_engine', 'archmind', 'spirit_ward', 'swift_treads'],
  // The shells that scale on attack damage: a bruiser line, the execute
  // first, then the Heartbeat's two Heart Gems and no more.
  dain: ['doombrand', 'worldheart', 'rendfang', 'swiftplate', 'clarity_stone', 'swift_treads'],
  torv: ['doombrand', 'worldheart', 'rendfang', 'swiftplate', 'clarity_stone', 'swift_treads'],
  korrath: ['doombrand', 'worldheart', 'rendfang', 'swiftplate', 'clarity_stone', 'swift_treads'],
  // Maera's ranged attack carries her on the planet, where her heals and
  // shields find no ally: the attack speed line and its Gale, the
  // execute, then the Heartbeat's two Heart Gems.
  maera: ['skyshear', 'doombrand', 'worldheart', 'rendfang', 'swiftplate', 'swift_treads'],
};

export function planetBuild(championId: string | null): readonly string[] | undefined {
  return championId !== null ? PLANET_BUILDS[championId] : undefined;
}
