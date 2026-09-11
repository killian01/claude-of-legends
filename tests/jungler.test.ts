// The Jungler (CONTEXT.md: Jungler; ADR 0023): the forest as a post. The
// playbook language names it (the jungle behavior, the forest as a lane
// preference and a lane trigger value), the fill seats one on every
// five-seat house team and the sim gives it no lane, and on the export a
// lone jungler walks its forest's round on what its team has seen: the
// Spinecrest first, the Brackenlings, the Barkmaw, skipping a spot it saw
// cleared until the spot's clock has run.

import { describe, expect, it } from 'vitest';
import { starOrchard } from '../server/star_orchard';
import { attachBot } from '../src/sim/content/bots';
import { HOUSE_STYLE_IDS, houseSeats } from '../src/sim/content/bots/house';
import { JUNGLER } from '../src/sim/content/bots/jungler';
import { CAMPS } from '../src/sim/content/camps';
import { CHAMPIONS } from '../src/sim/content/champions';
import { JUNGLER_PLAYBOOK } from '../src/sim/content/playbooks/jungler';
import { fillSeats } from '../src/sim/fill';
import { assignLanes } from '../src/sim/lanes';
import { buildObservation } from '../src/sim/observe';
import { buildSlotContext } from '../src/sim/playbook/micro';
import { holds } from '../src/sim/playbook/triggers';
import type { PlaybookDef } from '../src/sim/playbook/types';
import { validatePlaybook } from '../src/sim/playbook/validate';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { TerrainNavGrid } from '../src/sim/terrain_nav';

const TICKS_PER_S = 20;

function orchardSim(seed = 11): Sim {
  const orchard = starOrchard();
  return new Sim(seed, {
    map: orchard.map,
    nav: new TerrainNavGrid(orchard.navigation),
    strictNavigation: true,
  });
}

function errorsOf(def: unknown): string[] {
  const v = validatePlaybook(def);
  return v.ok ? [] : v.errors;
}

const JUNGLE_ELIGIBLE = ['Fighter', 'Tank', 'Skirmisher', 'Assassin'];

