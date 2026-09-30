// The Gentle player (CONTEXT.md: House style), a newcomer's fair first
// fight: a valid playbook in the registry, posted and never drawn; it
// starts nothing before its threshold, answers a hit with a trade back,
// never dives an enemy tower with an enemy champion near; the struck
// trigger and the observation field it reads; and who meets it: the
// enemy lane seats of offline practice and of a public match of Guests.

import { describe, expect, it } from 'vitest';
import { fillWithBots } from '../server/bot_fill';
import { gentleTeams } from '../server/guests';
import type { MatchPick } from '../server/match';
import { starOrchard } from '../server/star_orchard';
import { PRACTICE_SEED_SPAN, practiceSeed } from '../src/game/practice_seed';
import { buildMatchSim } from '../src/net/replay';
import { BOTS } from '../src/sim/content/bots';
import { GENTLE } from '../src/sim/content/bots/gentle';
import { drawHouseStyle, gentleSeats, houseName, houseSeats } from '../src/sim/content/bots/house';
import { JUNGLER } from '../src/sim/content/bots/jungler';
import { GAME_MAP } from '../src/sim/content/map';
import {
  GENTLE_FROM_LEVEL,
  GENTLE_FROM_S,
  GENTLE_PLAYBOOK,
} from '../src/sim/content/playbooks/gentle';
import { LANER_PLAYBOOK } from '../src/sim/content/playbooks/laner';
import { buildObservation } from '../src/sim/observe';
import { playbookPolicy } from '../src/sim/playbook/interpreter';
import { buildSlotContext } from '../src/sim/playbook/micro';
import { holds } from '../src/sim/playbook/triggers';
import type { PlaybookDef } from '../src/sim/playbook/types';
import { validatePlaybook } from '../src/sim/playbook/validate';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';

// The play ids that acted for one champion over some ticks.
function acted(sim: Sim, unitId: number, def: PlaybookDef, ticks: number): Set<string> {
  const seen = new Set<string>();
  sim.attachPolicy(
    unitId,
    playbookPolicy(def, (id) => seen.add(id)),
  );
  for (let i = 0; i < ticks; i++) sim.tick();
  return seen;
}

// A bot and a foe in the open, in plain sight of each other: a foe that
// attacks from five units, or a passive one nine units off, holding still
// on a stop order (its idle defense off, src/sim/idle_defense.ts) and out
// of the bot's own reach, so only a play of the bot's can start a fight.
function duel(opts: { time?: number; level?: number; foeAttacks?: boolean } = {}) {
  const sim = new Sim(41);
  sim.time = opts.time ?? 0;
  const me = sim.addChampion(0, { x: 75, z: 75 });
  const foe = sim.addChampion(1, { x: opts.foeAttacks ? 80 : 84, z: 75 });
  if (opts.level !== undefined) sim.setLevel(me.id, opts.level);
  sim.attachPolicy(
    foe.id,
    opts.foeAttacks ? () => ({ kind: 'attack', targetId: me.id }) : () => ({ kind: 'stop' }),
  );
  return { sim, me, foe };
}

