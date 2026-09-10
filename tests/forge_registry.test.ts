// Forge phase 2 (plan-forge): champion resolution is match-scoped behind
// one seam. The registry resolves roster plus the match's forged
// definitions; buildMatchSim registers them for Sim, replay, and the
// headless env alike; ClientWorld mirrors the same registry; and replays
// embed the definitions instead of ids alone.

import { describe, expect, it } from 'vitest';
import { Env } from '../headless/env';
import { handleRequest, parseForged, parseSeats } from '../headless/requests';
import { starOrchard } from '../server/star_orchard';
import { ClientWorld } from '../src/net/client_world';
import {
  applySimCommand,
  buildMatchSim,
  type ReplayPick,
  type ReplayRecord,
} from '../src/net/replay';
import { ChampionRegistry } from '../src/sim/champion_registry';
import { CHAMPIONS } from '../src/sim/content/champions';
import type { Sim } from '../src/sim/sim';
import { forgedTwin } from './forged_twins';

const FORGED = forgedTwin(CHAMPIONS.sylra!);
const FORGED_TORV = forgedTwin(CHAMPIONS.torv!);

function forgedPicks(): ReplayPick[] {
  return [
    { name: 'maker', team: 0, championId: FORGED.id, sigils: ['riftstep', 'mend'], bot: 'laner' },
    { name: 'foe', team: 1, championId: 'fenn', sigils: ['sear', 'zephyr'], bot: 'laner' },
  ];
}

function fingerprint(sim: Sim): string {
  return JSON.stringify({
    time: sim.time.toFixed(4),
    winner: sim.winner,
    units: [...sim.units.values()].map((u) => ({
      id: u.id,
      x: u.pos.x.toFixed(4),
      z: u.pos.z.toFixed(4),
      hp: u.hp.toFixed(4),
      level: u.level,
      gold: Math.round(u.gold),
      dead: u.dead,
    })),
    score: sim.scoreboard(),
  });
}

describe('the champion registry', () => {
  it('resolves roster ids without any registration', () => {
    const reg = new ChampionRegistry();
    expect(reg.get('sylra')).toBe(CHAMPIONS.sylra);
    expect(reg.get('forged_nobody')).toBeNull();
  });

  it('resolves a forged id after registration and lists it for the wire', () => {
    const reg = new ChampionRegistry();
    const resolved = reg.addForged(FORGED);
    expect(reg.get(FORGED.id)).toBe(resolved);
    expect(resolved.abilities.Q).toBe(CHAMPIONS.sylra!.abilities.Q);
    expect(reg.forgedDefs()).toEqual([FORGED]);
  });

  it('rejects an invalid definition and a duplicate id, loudly', () => {
    const reg = new ChampionRegistry();
    const bad = { ...FORGED, base: { ...FORGED.base, hp: 9999 } };
    expect(() => reg.addForged(bad)).toThrow(/base\.hp/);
    reg.addForged(FORGED);
    expect(() => reg.addForged(FORGED)).toThrow(/already registered/);
  });

  it('keeps forged state per registry, never shared between matches', () => {
    const a = new ChampionRegistry();
    const b = new ChampionRegistry();
    a.addForged(FORGED);
    expect(b.get(FORGED.id)).toBeNull();
  });
});

describe('determinism with forged champions', () => {
  it('two sims with the same seed and forged defs stay identical', () => {
    const run = () => {
      const { sim } = buildMatchSim(starOrchard(), 4242, forgedPicks(), [FORGED]);
      const trace: number[] = [];
      for (let i = 0; i < 300; i++) {
        sim.tick();
        trace.push(sim.rng.next());
      }
      return { fp: fingerprint(sim), trace };
    };
    expect(run()).toEqual(run());
  });

  it('runs a forged champion as a real participant', () => {
    const { sim, unitIds } = buildMatchSim(starOrchard(), 7, forgedPicks(), [FORGED]);
    const u = sim.units.get(unitIds[0]!);
    expect(u?.championId).toBe(FORGED.id);
    expect(u?.champion?.passive.name).toBe('Barbed Marks');
    expect(sim.championDef(FORGED.id)?.blurb).toBe(FORGED.tagline);
    for (let i = 0; i < 200; i++) sim.tick();
    expect(sim.units.get(unitIds[0]!)?.pos).toBeDefined();
  });
});

