// Test fixture: the ten roster champions converted to forged shape. The
// abilities and stats pass through verbatim (they are already the data a
// forged champion declares); each code passive maps to its template
// archetype with the roster's own numbers. These twins are the budget's
// calibration set: the roster is the definition of "fits the power budget".

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
};

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

export const FORGED_TWINS: readonly ForgedChampionDef[] = CHAMPION_LIST.map(forgedTwin);