describe('the Gentle player', () => {
  it('is a valid house style in the registry, posted and never drawn', () => {
    const v = validatePlaybook(GENTLE_PLAYBOOK);
    expect(v.ok).toBe(true);
    expect(BOTS.gentle).toBe(GENTLE);
    expect(GENTLE.playbook).toBe(GENTLE_PLAYBOOK);
    expect(houseName('gentle')).toBe('House gentle player');
    const rng = new Rng(5);
    for (let i = 0; i < 200; i++) expect(drawHouseStyle(rng)).not.toBe('gentle');
    for (let seed = 1; seed <= 20; seed++) {
      expect(houseSeats([], new Rng(seed)).some((s) => s.bot === 'gentle')).toBe(false);
    }
  });

  it('starts nothing on a champion standing beside it before the threshold', () => {
    const { sim, me, foe } = duel();
    const plays = acted(sim, me.id, GENTLE_PLAYBOOK, 200);
    expect(foe.hp).toBe(foe.maxHp);
    expect(plays.has('fight')).toBe(false);
    expect(plays.has('trade-back')).toBe(false);
    // The Laner, on the same scene, fights on sight.
    const laner = duel();
    acted(laner.sim, laner.me.id, LANER_PLAYBOOK, 200);
    expect(laner.foe.hp).toBeLessThan(laner.foe.maxHp);
  });

  it('holds until both the time and the level are past: 2:00 alone is not enough', () => {
    const early = duel({ time: GENTLE_FROM_S + 10, level: GENTLE_FROM_LEVEL - 1 });
    const earlyPlays = acted(early.sim, early.me.id, GENTLE_PLAYBOOK, 120);
    expect(earlyPlays.has('fight')).toBe(false);
    expect(early.foe.hp).toBe(early.foe.maxHp);

    const late = duel({ time: GENTLE_FROM_S + 10, level: GENTLE_FROM_LEVEL });
    const latePlays = acted(late.sim, late.me.id, GENTLE_PLAYBOOK, 120);
    expect(latePlays.has('fight')).toBe(true);
    expect(late.foe.hp).toBeLessThan(late.foe.maxHp);
  });

  it('trades back when a champion hits it, from the first second', () => {
    const { sim, me, foe } = duel({ foeAttacks: true });
    const plays = acted(sim, me.id, GENTLE_PLAYBOOK, 160);
    expect(me.hp).toBeLessThan(me.maxHp);
    expect(plays.has('trade-back')).toBe(true);
    expect(plays.has('fight')).toBe(false);
    expect(foe.hp).toBeLessThan(foe.maxHp);
  });

  it('never stays under an enemy tower with an enemy champion near, even for a kill', () => {
    const tower = GAME_MAP.towers.find((t) => t.team === 1 && t.lane === 'mid')!;
    const home = GAME_MAP.fountains.find((f) => f.team === 0)!;
    const len = Math.hypot(home.x - tower.x, home.z - tower.z);
    const ux = (home.x - tower.x) / len;
    const uz = (home.z - tower.z) / len;
    const sim = new Sim(41);
    const me = sim.addChampion(0, { x: tower.x + ux * 10.5, z: tower.z + uz * 10.5 });
    const foe = sim.addChampion(1, { x: tower.x + ux * 2, z: tower.z + uz * 2 });
    foe.hp = foe.maxHp * 0.2;
    const foeHp = foe.hp;
    sim.attachPolicy(foe.id, () => ({ kind: 'stop' }));
    const plays = acted(sim, me.id, GENTLE_PLAYBOOK, 40);
    expect(plays.has('no-dive')).toBe(true);
    expect(plays.has('fight')).toBe(false);
    expect(Math.hypot(me.pos.x - tower.x, me.pos.z - tower.z)).toBeGreaterThan(10.5);
    // Untouched: its health only regenerates.
    expect(foe.hp).toBeGreaterThanOrEqual(foeHp);
  });

  it('keeps the Jungler on the forest seat and the fill lineup when posted', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const drawn = houseSeats([], new Rng(seed));
      const gentle = gentleSeats(drawn);
      expect(gentle.map((s) => [s.championId, s.lane])).toEqual(
        drawn.map((s) => [s.championId, s.lane]),
      );
      for (const [i, s] of gentle.entries()) {
        expect(s.bot).toBe(drawn[i]!.bot === JUNGLER.id ? JUNGLER.id : 'gentle');
      }
    }
  });
});

