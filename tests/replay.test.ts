// The replay contract: a match rebuilt from (seed, picks, events) lands in
// EXACTLY the state the live match reached, commands, bot takeovers, and
// rejoins included. This is the determinism invariant earning its keep.

import { describe, expect, it } from 'vitest';
import { fillWithBots } from '../server/bot_fill';
import { Match } from '../server/match';
import { starOrchard } from '../server/star_orchard';
import { applyReplayEvent, buildMatchSim, type ReplayRecord } from '../src/net/replay';
import type { Sim } from '../src/sim/sim';
import type { TeamId } from '../src/sim/types';

function fingerprint(sim: Sim): string {
  return JSON.stringify({
    time: sim.time.toFixed(4),
    winner: sim.winner,
    units: [...sim.units.values()].map((u) => ({
      id: u.id,
      x: u.pos.x.toFixed(4),
      z: u.pos.z.toFixed(4),
      hp: u.hp.toFixed(4),
      level: u.level,
      gold: Math.round(u.gold),
      dead: u.dead,
    })),
    score: sim.scoreboard(),
  });
}

describe('deterministic replay', () => {
  it('rebuilds the exact live state from seed, picks, and events', () => {
    const picks = fillWithBots([
      { clientId: 1, name: 'alice', team: 0, championId: 'fenn', sigils: ['riftstep', 'mend'] },
      { clientId: 2, name: 'bob', team: 1, championId: 'vesk', sigils: ['sear', 'zephyr'] },
    ]);
    const live = new Match(987654, picks);
    const aliceId = live.players.get(1)!.unitId;
    const bob = live.players.get(2)!;

    // A scripted six-hundred-tick match: orders, skills, casts, a shop
    // trip, a disconnect handing bob to a bot, and his rejoin.
    const TICKS = 600;
    for (let k = 0; k < TICKS; k++) {
      if (k === 20) live.handleCommand(1, { t: 'move', x: 40, z: 40 });
      if (k === 30) live.handleCommand(2, { t: 'move', x: 30, z: 35 });
      if (k === 60) live.handleCommand(1, { t: 'skill', key: 'Q' });
      if (k === 80) live.handleCommand(1, { t: 'cast', key: 'Q', x: 42, z: 41 });
      if (k === 90) live.handleCommand(1, { t: 'buy', itemId: 'long_blade' });
      if (k === 120) live.handleCommand(1, { t: 'attack_move', x: 55, z: 55 });
      if (k === 200) live.handleDisconnect(2);
      if (k === 340) {
        live.restorePlayer(2, { name: bob.name, team: bob.team, unitId: bob.unitId });
      }
      if (k === 360) live.handleCommand(2, { t: 'move', x: 20, z: 60 });
      if (k === 400) live.handleCommand(1, { t: 'recall' });
      // Junk must no-op identically on both sides.
      if (k === 410) live.handleCommand(1, { t: 'move', x: Number.NaN, z: 2 });
      live.tick();
    }
    expect(live.replayEvents.length).toBeGreaterThan(5);
    expect(live.replayComplete).toBe(true);

    const record: ReplayRecord = {
      version: 1,
      seed: live.seed,
      picks: live.replayPicks,
      events: live.replayEvents,
      ticks: TICKS,
    };
    // What the browser does: rebuild and refeed.
    const { sim, unitIds } = buildMatchSim(starOrchard(), record.seed, record.picks);
    const unitTeams = new Map<number, TeamId>();
    record.picks.forEach((p, i) => {
      unitTeams.set(unitIds[i]!, p.team);
    });
    let next = 0;
    for (let k = 0; k < record.ticks; k++) {
      while (next < record.events.length && record.events[next]!.k <= k) {
        applyReplayEvent(sim, unitTeams, record.events[next]!);
        next++;
      }
      sim.tick();
    }
    expect(next).toBe(record.events.length);
    expect(fingerprint(sim)).toBe(fingerprint(live.sim));
    // Sanity: the scripted match actually moved things.
    const alice = sim.units.get(aliceId);
    expect(alice && (alice.pos.x !== 0 || alice.level > 1)).toBeTruthy();
  });
});
