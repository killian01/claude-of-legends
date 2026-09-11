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
import { CREATURES } from '../src/sim/content/rings';
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
    // The launch map has no rings: nothing is ever up or due.
    const bare = new Sim(3);
    const lone = bare.addChampion(0);
    bare.tick();
    const bareCtx = buildSlotContext(buildObservation(bare, lone.id)!, new Rng(1));
    expect(holds({ kind: 'creature', state: 'down' }, bareCtx)).toBe(true);
    expect(holds({ kind: 'creature', state: 'spawning', within: 9999 }, bareCtx)).toBe(false);
  });

  it('walks a healthy bot to a live creature in range and fights it in reach', () => {
    const sim = orchardSim();
    const p = rise(sim, 'pyrefang');
    const me = sim.addChampion(0, { x: p.pos.x - 25, z: p.pos.z + 5 }, 'vesk');
    const def: PlaybookDef = {
      version: 1,
      plays: [{ id: 'ring', when: { kind: 'always' }, do: { kind: 'contestCreature' } }],
    };
    sim.attachPolicy(me.id, playbookPolicy(def, undefined, sim.map));
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

  it("is a play of every house style, in the Warden play's stance", () => {
    for (const def of [LANER_PLAYBOOK, BRAWLER_PLAYBOOK, SIEGER_PLAYBOOK, OBJECTIVE_PLAYBOOK]) {
      const ids = def.plays.map((p) => p.id);
      expect(ids, ids.join(',')).toContain('creature');
      expect(ids.indexOf('creature')).toBe(ids.indexOf('warden') + 1);
      const play = def.plays.find((p) => p.id === 'creature')!;
      expect(play.do.kind).toBe('contestCreature');
      expect(validatePlaybook(def).ok).toBe(true);
    }
    // The Objective player goes earliest and from farthest.
    const objective = OBJECTIVE_PLAYBOOK.plays.find((p) => p.id === 'creature')!.do;
    expect(objective).toMatchObject({ prepSeconds: 45, within: 70 });
  });

  it('kills the Pyrefang in a house bot match on the export before the Voidmaul rises', () => {
    const sim = orchardSim(42);
    const rng = new Rng(42);
    for (const seat of houseSeats([], rng)) {
      attachBot(sim, sim.addChampion(0, undefined, seat.championId).id, seat.bot);
    }
    for (const seat of houseSeats([], rng)) {
      attachBot(sim, sim.addChampion(1, undefined, seat.championId).id, seat.bot);
    }
    let favor: { team: number; creature: string | null } | null = null;
    const until = CREATURES.voidmaul.firstRiseS + 60;
    for (let tick = 0; tick < until * TICKS_PER_S && !favor; tick++) {
      for (const e of sim.tick()) {
        if (e.type === 'favor') favor = { team: e.team, creature: e.creature };
      }
    }
    expect(favor).not.toBeNull();
    expect(favor!.creature).toBe('pyrefang');
    expect(sim.teamFavors(favor!.team as 0 | 1).might).toBe(1);
    // Every member of the team was paid.
    for (const u of sim.units.values()) {
      if (u.kind === 'champion' && u.team === favor!.team) expect(u.favors.might).toBe(1);
    }
  }, 60000);
});
