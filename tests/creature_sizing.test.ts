// The neutral bodies' standard (docs/plan-rings.md, round two), pinned on
// the export: a ring creature is a duo's fight that a lone damage dealer
// can take in a minute or more and a lone support cannot; the Warden and
// the Ascendant are a team's fight that five take in under a minute and
// a duo does not. Each champion fights at the level and with the items a
// laner has at that clock, every ability used, the way
// scripts/creature_report.ts measures it (that script is the full
// measurement; this is the gate that keeps a tuning from drifting away
// from the standard unnoticed).

import { describe, expect, it } from 'vitest';
import { starOrchard } from '../server/star_orchard';
import { nextKitStep, roleBuild } from '../src/sim/playbook/kit';
import { Sim } from '../src/sim/sim';
import { TerrainNavGrid } from '../src/sim/terrain_nav';
import type { AbilityKey } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';

type Body = 'pyrefang' | 'warden' | 'ascendant';

function orchardSim(seed = 3): Sim {
  const o = starOrchard();
  return new Sim(seed, {
    map: o.map,
    nav: new TerrainNavGrid(o.navigation),
    strictNavigation: true,
  });
}

// A laner at a clock, as scripts/creature_report.ts reads it off house bot
// matches.
function lanerAt(time: number): { level: number; gold: number } {
  const min = time / 60;
  return { level: Math.min(18, Math.round(2.5 + 0.65 * min)), gold: Math.round(200 + 250 * min) };
}

function equip(sim: Sim, id: number, level: number, gold: number): void {
  const u = sim.units.get(id)!;
  sim.setLevel(id, level);
  let guard = 0;
  while (u.skillPoints > 0 && guard++ < 40) {
    if (sim.levelAbility(id, 'R')) continue;
    if (!(['Q', 'W', 'E'] as AbilityKey[]).some((k) => sim.levelAbility(id, k))) break;
  }
  const fountain = sim.map.fountains.find((f) => f.team === u.team)!;
  const saved = { ...u.pos };
  u.pos = { x: fountain.x, z: fountain.z };
  u.gold = gold;
  const build = roleBuild(u.championId);
  for (let i = 0; i < 12; i++) {
    const step = nextKitStep(build, u.items, u.gold);
    if (step?.kind !== 'buy' || !sim.buyItem(id, step.itemId)) break;
  }
  u.pos = saved;
}

function summon(sim: Sim, body: Body): Unit {
  const find = (): Unit | undefined =>
    [...sim.units.values()].find((u) =>
      body === 'warden'
        ? u.kind === 'warden'
        : u.creatureId === 'pyrefang' && u.ascendant === (body === 'ascendant') && !u.dead,
    );
  for (const st of sim.ringStates) st.nextRiseAt = Number.POSITIVE_INFINITY;
  if (body === 'warden') {
    sim.objectives.nextSpawnAt = sim.time;
  } else {
    const st = sim.ringStates.find((s) => s.creature === 'pyrefang')!;
    st.nextRiseAt = sim.time;
    st.riseIndex = body === 'ascendant' ? 3 : 0;
  }
  for (let i = 0; i < 200 && !find(); i++) sim.tick();
  const target = find();
  expect(target, body).toBeDefined();
  return target!;
}

// Seconds until the body falls, or null when it stands after `limit`.
function fight(champs: readonly string[], body: Body, time: number, limit: number): number | null {
  const sim = orchardSim();
  sim.time = time;
  (sim as unknown as { nextWaveAt: number }).nextWaveAt = time;
  const target = summon(sim, body);
  const laner = lanerAt(time);
  const ids = champs.map((ch, i) => {
    const u = sim.addChampion(0, { x: target.pos.x + 3 + i, z: target.pos.z + (i % 2) }, ch);
    equip(sim, u.id, laner.level, laner.gold);
    return u.id;
  });
  const start = sim.time;
  while (sim.time - start < limit && sim.units.has(target.id)) {
    for (const id of ids) {
      const u = sim.units.get(id)!;
      if (u.dead) continue;
      if (u.attackTargetId !== target.id) sim.orderAttack(id, target.id);
      for (const k of ['R', 'Q', 'W', 'E'] as AbilityKey[]) {
        sim.castAbility(id, k, { x: target.pos.x, z: target.pos.z });
      }
    }
    sim.tick();
    if (ids.every((id) => sim.units.get(id)!.dead)) break;
  }
  return sim.units.has(target.id) ? null : sim.time - start;
}

const FIVE = ['ashvyn', 'torv', 'dain', 'sylra', 'fenn'];

describe('the neutral bodies', () => {
  it('a ring creature at 4:00: a duo in about half a minute, a lone marksman in a minute or more, a lone support never', () => {
    const duo = fight(['ashvyn', 'torv'], 'pyrefang', 240, 120);
    expect(duo).not.toBeNull();
    expect(duo!).toBeGreaterThan(20);
    expect(duo!).toBeLessThan(50);
    const marksman = fight(['ashvyn'], 'pyrefang', 240, 150);
    expect(marksman).not.toBeNull();
    expect(marksman!).toBeGreaterThan(45);
    expect(fight(['maera'], 'pyrefang', 240, 150)).toBeNull();
  });

  it('a ring creature at 12:00 holds the same standard: it grew with the champions', () => {
    const duo = fight(['ashvyn', 'torv'], 'pyrefang', 720, 120);
    expect(duo).not.toBeNull();
    expect(duo!).toBeGreaterThan(20);
    expect(duo!).toBeLessThan(55);
    expect(fight(['maera'], 'pyrefang', 720, 150)).toBeNull();
  });

  it('the Warden at 12:00: five in under half a minute, a lone champion never', () => {
    const five = fight(FIVE, 'warden', 720, 120);
    expect(five).not.toBeNull();
    expect(five!).toBeGreaterThan(12);
    expect(five!).toBeLessThan(40);
    expect(fight(['rhoka'], 'warden', 720, 150)).toBeNull();
  });

  it('the Ascendant at 16:00: five in under a minute, a duo never', () => {
    const five = fight(FIVE, 'ascendant', 960, 150);
    expect(five).not.toBeNull();
    expect(five!).toBeGreaterThan(25);
    expect(five!).toBeLessThan(70);
    expect(fight(['sylra', 'fenn'], 'ascendant', 960, 150)).toBeNull();
  });
});
