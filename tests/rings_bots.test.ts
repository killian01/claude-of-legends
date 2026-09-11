// The bots at the rings (docs/plan-rings.md, ADR 0022): the playbook
// language names a ring creature (the creature trigger, the contestCreature
// behavior, the creature coach order), additively and validated; the
// observation carries the rings' clocks; every house style contests the
// rings the way it contests the Warden; and a bot match on the export
// actually kills the Pyrefang, so no bot leaves the rings untouched.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { attachBot } from '../src/sim/content/bots';
import { houseSeats } from '../src/sim/content/bots/house';
import { BRAWLER_PLAYBOOK } from '../src/sim/content/playbooks/brawler';
import { LANER_PLAYBOOK } from '../src/sim/content/playbooks/laner';
import { OBJECTIVE_PLAYBOOK } from '../src/sim/content/playbooks/objective';
import { SIEGER_PLAYBOOK } from '../src/sim/content/playbooks/sieger';
import type { AspectId } from '../src/sim/content/rings';
import {
  type StarOrchardLayout,
  type StarOrchardManifest,
  starOrchardMap,
} from '../src/sim/content/star_orchard';
import { buildObservation } from '../src/sim/observe';
import { playbookPolicy } from '../src/sim/playbook/interpreter';
import { buildSlotContext } from '../src/sim/playbook/micro';
import { holds } from '../src/sim/playbook/triggers';
import type { PlaybookDef } from '../src/sim/playbook/types';
import { validatePlaybook } from '../src/sim/playbook/validate';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { decodeTerrainNav, TerrainNavGrid } from '../src/sim/terrain_nav';
import type { Unit } from '../src/sim/unit';

const TICKS_PER_S = 20;

const folder = new URL('../public/map/star-orchard/', import.meta.url);
const manifest: StarOrchardManifest = JSON.parse(
  readFileSync(new URL('manifest.json', folder), 'utf8'),
);
const layout: StarOrchardLayout = JSON.parse(
  readFileSync(new URL('gameplay.json', folder), 'utf8'),
);
const binary = readFileSync(new URL('navigation.bin', folder));
const navigation = binary.buffer.slice(
  binary.byteOffset,
  binary.byteOffset + binary.byteLength,
) as ArrayBuffer;

function orchardSim(seed = 11): Sim {
  const map = starOrchardMap(layout, manifest);
  const nav = new TerrainNavGrid(decodeTerrainNav(manifest, navigation));
  return new Sim(seed, { map, nav, strictNavigation: true });
}

function creatureOf(sim: Sim, id: 'pyrefang' | 'voidmaul'): Unit | undefined {
  return [...sim.units.values()].find((u) => u.kind === 'creature' && u.creatureId === id);
}

function rise(sim: Sim, id: 'pyrefang' | 'voidmaul'): Unit {
  const state = sim.ringStates.find((s) => s.creature === id)!;
  state.nextRiseAt = sim.time;
  for (let i = 0; i < 3 * TICKS_PER_S && !creatureOf(sim, id); i++) sim.tick();
  return creatureOf(sim, id)!;
}

function ok(def: unknown): PlaybookDef {
  const v = validatePlaybook(def);
  if (!v.ok) throw new Error(v.errors.join('; '));
  return v.def;
}

function errorsOf(def: unknown): string[] {
  const v = validatePlaybook(def);
  return v.ok ? [] : v.errors;
}

