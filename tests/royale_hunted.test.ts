// The Risings and the hunted on the screen (src/ui/royale_hunted.ts): the
// columns over each Rising (counting down, lit while it stands) and over
// each mark while its show lasts; the edge arrows; the minimap's crown,
// diamond and dots; the aura a marked champion wears; a Rising's rise and
// fall read off two lists; and the calls of the mode's notes, with only
// the recorded Warden line spoken. The notes carry the server's names.

import { describe, expect, it } from 'vitest';
import { royaleNotes } from '../src/net/royale_client';
import type { SnapMark, SnapRising, SnapRoyale } from '../src/net/royale_wire';
import { PlanetMarks } from '../src/render/planet_marks';
import { PILLAR_LOOKS } from '../src/render/planet_pillars';
import { RISING_WARN_S } from '../src/sim/content/royale_events';
import { MARK_SHOWN_S } from '../src/sim/royale/types';
import {
  huntedCalls,
  huntedPillars,
  huntedTargets,
  MARK_COLORS,
  markAuras,
  minimapIcons,
  RISING_COLORS,
  RISING_POINTED_S,
  RisingWatch,
  risenCalls,
  risingCallText,
} from '../src/ui/royale_hunted';

const base: SnapRoyale = {
  v: 'respawn',
  st: 'play',
  de: 10,
  end: 610,
  dusk: { p: 1, c: [0, 80, 0], r: 120, pe: 200, sh: 0, b: 0.01 },
  alive: 50,
  people: 1,
};
const called: SnapRising = ['pyrefang', 1, 79, 2, 190, 0, 1];
const standing: SnapRising = ['warden', 3, 78, 4, 280, 1, 0.5];
const lodestar: SnapMark = [7, 'lodestar', 5, 77, 6, 200];
const wrath: SnapMark = [8, 'wrath', 9, 76, 1, 190];
const slayer: SnapMark = [9, 'slayer', 2, 79, 3, 201];
const names = (id: number) => `seat${id}`;

describe('the columns', () => {
  it('stand over each Rising, counting down to its rise and lit while it stands', () => {
    const pillars = huntedPillars({ ...base, ri: [called, standing] }, 170);
    expect(pillars).toEqual([
      {
        kind: 'rising',
        at: { x: 1, y: 79, z: 2 },
        until: 190,
        lit: false,
        color: RISING_COLORS.pyrefang.hex,
      },
      {
        kind: 'rising',
        at: { x: 3, y: 78, z: 4 },
        until: 280,
        lit: true,
        color: RISING_COLORS.warden.hex,
      },
    ]);
    expect(PILLAR_LOOKS.rising?.countdown).toBe(RISING_WARN_S);
  });

  it('stand over a mark only while its show lasts, a slayer in its flame', () => {
    const r = { ...base, mk: [lodestar, slayer] };
    expect(huntedPillars(r, 200 + MARK_SHOWN_S).map((p) => p.kind)).toEqual(['lodestar', 'rising']);
    expect(huntedPillars(r, 200 + MARK_SHOWN_S + 0.1).map((p) => p.color)).toEqual([
      MARK_COLORS.slayer.hex,
    ]);
    expect(huntedPillars(r, 210)).toEqual([]);
    expect(huntedPillars({ ...r, st: 'drop' }, 200)).toEqual([]);
    expect(huntedPillars(null, 200)).toEqual([]);
  });

  it('join the Seedfalls on the planet', () => {
    const pillars = PlanetMarks.pillarsOf(
      { ...base, sf: [[1, 10, 79, 2, 150, 0]], ri: [called], mk: [wrath] },
      191,
    );
    expect(pillars.map((p) => p.kind)).toEqual(['seedfall', 'rising', 'wrath']);
  });
});

describe('the arrows and the minimap', () => {
  it('point at each Rising with its seconds left, and each mark shown but the own', () => {
    const r = { ...base, ri: [called, standing], mk: [lodestar, wrath, slayer] };
    expect(huntedTargets(r, 180, 8)).toEqual([
      { key: 'ri-pyrefang', kind: 'rising', at: { x: 1, y: 79, z: 2 }, secondsLeft: 10 },
      { key: 'ri-warden', kind: 'rising', at: { x: 3, y: 78, z: 4 } },
    ]);
    expect(huntedTargets(r, 201, 8).map((t) => t.key)).toEqual([
      'ri-pyrefang',
      'ri-warden',
      'mk-7-lodestar',
    ]);
    // A standing Rising is pointed at for its first RISING_POINTED_S only.
    expect(huntedTargets(r, 280 + RISING_POINTED_S + 1, 8).map((t) => t.key)).toEqual([
      'ri-pyrefang',
    ]);
  });

  it('crown the Lodestar, mark the Wrath and dot each Rising, bright while shown', () => {
    const icons = minimapIcons({ ...base, ri: [called], mk: [lodestar, wrath, slayer] }, 201);
    expect(icons).toEqual([
      {
        icon: 'rising',
        at: { x: 1, y: 79, z: 2 },
        color: RISING_COLORS.pyrefang.css,
        shown: false,
      },
      { icon: 'crown', at: { x: 5, y: 77, z: 6 }, color: MARK_COLORS.lodestar.css, shown: true },
      { icon: 'diamond', at: { x: 9, y: 76, z: 1 }, color: MARK_COLORS.wrath.css, shown: false },
    ]);
  });

  it('dresses each marked champion in one aura, the Wrath first', () => {
    const auras = markAuras({ ...base, mk: [[7, 'ablaze', 0, 80, 0, 1], lodestar, wrath, slayer] });
    expect([...auras]).toEqual([
      [8, 'wrath'],
      [7, 'lodestar'],
    ]);
    expect(markAuras({ ...base, st: 'over', mk: [wrath] }).size).toBe(0);
  });
});

