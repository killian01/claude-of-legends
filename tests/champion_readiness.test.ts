// The list a match waits on before it is shown (src/render/champions/
// readiness.ts): every roster champion with a model, plus the forged ones
// the match brought, each once.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHAMPION_VISUALS } from '../src/render/champions/manifest';
import { matchModelIds } from '../src/render/champions/readiness';
import { CHAMPIONS } from '../src/sim/content/champions';

// A champion's authored spell effects live in her own module under
// src/render/vfx/ (<name>_fx.ts, exporting preload<Name>Effects). The
// game has to start those downloads with the models and wait for them
// with the models, or her first casts play the stand-in shapes: Elowen
// shipped that way once, her mist only ever loading on the first lance.
describe('the authored effects', () => {
  const src = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(`../src/render/${rel}`, import.meta.url)), 'utf8');
  const preloads = readdirSync(fileURLToPath(new URL('../src/render/vfx', import.meta.url)))
    .filter((f) => f.endsWith('_fx.ts'))
    .flatMap((f) =>
      [...src(`vfx/${f}`).matchAll(/export function (preload\w+Effects)\(/g)].map((m) => m[1]),
    );

  it('exist, one preload per module', () => {
    expect(preloads.length).toBeGreaterThan(0);
  });

  it('start loading with the champion models', () => {
    const assets = src('champions/assets.ts');
    for (const name of preloads) expect(assets).toContain(`void ${name}();`);
  });

  it('are waited for before a match is shown', () => {
    const readiness = src('champions/readiness.ts');
    for (const name of preloads) expect(readiness).toContain(`${name}().catch(`);
  });
});

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
