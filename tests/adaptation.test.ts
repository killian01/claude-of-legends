// Adaptation (plan-bots phase 12, docs/design/bots.md "Adapting to the
// opponent"): the match's seats, the items on visible champions and the
// lane opponents in the observation; the lineup triggers over them; the
// lane preference seated ahead of the home lane; and the exit: a variant
// "against mostly magic damage, build Spirit Ward second" in force against
// a mage-heavy enemy lineup.

import { describe, expect, it } from 'vitest';
import { sparringPicks } from '../src/game/sparring_core';
import { buildMatchSim } from '../src/net/replay';
import { CHAMPIONS } from '../src/sim/content/champions';
import { LANER_PLAYBOOK } from '../src/sim/content/playbooks/laner';
import { buildObservation } from '../src/sim/observe';
import { buildSlotContext, type SlotContext } from '../src/sim/playbook/micro';
import { applyPatchOp } from '../src/sim/playbook/patch';
import { holds } from '../src/sim/playbook/triggers';
import type { KitDef, Trigger } from '../src/sim/playbook/types';
import { validatePlaybook } from '../src/sim/playbook/validate';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { describeOp, describeTrigger, freshTrigger, TRIGGER_KINDS } from '../src/ui/playbook_text';

function ctxOf(sim: Sim, unitId: number, kit?: KitDef): SlotContext {
  const obs = buildObservation(sim, unitId);
  if (!obs) throw new Error('no observation');
  return buildSlotContext(obs, new Rng(1), kit);
}

// A duel scene in the open where both sides see each other.
function lineup(seed: number, own: string[], enemy: string[]): { sim: Sim; me: number } {
  const sim = new Sim(seed);
  let me = -1;
  for (const [i, id] of own.entries()) {
    const u = sim.addChampion(0, { x: 40 + i * 2, z: 60 }, id);
    if (i === 0) me = u.id;
  }
  for (const [i, id] of enemy.entries()) sim.addChampion(1, { x: 60 + i * 2, z: 60 }, id);
  sim.tick();
  return { sim, me };
}

const MAGES = ['sylra', 'elowen', 'maera', 'torv', 'korrath'];
const BRUISERS = ['vesk', 'ashvyn', 'korrath', 'dain', 'fenn'];

describe('the lineup in the observation', () => {
  it('lists both teams with roles, the own lanes, and who is dead', () => {
    const picks = sparringPicks(
      {
        name: 'x',
        championId: 'vesk',
        sigils: ['riftstep', 'mend'],
        skin: 0,
        playbook: LANER_PLAYBOOK,
      },
      3,
    );
    const { sim, unitIds } = buildMatchSim(3, picks);
    sim.tick();
    const obs = buildObservation(sim, unitIds[0]!)!;
    expect(obs.seats).toHaveLength(10);
    const own = obs.seats!.filter((s) => s.team === 0);
    const enemy = obs.seats!.filter((s) => s.team === 1);
    expect(own).toHaveLength(5);
    expect(enemy).toHaveLength(5);
    expect(own.some((s) => s.id === unitIds[0])).toBe(true);
    for (const s of own) expect(['top', 'mid', 'bot']).toContain(s.lane);
    for (const s of enemy) expect(s.lane).toBeUndefined();
    for (const s of obs.seats!) {
      expect(s.role).toBe(CHAMPIONS[s.championId]!.role);
      expect(s.dead).toBe(false);
    }
  });

  it('shows the items a visible champion wears', () => {
    const { sim, me } = lineup(4, ['vesk'], ['korrath']);
    const foe = [...sim.units.values()].find((u) => u.championId === 'korrath')!;
    foe.items.push('warbrand');
    sim.tick();
    const obs = buildObservation(sim, me)!;
    expect(obs.units.find((u) => u.id === foe.id)?.items).toEqual(['warbrand']);
    const ctx = buildSlotContext(obs, new Rng(1));
    expect(holds({ kind: 'enemyItem', item: 'warbrand' }, ctx)).toBe(true);
    expect(holds({ kind: 'enemyItem', item: 'skyshear' }, ctx)).toBe(false);
  });

  it('names the lane opponent from what the team saw in the lane', () => {
    // Sylra (mid) watches Dain stand on the mid diagonal for three seconds.
    const sim = new Sim(5);
    const me = sim.addChampion(0, { x: 60, z: 60 }, 'sylra');
    const foe = sim.addChampion(1, { x: 63, z: 60 }, 'dain');
    for (let i = 0; i < 60; i++) sim.tick();
    const obs = buildObservation(sim, me.id)!;
    expect(obs.laneOpponents?.mid).toBe(foe.id);
    expect(obs.laneOpponents?.top).toBeNull();
    expect(obs.laneOpponents?.bot).toBeNull();
    const ctx = buildSlotContext(obs, new Rng(1));
    expect(me.lane).toBe('mid');
    expect(holds({ kind: 'laneOpponent', is: 'dain' }, ctx)).toBe(true);
    expect(holds({ kind: 'laneOpponent', is: 'vesk' }, ctx)).toBe(false);
  });
});