describe('the creature vocabulary', () => {
  it('validates the trigger, the behavior and the order, and rejects a stranger', () => {
    const def = ok({
      version: 1,
      plays: [
        {
          id: 'ring',
          when: { kind: 'creature', which: 'pyrefang', state: 'spawning', within: 30 },
          do: {
            kind: 'contestCreature',
            which: 'any',
            hpAtLeast: 0.6,
            prepSeconds: 45,
            within: 70,
          },
        },
        { id: 'coach', when: { kind: 'order', is: 'creature' }, do: { kind: 'obeyOrder' } },
      ],
    });
    expect(def.plays[0]!.when).toEqual({
      kind: 'creature',
      which: 'pyrefang',
      state: 'spawning',
      within: 30,
    });
    expect(def.plays[0]!.do).toEqual({
      kind: 'contestCreature',
      which: 'any',
      hpAtLeast: 0.6,
      prepSeconds: 45,
      within: 70,
    });
    expect(
      errorsOf({
        version: 1,
        plays: [{ id: 'x', when: { kind: 'creature', state: 'asleep' }, do: { kind: 'hold' } }],
      })[0],
    ).toMatch(/state must be/);
    expect(
      errorsOf({
        version: 1,
        plays: [
          {
            id: 'x',
            when: { kind: 'always' },
            do: { kind: 'contestCreature', which: 'dragon' },
          },
        ],
      })[0],
    ).toMatch(/which must be/);
    // An older playbook that never heard of the rings still validates.
    expect(validatePlaybook(LANER_PLAYBOOK).ok).toBe(true);
    // The Ascendant is a name too (CONTEXT.md): either ring's.
    const asc = ok({
      version: 1,
      plays: [
        {
          id: 'asc',
          when: { kind: 'creature', which: 'ascendant', state: 'up' },
          do: { kind: 'contestCreature', which: 'ascendant' },
        },
      ],
    });
    expect(asc.plays[0]!.when).toMatchObject({ which: 'ascendant' });
    expect(asc.plays[0]!.do).toMatchObject({ which: 'ascendant' });
    // The party a contest waits for: one to five, whole.
    const party = ok({
      version: 1,
      plays: [
        { id: 'a', when: { kind: 'always' }, do: { kind: 'contestCreature', partyAtLeast: 3 } },
        { id: 'b', when: { kind: 'always' }, do: { kind: 'contestWarden', partyAtLeast: 4 } },
      ],
    });
    expect(party.plays[0]!.do).toMatchObject({ partyAtLeast: 3 });
    expect(party.plays[1]!.do).toMatchObject({ partyAtLeast: 4 });
    expect(
      errorsOf({
        version: 1,
        plays: [
          { id: 'x', when: { kind: 'always' }, do: { kind: 'contestCreature', partyAtLeast: 0 } },
        ],
      })[0],
    ).toMatch(/partyAtLeast/);
  });

  it('reads the rings off the observation, and names one creature or any', () => {
    const sim = orchardSim();
    const me = sim.addChampion(0);
    sim.tick();
    const obs = buildObservation(sim, me.id)!;
    expect(obs.creatures?.map((c) => c.creature).sort()).toEqual(['pyrefang', 'voidmaul']);
    const ctx = buildSlotContext(obs, new Rng(1), undefined, sim.map);
    expect(holds({ kind: 'creature', state: 'down' }, ctx)).toBe(true);
    expect(holds({ kind: 'creature', state: 'up' }, ctx)).toBe(false);
    // Due at 4:00: not within 20 s at the start, within 300.
    expect(holds({ kind: 'creature', which: 'pyrefang', state: 'spawning' }, ctx)).toBe(false);
    expect(
      holds({ kind: 'creature', which: 'pyrefang', state: 'spawning', within: 300 }, ctx),
    ).toBe(true);
    expect(
      holds({ kind: 'creature', which: 'voidmaul', state: 'spawning', within: 300 }, ctx),
    ).toBe(false);
    rise(sim, 'pyrefang');
    const later = buildSlotContext(buildObservation(sim, me.id)!, new Rng(1), undefined, sim.map);
    expect(holds({ kind: 'creature', state: 'up' }, later)).toBe(true);
    expect(holds({ kind: 'creature', which: 'pyrefang', state: 'up' }, later)).toBe(true);
    expect(holds({ kind: 'creature', which: 'voidmaul', state: 'up' }, later)).toBe(false);
    expect(holds({ kind: 'creature', which: 'voidmaul', state: 'down' }, later)).toBe(true);
    // A creature carrying an aspect is no Ascendant; the fourth rise is,
    // and the observation says so (aspect null, ascendant true).
    expect(holds({ kind: 'creature', which: 'ascendant', state: 'up' }, later)).toBe(false);
    expect(later.obs.creatures?.find((c) => c.ring === 'bot')).toMatchObject({
      aspect: 'might',
      ascendant: false,
    });
    const bot = sim.ringStates.find((s) => s.ring === 'bot')!;
    sim.units.delete(bot.unitId!);
    bot.unitId = null;
    bot.riseIndex = 3;
    rise(sim, 'pyrefang');
    const ascended = buildSlotContext(
      buildObservation(sim, me.id)!,
      new Rng(1),
      undefined,
      sim.map,
    );
    expect(ascended.obs.creatures?.find((c) => c.ring === 'bot')).toMatchObject({
      aspect: null,
      ascendant: true,
    });
    expect(holds({ kind: 'creature', which: 'ascendant', state: 'up' }, ascended)).toBe(true);
    expect(holds({ kind: 'creature', which: 'pyrefang', state: 'up' }, ascended)).toBe(true);
    expect(holds({ kind: 'creature', which: 'any', state: 'up' }, ascended)).toBe(true);
    // The launch map has no rings: nothing is ever up or due.
    const bare = new Sim(3);
    const lone = bare.addChampion(0);
    bare.tick();
    const bareCtx = buildSlotContext(buildObservation(bare, lone.id)!, new Rng(1));
    expect(holds({ kind: 'creature', state: 'down' }, bareCtx)).toBe(true);
    expect(holds({ kind: 'creature', state: 'spawning', within: 9999 }, bareCtx)).toBe(false);
  });

  it('walks a healthy bot to a live creature in range and fights it in reach, with a party', () => {
    const sim = orchardSim();
    const p = rise(sim, 'pyrefang');
    const me = sim.addChampion(0, { x: p.pos.x - 25, z: p.pos.z + 5 }, 'vesk');
    const def: PlaybookDef = {
      version: 1,
      plays: [{ id: 'ring', when: { kind: 'always' }, do: { kind: 'contestCreature' } }],
    };
    sim.attachPolicy(me.id, playbookPolicy(def, undefined, sim.map));
    // Alone and between rally windows, the bot stays: a creature is a
    // duo's fight (the body is sized so that a lone champion pokes it for
    // a minute and a half).
    sim.time = sim.ringClocks().find((c) => c.ring === 'bot')!.roseAt! + 60;
    const alone = { ...me.pos };
    for (let i = 0; i < 3 * TICKS_PER_S; i++) sim.tick();
    expect(Math.hypot(me.pos.x - alone.x, me.pos.z - alone.z)).toBeLessThan(1);
    // An ally beside the ring makes the party.
    sim.addChampion(0, { x: p.pos.x + 6, z: p.pos.z }, 'torv');
    const d0 = Math.hypot(me.pos.x - p.pos.x, me.pos.z - p.pos.z);
    let struck = false;
    for (let i = 0; i < 15 * TICKS_PER_S && !struck; i++) {
      for (const e of sim.tick()) {
        if (e.type === 'damage' && e.sourceId === me.id && e.targetId === p.id) struck = true;
      }
    }
    expect(Math.hypot(me.pos.x - p.pos.x, me.pos.z - p.pos.z)).toBeLessThan(d0);
    expect(struck).toBe(true);
    // Out of range, a bot with the same play stays where it is.
    const far = sim.addChampion(1, { x: 60, z: 60 }, 'vesk');
    sim.attachPolicy(far.id, playbookPolicy(def, undefined, sim.map));
    const at = { ...far.pos };
    for (let i = 0; i < 2 * TICKS_PER_S; i++) sim.tick();
    expect(Math.hypot(far.pos.x - at.x, far.pos.z - at.z)).toBeLessThan(1);
  });

  it('walks a bot that names the Ascendant to a live one, and past a plain creature', () => {
    const sim = orchardSim();
    const bot = sim.ringStates.find((s) => s.ring === 'bot')!;
    bot.riseIndex = 3;
    const a = rise(sim, 'pyrefang');
    expect(a.ascendant).toBe(true);
    const me = sim.addChampion(0, { x: a.pos.x - 25, z: a.pos.z + 5 }, 'vesk');
    const def: PlaybookDef = {
      version: 1,
      plays: [
        {
          id: 'asc',
          when: { kind: 'always' },
          do: { kind: 'contestCreature', which: 'ascendant' },
        },
      ],
    };
    sim.attachPolicy(me.id, playbookPolicy(def, undefined, sim.map));
    // A team's fight: with one ally there the bot still waits (between
    // rally windows), with two it goes.
    sim.time = sim.ringClocks().find((c) => c.ring === 'bot')!.roseAt! + 60;
    sim.addChampion(0, { x: a.pos.x + 6, z: a.pos.z }, 'torv');
    const waiting = { ...me.pos };
    for (let i = 0; i < 3 * TICKS_PER_S; i++) sim.tick();
    expect(Math.hypot(me.pos.x - waiting.x, me.pos.z - waiting.z)).toBeLessThan(1);
    sim.addChampion(0, { x: a.pos.x + 6, z: a.pos.z + 4 }, 'dain');
    const d0 = Math.hypot(me.pos.x - a.pos.x, me.pos.z - a.pos.z);
    for (let i = 0; i < 10 * TICKS_PER_S; i++) sim.tick();
    expect(Math.hypot(me.pos.x - a.pos.x, me.pos.z - a.pos.z)).toBeLessThan(d0 - 5);
    // The same play beside a plain Voidmaul stays put: it is not what it means.
    const v = rise(sim, 'voidmaul');
    const other = sim.addChampion(0, { x: v.pos.x - 25, z: v.pos.z + 5 }, 'vesk');
    sim.attachPolicy(other.id, playbookPolicy(def, undefined, sim.map));
    const at = { ...other.pos };
    for (let i = 0; i < 3 * TICKS_PER_S; i++) sim.tick();
    expect(Math.hypot(other.pos.x - at.x, other.pos.z - at.z)).toBeLessThan(1);
  });

  it('never opens a recall beside a live creature: the bite breaks the channel', () => {
    const sim = orchardSim();
    const p = rise(sim, 'pyrefang');
    const me = sim.addChampion(0, { x: p.pos.x + 4, z: p.pos.z }, 'vesk');
    sim.tick();
    const near = buildSlotContext(buildObservation(sim, me.id)!, new Rng(1), undefined, sim.map);
    expect(near.recallClear()).toBe(false);
    me.pos = { x: p.pos.x + 30, z: p.pos.z };
    sim.tick();
    const far = buildSlotContext(buildObservation(sim, me.id)!, new Rng(1), undefined, sim.map);
    expect(far.recallClear()).toBe(true);
  });

  it('spends its abilities on a creature in reach, not only its strikes', () => {
    const sim = orchardSim();
    const p = rise(sim, 'pyrefang');
    const me = sim.addChampion(0, { x: p.pos.x + 3, z: p.pos.z }, 'sylra');
    sim.setLevel(me.id, 6);
    for (const key of ['Q', 'W', 'E', 'R'] as const) sim.levelAbility(me.id, key);
    sim.addChampion(0, { x: p.pos.x - 3, z: p.pos.z }, 'torv');
    const def: PlaybookDef = {
      version: 1,
      plays: [{ id: 'ring', when: { kind: 'always' }, do: { kind: 'contestCreature' } }],
    };
    sim.attachPolicy(me.id, playbookPolicy(def, undefined, sim.map));
    let casts = 0;
    let strikes = 0;
    for (let i = 0; i < 10 * TICKS_PER_S; i++) {
      for (const e of sim.tick()) {
        if (e.type === 'cast' && e.unitId === me.id) casts++;
        if (e.type === 'attack' && e.unitId === me.id && e.targetId === p.id) strikes++;
      }
    }
    expect(casts).toBeGreaterThan(0);
    expect(strikes).toBeGreaterThan(0);
  });

  it('finishes a body under a fifth in reach whatever is in sight: the house styles say so', () => {
    for (const def of [LANER_PLAYBOOK, BRAWLER_PLAYBOOK, SIEGER_PLAYBOOK, OBJECTIVE_PLAYBOOK]) {
      const ids = def.plays.map((p) => p.id);
      expect(ids.indexOf('finish-creature')).toBeLessThan(ids.indexOf('fight'));
      expect(ids.indexOf('finish-warden')).toBeLessThan(ids.indexOf('fight'));
      const finish = def.plays.find((p) => p.id === 'finish-creature')!;
      expect(finish.when).toMatchObject({ kind: 'creature', state: 'up', hpAtMost: 0.2, near: 10 });
      expect(finish.do).toMatchObject({ kind: 'contestCreature', partyAtLeast: 1 });
    }
    // The trigger reads the live body's health and distance.
    const sim = orchardSim();
    const p = rise(sim, 'pyrefang');
    const me = sim.addChampion(0, { x: p.pos.x + 4, z: p.pos.z }, 'vesk');
    sim.tick();
    const full = buildSlotContext(buildObservation(sim, me.id)!, new Rng(1), undefined, sim.map);
    expect(holds({ kind: 'creature', state: 'up', hpAtMost: 0.2, near: 10 }, full)).toBe(false);
    expect(holds({ kind: 'creature', state: 'up', near: 10 }, full)).toBe(true);
    p.hp = Math.round(p.maxHp * 0.1);
    p.lastDamagedAt = sim.time;
    sim.tick();
    const low = buildSlotContext(buildObservation(sim, me.id)!, new Rng(1), undefined, sim.map);
    expect(holds({ kind: 'creature', state: 'up', hpAtMost: 0.2, near: 10 }, low)).toBe(true);
    expect(holds({ kind: 'creature', state: 'up', hpAtMost: 0.2, near: 2 }, low)).toBe(false);
    // And a Laner beside that low creature keeps hitting it with an enemy
    // champion in sight instead of turning to fight.
    sim.addChampion(1, { x: p.pos.x + 14, z: p.pos.z + 6 }, 'rhoka');
    sim.attachPolicy(me.id, playbookPolicy(LANER_PLAYBOOK, undefined, sim.map));
    let struck = false;
    for (let i = 0; i < 3 * TICKS_PER_S && !struck; i++) {
      p.lastDamagedAt = sim.time;
      for (const e of sim.tick()) {
        if (e.type === 'damage' && e.sourceId === me.id && e.targetId === p.id) struck = true;
      }
    }
    expect(struck).toBe(true);
  });

  it('rallies to a live body during its windows: short of the party by one, a bot waits beside it', () => {
    const sim = orchardSim();
    const p = rise(sim, 'pyrefang');
    const clock = sim.ringClocks().find((c) => c.ring === 'bot')!;
    expect(clock.roseAt).toBeCloseTo(sim.time, 0);
    // The observation says when it rose, the Warden's too.
    const me = sim.addChampion(0, { x: p.pos.x - 25, z: p.pos.z + 5 }, 'vesk');
    sim.tick();
    const obs = buildObservation(sim, me.id)!;
    expect(obs.creatures?.find((c) => c.ring === 'bot')?.roseAt).toBe(clock.roseAt);
    expect(obs.wardenRoseAt).toBeNull();
    // A lone bot (one short of a duo) walks in and stands beside the
    // creature without hitting it, inside the first window after the rise.
    const def: PlaybookDef = {
      version: 1,
      plays: [{ id: 'ring', when: { kind: 'always' }, do: { kind: 'contestCreature' } }],
    };
    sim.attachPolicy(me.id, playbookPolicy(def, undefined, sim.map));
    for (let i = 0; i < 12 * TICKS_PER_S; i++) sim.tick();
    expect(Math.hypot(me.pos.x - p.pos.x, me.pos.z - p.pos.z)).toBeLessThan(10);
    expect(p.hp).toBe(p.maxHp);
    // Between windows it goes about its business: the same bot placed far
    // again, past the window, stays.
    sim.time = clock.roseAt! + 60;
    me.pos = { x: p.pos.x - 25, z: p.pos.z + 5 };
    const at = { ...me.pos };
    for (let i = 0; i < 3 * TICKS_PER_S; i++) sim.tick();
    expect(Math.hypot(me.pos.x - at.x, me.pos.z - at.z)).toBeLessThan(1);
  });

  it('pre-positions at the ring shortly before a rise, when close enough', () => {
    const sim = orchardSim();
    const ring = sim.map.rings!.find((r) => r.id === 'top')!;
    const me = sim.addChampion(0, { x: ring.x + 30, z: ring.z - 12 }, 'vesk');
    sim.ringStates.find((s) => s.ring === 'top')!.nextRiseAt = sim.time + 30;
    const def: PlaybookDef = {
      version: 1,
      plays: [
        {
          id: 'ring',
          when: { kind: 'always' },
          do: { kind: 'contestCreature', which: 'voidmaul', prepSeconds: 45 },
        },
      ],
    };
    sim.attachPolicy(me.id, playbookPolicy(def, undefined, sim.map));
    const d0 = Math.hypot(me.pos.x - ring.x, me.pos.z - ring.z);
    for (let i = 0; i < 6 * TICKS_PER_S; i++) sim.tick();
    expect(Math.hypot(me.pos.x - ring.x, me.pos.z - ring.z)).toBeLessThan(d0 - 5);
  });

  it('obeys the creature order: the live one, else the ring next to rise', () => {
    const sim = orchardSim();
    const ring = sim.map.rings!.find((r) => r.id === 'bot')!;
    const me = sim.addChampion(0, { x: ring.x - 30, z: ring.z + 10 }, 'vesk');
    const def: PlaybookDef = {
      version: 1,
      plays: [{ id: 'coach', when: { kind: 'order' }, do: { kind: 'obeyOrder' } }],
    };
    sim.attachPolicy(me.id, playbookPolicy(def, undefined, sim.map));
    sim.setCoachOrder(me.id, { kind: 'creature' });
    const d0 = Math.hypot(me.pos.x - ring.x, me.pos.z - ring.z);
    for (let i = 0; i < 6 * TICKS_PER_S; i++) sim.tick();
    expect(Math.hypot(me.pos.x - ring.x, me.pos.z - ring.z)).toBeLessThan(d0 - 5);
  });

  it("is a play of every house style, in the Warden play's stance, the Ascendant too", () => {
    for (const def of [LANER_PLAYBOOK, BRAWLER_PLAYBOOK, SIEGER_PLAYBOOK, OBJECTIVE_PLAYBOOK]) {
      const ids = def.plays.map((p) => p.id);
      expect(ids, ids.join(',')).toContain('creature');
      // Right after the Warden: the Ascendant (the team's fight), then the
      // creature (the duo's), each in the stance of the Warden play.
      expect(ids.indexOf('ascendant')).toBe(ids.indexOf('warden') + 1);
      expect(ids.indexOf('creature')).toBe(ids.indexOf('ascendant') + 1);
      const warden = def.plays.find((p) => p.id === 'warden')!;
      const ascendant = def.plays.find((p) => p.id === 'ascendant')!;
      expect(ascendant.when).toEqual(warden.when);
      expect(ascendant.do).toMatchObject({ kind: 'contestCreature', which: 'ascendant' });
      const play = def.plays.find((p) => p.id === 'creature')!;
      expect(play.do.kind).toBe('contestCreature');
      expect(validatePlaybook(def).ok).toBe(true);
    }
    // The Objective player goes earliest and from farthest.
    const objective = OBJECTIVE_PLAYBOOK.plays.find((p) => p.id === 'creature')!.do;
    expect(objective).toMatchObject({ prepSeconds: 45, within: 70 });
  });

  it('takes a ring creature in a house bot match on the export inside twelve minutes', () => {
    // The bodies want a duo and thirty seconds now (docs/plan-rings.md,
    // round two), and the rings are contested ground: on this seed the
    // bots' first favor is the Voidmaul's at about 10:10, after two
    // attempts on the Pyrefang were broken up by the enemy laners.
    const sim = orchardSim(42);
    const rng = new Rng(42);
    for (const seat of houseSeats([], rng)) {
      attachBot(sim, sim.addChampion(0, undefined, seat.championId).id, seat.bot);
    }
    for (const seat of houseSeats([], rng)) {
      attachBot(sim, sim.addChampion(1, undefined, seat.championId).id, seat.bot);
    }
    let favor: { team: number; creature: string | null; aspect: AspectId } | null = null;
    for (let tick = 0; tick < 12 * 60 * TICKS_PER_S && !favor; tick++) {
      for (const e of sim.tick()) {
        if (e.type === 'favor') favor = { team: e.team, creature: e.creature, aspect: e.aspect };
      }
    }
    expect(favor).not.toBeNull();
    expect(['pyrefang', 'voidmaul']).toContain(favor!.creature);
    expect(sim.teamFavors(favor!.team as 0 | 1)[favor!.aspect]).toBe(1);
    // Every member of the team was paid.
    for (const u of sim.units.values()) {
      if (u.kind === 'champion' && u.team === favor!.team) expect(u.favors[favor!.aspect]).toBe(1);
    }
  }, 120000);
});
