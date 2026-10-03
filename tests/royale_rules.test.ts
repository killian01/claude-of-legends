// The battle royale run by the sim on the real Wanderseed (src/sim/royale/
// mode.ts through Sim and buildRoyaleSim): the drop and the landings, no
// shop nor recall nor manual points, the Dusk's burn outside the light,
// a cache opened by standing beside it, a launch pad's flight, a
// takedown's rewards, Respawn's score and return at the edge of the light,
// One life's places and its winner, the creatures on the mode's clock, the
// out of combat speed, mana and health, the planet's health scale, the
// observation's block and the world checkpoint.

import { describe, expect, it } from 'vitest';
import { buildRoyaleSim, type ReplayPick } from '../src/net/replay';
import { dealDamage } from '../src/sim/combat/damage';
import { unrootedMoveSpeed } from '../src/sim/combat/status';
import { DUSK_PHASES } from '../src/sim/content/dusk';
import { planetTuning } from '../src/sim/content/royale_tuning';
import { clampSkin } from '../src/sim/content/skins';
import { basis, dirTo, dist, offset, type Vec3 } from '../src/sim/geo';
import { buildObservation } from '../src/sim/observe';
import { ESCORT_MAX_M, ESCORTS, snapLanding } from '../src/sim/royale/drop';
import { insideCap } from '../src/sim/royale/dusk';
import { royaleGround } from '../src/sim/royale/mode';
import {
  PLANET_CLOSE_SIGHT_M,
  planetGameMap,
  SIGHT_BLOCKER_MIN_R,
} from '../src/sim/royale/planet_map';
import {
  CACHE_OPEN_S,
  DROP_S,
  OUT_OF_COMBAT_HEAL,
  OUT_OF_COMBAT_MANA,
  OUT_OF_COMBAT_S,
  PAD_FLIGHT_S,
  RESPAWN_S,
  RING_CREATURES_AT_S,
  ROYALE_HP_SCALE,
  type RoyaleEvent,
  type RoyaleVariant,
  START_LEVEL,
  TAKEDOWN_HEAL,
  TAKEDOWN_MANA,
  WARDEN_AT_S,
} from '../src/sim/royale/types';
import type { Sim, SimEvent } from '../src/sim/sim';
import { DT } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';
import { loadPlanet } from './royale_planet';

function picks(n: number, bots = false): ReplayPick[] {
  const ids = ['dain', 'vesk', 'sylra', 'korrath', 'maera'];
  return Array.from({ length: n }, (_, i) => ({
    name: `seat${i}`,
    team: i,
    championId: ids[i % ids.length]!,
    sigils: ['riftstep', 'mend'] as [string, string],
    ...(bots ? { bot: 'royale' } : {}),
  }));
}

function build(n: number, variant: RoyaleVariant = 'respawn', seed = 3) {
  return buildRoyaleSim(loadPlanet(), seed, picks(n), variant);
}

function royaleEvents(events: SimEvent[], type: RoyaleEvent['type']): SimEvent[] {
  return events.filter((e) => e.type === type);
}

function run(sim: Sim, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks; i++) out.push(...sim.tick());
  return out;
}

function land(sim: Sim): SimEvent[] {
  return run(sim, DROP_S + DT);
}

// A walkable point a little way from p.
function near(sim: Sim, p: Vec3): Vec3 {
  const q = sim.ground.nearestWalkable(p, 40);
  if (!q || q.y === undefined) throw new Error('no ground');
  return { x: q.x, y: q.y, z: q.z };
}

function place(u: Unit, p: Vec3): void {
  u.pos = { ...p };
  u.path = [];
}

