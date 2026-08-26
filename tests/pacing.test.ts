// Pacing gate: the tempo levers from the pacing review stay fast. Waves
// arrive on a short cadence, passive gold funds items briskly, the xp curve
// stays compressed, and death downtime stays short.

import { describe, expect, it } from 'vitest';
import { BOTS, DEFAULT_BOT_ID } from '../src/sim/content/bots';
import { CHAMPION_LIST } from '../src/sim/content/champions';
import { Sim } from '../src/sim/sim';
import { xpForNext } from '../src/sim/stats';

describe('pacing', () => {
  it('a second wave is already marching before 36 s', () => {
    const sim = new Sim(11);
    for (let i = 0; i < 720; i++) sim.tick();
    const minions = [...sim.units.values()].filter((u) => u.kind === 'minion');
    // Two waves are 60 minions; lane fights may have culled a few.
    expect(minions.length).toBeGreaterThan(40);
  });

  it('passive gold funds an early component inside the first minute', () => {
    const sim = new Sim(11);
    const a = sim.addChampion(0);
    const start = a.gold;
    for (let i = 0; i < 400; i++) sim.tick(); // 20 s, income starts at 10 s
    expect(a.gold - start).toBeGreaterThanOrEqual(24);
  });

  it('the full xp curve stays under 10k so spikes land early', () => {
    let total = 0;
    for (let level = 1; level < 18; level++) total += xpForNext(level);
    expect(total).toBeLessThan(10000);
  });

  it('keeps ability cooldowns short enough to matter in every fight', () => {
    for (const c of CHAMPION_LIST) {
      const basics = [c.abilities.Q, c.abilities.W, c.abilities.E].map((a) => a.cooldown);
      // Every basic comes back inside 11 s, and each kit has a spammable one.
      for (const cd of basics) expect(cd, `${c.id} basic cooldown`).toBeLessThanOrEqual(11);
      expect(Math.min(...basics), `${c.id} fastest basic`).toBeLessThanOrEqual(7);
      expect(c.abilities.R.cooldown, `${c.id} ultimate cooldown`).toBeLessThanOrEqual(70);
    }
  });

  it('bot fights actually conclude: kills happen inside the first 5 minutes', () => {
    const sim = new Sim(55);
    for (let i = 0; i < 10; i++) {
      const u = sim.addChampion((i % 2) as 0 | 1, undefined, CHAMPION_LIST[i]!.id);
      sim.attachPolicy(u.id, BOTS[DEFAULT_BOT_ID]!.policy);
    }
    for (let i = 0; i < 6000; i++) sim.tick();
    const kills = sim.scoreboard().reduce((acc, r) => acc + r.kills, 0);
    expect(kills).toBeGreaterThanOrEqual(4);
  });

  it('a level 1 death respawns in well under 10 s', () => {
    const sim = new Sim(11);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    const b = sim.addChampion(1, { x: 78, z: 75 });
    b.hp = 1;
    sim.orderAttack(a.id, b.id);
    for (let i = 0; i < 100 && !b.dead; i++) sim.tick();
    expect(b.dead).toBe(true);
    expect(b.respawnAt - sim.time).toBeLessThan(8);
    expect(b.respawnAt - sim.time).toBeGreaterThan(5);
  });
});
