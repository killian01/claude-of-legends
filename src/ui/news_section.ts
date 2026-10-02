// The News section (CONTEXT.md: News): the entries of src/ui/news_entries.ts
// in the order src/ui/news.ts gives them, one column, an image over each
// title. Opened under the home's bar like the other sections, and over the
// landing for a visitor with no account. Reads no request: the table
// ships with the build, and the build reloads every open tab.

import { startBackdrop } from './home_backdrop';
import { el } from './menu';
import { allNews, countdownText, dayText, isPinned, orderNews } from './news';
import type { NewsDestination, NewsEntry } from './news_entries';
import { newsImageUrl } from './news_images';

// The landing's own dress (ui/page.ts, ui/landing.ts): the painted
// backdrop behind it (ui/home_backdrop.ts), dark cards edged in gold, the
// names in Cinzel gold. It used to be a plain navy sheet in the system
// font, which read as another site opened over this one (the maintainer,
// 2026-10-02).
const CSS = `
.nw, .nw * { box-sizing: border-box; }
.nw {
  position: absolute; inset: 0; z-index: 30; overflow-y: auto; background: #0a1120;
  font-family: system-ui, sans-serif; color: #c9d6ea;
}
.nw-inner { position: relative; z-index: 1; max-width: 760px; margin: 0 auto;
  padding: 26px 20px 56px; }
.nw-head { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 20px; }
.nw-title { margin: 0; font-family: Cinzel, Georgia, 'Times New Roman', serif; font-size: 30px;
  font-weight: 700; letter-spacing: 2.4px; text-transform: uppercase; color: #f0dca0;
  text-shadow: 0 2px 14px rgba(0, 0, 0, 0.85); }
.nw-sub { font-size: 13px; color: #9db2cf; text-shadow: 0 1px 8px rgba(0, 0, 0, 0.8); }
.nw-back {
  margin-left: auto; padding: 8px 18px; border-radius: 999px; cursor: pointer;
  border: 1px solid rgba(230, 215, 168, 0.6); background: rgba(8, 12, 22, 0.6); color: #e6d7a8;
  font-size: 12px; font-weight: 800; letter-spacing: 1.3px; text-transform: uppercase;
  transition: background 0.15s ease, color 0.15s ease;
}
.nw-back:hover { background: rgba(38, 30, 12, 0.7); color: #f6e4aa; }
.nw-entry {
  margin-bottom: 20px; overflow: hidden; border-radius: 14px;
  border: 1px solid #6b5a2e; background: rgba(6, 10, 20, 0.82);
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.5), 0 0 34px rgba(232, 196, 108, 0.08);
}
.nw-entry.pinned { border-color: #e8c46c;
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.5), 0 0 44px rgba(232, 196, 108, 0.28); }
.nw-entry img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover;
  border-bottom: 1px solid #6b5a2e; }
.nw-body { padding: 18px 22px 20px; }
.nw-when { font-size: 11.5px; font-weight: 700; color: #c9a84a; letter-spacing: 1.2px;
  text-transform: uppercase; }
.nw-when b { color: #f0dca0; }
.nw-entry h2 { margin: 6px 0 12px; font-family: Cinzel, Georgia, 'Times New Roman', serif;
  font-size: 21px; font-weight: 700; letter-spacing: 0.8px; color: #f0dca0; }
.nw-entry p { margin: 0 0 10px; font-size: 14.5px; line-height: 1.6; color: #c9d6ea; }
.nw-link {
  margin-top: 6px; padding: 9px 22px; border-radius: 6px; cursor: pointer;
  border: 1px solid #f0deae; color: #241a08; font-size: 13.5px; font-weight: 800;
  letter-spacing: 0.5px; text-shadow: 0 1px 0 rgba(255, 255, 255, 0.25);
  background: linear-gradient(180deg, #e8cc74 0%, #c9a84a 55%, #a07830 100%);
  transition: box-shadow 0.15s ease, transform 0.15s ease;
}
.nw-link:hover { box-shadow: 0 0 18px rgba(216, 180, 90, 0.45); transform: translateY(-1px); }
@media (max-width: 560px) {
  .nw-inner { padding: 18px 14px 44px; }
  .nw-title { font-size: 24px; letter-spacing: 1.8px; }
  .nw-body { padding: 14px 16px 16px; }
  .nw-entry h2 { font-size: 18px; }
  .nw-entry p { font-size: 14px; }
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

export interface NewsOptions {
  // A link pressed: the page that opened the section knows where its
  // tiles and sections are.
  onLink?: (to: NewsDestination) => void;
  // The section closed itself through its Back: the page that opened it
  // over something else tells the nav.
  onClosed?: () => void;
  now?: () => number;
}

// An event's time, as the reader's browser tells it.
function eventTime(at: string): string {
  return new Date(at).toLocaleString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildEntry(e: NewsEntry, now: number, o: NewsOptions): HTMLElement {
  const pinned = isPinned(e, now);
  const card = el('article', `nw-entry${pinned ? ' pinned' : ''}`);
  const src = e.image ? newsImageUrl(e.image) : null;
  if (src) {
    const img = el('img', '');
    img.src = src;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    card.appendChild(img);
  }
  const body = el('div', 'nw-body');
  const when = el('div', 'nw-when');
  if (pinned && e.at !== undefined) {
    when.append(
      el('b', '', eventTime(e.at)),
      document.createTextNode(`, ${countdownText(e.at, now)}`),
    );
  } else {
    when.textContent = dayText(e.day);
  }
  body.append(when, el('h2', '', e.title));
  for (const p of e.body) body.appendChild(el('p', '', p));
  if (e.link && o.onLink) {
    const to = e.link.to;
    const b = el('button', 'nw-link', e.link.label);
    b.type = 'button';
    b.addEventListener('click', () => o.onLink?.(to));
    body.appendChild(b);
  }
  card.appendChild(body);
  return card;
}

export function openNews(container: HTMLElement, o: NewsOptions = {}): () => void {
  ensureCss();
  const now = (o.now ?? Date.now)();
  const root = el('div', 'nw');
  const inner = el('div', 'nw-inner');
  const head = el('div', 'nw-head');
  const back = el('button', 'nw-back', 'Back');
  back.type = 'button';
  head.append(
    el('h1', 'nw-title', 'News'),
    el('span', 'nw-sub', 'What changed on the server'),
    back,
  );
  inner.appendChild(head);
  for (const e of orderNews(allNews(), now)) inner.appendChild(buildEntry(e, now, o));
  root.appendChild(inner);
  const stopBackdrop = startBackdrop(root, inner);
  container.appendChild(root);

  const close = (): void => {
    window.removeEventListener('keydown', onKey);
    stopBackdrop();
    root.remove();
  };
  const leave = (): void => {
    close();
    o.onClosed?.();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') leave();
  };
  window.addEventListener('keydown', onKey);
  back.addEventListener('click', leave);
  return close;
}