describe('the drop', () => {
  it('holds everyone until the drop ends, then lands each at its pick or somewhere quiet', () => {
    const { sim, unitIds } = build(4);
    const layout = sim.royaleMode!.layout;
    const pick = layout.cacheSpots[10]!.pos;
    expect(sim.royale!.stage).toBe('drop');
    expect(sim.pickDrop(unitIds[0]!, pick)).toBe(true);
    const before = unitIds.map((id) => ({ ...sim.units.get(id)!.pos }));
    sim.orderMove(unitIds[1]!, pick.x, pick.z, pick.y);
    run(sim, DROP_S - 1);
    expect(unitIds.map((id) => sim.units.get(id)!.pos)).toEqual(before);
    const events = run(sim, 1 + DT);
    expect(sim.royale!.stage).toBe('play');
    expect(royaleEvents(events, 'royale_land')).toHaveLength(4);
    const first = sim.units.get(unitIds[0]!)!;
    expect(dist(first.pos, pick)).toBeLessThan(2);
    for (const id of unitIds) {
      const u = sim.units.get(id)!;
      expect(sim.ground.isWalkableAt(u.pos)).toBe(true);
      expect(u.level).toBe(START_LEVEL);
      expect(u.abilityRanks).toEqual({ Q: 1, W: 1, E: 1, R: 0 });
      expect(u.gold).toBe(0);
    }
    // The quiet landings stand apart from the pick.
    for (const id of unitIds.slice(1)) {
      expect(dist(sim.units.get(id)!.pos, pick)).toBeGreaterThan(30);
    }
    // After the drop, a pick is refused.
    expect(sim.pickDrop(unitIds[0]!, pick)).toBe(false);
  });
});

