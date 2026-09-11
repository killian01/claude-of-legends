// The objective line (docs/plan-rings.md): what the HUD's meta line says
// about the three creatures, and what a favor chip says about a favor
// held. Pure over the world's clocks, so the wording is tested without a
// DOM and reads the same offline, online and in a replay.

import type { WardenPit } from '../sim/content/map';
import {
  ASPECTS,
  type AspectId,
  CREATURES,
  type CreatureId,
  creatureOfRing,
  WRATH_BURN_PCT,
  WRATH_EXECUTE_FRAC,
} from '../sim/content/rings';
import { type FavorStacks, favorBonus } from '../sim/favors';
import type { RingClock } from '../sim/rings';

export function clockText(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// What a ring's clock names: the creature, or its Ascendant once the
// aspects are spent.
export function creatureName(creature: CreatureId, ascendant: boolean): string {
  const def = CREATURES[creature];
  return ascendant ? def.ascendant.name : def.name;
}

// `Pyrefang 1:12 Might · Voidmaul LIVE · Warden 6:00 at the plaza`: the
// bot ring first because it rises first, the Warden last because it does.
// A live creature says LIVE and the aspect it carries; a clock says when
// and what comes; an Ascendant says its name and nothing after; the
// Warden says its pit, since the pit is drawn per rise (ADR 0023).
export function objectiveLine(
  rings: readonly RingClock[],
  wardenAt: number | null,
  time: number,
  pit?: Readonly<WardenPit>,
): string {
  const parts: string[] = [];
  for (const ring of ['bot', 'top'] as const) {
    const clock = rings.find((c) => c.ring === ring);
    if (!clock) continue;
    const name = creatureName(creatureOfRing(ring).id, clock.ascendant);
    const aspect = clock.aspect ? ` ${ASPECTS[clock.aspect].name}` : '';
    parts.push(
      clock.riseAt === null
        ? `${name} LIVE${aspect}`
        : `${name} ${clockText(clock.riseAt - time)}${aspect}`,
    );
  }
  const where = pit ? ` at the ${pit.name}` : '';
  parts.push(
    wardenAt === null ? `Warden LIVE${where}` : `Warden ${clockText(wardenAt - time)}${where}`,
  );
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

// What the Wrath's chip says while a team holds it: what it does and how
// long it lasts.
export function wrathChipText(until: number, time: number): string {
  const line = Math.round(WRATH_EXECUTE_FRAC * 100);
  const burn = Math.round(WRATH_BURN_PCT * 100);
  return `WRATH execute under ${line}%, hits burn ${burn}% ${clockText(until - time)}`;
}
