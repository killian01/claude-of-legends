// Playbook patches (plan-bots phase 4): the operations the coach emits and
// the play list applies, each validated whole, never mutating its input.

import { describe, expect, it } from 'vitest';
import { LANER_PLAYBOOK } from '../src/sim/content/playbooks/laner';
import {
  applyPatch,
  applyPatchOp,
  isPatchOp,
  type PatchOp,
  type PlaybookDef,
} from '../src/sim/playbook';

const ids = (def: PlaybookDef): string[] => def.plays.map((p) => p.id);

function must(r: ReturnType<typeof applyPatchOp>): PlaybookDef {
  if (!r.ok) throw new Error(r.error);
  return r.def;
}

describe('patch operations', () => {
  it('add, move, set, remove, and replace, each validated', () => {
    const before = structuredClone(LANER_PLAYBOOK);
    let def = must(
      applyPatchOp(before, {
        op: 'add',
        play: { id: 'hold-mid', when: { kind: 'lane', is: 'mid' }, do: { kind: 'hold' } },
        before: 'farm',
      }),
    );
    expect(ids(def).indexOf('hold-mid')).toBe(ids(def).indexOf('farm') - 1);
    def = must(applyPatchOp(def, { op: 'move', id: 'hold-mid', before: null }));
    expect(ids(def).at(-1)).toBe('hold-mid');
    def = must(applyPatchOp(def, { op: 'move', id: 'hold-mid', before: 'retreat' }));
    expect(ids(def)[0]).toBe('hold-mid');
    def = must(
      applyPatchOp(def, { op: 'set', id: 'retreat', play: { when: { kind: 'hp', below: 0.4 } } }),
    );
    expect(def.plays.find((p) => p.id === 'retreat')?.when).toEqual({ kind: 'hp', below: 0.4 });
    def = must(applyPatchOp(def, { op: 'set', id: 'siege', play: { enabled: false } }));
    expect(def.plays.find((p) => p.id === 'siege')?.enabled).toBe(false);
    def = must(applyPatchOp(def, { op: 'remove', id: 'hold-mid' }));
    expect(ids(def)).not.toContain('hold-mid');
    const tiny: PlaybookDef = {
      version: 1,
      plays: [{ id: 'push', when: { kind: 'always' }, do: { kind: 'push' } }],
    };
    def = must(applyPatchOp(def, { op: 'replace', playbook: tiny }));
    expect(ids(def)).toEqual(['push']);
    // Nothing above touched the input.
    expect(before).toEqual(LANER_PLAYBOOK);
  });

  it('refuses what the validator refuses, naming the reason', () => {
    const def = LANER_PLAYBOOK;
    const bad = (op: PatchOp): string => {
      const r = applyPatchOp(def, op);
      if (r.ok) throw new Error('expected a refusal');
      return r.error;
    };
    expect(bad({ op: 'remove', id: 'nope' })).toMatch(/no play named/);
    expect(bad({ op: 'move', id: 'farm', before: 'nope' })).toMatch(/no play named/);
    expect(
      bad({ op: 'add', play: { id: 'farm', when: { kind: 'always' }, do: { kind: 'farm' } } }),
    ).toMatch(/already exists/);
    expect(
      bad({ op: 'add', play: { id: 'x', when: { kind: 'hp', below: 3 }, do: { kind: 'farm' } } }),
    ).toMatch(/between 0 and 1/);
    expect(bad({ op: 'set', id: 'farm', play: { do: { kind: 'nope' } as never } })).toMatch(
      /unknown behavior/,
    );
    expect(bad({ op: 'replace', playbook: { version: 1, plays: [] } })).toMatch(/at least one/);
  });

  it('applies a sequence up to the first refusal', () => {
    const r = applyPatch(LANER_PLAYBOOK, [
      { op: 'remove', id: 'camp' },
      { op: 'remove', id: 'nope' },
      { op: 'remove', id: 'siege' },
    ]);
    expect(r.applied).toBe(1);
    expect(r.refused?.error).toMatch(/nope/);
    expect(ids(r.def)).not.toContain('camp');
    expect(ids(r.def)).toContain('siege');
  });

  it('recognizes the shape of an operation', () => {
    expect(isPatchOp({ op: 'remove', id: 'a' })).toBe(true);
    expect(isPatchOp({ op: 'move', id: 'a', before: null })).toBe(true);
    expect(isPatchOp({ op: 'move', id: 'a' })).toBe(false);
    expect(isPatchOp({ op: 'add' })).toBe(false);
    expect(isPatchOp({ op: 'set', id: 'a', play: {} })).toBe(true);
    expect(isPatchOp({ op: 'replace', playbook: 3 })).toBe(false);
    expect(isPatchOp('remove')).toBe(false);
  });
});
