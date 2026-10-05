import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../server/snapshot';
import { attacksFrom } from '../src/game/attack_notes';
import { voidmaulSlamsFrom } from '../src/game/voidmaul_slam_notes';
import type { ServerMsg } from '../src/net/protocol';
import { applyReplayEvent, type ReplayEvent } from '../src/net/replay';
import { CREATURES } from '../src/sim/content/rings';
import { Sim, type SimEvent } from '../src/sim/sim';
import { createCreature } from '../src/sim/unit';

type Snap = Extract<ServerMsg, { t: 'snap' }>;

function round(seed = 73) {
  const sim = new Sim(seed);
  sim.units.clear();
  const self = sim.addChampion(0, { x: 75, z: 77.5 }, 'fenn');
  self.hp = self.maxHp = 10000;
  self.stats.armor = 0;
  self.stats.attackSpeed = 0;
  self.stats.hpRegen = 0;
  const boss = createCreature(100_000, CREATURES.voidmaul, { x: 75, z: 75 }, 'bulwark');
  boss.stats.ad = 100;
  boss.bitePct = 0;
  boss.attackTargetId = self.id;
  sim.units.set(boss.id, boss);
  return { sim, self, boss };
}

function combat(events: readonly SimEvent[]) {
  return events.filter(
    (e) => e.type === 'attack' || e.type === 'voidmaul_slam' || e.type === 'damage',
  );
}

describe('Voidmaul sequence across live, wire and replay ticks', () => {
  it('replays recorded movement and restores an in-flight crush without changing either chosen clips or contact geometry', () => {
    const live = round();
    const commands: ReplayEvent[] = [
      { k: 72, e: 'cmd', u: live.self.id, c: { t: 'move', x: 78, z: 77.5 } },
      { k: 132, e: 'cmd', u: live.self.id, c: { t: 'move', x: 75, z: 77.5 } },
    ];
    const byTick = new Map<number, SimEvent[]>();
    const known = new Set<number>();
    let checkpoint = live.sim.snapshot();
    for (let tick = 0; tick < 205; tick++) {
      const command = commands.find((event) => event.k === tick)?.c;
      if (command?.t === 'move') live.sim.orderMove(live.self.id, command.x, command.z);
      const events = live.sim.tick();
      byTick.set(tick, structuredClone(combat(events)));
      const snapshot = JSON.parse(
        JSON.stringify(buildSnapshot(live.sim, 0, live.self.id, known, events)),
      ) as Snap;
      expect(attacksFrom(snapshot.events)).toEqual(attacksFrom(events));
      expect(voidmaulSlamsFrom(snapshot.events)).toEqual(voidmaulSlamsFrom(events));
      if (live.sim.tickCount === 83) checkpoint = structuredClone(live.sim.snapshot());
    }
    const liveEvents = [...byTick.values()].flat();
    expect(attacksFrom(liveEvents).map((event) => event.voidmaulAttack)).toEqual([
      'slam',
      'crush',
      'slam',
      'crush',
    ]);
    expect(voidmaulSlamsFrom(liveEvents).map((event) => event.kind)).toEqual([
      'slam',
      'crush',
      'slam',
    ]);
    expect(live.boss.voidmaulAttackCount).toBe(3);

    const replay = round();
    const replayTeams = new Map([[replay.self.id, replay.self.team]]);
    for (let tick = 0; tick < 205; tick++) {
      for (const event of commands.filter((command) => command.k === tick)) {
        applyReplayEvent(replay.sim, replayTeams, event);
      }
      expect(combat(replay.sim.tick())).toEqual(byTick.get(tick));
    }
    expect(replay.sim.snapshot()).toEqual(live.sim.snapshot());

    const restored = round();
    restored.sim.restore(checkpoint);
    const restoredBoss = restored.sim.units.get(restored.boss.id)!;
    expect(restoredBoss.voidmaulAttackCount).toBe(1);
    expect(restoredBoss.pendingAttack!.voidmaulSlam!.kind).toBe('crush');
    const restoredTeams = new Map([[restored.self.id, restored.self.team]]);
    while (restored.sim.tickCount < 205) {
      const tick = restored.sim.tickCount;
      for (const event of commands.filter((command) => command.k === tick)) {
        applyReplayEvent(restored.sim, restoredTeams, event);
      }
      expect(combat(restored.sim.tick())).toEqual(byTick.get(tick));
    }
    expect(restored.sim.snapshot()).toEqual(live.sim.snapshot());
  });
});
