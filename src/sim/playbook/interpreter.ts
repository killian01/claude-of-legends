// The playbook interpreter: one Policy (ADR 0002) whose decisions come from
// data (ADR 0013). Each slot: the engine reflexes first (dodging, the
// banked recast home, skill points, holding a recall channel), then the
// plays in order, the first one that can act winning. Deterministic and
// I/O free like every Policy; the optional trace reports which play acted,
// for the active-play overlay and the report, and never influences a
// decision.

import type { Action, Policy } from '../policy';
import { runBehavior } from './behaviors';
import {
  buildSlotContext,
  dodge,
  holdRecall,
  levelUp,
  recastHome,
  type SlotContext,
} from './micro';
import { holds } from './triggers';
import type { PlaybookDef } from './types';

// The trace ids of the reflexes and of a slot where nothing could act.
export const REFLEX_IDS = {
  dodge: 'reflex:dodge',
  recastHome: 'reflex:recast-home',
  level: 'reflex:level',
  holdRecall: 'reflex:hold-recall',
} as const;
export const IDLE_ID = 'idle';

const REFLEXES: readonly { id: string; run: (ctx: SlotContext) => Action | null }[] = [
  { id: REFLEX_IDS.dodge, run: dodge },
  { id: REFLEX_IDS.recastHome, run: recastHome },
  { id: REFLEX_IDS.level, run: levelUp },
  { id: REFLEX_IDS.holdRecall, run: holdRecall },
];

export type PlayTrace = (playId: string, unitId: number) => void;

export function playbookPolicy(def: PlaybookDef, trace?: PlayTrace): Policy {
  return (obs, rng) => {
    if (obs.self.dead) return { kind: 'noop' };
    const ctx = buildSlotContext(obs, rng);
    for (const reflex of REFLEXES) {
      const action = reflex.run(ctx);
      if (action) {
        trace?.(reflex.id, obs.self.id);
        return action;
      }
    }
    for (const play of def.plays) {
      if (play.enabled === false) continue;
      if (!holds(play.when, ctx)) continue;
      const action = runBehavior(play.do, ctx);
      if (action) {
        trace?.(play.id, obs.self.id);
        return action;
      }
    }
    trace?.(IDLE_ID, obs.self.id);
    return { kind: 'noop' };
  };
}
