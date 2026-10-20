// A Thornfray's bout in the battle royale's layer of the HUD (ADR 0035;
// docs/design/thornfray.md, The HUD and the phone), built afresh at each
// bout's start with its kind and the table it starts with (ui/royale_hud.ts
// owns it): the top line's count and the win line in the bout's words, the
// Final's x2 pill, the bushels chip ("17 bushels · 2nd", in the leader
// badge's slot on a desktop, beside the win line on a phone), the Lull's
// card (ui/lull_view.ts) and the last bout's end beat in the spotlight at
// the Lull's start ("LASTWICK · Wren"), read from the table: the next
// bout's match_start has reset the world by then. What any of it says is
// decided in ui/bout_text.ts and ui/lull_model.ts; this module only draws.

import type { BoutStart, SnapRoyale } from '../net/royale_wire';
import { boutKindOf } from '../sim/content/bouts';
import type { BoutKind } from '../sim/content/bouts/types';
import {
  boutOutLine,
  boutTopLine,
  boutWinLine,
  bushelsChip,
  END_BEAT_S,
  endBeatText,
  finalBadge,
  isFinal,
  lastWinner,
} from './bout_text';
import { setHidden } from './dom_write';
import { endBeatDue, lullModel, lullUp } from './lull_model';
import { LullView } from './lull_view';
import type { MomentCall } from './royale_moments';

const CSS = `
/* The bushels chip: in the leader badge's slot on a desktop, beside the
   win line on a phone, where the head's row has no room for it. */
.br-bushels { display: flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 999px;
  border: 1px solid #8a7430; background: rgba(30, 26, 12, 0.88); color: #ffe08a;
  font-size: 12px; font-weight: 800; white-space: nowrap; font-variant-numeric: tabular-nums; }
.br-bushels i { width: 9px; height: 9px; flex: none; border-radius: 50% 50% 45% 45%;
  background: radial-gradient(circle at 40% 35%, #fff2b8, #e0b040 60%, #8a6018); }
.hud.compact .br-bushels.head, .hud:not(.compact) .br-bushels.sub { display: none; }
.hud.compact .br-bushels { font-size: 10.5px; padding: 1px 7px; gap: 4px; line-height: 15px; }
.hud.compact .br-bushels i { width: 7px; height: 7px; }
/* The Lull's card stands where the drop's banner asked: the card's foot
   asks the same, its head counts the seconds. */
.hud.br-lull .br-drop { display: none; }
`;

// The end beat's look: the gold of a win.
const BEAT_COLOR = '#ffe08a';

export interface BoutHudHost {
  root: HTMLElement;
  layer: HTMLElement;
  // The head of the top line and the row under it, for the chips.
  head: HTMLElement;
  sub: HTMLElement;
  touch: boolean;
  kind: BoutKind;
  start: BoutStart;
  // Plays a call (the end beat) as the moments play theirs.
  play: (calls: readonly MomentCall[]) => void;
}

const chip = (where: 'head' | 'sub'): HTMLElement => {
  const e = document.createElement('div');
  e.className = `br-bushels ${where}`;
  e.hidden = true;
  e.append(document.createElement('i'), document.createElement('span'));
  return e;
};

const kindName = (id: string): string | null => boutKindOf(id)?.name ?? null;

export class RoyaleHudBout {
  private readonly host: BoutHudHost;
  private readonly style: HTMLStyleElement;
  private readonly chipHead: HTMLElement;
  private readonly chipSub: HTMLElement;
  private readonly lull: LullView;
  private beatPlayed = false;

  constructor(host: BoutHudHost) {
    this.host = host;
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.chipHead = chip('head');
    this.chipSub = chip('sub');
    host.head.appendChild(this.chipHead);
    host.sub.appendChild(this.chipSub);
    const words = bushelsChip(host.start);
    for (const c of [this.chipHead, this.chipSub]) {
      const span = c.lastElementChild as HTMLElement;
      span.textContent = words ?? '';
    }
    this.lull = new LullView(host.layer);
  }

  get kind(): BoutKind {
    return this.host.kind;
  }

  get start(): BoutStart {
    return this.host.start;
  }

  get final(): boolean {
    return isFinal(this.host.start.b);
  }

  // The top line's count in the bout's words.
  topLine(r: SnapRoyale, time: number, compact: boolean): string {
    return boutTopLine(this.host.kind, this.host.start.b, r, time, compact);
  }

  // The win line in the bout's words.
  winLine(r: SnapRoyale, _time: number, compact: boolean): string | null {
    return boutWinLine(this.host.kind, this.host.start.b, r, compact);
  }

  // The x2 pill: the Final's double bushels, while the bout plays.
  badge(r: Pick<SnapRoyale, 'st'>): string | null {
    return r.st === 'play' ? finalBadge(this.host.start.b) : null;
  }

  // The wash's line over a champion out of a One life bout.
  outLine(place: number | undefined): string {
    return boutOutLine(place, this.final);
  }

  // Once per HUD update: the chips, the Lull's card and the end beat.
  // `marked` while the mark's badge holds the leader's slot; `burning`
  // while the Dusk's pill shows.
  update(r: SnapRoyale, time: number, marked: boolean, burning: boolean): void {
    const { root, start } = this.host;
    // From the second bout: in the first everyone stands at nothing.
    const play = r.st === 'play' && start.b > 0;
    const words = bushelsChip(start);
    setHidden(this.chipHead, !play || marked || words === null);
    setHidden(this.chipSub, !play || burning || words === null);
    if (!this.beatPlayed && endBeatDue(start, r, time)) {
      this.beatPlayed = true;
      const winner = lastWinner(start, kindName);
      if (winner) {
        this.host.play([
          {
            text: endBeatText(winner),
            color: BEAT_COLOR,
            spotlight: true,
            holdMs: END_BEAT_S * 1000,
            sfx: 'gong',
          },
        ]);
      }
    }
    // The card waits for the end beat's word to have gone (its fade runs on
    // the page's clock), a second past the beat at most.
    const word = root.classList.contains('br-spotting') && time < END_BEAT_S + 1;
    const up = lullUp(start, r, time) && !word;
    root.classList.toggle('br-lull', r.st === 'drop');
    const compact = root.classList.contains('compact');
    this.lull.update(
      up
        ? lullModel(start, this.host.kind, r, time, {
            touch: this.host.touch,
            compact,
            kindName,
          })
        : null,
    );
  }

  dispose(): void {
    this.host.root.classList.remove('br-lull');
    this.chipHead.remove();
    this.chipSub.remove();
    this.lull.dispose();
    this.style.remove();
  }
}
