// The battle royale's loud moments (src/ui/royale_moments.ts): what the
// viewer's screen calls out, who the feed keeps, how the score rides the
// match, the Dusk's cold and the Clamor's loudness, the cache's ritual.
// Every rule of the tranche 1 core is pinned here, the DOM left out.

import { describe, expect, it } from 'vitest';
import { RECORDED_VOICE_LINE_IDS } from '../src/game/voice_lines';
import type { SnapClamor } from '../src/net/royale_wire';
import { SEEDFALL_IMPACT_M, SEEDFALL_WARN_S } from '../src/sim/content/royale_events';
import { CLAMOR_S } from '../src/sim/royale/types';
import {
  arcDistance,
  ClamorBell,
  ClamorEar,
  clamorGain,
  DUSK_TICK_WINDOW_S,
  duskDepth,
  duskTickOnly,
  duskTolls,
  elsewhereText,
  FEED_MAX,
  FEED_MS,
  FEED_NEAR_MAX,
  FEED_NEAR_MS,
  type FeedContext,
  type FeedTier,
  FoldCount,
  feedKeeps,
  feedLife,
  feedOverflow,
  feedTier,
  foldsOut,
  frostLevel,
  heartbeat,
  impactGain,
  impactShake,
  type MomentCall,
  type MomentKill,
  musicIntensity,
  OpeningRitual,
  panOf,
  RoyaleMoments,
  RUN_DUCK_MS,
  RUN_LADDER,
  ringing,
  SeedfallRush,
  tickPitch,
  WHOOSH_LEAD_S,
} from '../src/ui/royale_moments';

const SELF = 1;
const A = 2;
const B = 3;
const C = 4;

const kill = (unitId: number, killerId: number, champions = true): MomentKill => ({
  unitId,
  killerId,
  victimChampion: champions,
  killerChampion: champions && killerId !== 0,
});

function watching(variant: 'one_life' | 'respawn' = 'one_life'): RoyaleMoments {
  const m = new RoyaleMoments(variant, SELF);
  m.seeStage('drop');
  m.seeStage('play');
  return m;
}

const texts = (calls: readonly MomentCall[]): string[] => calls.map((c) => c.text);

// The viewer takes down `n` champions, `gap` seconds apart from `from`.
function takedowns(m: RoyaleMoments, n: number, from = 100, gap = 20): MomentCall[][] {
  return Array.from({ length: n }, (_, i) => m.onKill(kill(50 + i, SELF), from + i * gap));
}

describe('First blood', () => {
  it('is called once a match, on the first takedown, in the recorded voice', () => {
    const m = watching();
    const first = m.onKill(kill(A, B), 30);
    expect(first).toEqual([{ text: 'First blood', color: '#ff7a5a', voice: 'first_blood' }]);
    expect(texts(m.onKill(kill(C, B), 60))).not.toContain('First blood');
    expect(texts(m.onKill(kill(B, SELF), 90))).not.toContain('First blood');
  });

  it('waits for a takedown: the Dusk and a camp are no blood', () => {
    const m = watching();
    expect(m.onKill(kill(A, 0), 20)).toEqual([]);
    expect(m.onKill(kill(A, A), 21)).toEqual([]);
    expect(m.onKill(kill(70, SELF, false), 22)).toEqual([]);
    expect(texts(m.onKill(kill(B, C), 23))).toEqual(['First blood']);
  });

  it('stays silent for a viewer who came in after the drop', () => {
    const m = new RoyaleMoments('respawn', SELF);
    m.seeStage('play');
    expect(m.onKill(kill(A, B), 300)).toEqual([]);
  });
});

describe('the multikill ladder', () => {
  it("calls the viewer's double and triple, and caps there", () => {
    const m = watching();
    m.onKill(kill(A, B), 1);
    expect(m.onKill(kill(10, SELF), 100)).toEqual([]);
    expect(m.onKill(kill(11, SELF), 105)[0]).toMatchObject({
      text: 'DOUBLE KILL',
      voice: 'double_kill',
    });
    const third = m.onKill(kill(12, SELF), 110);
    expect(third[0]).toMatchObject({ text: 'TRIPLE KILL', voice: 'triple_kill' });
    // Past the triple, the chain starts again.
    expect(texts(m.onKill(kill(13, SELF), 112))).not.toContain('QUADRAKILL');
  });

  it("keeps everyone else's rungs private", () => {
    const m = watching();
    m.onKill(kill(10, A), 100);
    expect(m.onKill(kill(11, A), 102)).toEqual([]);
    expect(m.onKill(kill(12, A), 104)).toEqual([]);
  });
});