describe('the rules of play', () => {
  it('has no shop, no recall and no manual skill points', () => {
    const { sim, unitIds } = build(2);
    land(sim);
    const u = sim.units.get(unitIds[0]!)!;
    u.gold = 99999;
    expect(sim.buyItem(u.id, 'heart_gem')).toBe(false);
    u.skillPoints = 1;
    expect(sim.levelAbility(u.id, 'Q')).toBe(false);
    sim.startRecall(u.id);
    expect(u.statuses.some((s) => s.kind === 'recall')).toBe(false);
  });

  it('brings two house bots down beside each person, the gentle first', () => {
    // The visitors of the first days met nobody for a minute and closed
    // the tab: a person's first fight now comes to them.
    const { sim, unitIds } = buildRoyaleSim(loadPlanet(), 3, picks(10, true), 'one_life');
    const person = unitIds[4]!;
    sim.detachPolicy(person);
    land(sim);
    const me = sim.units.get(person)!;
    const mode = sim.royaleMode!;
    const beside = unitIds.filter(
      (id) => id !== person && dist(sim.units.get(id)!.pos, me.pos) <= ESCORT_MAX_M + 2,
    );
    expect(beside.length).toBeGreaterThanOrEqual(ESCORTS);
    const gentle = beside.filter((id) => mode.skillOf(id) === 'gentle');
    expect(gentle.length).toBeGreaterThanOrEqual(ESCORTS);
  });

  it('gives a person who takes a seat the sigils and skin they chose', () => {
    const { sim, unitIds } = buildRoyaleSim(loadPlanet(), 3, picks(2, true), 'respawn');
    land(sim);
    const u = sim.units.get(unitIds[0]!)!;
    u.sigilCooldowns = [sim.time + 30, sim.time + 30];
    sim.setLoadout(u.id, ['zephyr', 'sear'], 99);
    expect(u.sigils).toEqual(['zephyr', 'sear']);
    expect(u.sigilCooldowns).toEqual([0, 0]);
    expect(u.skin).toBe(clampSkin(u.championId!, 99));
    // Nonsense leaves the sigils as they were.
    sim.setLoadout(u.id, ['zephyr', 'zephyr'], 0);
    expect(u.sigils).toEqual(['zephyr', 'sear']);
    sim.setLoadout(u.id, ['nothing', 'sear'], 0);
    expect(u.sigils).toEqual(['zephyr', 'sear']);
  });

  it('lands every bot where it picked when no person plays', () => {
    const { sim, unitIds } = buildRoyaleSim(loadPlanet(), 3, picks(10, true), 'one_life');
    run(sim, DROP_S - DT);
    const picked = new Map(sim.royaleMode!.state.drops);
    // Just past the landing, before anyone walks off.
    sim.tick();
    sim.tick();
    const mode = sim.royaleMode!;
    expect(mode.state.stage).toBe('play');
    for (const id of unitIds) {
      const pick = picked.get(id);
      expect(pick).toBeDefined();
      const at = snapLanding(pick!, mode.layout, royaleGround(sim.ground));
      // A tick's walk at most.
      expect(dist(sim.units.get(id)!.pos, at!)).toBeLessThan(0.5);
    }
  });

  it('burns a champion outside the light, and the burn is no fight', () => {
    const { sim, unitIds } = build(2, 'respawn', 5);
    land(sim);
    // Into the first phase's closing.
    run(sim, DUSK_PHASES[0]!.closeFrom + 10);
    const dusk = sim.royale!.dusk;
    expect(dusk.phase).toBe(1);
    const center = dusk.now.center;
    const anti = near(sim, { x: -center.x, y: -center.y, z: -center.z });
    expect(insideCap(dusk.now, anti)).toBe(false);
    const u = sim.units.get(unitIds[0]!)!;
    const safe = sim.units.get(unitIds[1]!)!;
    place(u, anti);
    place(safe, near(sim, center));
    u.hp = u.maxHp;
    const hitAt = u.lastDamagedAt;
    run(sim, 2);
    const lost = u.maxHp - u.hp;
    // The burn less the champion's own regeneration: out of combat as it
    // is, nothing heals it in the dark.
    expect(lost).toBeGreaterThan((u.maxHp * dusk.burn - u.stats.hpRegen) * 2 * 0.9);
    expect(lost).toBeLessThan(u.maxHp * dusk.burn * 2 * 1.2);
    expect(u.lastDamagedAt).toBe(hitAt);
    expect(safe.hp).toBe(safe.maxHp);
  });

  it('opens a cache for a champion standing still beside it, and pays the next piece', () => {
    const { sim, unitIds } = build(1);
    land(sim);
    const u = sim.units.get(unitIds[0]!)!;
    const cache = sim.royale!.caches.find((c) => c.kind === 'plain' && c.present)!;
    place(u, near(sim, cache.pos));
    expect(dist(u.pos, cache.pos)).toBeLessThan(1.6);
    const items = u.items.length;
    const events = run(sim, CACHE_OPEN_S + 0.2);
    expect(royaleEvents(events, 'royale_cache')).toEqual([
      { type: 'royale_cache', unitId: u.id, cacheId: cache.id },
    ]);
    expect(royaleEvents(events, 'royale_loot')).toHaveLength(1);
    expect(u.items.length).toBe(items + 1);
    expect(cache.present).toBe(false);
  });

  it('throws a champion sent onto a launch pad, untouchable, exactly to its point', () => {
    const { sim, unitIds } = build(1);
    land(sim);
    const u = sim.units.get(unitIds[0]!)!;
    const pad = sim.royale!.pads[0]!;
    place(u, near(sim, pad.at));
    sim.orderMove(u.id, pad.at.x, pad.at.z, pad.at.y);
    const events = run(sim, 0.5);
    expect(royaleEvents(events, 'royale_pad')).toEqual([
      { type: 'royale_pad', unitId: u.id, padId: pad.id },
    ]);
    expect(sim.royaleMode!.isFlying(u.id)).toBe(true);
    // Unable to act, untouchable.
    sim.orderMove(u.id, pad.at.x, pad.at.z, pad.at.y);
    expect(u.path).toEqual([]);
    const hp = u.hp;
    dealDamage(
      {
        ...(sim as unknown as { ctx(): Parameters<typeof dealDamage>[0] }).ctx(),
      },
      0,
      u,
      100,
      'true',
    );
    expect(u.hp).toBe(hp);
    run(sim, PAD_FLIGHT_S);
    expect(sim.royaleMode!.isFlying(u.id)).toBe(false);
    expect(u.pos).toEqual(pad.to);
  });

  it('speeds a champion up after five seconds out of combat', () => {
    const { sim, unitIds } = build(1);
    land(sim);
    const u = sim.units.get(unitIds[0]!)!;
    u.lastDamagedAt = sim.time;
    const fighting = unrootedMoveSpeed(u, sim.time);
    const calm = unrootedMoveSpeed(u, sim.time + OUT_OF_COMBAT_S + 0.1);
    expect(calm).toBeCloseTo(fighting * 1.4, 9);
  });

  it('gives mana back out of combat, there being no fountain to refill at', () => {
    const { sim, unitIds } = build(1);
    land(sim);
    const u = sim.units.get(unitIds[0]!)!;
    u.mana = 0;
    // Fresh from a fight: only the champion's own regeneration.
    u.lastDamagedAt = sim.time;
    run(sim, 1);
    const fighting = u.mana;
    run(sim, OUT_OF_COMBAT_S);
    const before = u.mana;
    run(sim, 1);
    const calm = u.mana - before;
    expect(calm - fighting).toBeCloseTo(u.maxMana * OUT_OF_COMBAT_MANA, 6);
  });

  it('gives health back out of combat inside the light, as the genre does between fights', () => {
    const { sim, unitIds } = build(1);
    land(sim);
    const u = sim.units.get(unitIds[0]!)!;
    u.hp = u.maxHp * 0.3;
    // Fresh from a fight: only the champion's own regeneration.
    u.lastDamagedAt = sim.time;
    run(sim, 1);
    const fighting = u.hp - u.maxHp * 0.3;
    run(sim, OUT_OF_COMBAT_S);
    const before = u.hp;
    run(sim, 1);
    const calm = u.hp - before;
    expect(calm - fighting).toBeCloseTo(u.maxHp * OUT_OF_COMBAT_HEAL, 6);
  });

  it('lands every champion with a quarter more health than the 5v5, times its own tuning', () => {
    const { sim, unitIds } = build(5);
    land(sim);
    for (const id of unitIds) {
      const u = sim.units.get(id)!;
      const def = u.champion!;
      expect(u.level).toBe(START_LEVEL);
      const fives = def.base.hp + def.growth.hp * (START_LEVEL - 1);
      expect(u.maxHp).toBeCloseTo(fives * ROYALE_HP_SCALE * planetTuning(def.id).hp, 9);
      expect(u.hp).toBe(u.maxHp);
    }
  });

  it('raises the big creatures on the mode clock', () => {
    const { sim } = build(1);
    expect(sim.objectives.nextSpawnAt).toBe(DROP_S + WARDEN_AT_S);
    for (const r of sim.ringStates) expect(r.nextRiseAt).toBe(DROP_S + RING_CREATURES_AT_S);
  });
});

