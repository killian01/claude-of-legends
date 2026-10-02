// The item the shop lights for the player (ui/hud.ts): the next step of the
// build the house bots follow for the champion's role (src/sim/playbook/
// kit.ts), so a player who does not know the items yet buys what a bot of
// that champion would, and the first steps can point at it
// (ui/first_steps.ts). Null when the build has nothing to buy next, or
// would have to sell first to buy it.

import { nextKitStep, roleBuild } from '../sim/playbook/kit';

export function suggestedItem(championId: string | null, bag: readonly string[]): string | null {
  const step = nextKitStep(roleBuild(championId), bag, Number.POSITIVE_INFINITY);
  return step?.kind === 'buy' ? step.itemId : null;
}