describe('the run ladder', () => {
  it('shows Ablaze at 3 and Wildfire at 5 in One life, on the own streak', () => {
    const m = watching('one_life');
    const calls = takedowns(m, 6).map(texts);
    expect(calls[2]).toEqual(['ABLAZE']);
    expect(calls[4]).toEqual(['WILDFIRE']);
    expect(calls.flat().filter((t) => t === 'ABLAZE' || t === 'WILDFIRE')).toHaveLength(2);
  });

  it('shows Ablaze at 5 and Wildfire at 8 in Respawn', () => {
    expect(RUN_LADDER.respawn).toEqual({ ablaze: 5, wildfire: 8 });
    const m = watching('respawn');
    const calls = takedowns(m, 9).map(texts);
    expect(calls[2]).toEqual([]);
    expect(calls[4]).toEqual(['ABLAZE']);
    expect(calls[7]).toEqual(['WILDFIRE']);
  });

  it('dips the music, speaks no voice, and grows from Ablaze to Wildfire', () => {
    const m = watching('one_life');
    const calls = takedowns(m, 5);
    const ablaze = calls[2]![0]!;
    const wildfire = calls[4]![0]!;
    for (const c of [ablaze, wildfire]) {
      expect(c.spotlight).toBe(true);
      expect(c.duckMs).toBe(RUN_DUCK_MS);
      expect(c.voice).toBeUndefined();
    }
    expect(wildfire.top).toBe(true);
    expect(wildfire.gain!).toBeGreaterThan(ablaze.gain!);
  });

  it('resets on the own death, and counts nobody else', () => {
    const m = watching('one_life');
    takedowns(m, 2);
    expect(m.streak).toBe(2);
    m.onKill(kill(SELF, A), 200);
    expect(m.streak).toBe(0);
    m.onKill(kill(B, A), 210);
    expect(m.streak).toBe(0);
    const again = takedowns(m, 3, 300).map(texts);
    expect(again[2]).toContain('ABLAZE');
  });
});

describe('Snuffed out and Payback', () => {
  it('calls Snuffed out when the viewer ends a shown run', () => {
    const m = watching();
    const calls = m.onNotes([{ kind: 'snuffed', unitId: A, killerId: SELF, streak: 4 }]);
    expect(texts(calls)).toEqual(['SNUFFED OUT']);
    expect(m.onNotes([{ kind: 'snuffed', unitId: A, killerId: B, streak: 4 }])).toEqual([]);
  });

  it('calls Payback when the viewer takes down the seat that last took them down', () => {
    const m = watching('respawn');
    m.onKill(kill(SELF, A), 50);
    expect(texts(m.onKill(kill(B, SELF), 80))).not.toContain('Payback');
    expect(texts(m.onKill(kill(A, SELF), 120))).toContain('Payback');
    // Once: the score is settled.
    m.onKill(kill(SELF + 40, A), 130);
    expect(texts(m.onKill(kill(A, SELF), 160))).not.toContain('Payback');
  });

  it('forgets the debt when the Dusk takes the viewer instead', () => {
    const m = watching('respawn');
    m.onKill(kill(SELF, A), 50);
    m.onKill(kill(SELF, 0), 90);
    expect(texts(m.onKill(kill(A, SELF), 120))).not.toContain('Payback');
  });
});

describe('the Last light', () => {
  it('calls it in Respawn with its sound, then what it changes, kept on its line', () => {
    const calls = watching('respawn').onNotes([{ kind: 'last_light', step: 'double' }]);
    expect(texts(calls)).toEqual(['LAST LIGHT', 'Takedowns count double until the light goes out']);
    expect(calls[0]).toMatchObject({ spotlight: true, sfx: 'lastlight' });
    expect(calls[1]).toMatchObject({ keep: true });
    expect(calls[1]?.sfx).toBeUndefined();
  });

  it('says nothing of it in One life', () => {
    expect(watching('one_life').onNotes([{ kind: 'last_light', step: 'double' }])).toEqual([]);
  });
});

