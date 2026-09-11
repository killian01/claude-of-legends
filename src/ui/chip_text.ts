// The status chips as icons (the maintainer, after the forest round: the
// chips at the bottom took too much of the screen; they should be icons
// that say their text on hover). Pure: what a chip's icon shows (a glyph
// of two letters and a small sub line, the seconds left or the stacks)
// and what its tooltip says, so the HUD builds every chip the same way
// and the wording is tested without a DOM.

import type { AspectId } from '../sim/content/rings';
import { ASPECTS } from '../sim/content/rings';

export interface ChipFace {
  // Two or three letters on the icon.
  glyph: string;
  // The small line under the glyph: seconds left, a percent, stacks; empty
  // for a fact with no number.
  sub: string;
  // What the tooltip says on hover.
  tip: string;
}

// A status label as the HUD writes it ("STUN 1.2", "SLOW 35%", "MARK x2",
// "BURNING") read into an icon: the word's first two letters, the number
// after it as the sub line, the whole label as the tip.
export function statusChipFace(label: string): ChipFace {
  const [word = '', ...rest] = label.split(' ');
  return { glyph: word.slice(0, 2).toUpperCase(), sub: rest.join(' '), tip: label };
}

export function aspectGlyph(aspect: AspectId): string {
  return ASPECTS[aspect].name.slice(0, 2).toUpperCase();
}

// The Boon's icon: B, the seconds left, the whole fact in the tip.
export function boonChipFace(pct: number, secondsLeft: number, enemy: boolean): ChipFace {
  const s = Math.max(0, Math.ceil(secondsLeft));
  return {
    glyph: 'B',
    sub: `${s}s`,
    tip: `${enemy ? 'ENEMY ' : ''}BOON +${pct}% damage, ${s}s left`,
  };
}

// The Wrath's icon: W, the seconds left, what it does in the tip.
export function wrathChipFace(text: string, secondsLeft: number, enemy: boolean): ChipFace {
  const s = Math.max(0, Math.ceil(secondsLeft));
  return { glyph: 'W', sub: `${s}s`, tip: `${enemy ? 'ENEMY ' : ''}${text}` };
}

// A favor's icon: the aspect's two letters, the stacks past one as the
// sub line, what it does in the tip.
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
