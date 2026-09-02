// Playbook gate (ADR 0013, ADR 0014): the default bot is the playbook
// Laner; the validator is the only door untrusted data goes through; the
// interpreter reports the play that acted. The tick-for-tick pin to the
// scripted Laner retired with ADR 0014 (scripts/laner_gate.mjs measures the
// default Laner against its previous version instead).

import { describe, expect, it } from 'vitest';
import { BOTS, DEFAULT_BOT_ID } from '../src/sim/content/bots';
import { LANER } from '../src/sim/content/bots/laner';
import { LANER_PLAYBOOK } from '../src/sim/content/playbooks/laner';
import { buildObservation } from '../src/sim/observe';
import {
  IDLE_ID,
  PLAYBOOK_FORMAT_VERSION,
  type PlaybookDef,
  playbookPolicy,
  REFLEX_IDS,
  validatePlaybook,
} from '../src/sim/playbook';
import { buildSlotContext } from '../src/sim/playbook/micro';
import { holds } from '../src/sim/playbook/triggers';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';

describe('the default bot', () => {
  it('is the playbook Laner, and validates', () => {
    expect(BOTS[DEFAULT_BOT_ID]).toBe(LANER);
    expect(validatePlaybook(LANER_PLAYBOOK).ok).toBe(true);
  });
});

describe('the interpreter', () => {
  it('reports the play that acted, and only known ids', () => {
    const seen = new Set<string>();
    const sim = new Sim(9);
    const me = sim.addChampion(0);
    sim.attachPolicy(
      me.id,
      playbookPolicy(LANER_PLAYBOOK, (id) => seen.add(id)),
    );
    for (let i = 0; i < 1200; i++) sim.tick();
    expect(seen.has('push')).toBe(true);
    const known = new Set<string>([
      ...LANER_PLAYBOOK.plays.map((p) => p.id),
      ...Object.values(REFLEX_IDS),
      IDLE_ID,
    ]);
    for (const id of seen) expect(known.has(id), id).toBe(true);
  });

  it('skips disabled plays and falls through to the next one', () => {
    const def: PlaybookDef = {
      version: 1,
      plays: [
        { id: 'stay', when: { kind: 'always' }, do: { kind: 'hold' }, enabled: false },
        { id: 'go', when: { kind: 'always' }, do: { kind: 'holdPosition', x: 120, z: 120 } },
      ],
    };
    const sim = new Sim(5);
    const me = sim.addChampion(0);
    const start = { ...me.pos };
    const seen: string[] = [];
    sim.attachPolicy(
      me.id,
      playbookPolicy(def, (id) => seen.push(id)),
    );
    for (let i = 0; i < 200; i++) sim.tick();
    expect(seen).not.toContain('stay');
    expect(seen).toContain('go');
    expect(Math.hypot(me.pos.x - start.x, me.pos.z - start.z)).toBeGreaterThan(5);
  });

  it('reports idle when no play can act', () => {
    const def: PlaybookDef = {
      version: 1,
      plays: [{ id: 'farm', when: { kind: 'always' }, do: { kind: 'farm' } }],
    };
    const sim = new Sim(5);
    const me = sim.addChampion(0);
    const seen = new Set<string>();
    sim.attachPolicy(
      me.id,
      playbookPolicy(def, (id) => seen.add(id)),
    );
    for (let i = 0; i < 40; i++) sim.tick();
    expect(seen.has(IDLE_ID)).toBe(true);
  });

  it('follows an ally and holds within reach', () => {
    const def: PlaybookDef = {
      version: 1,
      plays: [{ id: 'stick', when: { kind: 'always' }, do: { kind: 'followAlly', keep: 3 } }],
    };
    const sim = new Sim(5);
    const ally = sim.addChampion(0, { x: 60, z: 60 });
    const me = sim.addChampion(0, { x: 40, z: 40 });
    sim.attachPolicy(me.id, playbookPolicy(def));
    for (let i = 0; i < 400; i++) sim.tick();
    expect(Math.hypot(me.pos.x - ally.pos.x, me.pos.z - ally.pos.z)).toBeLessThan(5);
  });
});

