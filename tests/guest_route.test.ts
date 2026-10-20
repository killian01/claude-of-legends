// What a Guest's way in from the landing leads to (src/game/guest_route.ts,
// ui/landing_modes.ts LandingPlay): every door the landing draws routes to
// its own loop, and only the 5v5's reaches the public queue. main.ts's
// playAsGuest runs the loop the route names, and nothing else decides it.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { guestLoop } from '../src/game/guest_route';
import { LANDING_WAYS, type LandingPlay, PLAY_NOW } from '../src/ui/landing_modes';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe("a Guest's way in", () => {
  it('routes every way the landing draws to its own loop', () => {
    expect(LANDING_WAYS.map((w) => [w.id, guestLoop(w.door.play)])).toEqual([
      ['respawn', { loop: 'royale', variant: 'respawn', solo: true }],
      ['one_life', { loop: 'royale', variant: 'one_life', solo: false }],
      ['thornfray', { loop: 'thornfray' }],
      ['classic', { loop: 'queue' }],
    ]);
  });

  it('sends the gold button and the ladder to Respawn in Solo', () => {
    expect(guestLoop(PLAY_NOW.play)).toEqual({ loop: 'royale', variant: 'respawn', solo: true });
  });

  it('reaches the 5v5 queue from the 5v5 alone', () => {
    const plays: LandingPlay[] = [
      { to: 'royale', variant: 'respawn' },
      { to: 'royale', variant: 'one_life', solo: true },
      { to: 'thornfray' },
      { to: 'classic' },
    ];
    for (const play of plays) {
      expect(guestLoop(play).loop === 'queue').toBe(play.to === 'classic');
    }
  });

  it('refuses a way in it does not know rather than queueing it', () => {
    // What a stale build could hand it: never the 5v5's queue by default.
    expect(() => guestLoop({ to: 'elsewhere' } as unknown as LandingPlay)).toThrow(/no loop/);
  });

  it("is what main.ts's playAsGuest runs, the Thornfray's loop included", () => {
    const main = readFileSync(path.join(ROOT, 'src/main.ts'), 'utf8');
    const at = main.indexOf('async function playAsGuest(');
    expect(at).toBeGreaterThan(0);
    const body = main.slice(at, main.indexOf('\n}\n', at));
    expect(body).toContain('const route = guestLoop(play);');
    expect(body).toContain("if (route.loop === 'thornfray') return thornfrayLoop(true);");
    expect(body).not.toContain('play.to');
    // The home's Thornfray tile runs the same loop for an account.
    expect(main).toContain("} else if (choice.mode === 'thornfray') {");
    expect(main).toContain('action = await thornfrayLoop(false);');
    // The dev server's address door is gone: the landing and the home are
    // the Thornfray's doors now.
    expect(main).not.toContain("has('thornfray')");
  });
});
