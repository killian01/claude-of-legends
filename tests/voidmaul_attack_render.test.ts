import { describe, expect, it, vi } from 'vitest';
import { attacksFrom } from '../src/game/attack_notes';
import { Renderer } from '../src/render/renderer';
import type { SimEvent } from '../src/sim/sim';

vi.mock('../src/game/sfx', () => ({ playSfx: vi.fn(), playCastSfx: vi.fn() }));

describe('authoritative Voidmaul swing presentation', () => {
  it('forwards each local and snapshot choice to the visible creature with the remaining windup', () => {
    const playAttack = vi.fn();
    const attacker = {
      kind: 'creature',
      creatureId: 'voidmaul',
      stats: { attackSpeed: 0.3, attackRange: 4 },
      pendingAttack: { resolveAt: 10.75 },
    };
    const tracked = { kind: 'creature', mesh: { visible: true }, curr: { x: 0, z: 0 } };
    const renderer = {
      followId: null,
      world: { time: 9, units: new Map([[42, attacker]]) },
      tracked: new Map([[42, tracked]]),
      creatureVisuals: new Map([[42, { playAttack }]]),
      championVisuals: new Map(),
      sfxGain: () => 1,
    };
    const events: SimEvent[] = [
      { type: 'attack', unitId: 42, targetId: 7, voidmaulAttack: 'slam' },
      { type: 'attack', unitId: 42, targetId: 7, voidmaulAttack: 'crush' },
    ];
    const attacks = [
      ...attacksFrom(events),
      ...attacksFrom([{ e: 'atk', unitId: 42, targetId: 7, voidmaulAttack: 'crush' }]),
      ...attacksFrom([{ e: 'atk', unitId: 42, targetId: 7 }]),
    ];
    Renderer.prototype.onCombatNotes.call(renderer as never, {
      golds: [],
      casts: [],
      hits: [],
      attacks,
    });
    expect(playAttack.mock.calls).toEqual([
      [1.75, 'slam'],
      [1.75, 'crush'],
      [1.75, 'crush'],
      [1.75, undefined],
    ]);
    tracked.mesh.visible = false;
    Renderer.prototype.onCombatNotes.call(renderer as never, {
      golds: [],
      casts: [],
      hits: [],
      attacks,
    });
    expect(playAttack).toHaveBeenCalledTimes(4);
  });
});
