// The status chips (src/ui/chip_text.ts): a short word that reads at a
// glance, a small sub line with the whole seconds or the number, the whole
// fact in the tooltip. The battle royale's playtest could not read "BO",
// "MA x1" or "AI 0.1".

import { describe, expect, it } from 'vitest';
import { refreshBuff, type Status } from '../src/sim/combat/status';
import type { Unit } from '../src/sim/unit';
import {
  AURA_WINDOW_S,
  AuraWatch,
  aspectGlyph,
  boonChipFace,
  favorChipFace,
  statusChip,
  statusKey,
  statusWord,
  wrathChipFace,
} from '../src/ui/chip_text';

const T = 100;

describe('status chips', () => {
  it('say what the playtest could not read', () => {
    const boost: Status = { kind: 'buff', until: T + 5.4, msPct: 0, asPct: 0.2, armor: 0, mr: 0 };
    expect(statusChip(boost, T)).toEqual({
      glyph: 'Boost',
      sub: '6s',
      tip: 'Boosted, 6 s left',
    });
    const mark: Status = { kind: 'mark', until: T + 3, stacks: 1, sourceId: 7 };
    expect(statusChip(mark, T)).toEqual({ glyph: 'Mark', sub: '', tip: 'Marked, 3 s left' });
    const lift: Status = { kind: 'airborne', until: T + 0.1 };
    expect(statusChip(lift, T)).toEqual({
      glyph: 'Airborne',
      sub: '1s',
      tip: 'Knocked airborne, 1 s left',
    });
  });

  it('never show a decimal, and count a mark past one', () => {
    const stun: Status = { kind: 'stun', until: T + 1.2 };
    expect(statusChip(stun, T).sub).toBe('2s');
    const marks: Status = { kind: 'mark', until: T + 3, stacks: 3, sourceId: 7 };
    expect(statusChip(marks, T)).toMatchObject({ sub: 'x3', tip: 'Marked 3 times, 3 s left' });
    const slow: Status = { kind: 'slow', until: T + 2, pct: 0.35 };
    expect(statusChip(slow, T)).toEqual({ glyph: 'Slow', sub: '35%', tip: 'Slowed 35%, 2 s left' });
    const shield: Status = { kind: 'shield', until: T + 2, remaining: 119.6 };
    expect(statusChip(shield, T)).toMatchObject({ glyph: 'Shield', sub: '120' });
    for (const s of [stun, marks, slow, shield, lift()]) {
      expect(statusChip(s, T).sub).not.toMatch(/\./);
    }
  });

  it('give every status a word, never two capitals', () => {
    const kinds: Status['kind'][] = [
      'slow',
      'root',
      'recall',
      'stun',
      'airborne',
      'untargetable',
      'taunt',
      'stealth',
      'blind',
      'shield',
      'empower',
      'mark',
      'dot',
      'grievous',
      'buff',
    ];
    for (const kind of kinds) {
      const word = statusWord(kind);
      expect(word, kind).toMatch(/^[A-Z][a-z]{2,}$/);
      expect(word.length, kind).toBeLessThanOrEqual(11);
    }
  });
});

function lift(): Status {
  return { kind: 'airborne', until: T + 0.05 };
}

describe('team chips', () => {
  it('name the Boon, the Wrath and the favors', () => {
    expect(aspectGlyph('might')).toBe('Might');
    expect(aspectGlyph('swiftness')).toBe('Swiftness');
    expect(boonChipFace(8, 41.2, false)).toEqual({
      glyph: 'Boon',
      sub: '42s',
      tip: 'BOON +8% damage, 42s left',
    });
    expect(boonChipFace(16, 3, true).tip).toBe('ENEMY BOON +16% damage, 3s left');
    expect(wrathChipFace('WRATH execute under 20%', 10, true)).toEqual({
      glyph: 'Wrath',
      sub: '10s',
      tip: 'ENEMY WRATH execute under 20%',
    });
    expect(favorChipFace('tide', 1, 'TIDE 2% missing HP every 5s', false)).toEqual({
      glyph: 'Tide',
      sub: '',
      tip: 'TIDE 2% missing HP every 5s',
    });
    expect(favorChipFace('tide', 2, 'TIDE 4%', true)).toMatchObject({
      sub: 'x2',
      tip: 'ENEMY TIDE 4%',
    });
  });
});

