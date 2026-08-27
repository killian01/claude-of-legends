// Fullscreen helpers: entering the match takes the whole screen so a
// misclick past the window edge cannot yank focus mid-fight. Browsers only
// grant the request inside a user gesture, which is why the entry points
// are click handlers (lock-in, the escape menu button). Esc always exits
// fullscreen at the browser's discretion; that cannot be prevented.

export function requestGameFullscreen(): void {
  if (document.fullscreenElement) return;
  document.documentElement.requestFullscreen?.().catch(() => undefined);
}

export function toggleGameFullscreen(): void {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => undefined);
  } else {
    requestGameFullscreen();
  }
}
