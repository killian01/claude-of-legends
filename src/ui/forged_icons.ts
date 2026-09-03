// The generated spell icons of forged champions (plan-forge phase 4): a
// creator picks one per slot in the Forge, and the champion's HUD must
// wear them in the match, not the procedural painting. The client glue
// (src/game/forged_visuals.ts) announces a champion's icons here wherever
// its assets arrive (the draft rail, the gallery, a match_start payload),
// and the ability icon resolver (icon_images.ts) asks here before the
// shipped paintings. URLs are absolute (the glue prefixes the asset
// route); a slot without one keeps the procedural painting.

const FORGED_ICONS = new Map<string, Record<string, string>>();

// The latest word wins: the set replaces the champion's previous one, so
// an icon the creator un-picked stops showing at the next announcement.
export function registerForgedIcons(championId: string, icons: Record<string, string>): void {
  FORGED_ICONS.set(championId, { ...icons });
}

export function forgedIconUrl(championId: string, key: string): string | null {
  return FORGED_ICONS.get(championId)?.[key] ?? null;
}

// Test seam.
export function clearForgedIcons(): void {
  FORGED_ICONS.clear();
}
