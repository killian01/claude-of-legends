// A person's orders in a battle royale (server/royale_commands.ts): what a
// well-formed order hands the sim, with the point's y on the sphere, and what
// a malformed or foreign one never reaches it with. The mode has no shop, no
// recall, no ranks to spend and no coach, so those verbs are refused.

import { describe, expect, it } from 'vitest';
import { applyRoyaleCommand, ROYALE_VERBS } from '../server/royale_commands';
import type { RoyaleSim } from '../server/royale_sim';
import type { ClientMsg } from '../src/net/protocol';

const SEEN = 7;
const FOGGED = 8;

// A sim that writes down what it was told; team 0 sees unit SEEN only.
function recorder() {
  const calls: unknown[][] = [];
  const log =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const sim = {
    orderMove: log('move'),
    orderAttackMove: log('attack_move'),
    orderAttack: log('attack'),
    orderStop: log('stop'),
    castAbility: log('cast'),
    castSigil: log('sigil'),
    pickGraft: log('graft'),
    isVisible: (team: number, id: number) => team === 0 && id === SEEN,
  } as unknown as RoyaleSim;
  const send = (msg: unknown) => applyRoyaleCommand(sim, 0, 1, msg as ClientMsg);
  return { calls, send };
}

describe('a battle royale order', () => {
  it('hands a well-formed order to the sim, keeping y on the sphere', () => {
    const { calls, send } = recorder();
    send({ t: 'move', x: 1, z: 2, y: 3 });
    send({ t: 'attack_move', x: 4, z: 5 });
    send({ t: 'attack', targetId: SEEN });
    send({ t: 'stop' });
    send({ t: 'cast', key: 'R', x: 6, z: 7, y: 8 });
    send({ t: 'sigil', slot: 1, x: 9, z: 10 });
    send({ t: 'graft', pick: 2 });
    expect(calls).toEqual([
      ['move', 1, 1, 2, 3],
      ['attack_move', 1, 4, 5, undefined],
      ['attack', 1, SEEN],
      ['stop', 1],
      ['cast', 1, 'R', { x: 6, y: 8, z: 7 }],
      ['sigil', 1, 1, { x: 9, z: 10 }],
      ['graft', 1, 2],
    ]);
  });

  it('never reaches the sim with a point that is not finite numbers', () => {
    const { calls, send } = recorder();
    send({ t: 'move', x: Number.NaN, z: 2 });
    send({ t: 'move', x: 1, z: 2, y: Number.POSITIVE_INFINITY });
    send({ t: 'attack_move', x: '1', z: 2 });
    send({ t: 'cast', key: 'Q', x: 1 });
    send({ t: 'sigil', slot: 0, x: 1, z: 2, y: '3' });
    expect(calls).toEqual([]);
  });

  it('refuses a target the team cannot see or that is not an id', () => {
    const { calls, send } = recorder();
    send({ t: 'attack', targetId: FOGGED });
    send({ t: 'attack', targetId: String(SEEN) });
    send({ t: 'attack' });
    expect(calls).toEqual([]);
  });

  it('refuses a spell key, a sigil slot or a Graft card that does not exist', () => {
    const { calls, send } = recorder();
    send({ t: 'cast', key: 'T', x: 1, z: 2 });
    send({ t: 'cast', key: 'constructor', x: 1, z: 2 });
    send({ t: 'sigil', slot: 2, x: 1, z: 2 });
    send({ t: 'sigil', slot: '0', x: 1, z: 2 });
    send({ t: 'graft', pick: 3 });
    send({ t: 'graft', pick: 0.5 });
    send({ t: 'graft', pick: -1 });
    expect(calls).toEqual([]);
  });

  it('has no shop, recall, rank or coach verb', () => {
    for (const verb of ['buy', 'sell', 'drink', 'recall', 'skill', 'order']) {
      expect(ROYALE_VERBS.has(verb)).toBe(false);
    }
    const { calls, send } = recorder();
    send({ t: 'buy', itemId: 'x' });
    send({ t: 'recall' });
    send({ t: 'skill', key: 'Q' });
    send({ t: 'order', kind: 'focus', targetId: SEEN });
    expect(calls).toEqual([]);
  });

  it('is a verb the server takes for every order the sim is handed', () => {
    for (const verb of ['move', 'attack', 'attack_move', 'stop', 'cast', 'sigil', 'graft']) {
      expect(ROYALE_VERBS.has(verb)).toBe(true);
    }
  });
});
