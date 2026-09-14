// The audience counter's tag (PRIVACY.md, docs/deploy.md): one script
// element in the entry document, present only when the deployment names
// the site it reports to. The page in the repository does not carry it,
// so development, the tests and a self-hosted instance without stats
// serve the page untouched, and tests/privacy.test.ts can hold the page
// to its word.
//
// The script and the endpoint it posts to are paths on this origin, which
// the proxy in front hands to the Umami container beside the game
// (docs/deploy.md, "The audience counter"); the browser never talks to
// another host, and the client's own before-send hook (src/net/stats.ts)
// is named on the tag so the tracker calls it before every record leaves.

import { BEFORE_SEND_NAME } from '../src/net/stats';

export const STATS_SCRIPT = '/visit.js';

// What Umami hands out for a site: a UUID. Anything else is refused rather
// than written into markup, since this is the one value from the
// environment that reaches the page.
export function isWebsiteId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function statsTag(websiteId: string): string {
  return `<script defer src="${STATS_SCRIPT}" data-website-id="${websiteId}" data-before-send="${BEFORE_SEND_NAME}"></script>`;
}

// The document with the tag at the end of its head, or the document as it
// was: with no site named, with a site name that is not an id, or with no
// head to put it in.
export function withStatsTag(html: string, websiteId: string): string {
  if (!isWebsiteId(websiteId)) return html;
  const at = html.search(/<\/head>/i);
  if (at < 0) return html;
  return `${html.slice(0, at)}    ${statsTag(websiteId)}\n  ${html.slice(at)}`;
}
