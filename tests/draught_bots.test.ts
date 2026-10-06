// The house bots and the Sapdraught (docs/plan-potion.md, phase 2): the
// kit walker carries one once the build has nothing to buy, the playbook's
// `drink` do drinks it through the same action a person's click sends, and
// every house style drinks when hurt away from home.

import { describe, expect, it } from 'vitest';
import { HOUSE_STYLES } from '../src/sim/content/bots/house';
import { buildObservation } from '../src/sim/observe';
import { playbookPolicy, validatePlaybook } from '../src/sim/playbook';
import { runBehavior } from '../src/sim/playbook/behaviors';
import { DAMAGE_BUILD, draughtStep } from '../src/sim/playbook/kit';
import { buildSlotContext } from '../src/sim/playbook/micro';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';

function ctxOf(sim: Sim, unitId: number) {
  const obs = buildObservation(sim, unitId);
  if (!obs) throw new Error('no observation');
  return buildSlotContext(obs, new Rng(1));
}

describe('the kit and the Sapdraught', () => {
  it('carries one once nothing of the build is affordable, with a slot to spare', () => {
    expect(draughtStep(DAMAGE_BUILD, ['iron_blade'], 150)).toEqual({
      kind: 'buy',
      itemId: 'sapdraught',
    });
    // Already carried, too poor, the build still buying, or the bag tight.
    expect(draughtStep(DAMAGE_BUILD, ['iron_blade', 'sapdraught'], 150)).toBeNull();
    expect(draughtStep(DAMAGE_BUILD, ['iron_blade'], 40)).toBeNull();
    expect(draughtStep(DAMAGE_BUILD, [], 500)).toBeNull();
    expect(draughtStep(DAMAGE_BUILD, ['a', 'b', 'c', 'd', 'e'], 60)).toBeNull();
  });

  it('opens a match with one beside the first component', () => {
    const sim = new Sim(3);
    const me = sim.addChampion(0, undefined, 'vesk');
    me.gold = 500;
    sim.attachPolicy(me.id, playbookPolicy(HOUSE_STYLES[0]!.playbook!));
    for (let i = 0; i < 40; i++) sim.tick();
    expect(me.items).toContain('sapdraught');
    expect(me.items.length).toBe(2);
  });
});

describe('the drink do', () => {
  it('drinks the carried one, and passes when none is or one runs', () => {
    const sim = new Sim(4);
    const me = sim.addChampion(0, { x: 75, z: 75 });
    me.items = ['iron_blade', 'sapdraught'];
    me.hp = 100;
    sim.tick();
    expect(runBehavior({ kind: 'drink' }, ctxOf(sim, me.id))).toEqual({ kind: 'drink', slot: 1 });
    expect(sim.drinkItem(me.id, 1)).toBe(true);
    sim.tick();
    me.items = ['sapdraught'];
    expect(runBehavior({ kind: 'drink' }, ctxOf(sim, me.id))).toBeNull();
    me.items = [];
    for (let i = 0; i < 220; i++) sim.tick();
    expect(runBehavior({ kind: 'drink' }, ctxOf(sim, me.id))).toBeNull();
  });

  it('is a do the validator accepts', () => {
    const v = validatePlaybook({
      version: 2,
      plays: [{ id: 'sip', when: { kind: 'hp', below: 0.5 }, do: { kind: 'drink' } }],
    });
    expect(v.ok && v.def.plays[0]?.do).toEqual({ kind: 'drink' });
  });

  it('every house style drinks when hurt away from home', () => {
    for (const style of HOUSE_STYLES) {
      const sim = new Sim(5);
      const me = sim.addChampion(0, { x: 75, z: 75 }, 'vesk');
      me.items = ['sapdraught'];
      me.hp = me.maxHp * 0.45;
      sim.attachPolicy(me.id, playbookPolicy(style.playbook!));
      for (let i = 0; i < 10; i++) sim.tick();
      expect(me.items, style.id).toEqual([]);
      expect(buildObservation(sim, me.id)?.self.drinking, style.id).toBeGreaterThan(9);
    }
  });
});
