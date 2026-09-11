// The house styles (plan-bots phase 10, the loop's second half; CONTEXT.md:
// House style): four brains, each a valid playbook in the registry, drawn
// from the seed for every seat the fill hands out on every host, and
// visibly different on the same scene: the Brawler walks in where the
// Sieger holds, the Objective player is at the pit long before the Laner
// moves, the Sieger sieges ahead of the wave.

import { describe, expect, it } from 'vitest';
import { defaultSeats } from '../headless/env';
import { fillWithBots } from '../server/bot_fill';
import { starOrchard } from '../server/star_orchard';
import { ReplayWorld } from '../src/game/replay_world';
import { type SparBot, seriesPicks, sparringPicks } from '../src/game/sparring_core';
import { buildMatchSim } from '../src/net/replay';
import { BOTS, DEFAULT_BOT_ID } from '../src/sim/content/bots';
import {
  drawHouseStyle,
  HOUSE_STYLE_IDS,
  HOUSE_STYLES,
  houseName,
  houseSeats,
} from '../src/sim/content/bots/house';
import { LANER } from '../src/sim/content/bots/laner';
import { CHAMPIONS } from '../src/sim/content/champions';
import { GAME_MAP } from '../src/sim/content/map';
import { LANER_PLAYBOOK } from '../src/sim/content/playbooks/laner';
import { OBJECTIVE_PLAYBOOK } from '../src/sim/content/playbooks/objective';
import { SIEGER_PLAYBOOK } from '../src/sim/content/playbooks/sieger';
import { playbookPolicy } from '../src/sim/playbook/interpreter';
import type { PlaybookDef } from '../src/sim/playbook/types';
import { validatePlaybook } from '../src/sim/playbook/validate';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';

const BOT: SparBot = {
  name: 'x',
  championId: 'vesk',
  sigils: ['riftstep', 'mend'],
  skin: 0,
  playbook: LANER_PLAYBOOK,
};

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

