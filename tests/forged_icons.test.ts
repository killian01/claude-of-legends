// A forged champion's generated spell icons reach the HUD (plan-forge
// phase 4, playtest: a test drive showed procedural icons over a champion
// whose creator had chosen four). The registry the client glue fills and
// the ability icon resolver reads.

import { afterEach, describe, expect, it } from 'vitest';
import { clearForgedIcons, forgedIconUrl, registerForgedIcons } from '../src/ui/forged_icons';
import { abilityImageUrl } from '../src/ui/icon_images';

afterEach(() => clearForgedIcons());

describe('forged spell icons', () => {
  it('answers the registered icon per slot and nothing for the rest', () => {
    registerForgedIcons('forged_x', { Q: '/api/forge/asset/forged/x/q.png' });
    expect(forgedIconUrl('forged_x', 'Q')).toBe('/api/forge/asset/forged/x/q.png');
    expect(forgedIconUrl('forged_x', 'W')).toBeNull();
    expect(forgedIconUrl('forged_y', 'Q')).toBeNull();
  });

  it('comes first in the ability image lookup, roster paintings untouched', () => {
    expect(abilityImageUrl('forged_x', 'Q')).toBeNull();
    registerForgedIcons('forged_x', { Q: '/api/forge/asset/forged/x/q.png' });
    expect(abilityImageUrl('forged_x', 'Q')).toBe('/api/forge/asset/forged/x/q.png');
    // Slots without a generated icon fall through to the procedural
    // painter (null here: no shipped painting under a forged id).
    expect(abilityImageUrl('forged_x', 'W')).toBeNull();
    expect(abilityImageUrl('forged_x', 'P')).toBeNull();
    expect(abilityImageUrl('korrath', 'Q')).toBe('/icons/abilities/korrath_Q.webp');
  });

  it('replaces the set at every announcement: an un-picked icon stops showing', () => {
    registerForgedIcons('forged_x', { Q: '/q.png', W: '/w.png' });
    registerForgedIcons('forged_x', { W: '/w2.png' });
    expect(forgedIconUrl('forged_x', 'Q')).toBeNull();
    expect(forgedIconUrl('forged_x', 'W')).toBe('/w2.png');
    registerForgedIcons('forged_x', {});
    expect(forgedIconUrl('forged_x', 'W')).toBeNull();
  });
});
