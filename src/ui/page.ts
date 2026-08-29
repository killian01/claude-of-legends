// The shared chrome of the two full-page screens: the landing page and the
// signed-in home. Both are the same kind of thing, a full-bleed page over
// the art with a nav, a hero and a grid of cards, so the language lives
// here once rather than being described twice and drifting.
//
// The pre-game screens that follow (queue, lobby, champion select) are
// still menu.ts cards: they are transient and they interrupt, which is a
// different job from a page you land on and read.

import { el } from './menu';

export const REPO = 'https://github.com/killian01/claude-of-legends';

export const CSS = `
/* menu.ts scopes its reset to .menu, and a bare .menu-input without one
   draws its padding outside its 100% width and hangs off the card. */
.pg, .pg * { box-sizing: border-box; }
.pg { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden;
  font-family: system-ui, sans-serif; color: #c9d9ee; background: #0a1120; z-index: 10; }
.pg-inner { position: relative; z-index: 2; min-height: 100%; display: flex;
  flex-direction: column; padding: 0 clamp(16px, 5vw, 56px) 40px; }

/* Nothing pushes the links over: the wordmark used to sit here and the
   hero says the same thing one line lower, so the nav is right-aligned. */
.pg-nav { display: flex; align-items: baseline; justify-content: flex-end; gap: 18px;
  padding: 20px 0 0; flex-wrap: wrap; }
.pg-nav a, .pg-nav button {
  background: none; border: 0; padding: 0; font: inherit; font-size: 12px; cursor: pointer;
  color: #8ba1c0; text-decoration: none; letter-spacing: 0.5px;
}
.pg-nav a:hover, .pg-nav button:hover { color: #dceaff; }
.pg-who { font-size: 12px; letter-spacing: 0.5px; color: #e6d7a8; font-weight: 700; }

.pg-hero { padding: clamp(28px, 7vh, 72px) 0 0; max-width: 720px; }
.pg-title {
  font-family: Cinzel, Georgia, 'Times New Roman', serif;
  font-size: clamp(38px, 7vw, 78px); line-height: 1.02; letter-spacing: 3px;
  text-transform: uppercase; margin: 0;
  background: linear-gradient(180deg, #f9ecc0 0%, #dcb85e 52%, #9d7429 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  text-shadow: 0 6px 40px rgba(0, 0, 0, 0.55);
}
.pg-tag { font-size: clamp(14px, 1.6vw, 17px); line-height: 1.55; color: #b9cbe4;
  margin: 16px 0 0; max-width: 56ch; text-shadow: 0 2px 12px rgba(0, 0, 0, 0.8); }

.pg-stats { display: flex; gap: 26px; margin: 22px 0 0; flex-wrap: wrap; }
.pg-stat { display: flex; align-items: baseline; gap: 7px; font-size: 12px; color: #8ba1c0; }
.pg-stat b { font-size: 19px; font-weight: 800; color: #e6d7a8; font-variant-numeric: tabular-nums; }
.pg-live::before {
  content: ''; width: 7px; height: 7px; border-radius: 50%; background: #6ad07a;
  display: inline-block; margin-right: 7px; box-shadow: 0 0 8px #6ad07a;
}

/* 300px floors two columns at about the width the old single card had, so
   the career and ladder panels that open inside one keep their room. */
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

// Fills `into` once the server answers, and only with what it has to
// report. A hard zero beside a green live dot advertises an empty server,
// which reads worse than saying nothing at all.
export function mountLiveStats(into: HTMLElement): void {
  void fetchStats().then((s) => {
    if (!s || !into.isConnected) return;
    const cell = (value: number, label: string, live = false): void => {
      if (value <= 0) return;
      const box = el('div', live ? 'pg-stat pg-live' : 'pg-stat');
      box.append(el('b', '', String(value)), el('span', '', label));
      into.appendChild(box);
    };
    cell(s.online, s.online === 1 ? 'player online' : 'players online', true);
    cell(s.matches, s.matches === 1 ? 'match running' : 'matches running');
    cell(s.accounts, s.accounts === 1 ? 'account' : 'accounts');
  });
}

export interface Page {
  root: HTMLElement;
  inner: HTMLElement;
  nav: HTMLElement;
  hero: HTMLElement;
}

// A full-page screen over the art: `variant` distinguishes them in the DOM
// (.pg.land, .pg.home), which is what the e2e scripts key on.
export function buildPage(variant: string): Page {
  ensurePageCss();
  const root = el('div', `pg ${variant}`);
  const inner = el('div', 'pg-inner');
  const nav = el('nav', 'pg-nav');
  const hero = el('section', 'pg-hero');
  inner.append(nav, hero);
  root.appendChild(inner);
  return { root, inner, nav, hero };
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
