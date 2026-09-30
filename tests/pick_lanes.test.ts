// A seat's own lane preference in the sim (Sim.pickLanes, Unit.pickedLanes;
// CONTEXT.md: Lane preference, Assigned lane; ADR 0026): it goes in ahead
// of the home lane, a bot's playbook lanes go ahead of it, a stand-in's
// playbook never wipes it, the stand-in on a forest seat is the Jungler,
// and the live match, its replay and a checkpoint restore all agree.

import { describe, expect, it } from 'vitest';
import { Match, type MatchPick } from '../server/match';
import { starOrchard } from '../server/star_orchard';
import {
  applyReplayEvent,
  buildMatchSim,
  type ReplayEvent,
  type ReplayPick,
  restorePolicies,
} from '../src/net/replay';
import { attachBot, botPolicy, DEFAULT_BOT_ID, defaultBotId } from '../src/sim/content/bots';
import { houseName, houseSeats } from '../src/sim/content/bots/house';
import { JUNGLER } from '../src/sim/content/bots/jungler';
import { JUNGLER_PLAYBOOK } from '../src/sim/content/playbooks/jungler';
import type { HeldSeat } from '../src/sim/fill';
import type { LanePreference } from '../src/sim/playbook/types';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import type { TeamId } from '../src/sim/types';

const lanesOf = (sim: Sim): Record<number, string | null> =>
  Object.fromEntries(
    [...sim.units.values()].filter((u) => u.kind === 'champion').map((u) => [u.id, u.lane]),
  );

function fingerprint(sim: Sim): string {
  return JSON.stringify({
    time: sim.time.toFixed(4),
    tick: sim.tickCount,
    winner: sim.winner,
    rng: sim.rng.state,
    units: [...sim.units.values()].map((u) => ({
      id: u.id,
      x: u.pos.x.toFixed(4),
      z: u.pos.z.toFixed(4),
      hp: u.hp.toFixed(4),
      level: u.level,
      gold: Math.round(u.gold),
      dead: u.dead,
      lane: u.lane,
      lanePrefer: u.lanePrefer,
      pickedLanes: u.pickedLanes,
      play: u.play,
    })),
    score: sim.scoreboard(),
  });
}

describe('a seat asking for its lane', () => {
  it('goes ahead of the home lane, the forest meaning no lane, and draws nothing', () => {
    const sim = new Sim(3);
    const rng = sim.rng.state;
    const vesk = sim.addChampion(0, undefined, 'vesk');
    const sylra = sim.addChampion(0, undefined, 'sylra');
    expect([vesk.lane, sylra.lane]).toEqual(['bot', 'mid']);
    sim.pickLanes(vesk.id, ['mid']);
    // The marksman seated first takes mid; the mage goes where most room is.
    expect(vesk.pickedLanes).toEqual(['mid']);
    expect([vesk.lane, sylra.lane]).toEqual(['mid', 'top']);
    sim.pickLanes(sylra.id, ['jungle']);
    expect(sylra.lane).toBeNull();
    // Asking nothing again gives the home lane back.
    sim.pickLanes(vesk.id, null);
    expect(vesk.pickedLanes).toBeNull();
    expect(vesk.lane).toBe('bot');
    expect(sim.rng.state).toBe(rng);
  });

  it("a playbook's own lanes go ahead of the seat's; a playbook stating none leaves the seat's", () => {
    const sim = new Sim(3);
    const vesk = sim.addChampion(0, undefined, 'vesk');
    sim.pickLanes(vesk.id, ['mid']);
    sim.attachPlaybook(vesk.id, { ...JUNGLER_PLAYBOOK, lanes: ['top'] });
    expect(vesk.lane).toBe('top');
    attachBot(sim, vesk.id, DEFAULT_BOT_ID);
    expect(vesk.lanePrefer).toBeNull();
    expect(vesk.lane).toBe('mid');
  });

  it("a stand-in holds the seat's lane and moves no teammate; on a forest seat it is the Jungler", () => {
    const sim = new Sim(5);
    const asks: [string, LanePreference][] = [
      ['sylra', 'jungle'],
      ['vesk', 'mid'],
      ['korrath', 'top'],
      ['torv', 'bot'],
      ['ashvyn', 'bot'],
    ];
    const units = asks.map(([id, lane]) => {
      const u = sim.addChampion(0, undefined, id);
      sim.pickLanes(u.id, [lane]);
      return u;
    });
    expect(units.map((u) => u.lane)).toEqual([null, 'mid', 'top', 'bot', 'bot']);
    const before = lanesOf(sim);
    expect(defaultBotId(sim, units[0]!.id)).toBe(JUNGLER.id);
    expect(defaultBotId(sim, units[1]!.id)).toBe(DEFAULT_BOT_ID);
    expect(defaultBotId(sim)).toBe(DEFAULT_BOT_ID);
    for (const u of units) attachBot(sim, u.id, undefined);
    expect(units[0]!.lanePrefer).toEqual(['jungle']);
    expect(units[1]!.lanePrefer).toBeNull();
    expect(lanesOf(sim)).toEqual(before);
    // The policy alone, for a checkpoint restore, chooses the same bot.
    expect(botPolicy(sim, undefined, units[0]!.id)).not.toBeNull();
  });

  it('a seat that asked nothing still gets the Laner, and the lanes are dealt as before', () => {
    const sim = new Sim(5);
    const u = sim.addChampion(0, undefined, 'korrath');
    sim.attachPlaybook(u.id, JUNGLER_PLAYBOOK);
    expect(u.lane).toBeNull();
    expect(defaultBotId(sim, u.id)).toBe(DEFAULT_BOT_ID);
    attachBot(sim, u.id, undefined);
    expect(u.lanePrefer).toBeNull();
    expect(u.lane).toBe('top');
  });
});

