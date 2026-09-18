// The News section (CONTEXT.md: News): the entries of src/ui/news_entries.ts
// in the order src/ui/news.ts gives them, one column, an image over each
// title. Opened under the home's bar like the other sections, and over the
// landing for a visitor with no account. Reads no request: the table
// ships with the build, and the build reloads every open tab.

import { el } from './menu';
import { allNews, countdownText, dayText, isPinned, orderNews } from './news';
import type { NewsDestination, NewsEntry } from './news_entries';
import { newsImageUrl } from './news_images';

const CSS = `
.nw, .nw * { box-sizing: border-box; }
.nw {
  position: absolute; inset: 0; z-index: 30; overflow-y: auto;
  background: radial-gradient(ellipse at center, #1a2240 0%, #0a0d20 75%);
  font-family: system-ui, sans-serif; color: #c9d9ee;
}
.nw-inner { max-width: 760px; margin: 0 auto; padding: 22px 20px 48px; }
.nw-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
.nw-title { font-size: 30px; font-weight: 800; letter-spacing: 1px; margin: 0; }
.nw-sub { font-size: 13px; color: #7e93b2; }
.nw-back {
  margin-left: auto; padding: 8px 16px; border-radius: 6px; border: 1px solid #2e4468;
  background: #142038; color: #c9d9ee; font-size: 13px; font-weight: 600; cursor: pointer;
}
.nw-back:hover { border-color: #5b84c9; }
.nw-entry {
  background: #0f1730; border: 1px solid #22345a; border-radius: 10px; overflow: hidden;
  margin-bottom: 18px;
}
.nw-entry.pinned { border-color: #d8b45a; }
.nw-entry img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; }
.nw-body { padding: 16px 20px 18px; }
.nw-when { font-size: 12px; color: #8ea4c4; letter-spacing: 0.6px; text-transform: uppercase; }
.nw-when b { color: #e8dfae; font-weight: 700; }
.nw-entry h2 { margin: 6px 0 10px; font-size: 21px; font-weight: 800; color: #fff; }
.nw-entry p { margin: 0 0 10px; font-size: 14.5px; line-height: 1.55; color: #c9d9ee; }
.nw-link {
  margin-top: 4px; padding: 7px 14px; border-radius: 6px; border: 1px solid #d8b45a;
  background: #2c2410; color: #e8dfae; font-size: 13px; font-weight: 700; cursor: pointer;
}
.nw-link:hover { filter: brightness(1.15); }
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
  container.appendChild(root);

  const close = (): void => {
    window.removeEventListener('keydown', onKey);
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
