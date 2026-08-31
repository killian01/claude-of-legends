// Turns a validated ForgedChampionDef into the exact ChampionDef shape the
// engine already runs: the passive template reference becomes live hooks,
// the derived description is attached, and the abilities pass through
// verbatim (they were roster-shaped data all along). The runtime registry
// (plan-forge phase 2) resolves through here; nothing else instantiates a
// forged champion.

import type { ChampionDef } from '../content/champions';
import type { ForgedChampionDef } from './forged_def';
import { PASSIVE_TEMPLATES } from './passive_templates';

// Callers validate first (forge/validate.ts); resolving an invalid def is a
// programming error, not a player error, so it throws.
export function resolveForgedChampion(def: ForgedChampionDef): ChampionDef {
  const tpl = PASSIVE_TEMPLATES[def.passive.template];
  if (!tpl) {
    throw new Error(`unknown passive template '${def.passive.template}' (validate first)`);
  }
  return {
    id: def.id,
    // Roster naming style: "Torv, Stonehorn". The title is optional.
    name: def.title.trim().length > 0 ? `${def.name}, ${def.title}` : def.name,
    role: def.role,
    blurb: def.tagline,
    passive: {
      name: def.passive.name,
      description: tpl.describe(def.passive.params),
      ...tpl.create(def.passive.params),
    },
    base: def.base,
    growth: def.growth,
    abilities: def.abilities,
  };
}
