// A coach seat's hands (ADR 0013): the bot casts, ranks and fires its
// sigils itself, and the mirror world refuses those verbs from a coach
// (net/client_world.ts). So the seat's keys and slots raise no aim, sound
// no denial and offer no rank: the spells are a kit to read, with their
// cooldowns. The walk, the attack, the recall and the rest stay, since a
// coach's move and attack become its bot's orders.

import type { GuideMode } from '../ui/lane_guide';
import type { InputHandlers } from './input';

export function seatCasts(guide: GuideMode): boolean {
  return guide !== 'coach';
}

// The same handlers with every cast, aim and rank verb answering nothing.
export function withoutCasts(h: InputHandlers): InputHandlers {
  const none = (): void => {};
  return {
    ...h,
    onCast: none,
    onAimEnd: none,
    onLevelAbility: none,
    onCastSigil: none,
    onThumbAim: none,
    onThumbCast: none,
    onThumbSigil: none,
  };
}
