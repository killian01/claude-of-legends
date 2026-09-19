// Fullscreen helpers: entering the match takes the whole screen so a
// misclick past the window edge cannot yank focus mid-fight. Browsers only
// grant the request inside a user gesture, which is why the entry points
// are click handlers (lock-in, the escape menu button). Esc always exits
// fullscreen at the browser's discretion; that cannot be prevented.

// Resolves once the request has been answered, so a caller that wants the
// screen turned as well (game/orientation.ts) can ask the moment the
// document is fullscreen, which is the only state a lock is granted in.
export function requestGameFullscreen(): Promise<void> {
  if (document.fullscreenElement) return Promise.resolve();
  return document.documentElement.requestFullscreen?.().catch(() => undefined) ?? Promise.resolve();
}

export function toggleGameFullscreen(): void {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => undefined);
  } else {
    requestGameFullscreen();
  }
}
