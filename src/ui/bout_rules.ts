// The rule set a screen runs for a bout (ADR 0035, The client reads a
// bout's rule set at every match_start; docs/design/thornfray.md, One match
// layer, a rule set per bout): a Thornfray is one match layer across six
// bouts that switch between One life and Respawn, so what the HUD and the
// cameras do is read again from each bout's variant (match_start's
// royale.v) and kind, never once for the match. Respawn's bouts have the
// return globe and its pick, the SLAIN wash with the seconds back, and the
// Death beat's camera on the killer; One life's the OUT wash and the crew
// camera (in Solo it never moves: the fallen keeps the view of where it
// fell). The count's word and whether it reads as a place are the kind's.
// Pure; game/boot.ts and ui/hud.ts apply it.

import type { BoutKind } from '../sim/content/bouts/types';
import type { RoyaleVariant } from '../sim/royale/types';

export type BoutCamera = 'beat' | 'crew';

export interface BoutRules {
  variant: RoyaleVariant;
  // A dead champion's wait rises to the globe and a tap picks where it
  // comes back (ui/royale_return.ts).
  returnGlobe: boolean;
  // The wash's title over a dead champion.
  wash: 'SLAIN' | 'OUT';
  // The camera that runs while the champion is down: Respawn's Death beat
  // (game/death_beat.ts) or One life's watch (game/crew_watch.ts).
  camera: BoutCamera;
  // The count on the top line: its word, and whether it reads as a place.
  countWord: string;
  countPlace: boolean;
}

export function boutRules(variant: RoyaleVariant, kind: Pick<BoutKind, 'hud'>): BoutRules {
  const respawn = variant === 'respawn';
  return {
    variant,
    returnGlobe: respawn,
    wash: respawn ? 'SLAIN' : 'OUT',
    camera: respawn ? 'beat' : 'crew',
    countWord: kind.hud.word,
    countPlace: kind.hud.place,
  };
}
