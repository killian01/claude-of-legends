// The Forge's budget views (CONTEXT.md: Power budget, Stat envelope,
// Growth envelope, Kit envelope, Burst cap): the three-envelope strip
// every tab shows, the kit overview at the head of the Spells tab, and
// the word a dial says when it stops. Pure DOM over the sim's own
// arithmetic; each view updates in place, so a drag on a polygon or a
// dial moves it live without a re-render.

import type { BudgetBreakdown } from '../sim/forge/budget';
import { budgetOf } from '../sim/forge/budget';
import { BASICS_BURST_CAP, BURST_REF, burstCapOf, burstOf } from '../sim/forge/burst';
import { ENVELOPE_KEYS, ENVELOPES, type EnvelopeKey, envelopeSpend } from '../sim/forge/envelopes';
import type { ForgedChampionDef } from '../sim/forge/forged_def';
import type { DialStop } from '../sim/forge/spell_power';
import type { AbilityKey } from '../sim/types';

export const BUDGET_VIEW_CSS = `
.fe-env { margin: 2px 0 6px; }
.fe-env-row { display: flex; justify-content: space-between; align-items: baseline; font-size: 11px; }
.fe-env-row b { color: #c9a84a; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; font-size: 10px; }
.fe-env-row span { color: #d8cdb0; font-variant-numeric: tabular-nums; }
.fe-env-row span.full { color: #e8cc74; }
.fe-env-row span.over { color: #d06a6a; }
.fe-env-bar { height: 8px; border-radius: 4px; background: #1a130a; border: 1px solid #4a3a1c; overflow: hidden; margin: 3px 0 8px; }
.fe-env-fill { height: 100%; background: linear-gradient(90deg, #7ca050, #c9a84a); transition: width 0.15s ease; }
.fe-env-fill.full { background: linear-gradient(90deg, #c9a84a, #e8cc74); box-shadow: 0 0 6px rgba(232, 204, 116, 0.45); }
.fe-env-fill.over { background: linear-gradient(90deg, #c9a84a, #d06a6a); }
.fe-kit-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
.fe-kit-head b { color: #e8cc74; font-size: 13px; letter-spacing: 0.4px; }
.fe-kit-head span { color: #d8cdb0; font-size: 12px; font-variant-numeric: tabular-nums; }
.fe-kit-head span.over { color: #d06a6a; }
.fe-seg-bar { display: flex; height: 20px; border-radius: 10px; overflow: hidden; background: #1a130a; border: 1px solid #4a3a1c; }
.fe-seg-bar.over { border-color: #d06a6a; box-shadow: 0 0 6px rgba(208, 106, 106, 0.4); }
.fe-seg {
  height: 100%; display: flex; align-items: center; justify-content: center; flex: none;
  font-size: 10px; font-weight: 800; color: #241a08; overflow: hidden; white-space: nowrap;
  transition: width 0.15s ease; letter-spacing: 0.3px;
}
.fe-seg.P { background: linear-gradient(180deg, #b89a5a, #8e7238); }
.fe-seg.Q { background: linear-gradient(180deg, #f0deae, #d8b45a); }
.fe-seg.W { background: linear-gradient(180deg, #d8b45a, #b8923a); }
.fe-seg.E { background: linear-gradient(180deg, #c09a44, #9a7a2e); }
.fe-seg.R { background: linear-gradient(180deg, #ffb070, #ff8a2d); }
.fe-seg.free { flex: 1; color: #6b5a2e; font-weight: 700; background: transparent; justify-content: flex-end; padding-right: 8px; }
.fe-seg-legend { display: flex; gap: 12px; margin-top: 6px; font-size: 11px; color: #b0a37e; flex-wrap: wrap; }
.fe-seg-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
.fe-seg-legend i.P { background: #a8884a; } .fe-seg-legend i.Q { background: #e8cc74; }
.fe-seg-legend i.W { background: #c9a84a; } .fe-seg-legend i.E { background: #a88a3c; }
.fe-seg-legend i.R { background: #ff9a3d; }
.fe-seg-legend b { color: #d8cdb0; font-variant-numeric: tabular-nums; }
.fe-burst-title { display: flex; align-items: baseline; gap: 8px; margin-top: 12px; }
.fe-burst-title b { color: #e8cc74; font-size: 13px; letter-spacing: 0.4px; }
.fe-burst-title span { color: #97854f; font-size: 10.5px; }
.fe-burst { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
.fe-burst-chip {
  flex: 1; min-width: 118px; padding: 7px 9px; border-radius: 8px; border: 1px solid #33270f;
  background: rgba(26, 19, 10, 0.6);
}
.fe-burst-chip.wide { flex-basis: 100%; }
.fe-burst-chip.over { border-color: #d06a6a; }
.fe-burst-head { display: flex; align-items: center; gap: 7px; font-size: 11px; color: #b0a37e; }
.fe-burst-head .fe-key { width: 22px; height: 22px; font-size: 12px; flex: none; }
.fe-burst-head span:last-child { margin-left: auto; color: #d8cdb0; font-variant-numeric: tabular-nums; }
.fe-burst-bar { height: 6px; border-radius: 3px; background: #120d06; border: 1px solid #33270f; overflow: hidden; margin-top: 6px; }
.fe-burst-fill { height: 100%; background: linear-gradient(90deg, #7ca050, #c9a84a); transition: width 0.15s ease; }
.fe-burst-fill.hot { background: linear-gradient(90deg, #c9a84a, #ff9a3d); }
.fe-burst-fill.over { background: #d06a6a; }
.fe-stop {
  display: inline-block; font-size: 10px; font-weight: 800; letter-spacing: 0.6px;
  text-transform: uppercase; padding: 2px 8px; border-radius: 999px; border: 1px solid #6b5a2e;
  color: #e8cc74; background: #2c2210; white-space: nowrap;
}
.fe-stop.burst, .fe-stop.kit_burst { border-color: #b8602e; color: #ffb070; background: #2e1a0c; }
.fe-stop:empty { display: none; }
`;

