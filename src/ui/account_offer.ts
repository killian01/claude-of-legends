// The account offer: the line at the end of a visitor's practice match
// that asks for the account, once the match has given them a reason.
//
// The landing asks for an account before anything has happened, and a
// visitor takes the free door instead. The end screen is the one moment
// they hold something the account would have kept: a score, a champion,
// a win. So the offer is made there, in their own numbers, and only there.
// The decision and the words are pure so a test reads them without a
// browser; ui/hud.ts draws the block.

export interface AccountOfferInput {
  // No session: the match was reached from the landing, which makes it
  // the practice match, the one mode that opens without an account. Every
  // other mode already required one, so an account never sees the offer.
  guest: boolean;
  won: boolean;
  kills: number;
  deaths: number;
  assists: number;
  // The champion's display name, or null when the unit is gone. The
  // roster writes it "Sylra, Thornweaver"; the line uses the name alone.
  champion: string | null;
}

export interface AccountOffer {
  // What just happened, in the visitor's numbers.
  line: string;
  // What the account would have done with it.
  reason: string;
  // The button.
  call: string;
}

export const OFFER_CALL = 'Create a free account';

function firstName(champion: string): string {
  const comma = champion.indexOf(',');
  return (comma < 0 ? champion : champion.slice(0, comma)).trim();
}

export function accountOffer(input: AccountOfferInput): AccountOffer | null {
  if (!input.guest) return null;
  const score = `${input.kills} / ${input.deaths} / ${input.assists}`;
  const who = input.champion ? ` with ${firstName(input.champion)}` : '';
  const line = input.won ? `You won ${score}${who}.` : `You went ${score}${who}.`;
  return {
    line,
    reason:
      'This match was not saved. A free account keeps the next ones: ' +
      'your rating, your record and your place on the ladder.',
    call: OFFER_CALL,
  };
}
