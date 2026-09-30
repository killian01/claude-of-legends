// The shared chrome of the two full-page screens: the landing page and the
// signed-in home. Both are the same kind of thing, a full-bleed page over
// the art with a bar across the top, so the language lives here once
// rather than being described twice and drifting. The landing keeps a hero
// and a grid of cards under the bar; the home puts its play tiles there
// (ui/home_screen.ts).
//
// The pre-game screens that follow (queue, lobby, champion select) are
// still menu.ts cards: they are transient and they interrupt, which is a
// different job from a page you land on and read.

import { el } from './menu';

export const CSS = `
/* menu.ts scopes its reset to .menu, and a bare .menu-input without one
   draws its padding outside its 100% width and hangs off the card. */
.pg, .pg * { box-sizing: border-box; }
.pg { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden;
  font-family: system-ui, sans-serif; color: #c9d9ee; background: #0a1120; z-index: 10; }
.pg-inner { position: relative; z-index: 2; min-height: 100%; display: flex;
  flex-direction: column; padding: 0 clamp(16px, 5vw, 56px) 40px; }

/* The bar: the brand, the sections, and at the right whatever belongs to
   the person reading. The sections scroll sideways on a phone rather than
   folding into a second component. */
.pg-bar { position: relative; display: flex; align-items: center; gap: 28px;
  padding: 16px 0 0; min-height: 60px; }
.pg-brand {
  font-family: Cinzel, Georgia, 'Times New Roman', serif; font-size: 15px; font-weight: 800;
  letter-spacing: 2.6px; text-transform: uppercase; white-space: nowrap; margin: 0;
  background: linear-gradient(180deg, #f9ecc0 0%, #dcb85e 52%, #9d7429 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.pg-bar-links { display: flex; align-items: center; gap: 24px; flex: 1; min-width: 0;
  overflow-x: auto; scrollbar-width: none; padding: 6px 0; }
.pg-bar-links::-webkit-scrollbar { display: none; }
.pg-bar-right { display: flex; align-items: center; gap: 16px; margin-left: auto; flex: none; }
.pg-bar a, .pg-bar button {
  background: none; border: 0; padding: 0; font: inherit; font-size: 12px; font-weight: 700;
  letter-spacing: 1.3px; text-transform: uppercase; cursor: pointer; color: #8ba1c0;
  text-decoration: none; white-space: nowrap; transition: color 0.15s ease;
}
.pg-bar a:hover, .pg-bar button:hover { color: #dceaff; }
.pg-bar .on { color: #e6d7a8; }
.pg-who { font-size: 12px; letter-spacing: 0.5px; color: #e6d7a8; font-weight: 700; }

/* A section open under the bar (ui/section_host.ts): the section starts
   at the bar's foot and paints over the rest of the page, so the bar
   needs nothing but a scrim and everything below it gets out of the way.
   Deliberately no raised z-index here: a full-screen overlay a section
   opens (the Forge's workshop) then covers the bar too, which is what a
   full-screen overlay should do. */
.pg.home.with-section .pg-inner > *:not(.pg-bar) { display: none; }
.pg.home.with-section .pg-bar {
  padding-bottom: 12px;
  margin: 0 calc(-1 * clamp(16px, 5vw, 56px));
  padding-left: clamp(16px, 5vw, 56px); padding-right: clamp(16px, 5vw, 56px);
  background: rgba(6, 10, 18, 0.93); border-bottom: 1px solid #1f2f4a;
  backdrop-filter: blur(8px);
}
/* A phone: the brand and the person on the first row, the sections on a
   second row that scrolls sideways, so nothing is squeezed out. */
@media (max-width: 720px) {
  .pg-bar { flex-wrap: wrap; gap: 6px 16px; padding-top: 12px; }
  .pg-bar-links { order: 3; flex-basis: 100%; gap: 18px; }
}

.pg-hero { padding: clamp(28px, 7vh, 72px) 0 0; max-width: 720px; }
/* The landing sets its name in art: the lockup, crest over wordmark. It
   stands centered over the copy, the copy centered under it, and the
   whole column centered on the page: the front door is symmetric, and
   the two cards under it are centered to the same axis. Stacked, the
   hero is taller than it was side by side, which is why the lockup is a
   little smaller than it used to be: the top of both cards still shows
   on a laptop, and the page cues the rest with motion. It sits on the
   painted backdrop, so it carries its own shadow to hold the gold's
   edge against whatever the art does behind. */
.pg.land .pg-hero { display: flex; flex-direction: column; align-items: center;
  text-align: center; max-width: none; margin: 0 auto;
  padding-top: clamp(16px, 4vh, 40px); gap: clamp(14px, 2.4vh, 24px); }
.pg-lockup { position: relative; flex: none; margin: 0; width: clamp(170px, 20vw, 240px); }
.pg-lockup img { display: block; width: 100%; height: auto;
  filter: drop-shadow(0 16px 38px rgba(0, 0, 0, 0.62)); }
.pg-hero-copy { min-width: 0; display: flex; flex-direction: column; align-items: center; }
/* First in its column now, so the gap it used to keep from the title is
   the hero's flex gap instead. */
.pg-hero-copy .pg-tag { margin-top: 0; }
/* The row under the tagline: the repository button, and the count beside
   it. One line on a laptop; on a phone the count drops under the button. */
.pg-hero-cta { display: flex; align-items: center; justify-content: center; gap: 22px;
  flex-wrap: wrap; margin-top: 22px; }
.pg-hero-cta .pg-stats { margin: 0; }
/* A phone has no width to spare, so the lockup shrinks. */
@media (max-width: 720px) {
  .pg.land .pg-hero { gap: 16px; }
  .pg-lockup { width: 150px; }
}
.pg-title {
  font-family: Cinzel, Georgia, 'Times New Roman', serif;
  font-size: clamp(38px, 7vw, 78px); line-height: 1.02; letter-spacing: 3px;
  text-transform: uppercase; margin: 0;
  background: linear-gradient(180deg, #f9ecc0 0%, #dcb85e 52%, #9d7429 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  text-shadow: 0 6px 40px rgba(0, 0, 0, 0.55);
}
.pg-tag { font-size: clamp(14px, 1.6vw, 17px); line-height: 1.55; color: #b9cbe4;
  margin: 16px 0 0; max-width: 52ch; text-shadow: 0 2px 12px rgba(0, 0, 0, 0.8); }

.pg-stats { display: flex; gap: 26px; margin: 22px 0 0; flex-wrap: wrap; }
.pg-stat { display: flex; align-items: baseline; gap: 7px; font-size: 12px; color: #8ba1c0; }
.pg-stat b { font-size: 19px; font-weight: 800; color: #e6d7a8; font-variant-numeric: tabular-nums; }

/* 300px floors two columns at about the width the old single card had, so
   a panel that opens inside one keeps its room. */
.pg-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 18px; margin: clamp(26px, 5vh, 52px) 0 0; max-width: 900px; align-items: start; }
.pg-card {
  background: rgba(8, 12, 22, 0.86); backdrop-filter: blur(7px);
  border: 1px solid #2b3f60; border-radius: 14px; padding: 20px 22px 22px;
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.55); display: flex; flex-direction: column;
}
.pg-card.gold { border-color: #6b5a2e; }
.pg-card h2 { font-family: Cinzel, Georgia, serif; font-size: 17px; letter-spacing: 1.6px;
  text-transform: uppercase; margin: 0 0 6px; color: #e6d7a8; }
.pg-card.plain h2 { color: #9fb4d2; }
.pg-card p { font-size: 12.5px; line-height: 1.55; color: #93a8c4; margin: 0 0 14px; }
`;

