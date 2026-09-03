// Painted image icons, the woc two-track pipeline (ADR 0001 precedent):
// real painted art per ability and per item ships under public/icons/ and
// is listed here as data-as-code; anything not listed falls back to the
// procedural canvas painter (ability_icons.ts, icons.ts) so coverage never
// breaks while the art lands incrementally. Every painting follows the art
// contract in docs/design/icon-art-style.md. A forged champion's generated
// icons (forged_icons.ts) come first: they are the creator's own art.

import { forgedIconUrl } from './forged_icons';

// Ability paintings shipped at public/icons/abilities/<championId>_<KEY>.webp.
export const ABILITY_ICON_IMAGES: ReadonlySet<string> = new Set<string>([
  'korrath_Q',
  'korrath_W',
  'korrath_E',
  'korrath_R',
  'dain_Q',
  'dain_W',
  'dain_E',
  'dain_R',
  'torv_Q',
  'torv_W',
  'torv_E',
  'torv_R',
  'sylra_Q',
  'sylra_W',
  'sylra_E',
  'sylra_R',
  'fenn_Q',
  'fenn_W',
  'fenn_E',
  'fenn_R',
  'elowen_Q',
  'elowen_W',
  'elowen_E',
  'elowen_R',
  'vesk_Q',
  'vesk_W',
  'vesk_E',
  'vesk_R',
  'ashvyn_Q',
  'ashvyn_W',
  'ashvyn_E',
  'ashvyn_R',
  'maera_Q',
  'maera_W',
  'maera_E',
]);

// Sigil paintings shipped at public/icons/sigils/<sigilId>.webp.
export const SIGIL_ICON_IMAGES: ReadonlySet<string> = new Set<string>([
  'riftstep',
  'zephyr',
  'mend',
  'sear',
]);

// Item paintings shipped at public/icons/items/<itemId>.webp.
export const ITEM_ICON_IMAGES: ReadonlySet<string> = new Set<string>([
  'iron_blade',
  'spark_rod',
  'guard_plate',
  'null_cloak',
  'heart_gem',
  'mind_gem',
  'swift_fang',
  'traveler_soles',
  'warbrand',
  'storm_staff',
  'sunder_axe',
  'void_crystal',
  'stone_bulwark',
  'spirit_ward',
  'colossus_heart',
  'archmind',
  'windrazor',
  'titan_cleaver',
  'swiftplate',
  'clarity_stone',
  'swift_treads',
  'doombrand',
  'tempest_core',
  'rendfang',
  'null_engine',
  'skyshear',
  'worldheart',
  'runeblade',
]);

export function abilityImageUrl(championId: string | null | undefined, key: string): string | null {
  if (!championId) return null;
  const forged = forgedIconUrl(championId, key);
  if (forged) return forged;
  const id = `${championId}_${key}`;
  return ABILITY_ICON_IMAGES.has(id) ? `/icons/abilities/${id}.webp` : null;
}

export function itemImageUrl(itemId: string): string | null {
  return ITEM_ICON_IMAGES.has(itemId) ? `/icons/items/${itemId}.webp` : null;
}

export function sigilImageUrl(sigilId: string): string | null {
  return SIGIL_ICON_IMAGES.has(sigilId) ? `/icons/sigils/${sigilId}.webp` : null;
}
