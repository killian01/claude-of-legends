// Playbook patches: the operations the Academy's conversation emits and
// the play list applies, one at a time, as they stream (docs/design/bots.md:
// answers are patches, not whole playbooks, and the list moves while the
// answer streams). Every operation is applied to a copy and the result
// goes through the validator, so a bad operation is refused whole and the
// playbook on screen is always one the engine can run. Shared by the
// client (local validation, no round trip) and the server (the same
// arithmetic before it forwards an operation).

import type { KitDef, LanePreference, PlaybookDef, PlayDef } from './types';
import { type PlaybookValidation, validatePlaybook } from './validate';

export type PatchOp =
  // Insert a play before the play with id `before`; append when absent.
  | { op: 'add'; play: PlayDef; before?: string | null }
  | { op: 'remove'; id: string }
  // Move a play before the play with id `before`; to the end when null.
  | { op: 'move'; id: string; before: string | null }
  // Rewrite parts of a play in place; the id never changes.
  | { op: 'set'; id: string; play: Partial<Omit<PlayDef, 'id'>> }
  // Change parts of the kit (ADR 0014): a part given replaces that part,
  // null clears it back to the engine's default, absent leaves it.
  | { op: 'kit'; kit: { [K in keyof KitDef]?: KitDef[K] | null } }
  // The lane preference (phase 12): the lanes in order, null for none.
  | { op: 'lanes'; lanes: LanePreference[] | null }
  // A whole new playbook, the "rewrite everything" answer.
  | { op: 'replace'; playbook: PlaybookDef };

export type PatchResult = { ok: true; def: PlaybookDef } | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Whether an unknown value has the SHAPE of an operation; the fields
// themselves are judged by the validator once applied.
export function isPatchOp(raw: unknown): raw is PatchOp {
  if (!isRecord(raw)) return false;
  switch (raw.op) {
    case 'add':
      return isRecord(raw.play);
    case 'remove':
      return typeof raw.id === 'string';
    case 'move':
      return typeof raw.id === 'string' && (typeof raw.before === 'string' || raw.before === null);
    case 'set':
      return typeof raw.id === 'string' && isRecord(raw.play);
    case 'kit':
      return isRecord(raw.kit);
    case 'lanes':
      return Array.isArray(raw.lanes) || raw.lanes === null;
    case 'replace':
      return isRecord(raw.playbook);
    default:
      return false;
  }
}

function indexOf(plays: readonly PlayDef[], id: string): number {
  return plays.findIndex((p) => p.id === id);
}

function finish(v: PlaybookValidation): PatchResult {
  return v.ok ? { ok: true, def: v.def } : { ok: false, error: v.errors.join('; ') };
}

// Applies one operation to a copy of `def` and validates the outcome.
// Never mutates its inputs.
export function applyPatchOp(def: PlaybookDef, op: PatchOp): PatchResult {
  const plays = def.plays.map((p) => ({ ...p }));
  const rest = {
    ...(def.kit ? { kit: def.kit } : {}),
    ...(def.lanes ? { lanes: def.lanes } : {}),
  };
  const withPlays = (next: PlayDef[]): PatchResult =>
    finish(validatePlaybook({ version: def.version, plays: next, ...rest }));
  switch (op.op) {
    case 'add': {
      const play = op.play as PlayDef;
      if (typeof play.id === 'string' && indexOf(plays, play.id) >= 0) {
        return { ok: false, error: `a play named "${play.id}" already exists` };
      }
      if (op.before !== undefined && op.before !== null) {
        const at = indexOf(plays, op.before);
        if (at < 0) return { ok: false, error: `no play named "${op.before}" to insert before` };
        plays.splice(at, 0, play);
      } else {
        plays.push(play);
      }
      return withPlays(plays);
    }
    case 'remove': {
      const at = indexOf(plays, op.id);
      if (at < 0) return { ok: false, error: `no play named "${op.id}" to remove` };
      plays.splice(at, 1);
      return withPlays(plays);
    }
    case 'move': {
      const at = indexOf(plays, op.id);
      if (at < 0) return { ok: false, error: `no play named "${op.id}" to move` };
      const [moved] = plays.splice(at, 1);
      if (op.before === null) plays.push(moved!);
      else {
        const to = indexOf(plays, op.before);
        if (to < 0) return { ok: false, error: `no play named "${op.before}" to move before` };
        plays.splice(to, 0, moved!);
      }
      return withPlays(plays);
    }
    case 'set': {
      const at = indexOf(plays, op.id);
      if (at < 0) return { ok: false, error: `no play named "${op.id}" to change` };
      const patch = op.play as Record<string, unknown>;
      const next: Record<string, unknown> = { ...plays[at]! };
      for (const key of ['when', 'do', 'enabled'] as const) {
        if (patch[key] !== undefined) next[key] = patch[key];
      }
      plays[at] = next as unknown as PlayDef;
      return withPlays(plays);
    }
    case 'kit': {
      const patch = op.kit as Record<string, unknown>;
      const next: Record<string, unknown> = { ...(def.kit ?? {}) };
      for (const key of ['build', 'skills', 'variants'] as const) {
        if (patch[key] === undefined) continue;
        if (patch[key] === null) delete next[key];
        else next[key] = patch[key];
      }
      return finish(
        validatePlaybook({
          version: Math.max(def.version, 2),
          plays,
          ...(Object.keys(next).length > 0 ? { kit: next } : {}),
          ...(def.lanes ? { lanes: def.lanes } : {}),
        }),
      );
    }
    case 'lanes':
      return finish(
        validatePlaybook({
          version: Math.max(def.version, 3),
          plays,
          ...(def.kit ? { kit: def.kit } : {}),
          ...(op.lanes && op.lanes.length > 0 ? { lanes: op.lanes } : {}),
        }),
      );
    case 'replace':
      return finish(validatePlaybook(op.playbook));
  }
}

// Applies operations in order, stopping at the first refused one; the
// refused operation and its reason are reported alongside what applied.
export function applyPatch(
  def: PlaybookDef,
  ops: readonly PatchOp[],
): { def: PlaybookDef; applied: number; refused: { op: PatchOp; error: string } | null } {
  let current = def;
  let applied = 0;
  for (const op of ops) {
    const r = applyPatchOp(current, op);
    if (!r.ok) return { def: current, applied, refused: { op, error: r.error } };
    current = r.def;
    applied += 1;
  }
  return { def: current, applied, refused: null };
}