describe('the lineup triggers', () => {
  it('read a champion, a role count and the damage on either side', () => {
    const { sim, me } = lineup(7, ['vesk', 'korrath'], MAGES);
    const ctx = ctxOf(sim, me);
    expect(holds({ kind: 'champion', side: 'enemy', is: 'sylra' }, ctx)).toBe(true);
    expect(holds({ kind: 'champion', side: 'own', is: 'korrath' }, ctx)).toBe(true);
    expect(holds({ kind: 'champion', side: 'own', is: 'sylra' }, ctx)).toBe(false);
    expect(holds({ kind: 'roles', side: 'enemy', role: 'Mage', atLeast: 1 }, ctx)).toBe(true);
    expect(holds({ kind: 'roles', side: 'enemy', role: 'Marksman', atLeast: 1 }, ctx)).toBe(false);
    expect(holds({ kind: 'roles', side: 'own', role: 'Tank', atMost: 0 }, ctx)).toBe(false);
    expect(holds({ kind: 'roles', side: 'own', role: 'Marksman', atLeast: 1 }, ctx)).toBe(true);
    // Two magic roles against one physical, the supports on neither side.
    expect(holds({ kind: 'enemyDamage', mostly: 'magic' }, ctx)).toBe(true);
    expect(holds({ kind: 'enemyDamage', mostly: 'physical' }, ctx)).toBe(false);
    const physical = lineup(8, ['vesk'], BRUISERS);
    expect(
      holds({ kind: 'enemyDamage', mostly: 'physical' }, ctxOf(physical.sim, physical.me)),
    ).toBe(true);
  });

  it('read the lane partner from the assigned lanes', () => {
    const sim = new Sim(6);
    const me = sim.addChampion(0, undefined, 'vesk');
    sim.addChampion(0, undefined, 'maera');
    sim.addChampion(0, undefined, 'korrath');
    sim.tick();
    const ctx = ctxOf(sim, me.id);
    expect(holds({ kind: 'lanePartner', is: 'maera' }, ctx)).toBe(true);
    expect(holds({ kind: 'lanePartner', is: 'korrath' }, ctx)).toBe(false);
  });

  it('have words, forms and fresh instances the validator accepts', () => {
    const kinds: Trigger['kind'][] = [
      'champion',
      'roles',
      'enemyDamage',
      'enemyItem',
      'laneOpponent',
      'lanePartner',
    ];
    for (const kind of kinds) {
      expect(TRIGGER_KINDS).toContain(kind);
      const t = freshTrigger(kind);
      expect(describeTrigger(t).length).toBeGreaterThan(5);
      const v = validatePlaybook({
        version: 3,
        plays: [{ id: 'a', when: t, do: { kind: 'hold' } }],
      });
      expect(v.ok, kind).toBe(true);
    }
    expect(describeTrigger({ kind: 'roles', side: 'enemy', role: 'Mage', atLeast: 2 })).toBe(
      'the enemy fields at least 2 mage',
    );
    expect(describeTrigger({ kind: 'laneOpponent', is: 'vesk' })).toMatch(/Vesk/);
  });

  it('are refused with a bad side, role, item or champion', () => {
    const bad = (when: unknown): string => {
      const v = validatePlaybook({ version: 3, plays: [{ id: 'a', when, do: { kind: 'hold' } }] });
      return v.ok ? '' : v.errors.join(' ');
    };
    expect(bad({ kind: 'champion', side: 'them', is: 'vesk' })).toMatch(/side/);
    expect(bad({ kind: 'champion', side: 'enemy', is: 'nobody' })).toMatch(/champion/);
    expect(bad({ kind: 'roles', side: 'enemy', role: 'Healer', atLeast: 1 })).toMatch(/role/);
    expect(bad({ kind: 'roles', side: 'enemy', role: 'Mage' })).toMatch(/atLeast/);
    expect(bad({ kind: 'enemyItem', item: 'excalibur' })).toMatch(/item/);
    expect(bad({ kind: 'enemyDamage', mostly: 'true' })).toMatch(/magic/);
  });
});

