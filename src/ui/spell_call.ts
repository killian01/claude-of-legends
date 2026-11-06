// The spells' call in a first fight, decided without the DOM: until the own
// champion casts a spell this match, the spells it could cast now glow on
// the bar while it is in a fight (a hit taken in the last SPELL_CALL_S), so
// one struck while it only swings sees where its kit is. The first cast
// seen (a spell's cooldown starting) ends the call for the match. The
// HUD asks it every frame (ui/hud.ts) in a battle royale.

import type { AbilityKey } from '../sim/types';

export const SPELL_CALL_S = 4;

export class SpellCall {
  private cast = false;
  private readonly cooling = new Map<AbilityKey, boolean>();

  // One frame of the bar: whether each spell is cooling down now. A spell
  // that starts to cool down is a cast; the first frame only primes, so a
  // seat taken from its bot mid-cooldown does not count the bot's.
  step(key: AbilityKey, cooling: boolean): void {
    const was = this.cooling.get(key);
    if (was === false && cooling) this.cast = true;
    this.cooling.set(key, cooling);
  }

  get done(): boolean {
    return this.cast;
  }

  // Whether a spell glows: none cast yet, a hit taken within SPELL_CALL_S,
  // and this one ready (ranked, off cooldown, its mana there).
  calls(sinceHit: number | null, ready: boolean): boolean {
    if (this.cast || !ready || sinceHit === null) return false;
    return sinceHit >= 0 && sinceHit < SPELL_CALL_S;
  }
}
