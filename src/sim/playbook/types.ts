// The playbook: a bot's whole decision policy as data (docs/design/bots.md,
// ADR 0013, ADR 0014). An ordered list of plays; each decision slot the
// interpreter walks it top down, and the first play whose trigger holds AND
// whose behavior can act is the one that acts. A behavior that cannot act
// (no minion to farm, nothing affordable) passes to the next play. Beside
// the plays, the kit: what the bot works toward (its build and skill order)
// rather than what it does now, with variants on the same triggers.
//
// The format is versioned like the Policy contract and grows only
// additively: a playbook written against version 1 keeps playing under
// every later version. New trigger and behavior kinds are added, never
// changed; a parameter's default never moves once shipped. Version 2 added
// the kit, the fight's stance and target, and the sell behavior.

import type { CoachOrder } from '../coach';
import type { AbilityKey } from '../types';

export const PLAYBOOK_FORMAT_VERSION = 2;

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
  // The owner's coach order is active (ADR 0013), optionally of one kind.
  | { kind: 'order'; is?: CoachOrder['kind'] }
  // An allied champion within the radius is in a fight: an enemy champion
  // stands within 10 units of it.
  | { kind: 'allyFighting'; within: number }
  | { kind: 'not'; of: Trigger }
  | { kind: 'all'; of: Trigger[] }
  | { kind: 'any'; of: Trigger[] };

// How the fight behavior holds distance (the Stance of the glossary).
// `auto` kites on a ranged champion and walks in on a melee one.
export type Stance = 'auto' | 'kite' | 'front' | 'poke';

// Whom the fight behavior goes for: the nearest enemy champion, the one
// lowest in health, the squishiest by role, or the coach's focus target. A
// hard-controlled enemy in reach beats the rule.
export type TargetRule = 'nearest' | 'lowest' | 'squishiest' | 'order';

// What a walk-in does with no allied champion beside it: engage as if
// escorted, or hold and strike only what is already in reach (the scout on
// the fill: the melee fed, Korrath twenty kills for sixty deaths, diving
// alone).
export type Alone = 'engage' | 'hold';

// A macro intent the engine turns into movement, attacks and casts through
// the shared micro (last hits, dodging, key roles, aim). Every parameter is
// optional and defaults to what the default playbook (the Laner) uses.
export type Behavior =
  // Run home: the kit's escape key or a sigil against a chaser, Mend, a
  // recall once clear and far enough out, else the walk. Always acts.
  | { kind: 'retreat' }
  // Do nothing this slot. Always acts.
  | { kind: 'hold' }
  // The next step of the kit's build: buy the next item or component when
  // affordable, sell what the build no longer wants when the bag is full,
  // replace the cheapest item past a full bag. Buying and selling both
  // need the fountain.
  | { kind: 'shop' }
  // Go home to spend: recall when clear and far, walk when close.
  | { kind: 'goShop' }
  // Sell one named item, at the fountain, when the bag holds it.
  | { kind: 'sell'; item: string }
  // Step out of a tower's reach unless escorted and healthy, or securing
  // a kill.
  | { kind: 'avoidTower'; escortMin?: number; hpBelow?: number }
  // Hit a vulnerable enemy Sanctum in reach when it is low or escorted.
  | { kind: 'finishSanctum' }
  // Fight the target champion: Sear in kill range, the hint-driven kit,
  // then attacks, holding distance by the stance; `alone` is what a walk-in
  // does with nobody beside it (within 8): engage anyway, or hold.
  | { kind: 'fight'; stance?: Stance; target?: TargetRule; alone?: Alone }
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
  // Do what the coach ordered: go there, take the Warden, focus the target,
  // run home, group on an ally, hold. A focus on a target out of sight
  // passes the turn.
  | { kind: 'obeyOrder' }
  // Follow the wave down a lane (the assigned one by default), else walk the
  // lane, else walk at the enemy Sanctum. Past `regroupAt` seconds every
  // assigned bot pushes mid as one group; null disables the bell. Always acts.
  | { kind: 'push'; lane?: LaneId | 'assigned'; regroupAt?: number | null }
  // Walk to the nearest allied champion and stay within `keep` units.
  | { kind: 'followAlly'; keep?: number }
  // Walk to the nearest allied champion that is in a fight, within the
  // radius; passes the turn once beside it or when nobody is fighting.
  | { kind: 'joinAlly'; within?: number }
  // Walk back to the nearest live allied tower; passes the turn once under
  // it, so the plays below (fight, farm) go on there.
  | { kind: 'fallBack' }
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

// The three skills a bot ranks by choice; R goes at its level gates.
export type SkillKey = Exclude<AbilityKey, 'R'>;

// One conditional entry of the kit: while its trigger holds, its build or
// skill order stands in for the defaults.
export interface KitVariant {
  when: Trigger;
  build?: string[];
  skills?: SkillKey[];
}

// What the bot works toward (docs/design/bots.md, ADR 0014). A build is an
// ordered list of finished item ids; absent, the champion's role build.
// Skills is the order of Q, W and E to max; absent, Q then W then E.
export interface KitDef {
  build?: string[];
  skills?: SkillKey[];
  variants?: KitVariant[];
}

export interface PlaybookDef {
  version: number;
  plays: PlayDef[];
  kit?: KitDef;
}
