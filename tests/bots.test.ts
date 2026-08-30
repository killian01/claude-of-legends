// Policy bots gate (ADR 0002 phase 1): observations respect the fog, the
// laner behaves (moves out, fights, retreats), bot fill builds legal
// rosters, and a full bot 5v5 stays deterministic.

import { describe, expect, it } from 'vitest';
import { fillWithBots } from '../server/bot_fill';
import { Match } from '../server/match';
import { BOTS, DEFAULT_BOT_ID } from '../src/sim/content/bots';
import { REGROUP_AT_S } from '../src/sim/content/bots/laner';
import { buildObservation } from '../src/sim/observe';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';

const laner = BOTS[DEFAULT_BOT_ID]!.policy;

describe('observations', () => {
  it('exclude fogged enemies and include what the team sees', () => {
    const sim = new Sim(41);
    const me = sim.addChampion(0, { x: 75, z: 75 });
    me.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    const hidden = sim.addChampion(1, { x: 140, z: 140 });
    const seen = sim.addChampion(1, { x: 80, z: 75 });
    sim.tick();
    const obs = buildObservation(sim, me.id);
    expect(obs).not.toBeNull();
    const ids = new Set(obs!.units.map((u) => u.id));
    expect(ids.has(seen.id)).toBe(true);
    expect(ids.has(hidden.id)).toBe(false);
    expect(ids.has(me.id)).toBe(false);
    expect(obs!.self.abilityReady.Q).toBe(true);
    expect(obs!.self.abilityReady.R).toBe(false);
  });
});

