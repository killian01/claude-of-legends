// The rising arc (docs/design/thornfray.md, The rising arc): every seat of
// a bout lands at the level its bout's number gives, its skill points spent
// by the usual rule (levels.ts spendSkillPoints, the ultimate first when
// its gate allows), with that many pieces of its own planet build
// (loot.ts grantPieces), and with the prize Graft it carries in, if any.
// Nothing from the bout before lives in the Sim: every seat lands level
// with every other, full health and mana.

import { ARC_LEVELS, ARC_PIECES } from '../../content/bouts/match';
import { levelTo } from '../../stats';
import type { Unit } from '../../unit';
import { holdGraft } from '../grafts';
import { spendSkillPoints } from '../levels';
import { grantPieces } from '../loot';
import type { RoyaleMode } from '../mode';

// A seat at bout `index` (0 for the first): its level and its pieces.
export function arcOf(index: number): { level: number; pieces: number } {
  const i = Math.max(0, Math.min(ARC_LEVELS.length - 1, index));
  return { level: ARC_LEVELS[i]!, pieces: ARC_PIECES[i]! };
}

// A champion seated for a bout (the mode's seat, after the planet's
// landing levels): raised to the arc's level, its points spent, the arc's
// pieces of its build given at once (no loot is told: nothing was found),
// the Grafts it carries held, and full health and mana.
export function seatAtBout(
  mode: RoyaleMode,
  u: Unit,
  build: readonly string[],
  index: number,
  carried: readonly string[],
): void {
  const arc = arcOf(index);
  levelTo(u, arc.level);
  spendSkillPoints(u);
  grantPieces(u, build, arc.pieces);
  for (const id of carried) holdGraft(mode, u, id);
  u.hp = u.maxHp;
  u.mana = u.maxMana;
}
