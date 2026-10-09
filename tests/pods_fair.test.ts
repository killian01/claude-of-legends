// The hidden pods' fairness (CONTEXT.md: Sourpod): a person's snapshot and
// a bot's observation read one rule (Sim.zoneSeen), in the 5v5 and on the
// planet. An enemy pod nobody of the team has revealed is in neither, even
// with a champion of the team beside it; under the team's own reveal zone
// it is in both, for every seat of that team; the planter's team always
// has it; and the cloud a burst leaves is an ordinary zone everyone in
// sight sees.

import { describe, expect, it } from 'vitest';
import { royaleSimOf } from '../server/royale_build';
import { buildRoyaleSnapshot, type RoyaleViewer } from '../server/royale_snapshot';
import { buildSnapshot } from '../server/snapshot';
import type { ServerMsg } from '../src/net/protocol';
import { buildRoyaleSim, type ReplayPick } from '../src/net/replay';
import type { Vec3 } from '../src/sim/geo';
import { buildObservation } from '../src/sim/observe';
import { Rng } from '../src/sim/rng';
import { along, randomHeading } from '../src/sim/royale/layout';
import { DROP_S } from '../src/sim/royale/types';
import { Sim } from '../src/sim/sim';
import { DT, type TeamId } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';
import { loadPlanet } from './royale_planet';

type Snap = Extract<ServerMsg, { t: 'snap' }>;

function ready(u: Unit): void {
  u.skillPoints = 0;
  u.abilityRanks = { Q: 1, W: 1, E: 1, R: 1 };
  u.level = 6;
  u.mana = u.maxMana;
}

// Whether the seat's bot observation, and the person's snapshot for the
// same seat, hold the zone.
function inObs(sim: Sim, unitId: number, zoneId: number): boolean {
  const z = sim.zones.get(zoneId);
  if (!z) return false;
  const obs = buildObservation(sim, unitId)!;
  return (obs.zones ?? []).some((o) => o.x === z.pos.x && o.z === z.pos.z && o.radius === z.radius);
}

function inSnap(sim: Sim, team: TeamId, unitId: number, zoneId: number): boolean {
  const snap = buildSnapshot(sim, team, unitId, new Set(), []) as Snap;
  return snap.zones.some((z) => z.i === zoneId);
}

describe('a pod in the 5v5', () => {
  it('is in neither the snapshot nor the observation of an enemy that has not revealed it', () => {
    const sim = new Sim(31);
    const nisk = sim.addChampion(0 as TeamId, { x: 75, z: 75 }, 'nisk');
    const ashvyn = sim.addChampion(1 as TeamId, { x: 79, z: 85 }, 'ashvyn');
    const mate = sim.addChampion(1 as TeamId, { x: 92, z: 98 }, 'torv');
    for (const u of [nisk, ashvyn, mate]) ready(u);
    sim.tick();
    expect(sim.castAbility(nisk.id, 'R', { x: 79, z: 75 })).toBe(true);
    const pod = [...sim.zones.values()].find((z) => z.trap)!;
    // The planter's side has it, both ways.
    expect(inObs(sim, nisk.id, pod.id)).toBe(true);
    expect(inSnap(sim, 0, nisk.id, pod.id)).toBe(true);
    // An enemy two meters off, in plain sight of the spot: neither.
    ashvyn.pos = { x: 79, z: 77 };
    ashvyn.path = [];
    expect(sim.isPointVisible(1 as TeamId, pod.pos.x, pod.pos.z)).toBe(true);
    for (const u of [ashvyn, mate]) {
      expect(inObs(sim, u.id, pod.id)).toBe(false);
      expect(inSnap(sim, 1, u.id, pod.id)).toBe(false);
    }
    // Under the enemy's Eclipse Rain: in both, for the whole team.
    expect(sim.castAbility(ashvyn.id, 'R', { x: 79, z: 80 })).toBe(true);
    for (const u of [ashvyn, mate]) {
      expect(inObs(sim, u.id, pod.id)).toBe(true);
      expect(inSnap(sim, 1, u.id, pod.id)).toBe(true);
    }
    // The rain over, neither again.
    nisk.pos = { x: 40, z: 40 };
    ashvyn.pos = { x: 79, z: 85 };
    ashvyn.path = [];
    for (let i = 0; i < Math.ceil(3.2 / DT); i++) sim.tick();
    expect(sim.zones.has(pod.id)).toBe(true);
    for (const u of [ashvyn, mate]) {
      expect(inObs(sim, u.id, pod.id)).toBe(false);
      expect(inSnap(sim, 1, u.id, pod.id)).toBe(false);
    }
  });

  it('leaves a cloud the enemy in sight sees, in both', () => {
    const sim = new Sim(31);
    const nisk = sim.addChampion(0 as TeamId, { x: 75, z: 75 }, 'nisk');
    const victim = sim.addChampion(1 as TeamId, { x: 79, z: 85 }, 'torv');
    for (const u of [nisk, victim]) ready(u);
    sim.tick();
    expect(sim.castAbility(nisk.id, 'R', { x: 79, z: 75 })).toBe(true);
    nisk.pos = { x: 40, z: 40 };
    for (let i = 0; i < Math.ceil(1.1 / DT); i++) sim.tick();
    victim.pos = { x: 79, z: 75.3 };
    victim.path = [];
    let burst = false;
    for (let i = 0; i < 4 && !burst; i++) {
      for (const ev of sim.tick()) if (ev.type === 'trap') burst = true;
    }
    expect(burst).toBe(true);
    const cloud = [...sim.zones.values()].find((z) => z.vfx === 'nisk_R')!;
    expect(cloud).toBeDefined();
    expect(inObs(sim, victim.id, cloud.id)).toBe(true);
    expect(inSnap(sim, 1, victim.id, cloud.id)).toBe(true);
  });
});

