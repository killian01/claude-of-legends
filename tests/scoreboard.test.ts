// Scoreboard gate: kill and death tracking, position-free rows, and real
// names on the wire.

import { describe, expect, it } from 'vitest';
import { fillWithBots } from '../server/bot_fill';
import { Match } from '../server/match';
import { ClientWorld } from '../src/net/client_world';
import { Sim } from '../src/sim/sim';

describe('scoreboard', () => {
  it('tracks kills and deaths on champion kills', () => {
    const sim = new Sim(61);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    const b = sim.addChampion(1, { x: 79, z: 75 });
    b.hp = 1;
    sim.orderAttack(a.id, b.id);
    for (let i = 0; i < 40; i++) sim.tick();
    expect(a.kills).toBe(1);
    expect(b.deaths).toBe(1);
    const rows = sim.scoreboard();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.unitId === a.id)).toMatchObject({ kills: 1, deaths: 0 });
    expect(rows.find((r) => r.unitId === b.id)).toMatchObject({ kills: 0, deaths: 1 });
    // Rows never carry positions: safe to cross the fog.
    expect(Object.keys(rows[0]!)).not.toContain('x');
  });

  it('sends real player and bot names over the wire', () => {
    const match = new Match(3, [
      ...fillWithBots([
        {
          clientId: 1,
          name: 'killian',
          team: 0,
          championId: 'sylra',
          sigils: ['riftstep', 'mend'],
        },
      ]),
    ]);
    const score = match.buildScore();
    expect(score.t).toBe('score');
    if (score.t !== 'score') return;
    expect(score.rows).toHaveLength(10);
    // The seat name rides alongside the champion name, never over it.
    const mine = score.rows.find((r) => r.player === 'killian');
    expect(mine).toBeDefined();
    expect(mine!.championId).toBe('sylra');
    expect(mine!.name).toBe('Sylra');
    expect(score.rows.filter((r) => (r.player ?? '').startsWith('House '))).toHaveLength(9);

    const client = new ClientWorld(() => undefined);
    client.applyServer(score);
    expect(client.scoreboard()).toHaveLength(10);
  });
});
