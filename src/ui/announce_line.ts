// The HUD's announcement line and what waits for it (ui/hud.ts announce):
// one line at a time, held for its moment. A line said with `keep` holds its
// slot for its whole moment, and what is said meanwhile waits its turn, three
// at most. `clear` lets the line and its queue go at once: a Thornfray's next
// bout (Hud.setBout) starts on an empty line, never on what the last bout said
// last, which a page behind its snapshots says in bulk. Pure, on the caller's
// clock; the HUD draws what it answers.

export interface AnnounceItem {
  text: string;
  color: string;
  holdMs: number;
}

// The most lines that wait behind a kept one.
export const ANNOUNCE_WAITING = 3;

export class AnnounceLine {
  private until = 0;
  private kept = false;
  private readonly waiting: AnnounceItem[] = [];

  // A line said at `now`: the line to draw now, or null when it waits behind
  // a kept one (or is dropped, the queue full).
  say(item: AnnounceItem, keep: boolean, now: number): AnnounceItem | null {
    if (this.kept && !keep && now < this.until) {
      if (this.waiting.length < ANNOUNCE_WAITING) this.waiting.push(item);
      return null;
    }
    this.kept = keep;
    this.until = now + item.holdMs;
    return item;
  }

  // Each frame: once the line's moment is over, the next waiting line to draw,
  // 'hide' when nothing waits, null while the line still holds (or none shows).
  step(now: number): AnnounceItem | 'hide' | null {
    if (this.until === 0 || now <= this.until) return null;
    this.kept = false;
    const next = this.waiting.shift();
    if (next) return this.say(next, false, now);
    this.until = 0;
    return 'hide';
  }

  // The line and everything waiting let go.
  clear(): void {
    this.until = 0;
    this.kept = false;
    this.waiting.length = 0;
  }

  get showing(): boolean {
    return this.until !== 0;
  }

  get queued(): number {
    return this.waiting.length;
  }
}