describe('a pod on the planet', () => {
  it('is shown to the seat whose reveal covers it, and to no other seat', () => {
    const seats: ReplayPick[] = ['nisk', 'ashvyn', 'torv'].map((championId, i) => ({
      name: `seat${i}`,
      team: i,
      championId,
      sigils: ['riftstep', 'mend'],
    }));
    const { sim, unitIds } = buildRoyaleSim(loadPlanet(), 4, seats, 'respawn');
    while (sim.time < DROP_S + 1) sim.tick();
    const [nisk, ashvyn, torv] = unitIds.map((id) => sim.units.get(id)!);
    for (const u of [nisk!, ashvyn!, torv!]) ready(u);
    const R = sim.royaleMode!.layout.radius;
    const from = nisk!.pos as Vec3;
    const way = randomHeading(new Rng(1), from);
    const spot = along(from, way, 3, R);
    ashvyn!.pos = along(from, way, 5, R);
    torv!.pos = along(from, way, 6, R);
    for (const u of [ashvyn!, torv!]) u.path = [];
    expect(sim.castAbility(nisk!.id, 'R', spot)).toBe(true);
    const pod = [...sim.zones.values()].find((z) => z.trap)!;
    expect(pod).toBeDefined();
    const snap = (u: Unit): Snap => {
      const viewer: RoyaleViewer = {
        unitId: u.id,
        team: u.team,
        known: new Set(),
        seat: { ack: 0, ackAt: 0 },
      };
      return buildRoyaleSnapshot(royaleSimOf(sim), viewer, [], {
        seat: (id) => ({ name: `seat${id}`, bot: false }),
        seats: 3,
        people: 3,
        caches: false,
      }) as Snap;
    };
    const inRoyaleSnap = (u: Unit): boolean => snap(u).zones.some((z) => z.i === pod.id);
    expect(inObs(sim, nisk!.id, pod.id)).toBe(true);
    expect(inRoyaleSnap(nisk!)).toBe(true);
    for (const u of [ashvyn!, torv!]) {
      expect(inObs(sim, u.id, pod.id)).toBe(false);
      expect(inRoyaleSnap(u)).toBe(false);
    }
    // Ashvyn's Eclipse Rain over it: Ashvyn's seat has it, both ways; the
    // seat beside it, its own team, still nothing.
    expect(sim.castAbility(ashvyn!.id, 'R', spot)).toBe(true);
    expect(inObs(sim, ashvyn!.id, pod.id)).toBe(true);
    expect(inRoyaleSnap(ashvyn!)).toBe(true);
    expect(inObs(sim, torv!.id, pod.id)).toBe(false);
    expect(inRoyaleSnap(torv!)).toBe(false);
  });
});
