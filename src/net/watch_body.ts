// The killer a fallen Respawn seat watches through its wait (CONTEXT.md:
// Death beat), as the mirror draws it: a dead champion sees nothing, so the
// killer's own record leaves the snapshot on the fall, and the mode block's
// wa (server/royale_snapshot_blocks.ts watchBlock) is all the wire carries
// of it. This turns it into the unit record the mirror materializes, so the
// renderer draws the body and the beat's camera follows it (game/
// death_beat.ts) as it would a body in sight. Pure.

import type { SnapUnit } from './protocol';
import type { SnapWatch } from './royale_wire';

// The unit record of the watched killer: a champion, its identity block
// (champion, skin, team) and where it stands with its health.
export function watchRecord(w: SnapWatch): SnapUnit {
  return {
    i: w.i,
    k: 'champion',
    c: w.c,
    sk: w.sk,
    t: w.t,
    x: w.at[0],
    y: w.at[1],
    z: w.at[2],
    h: w.h,
    m: w.m,
  };
}
