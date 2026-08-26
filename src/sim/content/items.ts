// The launch shop: about 20 items in 2 tiers (ADR and game definition).
// Tier 1 items are components; tier 2 items build from them and their cost is
// the COMBINED price (owning a component discounts it). Stat sticks only for
// now; actives and passives are a community frontier.

export interface ItemStats {
  hp?: number;
  mana?: number;
  ad?: number;
  ap?: number;
  armor?: number;
  mr?: number;
  attackSpeedPct?: number;
  moveSpeed?: number;
}

export interface ItemDef {
  id: string;
  name: string;
  cost: number;
  tier: 1 | 2;
  stats: ItemStats;
  buildsFrom?: readonly string[];
}

const T1: readonly ItemDef[] = [
  { id: 'iron_blade', name: 'Iron Blade', cost: 350, tier: 1, stats: { ad: 10 } },
  { id: 'spark_rod', name: 'Spark Rod', cost: 435, tier: 1, stats: { ap: 20 } },
  { id: 'guard_plate', name: 'Guard Plate', cost: 300, tier: 1, stats: { armor: 15 } },
  { id: 'null_cloak', name: 'Null Cloak', cost: 450, tier: 1, stats: { mr: 15 } },
  { id: 'heart_gem', name: 'Heart Gem', cost: 400, tier: 1, stats: { hp: 150 } },
  { id: 'mind_gem', name: 'Mind Gem', cost: 350, tier: 1, stats: { mana: 200 } },
  { id: 'swift_fang', name: 'Swift Fang', cost: 300, tier: 1, stats: { attackSpeedPct: 0.12 } },
  { id: 'traveler_soles', name: 'Traveler Soles', cost: 300, tier: 1, stats: { moveSpeed: 0.25 } },
];

const T2: readonly ItemDef[] = [
  {
    id: 'warbrand',
    name: 'Warbrand',
    cost: 1300,
    tier: 2,
    stats: { ad: 40 },
    buildsFrom: ['iron_blade', 'iron_blade'],
  },
  {
    id: 'storm_staff',
    name: 'Storm Staff',
    cost: 1600,
    tier: 2,
    stats: { ap: 75 },
    buildsFrom: ['spark_rod', 'spark_rod'],
  },
  {
    id: 'stone_bulwark',
    name: 'Stone Bulwark',
    cost: 1100,
    tier: 2,
    stats: { armor: 30, hp: 250 },
    buildsFrom: ['guard_plate', 'heart_gem'],
  },
  {
    id: 'spirit_ward',
    name: 'Spirit Ward',
    cost: 1250,
    tier: 2,
    stats: { mr: 30, hp: 250 },
    buildsFrom: ['null_cloak', 'heart_gem'],
  },
  {
    id: 'colossus_heart',
    name: 'Colossus Heart',
    cost: 1200,
    tier: 2,
    stats: { hp: 450 },
    buildsFrom: ['heart_gem', 'heart_gem'],
  },
  {
    id: 'archmind',
    name: 'Archmind',
    cost: 1300,
    tier: 2,
    stats: { ap: 40, mana: 300 },
    buildsFrom: ['mind_gem', 'spark_rod'],
  },
  {
    id: 'windrazor',
    name: 'Windrazor',
    cost: 1150,
    tier: 2,
    stats: { ad: 25, attackSpeedPct: 0.25 },
    buildsFrom: ['swift_fang', 'iron_blade'],
  },
  {
    id: 'titan_cleaver',
    name: 'Titan Cleaver',
    cost: 1250,
    tier: 2,
    stats: { ad: 25, hp: 200 },
    buildsFrom: ['iron_blade', 'heart_gem'],
  },
  {
    id: 'runeblade',
    name: 'Runeblade',
    cost: 1300,
    tier: 2,
    stats: { ad: 20, ap: 30 },
    buildsFrom: ['iron_blade', 'spark_rod'],
  },
  {
    id: 'swiftplate',
    name: 'Swiftplate',
    cost: 1050,
    tier: 2,
    stats: { armor: 25, attackSpeedPct: 0.2 },
    buildsFrom: ['guard_plate', 'swift_fang'],
  },
  {
    id: 'clarity_stone',
    name: 'Clarity Stone',
    cost: 1250,
    tier: 2,
    stats: { mr: 20, mana: 250 },
    buildsFrom: ['mind_gem', 'null_cloak'],
  },
  {
    id: 'swift_treads',
    name: 'Swift Treads',
    cost: 900,
    tier: 2,
    stats: { moveSpeed: 0.55 },
    buildsFrom: ['traveler_soles', 'traveler_soles'],
  },
];

export const ITEMS: Readonly<Record<string, ItemDef>> = Object.fromEntries(
  [...T1, ...T2].map((i) => [i.id, i]),
);

export const ITEM_LIST: readonly ItemDef[] = [...T1, ...T2];
