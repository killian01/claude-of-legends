// The status chips as icons (the maintainer, after the forest round: the
// chips at the bottom took too much of the screen; they should be icons
// that say their text on hover; the battle royale's playtest could not
// read their two letters, so they carry a short word now). Pure: what a
// chip shows (the word and a small sub line, the whole seconds left or the
// stacks) and what its tooltip says, so the HUD builds every chip the same
// way and the wording is tested without a DOM.

import type { Status } from '../sim/combat/status';
import type { AspectId } from '../sim/content/rings';
import { ASPECTS } from '../sim/content/rings';

export interface ChipFace {
  // The short word on the chip.
  glyph: string;
  // The small line under the glyph: seconds left, a percent, stacks; empty
  // for a fact with no number.
  sub: string;
  // What the tooltip says on hover.
  tip: string;
}

// A status on the champion as a chip that reads at a glance (the
// playtest could not read "BO", "MA x1" or "AI 0.1"): its name in a short
// word on the icon, under it the whole seconds left (never a decimal), the
// slow's share, the shield's points or the mark's stacks past one, and the
// fact in a sentence in the tip.
const STATUS_WORDS: Readonly<Record<Status['kind'], [word: string, tip: string]>> = {
  stun: ['Stun', 'Stunned'],
  airborne: ['Airborne', 'Knocked airborne'],
  untargetable: ['Untouchable', 'Untouchable'],
  root: ['Rooted', 'Rooted'],
  recall: ['Recall', 'Recalling'],
  slow: ['Slow', 'Slowed'],
  shield: ['Shield', 'Shield'],
  mark: ['Mark', 'Marked'],
  dot: ['Burn', 'Burning'],
  grievous: ['Grievous', 'Grievous wounds, less healing'],
  stealth: ['Hidden', 'Hidden'],
  taunt: ['Taunted', 'Taunted'],
  buff: ['Boost', 'Boosted'],
  blind: ['Blind', 'Blinded'],
  empower: ['Empower', 'Next attack empowered'],
};

export function statusWord(kind: Status['kind']): string {
  return STATUS_WORDS[kind][0];
}

// A status an aura keeps renewing (Torv's Bulwark Aura on himself and on
// the allies by him: a few tenths of a second, renewed every passive tick)
// never runs down while the aura holds, and its "1s" read as a timer stuck
// all match. Such a status shows without a countdown: one that has never
// had more than AURA_WINDOW_S left (the aura's 0.4 s, with room for a
// mirror's clock a tick behind; a status that short has no second to
// count anyway). A status that ran longer keeps its countdown to its end.
export const AURA_WINDOW_S = 0.75;

// The status's identity from frame to frame: a buff by what it gives (the
// sim renews an identical one in place, combat/status.ts refreshBuff),
// another by its kind and its place among its kind.
export function statusKey(s: Status, nth: number): string {
  if (s.kind === 'buff') return `buff:${s.msPct}:${s.asPct}:${s.armor}:${s.mr}`;
  return `${s.kind}:${nth}`;
}

// The most each standing status has had left, frame to frame: the HUD
// steps it with the statuses it shows, and asks whether one is an aura's.
export class AuraWatch {
  private readonly most = new Map<string, number>();

  // The statuses standing now, by key with their seconds left; a key gone
  // is forgotten, so a status that comes back starts anew.
  step(standing: ReadonlyMap<string, number>): void {
    for (const k of [...this.most.keys()]) if (!standing.has(k)) this.most.delete(k);
    for (const [k, left] of standing) this.most.set(k, Math.max(this.most.get(k) ?? 0, left));
  }

  held(key: string): boolean {
    const most = this.most.get(key);
    return most !== undefined && most <= AURA_WINDOW_S;
  }
}

// `held` when an aura keeps it up (AuraWatch): the word alone, and a tip
// that says so instead of the seconds.
export function statusChip(s: Status, time: number, held = false): ChipFace {
  const [word, says] = STATUS_WORDS[s.kind];
  const secs = Math.max(1, Math.ceil(s.until - time));
  const left = held ? 'while the aura holds' : `${secs} s left`;
  if (s.kind === 'slow') {
    const pct = `${Math.round(s.pct * 100)}%`;
    return { glyph: word, sub: pct, tip: `${says} ${pct}, ${left}` };
  }
  if (s.kind === 'shield') {
    const n = String(Math.max(0, Math.round(s.remaining)));
    return { glyph: word, sub: n, tip: `${says} of ${n}, ${left}` };
  }
  if (s.kind === 'mark') {
    const stacks = s.stacks > 1 ? `x${s.stacks}` : '';
    return {
      glyph: word,
      sub: stacks,
      tip: `${says}${s.stacks > 1 ? ` ${s.stacks} times` : ''}, ${left}`,
    };
  }
  return { glyph: word, sub: held ? '' : `${secs}s`, tip: `${says}, ${left}` };
}

// A favor's chip word: the aspect's own name.
export function aspectGlyph(aspect: AspectId): string {
  return ASPECTS[aspect].name;
}

// The Boon's chip: its name, the seconds left, the whole fact in the tip.
export function boonChipFace(pct: number, secondsLeft: number, enemy: boolean): ChipFace {
  const s = Math.max(0, Math.ceil(secondsLeft));
  return {
    glyph: 'Boon',
    sub: `${s}s`,
    tip: `${enemy ? 'ENEMY ' : ''}BOON +${pct}% damage, ${s}s left`,
  };
}

// The Wrath's chip: its name, the seconds left, what it does in the tip.
export function wrathChipFace(text: string, secondsLeft: number, enemy: boolean): ChipFace {
  const s = Math.max(0, Math.ceil(secondsLeft));
  return { glyph: 'Wrath', sub: `${s}s`, tip: `${enemy ? 'ENEMY ' : ''}${text}` };
}

// A favor's chip: the aspect's name, the stacks past one as the sub line,
// what it does in the tip.
export function favorChipFace(
  aspect: AspectId,
  stacks: number,
  text: string,
  enemy: boolean,
): ChipFace {
  return {
    glyph: aspectGlyph(aspect),
    sub: stacks > 1 ? `x${stacks}` : '',
    tip: `${enemy ? 'ENEMY ' : ''}${text}`,
  };
}
