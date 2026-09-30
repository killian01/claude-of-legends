// Who the opponents' lane seats play in Practice (CONTEXT.md: Practice):
// Gentle, the Gentle player, a newcomer's fair first fight; or Normal, the
// house styles drawn from the seed, the bots every other match meets.
// Chosen on the practice select, Gentle until the viewer says otherwise,
// and remembered in the browser with the other settings
// (src/game/settings.ts). A Forge test drive goes through no select and
// meets Normal: its creator came to see the champion fight.

import { gentleSeats, type HouseSeat } from '../sim/content/bots/house';
import { GENTLE_FROM_LEVEL, GENTLE_FROM_S } from '../sim/content/playbooks/gentle';

export type PracticeBots = 'gentle' | 'normal';

// In the order the select shows them.
export const PRACTICE_BOTS: readonly PracticeBots[] = ['gentle', 'normal'];

export const DEFAULT_PRACTICE_BOTS: PracticeBots = 'gentle';

// What the select's row is called.
export const PRACTICE_BOTS_LABEL = 'Enemy bots';

// Any junk from storage in, one of the two out.
export function clampPracticeBots(raw: unknown): PracticeBots {
  return raw === 'normal' ? 'normal' : DEFAULT_PRACTICE_BOTS;
}

// What its button says.
export function practiceBotsTitle(bots: PracticeBots): string {
  return bots === 'gentle' ? 'Gentle' : 'Normal';
}

// What a long look at its button tells, the Gentle player's threshold
// read off its playbook so the two cannot drift apart.
export function practiceBotsHint(bots: PracticeBots): string {
  if (bots === 'normal') return 'Normal: the house bots every other match meets.';
  const at = `${Math.floor(GENTLE_FROM_S / 60)}:${String(GENTLE_FROM_S % 60).padStart(2, '0')}`;
  return (
    'Gentle: they trade back when hit, never dive a tower, and start no fight ' +
    `of their own before ${at} and level ${GENTLE_FROM_LEVEL}.`
  );
}

// The opponents' seats for one practice match: Gentle puts the Gentle
// player on every lane seat and keeps the Jungler (gentleSeats); Normal
// keeps the styles the fill drew. Either way the champions, the lanes and
// the seed's stream are the fill's.
export function practiceOpponents(seats: readonly HouseSeat[], bots: PracticeBots): HouseSeat[] {
  return bots === 'gentle' ? gentleSeats(seats) : [...seats];
}
