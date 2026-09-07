// Sections below the fold arrive when scrolled to, not on page load: an
// entrance nobody saw is an entrance wasted, and the contribution band
// is a whole screen down. The marked elements start hidden by CSS and get
// `in` the first time they cross into view; a browser with no
// IntersectionObserver gets them shown at once, which is the right
// fallback for a decoration.

export const REVEAL_CLASS = 'land-reveal';
export const REVEAL_IN = 'in';

// `scroller` is the element that scrolls, which on the landing is the page
// itself rather than the window. Returns the teardown.
export function revealOnScroll(scroller: HTMLElement, targets: Element[]): () => void {
  for (const t of targets) t.classList.add(REVEAL_CLASS);
  if (typeof IntersectionObserver === 'undefined') {
    for (const t of targets) t.classList.add(REVEAL_IN);
    return () => {};
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add(REVEAL_IN);
        io.unobserve(entry.target);
      }
    },
    { root: scroller, threshold: 0.12 },
  );
  for (const t of targets) io.observe(t);
  return () => io.disconnect();
}
