// The guard that keeps a replay honest (src/sim/content/fingerprint.ts).
//
// A replay is a re-simulation, not a recording: the viewer rebuilds the
// match from the seed and the picks. That is exact while the content the
// sim reads is the content that played, and silently WRONG when it is
// not, which is the one way a replay can show a match that never
// happened. The hand-bumped REPLAY_VERSION covers changes to the sim's
// code; this covers changes to its tables, without anybody remembering.

import { describe, expect, it } from 'vitest';
import { starOrchard } from '../server/star_orchard';
import { runFastMatch } from '../src/fast_match';
import {
  buildMatchSim,
  CHECK_TICKS,
  expectedCheck,
  REPLAY_VERSION,
  replayPlayable,
} from '../src/net/replay';
import { CHAMPION_LIST } from '../src/sim/content/champions';
import { contentFingerprint, contentMatches, fingerprintOf } from '../src/sim/content/fingerprint';

describe('the content fingerprint', () => {
  it('is stable across calls', () => {
    expect(contentFingerprint(starOrchard())).toBe(contentFingerprint(starOrchard()));
    expect(contentFingerprint(starOrchard())).toMatch(/^[0-9a-f]{8}$/);
  });

  it('moves when a number in the tables moves, which is the whole point', () => {
    const champion = CHAMPION_LIST[0];
    expect(champion).toBeDefined();
    if (!champion) return;
    const shape = (hp: number): unknown => ({
      dt: 0.05,
      champions: [{ id: champion.id, base: { ...champion.base, hp }, growth: champion.growth }],
    });
    // One point of health on one champion, and the fingerprint is a
    // different string: yesterday's replay stops playing rather than
    // playing a match that never happened.
    expect(fingerprintOf(shape(champion.base.hp))).not.toBe(
      fingerprintOf(shape(champion.base.hp + 1)),
    );
    // The same content in another key order is the same content.
    expect(fingerprintOf({ a: 1, b: [2, 3] })).toBe(fingerprintOf({ b: [2, 3], a: 1 }));
  });

  it('accepts a record with no fingerprint, and refuses one that has moved', () => {
    // Records written before this existed carry none: refusing every
    // replay already on disk would be a worse lie than the one this
    // prevents.
    expect(contentMatches(undefined, starOrchard())).toBe(true);
    expect(contentMatches(contentFingerprint(starOrchard()), starOrchard())).toBe(true);
    expect(contentMatches('deadbeef', starOrchard())).toBe(false);
  });

  it('gates a replay on the version AND the content', () => {
    const content = contentFingerprint(starOrchard());
    expect(replayPlayable({ version: REPLAY_VERSION, content }, starOrchard())).toBe(true);
    expect(replayPlayable({ version: REPLAY_VERSION, content: undefined }, starOrchard())).toBe(
      true,
    );
    expect(replayPlayable({ version: REPLAY_VERSION, content: 'deadbeef' }, starOrchard())).toBe(
      false,
    );
    expect(replayPlayable({ version: REPLAY_VERSION - 1, content }, starOrchard())).toBe(false);
  });

  it('is stamped on every record a match writes', () => {
    // The one producer every bot match goes through: the Arena runs it in
    // a worker, the Academy's sparring in the browser, both keeping the
    // record it returns.
    const picks = [
      {
        name: 'a',
        team: 0 as const,
        championId: 'korrath',
        sigils: ['riftstep', 'mend'] as [string, string],
        bot: 'laner',
      },
      {
        name: 'b',
        team: 1 as const,
        championId: 'sylra',
        sigils: ['riftstep', 'mend'] as [string, string],
        bot: 'laner',
      },
    ];
    const r = runFastMatch(starOrchard(), { seed: 7, picks, maxTicks: 50 });
    expect(r.record.content).toBe(contentFingerprint(starOrchard()));
    expect(replayPlayable(r.record, starOrchard())).toBe(true);
  });
});

describe('the check trail', () => {
  const picks = [
    {
      name: 'a',
      team: 0 as const,
      championId: 'korrath',
      sigils: ['riftstep', 'mend'] as [string, string],
      bot: 'laner',
    },
    {
      name: 'b',
      team: 1 as const,
      championId: 'sylra',
      sigils: ['riftstep', 'mend'] as [string, string],
      bot: 'brawler',
    },
  ];

  it('is written every CHECK_TICKS and matches a faithful replay tick for tick', () => {
    const r = runFastMatch(starOrchard(), { seed: 3, picks, maxTicks: 1000 });
    expect(r.record.checks?.length).toBe(Math.floor(r.ticks / CHECK_TICKS));
    // The replay's own path: rebuild, tick, and compare at every mark.
    const { sim } = buildMatchSim(starOrchard(), r.record.seed, r.record.picks);
    let compared = 0;
    while (sim.tickCount < r.ticks) {
      sim.tick();
      const want = expectedCheck(r.record, sim.tickCount);
      if (want === null) continue;
      compared += 1;
      expect(sim.checksum()).toBe(want);
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('catches a replay that has drifted, which is the whole point', () => {
    const r = runFastMatch(starOrchard(), { seed: 3, picks, maxTicks: 600 });
    const { sim } = buildMatchSim(starOrchard(), r.record.seed, r.record.picks);
    // A match that plays out differently: one champion nudged, the way a
    // changed number would nudge it.
    while (sim.tickCount < CHECK_TICKS) {
      sim.tick();
      if (sim.tickCount === 10) {
        const unit = [...sim.units.values()].find((u) => u.kind === 'champion');
        if (unit) unit.pos.x += 1;
      }
    }
    expect(sim.checksum()).not.toBe(expectedCheck(r.record, CHECK_TICKS));
  });

  it('says nothing about a record that carries no trail, or a tick off the cadence', () => {
    const r = runFastMatch(starOrchard(), { seed: 3, picks, maxTicks: 400 });
    expect(expectedCheck({ ...r.record, checks: undefined }, CHECK_TICKS)).toBe(null);
    expect(expectedCheck(r.record, CHECK_TICKS - 1)).toBe(null);
    expect(expectedCheck(r.record, 0)).toBe(null);
  });
});
