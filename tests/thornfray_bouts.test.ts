// The registry's gate (src/sim/content/bouts/index.ts; ADR 0035;
// docs/design/thornfray.md, Adding a bout): every kind registered carries
// what the checklist asks of it, or CI fails. Its word in CONTEXT.md by its
// name; its errand in BOUT_CALLS (src/sim/royale/bot/bout_calls.ts) or
// `errand: null` said in its data; its end checksum, counts and ranking
// pinned in tests/thornfray_bout_versions.test.ts; its own test file; a
// rule line under 40 characters and a card of two or three lines (that the
// card fits the win card at 844 by 390 and on the desktops,
// tests/royale_win_layout.test.ts checks for every registered kind); data the
// engine can play (a clock of 90 to 120 s, one to five closings inside its
// Thornyard in order, tie-breaks ending on the lower seat). The gate runs
// on the fixtures' test kind too, which carries none of the files, to show
// it bites.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BOUT_KINDS, boutPool } from '../src/sim/content/bouts';
import type { BoutKind } from '../src/sim/content/bouts/types';
import { BOUT_CALLS } from '../src/sim/royale/bot/bout_calls';
import { LAST_CLOSING_PHASE } from '../src/sim/royale/dusk';
import { REGION_IDS } from '../src/sim/royale/layout';
import { TEST_BOUT } from './thornfray_fixture';

// The en and the em dash, named by code so this file carries neither.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

const root = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const read = (rel: string) => (existsSync(root(rel)) ? readFileSync(root(rel), 'utf8') : null);

// What a kind lacks, as a list of plain lines: empty for a kind that is
// whole.
function gaps(kind: BoutKind): string[] {
  const out: string[] = [];
  const context = read('CONTEXT.md') ?? '';
  if (!new RegExp(`^\\*\\*${kind.name}\\*\\*:`, 'm').test(context)) {
    out.push(`no CONTEXT.md entry for ${kind.name}`);
  }
  if (kind.bots.errand !== null && !Object.hasOwn(BOUT_CALLS, kind.bots.errand)) {
    out.push(`no BOUT_CALLS entry for ${kind.id}`);
  }
  if (!read('tests/thornfray_bout_versions.test.ts')?.includes(`'${kind.id}'`)) {
    out.push(`no pinned end checksum for ${kind.id}`);
  }
  if (!existsSync(root(`tests/thornfray_bout_${kind.id}.test.ts`))) {
    out.push(`no tests/thornfray_bout_${kind.id}.test.ts`);
  }
  if (kind.rule.length >= 40) out.push(`the rule of ${kind.id} is 40 characters or more`);
  if (kind.card.length < 2 || kind.card.length > 3)
    out.push(`the card of ${kind.id} is not 2 or 3 lines`);
  for (const line of [kind.name, kind.rule, ...kind.card]) {
    if (DASHES.test(line)) out.push(`a dash in the words of ${kind.id}`);
  }
  return out;
}

// What the engine cannot play, as a list of plain lines.
function unplayable(kind: BoutKind): string[] {
  const out: string[] = [];
  if (!/^[a-z]+$/.test(kind.id)) out.push('an id of lowercase letters');
  if (!Number.isInteger(kind.version) || kind.version < 1) out.push('a version from 1');
  if (kind.playS < 90 || kind.playS > 120) out.push('a clock of 90 to 120 s');
  const c = kind.dusk.closings;
  if (c.length < 1 || c.length > LAST_CLOSING_PHASE) out.push('one to five closings');
  let radius = kind.thornyard.radius;
  let time = 0;
  for (const k of c) {
    if (k.radius >= radius) out.push('each closing smaller than the light before');
    if (!(k.closeFrom >= time && k.closeTo > k.closeFrom && k.holdTo > k.closeTo)) {
      out.push('closings in order of time');
    }
    radius = k.radius;
    time = k.holdTo;
  }
  if (kind.dusk.edgeSpeed <= 0) out.push('an edge that moves');
  for (const r of kind.thornyard.regions ?? []) {
    if (!REGION_IDS.includes(r)) out.push(`an unknown region ${r}`);
  }
  if (kind.ties[kind.ties.length - 1] !== 'seat') out.push('tie-breaks ending on the seat');
  const sf = kind.seedfalls;
  if (sf && (sf.seeds < 1 || sf.at.some((at) => at - sf.warnS < 0 || at > kind.playS))) {
    out.push('Seedfalls called after landing and landing before the clock');
  }
  if (kind.caches.count < 0) out.push('no fewer caches than none');
  if (kind.hud.word.length === 0) out.push('a word for the count');
  return out;
}

describe('the bout registry', () => {
  it('holds distinct kinds, the pool its released ones', () => {
    const ids = BOUT_KINDS.map((k) => k.id);
    const names = BOUT_KINDS.map((k) => k.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    expect(boutPool().every((k) => k.released)).toBe(true);
    expect(boutPool().length).toBe(BOUT_KINDS.filter((k) => k.released).length);
  });

  for (const kind of BOUT_KINDS) {
    it(`finds ${kind.id} whole and playable`, () => {
      expect(gaps(kind)).toEqual([]);
      expect(unplayable(kind)).toEqual([]);
    });
  }

  it('bites: the fixtures test kind is playable and lacks every file', () => {
    expect(unplayable(TEST_BOUT)).toEqual([]);
    expect(gaps(TEST_BOUT)).toEqual([
      'no CONTEXT.md entry for Testbout',
      'no pinned end checksum for testbout',
      'no tests/thornfray_bout_testbout.test.ts',
    ]);
    const lost = { ...TEST_BOUT.bots, errand: 'wander' };
    expect(gaps({ ...TEST_BOUT, bots: lost })).toContain('no BOUT_CALLS entry for testbout');
    expect(gaps({ ...TEST_BOUT, rule: 'x'.repeat(40), card: ['one'] })).toContain(
      'the rule of testbout is 40 characters or more',
    );
    const dashed = `Most${String.fromCharCode(0x2014)}dealt`;
    expect(gaps({ ...TEST_BOUT, rule: dashed })).toContain('a dash in the words of testbout');
    expect(unplayable({ ...TEST_BOUT, playS: 60, ties: ['falls'] })).toEqual([
      'a clock of 90 to 120 s',
      'tie-breaks ending on the seat',
    ]);
  });
});
