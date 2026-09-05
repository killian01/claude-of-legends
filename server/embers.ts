// What every paid act costs, in embers (ADR 0017). Data as code, and the
// only place a price is written down: one ember is one cent of what the
// server spends, so this table is a transcription of measurement and not
// a judgement. The measurements and their method are in
// docs/design/generation-costs.md; re-run the report and edit here.
//
// Measured 2026-09-05, Tripo at ten dollars a thousand credits, so a
// credit is a cent and a credit is an ember.

export type PaidAct =
  // A 3D model reconstructed from the chosen reference.
  | 'model'
  // The weapon prop, its own reconstruction.
  | 'weapon'
  // The rig, once per champion, whatever it is later asked to play.
  | 'rig'
  // One 2D image: a splash, a model reference, weapon art, a spell icon.
  | 'image'
  // One turn of the kit conversation. Three of these can ride one player
  // message when a proposal fails validation (SUGGEST_ATTEMPTS).
  | 'kitTurn'
  // One turn with the coach, in the Academy or on the night.
  | 'coachTurn';

export const EMBER_PRICES: Readonly<Record<PaidAct, number>> = {
  model: 30,
  weapon: 30,
  rig: 25,
  image: 10,
  kitTurn: 2,
  coachTurn: 1,
};

// A clip bake is priced by how many clips it carries: measured at 30 for
// five and 10 for one, which is five to open plus five each. House clips
// are file copies that never touch the provider, so they are free and
// never counted here (CONTEXT.md, Clip file).
export const BAKE_BASE = 5;
export const BAKE_PER_CLIP = 5;

export function bakePrice(providerClips: number): number {
  if (providerClips <= 0) return 0;
  return BAKE_BASE + BAKE_PER_CLIP * providerClips;
}

// The weekly grant: one forged champion a fortnight, the free tier the
// maintainer chose from the measured cost of a week
// (docs/design/generation-costs.md). Unspent embers roll over, so a
// creator who saves two weeks can forge in one.
export const EMBERS_PER_WEEK = 100;

// What one creation of the old economy entitled its holder to, used once
// to carry standing balances across (ADR 0017): a model, its weapon, the
// rig and a full five-clip bake. Balances were counted in creations and
// this is what a creation was worth, so multiplying by it keeps every
// holder exactly as able to build as they were the day before.
export const CREATION_IN_EMBERS =
  EMBER_PRICES.model + EMBER_PRICES.weapon + EMBER_PRICES.rig + bakePrice(5);

// What a whole champion costs at these prices, for the surfaces that want
// to say so before a creator starts one.
export const CHAMPION_IN_EMBERS = CREATION_IN_EMBERS;
