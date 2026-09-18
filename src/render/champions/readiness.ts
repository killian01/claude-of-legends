// What a match waits for before it is shown: every champion model the match
// can put on the field, and the authored spell effects. A match starts when
// everything is loaded, so nobody ever plays, or plays against, the
// procedural figure that stands in for a model while it downloads. The
// renderer still fails soft on a model that never loads (the figure stays,
// the match plays), so this resolves on every answer, loaded or not: it
// only ever waits, never blocks.

import { preloadSylraEffects } from '../vfx/sylra_fx';
import { preloadChampionAssets, whenChampionTemplateReady } from './assets';
import { forgedChampionTemplate } from './forged';
import { CHAMPION_VISUALS } from './manifest';

// The models a match may need: the whole roster (a 5v5 on the fill draws
// on nearly all of it, and the rest is already coming for the next match)
// plus the forged champions this match brought, once each.
export function matchModelIds(forgedIds: readonly string[] = []): string[] {
  const ids = new Set<string>(Object.keys(CHAMPION_VISUALS));
  for (const id of forgedIds) ids.add(id);
  return [...ids];
}

export type ModelProgress = (loaded: number, total: number) => void;

export async function whenChampionModelsReady(
  forgedIds: readonly string[] = [],
  onProgress?: ModelProgress,
): Promise<void> {
  // Idempotent: the home, the select screen or a renderer usually started
  // the downloads long before this; a host that reached here first starts
  // them now.
  preloadChampionAssets();
  const ids = matchModelIds(forgedIds);
  let loaded = 0;
  onProgress?.(loaded, ids.length);
  const one = async (id: string): Promise<void> => {
    try {
      (await whenChampionTemplateReady(id)) ?? (await forgedChampionTemplate(id));
    } catch {
      // Fail-soft, like the renderer: the figure stands in for this one.
    }
    loaded++;
    onProgress?.(loaded, ids.length);
  };
  await Promise.all([...ids.map(one), preloadSylraEffects().catch(() => undefined)]);
}