function takedown(sim: Sim, killer: Unit, victim: Unit): SimEvent[] {
  place(victim, near(sim, sim.royale!.dusk.now.center));
  place(killer, victim.pos as Vec3);
  victim.hp = 10;
  killer.hp = killer.maxHp * 0.5;
  const ctx = (sim as unknown as { ctx(): Parameters<typeof dealDamage>[0] }).ctx();
  dealDamage(ctx, killer.id, victim, 500, 'true');
  return sim.tick();
}

describe('takedowns', () => {
  it('pay the last hit: experience, a piece, health; Respawn scores and brings the fallen back', () => {
    const { sim, unitIds } = build(3, 'respawn');
    land(sim);
    const killer = sim.units.get(unitIds[0]!)!;
    const victim = sim.units.get(unitIds[1]!)!;
    const xp = killer.xp;
    const items = killer.items.length;
    killer.mana = 0;
    const manaBefore = killer.mana;
    const events = takedown(sim, killer, victim);
    expect(victim.dead).toBe(true);
    expect(killer.xp).toBeGreaterThan(xp);
    expect(killer.items.length).toBe(items + 1);
    expect(royaleEvents(events, 'royale_loot')).toHaveLength(1);
    // Half health, the takedown's share on top (and whatever the level and
    // the piece add to the maximum).
    expect(killer.hp).toBeGreaterThanOrEqual(killer.maxHp * (0.5 + TAKEDOWN_HEAL) - 1);
    // And a share of the mana.
    expect(killer.mana).toBeGreaterThanOrEqual(
      Math.min(killer.maxMana, manaBefore + killer.maxMana * TAKEDOWN_MANA) - 1,
    );
    expect(sim.royale!.scores.get(killer.id)).toBe(1);
    expect(sim.royaleMode!.tally.takedowns).toBe(1);
    run(sim, RESPAWN_S + 0.1);
    expect(victim.dead).toBe(false);
    expect(victim.hp).toBe(victim.maxHp);
    expect(insideCap(sim.royale!.dusk.now, victim.pos as Vec3)).toBe(true);
    expect(sim.ground.isWalkableAt(victim.pos)).toBe(true);
    // The leader is the killer, and a takedown on the leader is worth two.
    expect(sim.royale!.leaderId).toBe(killer.id);
    const hunter = sim.units.get(unitIds[2]!)!;
    takedown(sim, hunter, killer);
    expect(sim.royale!.scores.get(hunter.id)).toBe(2);
  });

  it('end One life with places and the last standing as the winner', () => {
    const { sim, unitIds } = build(3, 'one_life');
    land(sim);
    const [a, b, c] = unitIds.map((id) => sim.units.get(id)!) as [Unit, Unit, Unit];
    let events = takedown(sim, a, b);
    expect(royaleEvents(events, 'royale_out')).toEqual([
      { type: 'royale_out', unitId: b.id, killerId: a.id, place: 3 },
    ]);
    run(sim, RESPAWN_S + 1);
    expect(b.dead).toBe(true);
    events = takedown(sim, c, a);
    expect(royaleEvents(events, 'royale_out')).toEqual([
      { type: 'royale_out', unitId: a.id, killerId: c.id, place: 2 },
    ]);
    expect(royaleEvents(events, 'royale_end')).toEqual([{ type: 'royale_end', winnerId: c.id }]);
    expect(sim.royale!.stage).toBe('over');
    expect(sim.royale!.winnerId).toBe(c.id);
    expect(sim.royale!.eliminated).toEqual([b.id, a.id]);
    expect(sim.winner).toBe(c.team);
    expect(sim.royaleMode!.ranking(sim)).toEqual([c.id, a.id, b.id]);
  });
});

