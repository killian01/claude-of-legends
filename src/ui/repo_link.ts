// The repository, as a button rather than a word. "Source" in the bar
// named a place in twelve pixels of grey and asked nothing, on a page
// whose one claim the genre cannot make is that the whole game is open.
// So the link to it is gold, carries a mark, and shows up in the three
// places a visitor looks: the bar, under the tagline, and at the head of
// the contribution band. One builder, three sizes, so they cannot drift.
//
// The mark is a plain star drawn here, not a third party's logo (ADR
// 0004): it says "star this" without borrowing anyone's emblem.

import { REPO } from './links';
import { el } from './menu';

export type RepoLinkSize = 'pill' | 'hero' | 'wide';

const CSS = `
.repo-link { position: relative; display: inline-flex; align-items: center; gap: 9px;
  overflow: hidden; border-radius: 999px; text-decoration: none; white-space: nowrap;
  font-family: system-ui, sans-serif; font-weight: 800; letter-spacing: 1.3px;
  text-transform: uppercase; color: #1a1305; cursor: pointer; isolation: isolate;
  background: linear-gradient(180deg, #f6e4aa 0%, #dcb85e 52%, #b1873a 100%);
  box-shadow: 0 0 0 1px rgba(255, 234, 170, 0.45), 0 8px 22px rgba(0, 0, 0, 0.45),
    0 0 26px rgba(220, 184, 94, 0.28);
  transition: transform 0.22s ease, box-shadow 0.22s ease, filter 0.22s ease; }
.repo-link:hover, .repo-link:focus-visible { color: #1a1305; transform: translateY(-2px);
  filter: brightness(1.06);
  box-shadow: 0 0 0 1px rgba(255, 240, 190, 0.7), 0 14px 30px rgba(0, 0, 0, 0.5),
    0 0 44px rgba(232, 196, 108, 0.55); }
.repo-link:active { transform: translateY(0); }
.repo-link svg { width: 1.15em; height: 1.15em; flex: none; fill: currentColor;
  filter: drop-shadow(0 1px 0 rgba(255, 255, 255, 0.35)); }
/* A sheen that crosses the button every few seconds: the one moving thing
   in the bar, which is what makes the eye land on it. */
.repo-link::after { content: ''; position: absolute; inset: -40% -60%; z-index: 1;
  pointer-events: none; transform: translateX(-70%) skewX(-18deg);
  background: linear-gradient(90deg, transparent 38%, rgba(255, 255, 255, 0.55) 50%,
    transparent 62%);
  animation: repo-sheen 5.2s ease-in-out 1.4s infinite; }
@keyframes repo-sheen {
  0%, 62% { transform: translateX(-70%) skewX(-18deg); }
  100% { transform: translateX(70%) skewX(-18deg); }
}
.repo-link.pill { padding: 7px 14px 7px 11px; font-size: 11px; }
.repo-link.hero { padding: 13px 24px 13px 19px; font-size: 13px; letter-spacing: 1.6px; }
.repo-link.wide { padding: 12px 24px 12px 19px; font-size: 12.5px; letter-spacing: 1.5px; }
@media (prefers-reduced-motion: reduce) {
  .repo-link::after { animation: none; }
  .repo-link { transition: none; }
}
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

// The star, drawn once. An SVG namespace element cannot come from el().
function starMark(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute(
    'd',
    'M12 2.4l2.95 6.2 6.75.85-4.95 4.7 1.3 6.75L12 17.6l-6.05 3.3 1.3-6.75-4.95-4.7 6.75-.85z',
  );
  svg.appendChild(path);
  return svg;
}

// `text` is what the button says, in the imperative where there is room
// for a verb: the bar has room for the name and nothing else.
export function buildRepoLink(size: RepoLinkSize, text: string): HTMLAnchorElement {
  ensureCss();
  const a = el('a', `repo-link ${size}`);
  a.href = REPO;
  a.target = '_blank';
  a.rel = 'noreferrer';
  a.append(starMark(), el('span', '', text));
  return a;
}