// Two people and the house around their asks, every house seat carrying
// its seat's lane, as the server seats a match (server/bot_fill.ts).
function lanedLineup(seed: number): MatchPick[] {
  const humans: MatchPick[] = [
    {
      clientId: 1,
      name: 'alice',
      team: 0,
      championId: 'sylra',
      sigils: ['riftstep', 'mend'],
      lanes: ['jungle'],
    },
    {
      clientId: 2,
      name: 'bob',
      team: 1,
      championId: 'vesk',
      sigils: ['sear', 'zephyr'],
      lanes: ['mid'],
    },
  ];
  const out = [...humans];
  const rng = new Rng(seed);
  let clientId = -1;
  for (const team of [0, 1] as const satisfies readonly TeamId[]) {
    const held: HeldSeat[] = out
      .filter((p) => p.team === team)
      .map((p) => ({ championId: p.championId, lane: p.lanes?.[0] ?? null }));
    for (const seat of houseSeats(held, rng)) {
      out.push({
        clientId: clientId--,
        name: houseName(seat.bot),
        team,
        championId: seat.championId,
        sigils: ['riftstep', 'mend'],
        bot: seat.bot,
        lanes: [seat.lane],
      });
    }
  }
  return out;
}

describe('the chosen lane through a live match and its replay', () => {
  it('holds from the first tick through a disconnect and a rejoin, live and replayed alike', () => {
    const seed = 424242;
    const live = new Match(seed, lanedLineup(seed));
    const alice = live.players.get(1)!;
    const bob = live.players.get(2)!;
    const aliceUnit = live.sim.units.get(alice.unitId)!;
    const bobUnit = live.sim.units.get(bob.unitId)!;
    // The replay records what each seat asked.
    expect(live.replayPicks[0]!.lanes).toEqual(['jungle']);
    expect(live.replayPicks[1]!.lanes).toEqual(['mid']);
    expect(live.replayPicks.every((p) => p.lanes?.length === 1)).toBe(true);
    // Dealt as asked, each team one of each: no house Jungler beside alice.
    expect(aliceUnit.lane).toBeNull();
    expect(bobUnit.lane).toBe('mid');
    for (const team of [0, 1] as const) {
      const lanes = [...live.sim.units.values()]
        .filter((u) => u.kind === 'champion' && u.team === team)
        .map((u) => u.lane ?? 'forest')
        .sort();
      expect(lanes).toEqual(['bot', 'bot', 'forest', 'mid', 'top']);
    }
    const dealt = lanesOf(live.sim);

    const TICKS = 500;
    for (let k = 0; k < TICKS; k++) {
      if (k === 20) live.handleCommand(1, { t: 'move', x: 40, z: 40 });
      if (k === 30) live.handleCommand(2, { t: 'move', x: 30, z: 35 });
      if (k === 100) {
        live.handleDisconnect(1);
        // The forest seat's stand-in is the Jungler.
        expect(aliceUnit.lanePrefer).toEqual(['jungle']);
        expect(live.sim.policies.has(alice.unitId)).toBe(true);
      }
      if (k === 150) {
        live.handleDisconnect(2);
        expect(bobUnit.lanePrefer).toBeNull();
      }
      if (k === 100 || k === 150) expect(lanesOf(live.sim)).toEqual(dealt);
      if (k === 300) {
        live.restorePlayer(1, { name: alice.name, team: alice.team, unitId: alice.unitId });
      }
      if (k === 320) {
        live.restorePlayer(2, { name: bob.name, team: bob.team, unitId: bob.unitId });
      }
      if (k === 340) live.handleCommand(2, { t: 'move', x: 20, z: 60 });
      live.tick();
    }
    expect(lanesOf(live.sim)).toEqual(dealt);
    expect(live.replayEvents.filter((e) => e.e !== 'cmd')).toHaveLength(4);

    const { sim, unitIds } = buildMatchSim(starOrchard(), seed, live.replayPicks);
    const unitTeams = new Map<number, TeamId>();
    live.replayPicks.forEach((p, i) => {
      unitTeams.set(unitIds[i]!, p.team);
    });
    expect(lanesOf(sim)).toEqual(dealt);
    let next = 0;
    for (let k = 0; k < TICKS; k++) {
      while (next < live.replayEvents.length && live.replayEvents[next]!.k <= k) {
        applyReplayEvent(sim, unitTeams, live.replayEvents[next]!);
        next++;
      }
      if (k === 101) expect(sim.units.get(alice.unitId)!.lanePrefer).toEqual(['jungle']);
      sim.tick();
    }
    expect(next).toBe(live.replayEvents.length);
    expect(fingerprint(sim)).toBe(fingerprint(live.sim));
  });

  it('a record without lanes seats and stands in as it always did', () => {
    const seed = 424242;
    const picks: ReplayPick[] = lanedLineup(seed).map(({ lanes: _lanes, clientId: _c, ...p }) => p);
    const { sim, unitIds } = buildMatchSim(starOrchard(), seed, picks);
    for (const id of unitIds) expect(sim.units.get(id)!.pickedLanes).toBeNull();
    // The person who asked for the forest is on her home lane instead,
    // and her stand-in is the Laner.
    expect(sim.units.get(unitIds[0]!)!.lane).toBe('mid');
    expect(defaultBotId(sim, unitIds[0]!)).toBe(DEFAULT_BOT_ID);
  });
});