describe('the voice', () => {
  it('speaks only lines recorded on disk, never rampage', () => {
    const m = watching('one_life');
    const calls = [
      ...m.onKill(kill(A, B), 1),
      ...takedowns(m, 6, 100, 3).flat(),
      ...m.onNotes([
        { kind: 'snuffed', unitId: A, killerId: SELF, streak: 4 },
        { kind: 'seedfall', id: 1, at: [0, 80, 0], landsAt: 140 },
        { kind: 'seedfall_land', id: 1, at: [0, 80, 0] },
      ]),
    ];
    for (const c of calls) {
      if (c.voice === undefined) continue;
      expect(RECORDED_VOICE_LINE_IDS).toContain(c.voice);
      expect(c.voice).not.toBe('rampage');
    }
    expect(calls.some((c) => c.voice !== undefined)).toBe(true);
  });
});

describe('the feed', () => {
  const ctx = (over: Partial<FeedContext> = {}): FeedContext => ({
    selfId: SELF,
    person: () => false,
    marked: () => false,
    inSight: () => false,
    ...over,
  });

  it('keeps the viewer, people, marks and champions in sight', () => {
    expect(feedKeeps({ unitId: SELF, killerId: A }, ctx())).toBe(true);
    expect(feedKeeps({ unitId: A, killerId: SELF }, ctx())).toBe(true);
    expect(feedKeeps({ unitId: A, killerId: B }, ctx({ person: (id) => id === B }))).toBe(true);
    expect(feedKeeps({ unitId: A, killerId: B }, ctx({ marked: (id) => id === A }))).toBe(true);
    expect(feedKeeps({ unitId: A, killerId: B }, ctx({ inSight: (id) => id === A }))).toBe(true);
  });

  it('folds the rest into "+N elsewhere"', () => {
    expect(feedKeeps({ unitId: A, killerId: B }, ctx())).toBe(false);
    expect(feedKeeps({ unitId: A, killerId: 0 }, ctx())).toBe(false);
    expect(elsewhereText(7)).toBe('+7 elsewhere');
  });

  it('counts the folded deaths of its last moments, not of the whole fight', () => {
    const fold = new FoldCount(6500);
    for (let t = 0; t < 60_000; t += 1000) fold.add(t);
    // One a second for a minute: the line says the last six and a half.
    expect(fold.count(59_000)).toBe(7);
    expect(fold.count(64_000)).toBe(2);
    expect(fold.count(66_000)).toBe(0);
  });

  it('never keeps a Dusk death for the killer it does not have', () => {
    // The Dusk's own say is killer 0 or the victim itself: only the victim
    // decides.
    expect(feedKeeps({ unitId: A, killerId: 0 }, ctx({ person: (id) => id === 0 }))).toBe(false);
  });

  it("ranks the viewer's and the leader's deaths above the rest", () => {
    const lead = (id: number): boolean => id === B;
    expect(feedTier({ unitId: A, killerId: SELF }, ctx({ leader: lead }))).toBe('own');
    expect(feedTier({ unitId: SELF, killerId: B }, ctx({ leader: lead }))).toBe('own');
    expect(feedTier({ unitId: A, killerId: B }, ctx({ leader: lead }))).toBe('lead');
    expect(feedTier({ unitId: B, killerId: 0 }, ctx({ leader: lead }))).toBe('lead');
    // A bot on a bot in sight, a person, a mark: the near tier.
    expect(feedTier({ unitId: A, killerId: C }, ctx({ inSight: (id) => id === A }))).toBe('near');
    expect(feedTier({ unitId: A, killerId: C }, ctx({ person: (id) => id === C }))).toBe('near');
    expect(feedTier({ unitId: A, killerId: C }, ctx({ leader: lead }))).toBe('fold');
    // One life has no leader: the old rule.
    expect(feedTier({ unitId: A, killerId: C }, ctx())).toBe('fold');
  });

  it('keeps the near tier a shorter while than the own lines', () => {
    expect(feedLife('own')).toBe(FEED_MS);
    expect(feedLife('lead')).toBe(FEED_MS);
    expect(feedLife('near')).toBe(FEED_NEAR_MS);
    expect(FEED_NEAR_MS).toBeLessThan(FEED_MS);
  });

  it('keeps the news from afar a near line that never counts as a death elsewhere', () => {
    expect(feedLife('news')).toBe(FEED_NEAR_MS);
    // News and near deaths share the near rows, the oldest leaving first.
    expect(feedOverflow(['news', 'news', 'news'])).toEqual([2]);
    expect(feedOverflow(['news', 'near', 'news'])).toEqual([2]);
    expect(feedOverflow(['own', 'news', 'own', 'lead', 'own'])).toEqual([1]);
    // A death pushed out joins "+N elsewhere"; a news line just goes.
    expect(foldsOut('near')).toBe(true);
    expect(foldsOut('news')).toBe(false);
    expect(foldsOut('own')).toBe(false);
  });

  it('folds a late Respawn of bots on bots instead of standing five rows deep', () => {
    // Newest first: a new near line over two near lines pushes the oldest
    // near one out.
    expect(feedOverflow(['near', 'near', 'near'])).toEqual([2]);
    expect(feedOverflow(['near', 'own', 'near', 'lead', 'near'])).toEqual([4]);
    // Never more than FEED_MAX lines, a near one leaving before the
    // viewer's and the leader's.
    expect(feedOverflow(['own', 'lead', 'near', 'own', 'lead'])).toEqual([2]);
    expect(feedOverflow(['own', 'own', 'lead', 'own', 'own'])).toEqual([4]);
    expect(feedOverflow(['own', 'near'])).toEqual([]);
    // However they come, what stands is at most FEED_MAX lines and
    // FEED_NEAR_MAX near ones.
    const tiers: FeedTier[] = ['own', 'lead', 'near'];
    let feed: FeedTier[] = [];
    for (let i = 0; i < 40; i++) {
      feed = [tiers[(i * 7) % 3] as FeedTier, ...feed];
      const gone = new Set(feedOverflow(feed));
      feed = feed.filter((_, j) => !gone.has(j));
      expect(feed.length).toBeLessThanOrEqual(FEED_MAX);
      expect(feed.filter((t) => t === 'near').length).toBeLessThanOrEqual(FEED_NEAR_MAX);
    }
  });
});

