// The Death card's scene (src/sim/playbook/death_context.ts): who stood
// around a champion when it died, the tower that had it in reach, read
// from the sim; the ledger notes it on every death when handed the sim,
// and the Record's upload door lets it through bounded.

import { describe, expect, it } from 'vitest';
import { parseUpload } from '../server/bot_records';
import { sparMatch, sparringPicks } from '../src/game/sparring_core';
import { LANER_PLAYBOOK } from '../src/sim/content/playbooks/laner';
import { deathScene, SCENE_CAP, SCENE_RADIUS } from '../src/sim/playbook/death_context';
import { PlayLedger } from '../src/sim/playbook/report';
import { Sim } from '../src/sim/sim';

describe('the scene of a death', () => {
  it('counts allies and enemies within reach, structures included, and the tower over it', () => {
    const sim = new Sim(3);
    const me = sim.addChampion(0, undefined, 'vesk', 0);
    const ally = sim.addChampion(0, undefined, 'korrath', 0);
    const foe = sim.addChampion(1, undefined, 'dain', 0);
    const far = sim.addChampion(1, undefined, 'sylra', 0);
    // Team 1's first bot-lane tower is a static unit on the map; stand
    // beside it.
    const tower = [...sim.units.values()].find((u) => u.kind === 'tower' && u.team === 1)!;
    me.pos = { x: tower.pos.x + 2, z: tower.pos.z + 2 };
    ally.pos = { x: me.pos.x + 3, z: me.pos.z };
    foe.pos = { x: me.pos.x - 4, z: me.pos.z + 1 };
    far.pos = { x: me.pos.x + SCENE_RADIUS + 5, z: me.pos.z };
    const scene = deathScene(sim, me.id);
    expect(scene).not.toBeNull();
    expect(scene!.allies).toBe(1);
    expect(scene!.enemies).toBe(1);
    expect(scene!.underTower).toBe(true);
    expect(scene!.around.map((u) => u.id)).toContain(tower.id);
    expect(scene!.around.map((u) => u.id)).not.toContain(far.id);
    expect(scene!.around.length).toBeLessThanOrEqual(SCENE_CAP);
    expect(scene!.x).toBeCloseTo(me.pos.x, 0);
    // Not a champion: no scene.
    expect(deathScene(sim, tower.id)).toBeNull();
  });

  it('is noted by the ledger on every death when it has the sim, and crosses the upload door', () => {
    const bot = {
      name: 'Nightfall',
      championId: 'vesk',
      sigils: ['riftstep', 'sear'] as [string, string],
      skin: 1,
      playbook: LANER_PLAYBOOK,
    };
    const picks = sparringPicks(bot, 17);
    const result = sparMatch({ seed: 17, picks, maxTicks: 6000 });
    const withDeaths = result.report.units.filter((u) => (u.deathsAt?.length ?? 0) > 0);
    expect(withDeaths.length).toBeGreaterThan(0);
    for (const u of withDeaths) {
      for (const d of u.deathsAt ?? []) {
        expect(d.scene).toBeDefined();
        expect(d.scene!.allies + d.scene!.enemies).toBeLessThanOrEqual(9);
        expect(typeof d.scene!.underTower).toBe('boolean');
      }
    }
    const parsed = parseUpload(
      {
        id: 'bot_x',
        kind: 'sparring',
        seed: 17,
        team: 0,
        winner: result.winner,
        ticks: result.ticks,
        version: 1,
        edited: false,
        botUnitId: result.botUnitId,
        score: result.score,
        report: result.report,
        record: result.record,
      },
      1,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const kept = parsed.value.entry.report.units.filter((u) => (u.deathsAt?.length ?? 0) > 0);
    expect(kept.length).toBe(withDeaths.length);
    expect(kept[0]?.deathsAt?.[0]?.scene).toEqual(withDeaths[0]?.deathsAt?.[0]?.scene);
    // Without the sim, no scene.
    const ledger = new PlayLedger();
    ledger.observe(5, [{ type: 'death', unitId: 1, killerId: 2 }]);
    expect(ledger.report().units).toEqual([]);
  });
});
