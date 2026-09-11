// The rings (CONTEXT.md: Ring, Pyrefang, Voidmaul, Favor), data-as-code:
// the two creatures the Star Orchard's corner rings hold, their clocks,
// their bodies, the six aspects they carry in a fixed order, and what each
// aspect is worth per stack. The sim reads this table (src/sim/rings.ts,
// src/sim/favors.ts), the content fingerprint hashes it, and the HUD says
// its names. The numbers follow the drake tiers the maintainer pointed at
// (docs/plan-rings.md); the order alternates offense and defense on each
// ring so neither ring is the boring one, and it is the same in every
// match, so both teams can read what the next creature carries.

export type RingId = 'bot' | 'top';
export type CreatureId = 'pyrefang' | 'voidmaul';
export type AspectId = 'might' | 'tide' | 'tempo' | 'bulwark' | 'swiftness' | 'resolve';

export interface AspectDef {
  id: AspectId;
  name: string;
  // The one number the aspect is worth per stack; what it multiplies is
  // the aspect's own rule (src/sim/favors.ts says which).
  perStack: number;
  // What the HUD chip says, with the percent of one stack in the blank.
  says: string;
}

export const ASPECTS: Record<AspectId, AspectDef> = {
  might: { id: 'might', name: 'Might', perStack: 0.03, says: '{pct} AD and AP' },
  tide: { id: 'tide', name: 'Tide', perStack: 0.02, says: '{pct} missing HP every 5s' },
  tempo: { id: 'tempo', name: 'Tempo', perStack: 0.05, says: '{pct} attack speed' },
  bulwark: { id: 'bulwark', name: 'Bulwark', perStack: 0.05, says: '{pct} armor and MR' },
  swiftness: {
    id: 'swiftness',
    name: 'Swiftness',
    perStack: 0.05,
    says: '{pct} speed out of combat, {pct} slow resist',
  },
  resolve: {
    id: 'resolve',
    name: 'Resolve',
    perStack: 0.06,
    says: '{pct} tenacity, {pct} heal and shield power',
  },
};

export const ASPECT_IDS: readonly AspectId[] = [
  'might',
  'tide',
  'tempo',
  'bulwark',
  'swiftness',
  'resolve',
];

// Stacks of one aspect a team can hold; the fixed order brings an aspect
// back every third rise on its ring, so the cap is a bound, not a goal.
export const FAVOR_MAX_STACKS = 4;
// The Tide heals every this many seconds.
export const TIDE_PERIOD_S = 5;
// Out of combat: no damage taken or dealt for this long (Swiftness).
export const OUT_OF_COMBAT_S = 5;

export interface CreatureDef {
  id: CreatureId;
  name: string;
  ring: RingId;
  // When it first rises, and how long after its death it returns.
  firstRiseS: number;
  returnS: number;
  // The aspects it carries, in order, looping.
  aspects: readonly AspectId[];
  // The body at 4:00; it grows with the clock like the Warden does.
  hp: number;
  ad: number;
  armor: number;
  mr: number;
  attackRange: number;
  attackSpeed: number;
  moveSpeed: number;
  radius: number;
  // Shared among the killing team present, like the Warden's.
  xpBounty: number;
}

// The Pyrefang first, because two laners already stand beside the bot
// ring at 4:00; the Voidmaul two and a half minutes later, so a team that
// takes one must choose between holding its lane and crossing for the
// other.
export const CREATURES: Record<CreatureId, CreatureDef> = {
  pyrefang: {
    id: 'pyrefang',
    name: 'Pyrefang',
    ring: 'bot',
    firstRiseS: 240,
    returnS: 240,
    aspects: ['might', 'tide', 'tempo'],
    hp: 1600,
    ad: 55,
    armor: 30,
    mr: 30,
    attackRange: 2,
    attackSpeed: 0.7,
    moveSpeed: 3.2,
    radius: 0.95,
    xpBounty: 180,
  },
  voidmaul: {
    id: 'voidmaul',
    name: 'Voidmaul',
    ring: 'top',
    firstRiseS: 390,
    returnS: 240,
    aspects: ['bulwark', 'swiftness', 'resolve'],
    hp: 1600,
    ad: 55,
    armor: 30,
    mr: 30,
    attackRange: 2.2,
    attackSpeed: 0.55,
    moveSpeed: 2.8,
    radius: 1.15,
    xpBounty: 180,
  },
};

export const CREATURE_LIST: readonly CreatureDef[] = [CREATURES.pyrefang, CREATURES.voidmaul];

export function creatureOfRing(ring: RingId): CreatureDef {
  return ring === 'bot' ? CREATURES.pyrefang : CREATURES.voidmaul;
}

// A creature's death pays every member of the killing team, dead or
// alive: twice a camp, half a kill. There is no last-hit bounty on top.
export const RING_GOLD_EACH = 150;
// The body grows with the game clock, like the Warden's and the waves.
export const CREATURE_SCALING_PER_MIN = 0.04;
// How long after the last hit a creature keeps fighting before it resets.
export const CREATURE_CALM_S = 5;

export function creatureScale(time: number): number {
  return 1 + CREATURE_SCALING_PER_MIN * (time / 60);
}

// Everything above that decides a match, for the content fingerprint.
export const RINGS_CONTENT = {
  aspects: ASPECTS,
  creatures: CREATURES,
  maxStacks: FAVOR_MAX_STACKS,
  tidePeriod: TIDE_PERIOD_S,
  outOfCombat: OUT_OF_COMBAT_S,
  goldEach: RING_GOLD_EACH,
  scaling: CREATURE_SCALING_PER_MIN,
  calm: CREATURE_CALM_S,
};