function h(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// A view that updates in place: build once, feed it as the numbers move.
export interface LiveView<T> {
  el: HTMLElement;
  update(value: T): void;
}

const ENVELOPE_NAMES: Record<EnvelopeKey, string> = {
  stats: 'Stats',
  growth: 'Growth',
  kit: 'Kit',
};

// Where a spend stands against its line: full within half a point
// (the fit's landing), over past it.
function standing(spend: number, cap: number): '' | 'full' | 'over' {
  if (spend > cap + 1e-6) return 'over';
  if (spend >= cap - 0.5) return 'full';
  return '';
}

// The three envelopes, one bar each: the whole picture in one glance, in
// every tab (the right rail's Power budget panel).
export function envelopeStrip(): LiveView<BudgetBreakdown> {
  const root = h('div', 'fe-env');
  const rows = {} as Record<EnvelopeKey, { num: HTMLElement; fill: HTMLElement }>;
  for (const key of ENVELOPE_KEYS) {
    const row = h('div', 'fe-env-row');
    const num = h('span', '', '');
    row.append(h('b', '', ENVELOPE_NAMES[key]), num);
    const bar = h('div', 'fe-env-bar');
    const fill = h('div', 'fe-env-fill');
    bar.append(fill);
    root.append(row, bar);
    rows[key] = { num, fill };
  }
  return {
    el: root,
    update(bill) {
      const spend = envelopeSpend(bill);
      for (const key of ENVELOPE_KEYS) {
        const cap = ENVELOPES[key];
        const state = standing(spend[key], cap);
        const row = rows[key];
        row.fill.style.width = `${Math.min(100, (100 * spend[key]) / cap)}%`;
        row.fill.className = `fe-env-fill${state ? ` ${state}` : ''}`;
        row.num.className = state;
        row.num.textContent = `${Math.round(spend[key])} / ${cap}`;
      }
    },
  };
}

type KitPart = 'P' | AbilityKey;
const KIT_PARTS: readonly { key: KitPart; label: string }[] = [
  { key: 'P', label: 'Passive' },
  { key: 'Q', label: 'Q' },
  { key: 'W', label: 'W' },
  { key: 'E', label: 'E' },
  { key: 'R', label: 'R' },
];
const SPELL_KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];

function partCost(bill: BudgetBreakdown, key: KitPart): number {
  return key === 'P' ? bill.passive : bill.abilities[key];
}

interface BurstChip {
  root: HTMLElement;
  num: HTMLElement;
  fill: HTMLElement;
}

function burstChip(head: HTMLElement, wide: boolean): BurstChip {
  const root = h('div', `fe-burst-chip${wide ? ' wide' : ''}`);
  const top = h('div', 'fe-burst-head');
  const num = h('span', '', '');
  top.append(head, num);
  const bar = h('div', 'fe-burst-bar');
  const fill = h('div', 'fe-burst-fill');
  bar.append(fill);
  root.append(top, bar);
  return { root, num, fill };
}

