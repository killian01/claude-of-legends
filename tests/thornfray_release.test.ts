// The Thornfray opened to players (ADR 0035; docs/plan-thornfray.md slice
// 7): its first two kinds released, so a server's pool holds them by
// itself; its doors on the landing (tests/landing_modes.test.ts,
// tests/guest_route.test.ts) and on the home; the News that announces it;
// ADR 0031 pointing to the record.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { thornfrayPool } from '../server/thornfray_pool';
import { BOUT_KINDS, boutPool } from '../src/sim/content/bouts';
import { newestOf } from '../src/ui/news';
import { NEWS } from '../src/ui/news_entries';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

describe('the release', () => {
  it('opens the mode on Lastwick and Starglean, with no knob set', () => {
    expect(boutPool().map((k) => k.id)).toEqual(['lastwick', 'starglean']);
    expect(thornfrayPool({}).map((k) => k.id)).toEqual(['lastwick', 'starglean']);
    expect(BOUT_KINDS.every((k) => k.released)).toBe(true);
  });

  it('offers it on the home, beside the battle royale', () => {
    const tiles = read('src/ui/royale_tiles.ts');
    expect(tiles).toContain("thornfray.dataset.royale = 'thornfray';");
    expect(tiles).toContain("thornfray.addEventListener('click', () => onPick('thornfray'));");
    const home = read('src/ui/home_screen.ts');
    expect(home).toContain("? { name: accountName, mode: 'thornfray' }");
  });

  it('is pointed to from the battle royale record', () => {
    const adr = read('docs/adr/0031-battle-royale-on-the-wanderseed.md');
    expect(adr).toMatch(/^## Amended: Thornfray \(2026-10-20\)$/m);
    expect(adr.slice(adr.indexOf('## Amended: Thornfray'))).toContain('ADR 0035');
  });
});

describe('the news of the Thornfray', () => {
  const entry = NEWS.find((e) => e.title.startsWith('Thornfray'));

  it('is the newest entry on its day, so the landing shows it', () => {
    expect(entry).toBeDefined();
    const byThen = NEWS.filter((e) => e.day <= (entry?.day ?? ''));
    expect(newestOf(byThen, Date.parse(`${entry?.day}T12:00:00Z`))).toBe(entry);
    expect(entry?.image).toBe('thornfray.webp');
    expect(entry?.link?.to).toBe('play');
  });

  it('says what a Thornfray is, its two bouts and where to press', () => {
    const text = (entry?.body ?? []).join(' ');
    for (const word of [
      'Eight champions',
      'Thornyard',
      'bushels',
      'the Final',
      'Lastwick',
      'Starglean',
      'Graft',
      'House bots',
      'front page',
    ]) {
      expect(`${word}: ${text.includes(word)}`).toBe(`${word}: true`);
    }
    // The bushels by place and the Final's double, as the ledger pays them.
    expect(text).toMatch(/five to the first down to none for the last three/);
    expect(text).toMatch(/every place pays double/);
  });
});
