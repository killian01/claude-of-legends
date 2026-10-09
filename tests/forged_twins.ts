// Test fixture: the roster champions converted to forged shape. The
// abilities and stats pass through verbatim (they are already the data a
// forged champion declares); each code passive maps to its template
// archetype with the roster's own numbers. These twins are the budget's
// calibration set: the roster is the definition of "fits the power budget".
// A champion whose kit reaches past the Forge's vocabulary (OUTSIDE_FORGE)
// still has a twin for its bill (scripts/champion_bill.mjs), priced with
// the nearest template, but stays out of the calibration set: the Forge
// would refuse what it does not offer.

import { CHAMPION_LIST, type ChampionDef } from '../src/sim/content/champions';
import type { ForgedChampionDef, ForgedPassiveRef } from '../src/sim/forge/forged_def';

const TWIN_PASSIVES: Record<string, ForgedPassiveRef> = {
  korrath: {
    template: 'calm_carapace',
    params: { calmSeconds: 4, shieldBase: 25, shieldPerLevel: 7 },
    name: 'Shieldskin',
  },
  dain: {
    template: 'stacking_surge',
    params: { stacks: 4, bonusPct: 0.25 },
    name: 'Heat',
  },
  sylra: { template: 'kit_inscribed', params: {}, name: 'Barbed Marks' },
  fenn: {
    template: 'executioner',
    params: { hpThreshold: 0.35, bonusPct: 0.15 },
    name: 'Opportunist',
  },
  elowen: {
    template: 'battle_flow',
    params: { msPct: 0.08, duration: 1.2 },
    name: 'Mistborne',
  },
  vesk: { template: 'predators_focus', params: { bonusPct: 0.15 }, name: 'Deadstill' },
  ashvyn: { template: 'rhythm_echo', params: { every: 3, adRatio: 0.5 }, name: 'Twinshot' },
  maera: {
    template: 'mending_ripple',
    params: { ratio: 0.35, range: 6 },
    name: 'Spring Tide',
  },
  torv: {
    template: 'warding_aura',
    params: { radius: 6, armor: 8, mr: 0 },
    name: 'Bulwark Aura',
  },
  rhoka: {
    template: 'serrated_strikes',
    params: { perSecond: 3, perLevel: 0.6, duration: 2.5 },
    name: 'Rend',
  },
  // Lie Low has no template (the lurk is engine data, src/sim/lurk.ts):
  // priced as the nearest one, a burst of speed after a beat.
  nisk: {
    template: 'battle_flow',
    params: { msPct: 0.1, duration: 2 },
    name: 'Lie Low',
  },
};

// The roster champions whose kits use what the Forge does not offer: Nisk's
// charges, hidden pods, fumble and lurk (forge/bounds.ts names none).
export const OUTSIDE_FORGE: readonly string[] = ['nisk'];

export function forgedTwin(champion: ChampionDef): ForgedChampionDef {
  const passive = TWIN_PASSIVES[champion.id];
  if (!passive) throw new Error(`no twin passive mapped for ${champion.id}`);
  const [name, title] = champion.name.split(', ');
  return {
    id: `forged_${champion.id}_twin`,
    name: name ?? champion.name,
    title: title ?? '',
    tagline: champion.blurb,
    role: champion.role,
    creator: 'roster#0000',
    passive,
    base: champion.base,
    growth: champion.growth,
    abilities: champion.abilities,
  };
}

export const FORGED_TWINS: readonly ForgedChampionDef[] = CHAMPION_LIST.filter(
  (c) => !OUTSIDE_FORGE.includes(c.id),
).map(forgedTwin);