function setBurst(chip: BurstChip, hit: number, cap: number): void {
  const share = hit / cap;
  chip.fill.style.width = `${Math.min(100, 100 * share)}%`;
  chip.fill.className = `fe-burst-fill${share > 1 ? ' over' : share > 0.85 ? ' hot' : ''}`;
  chip.root.classList.toggle('over', share > 1);
  chip.num.textContent = `${Math.round(hit)} / ${Math.round(cap)}`;
}

// The kit overview at the head of the Spells tab: the kit envelope as one
// bar cut into its five parts with the free room at the end, then the
// burst caps, one chip per spell and one for the three basics together.
export function kitOverview(): LiveView<ForgedChampionDef> {
  const root = h('div', 'fe-kit');
  const head = h('div', 'fe-kit-head');
  const headNum = h('span', '', '');
  head.append(h('b', '', 'Kit envelope'), headNum);
  const bar = h('div', 'fe-seg-bar');
  const segs = {} as Record<KitPart, HTMLElement>;
  for (const part of KIT_PARTS) {
    const seg = h('div', `fe-seg ${part.key}`, part.key);
    seg.title = part.label;
    bar.append(seg);
    segs[part.key] = seg;
  }
  const free = h('div', 'fe-seg free', '');
  bar.append(free);
  const legend = h('div', 'fe-seg-legend');
  const legendNums = {} as Record<KitPart, HTMLElement>;
  for (const part of KIT_PARTS) {
    const item = h('span', '');
    const num = h('b', '', '');
    item.append(h('i', part.key), `${part.label} `, num);
    legend.append(item);
    legendNums[part.key] = num;
  }
  const burstTitle = h('div', 'fe-burst-title');
  burstTitle.append(
    h('b', '', 'Burst'),
    h('span', '', `one cast on one fresh target of ${BURST_REF.hp} health, rank 1`),
  );
  const chips = h('div', 'fe-burst');
  const spellChips = {} as Record<AbilityKey, BurstChip>;
  for (const key of SPELL_KEYS) {
    const chip = burstChip(h('span', 'fe-key', key), false);
    chips.append(chip.root);
    spellChips[key] = chip;
  }
  const together = burstChip(h('span', '', 'Q, W and E together'), true);
  chips.append(together.root);
  root.append(head, bar, legend, burstTitle, chips);
  return {
    el: root,
    update(def) {
      const bill = budgetOf(def);
      const cap = ENVELOPES.kit;
      const spend = envelopeSpend(bill).kit;
      const state = standing(spend, cap);
      headNum.textContent = `${Math.round(spend)} / ${cap}`;
      headNum.className = state;
      bar.classList.toggle('over', state === 'over');
      // Widths as shares of the envelope; an over-line kit fills the bar
      // and the free room disappears.
      const scale = Math.max(cap, spend);
      for (const part of KIT_PARTS) {
        const cost = partCost(bill, part.key);
        const pct = (100 * cost) / scale;
        segs[part.key].style.width = `${pct}%`;
        segs[part.key].textContent = pct >= 6 ? part.key : '';
        legendNums[part.key].textContent = String(Math.round(cost));
      }
      const room = cap - spend;
      free.textContent =
        room >= 0.5 && (100 * room) / scale >= 10 ? `${Math.round(room)} free` : '';
      const burst = burstOf(def);
      for (const key of SPELL_KEYS)
        setBurst(spellChips[key], burst.abilities[key], burstCapOf(key));
      setBurst(together, burst.basics, BASICS_BURST_CAP);
    },
  };
}

// The word under a dial that stopped short of its ask.
export function dialStopLabel(stop: DialStop): string {
  switch (stop) {
    case 'envelope':
      return 'kit envelope';
    case 'burst':
      return 'burst cap';
    case 'kit_burst':
      return 'basics burst cap';
  }
}

// The sentence behind the word: what to lighten to free the room.
export function dialStopHint(stop: DialStop): string {
  switch (stop) {
    case 'envelope':
      return 'The kit envelope is full: lighten another spell or the passive to make room.';
    case 'burst':
      return 'This spell already deals what one cast may deal to a single target at rank 1.';
    case 'kit_burst':
      return 'Q, W and E together already deal what the three basics may: lighten one of the others.';
  }
}
