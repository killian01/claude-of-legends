// The card a link to the site turns into when it is posted anywhere.
//
// Nobody sees this by playing, which is exactly why it needs a gate: the
// tags are only ever read by a scraper, so a broken one is invisible here
// and visible to every person the link is shared with. The site went a
// year with none of them at all, and every link to it rendered as a grey
// box with one word in it.

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// The one sentence the site says about itself. It is written twice, in the
// page a scraper reads and in the page a person reads, and the two must be
// the same sentence: a description that has drifted from the landing is a
// promise the page does not keep.
const PITCH =
  'A 5v5 MOBA that runs in a browser tab. Three lanes, ten champions, ' +
  'jungle camps and fog of war. Nothing to install.';

// The value of a meta tag, whichever attribute names it and however the
// formatter has wrapped the line.
function meta(name: string): string | null {
  const re = new RegExp(
    `<meta[^>]*(?:name|property)=["']${name}["'][^>]*?content=["']([^"']*)["']` +
      `|<meta[^>]*content=["']([^"']*)["'][^>]*?(?:name|property)=["']${name}["']`,
    's',
  );
  const m = re.exec(HTML);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

describe('the link preview', () => {
  it('carries every tag a scraper looks for', () => {
    for (const tag of [
      'description',
      'og:type',
      'og:site_name',
      'og:title',
      'og:description',
      'og:url',
      'og:image',
      'twitter:card',
      'twitter:title',
      'twitter:description',
      'twitter:image',
    ]) {
      expect(`${tag}: ${meta(tag) !== null}`).toBe(`${tag}: true`);
    }
  });

  it('says the same thing the landing page says', () => {
    // ui/landing.ts draws this sentence for the reader; here it is for
    // everyone who has not clicked yet.
    const landing = readFileSync(path.join(ROOT, 'src/ui/landing.ts'), 'utf8');
    const oneLine = landing.replace(/'\s*\+\s*\n\s*'/g, '');
    expect(oneLine).toContain(PITCH);
    expect(meta('description')).toBe(PITCH);
    expect(meta('og:description')).toBe(PITCH);
    expect(meta('twitter:description')).toBe(PITCH);
  });

  it('asks for the wide card, not the thumbnail', () => {
    // The default is a small square beside the text, which wastes the
    // only picture anybody sees before deciding whether to click.
    expect(meta('twitter:card')).toBe('summary_large_image');
  });

  it('points both images at one file that is really there', () => {
    const image = meta('og:image') ?? '';
    expect(meta('twitter:image')).toBe(image);
    // Absolute, because a scraper has no page to resolve a relative URL
    // against, and on the same origin as the page it describes.
    const url = new URL(meta('og:url') ?? '');
    expect(image.startsWith(url.origin)).toBe(true);
    const file = path.join(ROOT, 'public', new URL(image).pathname);
    const stat = statSync(file);
    expect(stat.isFile()).toBe(true);
    // Twitter refuses over 5MB and a card nobody waits for is a card
    // nobody sees; the composed one is about 150KB.
    expect(stat.size).toBeLessThan(1_000_000);
  });

  it('declares the size the image actually is', () => {
    // A declared size that lies makes a scraper crop or skip it, and the
    // 1200 by 630 is what every platform expects of a wide card.
    const file = path.join(ROOT, 'public', new URL(meta('og:image') ?? '').pathname);
    const { width, height } = jpegSize(readFileSync(file));
    expect(width).toBe(1200);
    expect(height).toBe(630);
    expect(meta('og:image:width')).toBe(String(width));
    expect(meta('og:image:height')).toBe(String(height));
  });
});

// The frame size out of a JPEG, read from its start-of-frame marker. Small
// enough to write here and worth more than trusting two numbers typed into
// the markup by hand.
function jpegSize(buf: Buffer): { width: number; height: number } {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new Error('not a jpeg segment');
    const marker = buf[i + 1] ?? 0;
    const length = buf.readUInt16BE(i + 2);
    // Any start-of-frame but the ones that carry no size (0xc4, 0xc8, 0xcc).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  throw new Error('no frame in jpeg');
}
