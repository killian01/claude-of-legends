// Coach orders (ADR 0013, plan-bots phase 5): sim state set by a command,
// read by the playbook through an additive observation field, cleared
// when done, recorded and replayed like any order.

import { describe, expect, it } from 'vitest';
import { applySimCommand } from '../src/net/replay';
import { GOTO_DONE_RADIUS, parseCoachOrder } from '../src/sim/coach';
import { COACH_PLAY_ID, NEW_BOT_PLAYBOOK } from '../src/sim/content/playbooks/new_bot';
import { buildObservation } from '../src/sim/observe';
import { type PlaybookDef, playbookPolicy, validatePlaybook } from '../src/sim/playbook';
import { Sim } from '../src/sim/sim';

const OBEY: PlaybookDef = {
  version: 1,
  plays: [
    { id: 'coach', when: { kind: 'order' }, do: { kind: 'obeyOrder' } },
    { id: 'stay', when: { kind: 'always' }, do: { kind: 'hold' } },
  ],
};

function seat(seed = 5): { sim: Sim; me: ReturnType<Sim['addChampion']> } {
  const sim = new Sim(seed);
  const me = sim.addChampion(0, { x: 60, z: 60 });
  sim.attachPlaybook(me.id, OBEY);
  return { sim, me };
}

describe('coach orders', () => {
  it('parse off an untrusted message, hold where the unit stands by default', () => {
    const at = { x: 1, z: 2 };
    expect(parseCoachOrder({ kind: 'free' }, at)).toBeNull();
    expect(parseCoachOrder({ kind: 'goto', x: 10, z: 20 }, at)).toEqual({
      kind: 'goto',
      x: 10,
      z: 20,
    });
    expect(parseCoachOrder({ kind: 'goto', x: 'a' }, at)).toBeUndefined();
    expect(parseCoachOrder({ kind: 'focus', targetId: 3 }, at)).toEqual({
      kind: 'focus',
      targetId: 3,
    });
    expect(parseCoachOrder({ kind: 'focus', targetId: 1.5 }, at)).toBeUndefined();
    expect(parseCoachOrder({ kind: 'hold' }, at)).toEqual({ kind: 'hold', x: 1, z: 2 });
    expect(parseCoachOrder({ kind: 'warden' }, at)).toEqual({ kind: 'warden' });
    expect(parseCoachOrder({ kind: 'creature' }, at)).toEqual({ kind: 'creature' });
    expect(parseCoachOrder({ kind: 'nope' }, at)).toBeUndefined();
  });

  it('a goto walks the bot there and clears itself on arrival', () => {
    const { sim, me } = seat();
    sim.setCoachOrder(me.id, { kind: 'goto', x: 80, z: 60 });
    expect(me.coachOrder).toEqual({ kind: 'goto', x: 80, z: 60 });
    for (let i = 0; i < 400 && me.coachOrder; i++) sim.tick();
    expect(me.coachOrder).toBeNull();
    expect(Math.hypot(me.pos.x - 80, me.pos.z - 60)).toBeLessThanOrEqual(GOTO_DONE_RADIUS + 0.5);
  });

  it('a hold keeps the bot in place and a free releases it', () => {
    const { sim, me } = seat();
    sim.setCoachOrder(me.id, { kind: 'hold', x: me.pos.x, z: me.pos.z });
    const start = { ...me.pos };
    for (let i = 0; i < 100; i++) sim.tick();
    expect(Math.hypot(me.pos.x - start.x, me.pos.z - start.z)).toBeLessThan(1);
    sim.setCoachOrder(me.id, null);
    expect(me.coachOrder).toBeNull();
  });

  it('a focus attacks a visible target and clears when the target is gone', () => {
    const { sim, me } = seat();
    const foe = sim.addChampion(1, { x: 66, z: 60 });
    sim.tick();
    sim.setCoachOrder(me.id, { kind: 'focus', targetId: foe.id });
    for (let i = 0; i < 20; i++) sim.tick();
    expect(me.attackTargetId).toBe(foe.id);
    // Left to it, the bot finishes the target; the order goes with it.
    for (let i = 0; i < 600 && !foe.dead; i++) sim.tick();
    expect(foe.dead).toBe(true);
    // The order clears on the next tick, before the bot decides again.
    sim.tick();
    expect(me.coachOrder).toBeNull();
  });

  it('rides the observation only for the ordered seat, additively', () => {
    const { sim, me } = seat();
    const other = sim.addChampion(0, { x: 70, z: 70 });
    sim.tick();
    expect(buildObservation(sim, me.id)!.self).not.toHaveProperty('coachOrder');
    sim.setCoachOrder(me.id, { kind: 'back' });
    sim.tick();
    expect(buildObservation(sim, me.id)!.self.coachOrder).toEqual({ kind: 'back' });
    expect(buildObservation(sim, other.id)!.self).not.toHaveProperty('coachOrder');
  });

  it('is a command: applied through the same path a replay uses, fogged for focus', () => {
    const { sim, me } = seat();
    const hidden = sim.addChampion(1, { x: 160, z: 160 });
    sim.tick();
    applySimCommand(sim, 0, me.id, { t: 'order', kind: 'focus', targetId: hidden.id });
    expect(me.coachOrder).toBeNull();
    applySimCommand(sim, 0, me.id, { t: 'order', kind: 'goto', x: 70, z: 60 });
    expect(me.coachOrder).toEqual({ kind: 'goto', x: 70, z: 60 });
    applySimCommand(sim, 0, me.id, { t: 'order', kind: 'free' });
    expect(me.coachOrder).toBeNull();
  });

  it('the order trigger can name the kind, and the new bot playbook obeys under survival', () => {
    const v = validatePlaybook({
      version: 1,
      plays: [{ id: 'w', when: { kind: 'order', is: 'warden' }, do: { kind: 'obeyOrder' } }],
    });
    expect(v.ok).toBe(true);
    expect(
      validatePlaybook({
        version: 1,
        plays: [{ id: 'w', when: { kind: 'order', is: 'x' }, do: { kind: 'hold' } }],
      }).ok,
    ).toBe(false);
    expect(validatePlaybook(NEW_BOT_PLAYBOOK).ok).toBe(true);
    expect(NEW_BOT_PLAYBOOK.plays[0]!.id).toBe('retreat');
    expect(NEW_BOT_PLAYBOOK.plays[1]!.id).toBe(COACH_PLAY_ID);
    // A house bot never listens: the Laner has no such play.
    const sim = new Sim(3);
    const me = sim.addChampion(0, { x: 60, z: 60 });
    const seen = new Set<string>();
    sim.attachPolicy(
      me.id,
      playbookPolicy(NEW_BOT_PLAYBOOK, (id) => seen.add(id)),
    );
    sim.setCoachOrder(me.id, { kind: 'hold', x: 60, z: 60 });
    for (let i = 0; i < 40; i++) sim.tick();
    expect(seen.has(COACH_PLAY_ID)).toBe(true);
  });
});
