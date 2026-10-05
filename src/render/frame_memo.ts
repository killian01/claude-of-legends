// A value read from the page at most once a frame. The canvas's place on
// the screen is asked for by every point the battle royale's arrows
// project, by every pick and by the stick, and each ask reads the layout,
// which forces the page to lay itself out again whenever the HUD has
// written since: several layouts a frame on a phone. The renderer forgets
// the value at the start of each frame and on a resize, so the first ask
// after reads it and the rest share it.

export class FrameMemo<T> {
  private known = false;
  private value: T | undefined;

  constructor(private readonly read: () => T) {}

  get(): T {
    if (!this.known) {
      this.value = this.read();
      this.known = true;
    }
    return this.value as T;
  }

  // The next ask reads anew.
  forget(): void {
    this.known = false;
    this.value = undefined;
  }
}
