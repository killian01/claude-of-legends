// Who holds an email address, and for how long.
//
// The rule (ADR 0007): an address is held from the moment someone
// registers with it, before any click. That is what keeps ten accounts
// off one address, and it is also what lets someone register with a
// stranger's address and hold it. The expiry is the whole answer to that
// second half: an unheld claim is released after a week, so a squat costs
// a burned account name per attempt and buys seven days.
//
// A CONFIRMED claim never expires. At that point a real person has proven
// they read that mailbox, and taking it away later would hand their
// password reset to whoever registered it next.

export const CLAIM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Only what the rule below needs to decide. WHO holds the address is the
// account registry's business (server/accounts.ts owns that index), so it
// is deliberately absent here: this module answers "does this claim still
// stand", not "whose is it", and an AccountEmail satisfies it as it is.
export interface EmailClaim {
  // When the claim was staked, which is registration time or the moment
  // the address was changed.
  claimedAt: number;
  confirmed: boolean;
}

// Whether this claim still stands, and therefore still blocks everyone
// else from the address.
export function claimHolds(claim: EmailClaim, now: number): boolean {
  if (claim.confirmed) return true;
  return now - claim.claimedAt < CLAIM_TTL_MS;
}

// How long an unconfirmed claim has left, for a message that tells the
// truth about the wait. Zero once it has lapsed, and for a confirmed
// claim, which never lapses.
export function claimExpiresInMs(claim: EmailClaim, now: number): number {
  if (claim.confirmed) return 0;
  return Math.max(0, claim.claimedAt + CLAIM_TTL_MS - now);
}
