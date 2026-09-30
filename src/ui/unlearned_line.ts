// What the HUD says when a spell with no rank is pressed (game/boot.ts's
// cast gate, and a slot tap with no point to spend, ui/slot_tap.ts): why
// nothing happened, and how to learn it with the hands the player has. A
// phone has no Alt key and no pointer to click with, and its players were
// told "Alt+Q or click the +" by the first spell they tapped. With no
// skill point left there is no + to press at all: the next level brings
// one.

import { ULT_RANK_LEVELS } from '../sim/stats';
import type { AbilityKey } from '../sim/types';

export function unlearnedLine(
  name: string,
  key: AbilityKey,
  level: number,
  touch: boolean,
  points: number,
): string {
  const ultLevel = ULT_RANK_LEVELS[0]!;
  if (key === 'R' && level < ultLevel) return `${name} unlocks at level ${ultLevel}.`;
  if (points <= 0) return `${name} needs a skill point. The next level brings one.`;
  return touch
    ? `${name} needs a skill point. Tap the gold + to learn it.`
    : `${name} needs a skill point: Alt+${key} or click the +.`;
}
