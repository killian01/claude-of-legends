// The account offer at the end of a practice match: who sees it, and what
// it says.

import { describe, expect, it } from 'vitest';
import { accountOffer, OFFER_CALL } from '../src/ui/account_offer';

const base = {
  guest: true,
  won: false,
  kills: 7,
  deaths: 2,
  assists: 5,
  champion: 'Sylra',
};

describe('account offer', () => {
  it('is made to a visitor at the end of a practice match, in their numbers', () => {
    const offer = accountOffer(base);
    expect(offer).not.toBeNull();
    expect(offer?.line).toBe('You went 7 / 2 / 5 with Sylra.');
    expect(offer?.call).toBe(OFFER_CALL);
    expect(offer?.reason).toContain('not saved');
  });

  it('says so when they won', () => {
    expect(accountOffer({ ...base, won: true })?.line).toBe('You won 7 / 2 / 5 with Sylra.');
  });

  it('names the champion without the roster title', () => {
    expect(accountOffer({ ...base, champion: 'Sylra, Thornweaver' })?.line).toBe(
      'You went 7 / 2 / 5 with Sylra.',
    );
  });

  it('leaves the champion out when the unit is gone', () => {
    expect(accountOffer({ ...base, champion: null })?.line).toBe('You went 7 / 2 / 5.');
  });

  it('is never made to an account', () => {
    expect(accountOffer({ ...base, guest: false })).toBeNull();
  });
});
