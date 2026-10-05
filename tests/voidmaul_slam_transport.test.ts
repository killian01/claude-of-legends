import { describe, expect, it } from 'vitest';
import { buildRoyaleSnapshot } from '../server/royale_snapshot';
import { buildSnapshot } from '../server/snapshot';
import { attacksFrom } from '../src/game/attack_notes';
import { voidmaulSlamsFrom } from '../src/game/voidmaul_slam_notes';
import type { ServerMsg, SnapEvent } from '../src/net/protocol';
import type { VoidmaulSlamEvent } from '../src/sim/combat/voidmaul_slam';
import { CREATURES } from '../src/sim/content/rings';
import type { VoidmaulAttackKind } from '../src/sim/content/voidmaul_slam';
import { Sim, type SimEvent } from '../src/sim/sim';
import { createCreature } from '../src/sim/unit';
import { FakeRoyaleSim, near, spot } from './royale_fake';

type Snap = Extract<ServerMsg, { t: 'snap' }>;

function impact(unitId: number, targetId: number, y?: number): VoidmaulSlamEvent {
  return {
    type: 'voidmaul_slam',
    unitId,
    targetId,
    x: 51.1234567891,
    z: -37.9876543219,
    radius: 5.500000001,
    at: 83.1500000001,
    ...(y !== undefined ? { y } : {}),
  };
}

function wire(event: VoidmaulSlamEvent): SnapEvent {
  const { type: _type, ...note } = event;
  return { e: 'voidmaul_slam', ...note };
}

