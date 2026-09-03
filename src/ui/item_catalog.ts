// The item catalog and the build row of the Academy (playtest round 3: a
// build was chosen from a text list, blind). The catalog shows the shop's
// cards, icon, name, cost and recipe, with the same tooltip a match shows,
// in the shop's three sections; the build is a row of icon slots in buying
// order, reordered and dropped in place. DOM only: the rules of a build
// (copies, components, the bag) live in src/sim/playbook/kit.ts.

import { ITEM_LIST, ITEMS, type ItemDef } from '../sim/content/items';
import { describeItem, statLabel } from './describe';
import { itemIconUrl } from './icons';
import { el } from './menu';
import { attachTooltip } from './tooltips';

const CSS = `
.ic-cat { margin: 4px 0 8px; }
.ic-sec { margin: 6px 0 4px; font-size: 10.5px; color: #6cc3e0; letter-spacing: 0.6px; text-transform: uppercase; }
.ic-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 6px; }
.ic-card {
  position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding: 6px 4px 5px; border-radius: 7px; border: 1px solid #2c4d60; background: #0b141a;
  color: #d8e4ec; font-size: 11px; text-align: center; cursor: pointer; font-family: inherit;
  transition: transform 0.09s ease, border-color 0.12s ease;
}
.ic-card.tier1 { border-color: #3b4f5c; }
.ic-card.tier2 { border-color: #5f7b8c; }
.ic-card.tier3 { border-color: #8d7530; background: linear-gradient(180deg, #1d1c10, #0b141a); }
.ic-card:hover:not(:disabled) { transform: translateY(-2px); border-color: #8ed6f0; }
.ic-card:disabled { opacity: 0.45; cursor: default; }
.ic-card img { width: 44px; height: 44px; border-radius: 5px; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.6); }
.ic-name { line-height: 1.2; font-weight: 600; color: #e4eef4; min-height: 26px; display: flex; align-items: center; }
.ic-cost { color: #ffd94a; font-weight: 800; font-size: 11px; }
.ic-recipe { display: flex; gap: 3px; justify-content: center; min-height: 16px; }
.ic-recipe img { width: 14px; height: 14px; border-radius: 3px; opacity: 0.9; box-shadow: none; }
.ic-count {
  position: absolute; top: 3px; right: 3px; background: #17303d; color: #8ed6f0;
  border: 1px solid #8ed6f0; border-radius: 4px; font-size: 9px; font-weight: 800; padding: 0 4px;
}
.ic-build { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 6px; align-items: flex-start; }
.ic-slot { display: flex; flex-direction: column; align-items: center; gap: 2px; width: 46px; }
.ic-slot img { width: 40px; height: 40px; border-radius: 5px; border: 1px solid #2c4d60; background: #070d12; }
.ic-slot .n { font-size: 9.5px; color: #5f8299; }
.ic-slot-tools { display: flex; gap: 1px; }
.ic-slot-tools button {
  padding: 0 4px; font-size: 9.5px; line-height: 14px; border-radius: 3px; border: 1px solid #1f3644;
  background: #0c161d; color: #c8d6e0; cursor: pointer; font-family: inherit;
}
.ic-slot-tools button:hover:not(:disabled) { border-color: #8ed6f0; }
.ic-slot-tools button:disabled { opacity: 0.3; cursor: default; }
.ic-empty { color: #5f8299; font-size: 11.5px; padding: 6px 0; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

const SECTIONS: readonly (readonly [1 | 2 | 3, string])[] = [
  [1, 'Components'],
  [2, 'Finished items, built from two components'],
  [3, 'Legendary upgrades, built from a finished item'],
];

// One card: the icon, the name, the recipe as small icons, the price; the
// tooltip is the match's own. `count` is how many the build already lists.
export function itemCard(
  item: ItemDef,
  opts: { onPick?: (id: string) => void; count?: number; disabled?: boolean } = {},
): HTMLButtonElement {
  ensureCss();
  const btn = el('button', `ic-card tier${item.tier}`) as HTMLButtonElement;
  btn.type = 'button';
  btn.dataset.item = item.id;
  const icon = document.createElement('img');
  icon.src = itemIconUrl(item);
  icon.alt = item.name;
  const recipe = el('div', 'ic-recipe');
  for (const compId of item.buildsFrom ?? []) {
    const comp = ITEMS[compId];
    if (!comp) continue;
    const mini = document.createElement('img');
    mini.src = itemIconUrl(comp);
    mini.alt = comp.name;
    recipe.appendChild(mini);
  }
  btn.append(icon, el('div', 'ic-name', item.name), recipe, el('div', 'ic-cost', `${item.cost}g`));
  if (opts.count && opts.count > 0) btn.append(el('span', 'ic-count', `x${opts.count}`));
  btn.disabled = opts.disabled === true;
  attachTooltip(btn, () => describeItem(item, statLabel(item.stats)));
  if (opts.onPick) {
    const pick = opts.onPick;
    btn.addEventListener('click', () => pick(item.id));
  }
  return btn;
}

// The whole shop, in its sections; a click on a card is a pick.
export function itemCatalog(opts: {
  onPick: (id: string) => void;
  counts?: ReadonlyMap<string, number>;
  disabled?: boolean;
}): HTMLElement {
  ensureCss();
  const box = el('div', 'ic-cat');
  for (const [tier, title] of SECTIONS) {
    box.append(el('div', 'ic-sec', title));
    const cards = el('div', 'ic-cards');
    for (const item of ITEM_LIST) {
      if (item.tier !== tier) continue;
      cards.append(
        itemCard(item, {
          onPick: opts.onPick,
          count: opts.counts?.get(item.id) ?? 0,
          disabled: opts.disabled,
        }),
      );
    }
    box.append(cards);
  }
  return box;
}

// How many times each item appears in a build.
export function buildCounts(build: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of build) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

// The build as icon slots in buying order. With `onChange`, each slot can
// move earlier, later, or out; without it the row only shows.
export function buildRow(
  build: readonly string[],
  opts: { onChange?: (next: string[]) => void; disabled?: boolean } = {},
): HTMLElement {
  ensureCss();
  const row = el('div', 'ic-build');
  if (build.length === 0) {
    row.append(el('div', 'ic-empty', 'Nothing yet: pick items below, in the order to buy them.'));
    return row;
  }
  const swapped = (a: number, b: number): string[] => {
    const n = [...build];
    const va = n[a]!;
    n[a] = n[b]!;
    n[b] = va;
    return n;
  };
  build.forEach((id, i) => {
    const item = ITEMS[id];
    const slot = el('div', 'ic-slot');
    slot.dataset.item = id;
    const img = document.createElement('img');
    if (item) {
      img.src = itemIconUrl(item);
      img.alt = item.name;
      attachTooltip(img, () => describeItem(item, statLabel(item.stats)));
    } else img.alt = id;
    slot.append(el('span', 'n', `${i + 1}`), img);
    const change = opts.onChange;
    if (change) {
      const tools = el('div', 'ic-slot-tools');
      const mk = (label: string, title: string, fn: () => void, off: boolean): void => {
        const b = el('button', '', label) as HTMLButtonElement;
        b.type = 'button';
        b.title = title;
        b.disabled = off || opts.disabled === true;
        b.addEventListener('click', fn);
        tools.append(b);
      };
      mk('<', 'Buy it earlier', () => change(swapped(i, i - 1)), i === 0);
      mk('>', 'Buy it later', () => change(swapped(i, i + 1)), i === build.length - 1);
      mk('x', 'Drop it from the build', () => change(build.filter((_, j) => j !== i)), false);
      slot.append(tools);
    }
    row.append(slot);
  });
  return row;
}