describe('triggers', () => {
  it('read the observation the way the glossary says', () => {
    const sim = new Sim(3);
    const me = sim.addChampion(0);
    sim.tick();
    const obs = buildObservation(sim, me.id)!;
    const ctx = buildSlotContext(obs, new Rng(1));
    expect(holds({ kind: 'always' }, ctx)).toBe(true);
    expect(holds({ kind: 'atFountain' }, ctx)).toBe(true);
    expect(holds({ kind: 'hp', atLeast: 1 }, ctx)).toBe(true);
    expect(holds({ kind: 'hp', below: 0.5 }, ctx)).toBe(false);
    expect(holds({ kind: 'level', atLeast: 1, below: 2 }, ctx)).toBe(true);
    expect(holds({ kind: 'enemyVisible' }, ctx)).toBe(false);
    expect(holds({ kind: 'enemies', within: 50, atMost: 0 }, ctx)).toBe(true);
    expect(holds({ kind: 'underTower' }, ctx)).toBe(false);
    expect(holds({ kind: 'warden', state: 'down' }, ctx)).toBe(true);
    expect(holds({ kind: 'lane', is: 'mid' }, ctx)).toBe(false);
    expect(holds({ kind: 'not', of: { kind: 'atFountain' } }, ctx)).toBe(false);
    expect(
      holds({ kind: 'all', of: [{ kind: 'atFountain' }, { kind: 'time', below: 10 }] }, ctx),
    ).toBe(true);
    expect(
      holds({ kind: 'any', of: [{ kind: 'enemyVisible' }, { kind: 'gold', atLeast: 0 }] }, ctx),
    ).toBe(true);
  });
});

describe('the validator', () => {
  const ok = (raw: unknown) => {
    const v = validatePlaybook(raw);
    if (!v.ok) throw new Error(v.errors.join('; '));
    return v.def;
  };
  const errorsOf = (raw: unknown): string[] => {
    const v = validatePlaybook(raw);
    return v.ok ? [] : v.errors;
  };

  it('accepts the default playbook and returns only known fields', () => {
    const def = ok({
      ...LANER_PLAYBOOK,
      stray: 1,
      plays: [{ ...LANER_PLAYBOOK.plays[0]!, note: 'x', do: { kind: 'retreat', bogus: 2 } }],
    });
    expect(def).toEqual({ version: LANER_PLAYBOOK.version, plays: [LANER_PLAYBOOK.plays[0]] });
  });

  it('accepts every version up to the current one and refuses newer ones', () => {
    const plays = [{ id: 'a', when: { kind: 'always' }, do: { kind: 'push' } }];
    expect(ok({ version: 1, plays }).version).toBe(1);
    expect(ok({ version: PLAYBOOK_FORMAT_VERSION, plays }).version).toBe(PLAYBOOK_FORMAT_VERSION);
    expect(errorsOf({ version: PLAYBOOK_FORMAT_VERSION + 1, plays })[0]).toMatch(/newer/);
    expect(errorsOf({ version: 0, plays })[0]).toMatch(/version/);
  });

  it('refuses unknown kinds, bad ids, duplicates and out-of-range numbers', () => {
    const base = { version: 1 };
    expect(errorsOf({ ...base, plays: [] })[0]).toMatch(/at least one/);
    expect(
      errorsOf({
        ...base,
        plays: [{ id: 'a', when: { kind: 'always' }, do: { kind: 'nope' } }],
      })[0],
    ).toMatch(/unknown behavior/);
    expect(
      errorsOf({ ...base, plays: [{ id: 'a', when: { kind: 'wat' }, do: { kind: 'push' } }] })[0],
    ).toMatch(/unknown trigger/);
    expect(
      errorsOf({
        ...base,
        plays: [{ id: 'Bad Id', when: { kind: 'always' }, do: { kind: 'push' } }],
      })[0],
    ).toMatch(/id must/);
    expect(
      errorsOf({
        ...base,
        plays: [
          { id: 'a', when: { kind: 'always' }, do: { kind: 'push' } },
          { id: 'a', when: { kind: 'always' }, do: { kind: 'push' } },
        ],
      })[0],
    ).toMatch(/duplicate/);
    expect(
      errorsOf({
        ...base,
        plays: [{ id: 'a', when: { kind: 'hp', below: 2 }, do: { kind: 'push' } }],
      })[0],
    ).toMatch(/between 0 and 1/);
    expect(
      errorsOf({ ...base, plays: [{ id: 'a', when: { kind: 'hp' }, do: { kind: 'push' } }] })[0],
    ).toMatch(/below or atLeast/);
    expect(
      errorsOf({
        ...base,
        plays: [{ id: 'a', when: { kind: 'always' }, do: { kind: 'holdPosition', x: -5, z: 10 } }],
      })[0],
    ).toMatch(/x must/);
    expect(
      errorsOf({
        ...base,
        plays: [{ id: 'a', when: { kind: 'always' }, do: { kind: 'siege', escortMin: 2.5 } }],
      })[0],
    ).toMatch(/whole number/);
  });

  it('bounds trigger nesting', () => {
    let when: unknown = { kind: 'always' };
    for (let i = 0; i < 6; i++) when = { kind: 'not', of: when };
    expect(errorsOf({ version: 1, plays: [{ id: 'a', when, do: { kind: 'push' } }] })[0]).toMatch(
      /nest/,
    );
  });

  it('keeps push lane and regroup overrides', () => {
    const def = ok({
      version: 1,
      plays: [
        { id: 'a', when: { kind: 'always' }, do: { kind: 'push', lane: 'top', regroupAt: null } },
      ],
    });
    expect(def.plays[0]!.do).toEqual({ kind: 'push', lane: 'top', regroupAt: null });
  });
});