describe("the Dusk's ticks", () => {
  // 2000 health, 3% a second: 3 a tick at 20 Hz.
  it('are the burn alone while small and outside the light', () => {
    expect(duskTickOnly(3, 2000, 0.03, true)).toBe(true);
    // A frame carrying a few ticks.
    expect(duskTickOnly(12, 2000, 0.03, true)).toBe(true);
    expect(duskTickOnly(2000 * 0.03 * DUSK_TICK_WINDOW_S + 1, 2000, 0.03, true)).toBe(true);
  });

  it('let a real hit through, and every drop inside the light or in the calm', () => {
    expect(duskTickOnly(80, 2000, 0.03, true)).toBe(false);
    expect(duskTickOnly(3, 2000, 0.03, false)).toBe(false);
    expect(duskTickOnly(3, 2000, 0, true)).toBe(false);
    expect(duskTickOnly(0, 2000, 0.03, true)).toBe(false);
  });
});

describe('the music', () => {
  it('rides the closings, and the fight', () => {
    expect(musicIntensity('drop', 0, null)).toBe(0);
    expect(musicIntensity('play', 0, null)).toBe(0);
    expect(musicIntensity('play', 1, null)).toBe(1);
    expect(musicIntensity('play', 2, 10)).toBe(1);
    expect(musicIntensity('play', 3, null)).toBe(2);
    expect(musicIntensity('play', 4, null)).toBe(2);
    expect(musicIntensity('play', 0, 3.9)).toBe(2);
    expect(musicIntensity('play', 1, 4)).toBe(1);
    expect(musicIntensity('play', 5, null)).toBe(3);
    expect(musicIntensity('play', 6, null)).toBe(3);
  });

  it('beats a heart under a quarter of the health', () => {
    expect(heartbeat(24, 100, false)).toBe(true);
    expect(heartbeat(25, 100, false)).toBe(false);
    expect(heartbeat(5, 100, true)).toBe(false);
  });
});

