// Where a visitor came from, reduced to one word off a fixed list.
//
// This is the dimension that decides what to do next and the counters had
// none of it: a day with three visitors reads the same whether the
// announcement reached nobody or reached people the front page then lost,
// and those two have opposite cures. The referrer is the only thing that
// tells them apart, and a browser is the only party that knows it, since
// the ping the server sees is same-origin by then.
//
// What is sent is a word from the list below and never a URL. Not a
// truncated one, not a host, not a path: the browser looks at its own
// referrer, decides which of nine buckets it falls in, and sends the name
// of the bucket. A private page that linked here contributes "other" and
// nothing else, which is the whole of what a counter needs to know.
//
// Both sides import this file. The server validates what arrives against
// the same list (server/main.ts), because a query is a thing a client can
// forge and an unrecognised word must not be able to write a new row.

export const VISIT_SOURCES = [
  // No referrer at all: typed, bookmarked, or a link from an app that
  // strips it. A large "direct" is not an absence of news; it is what a
  // chat client that sends no referrer looks like.
  'direct',
  'search',
  'discord',
  'reddit',
  'hn',
  'x',
  'youtube',
  'github',
  // An external site that is none of the above. Worth watching: a day
  // where this leads is a day somebody wrote about the game somewhere the
  // list has never heard of.
  'other',
] as const;

export type VisitSource = (typeof VISIT_SOURCES)[number];

// The hosts each bucket answers for, matched on the host itself or on any
// subdomain of it. Deliberately short: a list that tries to name every
// search engine on earth is a list nobody maintains, and everything it
// misses lands in "other", which is a bucket that is read rather than
// ignored.
const HOSTS: ReadonlyArray<readonly [VisitSource, readonly string[]]> = [
  [
    'search',
    [
      'google.com',
      'google.co.uk',
      'google.fr',
      'bing.com',
      'duckduckgo.com',
      'ecosia.org',
      'qwant.com',
      'search.brave.com',
      'startpage.com',
      'yahoo.com',
      'yandex.com',
      'baidu.com',
    ],
  ],
  ['discord', ['discord.com', 'discordapp.com', 'discord.gg']],
  ['reddit', ['reddit.com', 'redd.it']],
  ['hn', ['news.ycombinator.com', 'hckrnews.com']],
  ['x', ['x.com', 'twitter.com', 't.co']],
  ['youtube', ['youtube.com', 'youtu.be']],
  ['github', ['github.com', 'github.io', 'raw.githubusercontent.com']],
];

// Whether a word off the wire is one of ours. Everything else is refused
// by the caller rather than counted as itself.
export function isVisitSource(value: string): value is VisitSource {
  return (VISIT_SOURCES as readonly string[]).includes(value);
}

// The bucket a referrer falls in, given the page's own origin. A referrer
// from this site is the same as none: a visitor arriving on their first
// load of the day from another page here is still not news from outside.
export function sourceOf(referrer: string, origin: string): VisitSource {
  if (referrer === '') return 'direct';
  let host: string;
  try {
    const url = new URL(referrer);
    if (url.origin === origin) return 'direct';
    host = url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    // Not a URL at all. Nothing to read, and inventing a bucket for a
    // shape we cannot parse would be inventing a number.
    return 'other';
  }
  for (const [source, hosts] of HOSTS) {
    for (const known of hosts) {
      if (host === known || host.endsWith(`.${known}`)) return source;
    }
  }
  return 'other';
}
