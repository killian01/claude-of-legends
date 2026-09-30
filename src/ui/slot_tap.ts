// What a finger or a click on a spell's slot does (game/boot.ts). A spell
// not learned yet is learned on the spot while a skill point waits for it,
// through the ordinary level-up command, the one the slot's + sends, so it
// is recorded and replayed like any other command. With no point to spend
// the press is refused with the line that says why (unlearned_line.ts),
// and a learned spell casts as it always did. A match opens at level 1
// with the point unspent and every basic spell unlearned: a phone's first
// tap on a spell used to play the deny sound and point at a 19 px +.
//
// Pure, pinned by tests/slot_tap.test.ts, which also holds rankable to the
// sim's own rule (Sim.levelAbility); the HUD's + marks follow it too.

import { BASIC_MAX_RANK, effectiveRank, ULT_MAX_RANK, ULT_RANK_LEVELS } from '../sim/stats';
import type { AbilityKey } from '../sim/types';
import type { Unit } from '../sim/unit';

export type SlotTap = 'cast' | 'learn' | 'refuse';

// Whether a skill point can go on the spell right now.
export function rankable(u: Readonly<Unit>, key: AbilityKey): boolean {
  if (u.skillPoints <= 0) return false;
  const rank = effectiveRank(u, key);
  if (key === 'R') {
    return rank < ULT_MAX_RANK && u.level >= (ULT_RANK_LEVELS[rank] ?? Number.POSITIVE_INFINITY);
  }
  return rank < BASIC_MAX_RANK;
}

export function slotTap(u: Readonly<Unit>, key: AbilityKey): SlotTap {
  if (effectiveRank(u, key) > 0) return 'cast';
  return rankable(u, key) ? 'learn' : 'refuse';
}
