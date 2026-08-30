// The account name a Discord sign-up gets, derived from the name Discord
// showed (ADR 0009). Nobody typed anything, so this module has to land on
// a name that always passes server/account_name.ts, and it must do so
// without asking the player: the whole point of the Discord door is that
// there is no form on the way in.
//
// Pure and total, like account_name.ts: no registry, no randomness. Who
// already holds a name is the registry's knowledge, so it comes in as a
// predicate and uniqueness stays judged in exactly one place.

import { NAME_MAX, validateName } from './account_name';

// What a Discord name is reduced to when nothing usable survives: a
// display name can be entirely emoji or entirely CJK, and this game's
// name space is deliberately ASCII (ADR 0004).
export const FALLBACK_NAME = 'Player';

// `free` answers whether a candidate raw name can be registered right
// now, folding included. The first free candidate wins: the stripped
// Discord name as-is, then the same with 2, 3, 4... appended, shortening
// the stem when the digits would not fit. The suffix can grow without
// bound, so this always returns; digits alone are a valid name.
export function deriveName(discordName: string, free: (candidate: string) => boolean): string {
  const stripped = discordName.replace(/[^A-Za-z0-9_-]/g, '').slice(0, NAME_MAX);
  const base = validateName(stripped) === null ? stripped : FALLBACK_NAME;
  if (free(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = String(n);
    const candidate = base.slice(0, NAME_MAX - suffix.length) + suffix;
    if (validateName(candidate) === null && free(candidate)) return candidate;
  }
}
