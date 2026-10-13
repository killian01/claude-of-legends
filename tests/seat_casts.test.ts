// A coach seat's spells are a kit to read (src/game/seat_casts.ts): its
// keys and slots cast, aim and rank nothing, and the walk and the attack
// stay its bot's orders.

import { describe, expect, it } from 'vitest';
import { starOrchard } from '../server/star_orchard';
import type { InputHandlers } from '../src/game/input';
import { seatCasts, withoutCasts } from '../src/game/seat_casts';
import { ClientWorld } from '../src/net/client_world';
import type { ClientMsg } from '../src/net/protocol';

const VERBS = [
  'onCast',
  'onAimEnd',
  'onLevelAbility',
  'onCastSigil',
  'onThumbAim',
  'onThumbCast',
  'onThumbSigil',
  'onThumbMove',
  'onThumbAttack',
  'onRightClick',
  'onRecall',
  'onToggleMenu',
] as const;

function recording(calls: string[]): InputHandlers {
  const h: Record<string, () => void> = {};
  for (const name of VERBS) h[name] = () => calls.push(name);
  return h as unknown as InputHandlers;
}

describe('a coach seat casts nothing', () => {
  it('casts from a person on the seat only', () => {
    expect(seatCasts('play')).toBe(true);
    expect(seatCasts('watch')).toBe(true);
    expect(seatCasts('coach')).toBe(false);
  });

  it('drops the cast, aim and rank verbs and keeps the rest', () => {
    const calls: string[] = [];
    const h = withoutCasts(recording(calls));
    const at = { x: 1, z: 2 };
    h.onCast('Q', at);
    h.onAimEnd('Q', at);
    h.onLevelAbility('W');
    h.onCastSigil(0, at);
    h.onThumbAim('E', at, 0.5);
    h.onThumbCast('R', 'tap');
    h.onThumbSigil(1, 'aimed', at, 1);
    expect(calls).toEqual([]);
    h.onThumbMove(at);
    h.onThumbAttack();
    h.onRightClick(at, 0, 0);
    h.onRecall();
    h.onToggleMenu();
    expect(calls).toEqual([
      'onThumbMove',
      'onThumbAttack',
      'onRightClick',
      'onRecall',
      'onToggleMenu',
    ]);
  });

  it('matches the mirror world, which refuses those verbs from a coach', () => {
    const sent: ClientMsg[] = [];
    const world = new ClientWorld((m) => sent.push(m), starOrchard().map);
    world.applyServer({ t: 'match_start', selfUnitId: 1, team: 0, coach: true });
    expect(world.castAbility(1, 'Q', { x: 0, z: 0 })).toBe(false);
    expect(world.castSigil(1, 0, { x: 0, z: 0 })).toBe(false);
    expect(world.levelAbility(1, 'Q')).toBe(false);
    expect(sent).toEqual([]);
  });
});
