// The word filter on forged card texts: slurs and hard profanity are
// caught through case, separators, and leet swaps; innocent words that
// merely contain a blocked word pass (the Scunthorpe rule).

import { describe, expect, it } from 'vitest';
import { AuthService } from '../server/auth';
import { deleteDraft, saveDraft } from '../server/forge';
import { PlayerRegistry } from '../server/players';
import { Storage } from '../server/storage';
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
    const storage = new Storage(':memory:');
    const registry = new PlayerRegistry(storage, (used) => {
      for (let d = 1000; ; d++) if (!used.has(d)) return d;
    });
    const auth = new AuthService(
      storage,
      registry,
      { send: () => Promise.resolve() },
      { origin: 'https://play.example.com', creationsGrant: 3 },
    );
    auth.signup('tok-a', 'bob@example.com', 'longenough');
    const deps = { storage, auth };

    const rude = { ...forgedTwin(CHAMPIONS.sylra!), id: 'forged_rude', title: 'the Sh1t' };
    expect(saveDraft(deps, 'tok-a', rude)).toMatchObject({
      ok: false,
      error: expect.stringContaining('shit'),
    });

    const clean = { ...forgedTwin(CHAMPIONS.sylra!), id: 'forged_clean' };
    expect(saveDraft(deps, 'tok-a', clean)).toEqual({ ok: true });
    expect(deleteDraft(deps, 'tok-a', 'forged_clean')).toEqual({ ok: true });
    storage.close();
  });
});