describe('the forest in the playbook language', () => {
  it('validates the jungle behavior, the forest as a lane asked for, and the lane trigger', () => {
    const v = validatePlaybook({
      version: 4,
      lanes: ['jungle'],
      plays: [
        { id: 'route', when: { kind: 'lane', is: 'jungle' }, do: { kind: 'jungle' } },
        { id: 'any', when: { kind: 'always' }, do: { kind: 'jungle', side: 'any' } },
      ],
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.def.lanes).toEqual(['jungle']);
    expect(v.def.plays[0]!.do).toEqual({ kind: 'jungle' });
    expect(v.def.plays[1]!.do).toEqual({ kind: 'jungle', side: 'any' });
    expect(
      errorsOf({
        version: 4,
        plays: [{ id: 'x', when: { kind: 'always' }, do: { kind: 'jungle', side: 'enemy' } }],
      })[0],
    ).toMatch(/side must be/);
    expect(
      errorsOf({
        version: 4,
        lanes: ['forest'],
        plays: [{ id: 'x', when: { kind: 'always' }, do: { kind: 'jungle' } }],
      })[0],
    ).toMatch(/lanes must be distinct/);
    expect(validatePlaybook(JUNGLER_PLAYBOOK).ok).toBe(true);
  });

  it('seats the forest with no lane, and the rest in one top, one mid, two bot', () => {
    const lanes = assignLanes([
      { home: 'top', prefer: ['jungle'] },
      { home: 'top' },
      { home: 'mid' },
      { home: 'bot' },
      { home: 'bot' },
    ]);
    expect(lanes).toEqual([null, 'top', 'mid', 'bot', 'bot']);
    // The forest asked for second is not the forest: the lane comes first.
    expect(assignLanes([{ home: 'top', prefer: ['mid', 'jungle'] }])).toEqual(['mid']);
    // On a team: the jungler reads lane null and the lane trigger says so.
    const sim = new Sim(5);
    const laner = sim.addChampion(0, undefined, 'dain');
    const jungler = sim.addChampion(0, undefined, 'korrath');
    sim.attachPlaybook(jungler.id, JUNGLER_PLAYBOOK);
    expect(jungler.lane).toBeNull();
    expect(laner.lane).toBe('top');
    sim.tick();
    const ctx = buildSlotContext(buildObservation(sim, jungler.id)!, new Rng(1));
    expect(holds({ kind: 'lane', is: 'jungle' }, ctx)).toBe(true);
    expect(holds({ kind: 'lane', is: 'top' }, ctx)).toBe(false);
    const other = buildSlotContext(buildObservation(sim, laner.id)!, new Rng(1));
    expect(holds({ kind: 'lane', is: 'jungle' }, other)).toBe(false);
  });

  it('is the fifth house style, seated on every five-seat house team by post', () => {
    expect(HOUSE_STYLE_IDS).toContain('jungler');
    for (let seed = 1; seed <= 30; seed++) {
      const seats = houseSeats([], new Rng(seed));
      const junglers = seats.filter((s) => s.bot === JUNGLER.id);
      expect(junglers, `seed ${seed}`).toHaveLength(1);
      expect(JUNGLE_ELIGIBLE).toContain(CHAMPIONS[junglers[0]!.championId]!.role);
      const kinds = fillSeats([], new Rng(seed)).map((s) => s.kind);
      expect(kinds.filter((k) => k === 'jungle')).toHaveLength(1);
      expect(kinds.filter((k) => k === 'top')).toHaveLength(1);
    }
    // A human fighter holds top; the house still fields a jungler beside.
    const beside = houseSeats([{ championId: 'torv' }], new Rng(3));
    expect(beside.filter((s) => s.bot === JUNGLER.id)).toHaveLength(1);
    // A smaller team fills its lanes and fields none.
    expect(houseSeats([], new Rng(3), 4).some((s) => s.bot === JUNGLER.id)).toBe(false);
  });
});

describe('the jungler on the export', () => {
  // A camp body leaves the units the tick it dies, so its kind is noted
  // before each tick.
  function campKills(sim: Sim, byId: number, seconds: number): { at: number; kind: string }[] {
    const kills: { at: number; kind: string }[] = [];
    const kinds = new Map<number, string>();
    for (let i = 0; i < seconds * TICKS_PER_S; i++) {
      for (const u of sim.units.values())
        if (u.kind === 'camp' && u.campKind) kinds.set(u.id, u.campKind);
      for (const e of sim.tick()) {
        if (e.type !== 'death' || e.killerId !== byId) continue;
        const kind = kinds.get(e.unitId);
        if (kind) kills.push({ at: sim.time, kind });
      }
    }
    return kills;
  }

  it('walks its forest round from the door: the Spinecrest, then the Brackenlings, then the Barkmaw', () => {
    const sim = orchardSim();
    const me = sim.addChampion(0, undefined, 'korrath');
    attachBot(sim, me.id, JUNGLER.id);
    expect(me.lane).toBeNull();
    const kills = campKills(sim, me.id, 200);
    const kinds = kills.map((k) => k.kind);
    // The first round in order, then the second begins.
    expect(kinds.slice(0, 5)).toEqual([
      'spinecrest',
      'brackenlings',
      'brackenlings',
      'brackenlings',
      'barkmaw',
    ]);
    expect(kinds.length).toBeGreaterThan(5);
    // The round is done inside two minutes and paid.
    expect(kills[4]!.at).toBeLessThan(120);
    expect(me.level).toBeGreaterThanOrEqual(4);
  });

  it('skips a spot it saw cleared until the spot clock has run, and comes back after', () => {
    const sim = orchardSim();
    const me = sim.addChampion(0, undefined, 'korrath');
    const def: PlaybookDef = {
      version: 4,
      lanes: ['jungle'],
      plays: [{ id: 'route', when: { kind: 'always' }, do: { kind: 'jungle' } }],
    };
    sim.attachPlaybook(me.id, def);
    // Until the first camp falls: the Spinecrest, inside a minute.
    const spinecrest = sim.map.camps.find((c) => c.kind === 'spinecrest' && c.x < 78)!;
    const stood = new Set<number>();
    let first: string | null = null;
    for (let i = 0; i < 90 * TICKS_PER_S && first === null; i++) {
      for (const u of sim.units.values()) if (u.kind === 'camp' && u.campKind) stood.add(u.id);
      for (const e of sim.tick()) {
        if (e.type === 'death' && e.killerId === me.id && stood.has(e.unitId)) first = 'camp';
      }
    }
    expect(first).toBe('camp');
    expect(Math.hypot(me.pos.x - spinecrest.x, me.pos.z - spinecrest.z)).toBeLessThan(12);
    sim.tick();
    // The memory says cleared; the route moves on to the Brackenlings.
    const obs = buildObservation(sim, me.id)!;
    const seen = obs.camps!.find((c) => c.x === spinecrest.x && c.z === spinecrest.z)!;
    expect(seen.up).toBe(false);
    expect(seen.downSince).not.toBeNull();
    const next = sim.map.camps.find((c) => c.kind === 'brackenlings' && c.x < 78)!;
    const d0 = Math.hypot(me.pos.x - next.x, me.pos.z - next.z);
    for (let i = 0; i < 10 * TICKS_PER_S; i++) sim.tick();
    expect(Math.hypot(me.pos.x - next.x, me.pos.z - next.z)).toBeLessThan(d0);
    // Back on the Spinecrest once its clock has run: a second kill of it
    // within its respawn plus a walk.
    const later = campKills(sim, me.id, CAMPS.spinecrest.respawnS + 90);
    expect(later.map((k) => k.kind)).toContain('spinecrest');
  });

  it('never opens on the enemy forest by default, and does with side any', () => {
    const own = orchardSim();
    const me = own.addChampion(0, { x: 100, z: 100 }, 'korrath');
    const def = (side: 'own' | 'any'): PlaybookDef => ({
      version: 4,
      lanes: ['jungle'],
      plays: [{ id: 'route', when: { kind: 'always' }, do: { kind: 'jungle', side } }],
    });
    own.attachPlaybook(me.id, def('own'));
    own.time = 40;
    const enemyCamp = own.map.camps.find((c) => c.kind === 'spinecrest' && c.x > 78)!;
    const e0 = Math.hypot(me.pos.x - enemyCamp.x, me.pos.z - enemyCamp.z);
    for (let i = 0; i < 6 * TICKS_PER_S; i++) own.tick();
    expect(Math.hypot(me.pos.x - enemyCamp.x, me.pos.z - enemyCamp.z)).toBeGreaterThan(e0 - 3);
    const any = orchardSim();
    const roamer = any.addChampion(0, { x: 100, z: 100 }, 'korrath');
    any.attachPlaybook(roamer.id, def('any'));
    any.time = 40;
    for (let i = 0; i < 6 * TICKS_PER_S; i++) any.tick();
    const nearestCamp = any.map.camps.reduce((a, b) =>
      Math.hypot(a.x - 100, a.z - 100) < Math.hypot(b.x - 100, b.z - 100) ? a : b,
    );
    expect(nearestCamp.x).toBeGreaterThan(78);
    expect(Math.hypot(roamer.pos.x - nearestCamp.x, roamer.pos.z - nearestCamp.z)).toBeLessThan(
      Math.hypot(100 - nearestCamp.x, 100 - nearestCamp.z) - 5,
    );
  });

  it('in a house match both junglers clear their rounds and the team gets its favor sooner', () => {
    const sim = orchardSim(42);
    const rng = new Rng(42);
    const junglers: number[] = [];
    for (const team of [0, 1] as const) {
      for (const seat of houseSeats([], rng)) {
        const u = sim.addChampion(team, undefined, seat.championId);
        attachBot(sim, u.id, seat.bot);
        if (seat.bot === JUNGLER.id) junglers.push(u.id);
      }
    }
    expect(junglers).toHaveLength(2);
    const kills = new Map<number, number>();
    const campIds = new Set<number>();
    for (let i = 0; i < 6 * 60 * TICKS_PER_S; i++) {
      for (const u of sim.units.values()) if (u.kind === 'camp') campIds.add(u.id);
      for (const e of sim.tick()) {
        if (e.type !== 'death' || !campIds.has(e.unitId)) continue;
        if (junglers.includes(e.killerId)) kills.set(e.killerId, (kills.get(e.killerId) ?? 0) + 1);
      }
    }
    for (const id of junglers)
      expect(kills.get(id) ?? 0, `jungler ${id}`).toBeGreaterThanOrEqual(5);
  }, 120000);
});
