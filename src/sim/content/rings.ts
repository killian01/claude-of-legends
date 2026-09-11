// The rings (CONTEXT.md: Ring, Pyrefang, Voidmaul, Favor, Ascendant,
// Wrath), data-as-code: the two creatures the Star Orchard's corner rings
// hold, their clocks, their bodies and the growth every neutral body
// follows, the six aspects they carry in a fixed order, what each aspect
// is worth, and the Ascendant each creature becomes once its aspects are
// spent. The sim reads this table (src/sim/rings.ts, src/sim/favors.ts,
// src/sim/team_buffs.ts), the content fingerprint hashes it, and the HUD
// says its names. The aspect numbers follow the drake tiers the
// maintainer pointed at (docs/plan-rings.md); the order alternates
// offense and defense on each ring so neither ring is the boring one, and
// it is the same in every match, so both teams can read what the next
// creature carries. The bodies follow the second round of the plan: a
// lone champion takes a creature in 60 to 90 seconds and leaves bleeding,
// a duo in about thirty, five in about fifteen; the Warden wants a team;
// the Ascendant wants a team and forty seconds.

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

// Stacks of one aspect a team can hold. The order no longer loops (the
// fourth rise of a ring is its Ascendant), so each aspect comes once a
// match and the cap is a bound on a hand grant, not a goal.
export const FAVOR_MAX_STACKS = 1;
// The Tide heals every this many seconds.
export const TIDE_PERIOD_S = 5;
// Out of combat: no damage taken or dealt for this long (Swiftness).
export const OUT_OF_COMBAT_S = 5;

// A neutral body as written at the 4:00 mark; bodyGrowth and biteGrowth
// carry it to the clock it actually rises at.
export interface CreatureBody {
  hp: number;
  // The flat part of a strike, physical.
  ad: number;
  // The share of the target's max health each strike bites off on top,
  // true damage: a tank does not ignore a creature, and a fight twice as
  // long costs twice as much.
  bitePct: number;
  armor: number;
  mr: number;
  attackRange: number;
  attackSpeed: number;
  moveSpeed: number;
  radius: number;
  // Shared among the killing team present, like the Warden's.
  xpBounty: number;
}

export interface AscendantDef {
  // "Pyrefang Ascendant": the creature's name and the family word.
  name: string;
  // How long after its death it returns; longer than the creature's.
  returnS: number;
  body: CreatureBody;
}

export interface CreatureDef {
  id: CreatureId;
  name: string;
  ring: RingId;
  // When it first rises, and how long after its death it returns.
  firstRiseS: number;
  returnS: number;
  // The aspects it carries, in order, once each; then the Ascendant.
  aspects: readonly AspectId[];
  body: CreatureBody;
  ascendant: AscendantDef;
}

// Sized for a duo (docs/plan-rings.md, round two): written at 4:00.
const RING_BODY: CreatureBody = {
  hp: 7000,
  ad: 14,
  bitePct: 0.008,
  armor: 40,
  mr: 40,
  attackRange: 2,
  attackSpeed: 0.6,
  moveSpeed: 3.2,
  radius: 0.95,
  xpBounty: 180,
};

// Wants five and forty seconds; a duo dies first. Written at 4:00.
const ASCENDANT_BODY: CreatureBody = {
  hp: 18000,
  ad: 14,
  bitePct: 0.014,
  armor: 60,
  mr: 60,
  attackRange: 2.4,
  attackSpeed: 0.65,
  moveSpeed: 3.0,
  radius: 1.3,
  xpBounty: 400,
};

