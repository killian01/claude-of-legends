// Structural gate for the painted icon manifest (src/ui/icon_images.ts).
// The manifest is data-as-code that degrades silently in both directions: an
// id listed without its painting shows a broken image, and a painting shipped
// without its id stays invisible behind the procedural painter. Both are
// caught here. The paintings ship as WebP (scripts/convert_art.mjs).

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHAMPIONS } from '../src/sim/content/champions/index';
import { ITEMS } from '../src/sim/content/items';
import { SIGILS } from '../src/sim/content/sigils';
import { ABILITY_ICON_IMAGES, ITEM_ICON_IMAGES, SIGIL_ICON_IMAGES } from '../src/ui/icon_images';

const ICONS = join(process.cwd(), 'public', 'icons');

function paintingsIn(dir: string): string[] {
  const path = join(ICONS, dir);
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((f) => f.endsWith('.webp'))
    .map((f) => f.slice(0, -5))
    .sort();
}

function listed(set: ReadonlySet<string>): string[] {
  return [...set].sort();
}

describe('painted icon manifest', () => {
  it('lists exactly the ability paintings on disk', () => {
    expect(listed(ABILITY_ICON_IMAGES)).toEqual(paintingsIn('abilities'));
  });

  it('lists exactly the item paintings on disk', () => {
    expect(listed(ITEM_ICON_IMAGES)).toEqual(paintingsIn('items'));
  });

  it('lists exactly the sigil paintings on disk', () => {
    expect(listed(SIGIL_ICON_IMAGES)).toEqual(paintingsIn('sigils'));
  });

  it('names real champions, keys, items and sigils', () => {
    for (const id of ABILITY_ICON_IMAGES) {
      const cut = id.lastIndexOf('_');
      const champion = id.slice(0, cut);
      const key = id.slice(cut + 1);
      expect(CHAMPIONS[champion], id).toBeDefined();
      expect(['Q', 'W', 'E', 'R'], id).toContain(key);
    }
    for (const id of ITEM_ICON_IMAGES) expect(ITEMS[id], id).toBeDefined();
    for (const id of SIGIL_ICON_IMAGES) expect(SIGILS[id], id).toBeDefined();
  });
});
