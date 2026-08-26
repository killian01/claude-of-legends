// Policy bots gate (ADR 0002 phase 1): observations respect the fog, the
// laner behaves (moves out, fights, retreats), bot fill builds legal
// rosters, and a full bot 5v5 stays deterministic.

import { describe, expect, it } from 'vitest';
import { fillWithBots } from '../server/bot_fill';
import { Match } from '../server/match';
import { BOTS, DEFAULT_BOT_ID } from '../src/sim/content/bots';
import { buildObservation } from '../src/sim/observe';
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

  it('retreats toward its fountain when low without a heal', () => {
    const sim = new Sim(41);
    const bot = sim.addChampion(0, { x: 75, z: 75 });
    bot.sigils = ['riftstep', 'zephyr'];
    bot.hp = bot.maxHp * 0.2;
    sim.attachPolicy(bot.id, laner);
    const fountain = sim.map.fountains.find((f) => f.team === 0)!;
    const before = Math.hypot(bot.pos.x - fountain.x, bot.pos.z - fountain.z);
    for (let i = 0; i < 120; i++) sim.tick();
    const after = Math.hypot(bot.pos.x - fountain.x, bot.pos.z - fountain.z);
    expect(after).toBeLessThan(before - 10);
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
