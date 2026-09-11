// The objective line (docs/plan-rings.md): what the HUD's meta line says
// about the three creatures, and what a favor chip says about a favor
// held. Pure over the world's clocks, so the wording is tested without a
// DOM and reads the same offline, online and in a replay.

import { ASPECTS, type AspectId, CREATURES, creatureOfRing } from '../sim/content/rings';
import { type FavorStacks, favorBonus } from '../sim/favors';
import type { RingClock } from '../sim/rings';

export function clockText(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// `Pyrefang 1:12 Might · Voidmaul LIVE · Warden 6:00`: the bot ring
// first because it rises first, the Warden last because it does. A live
// creature says LIVE and the aspect it carries; a clock says when and
// what comes.
export function objectiveLine(
  rings: readonly RingClock[],
  wardenAt: number | null,
  time: number,
): string {
  const parts: string[] = [];
  for (const ring of ['bot', 'top'] as const) {
    const clock = rings.find((c) => c.ring === ring);
    if (!clock) continue;
    const name = creatureOfRing(ring).name;
    const aspect = ASPECTS[clock.aspect].name;
    parts.push(
      clock.riseAt === null
        ? `${name} LIVE ${aspect}`
        : `${name} ${clockText(clock.riseAt - time)} ${aspect}`,
    );
  }
  parts.push(wardenAt === null ? 'Warden LIVE' : `Warden ${clockText(wardenAt - time)}`);
  return parts.join(' · ');
}

export interface FavorChip {
  aspect: AspectId;
  stacks: number;
  // `MIGHT +3% AD and AP`, the number for the stacks held.
  text: string;
}

// One chip per aspect held, in the rings' order, saying what it does.
export function favorChips(stacks: FavorStacks): FavorChip[] {
  const out: FavorChip[] = [];
  for (const def of [CREATURES.pyrefang, CREATURES.voidmaul]) {
    for (const aspect of def.aspects) {
      const held = stacks[aspect];
      if (held <= 0) continue;
      const pct = `+${Math.round(favorBonus(stacks, aspect) * 100)}%`;
      out.push({
        aspect,
        stacks: held,
        text: `${ASPECTS[aspect].name.toUpperCase()} ${ASPECTS[aspect].says.replaceAll('{pct}', pct)}`,
      });
    }
  }
  return out;
}

// What the announcement says when a favor is claimed.
export function favorClaimText(creature: 'pyrefang' | 'voidmaul', aspect: AspectId): string {
  return `${CREATURES[creature].name}'s favor: ${ASPECTS[aspect].name}`;
}
