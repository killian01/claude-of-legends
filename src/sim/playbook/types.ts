// The playbook: a bot's whole decision policy as data (docs/design/bots.md,
// ADR 0013). An ordered list of plays; each decision slot the interpreter
// walks it top down, and the first play whose trigger holds AND whose
// behavior can act is the one that acts. A behavior that cannot act (no
// minion to farm, nothing affordable) passes to the next play.
//
// The format is versioned like the Policy contract and grows only
// additively: a playbook written against version 1 keeps playing under
// every later version. New trigger and behavior kinds are added, never
// changed; a parameter's default never moves once shipped.

import type { AbilityKey } from '../types';

export const PLAYBOOK_FORMAT_VERSION = 1;

export type LaneId = 'top' | 'mid' | 'bot';

// A predicate over the bot's own observation and the static map. Numeric
// triggers compare with `below` (strictly less) and `atLeast` (greater or
// equal); at least one of the two is required.
export type Trigger =
  | { kind: 'always' }
  // Own health as a fraction of max health.
  | { kind: 'hp'; below?: number; atLeast?: number }
  // Own mana as a fraction of max mana.
  | { kind: 'mana'; below?: number; atLeast?: number }
  | { kind: 'level'; below?: number; atLeast?: number }
  | { kind: 'gold'; below?: number; atLeast?: number }
  // Sim time in seconds.
  | { kind: 'time'; below?: number; atLeast?: number }
  // Enemy champions the team sees within a radius of the bot.
  | { kind: 'enemies'; within: number; atLeast?: number; atMost?: number }
  // Allied champions within a radius of the bot (the bot itself excluded).
  | { kind: 'allies'; within: number; atLeast?: number; atMost?: number }
  // At least one enemy champion is in the team's sight.
  | { kind: 'enemyVisible' }
  | { kind: 'atFountain' }
  // Inside a live enemy tower's reach.
  | { kind: 'underTower' }
  // The Warden: `up` while one is alive, `spawning` while the next one is
  // due within `within` seconds (default 20), `down` when none is alive.
  | { kind: 'warden'; state: 'up' | 'spawning' | 'down'; within?: number }
  | { kind: 'abilityReady'; key: AbilityKey }
  | { kind: 'sigilReady'; id: string }
  // The lane this seat was assigned.
  | { kind: 'lane'; is: LaneId }
  | { kind: 'not'; of: Trigger }
  | { kind: 'all'; of: Trigger[] }
  | { kind: 'any'; of: Trigger[] };

// A macro intent the engine turns into movement, attacks and casts through
// the shared micro (last hits, dodging, key roles, aim). Every parameter is
// optional and defaults to what the default playbook (the Laner) uses.
export type Behavior =
  // Run home: the kit's escape key or a sigil against a chaser, Mend, a
  // recall once clear and far enough out, else the walk. Always acts.
  | { kind: 'retreat' }
  // Do nothing this slot. Always acts.
  | { kind: 'hold' }
  // Buy the next item of the role build when at the fountain and affordable.
  | { kind: 'shop' }
  // Go home to spend: recall when clear and far, walk when close.
  | { kind: 'goShop' }
  // Step out of a tower's reach unless escorted and healthy, or securing
  // a kill.
  | { kind: 'avoidTower'; escortMin?: number; hpBelow?: number }
  // Hit a vulnerable enemy Sanctum in reach when it is low or escorted.
  | { kind: 'finishSanctum' }
  // Fight the target champion: Sear in kill range, the hint-driven kit,
  // then attacks.
  | { kind: 'fight' }
  // Walk to where a nearly dead enemy was last seen, when healthy.
  | { kind: 'hunt'; hpAbove?: number }
  // An enemy just vanished nearby: walk its spot when healthy, give ground
  // when hurt.
  | { kind: 'answerVanish'; hpAtLeast?: number }
  // Attack a live Warden in reach, walk to it when healthy, pre-position at
  // the nearest pit shortly before it spawns.
  | { kind: 'contestWarden'; hpAtLeast?: number; prepSeconds?: number }
  // Attack the nearest enemy minion in reach.
  | { kind: 'farm' }
  // Attack a visible jungle camp in reach.
  | { kind: 'takeCamp' }
  // Attack a vulnerable structure in reach with a minion escort.
  | { kind: 'siege'; escortMin?: number }
  // Follow the wave down a lane (the assigned one by default), else walk the
  // lane, else walk at the enemy Sanctum. Past `regroupAt` seconds every
  // assigned bot pushes mid as one group; null disables the bell. Always acts.
  | { kind: 'push'; lane?: LaneId | 'assigned'; regroupAt?: number | null }
  // Walk to the nearest allied champion and stay within `keep` units.
  | { kind: 'followAlly'; keep?: number }
  // Walk to a point and hold there. Always acts.
  | { kind: 'holdPosition'; x: number; z: number; within?: number };

export interface PlayDef {
  // Unique within the playbook; what the active-play trace and the overlay
  // show. Lowercase letters, digits, hyphen, underscore, at most 32.
  id: string;
  when: Trigger;
  do: Behavior;
  // A disabled play is skipped; default true.
  enabled?: boolean;
}

export interface PlaybookDef {
  version: number;
  plays: PlayDef[];
}
