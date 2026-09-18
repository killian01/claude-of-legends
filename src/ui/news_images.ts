// The news' pictures (CONTEXT.md: News), as assets of the build. Imported
// here so they ship under /assets/ with a hash in the name and the same
// year of immutable cache as every bundle, and a picture that changes
// gets a new name the moment it is deployed. Under public/ a picture kept
// its name, and the proxy in front hands a browser four hours of cache on
// any image whatever the server says: a news whose picture was replaced
// showed the old one for an afternoon.

const urls = import.meta.glob('./news_art/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const PREFIX = './news_art/';

// The address of a picture named in an entry, or null for a name the
// build does not carry (tests/news.test.ts refuses such an entry).
export function newsImageUrl(file: string): string | null {
  return urls[`${PREFIX}${file}`] ?? null;
}

export function newsImageFiles(): readonly string[] {
  return Object.keys(urls).map((k) => k.slice(PREFIX.length));
}
