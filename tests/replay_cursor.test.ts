// Seeking on checkpoints (playtest round 3): the worker's pass posts a
// checkpoint every ten seconds of match with the marks found since; the
// cursor reaches any tick from the nearest one, forward or back, landing
// on the exact world a straight run reaches; reverse playback's ring lands
// on exact ticks too; and the marks name kills, structures and the Warden
// with the side that scored.

import { describe, expect, it } from 'vitest';
import { CHECKPOINT_TICKS, ReplayCursor, RING_TICKS } from '../src/game/replay_cursor';
import { MarkCollector } from '../src/game/replay_marks';
import { type ReplayWorkerOut, runReplayPass } from '../src/game/replay_worker';
import { sparMatch, sparringPicks } from '../src/game/sparring_core';
import {
  applyReplayEvent,
  buildMatchSim,
  type ReplayRecord,
  restorePolicies,
} from '../src/net/replay';
import { LANER_PLAYBOOK } from '../src/sim/content/playbooks/laner';
import type { Sim } from '../src/sim/sim';
import type { TeamId } from '../src/sim/types';

function fingerprint(sim: Sim): string {
  return JSON.stringify({
    tick: sim.tickCount,
    rng: sim.rng.state,
    units: [...sim.units.values()].map((u) => [
      u.id,
      u.pos.x.toFixed(4),
      u.pos.z.toFixed(4),
      u.hp.toFixed(3),
      u.dead,
      u.play,
    ]),
    score: sim.scoreboard(),
  });
}

const TICKS = 1000;
const bot = {
  name: 'Nightfall',
  championId: 'vesk',
  sigils: ['riftstep', 'sear'] as [string, string],
  skin: 1,
  playbook: LANER_PLAYBOOK,
};
const record: ReplayRecord = sparMatch({
  seed: 31,
  picks: sparringPicks(bot, 31),
  maxTicks: TICKS,
}).record;

function straight(tick: number): string {
  const { sim } = buildMatchSim(record.seed, record.picks);
  while (sim.tickCount < tick) sim.tick();
  return fingerprint(sim);
}

describe('the replay pass', () => {
  const out: ReplayWorkerOut[] = [];
  runReplayPass(record, (m) => out.push(m));

  it('posts a checkpoint at tick zero and every CHECKPOINT_TICKS, then done', () => {
    const ticks = out.flatMap((m) => (m.kind === 'checkpoint' ? [m.snapshot.tick] : []));
    expect(ticks).toEqual([0, 200, 400, 600, 800, 1000]);
    expect(out[out.length - 1]).toMatchObject({ kind: 'done', ticks: TICKS });
    expect(CHECKPOINT_TICKS).toBe(200);
  });

  it('checkpoints restore into the straight run', () => {
    const { sim } = buildMatchSim(record.seed, record.picks);
    for (const m of out) {
      if (m.kind !== 'checkpoint' || m.snapshot.tick === 0) continue;
      sim.restore(m.snapshot);
      while (sim.tickCount < TICKS) sim.tick();
      expect(fingerprint(sim)).toBe(straight(TICKS));
    }
  });
});

// A match whose seats change hands: one seat with nobody behind it, handed
// to a bot on a disconnect, taken back on a rejoin, handed over again. A
// checkpoint carries no policies, so a restore across those events has to
// put them back from the record (restorePolicies) or the seat is driven
// by the wrong hands: forward, a bot never attached in the viewer's sim;
// backward, a bot still attached from later in the match.
describe('checkpoints across a disconnect and a rejoin', () => {
  const seed = 47;
  const picks = sparringPicks(bot, seed).map((p, i) => {
    if (i !== 1) return p;
    const { bot: _house, ...human } = p;
    return human;
  });
  const first = buildMatchSim(seed, picks);
  const unitIds = first.unitIds;
  const human = unitIds[1]!;
  const teams = new Map<number, TeamId>();
  for (const [i, p] of picks.entries()) teams.set(unitIds[i]!, p.team);
  const rec: ReplayRecord = {
    version: 0,
    seed,
    picks,
    events: [
      { k: 300, u: human, e: 'bot_on' },
      { k: 650, u: human, e: 'bot_off' },
      { k: 700, u: human, e: 'bot_on' },
    ],
    ticks: TICKS,
  };
  const runTo = (sim: Sim, from: number, to: number): number => {
    let next = from;
    while (sim.tickCount < to) {
      while (next < rec.events.length && rec.events[next]!.k <= sim.tickCount) {
        applyReplayEvent(sim, teams, rec.events[next]!);
        next++;
      }
      sim.tick();
    }
    return next;
  };
  const eventsAt = (tick: number): number => rec.events.filter((e) => e.k < tick).length;
  const out: ReplayWorkerOut[] = [];
  runReplayPass(rec, (m) => out.push(m));
  const checkpoints = out.flatMap((m) => (m.kind === 'checkpoint' ? [m.snapshot] : []));
  runTo(first.sim, 0, TICKS);
  const truth = fingerprint(first.sim);

  it('the pass itself lands where the straight run does', () => {
    const { sim } = buildMatchSim(seed, picks);
    sim.restore(checkpoints.at(-1)!);
    expect(fingerprint(sim)).toBe(truth);
  });

  it('forward: a fresh sim restored past the handovers drives the seat', () => {
    for (const snap of checkpoints) {
      if (snap.tick === 0) continue;
      const { sim } = buildMatchSim(seed, picks);
      sim.restore(snap);
      restorePolicies(sim, picks, unitIds, rec.events, snap.tick);
      runTo(sim, eventsAt(snap.tick), TICKS);
      expect(fingerprint(sim)).toBe(truth);
    }
  });

  it('backward: restoring before a handover takes the bot off again', () => {
    const sim = first.sim;
    const before = checkpoints.find((s) => s.tick === 200)!;
    sim.restore(before);
    restorePolicies(sim, picks, unitIds, rec.events, before.tick);
    expect(sim.policies.has(human)).toBe(false);
    runTo(sim, eventsAt(before.tick), TICKS);
    expect(fingerprint(sim)).toBe(truth);
  });

  it('without the policies put back, the seat is driven by the wrong hands', () => {
    const { sim } = buildMatchSim(seed, picks);
    const snap = checkpoints.find((s) => s.tick === 400)!;
    sim.restore(snap);
    runTo(sim, eventsAt(snap.tick), TICKS);
    expect(fingerprint(sim)).not.toBe(truth);
  });
});