// The Pyrefang first, because two laners already stand beside the bot
// ring at 4:00; the Voidmaul two and a half minutes later, so a team that
// takes one must choose between holding its lane and crossing for the
// other. Each returns three minutes after its death, and its fourth rise
// is its Ascendant, five minutes after each of its deaths.
export const CREATURES: Record<CreatureId, CreatureDef> = {
  pyrefang: {
    id: 'pyrefang',
    name: 'Pyrefang',
    ring: 'bot',
    firstRiseS: 240,
    returnS: 180,
    aspects: ['might', 'tide', 'tempo'],
    body: RING_BODY,
    ascendant: { name: 'Pyrefang Ascendant', returnS: 300, body: ASCENDANT_BODY },
  },
  voidmaul: {
    id: 'voidmaul',
    name: 'Voidmaul',
    ring: 'top',
    firstRiseS: 390,
    returnS: 180,
    aspects: ['bulwark', 'swiftness', 'resolve'],
    body: { ...RING_BODY, attackRange: 2.2, attackSpeed: 0.5, moveSpeed: 2.8, radius: 1.15 },
    ascendant: {
      name: 'Voidmaul Ascendant',
      returnS: 300,
      body: { ...ASCENDANT_BODY, attackSpeed: 0.55, moveSpeed: 2.6, radius: 1.5 },
    },
  },
};

export const CREATURE_LIST: readonly CreatureDef[] = [CREATURES.pyrefang, CREATURES.voidmaul];

export function creatureOfRing(ring: RingId): CreatureDef {
  return ring === 'bot' ? CREATURES.pyrefang : CREATURES.voidmaul;
}

// A creature's death pays every member of the killing team, dead or
// alive: twice a camp, half a kill. There is no last-hit bounty on top.
// The Ascendant pays the same and hands the Wrath instead of a favor.
export const RING_GOLD_EACH = 150;
// How long after the last hit a creature keeps fighting before it resets.
export const CREATURE_CALM_S = 5;

// The growth every neutral body follows, as the champions' own measured
// growth over a fight that lasts (scripts/creature_report.ts is the
// measurement): a laner's sustained damage against a body, mana and
// cooldowns included, roughly doubles between 4:00 and 12:00 and flattens
// past 20:00 (its burst grows far more, and a body sized for the burst
// was one nobody could take). Health follows this curve; the resistances
// stay as written; the flat part of a strike follows the champions' own
// health instead (biteGrowth). Piecewise linear between the anchors, flat
// outside, so the same clock reads the same on every engine (ADR 0019).
export const BODY_GROWTH: readonly (readonly [number, number])[] = [
  [240, 1],
  [390, 1.25],
  [720, 2.0],
  [1200, 3.1],
  [1500, 3.6],
];
export const BITE_GROWTH: readonly (readonly [number, number])[] = [
  [240, 1],
  [720, 2.2],
  [1200, 3.6],
  [1500, 4.0],
];

function growthAt(curve: readonly (readonly [number, number])[], time: number): number {
  const first = curve[0]!;
  if (time <= first[0]) return first[1];
  for (let i = 1; i < curve.length; i++) {
    const [t1, g1] = curve[i]!;
    if (time <= t1) {
      const [t0, g0] = curve[i - 1]!;
      return g0 + ((g1 - g0) * (time - t0)) / (t1 - t0);
    }
  }
  return curve[curve.length - 1]![1];
}

export function bodyGrowth(time: number): number {
  return growthAt(BODY_GROWTH, time);
}

export function biteGrowth(time: number): number {
  return growthAt(BITE_GROWTH, time);
}

// The Wrath (CONTEXT.md): what an Ascendant's death hands the killing
// team for a while. Any enemy champion a champion of the team brings
// under a fifth of its max health dies on the spot, and every hit burns a
// share of the target's max health over a few seconds, true damage.
export const WRATH_DURATION_S = 150;
export const WRATH_EXECUTE_FRAC = 0.2;
export const WRATH_BURN_PCT = 0.03;
export const WRATH_BURN_S = 3;

// Everything above that decides a match, for the content fingerprint.
export const RINGS_CONTENT = {
  aspects: ASPECTS,
  creatures: CREATURES,
  maxStacks: FAVOR_MAX_STACKS,
  tidePeriod: TIDE_PERIOD_S,
  outOfCombat: OUT_OF_COMBAT_S,
  goldEach: RING_GOLD_EACH,
  bodyGrowth: BODY_GROWTH,
  biteGrowth: BITE_GROWTH,
  calm: CREATURE_CALM_S,
  wrath: {
    duration: WRATH_DURATION_S,
    execute: WRATH_EXECUTE_FRAC,
    burnPct: WRATH_BURN_PCT,
    burnS: WRATH_BURN_S,
  },
};
