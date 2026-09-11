// The forest's camps (CONTEXT.md: Camp, Barkmaw, Spinecrest,
// Brackenlings), data-as-code: the three kinds of neutral body the
// forests' spots hold, each written at the 4:00 mark like every neutral
// body (rings.ts: bodyGrowth and biteGrowth carry it to the clock it
// rises at, and below 4:00 a body is as written), how many stand at a
// spot, what each pays, when they come back, and which hands its killer
// the attack speed buff. The sim reads this table (src/sim/camps.ts), the
// content fingerprint hashes it, the HUD says its names. Sized for a lone
// champion at level 1 to 3, the jungler's first round (ADR 0023,
// docs/plan-forest.md): the Spinecrest in about ten seconds, the
// Brackenlings in a dozen, the Barkmaw in fifteen taking real damage; a
// full round of a forest pays about what a lane's waves do.

import type { CreatureBody } from './rings';

export type CampKind = 'spinecrest' | 'brackenlings' | 'barkmaw';

export interface CampDef {
  id: CampKind;
  name: string;
  // The bodies standing at the spot at once: spawned together, back
  // together once the last has fallen.
  count: number;
  body: CreatureBody;
  // The last-hit bounty, per body.
  goldBounty: number;
  // Seconds after the last body falls before the spot fills again.
  respawnS: number;
  // Whether a body's killer gets the personal attack speed buff.
  buff: boolean;
}

export const CAMPS: Record<CampKind, CampDef> = {
  // A squat prowler with a ridge of thorns down its back: the plain camp,
  // one body, the first a jungler clears.
  spinecrest: {
    id: 'spinecrest',
    name: 'Spinecrest',
    count: 1,
    body: {
      hp: 600,
      ad: 38,
      bitePct: 0,
      armor: 15,
      mr: 15,
      attackRange: 1.5,
      attackSpeed: 0.6,
      moveSpeed: 2.8,
      radius: 0.7,
      xpBounty: 110,
    },
    goldBounty: 85,
    respawnS: 90,
    buff: false,
  },
  // A pack of three small fern-crested skitterers: quick, frail, and paid
  // per body, so the clear splits between whoever is there.
  brackenlings: {
    id: 'brackenlings',
    name: 'Brackenlings',
    count: 3,
    body: {
      hp: 210,
      ad: 13,
      bitePct: 0,
      armor: 8,
      mr: 8,
      attackRange: 1.2,
      attackSpeed: 0.8,
      moveSpeed: 3.2,
      radius: 0.45,
      xpBounty: 40,
    },
    goldBounty: 32,
    respawnS: 90,
    buff: false,
  },
  // The forest's brute, bark-hided with a wide maw: the buff camp, at the
  // far end of each forest, slower to come back.
  barkmaw: {
    id: 'barkmaw',
    name: 'Barkmaw',
    count: 1,
    body: {
      hp: 900,
      ad: 45,
      bitePct: 0,
      armor: 20,
      mr: 20,
      attackRange: 1.8,
      attackSpeed: 0.55,
      moveSpeed: 2.6,
      radius: 1.0,
      xpBounty: 170,
    },
    goldBounty: 130,
    respawnS: 120,
    buff: true,
  },
};

export const CAMP_KINDS: readonly CampKind[] = ['spinecrest', 'brackenlings', 'barkmaw'];

// The clock the first camps rise on, and the buff the Barkmaw's killer
// carries: a personal attack speed bonus for a while.
export const CAMP_FIRST_SPAWN_S = 30;
export const CAMP_BUFF_AS_PCT = 0.15;
export const CAMP_BUFF_DURATION_S = 90;

// A forest's round from its team's door: the camp nearest the team's own
// fountain is the Spinecrest, the next the Brackenlings, the farthest the
// Barkmaw, the contested one. What the Star Orchard's spots are keyed by.
export const CAMP_ROUND: readonly CampKind[] = ['spinecrest', 'brackenlings', 'barkmaw'];

export const CAMPS_CONTENT = {
  camps: CAMPS,
  firstSpawnS: CAMP_FIRST_SPAWN_S,
  buffAsPct: CAMP_BUFF_AS_PCT,
  buffDurationS: CAMP_BUFF_DURATION_S,
  round: CAMP_ROUND,
};
