// Recall (game definition: B, 8 second channel): a champion that stands
// still for the full channel teleports to its fountain. Taking damage or
// issuing any order cancels the channel (see damage.ts and the Sim command
// methods). The channel is an ordinary status, so allies AND enemies see it
// (genre behavior), and it rides the wire like any other status chip.

import type { GameMap } from './content/map';
import type { CombatCtx } from './sim_context';
import type { Unit } from './unit';

export const RECALL_CHANNEL_S = 8;

export function startRecall(u: Unit, time: number): void {
  u.path = [];
  u.attackTargetId = null;
  u.attackMoveTarget = null;
  u.statuses = u.statuses.filter((s) => s.kind !== 'recall');
  u.statuses.push({ kind: 'recall', until: time + RECALL_CHANNEL_S });
}

// Runs BEFORE status expiry each tick: a recall that reached its end
// teleports the champion home.
export function stepRecalls(ctx: CombatCtx, map: GameMap): void {
  for (const u of ctx.units.values()) {
    if (u.kind !== 'champion' || u.dead) continue;
    const recall = u.statuses.find((s) => s.kind === 'recall');
    if (!recall || recall.until > ctx.time) continue;
    u.statuses = u.statuses.filter((s) => s.kind !== 'recall');
    const fountain = map.fountains.find((f) => f.team === u.team);
    if (!fountain) continue;
    u.pos = { x: fountain.x, z: fountain.z };
    u.path = [];
    u.attackTargetId = null;
  }
}