describe('a status an aura keeps renewing', () => {
  // The HUD's frames over a stretch of sim time: the statuses standing on
  // the champion stepped into the watch, the chips read as it reads them.
  const frames = (
    u: { statuses: Status[] },
    from: number,
    to: number,
    renew: (t: number) => void,
    lag = 0,
  ): { faces: ReturnType<typeof statusChip>[][]; watch: AuraWatch } => {
    const watch = new AuraWatch();
    const faces: ReturnType<typeof statusChip>[][] = [];
    for (let t = from; t <= to + 1e-9; t += 0.05) {
      renew(t);
      u.statuses = u.statuses.filter((s) => s.until > t);
      // A mirror reads the world a little behind the sim.
      const seen = t - lag;
      const standing = new Map<string, number>();
      const shown: [Status, string][] = [];
      const nth = new Map<string, number>();
      for (const s of u.statuses) {
        const n = (nth.get(s.kind) ?? 0) + 1;
        nth.set(s.kind, n);
        const key = statusKey(s, n);
        standing.set(key, s.until - seen);
        shown.push([s, key]);
      }
      watch.step(standing);
      faces.push(shown.map(([s, key]) => statusChip(s, seen, watch.held(key))));
    }
    return { faces, watch };
  };

  it('shows Torv\'s own Bulwark without a countdown all match (it read "Boost 1s")', () => {
    const torv = { statuses: [] as Status[] };
    // The aura's passive tick, every quarter second, 0.4 s each time.
    let next = 0;
    const aura = (t: number): void => {
      if (t + 1e-9 < next) return;
      next = t + 0.25;
      refreshBuff(torv as unknown as Unit, t, 0.4, { armor: 8 });
    };
    for (const lag of [0, 0.1]) {
      torv.statuses = [];
      next = 0;
      const { faces } = frames(torv, 0, 30, aura, lag);
      for (const face of faces) {
        expect(face).toHaveLength(1);
        expect(face[0]).toEqual({ glyph: 'Boost', sub: '', tip: 'Boosted, while the aura holds' });
      }
    }
  });

  it('keeps the countdown of a status that ran longer, to its end', () => {
    const u = { statuses: [] as Status[] };
    const { faces } = frames(u, 0, 2.95, (t) => {
      if (t === 0) refreshBuff(u as unknown as Unit, t, 3, { asPct: 0.2 });
    });
    const last = faces.at(-1)?.[0];
    expect(last?.sub).toBe('1s');
    expect(faces.every((f) => f[0]?.sub !== '')).toBe(true);
  });

  it('keeps the countdown of a burst renewed by hits (Mistborne, 1.2 s)', () => {
    const u = { statuses: [] as Status[] };
    const { faces } = frames(u, 0, 4, (t) => {
      if (Math.abs(t / 0.8 - Math.round(t / 0.8)) < 1e-6) {
        refreshBuff(u as unknown as Unit, t, 1.2, { msPct: 0.2 });
      }
    });
    expect(faces.every((f) => f.every((c) => c.sub !== ''))).toBe(true);
  });

  it('forgets a status gone, so one that comes back longer counts again', () => {
    const watch = new AuraWatch();
    const key = statusKey({ kind: 'buff', until: 1, msPct: 0, asPct: 0, armor: 8, mr: 0 }, 1);
    watch.step(new Map([[key, 0.4]]));
    expect(watch.held(key)).toBe(true);
    watch.step(new Map());
    expect(watch.held(key)).toBe(false);
    watch.step(new Map([[key, AURA_WINDOW_S + 2]]));
    expect(watch.held(key)).toBe(false);
  });
});