describe('the house styles', () => {
  it('are five valid playbooks in the registry, the Laner still the default', () => {
    expect(HOUSE_STYLE_IDS).toEqual(['laner', 'brawler', 'sieger', 'objective', 'jungler']);
    for (const def of HOUSE_STYLES) {
      expect(BOTS[def.id]).toBe(def);
      expect(def.playbook, def.id).toBeDefined();
      const v = validatePlaybook(def.playbook);
      expect(v.ok, def.id).toBe(true);
    }
    expect(BOTS[DEFAULT_BOT_ID]).toBe(LANER);
    expect(houseName('sieger')).toBe('House sieger');
    expect(houseName('objective')).toBe('House objective player');
    expect(houseName('jungler')).toBe('House jungler');
    expect(houseName('nobody')).toBe('House laner');
  });

  it('are drawn from the seed after the champions: every style over the seeds, the same per seed', () => {
    const styles = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const seats = houseSeats([], new Rng(seed));
      expect(seats).toHaveLength(5);
      for (const s of seats) {
        expect(HOUSE_STYLE_IDS).toContain(s.bot);
        styles.add(s.bot);
      }
      expect(seats.filter((s) => CHAMPIONS[s.championId]!.role === 'Marksman')).toHaveLength(1);
      expect(seats.filter((s) => CHAMPIONS[s.championId]!.role === 'Support')).toHaveLength(1);
      expect(houseSeats([], new Rng(seed))).toEqual(seats);
    }
    expect([...styles].sort()).toEqual([...HOUSE_STYLE_IDS].sort());
    const drawn = new Set<string>();
    const rng = new Rng(3);
    for (let i = 0; i < 40; i++) drawn.add(drawHouseStyle(rng));
    expect(drawn.size).toBe(4);
  });

  it('reach every host: the server backfill, sparring, the series, the environment', () => {
    const human = {
      clientId: 1,
      name: 'human',
      team: 0 as const,
      championId: 'vesk',
      sigils: ['riftstep', 'mend'] as [string, string],
    };
    const mix = (seed: number): string =>
      fillWithBots([human], seed)
        .map((p) => p.bot ?? 'human')
        .join(',');
    for (const p of fillWithBots([human], 5).slice(1)) expect(HOUSE_STYLE_IDS).toContain(p.bot);
    const mixes = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) mixes.add(mix(seed));
    expect(mixes.size).toBeGreaterThan(1);

    const spar = sparringPicks(BOT, 1).slice(1);
    for (const p of spar) {
      expect(HOUSE_STYLE_IDS).toContain(p.bot);
      expect(p.name).toBe(houseName(p.bot!));
    }
    expect(sparringPicks(BOT, 2).map((p) => p.bot)).not.toEqual(
      sparringPicks(BOT, 1).map((p) => p.bot),
    );

    const series = seriesPicks(BOT, null, 3, 0).picks.filter((p) => p.bot !== undefined);
    expect(series).toHaveLength(9);
    for (const p of series) expect(HOUSE_STYLE_IDS).toContain(p.bot);

    const env = defaultSeats(1, 4);
    expect(env).toHaveLength(10);
    for (const s of env.slice(1)) expect(HOUSE_STYLE_IDS).toContain(s.bot);
  });

  it('each leave the fountain and fight what they see', () => {
    for (const def of HOUSE_STYLES) {
      const sim = new Sim(41);
      const bot = sim.addChampion(0);
      sim.attachPolicy(bot.id, def.policy);
      const start = { ...bot.pos };
      for (let i = 0; i < 300; i++) sim.tick();
      expect(Math.hypot(bot.pos.x - start.x, bot.pos.z - start.z), def.id).toBeGreaterThan(15);

      const duel = new Sim(41);
      const me = duel.addChampion(0, { x: 75, z: 75 });
      const victim = duel.addChampion(1, { x: 80, z: 75 });
      duel.attachPolicy(me.id, def.policy);
      for (let i = 0; i < 120; i++) duel.tick();
      expect(victim.hp, def.id).toBeLessThan(victim.maxHp);
    }
  });

  it('the Brawler walks in on a foe out of reach where the Sieger holds', () => {
    // Korrath alone, Vesk twelve units away: a walk-in, or not.
    const scene = (def: PlaybookDef): { plays: Set<string>; dx: number } => {
      const sim = new Sim(9);
      const me = sim.addChampion(0, { x: 60, z: 60 }, 'korrath');
      const foe = sim.addChampion(1, { x: 72, z: 60 }, 'vesk');
      sim.attachPolicy(foe.id, () => ({ kind: 'noop' }));
      const x0 = me.pos.x;
      const plays = acted(sim, me.id, def, 20);
      return { plays, dx: me.pos.x - x0 };
    };
    const brawler = scene(BOTS.brawler!.playbook!);
    expect(brawler.plays.has('fight')).toBe(true);
    expect(brawler.dx).toBeGreaterThan(2);
    const sieger = scene(SIEGER_PLAYBOOK);
    expect(sieger.plays.has('fight')).toBe(false);
  });

  it('the Objective player is at the pit forty seconds early, the Laner not yet', () => {
    const pit = GAME_MAP.wardenPits[0]!;
    const scene = (def: PlaybookDef): { plays: Set<string>; closer: number } => {
      const sim = new Sim(9);
      const me = sim.addChampion(0, { x: pit.x - 30, z: pit.z }, 'vesk');
      sim.objectives.nextSpawnAt = sim.time + 40;
      const d0 = Math.hypot(me.pos.x - pit.x, me.pos.z - pit.z);
      const plays = acted(sim, me.id, def, 40);
      return { plays, closer: d0 - Math.hypot(me.pos.x - pit.x, me.pos.z - pit.z) };
    };
    const objective = scene(OBJECTIVE_PLAYBOOK);
    expect(objective.plays.has('warden')).toBe(true);
    expect(objective.closer).toBeGreaterThan(3);
    expect(scene(LANER_PLAYBOOK).plays.has('warden')).toBe(false);
  });

  it('are said on the replay scoreboard, the bot by its name, the seats by their style', () => {
    const picks = sparringPicks(BOT, 2);
    const { sim, unitIds } = buildMatchSim(starOrchard(), 2, picks);
    const seats = new Map(unitIds.map((id, i) => [id, picks[i]!.name]));
    sim.tick();
    expect(sim.scoreboard().every((r) => r.player === null)).toBe(true);
    const world = new ReplayWorld(sim, seats);
    const rows = world.scoreboard();
    expect(rows).toHaveLength(10);
    expect(rows.find((r) => r.unitId === unitIds[0])?.player).toBe(BOT.name);
    for (const r of rows.slice(1))
      expect(r.player).toMatch(/^House (laner|brawler|sieger|objective player|jungler)$/);
    const rebuilt = buildMatchSim(starOrchard(), 2, picks).sim;
    world.rebind(rebuilt);
    expect(world.scoreboard().map((r) => r.player)).toEqual(rows.map((r) => r.player));
  });

  it('the Sieger hits a structure before the wave, the Laner after', () => {
    const at = (def: PlaybookDef, id: string): number => def.plays.findIndex((p) => p.id === id);
    expect(at(SIEGER_PLAYBOOK, 'siege')).toBeLessThan(at(SIEGER_PLAYBOOK, 'farm'));
    expect(at(LANER_PLAYBOOK, 'siege')).toBeGreaterThan(at(LANER_PLAYBOOK, 'farm'));
    expect(SIEGER_PLAYBOOK.plays[at(SIEGER_PLAYBOOK, 'siege')]!.do).toEqual({
      kind: 'siege',
      escortMin: 1,
    });
  });
});