let cssInstalled = false;
export function ensurePageCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

export interface PublicStats {
  online: number;
  matches: number;
  accounts: number;
}

// The one endpoint outside the account wall (ADR 0006). Counts only, so a
// failure is not worth reporting: the row simply stays empty.
export async function fetchStats(): Promise<PublicStats | null> {
  try {
    const res = await fetch('/api/public/stats', { credentials: 'same-origin' });
    if (!res.ok) return null;
    return (await res.json()) as PublicStats;
  } catch {
    return null;
  }
}

// The count, as one cell. Players online and matches running used to
// stand beside it and they were the wrong two numbers to show at this
// stage: a young server is empty most of the hour, so both read zero and
// the honest live counter announced a dead game to the one visitor who
// might have filled it. Accounts only ever grows, and it is the count
// that says what this is: people came and stayed. Nothing is padded;
// /api/public/stats is still the whole truth, and the bar's Live pill
// still reads the running matches straight off it.
export function renderStats(into: HTMLElement, s: PublicStats): void {
  const box = el('div', 'pg-stat');
  box.append(
    el('b', '', String(s.accounts)),
    el('span', '', s.accounts === 1 ? 'account' : 'accounts'),
  );
  into.appendChild(box);
}

// Fills `into` once the server answers.
export function mountLiveStats(into: HTMLElement): void {
  void fetchStats().then((s) => {
    if (!s || !into.isConnected) return;
    renderStats(into, s);
  });
}

export interface Bar {
  root: HTMLElement;
  // The wordmark, which the home turns into the way back to its tiles.
  brand: HTMLElement;
  // The sections, left of center, and the person's own things at the right.
  links: HTMLElement;
  right: HTMLElement;
}

export interface Page {
  root: HTMLElement;
  inner: HTMLElement;
  bar: Bar;
  // Only the landing page shows one; the home goes straight to its tiles.
  hero: HTMLElement;
}

// A full-page screen over the art: `variant` distinguishes them in the DOM
// (.pg.land, .pg.home), which is what the e2e scripts key on.
export function buildPage(variant: string, withHero: boolean): Page {
  ensurePageCss();
  const root = el('div', `pg ${variant}`);
  const inner = el('div', 'pg-inner');
  const bar = el('nav', 'pg-bar');
  const brand = el('div', 'pg-brand', 'Claude of Legends');
  const links = el('div', 'pg-bar-links');
  const right = el('div', 'pg-bar-right');
  bar.append(brand, links, right);
  const hero = el('section', 'pg-hero');
  inner.appendChild(bar);
  if (withHero) inner.appendChild(hero);
  root.appendChild(inner);
  return { root, inner, bar: { root: bar, brand, links, right }, hero };
}

// A nav entry that goes somewhere else entirely; opened in a new tab, so
// nothing in flight on this page is lost.
export function navLink(text: string, href: string): HTMLAnchorElement {
  const a = el('a', '', text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noreferrer';
  return a;
}
