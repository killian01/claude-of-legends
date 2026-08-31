// A forged champion is pure data (ADR 0006): the same CastSpec deliveries
// and EffectSpec payloads the roster declares, plus a passive that is a
// parameterized template reference, never code. The whole record is
// JSON-serializable end to end: it travels the wire at match setup and is
// embedded in replays (plan-forge phase 2), so nothing in here may hold a
// function, a class instance, or a non-finite number.

import type { AbilityDef } from '../combat/casting';
import type { ChampionBaseStats, ChampionGrowth, ChampionRole } from '../content/champions';
import type { AbilityKey } from '../types';

// The passive is a reference into the engine's template set
// (forge/passive_templates.ts): a template id plus numeric parameters. The
// engine instantiates the hooks; the description is derived from the
// template and params, self-presenting like the spec-derived icons.
export interface ForgedPassiveRef {
  template: string;
  params: Record<string, number>;
  // Authored display name (word-filtered upstream, like the card texts).
  name: string;
}

// An ability on a forged champion is the exact roster AbilityDef shape: it
// was already pure data, and reusing it verbatim is what lets one engine
// execute both without a translation layer.
export type ForgedAbilityDef = AbilityDef;

export interface ForgedChampionDef {
  // Namespaced so a forged id can never collide with a roster id.
  id: string; // ^forged_[a-z0-9_]{1,32}$
  name: string;
  // Card texts (ADR 0006): title after the name, tagline as the one-line
  // play-style intent four allies read at select. Both may be empty on a
  // draft; the word filter on them is a server concern, not the sim's.
  title: string;
  tagline: string;
  role: ChampionRole;
  // The creator's signature (name#disc), shown on every surface.
  creator: string;
  passive: ForgedPassiveRef;
  base: ChampionBaseStats;
  growth: ChampionGrowth;
  abilities: Record<AbilityKey, ForgedAbilityDef>;
}
