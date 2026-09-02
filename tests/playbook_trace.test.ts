// The active play as a sim event (ADR 0013, plan-bots phase 2): a playbook
// seat writes what it is doing, the event reaches allied clients only, a
// replay regenerates it, the trace changes nothing about the decisions,
// and the report counts time and deaths per play.

import { describe, expect, it } from 'vitest';
import { fillWithBots } from '../server/bot_fill';
import { buildSnapshot } from '../server/snapshot';
import { ClientWorld } from '../src/net/client_world';
import type { ServerMsg } from '../src/net/protocol';
import { buildMatchSim } from '../src/net/replay';
import { LANER } from '../src/sim/content/bots/laner';
import { LANER_PLAYBOOK } from '../src/sim/content/playbooks/laner';
import { PlayLedger } from '../src/sim/playbook';
import { Sim, type SimEvent } from '../src/sim/sim';

function digest(sim: Sim): string {
  return [...sim.units.values()]
    .sort((a, b) => a.id - b.id)
    .map((u) => `${u.id}:${u.pos.x.toFixed(6)}:${u.pos.z.toFixed(6)}:${u.hp.toFixed(6)}`)
    .join('|');
}

interface PlayEvent {
  tick: number;
  unitId: number;
  playId: string;
}

function playEvents(sim: Sim, ticks: number): PlayEvent[] {
  const out: PlayEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    for (const ev of sim.tick()) {
      if (ev.type === 'play')
        out.push({ tick: sim.tickCount, unitId: ev.unitId, playId: ev.playId });
    }
  }
  return out;
}

describe('the active play', () => {
  it('is written on the unit and emitted when it changes', () => {
    const { sim } = buildMatchSim(11, fillWithBots([]));
    const events = playEvents(sim, 400);
    expect(events.length).toBeGreaterThan(0);
    for (const u of sim.units.values()) {
      if (u.kind === 'champion') expect(u.play, `unit ${u.id}`).not.toBeNull();
    }
    const last = new Map<number, string>();
    for (const ev of events) {
      expect(last.get(ev.unitId)).not.toBe(ev.playId);
      last.set(ev.unitId, ev.playId);
    }
    for (const u of sim.units.values()) {
      if (u.kind === 'champion') expect(last.get(u.id)).toBe(u.play);
    }
  });

  it('regenerates identically in a replay', () => {
    const a = playEvents(buildMatchSim(12, fillWithBots([])).sim, 600);
    const b = playEvents(buildMatchSim(12, fillWithBots([])).sim, 600);
    expect(a).toEqual(b);
  });

  it('changes nothing about the decisions', () => {
    const traced = buildMatchSim(13, fillWithBots([])).sim;
    const bare = new Sim(13);
    for (const p of fillWithBots([])) {
      const unit = bare.addChampion(p.team, undefined, p.championId, p.skin ?? 0);
      unit.sigils = [...p.sigils];
      bare.attachPolicy(unit.id, LANER.policy);
    }
    for (let i = 0; i < 2000; i++) {
      traced.tick();
      bare.tick();
    }
    expect(digest(traced)).toBe(digest(bare));
    for (const u of bare.units.values()) expect(u.play).toBeNull();
  });

  it('clears when a human takes the seat back', () => {
    const sim = new Sim(3);
    const me = sim.addChampion(0);
    sim.attachPlaybook(me.id, LANER_PLAYBOOK);
    for (let i = 0; i < 40; i++) sim.tick();
    expect(me.play).not.toBeNull();
    sim.detachPolicy(me.id);
    expect(me.play).toBeNull();
  });

  it('reaches allied clients only, and the mirror world applies it', () => {
    const { sim } = buildMatchSim(14, fillWithBots([]));
    for (let i = 0; i < 100; i++) sim.tick();
    const champions = [...sim.units.values()].filter((u) => u.kind === 'champion');
    const mine = champions.find((u) => u.team === 0)!;
    // A coach order rides along the same way: the ally's stands in the
    // snapshot, the enemy's never leaves the server.
    const theirs = champions.find((u) => u.team === 1)!;
    sim.setCoachOrder(mine.id, { kind: 'warden' });
    sim.setCoachOrder(theirs.id, { kind: 'back' });
    const snap = buildSnapshot(sim, 0, mine.id, new Set(), []);
    if (snap.t !== 'snap') throw new Error('expected a snapshot');
    for (const row of snap.units) {
      const u = sim.units.get(row.i)!;
      if (u.kind !== 'champion') continue;
      if (u.team === 0) expect(row.p, `ally ${u.id}`).toBe(u.play);
      else expect(row.p, `enemy ${u.id}`).toBeUndefined();
      if (u.id === mine.id) expect(row.co).toEqual({ kind: 'warden' });
      if (u.id === theirs.id) expect(row.co).toBeUndefined();
    }
    const world = new ClientWorld(() => undefined);
    world.applyServer(snap as ServerMsg);
    for (const row of snap.units) {
      expect(world.units.get(row.i)?.play ?? null).toBe(row.p ?? null);
      expect(world.units.get(row.i)?.coachOrder ?? null).toEqual(row.co ?? null);
    }
  });
});

describe('the play report', () => {
  it('counts ticks and deaths per play, open spans included', () => {
    const ledger = new PlayLedger();
    const at = (tick: number, ...events: SimEvent[]) => ledger.observe(tick, events);
    at(0, { type: 'play', unitId: 1, playId: 'farm' });
    at(100, { type: 'play', unitId: 1, playId: 'fight' });
    at(150, { type: 'death', unitId: 1, killerId: 2 });
    at(160, { type: 'play', unitId: 1, playId: 'retreat' });
    at(170, { type: 'play', unitId: 2, playId: 'push' });
    at(200);
    const report = ledger.report();
    expect(report.ticks).toBe(200);
    expect(report.units).toEqual([
      {
        unitId: 1,
        deaths: 1,
        plays: {
          farm: { ticks: 100, deaths: 0 },
          fight: { ticks: 60, deaths: 1 },
          retreat: { ticks: 40, deaths: 0 },
        },
      },
      { unitId: 2, deaths: 0, plays: { push: { ticks: 30, deaths: 0 } } },
    ]);
    // Reading did not close the open spans: a later tick still extends them.
    at(220);
    expect(ledger.report().units[0]!.plays.retreat!.ticks).toBe(60);
  });

  it('follows a real match', () => {
    const { sim } = buildMatchSim(15, fillWithBots([]));
    const ledger = new PlayLedger();
    for (let i = 0; i < 2000; i++) ledger.observe(sim.tickCount + 1, sim.tick());
    const report = ledger.report();
    expect(report.units.length).toBe(10);
    for (const u of report.units) {
      const total = Object.values(u.plays).reduce((n, s) => n + s.ticks, 0);
      expect(total).toBeGreaterThan(0);
      expect(total).toBeLessThanOrEqual(2000);
    }
  });
});