describe('the Dusk', () => {
  const dusk = { p: 2, c: [0, 80, 0] as [number, number, number], r: 30 };

  it('tolls as it starts to close and as the last light goes out', () => {
    expect(duskTolls(null, { p: 1, sh: 1 })).toBe(false);
    expect(duskTolls({ p: 0, sh: 0 }, { p: 1, sh: 1 })).toBe(true);
    expect(duskTolls({ p: 1, sh: 1 }, { p: 1, sh: 1 })).toBe(false);
    expect(duskTolls({ p: 1, sh: 1 }, { p: 1, sh: 0 })).toBe(false);
    expect(duskTolls({ p: 1, sh: 0 }, { p: 2, sh: 1 })).toBe(true);
    expect(duskTolls({ p: 5, sh: 1 }, { p: 6, sh: 0 })).toBe(true);
    expect(duskTolls({ p: 6, sh: 0 }, { p: 6, sh: 0 })).toBe(false);
  });

  it('measures how deep the champion stands past the light', () => {
    expect(duskDepth({ x: 0, z: 0 }, dusk)).toBeNull();
    expect(duskDepth({ x: 0, y: 80, z: 10 }, dusk)).toBe(0);
    expect(duskDepth({ x: 0, y: 80, z: 40 }, dusk)).toBeCloseTo(10);
    expect(duskDepth({ x: 0, y: 80, z: 40 }, { ...dusk, p: 0 })).toBe(0);
  });

  it('frosts the edges from the first step out, fully twelve meters in', () => {
    expect(frostLevel(null)).toBe(0);
    expect(frostLevel(0)).toBe(0);
    expect(frostLevel(0.1)).toBeGreaterThan(0.25);
    expect(frostLevel(6)).toBeLessThan(1);
    expect(frostLevel(12)).toBe(1);
    expect(frostLevel(40)).toBe(1);
  });
});

describe('a Clamor heard', () => {
  it('is full within 10 m and silent past 60 m, linear between', () => {
    expect(clamorGain(0)).toBe(1);
    expect(clamorGain(10)).toBe(1);
    expect(clamorGain(35)).toBeCloseTo(0.5);
    expect(clamorGain(60)).toBe(0);
    expect(clamorGain(90)).toBe(0);
  });

  it('measures along the ground, and pans by bearing', () => {
    const r = 80;
    const quarter = arcDistance({ x: 0, y: r, z: 0 }, { x: r, y: 0, z: 0 });
    expect(quarter).toBeCloseTo((Math.PI / 2) * r);
    expect(panOf(Math.PI / 2)).toBeCloseTo(1);
    expect(panOf(-Math.PI / 2)).toBeCloseTo(-1);
    expect(panOf(0)).toBe(0);
  });

  it('is heard once, while it rings', () => {
    const ear = new ClamorEar();
    const a: SnapClamor = [1, 80, 2, 100];
    const b: SnapClamor = [5, 80, 2, 101];
    expect(ear.fresh([a], 100)).toEqual([a]);
    expect(ear.fresh([a], 100.5)).toEqual([]);
    expect(ear.fresh([a, b], 101)).toEqual([b]);
    // The client keeps the last list: an old one is not news.
    expect(new ClamorEar().fresh([a], 100 + CLAMOR_S)).toEqual([]);
    expect(ringing([a, b], 102.5)).toEqual([a, b]);
    expect(ringing([a, b], 103.5)).toEqual([b]);
  });
});

describe("the cache's ritual", () => {
  it('ticks four times, rising, over the opening', () => {
    const ritual = new OpeningRitual();
    const beats = [0, 0.1, 0.3, 0.55, 0.8, 0.99].flatMap((f) => ritual.step(7, f));
    expect(beats.map((b) => (b.kind === 'tick' ? b.index : -1))).toEqual([0, 1, 2, 3]);
    const pitches = beats.map((b) => (b.kind === 'tick' ? b.pitch : 0));
    expect(pitches).toEqual([0, 1, 2, 3].map(tickPitch));
    for (let i = 1; i < pitches.length; i++) expect(pitches[i]!).toBeGreaterThan(pitches[i - 1]!);
  });

  it('cracks when the opening ends and the cache did not open', () => {
    const ritual = new OpeningRitual();
    ritual.step(7, 0.2);
    expect(ritual.step(null, null)).toEqual([]);
    // The notes of that snapshot said nothing: a crack, one tick on.
    expect(ritual.step(null, null)).toEqual([{ kind: 'crack', cacheId: 7 }]);
    expect(ritual.step(null, null)).toEqual([]);
  });

  it('never cracks a cache that opened', () => {
    const ritual = new OpeningRitual();
    ritual.step(7, 0.9);
    ritual.step(null, null);
    ritual.open(7);
    expect(ritual.step(null, null)).toEqual([]);
  });

  it('cracks the first cache when the champion turns to another', () => {
    const ritual = new OpeningRitual();
    ritual.step(7, 0.4);
    const beats = ritual.step(8, 0);
    expect(beats).toEqual([{ kind: 'tick', index: 0, pitch: tickPitch(0) }]);
    expect(ritual.step(8, 0.1)).toEqual([{ kind: 'crack', cacheId: 7 }]);
  });
});