describe('replays embed forged definitions', () => {
  it('rebuilds the exact live state from a record carrying the defs', () => {
    const picks = forgedPicks();
    const live = buildMatchSim(starOrchard(), 1357, picks, [FORGED]);
    const TICKS = 400;
    for (let k = 0; k < TICKS; k++) {
      if (k === 20) applySimCommand(live.sim, 0, live.unitIds[0]!, { t: 'move', x: 40, z: 40 });
      if (k === 60) applySimCommand(live.sim, 0, live.unitIds[0]!, { t: 'skill', key: 'Q' });
      if (k === 80) {
        applySimCommand(live.sim, 0, live.unitIds[0]!, { t: 'cast', key: 'Q', x: 42, z: 41 });
      }
      live.sim.tick();
    }

    const record: ReplayRecord = {
      version: 1,
      seed: 1357,
      picks,
      events: [],
      ticks: TICKS,
      forged: [...live.sim.champions.forgedDefs()],
    };
    // The record's forged list is the wire-safe embedding, not a reference.
    const rebuiltDefs = JSON.parse(JSON.stringify(record)) as ReplayRecord;
    const replay = buildMatchSim(
      starOrchard(),
      rebuiltDefs.seed,
      rebuiltDefs.picks,
      rebuiltDefs.forged ?? [],
    );
    for (let k = 0; k < TICKS; k++) {
      if (k === 20) applySimCommand(replay.sim, 0, replay.unitIds[0]!, { t: 'move', x: 40, z: 40 });
      if (k === 60) applySimCommand(replay.sim, 0, replay.unitIds[0]!, { t: 'skill', key: 'Q' });
      if (k === 80) {
        applySimCommand(replay.sim, 0, replay.unitIds[0]!, { t: 'cast', key: 'Q', x: 42, z: 41 });
      }
      replay.sim.tick();
    }
    expect(fingerprint(replay.sim)).toBe(fingerprint(live.sim));
  });
});

describe('world API parity', () => {
  it('Sim and ClientWorld resolve the same forged champion through championDef', () => {
    const { sim } = buildMatchSim(starOrchard(), 1, forgedPicks(), [FORGED]);
    const client = new ClientWorld(() => {}, starOrchard().map);
    client.registerForged(sim.champions.forgedDefs());
    const fromSim = sim.championDef(FORGED.id);
    const fromClient = client.championDef(FORGED.id);
    expect(fromClient).not.toBeNull();
    expect(fromClient?.name).toBe(fromSim?.name);
    expect(fromClient?.blurb).toBe(fromSim?.blurb);
    expect(fromClient?.abilities).toEqual(fromSim?.abilities);
    expect(fromClient?.passive.description).toBe(fromSim?.passive.description);
    // Roster resolution is untouched on both sides.
    expect(client.championDef('vesk')).toBe(CHAMPIONS.vesk!);
    expect(sim.championDef('vesk')).toBe(CHAMPIONS.vesk!);
  });
});

describe('the headless env plays forged champions', () => {
  it('accepts forged defs in the config through the same seam', () => {
    const env = new Env({
      seed: 3,
      forged: [FORGED],
      seats: [
        { team: 0, championId: FORGED.id, remote: true },
        { team: 1, championId: 'korrath' },
      ],
    });
    const first = env.reset();
    expect(env.sim.championDef(FORGED.id)).not.toBeNull();
    expect(Object.keys(first.observations).length).toBeGreaterThan(0);
  });

  it('validates forged defs and seat ids on the reset request', () => {
    const bad = parseForged([{ ...FORGED_TORV, base: { ...FORGED_TORV.base, ad: 999 } }]);
    expect('error' in bad && bad.error).toMatch(/base\.ad/);

    expect(parseSeats([{ team: 0, championId: FORGED.id }])).toBeNull();
    const withForged = parseSeats([{ team: 0, championId: FORGED.id }], new Set([FORGED.id]));
    expect(withForged?.[0]?.championId).toBe(FORGED.id);

    const env = new Env({ seed: 1, seats: [{ team: 0, championId: 'fenn', remote: true }] });
    const result = handleRequest(env, {
      t: 'reset',
      seed: 5,
      forged: [FORGED],
      seats: [
        { team: 0, championId: FORGED.id, remote: true },
        { team: 1, championId: 'korrath' },
      ],
    });
    expect(result.response.t).toBe('obs');
    expect(result.env.sim.championDef(FORGED.id)).not.toBeNull();

    const refused = handleRequest(env, {
      t: 'reset',
      forged: [{ ...FORGED, id: 'forged_bad', base: { ...FORGED.base, hp: 5 } }],
    });
    expect(refused.response.t).toBe('error');
    expect(String(refused.response.message)).toMatch(/base\.hp/);
  });
});