describe('the laner bot', () => {
  it('leaves its fountain and pushes toward the enemy', () => {
    const sim = new Sim(41);
    const bot = sim.addChampion(0);
    sim.attachPolicy(bot.id, laner);
    const start = { ...bot.pos };
    for (let i = 0; i < 300; i++) sim.tick();
    expect(Math.hypot(bot.pos.x - start.x, bot.pos.z - start.z)).toBeGreaterThan(15);
  });

  it('fights an enemy champion it can see', () => {
    const sim = new Sim(41);
    const bot = sim.addChampion(0, { x: 75, z: 75 });
    const victim = sim.addChampion(1, { x: 80, z: 75 });
    sim.attachPolicy(bot.id, laner);
    for (let i = 0; i < 120; i++) sim.tick();
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('recalls home when low with nobody around, and holds the channel', () => {
    const sim = new Sim(41);
    const bot = sim.addChampion(0, { x: 75, z: 75 });
    bot.sigils = ['riftstep', 'zephyr'];
    bot.hp = bot.maxHp * 0.2;
    sim.attachPolicy(bot.id, laner);
    const fountain = sim.map.fountains.find((f) => f.team === 0)!;
    // Alone and hurt, far from home: the channel starts instead of the
    // half-map walk, and later decisions keep noop-ing rather than
    // resetting the 8 second clock with a fresh order.
    for (let i = 0; i < 40; i++) sim.tick();
    expect(bot.statuses.some((s) => s.kind === 'recall')).toBe(true);
    for (let i = 0; i < 180; i++) sim.tick();
    expect(Math.hypot(bot.pos.x - fountain.x, bot.pos.z - fountain.z)).toBeLessThan(2);
  });

  it('walks home from its own base instead of channeling a slower recall', () => {
    const sim = new Sim(41);
    // Inside RECALL_MIN_HOME_DIST of the fountain (the base perimeter):
    // an 8 s channel here is strictly slower than walking.
    const bot = sim.addChampion(0, { x: 20, z: 24 });
    bot.sigils = ['riftstep', 'zephyr']; // no Mend: stay low, face the choice
    bot.hp = bot.maxHp * 0.2;
    sim.attachPolicy(bot.id, laner);
    const fountain = sim.map.fountains.find((f) => f.team === 0)!;
    const d0 = Math.hypot(bot.pos.x - fountain.x, bot.pos.z - fountain.z);
    for (let i = 0; i < 60; i++) {
      sim.tick();
      expect(bot.statuses.some((s) => s.kind === 'recall')).toBe(false);
    }
    expect(Math.hypot(bot.pos.x - fountain.x, bot.pos.z - fountain.z)).toBeLessThan(d0);
  });

  it('holds a running channel while an enemy hovers outside break range', () => {
    const sim = new Sim(41);
    const bot = sim.addChampion(0, { x: 75, z: 75 });
    bot.sigils = ['riftstep', 'zephyr']; // no Mend: stay low, start the channel
    bot.hp = bot.maxHp * 0.2;
    sim.attachPolicy(bot.id, laner);
    for (let i = 0; i < 40 && !bot.statuses.some((s) => s.kind === 'recall'); i++) sim.tick();
    expect(bot.statuses.some((s) => s.kind === 'recall')).toBe(true);
    // 13 away: inside the old single 14-unit radius that used to cancel
    // (and restart, and cancel, forever), outside the break radius.
    sim.addChampion(1, { x: 88, z: 75 });
    for (let i = 0; i < 30; i++) sim.tick();
    expect(bot.statuses.some((s) => s.kind === 'recall')).toBe(true);
  });

  it('goes home to spend a heavy purse and converts it into items', () => {
    const sim = new Sim(41);
    const bot = sim.addChampion(0, { x: 75, z: 75 });
    bot.gold = 3000;
    sim.attachPolicy(bot.id, laner);
    for (let i = 0; i < 700; i++) sim.tick();
    expect(bot.items.length).toBeGreaterThanOrEqual(2);
    expect(bot.gold).toBeLessThan(3000);
  });

  it('walks to a live Warden without waiting for an ally to go first', () => {
    const sim = new Sim(41);
    sim.objectives.nextSpawnAt = 1;
    for (let i = 0; i < 60 && ![...sim.units.values()].some((u) => u.kind === 'warden'); i++) {
      sim.tick();
    }
    const warden = [...sim.units.values()].find((u) => u.kind === 'warden')!;
    const toward = {
      x: warden.pos.x + (75 - warden.pos.x) * 0.8,
      z: warden.pos.z + (75 - warden.pos.z) * 0.8,
    };
    const bot = sim.addChampion(0, toward);
    sim.attachPolicy(bot.id, laner);
    const d0 = Math.hypot(bot.pos.x - warden.pos.x, bot.pos.z - warden.pos.z);
    for (let i = 0; i < 120; i++) sim.tick();
    const d1 = Math.hypot(bot.pos.x - warden.pos.x, bot.pos.z - warden.pos.z);
    expect(d1).toBeLessThan(d0 - 5);
  });

  it('after the regroup bell a side laner pushes mid instead of its lane', () => {
    const sim = new Sim(41);
    const bot = sim.addChampion(0, { x: 30, z: 105 });
    sim.attachPolicy(bot.id, laner);
    bot.lane = 'top';
    bot.skillPoints = 0;
    sim.time = REGROUP_AT_S + 1;
    const obs = buildObservation(sim, bot.id)!;
    const action = laner(obs, new Rng(7));
    expect(action.kind).toBe('move');
    if (action.kind === 'move') {
      // Mid runs the map diagonal: the ordered step leaves the top arc
      // (|x - z| = 75 at the start point) for it.
      expect(Math.abs(action.x - action.z)).toBeLessThan(20);
    }
  });
});

describe('bot fill', () => {
  it('fills both teams to five with unique champions per team', () => {
    const picks = fillWithBots([
      { clientId: 1, name: 'human', team: 0, championId: 'sylra', sigils: ['riftstep', 'mend'] },
    ]);
    expect(picks).toHaveLength(10);
    for (const team of [0, 1]) {
      const teamPicks = picks.filter((p) => p.team === team);
      expect(teamPicks).toHaveLength(5);
      expect(new Set(teamPicks.map((p) => p.championId)).size).toBe(5);
    }
    expect(picks.filter((p) => p.bot)).toHaveLength(9);
  });

  it('a filled match drives its bots: they move without any client', () => {
    const match = new Match(3, [
      ...fillWithBots([
        { clientId: 1, name: 'human', team: 0, championId: 'sylra', sigils: ['riftstep', 'mend'] },
      ]),
    ]);
    expect(match.players.size).toBe(1);
    const bots = [...match.sim.policies.keys()];
    expect(bots).toHaveLength(9);
    const startPositions = bots.map((id) => ({ ...match.sim.units.get(id)!.pos }));
    for (let i = 0; i < 200; i++) match.tick();
    const moved = bots.filter((id, i) => {
      const u = match.sim.units.get(id)!;
      return Math.hypot(u.pos.x - startPositions[i]!.x, u.pos.z - startPositions[i]!.z) > 5;
    });
    expect(moved.length).toBeGreaterThan(6);
  });
});

describe('full bot 5v5', () => {
  it('stays deterministic and produces real combat', () => {
    const run = () => {
      const sim = new Sim(55);
      const roster = [
        'korrath',
        'dain',
        'sylra',
        'fenn',
        'elowen',
        'vesk',
        'ashvyn',
        'maera',
        'torv',
        'rhoka',
      ];
      for (let i = 0; i < 10; i++) {
        const u = sim.addChampion((i % 2) as 0 | 1, undefined, roster[i]!);
        sim.attachPolicy(u.id, laner);
      }
      let deaths = 0;
      const trace: number[] = [];
      for (let i = 0; i < 900; i++) {
        for (const ev of sim.tick()) {
          if (ev.type === 'death') deaths++;
        }
        if (i % 100 === 0) {
          let hp = 0;
          for (const u of sim.units.values()) hp += u.hp;
          trace.push(sim.units.size, Math.round(hp));
        }
      }
      return { deaths, trace };
    };
    const a = run();
    const b = run();
    expect(a.trace).toEqual(b.trace);
    expect(a.deaths).toBe(b.deaths);
    expect(a.deaths).toBeGreaterThan(0);
  });
});
