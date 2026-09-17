// The list a match waits on before it is shown (src/render/champions/
// readiness.ts): every roster champion with a model, plus the forged ones
// the match brought, each once.

import { describe, expect, it } from 'vitest';
import { CHAMPION_VISUALS } from '../src/render/champions/manifest';
import { matchModelIds } from '../src/render/champions/readiness';
import { CHAMPIONS } from '../src/sim/content/champions';

describe('matchModelIds', () => {
  it('waits on every roster champion that has a model', () => {
    const ids = matchModelIds();
    for (const id of Object.keys(CHAMPIONS)) {
      if (CHAMPION_VISUALS[id]) expect(ids).toContain(id);
    }
    expect(ids).toEqual(Object.keys(CHAMPION_VISUALS));
  });

  it('adds the forged champions of the match, once each', () => {
    const ids = matchModelIds(['forged-a', 'forged-b', 'forged-a']);
    expect(ids.filter((id) => id === 'forged-a')).toHaveLength(1);
    expect(ids).toContain('forged-b');
    expect(ids).toHaveLength(Object.keys(CHAMPION_VISUALS).length + 2);
  });

  it('never lists a roster champion twice when a forged id repeats one', () => {
    const [first] = Object.keys(CHAMPION_VISUALS);
    expect(matchModelIds([first!])).toEqual(Object.keys(CHAMPION_VISUALS));
  });
});