describe('the struck trigger', () => {
  it('reads the last hit by an enemy champion off the observation', () => {
    const { sim, me } = duel({ foeAttacks: true });
    const obs0 = buildObservation(sim, me.id)!;
    expect(obs0.self.struckAt).toBeNull();
    expect(holds({ kind: 'struck' }, buildSlotContext(obs0, new Rng(1)))).toBe(false);
    for (let i = 0; i < 80 && me.hp === me.maxHp; i++) sim.tick();
    expect(me.hp).toBeLessThan(me.maxHp);
    const obs = buildObservation(sim, me.id)!;
    expect(obs.self.struckAt).not.toBeNull();
    expect(obs.self.struckAt!).toBeLessThanOrEqual(obs.time);
    expect(holds({ kind: 'struck' }, buildSlotContext(obs, new Rng(1)))).toBe(true);
    // Five seconds on, the default window has closed; a wider one has not.
    const later = { ...obs, time: obs.self.struckAt! + 5 };
    expect(holds({ kind: 'struck' }, buildSlotContext(later, new Rng(1)))).toBe(false);
    expect(holds({ kind: 'struck', within: 6 }, buildSlotContext(later, new Rng(1)))).toBe(true);
  });

  it('passes the validator with and without a window, and refuses a wild one', () => {
    const def = (when: unknown): unknown => ({
      version: 4,
      plays: [{ id: 'a', when, do: { kind: 'hold' } }],
    });
    expect(validatePlaybook(def({ kind: 'struck' })).ok).toBe(true);
    expect(validatePlaybook(def({ kind: 'struck', within: 5 })).ok).toBe(true);
    expect(validatePlaybook(def({ kind: 'struck', within: 500 })).ok).toBe(false);
  });
});

describe('who meets the Gentle player', () => {
  const human = (clientId: number, team: 0 | 1): MatchPick => ({
    clientId,
    name: `p${clientId}`,
    team,
    championId: 'vesk',
    sigils: ['riftstep', 'mend'],
  });

  it('the enemies of a public match of Guests alone, and no one else', () => {
    expect(gentleTeams(true, [{ team: 0, id: -3 }])).toEqual([1]);
    expect(
      gentleTeams(true, [
        { team: 1, id: -3 },
        { team: 1, id: -4 },
      ]),
    ).toEqual([0]);
    // A Guest on each team: every house seat is someone's ally.
    expect(
      gentleTeams(true, [
        { team: 0, id: -3 },
        { team: 1, id: -4 },
      ]),
    ).toEqual([]);
    // An account in the match, a lobby or the Forge queue, nobody at all.
    expect(
      gentleTeams(true, [
        { team: 0, id: -3 },
        { team: 0, id: 12 },
      ]),
    ).toEqual([]);
    expect(gentleTeams(true, [{ team: 0, id: 12 }])).toEqual([]);
    expect(gentleTeams(false, [{ team: 0, id: -3 }])).toEqual([]);
    expect(gentleTeams(true, [])).toEqual([]);
  });

  it('the fill posts it on the named team only, the lineup the seed gives', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const plain = fillWithBots([human(1, 0)], seed);
      const gentle = fillWithBots([human(1, 0)], seed, 5, [], [1]);
      expect(gentle.map((p) => [p.team, p.championId, p.lanes])).toEqual(
        plain.map((p) => [p.team, p.championId, p.lanes]),
      );
      for (const [i, p] of gentle.entries()) {
        const before = plain[i]!;
        if (p.team === 0 || before.bot === JUNGLER.id) {
          expect(p.bot).toBe(before.bot);
          expect(p.name).toBe(before.name);
        } else {
          expect(p.bot).toBe('gentle');
          expect(p.name).toBe('House gentle player');
        }
      }
    }
  });

  it('plays a seeded match the same way twice', () => {
    const run = (): string => {
      const picks = fillWithBots([], 7, 5, [], [1]);
      const { sim } = buildMatchSim(starOrchard(), 7, picks);
      for (let i = 0; i < 400; i++) sim.tick();
      return [...sim.units.values()]
        .filter((u) => u.kind === 'champion')
        .map((u) => `${u.id}:${u.pos.x.toFixed(4)},${u.pos.z.toFixed(4)},${u.hp.toFixed(2)}`)
        .join('|');
    };
    expect(run()).toBe(run());
  });
});

describe('the practice seed', () => {
  it('is new per match, positive and inside the span', () => {
    expect(practiceSeed(() => 0)).toBe(1);
    expect(practiceSeed(() => 0.999999999)).toBeLessThanOrEqual(PRACTICE_SEED_SPAN);
    const seeds = new Set<number>();
    for (let i = 0; i < 50; i++) seeds.add(practiceSeed());
    expect(seeds.size).toBeGreaterThan(45);
  });
});