describe('what a seat reads, and the checkpoint', () => {
  it('carries the royale block in a seat observation, the sphere coordinates included', () => {
    const { sim, unitIds } = build(2);
    land(sim);
    const obs = buildObservation(sim, unitIds[0]!)!;
    expect(obs.royale?.stage).toBe('play');
    expect(obs.royale?.caches.length).toBeGreaterThan(100);
    expect(obs.royale?.pads.length).toBe(sim.royale!.pads.length);
    expect(obs.self.y).toBeDefined();
    expect(obs.royale?.drop).toBeNull();
  });

  it('restores a checkpoint to the same world', () => {
    const { sim } = buildRoyaleSim(loadPlanet(), 9, picks(12, true), 'respawn');
    run(sim, DROP_S + 20);
    const snap = sim.snapshot();
    run(sim, 15);
    const after = sim.checksum();
    const royaleAfter = JSON.stringify([...sim.royale!.scores]);
    sim.restore(snap);
    run(sim, 15);
    expect(sim.checksum()).toBe(after);
    expect(JSON.stringify([...sim.royale!.scores])).toBe(royaleAfter);
  });
});

describe('sight on the planet', () => {
  it('lets only the big solid things block a sight line, and hides nothing at arm length', () => {
    const planet = loadPlanet();
    const map = planetGameMap(planet.layout);
    const listed = planet.layout.sightBlockers ?? [];
    expect(map.walls.length).toBe(listed.filter((b) => b.r >= SIGHT_BLOCKER_MIN_R).length);
    expect(map.walls.length).toBeLessThan(listed.length);
    expect(map.closeSight).toBe(PLANET_CLOSE_SIGHT_M);
    // Two champions of different teams in one bush, one outside it at three
    // meters: the close one is seen whatever the bush says.
    const { sim, unitIds } = build(2);
    land(sim);
    const a = sim.units.get(unitIds[0]!)!;
    const b = sim.units.get(unitIds[1]!)!;
    const bush = planet.layout.bushes![0]!;
    place(b, bush.at as Vec3);
    const dir = dirTo(b.pos, sim.ground.nearestWalkable(b.pos, 40)!) ?? basis(b.pos).east;
    place(a, offset(b.pos, dir, bush.r + 2.5) as Vec3);
    sim.tick();
    const d = dist(a.pos, b.pos);
    if (d <= PLANET_CLOSE_SIGHT_M) expect(sim.isVisible(a.team, b.id)).toBe(true);
  });
});
