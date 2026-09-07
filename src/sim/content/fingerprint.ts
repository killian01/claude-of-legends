// What the sim's outcome depends on, in one string.
//
// A replay is a RE-SIMULATION: the record keeps a seed, the picks and the
// commands, and the viewer rebuilds the match by running the same sim
// again (src/net/replay.ts). That is exact while the sim and the content
// it reads are the ones that played, and silently wrong the moment they
// are not: change a champion's damage, an item's price or a house bot's
// playbook, and yesterday's replay plays out a match that never happened,
// with no error anywhere. REPLAY_VERSION is the hand-bumped guard against
// that, and a hand-bumped guard is one somebody forgets.
//
// So the record also carries a fingerprint of the content, computed from
// the tables themselves. A balance change moves it without anybody
// remembering to, and the viewer says "recorded under an older version"
// instead of playing a different match.
//
// It covers what DECIDES a match, not what dresses it: champions, items,
// sigils, the map, the house bots and the tick rate. Skins, sounds,
// names and flavor lines move freely.

import { DT } from '../types';
import { BOTS } from './bots';
import { CHAMPION_LIST } from './champions';
import { ITEM_LIST } from './items';
import { GAME_MAP } from './map';
import { SIGIL_LIST } from './sigils';

// FNV-1a over the canonical text: short, stable, and dependency-free. It
// is a change detector, never a signature: nothing here defends against
// an attacker, only against our own forgetfulness.
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// JSON with object keys in a fixed order, so the same content always
// writes the same text whatever order the tables were built in.
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && typeof v !== 'function')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

// The champion as the sim reads it: its body, its growth and its four
// spells plus the passive. Its name, title and art are not in it.
function championShape(c: (typeof CHAMPION_LIST)[number]): unknown {
  return {
    id: c.id,
    role: c.role,
    base: c.base,
    growth: c.growth,
    abilities: c.abilities,
    passive: (c as { passive?: unknown }).passive ?? null,
  };
}

// The fingerprint of any content-shaped value: canonical text, then the
// hash. Exported so a test can prove that a table it changes moves it,
// which is the only property that matters here.
export function fingerprintOf(content: unknown): string {
  return hash(canonical(content));
}

let cached: string | null = null;

export function contentFingerprint(): string {
  if (cached === null) {
    cached = fingerprintOf({
      dt: DT,
      champions: CHAMPION_LIST.map(championShape),
      items: ITEM_LIST,
      sigils: SIGIL_LIST,
      map: GAME_MAP,
      // The house bots by what they DO: a policy is code, so the ids
      // and their playbooks are the most a table can say about them.
      bots: Object.entries(BOTS)
        .map(([id, b]) => [id, (b as { playbook?: unknown }).playbook ?? null])
        .sort(),
    });
  }
  return cached;
}

// A record plays out as it was recorded only if BOTH guards agree: the
// hand-bumped version (a change in the sim's own code) and the content
// fingerprint (a change in the tables it reads). A record from before the
// fingerprint existed carries none: it is played, because refusing every
// replay already on disk would be a worse lie than the one this prevents.
export function contentMatches(recorded: string | undefined): boolean {
  return recorded === undefined || recorded === contentFingerprint();
}