describe('the cursor', () => {
  function host() {
    const built = buildMatchSim(record.seed, record.picks);
    const h = {
      sim: built.sim,
      step: () => {
        built.sim.tick();
      },
      restored: (_tick: number) => {},
    };
    const cursor = new ReplayCursor(h);
    runReplayPass(record, (m) => {
      if (m.kind === 'checkpoint') cursor.addCheckpoint(m.snapshot);
    });
    return { sim: built.sim, cursor };
  }

  it('reaches a tick ahead from the nearest checkpoint below it, exactly', () => {
    const { sim, cursor } = host();
    expect(cursor.covered).toBe(TICKS);
    expect(cursor.prepare(650)).toBe(true);
    expect(sim.tickCount).toBe(600);
    expect(cursor.advance(650, 400)).toBe(true);
    expect(fingerprint(sim)).toBe(straight(650));
    // A short hop ahead steps from where it stands rather than restoring.
    expect(cursor.prepare(700)).toBe(true);
    expect(sim.tickCount).toBe(650);
    expect(cursor.advance(700, 400)).toBe(true);
    expect(fingerprint(sim)).toBe(straight(700));
  });

  it('reaches a tick behind from the checkpoint below it, chunked', () => {
    const { sim, cursor } = host();
    cursor.prepare(900);
    cursor.advance(900, 1000);
    expect(cursor.prepare(150)).toBe(true);
    expect(sim.tickCount).toBe(0);
    expect(cursor.advance(150, 100)).toBe(false);
    expect(sim.tickCount).toBe(100);
    expect(cursor.advance(150, 100)).toBe(true);
    expect(fingerprint(sim)).toBe(straight(150));
  });

  it('says no when a tick behind has no checkpoint yet', () => {
    const built = buildMatchSim(record.seed, record.picks);
    const cursor = new ReplayCursor({
      sim: built.sim,
      step: () => {
        built.sim.tick();
      },
      restored: () => {},
    });
    cursor.advance(300, 1000);
    expect(cursor.prepare(100)).toBe(false);
    expect(cursor.prepare(350)).toBe(true);
  });

  it('walks backward on the ring, landing on exact ticks', () => {
    const { sim, cursor } = host();
    cursor.prepare(590);
    cursor.advance(590, 1000);
    expect(cursor.backTo(585)).toBe(true);
    expect(sim.tickCount).toBe(585);
    expect(fingerprint(sim)).toBe(straight(585));
    expect(cursor.backTo(577)).toBe(true);
    expect(fingerprint(sim)).toBe(straight(577));
    // Into the previous window: a new ring, the same exactness.
    expect(cursor.backTo(399)).toBe(true);
    expect(fingerprint(sim)).toBe(straight(399));
    expect(RING_TICKS).toBe(10);
    cursor.dropRing();
    expect(cursor.backTo(0)).toBe(true);
    expect(sim.tickCount).toBe(0);
  });
});

describe('the marks', () => {
  it('date champion kills with the killer’s side, and nothing for minions', () => {
    const { sim } = buildMatchSim(record.seed, record.picks);
    const marks = new MarkCollector();
    while (sim.tickCount < 4000) {
      marks.note(sim.units);
      marks.observe(sim.tickCount + 1, sim.tick());
    }
    expect(marks.marks.length).toBeGreaterThan(0);
    for (const m of marks.marks) {
      expect(['kill', 'tower', 'sanctum', 'warden']).toContain(m.kind);
      expect(m.tick).toBeGreaterThan(0);
      if (m.kind === 'kill') expect([0, 1]).toContain(m.team);
    }
    const kills = marks.marks.filter((m) => m.kind === 'kill');
    expect(kills.length).toBeGreaterThan(0);
    // Ticks are in order, as the timeline expects.
    for (let i = 1; i < marks.marks.length; i++) {
      expect(marks.marks[i]!.tick).toBeGreaterThanOrEqual(marks.marks[i - 1]!.tick);
    }
  });
});
