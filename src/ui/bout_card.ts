// The bout's card (CONTEXT.md: Win card, Bout; docs/design/thornfray.md, The
// HUD and the phone): at each bout's landing the win card says the kind's
// own rule instead of the battle royale's, titled with the kind's name and
// the bout's number ("Starglean · Bout 3 of 6", "Lastwick · the Final"),
// its lines the kind's card (two or three short lines, the first its rule).
// What the Final pays is said by the Lull's card just before it, the win
// line and the x2 pill beside the count: the card keeps the kind's lines
// alone, which every kind's registry gate fits on a phone
// (tests/royale_win_layout.test.ts). Pure; ui/royale_win_view.ts draws it
// like any win card, restarted at each bout's landing.

import type { BoutKind } from '../sim/content/bouts/types';
import { boutOfText, isFinal } from './bout_text';
import type { WinCardWords } from './royale_win_card';

export function boutCardWords(kind: Pick<BoutKind, 'name' | 'card'>, b: number): WinCardWords {
  return {
    title: `${kind.name} · ${isFinal(b) ? 'the Final' : boutOfText(b)}`,
    lines: [...kind.card],
  };
}
