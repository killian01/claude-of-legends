// The IWorld parity pin (world-of-claudecraft pattern): both worlds, the
// offline Sim and the online ClientWorld, expose every IWorld member with
// the same shape. Adding a member to IWorld without implementing it in BOTH
// worlds fails here. Update this list in the same change as the facet.

import { describe, expect, it } from 'vitest';
import { starOrchard } from '../server/star_orchard';
import { ClientWorld } from '../src/net/client_world';
import { Sim } from '../src/sim/sim';
import type { IWorld } from '../src/world_api';

const IWORLD_MEMBERS: readonly { name: string; kind: 'value' | 'function' }[] = [
  { name: 'map', kind: 'value' },
  { name: 'time', kind: 'value' },
  { name: 'winner', kind: 'value' },
  { name: 'units', kind: 'value' },
  { name: 'projectiles', kind: 'value' },
  { name: 'zones', kind: 'value' },
  { name: 'championDef', kind: 'function' },
  { name: 'scoreboard', kind: 'function' },
  { name: 'isVisible', kind: 'function' },
  { name: 'teamBuff', kind: 'function' },
  { name: 'objectiveSpawnAt', kind: 'function' },
  { name: 'ringClocks', kind: 'function' },
  { name: 'teamFavors', kind: 'function' },
  { name: 'teamWrath', kind: 'function' },
  { name: 'orderMove', kind: 'function' },
  { name: 'orderAttack', kind: 'function' },
  { name: 'orderAttackMove', kind: 'function' },
  { name: 'startRecall', kind: 'function' },
  { name: 'castAbility', kind: 'function' },
  { name: 'castSigil', kind: 'function' },
  { name: 'buyItem', kind: 'function' },
  { name: 'levelAbility', kind: 'function' },
];

describe('IWorld parity', () => {
  // Structural assignability is checked at compile time by these two lines.
  const sim: IWorld = new Sim(1);
  const client: IWorld = new ClientWorld(() => undefined, starOrchard().map);

  it('both worlds implement every pinned member', () => {
    for (const member of IWORLD_MEMBERS) {
      for (const [label, world] of [
        ['Sim', sim],
        ['ClientWorld', client],
      ] as const) {
        const value = (world as unknown as Record<string, unknown>)[member.name];
        expect(value, `${label}.${member.name}`).toBeDefined();
        if (member.kind === 'function') {
          expect(typeof value, `${label}.${member.name}`).toBe('function');
        }
      }
    }
  });

  it('the pin covers every IWorld member', () => {
    // A new member on the interface must be added to the pin (and to both
    // worlds). Sim carries extra members; the pin only lists the seam.
    const pinned = new Set(IWORLD_MEMBERS.map((m) => m.name));
    expect(pinned.size).toBe(IWORLD_MEMBERS.length);
  });
});