describe('the lane preference', () => {
  it('seats the bot ahead of its home lane, the next asker on its next choice', () => {
    const sim = new Sim(8);
    const me = sim.addChampion(0, undefined, 'vesk');
    expect(me.lane).toBe('bot');
    sim.attachPlaybook(me.id, { ...LANER_PLAYBOOK, version: 3, lanes: ['mid'] });
    expect(me.lane).toBe('mid');
    const mage = sim.addChampion(0, undefined, 'sylra');
    expect(me.lane).toBe('mid');
    expect(mage.lane).not.toBe('mid');
    const other = sim.addChampion(0, undefined, 'ashvyn');
    sim.attachPlaybook(other.id, { ...LANER_PLAYBOOK, version: 3, lanes: ['mid', 'bot'] });
    expect(other.lane).toBe('bot');
  });

  it('is validated, patched, kept through other ops, and told', () => {
    const v = validatePlaybook({ ...LANER_PLAYBOOK, version: 3, lanes: ['top', 'mid'] });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.def.lanes).toEqual(['top', 'mid']);
    const twice = validatePlaybook({ ...LANER_PLAYBOOK, version: 3, lanes: ['mid', 'mid'] });
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.errors.join(' ')).toMatch(/lanes/);
    const set = applyPatchOp(LANER_PLAYBOOK, { op: 'lanes', lanes: ['top'] });
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.def.lanes).toEqual(['top']);
    expect(set.def.version).toBe(3);
    const kept = applyPatchOp(set.def, { op: 'kit', kit: { skills: ['W', 'Q', 'E'] } });
    expect(kept.ok && kept.def.lanes).toEqual(['top']);
    const cleared = applyPatchOp(set.def, { op: 'lanes', lanes: null });
    expect(cleared.ok && cleared.def.lanes).toBeUndefined();
    expect(describeOp({ op: 'lanes', lanes: ['top', 'mid'] })).toBe(
      'lane preference: top, then mid',
    );
    expect(describeOp({ op: 'lanes', lanes: null })).toMatch(/home lane/);
  });
});

describe('the exit: build against magic', () => {
  const kit: KitDef = {
    build: ['warbrand', 'sunder_axe'],
    variants: [
      {
        when: { kind: 'enemyDamage', mostly: 'magic' },
        build: ['warbrand', 'spirit_ward', 'sunder_axe'],
      },
    ],
  };

  it('puts Spirit Ward second against a mage-heavy lineup, not against bruisers', () => {
    const magic = lineup(9, ['vesk'], MAGES);
    expect(ctxOf(magic.sim, magic.me, kit).kit().build[1]).toBe('spirit_ward');
    const physical = lineup(10, ['vesk'], BRUISERS);
    expect(ctxOf(physical.sim, physical.me, kit).kit().build[1]).toBe('sunder_axe');
  });
});
