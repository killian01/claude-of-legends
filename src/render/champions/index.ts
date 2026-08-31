// Public seam for rigged champion visuals: the renderer preloads once, then
// asks for a visual per on-screen champion and drives it every frame.

import { instantiateChampion, preloadChampionAssets, whenChampionTemplateReady } from './assets';
import { forgedChampionTemplate } from './forged';
import { ChampionVisual } from './visual';

export type { ChampionAnimInput } from './anim';
export { forgedBarY, registerForgedModel } from './forged';
export { championVisualDef } from './manifest';
export { cinematicPortraitUrl, ensurePortraitAssets } from './portrait';
export { ChampionVisual, preloadChampionAssets };

// Resolves to null (procedural figure stays) when the champion has no GLB
// def or its asset failed to load; the renderer treats null as "keep what
// you have", so this can never blank a champion. Forged champions resolve
// through the runtime registry (registerForgedModel) instead of the static
// manifest. options.ring: false drops the team ring at the feet (cinematic
// stages, not gameplay).
export async function createChampionVisual(
  championId: string | null,
  teamColor: number,
  skin: number,
  options?: { ring?: boolean },
): Promise<ChampionVisual | null> {
  const template =
    (await whenChampionTemplateReady(championId)) ?? (await forgedChampionTemplate(championId));
  if (!template || !championId) return null;
  const { root, rig, anchors } = instantiateChampion(
    championId,
    template,
    teamColor,
    skin,
    options,
  );
  return new ChampionVisual(template, root, rig, anchors);
}
