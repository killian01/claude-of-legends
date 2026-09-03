// The word filter on forged card texts: slurs and hard profanity are
// caught through case, separators, and leet swaps; innocent words that
// merely contain a blocked word pass (the Scunthorpe rule).

import { describe, expect, it } from 'vitest';
import { deleteDraft, saveDraft } from '../server/forge';
import { ForgeStore } from '../server/forge_store';
import { findBlockedWord } from '../server/word_filter';
import { CHAMPIONS } from '../src/sim/content/champions';
import { forgedTwin } from './forged_twins';

describe('word filter', () => {
  it('catches blocked words through disguises', () => {
    expect(findBlockedWord(['clean name'])).toBeNull();
    expect(findBlockedWord(['FUCK'])).toBe('fuck');
    expect(findBlockedWord(['f.u_c-k this'])).toBe('fuck');
    expect(findBlockedWord(['sh1t storm'])).toBe('shit');
    expect(findBlockedWord(['okay', 'N1gg3r the Bold'])).toBe('nigger');
  });

  it('lets innocent containing words through', () => {
    expect(findBlockedWord(['Scunthorpe'])).toBeNull();
    expect(findBlockedWord(['Shittake is close but not it'])).toBeNull();
    expect(findBlockedWord(['Cocktail Hour'])).toBeNull();
    expect(findBlockedWord(['Analyst of Ruin'])).toBeNull();
    expect(findBlockedWord(['Raconteur'])).toBeNull();
  });

  it('gates draft saves on every authored string', () => {
    const store = new ForgeStore(':memory:');
    const deps = { store };

    const rude = { ...forgedTwin(CHAMPIONS.sylra!), id: 'forged_rude', title: 'the Sh1t' };
    expect(saveDraft(deps, 1, 'bob', rude)).toMatchObject({
      ok: false,
      error: expect.stringContaining('shit'),
    });

    const clean = { ...forgedTwin(CHAMPIONS.sylra!), id: 'forged_clean' };
    expect(saveDraft(deps, 1, 'bob', clean)).toEqual({ ok: true });
    // The creator signature is the server's stamp, never the client's.
    expect(store.getForged('forged_clean')?.def.creator).toBe('bob');
    expect(deleteDraft(deps, 1, 'forged_clean')).toEqual({ ok: true });
    store.close();
  });
});
