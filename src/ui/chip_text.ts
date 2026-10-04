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

export function statusChip(s: Status, time: number): ChipFace {
  const [word, says] = STATUS_WORDS[s.kind];
  const secs = Math.max(1, Math.ceil(s.until - time));
  const left = `${secs} s left`;
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
  return { glyph: word, sub: `${secs}s`, tip: `${says}, ${left}` };
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
