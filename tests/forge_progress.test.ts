// Where a champion is and what finishing it costs (forge_progress.ts):
// the one line the editor's rail shows, so a creator coming back the
// next day reads their own state instead of rediscovering it.

import { describe, expect, it } from 'vitest';
import { championProgress, type ProgressInput } from '../src/ui/forge_progress';

const PRICES: Record<string, number> = {
  image: 4,
  model: 30,
  rig: 25,
  weapon: 30,
  bakeBase: 5,
  bakePerClip: 5,
};

function input(over: Partial<ProgressInput> = {}): ProgressInput {
  return {
    chosen: () => false,
    model: false,
    weapon: false,
    clips: false,
    sealed: false,
    kitValid: true,
    price: (act) => PRICES[act] ?? 0,
    ...over,
  };
}

describe('championProgress', () => {
  it('counts a fresh draft as nothing done, and prices the whole road', () => {
    const p = championProgress(input());
    // Splash, reference, model, clips, kit, seal: the weapon is optional
    // and never counted as missing.
    expect(p.total).toBe(6);
    expect(p.done).toBe(1); // the fresh kit already validates
    expect(p.next).toBe('Splash art');
    // Two images, the build with its rig, and a five-clip bake.
    expect(p.remaining).toBe(4 + 4 + (30 + 25) + (5 + 5 * 5));
  });

  it('drops each step from the bill as it lands', () => {
    const chosen = (kind: string): boolean => kind === 'splash' || kind === 'sheet';
    const p = championProgress(input({ chosen, model: true }));
    expect(p.next).toBe('Animations');
    expect(p.remaining).toBe(5 + 5 * 5);
    expect(p.steps.find((s) => s.key === 'model')?.done).toBe(true);
  });

  it('adds the weapon to the build when its image is waiting for one', () => {
    const withArt = championProgress(input({ chosen: (k) => k === 'weapon' }));
    const build = withArt.steps.find((s) => s.key === 'model');
    // The build forges the weapon alongside the model, so it is priced
    // where it is actually paid.
    expect(build?.cost).toBe(30 + 25 + 30);
    const forged = championProgress(input({ chosen: (k) => k === 'weapon', weapon: true }));
    expect(forged.steps.find((s) => s.key === 'model')?.cost).toBe(30 + 25);
    // And a champion that has its weapon has that optional step done.
    expect(forged.steps.find((s) => s.key === 'weapon')?.done).toBe(true);
  });

  it('names the kit when the kit is what is missing, and costs nothing for it', () => {
    const p = championProgress(
      input({ chosen: () => true, model: true, clips: true, kitValid: false }),
    );
    expect(p.next).toBe('A kit that validates');
    expect(p.remaining).toBe(0);
  });

  it('says nothing is left once the champion is sealed', () => {
    const p = championProgress(
      input({ chosen: () => true, model: true, weapon: true, clips: true, sealed: true }),
    );
    expect(p.next).toBe(null);
    expect(p.done).toBe(p.total);
    expect(p.remaining).toBe(0);
  });
});
