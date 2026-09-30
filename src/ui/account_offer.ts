// The account offer: the line at the end of a visitor's match that asks
// for the account, once the match has given them a reason.
//
// The landing asks for an account before anything has happened, and a
// visitor takes the free door instead. The end screen is the one moment
// they hold something the account would keep: a score, a champion, a win,
// and since ADR 0027 the points the match banked on the ladder. A Guest's
// points are kept already, by this browser; what the account adds is
// keeping them on every device, and ranked, bots and the Forge. So the
// offer is made there, in their own numbers, and only there. The decision
// and the words are pure so a test reads them without a browser; ui/hud.ts
// draws the block.

export interface AccountOfferInput {
  // No account behind the match: a Guest in the public queue, or the
  // practice match the landing falls back to. Every other mode already
  // required one, so an account never sees the offer.
  guest: boolean;
  // The match banked points on the Guest's line (a public queue match):
  // the offer is about keeping them, not about a match nobody saved.
  scored: boolean;
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
  // What the account would do with it.
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
    reason: input.scored
      ? 'Your points are on the ladder, kept by this browser. A free account keeps them on ' +
        'every device, and opens ranked, bots and the Forge.'
      : 'This match was not saved. Online, every match scores on the ladder, and a free ' +
        'account keeps your points on every device.',
    call: OFFER_CALL,
  };
}