describe('the chosen lane across a checkpoint', () => {
  const seed = 31;
  const picks: ReplayPick[] = lanedLineup(seed).map(({ clientId: _c, ...p }) => p);
  const straight = buildMatchSim(starOrchard(), seed, picks);
  const unitIds = straight.unitIds;
  const alice = unitIds[0]!;
  const teams = new Map<number, TeamId>();
  for (const [i, p] of picks.entries()) teams.set(unitIds[i]!, p.team);
  const events: ReplayEvent[] = [{ k: 300, u: alice, e: 'bot_on' }];
  const runTo = (sim: Sim, to: number): void => {
    let next = events.filter((e) => e.k < sim.tickCount).length;
    while (sim.tickCount < to) {
      while (next < events.length && events[next]!.k <= sim.tickCount) {
        applyReplayEvent(sim, teams, events[next]!);
        next++;
      }
      sim.tick();
    }
  };
  runTo(straight.sim, 400);
  const snap = structuredClone(straight.sim.snapshot());
  runTo(straight.sim, 900);
  const truth = fingerprint(straight.sim);

  it('restores the seat asks whole, and the seat-aware stand-in drives on', () => {
    const { sim } = buildMatchSim(starOrchard(), seed, picks);
    // A fresh sim scrambled first, so the asks must come from the checkpoint.
    for (const id of unitIds) sim.pickLanes(id, null);
    sim.restore(snap);
    for (const [i, p] of picks.entries()) {
      expect(sim.units.get(unitIds[i]!)!.pickedLanes).toEqual(p.lanes);
    }
    expect(sim.units.get(alice)!.lane).toBeNull();
    restorePolicies(sim, picks, unitIds, events, snap.tick);
    runTo(sim, 900);
    expect(fingerprint(sim)).toBe(truth);
  });

  it('with the Laner put back on the forest seat instead, the match goes elsewhere', () => {
    const { sim } = buildMatchSim(starOrchard(), seed, picks);
    sim.restore(snap);
    restorePolicies(sim, picks, unitIds, events, snap.tick);
    sim.attachPolicy(alice, botPolicy(sim, DEFAULT_BOT_ID)!);
    runTo(sim, 900);
    expect(fingerprint(sim)).not.toBe(truth);
  });
});