describe('the Seedfall calls', () => {
  it('calls one Seedfall with its seconds, kept, under its own gong', () => {
    const m = watching('one_life');
    const [call, ...rest] = m.onNotes(
      [{ kind: 'seedfall', id: 1, at: [0, 80, 0], landsAt: 140 }],
      140 - SEEDFALL_WARN_S,
    );
    expect(rest).toEqual([]);
    expect(call!.text).toBe('A Seedfall in 30 s');
    expect(call!.keep).toBe(true);
    // Not the chime: that one is the edge arrows', panned toward the column.
    expect(call!.sfx).toBe('gong');
  });

  it("folds Respawn's two seeds into one call, and one landing line", () => {
    const m = watching('respawn');
    const called = m.onNotes(
      [
        { kind: 'seedfall', id: 1, at: [0, 80, 0], landsAt: 140 },
        { kind: 'seedfall', id: 2, at: [80, 0, 0], landsAt: 140 },
      ],
      140 - SEEDFALL_WARN_S,
    );
    expect(texts(called)).toEqual(['Two Seedfalls in 30 s']);
    const landed = m.onNotes([
      { kind: 'seedfall_land', id: 1, at: [0, 80, 0] },
      { kind: 'seedfall_land', id: 2, at: [80, 0, 0] },
    ]);
    expect(texts(landed)).toEqual(['Two Seedfalls have landed']);
    // The impact's boom is played by distance, not by the line.
    expect(landed[0]!.sfx).toBeUndefined();
  });

  it('rushes once a seed, just before it lands, so the thud falls on the impact', () => {
    const rush = new SeedfallRush();
    const sf: [number, number, number, number, number, 0 | 1][] = [[1, 0, 80, 0, 140, 0]];
    expect(rush.step(sf, 139 - WHOOSH_LEAD_S)).toEqual([]);
    expect(rush.step(sf, 140 - WHOOSH_LEAD_S)).toEqual([1]);
    expect(rush.step(sf, 139.9)).toEqual([]);
    // One already down when first seen is not rushed.
    expect(new SeedfallRush().step([[2, 0, 80, 0, 100, 1]], 120)).toEqual([]);
  });

  it('booms loudest near, and shakes the camera only close to the impact', () => {
    expect(impactGain(5)).toBe(1);
    expect(impactGain(80)).toBeLessThan(1);
    expect(impactGain(400)).toBeGreaterThan(0);
    expect(impactShake(SEEDFALL_IMPACT_M)).toBeGreaterThan(impactShake(SEEDFALL_IMPACT_M + 10));
    expect(impactShake(60)).toBe(0);
  });
});

describe('the Clamor bell', () => {
  const self = { x: 0, y: 80, z: 0 };
  const near: SnapClamor = [0, 80, 20, 100];
  const far: SnapClamor = [0, 80, 45, 100];

  it('rings the loudest of a batch, panned by bearing', () => {
    const bell = new ClamorBell();
    const rung = bell.pick([far, near], self, 100);
    expect(rung?.at).toEqual({ x: 0, y: 80, z: 20 });
    expect(rung!.gain).toBeGreaterThan(clamorGain(arcDistance(self, { x: 0, y: 80, z: 45 })));
  });

  it('rests at least a second and a half between two clashes', () => {
    const bell = new ClamorBell();
    expect(bell.pick([near], self, 100)).not.toBeNull();
    expect(bell.pick([far], self, 101)).toBeNull();
    expect(bell.pick([far], self, 101.6)).not.toBeNull();
  });

  it('stays quiet for a takedown the viewer made or saw: it is no news from out of sight', () => {
    const bell = new ClamorBell();
    bell.seen({ x: 0.5, y: 80, z: 20 }, 100);
    expect(bell.pick([near], self, 100.05)).toBeNull();
    // Another one elsewhere still rings.
    expect(bell.pick([far], self, 100.1)).not.toBeNull();
  });
});
