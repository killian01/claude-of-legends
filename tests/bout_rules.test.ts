// The rule set a screen runs for a Thornfray's bout (src/ui/bout_rules.ts):
// read from each bout's variant and kind, so Starglean after Lastwick has
// its return globe and Lastwick after Starglean has none.

import { describe, expect, it } from 'vitest';
import { BOUT_KINDS } from '../src/sim/content/bouts';
import { boutRules } from '../src/ui/bout_rules';
import { returnGlobeOn } from '../src/ui/royale_return';

const LASTWICK = BOUT_KINDS.find((k) => k.id === 'lastwick')!;
const STARGLEAN = BOUT_KINDS.find((k) => k.id === 'starglean')!;

describe("a bout's rule set", () => {
  it("runs Respawn's globe, wash and Death beat in a Respawn bout", () => {
    expect(boutRules('respawn', STARGLEAN)).toEqual({
      variant: 'respawn',
      returnGlobe: true,
      wash: 'SLAIN',
      camera: 'beat',
      countWord: 'gleaned',
      countPlace: false,
    });
  });

  it("runs One life's wash and watch in a One life bout, no globe", () => {
    expect(boutRules('one_life', LASTWICK)).toEqual({
      variant: 'one_life',
      returnGlobe: false,
      wash: 'OUT',
      camera: 'crew',
      countWord: 'left',
      countPlace: true,
    });
  });

  it('switches with every bout, whatever came before', () => {
    // Lastwick, then Starglean, then Lastwick: each bout's own.
    const chain = [LASTWICK, STARGLEAN, LASTWICK].map((k) => boutRules(k.base, k));
    expect(chain.map((r) => r.returnGlobe)).toEqual([false, true, false]);
    expect(chain.map((r) => r.camera)).toEqual(['crew', 'beat', 'crew']);
    // The return globe itself reads the snapshot's variant, the bout's.
    const dead = { dead: true, respawnAt: 20 };
    expect(returnGlobeOn({ v: STARGLEAN.base, st: 'play' }, dead, 18)).toBe(true);
    expect(returnGlobeOn({ v: LASTWICK.base, st: 'play' }, dead, 18)).toBe(false);
  });

  it('has a rule set for every registered kind', () => {
    for (const kind of BOUT_KINDS) {
      const rules = boutRules(kind.base, kind);
      expect(rules.returnGlobe).toBe(kind.base === 'respawn');
      expect(rules.countWord).toBe(kind.hud.word);
    }
  });
});