describe('a Rising come up or fallen', () => {
  it('reads the rise and the fall off two lists, the first list only learned', () => {
    const watch = new RisingWatch();
    expect(watch.step([['pyrefang', 0, 0, 0, 190, 1, 1]])).toEqual({ risen: [], fallen: [] });
    const soon: SnapRising = ['voidmaul', 0, 0, 0, 190, 0, 1];
    expect(watch.step([['pyrefang', 0, 0, 0, 190, 1, 1], soon])).toEqual({
      risen: [],
      fallen: [],
    });
    const up: SnapRising = ['voidmaul', 0, 0, 0, 190, 1, 1];
    expect(watch.step([['pyrefang', 0, 0, 0, 190, 1, 1], up])).toEqual({
      risen: ['voidmaul'],
      fallen: [],
    });
    expect(watch.step([up])).toEqual({ risen: [], fallen: ['pyrefang'] });
  });

  it('calls the Warden in its recorded line and the others in words', () => {
    expect(risenCalls(['warden'])).toEqual([
      expect.objectContaining({ text: 'The Warden has awoken', voice: 'warden_awoken' }),
    ]);
    const [c] = risenCalls(['pyrefang']);
    expect(c).toMatchObject({ text: 'The Pyrefang has risen' });
    expect(c?.voice).toBeUndefined();
  });
});

describe('the calls of the notes', () => {
  it('calls a batch of Risings once, 30 s ahead', () => {
    expect(risingCallText(['pyrefang', 'voidmaul'], 30)).toBe(
      'The Pyrefang and the Voidmaul rise in 0:30',
    );
    expect(risingCallText(['warden'], 29.2)).toBe('The Warden rises in the light in 0:30');
    const notes = royaleNotes([
      { e: 'royale_rising', kind: 'pyrefang', at: [0, 80, 0], risesAt: 190 },
      { e: 'royale_rising', kind: 'voidmaul', at: [0, 80, 0], risesAt: 190 },
    ]);
    const calls = huntedCalls(notes, 1, 160, names);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      text: 'The Pyrefang and the Voidmaul rise in 0:30',
      keep: true,
    });
  });

  it('names the Lodestar, the Wrath taken and passed, a run and a slayer', () => {
    const notes = royaleNotes([
      { e: 'royale_mark', unitId: 7, kind: 'lodestar', n: 'Kestrel' },
      { e: 'royale_mark', unitId: 4, kind: 'wrath', n: '' },
      { e: 'royale_mark', unitId: 5, kind: 'ablaze', n: 'Wren' },
      { e: 'royale_mark', unitId: 6, kind: 'slayer', n: 'Moss' },
      { e: 'royale_wrath_passed', from: 4, to: 9, n: 'Ivo' },
      { e: 'royale_wrath_passed', from: 9, to: null, n: null },
      { e: 'royale_snuffed', unitId: 5, killerId: 3, streak: 4, n: 'Wren', kn: 'Ash' },
    ]);
    expect(notes[0]).toMatchObject({ kind: 'mark', name: 'Kestrel' });
    expect(huntedCalls(notes, 1, 300, names).map((c) => c.text)).toEqual([
      'Kestrel is the Lodestar',
      'seat4 holds the Wrath',
      'Wren is Ablaze',
      'Moss took the Rising',
      'The Wrath has passed to Ivo',
      'The Wrath is lost',
      'Ash snuffed out Wren',
    ]);
  });

  it('speaks to the viewer about its own marks, and never in a synthesized voice', () => {
    const notes = royaleNotes([
      { e: 'royale_mark', unitId: 1, kind: 'lodestar', n: 'Me' },
      { e: 'royale_mark', unitId: 1, kind: 'ablaze', n: 'Me' },
      { e: 'royale_wrath_passed', from: 4, to: 1, n: 'Me' },
      { e: 'royale_snuffed', unitId: 5, killerId: 1, streak: 4, n: 'Wren', kn: 'Me' },
    ]);
    const calls = huntedCalls(notes, 1, 300, names);
    expect(calls.map((c) => c.text)).toEqual([
      'You are the Lodestar: every globe shows you',
      'The Wrath is yours',
    ]);
    expect(calls.every((c) => c.voice === undefined)).toBe(true);
  });
});