describe('the authoritative Voidmaul impact on the wire', () => {
  it.each(['slam', 'crush'] as const)(
    'preserves the chosen %s swing and impact in 5v5 and Royale snapshots',
    (kind: VoidmaulAttackKind) => {
      const sim = new Sim(81);
      const self = sim.addChampion(0);
      const boss = createCreature(9001, CREATURES.voidmaul, { x: 160, z: 160 }, 'bulwark');
      sim.units.set(boss.id, boss);
      const swing: SimEvent = {
        type: 'attack',
        unitId: boss.id,
        targetId: self.id,
        voidmaulAttack: kind,
      };
      const contact: VoidmaulSlamEvent = { ...impact(boss.id, self.id), kind };
      const events = [swing, contact];
      const snapshot = JSON.parse(
        JSON.stringify(buildSnapshot(sim, 0, self.id, new Set(), events)),
      ) as Snap;
      expect(attacksFrom(snapshot.events)).toEqual(attacksFrom(events));
      expect(attacksFrom(snapshot.events)[0]!.voidmaulAttack).toBe(kind);
      expect(voidmaulSlamsFrom(snapshot.events)).toEqual(voidmaulSlamsFrom(events));
      expect(voidmaulSlamsFrom(snapshot.events)[0]!.kind).toBe(kind);

      const planet = new FakeRoyaleSim('respawn');
      planet.royale.stage = 'play';
      const me = planet.addChampion(0, 'fenn', spot(0, 50));
      const seen = planet.addCreature(near(me.pos as never, 5));
      const hidden = planet.addCreature(spot(25, 50));
      const seenEvents: SimEvent[] = [
        { type: 'attack', unitId: seen.id, targetId: me.id, voidmaulAttack: kind },
        { ...impact(seen.id, me.id, seen.pos.y), kind },
      ];
      const hiddenEvents: SimEvent[] = [
        { type: 'attack', unitId: hidden.id, targetId: me.id, voidmaulAttack: kind },
        { ...impact(hidden.id, me.id, hidden.pos.y), kind },
      ];
      const royale = JSON.parse(
        JSON.stringify(
          buildRoyaleSnapshot(
            planet,
            { unitId: me.id, team: me.team, known: new Set(), seat: { ack: 0, ackAt: 0 } },
            [...seenEvents, ...hiddenEvents],
            { seat: () => undefined, seats: 1, people: 1, caches: false },
          ),
        ),
      ) as Snap;
      expect(attacksFrom(royale.events)).toEqual(attacksFrom(seenEvents));
      expect(voidmaulSlamsFrom(royale.events)).toEqual(voidmaulSlamsFrom(seenEvents));
    },
  );

  it('leaves legacy swings and impacts untagged for the viewer’s slam fallback', () => {
    const local: SimEvent = { type: 'attack', unitId: 12, targetId: 17 };
    const network: SnapEvent = { e: 'atk', unitId: 12, targetId: 17 };
    expect(attacksFrom([local, network])).toEqual([
      { unitId: 12, targetId: 17 },
      { unitId: 12, targetId: 17 },
    ]);
    expect(attacksFrom([local])[0]).not.toHaveProperty('voidmaulAttack');
    expect(voidmaulSlamsFrom([impact(12, 17)])[0]).not.toHaveProperty('kind');
  });

  it('preserves the exact anchor, optional height, radius and contact time through a 5v5 snapshot', () => {
    const sim = new Sim(81);
    const self = sim.addChampion(0);
    const boss = createCreature(9001, CREATURES.voidmaul, { x: 160, z: 160 }, 'bulwark');
    sim.units.set(boss.id, boss);
    const landed = impact(boss.id, self.id, 0.123456789);
    // Ring creatures are publicly revealed in 5v5, even beyond local sight.
    expect(sim.isVisible(0, boss.id)).toBe(true);
    const snapshot = buildSnapshot(sim, 0, self.id, new Set(), [landed]) as Snap;
    expect(snapshot.events).toEqual([wire(landed)]);
    const decoded = JSON.parse(JSON.stringify(snapshot)) as Snap;
    const { type: _type, ...expected } = landed;
    expect(voidmaulSlamsFrom(decoded.events)).toEqual([expected]);
    expect(voidmaulSlamsFrom([landed])).toEqual([expected]);
    const missing = impact(9999, self.id);
    const absent = buildSnapshot(sim, 0, self.id, new Set(), [missing]) as Snap;
    expect(absent.events).toEqual([]);
    boss.dead = true;
    expect(sim.isVisible(0, boss.id)).toBe(false);
    const hidden = buildSnapshot(sim, 0, self.id, new Set([boss.id]), [landed]) as Snap;
    expect(hidden.events).toEqual([]);
  });

  it('fog-scopes a Royale slam to its visible source without changing sphere coordinates', () => {
    const sim = new FakeRoyaleSim('respawn');
    sim.royale.stage = 'play';
    const self = sim.addChampion(0, 'fenn', spot(0, 50));
    const visible = sim.addCreature(near(self.pos as never, 5));
    const hidden = sim.addCreature(spot(25, 50));
    const visibleImpact = {
      ...impact(visible.id, self.id, visible.pos.y),
      x: visible.pos.x,
      z: visible.pos.z,
    };
    const hiddenImpact = {
      ...impact(hidden.id, self.id, hidden.pos.y),
      x: hidden.pos.x,
      z: hidden.pos.z,
    };
    expect(sim.isVisible(0, visible.id)).toBe(true);
    expect(sim.isVisible(0, hidden.id)).toBe(false);
    const snapshot = buildRoyaleSnapshot(
      sim,
      { unitId: self.id, team: self.team, known: new Set([hidden.id]), seat: { ack: 0, ackAt: 0 } },
      [visibleImpact, hiddenImpact],
      { seat: () => undefined, seats: 1, people: 1, caches: false },
    ) as Snap;
    expect(snapshot.events).toEqual([wire(visibleImpact)]);
    const decoded = JSON.parse(JSON.stringify(snapshot)) as Snap;
    const { type: _type, ...expected } = visibleImpact;
    expect(voidmaulSlamsFrom(decoded.events)).toEqual([expected]);
  });

  it('keeps an omitted ground height omitted and preserves an explicit zero height', () => {
    const planar = impact(12, 17);
    const zeroHeight = impact(12, 17, 0);
    const notes = voidmaulSlamsFrom([planar, wire(zeroHeight)]);
    expect(notes).toHaveLength(2);
    expect(notes[0]).not.toHaveProperty('y');
    expect(notes[1]).toHaveProperty('y', 0);
    expect(notes.map((note) => [note.x, note.z, note.radius, note.at])).toEqual([
      [planar.x, planar.z, planar.radius, planar.at],
      [zeroHeight.x, zeroHeight.z, zeroHeight.radius, zeroHeight.at],
    ]);
  });

  it('never invents a ground impact from a swing, damage, kill or empty event batch', () => {
    const events: (SimEvent | SnapEvent)[] = [
      { type: 'attack', unitId: 12, targetId: 17 },
      { type: 'damage', sourceId: 12, targetId: 17, amount: 81, dtype: 'physical' },
      { type: 'death', unitId: 17, killerId: 12 },
      { e: 'atk', unitId: 12, targetId: 17 },
      { e: 'dmg', targetId: 17, amount: 81 },
    ];
    expect(voidmaulSlamsFrom(events)).toEqual([]);
    expect(voidmaulSlamsFrom([])).toEqual([]);
    const landed = impact(12, 17);
    const { type: _type, ...expected } = landed;
    expect(voidmaulSlamsFrom([...events, landed, ...events])).toEqual([expected]);
  });
});
