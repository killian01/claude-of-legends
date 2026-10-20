// A bout's replay (ADR 0035, Replays and Versions): a bout rebuilt from its
// record by the one construction (src/net/replay.ts buildBoutSim, through
// loadRoyaleReplay) plays the bout it recorded, to its checksums, its
// counts and its ranking, and through a checkpoint restored midway; a count
// changed by hand moves the checksum; a record made under another version
// of its kind, another fingerprint of its kind's data or another engine is
// refused, as is a kind this build does not know. A battle royale's record
// plays as before.

import { describe, expect, it } from 'vitest';
import { loadRoyaleReplay, REPLAY_VERSION, royaleReplayPlayable } from '../src/net/replay';
import { boutFingerprint } from '../src/sim/content/bouts';
import { BOUT_ENGINE_VERSION } from '../src/sim/content/bouts/match';
import { boutResult } from '../src/sim/royale/bouts/end';
import { ROYALE_RULES_VERSION } from '../src/sim/royale/types';
import type { Sim } from '../src/sim/sim';
import { loadPlanet } from './royale_planet';
import { boutReplay, playOut, TEST_BOUT, TEST_KINDS, testKind } from './thornfray_fixture';

function replay(record = boutReplay({ prize: 1, seed: 21, region: 'groves' })) {
  const built = loadRoyaleReplay(loadPlanet(), record, TEST_KINDS);
  if (!built) throw new Error('refused');
  return built;
}

function summary(sim: Sim) {
  const r = boutResult(sim.royaleMode!, sim);
  return { checksum: sim.checksum(), ticks: sim.tickCount, counts: r.counts, ranking: r.ranking };
}

describe('a bout replay', () => {
  it('plays the bout it recorded: its checksums, its counts and its ranking', () => {
    const live = replay();
    const again = replay();
    const a = playOut(live.sim);
    const b = playOut(again.sim);
    expect(live.sim.royale!.stage).toBe('over');
    expect(b.checks).toEqual(a.checks);
    expect(summary(again.sim)).toEqual(summary(live.sim));
    // The counts moved: the scorer ran on the damage events.
    expect(summary(live.sim).counts.some((c) => c > 0)).toBe(true);
  });

  it('plays on alike from a checkpoint restored midway, the counts and goals with it', () => {
    const live = replay();
    while (live.sim.time < 50) live.sim.tick();
    const snap = live.sim.snapshot();
    const bout = structuredClone(live.sim.royale!.bout);
    playOut(live.sim);
    const end = summary(live.sim);
    live.sim.restore(snap);
    expect(live.sim.royale!.bout).toEqual(bout);
    playOut(live.sim);
    expect(summary(live.sim)).toEqual(end);
  });

  it('notices a count changed by hand', () => {
    const { sim } = replay();
    while (sim.time < 40) sim.tick();
    const before = sim.checksum();
    sim.royale!.bout!.counts[3]! += 1;
    expect(sim.checksum()).not.toBe(before);
  });

  it('is refused under another kind version, fingerprint or engine', () => {
    const record = boutReplay();
    const bout = record.royale!.bout!;
    expect(bout.version).toBe(TEST_BOUT.version);
    expect(bout.fingerprint).toBe(boutFingerprint(TEST_BOUT));
    expect(bout.engine).toBe(BOUT_ENGINE_VERSION);
    expect(royaleReplayPlayable(record, TEST_KINDS)).toBe(true);
    const moved = (b: Partial<typeof bout>) => ({
      ...record,
      royale: { ...record.royale!, bout: { ...bout, ...b } },
    });
    for (const other of [
      moved({ version: bout.version + 1 }),
      moved({ fingerprint: 'deadbeef' }),
      moved({ engine: BOUT_ENGINE_VERSION + 1 }),
      moved({ kind: 'nothing' }),
    ]) {
      expect(royaleReplayPlayable(other, TEST_KINDS)).toBe(false);
      expect(loadRoyaleReplay(loadPlanet(), other, TEST_KINDS)).toBeNull();
    }
    // A kind this build does not know, by default.
    expect(royaleReplayPlayable(record)).toBe(false);
    // The rules and the replay version still hold a bout too.
    expect(royaleReplayPlayable({ ...record, version: REPLAY_VERSION - 1 }, TEST_KINDS)).toBe(
      false,
    );
    expect(
      royaleReplayPlayable(
        { ...record, royale: { ...record.royale!, rules: ROYALE_RULES_VERSION + 1 } },
        TEST_KINDS,
      ),
    ).toBe(false);
  });

  it('moves the fingerprint with any change to a kind data', () => {
    expect(boutFingerprint(testKind({ playS: 91 }))).not.toBe(boutFingerprint(TEST_BOUT));
    expect(boutFingerprint(testKind({ caches: { count: 17, backS: 30 } }))).not.toBe(
      boutFingerprint(TEST_BOUT),
    );
    // Its words too: a record names the rule it was played under.
    expect(boutFingerprint(testKind({ rule: 'Another rule' }))).not.toBe(
      boutFingerprint(TEST_BOUT),
    );
    expect(boutFingerprint(testKind({}))).toBe(boutFingerprint(TEST_BOUT));
  });

  it('keeps a battle royale record a battle royale', () => {
    const record = boutReplay();
    const { bout: _bout, ...royale } = record.royale!;
    const plain = { ...record, picks: record.picks, royale };
    expect(royaleReplayPlayable(plain)).toBe(true);
    const built = loadRoyaleReplay(loadPlanet(), plain)!;
    expect(built.sim.royale!.bout).toBeUndefined();
    expect(built.sim.royaleMode!.bout).toBeNull();
  });
});
