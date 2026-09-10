// The fill (CONTEXT.md; plan-bots phase 11): house bots complete a team by
// the roster's lanes, drawn from the match seed, around what the team
// holds, on every host: the server's backfill, the Arena, sparring, the
// offline practice, the environment.

import { describe, expect, it } from 'vitest';
import { fillWithBots } from '../server/bot_fill';
import { starOrchard } from '../server/star_orchard';
import { sparringPicks } from '../src/game/sparring_core';
import { buildMatchSim } from '../src/net/replay';
import { CHAMPIONS, type ChampionRole } from '../src/sim/content/champions';
import { LANER_PLAYBOOK } from '../src/sim/content/playbooks/laner';
import { fillTeam, TEAM_SIZE } from '../src/sim/fill';
import { Rng } from '../src/sim/rng';

const roles = (ids: readonly string[]): ChampionRole[] => ids.map((id) => CHAMPIONS[id]!.role);
const count = (ids: readonly string[], role: ChampionRole): number =>
  roles(ids).filter((r) => r === role).length;
const TOP: ChampionRole[] = ['Tank', 'Fighter'];
const MID: ChampionRole[] = ['Mage', 'Assassin', 'Battlemage'];

describe('the fill', () => {
  it('completes an empty team by the roster lanes: two top, one mid, a marksman and a support', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const team = fillTeam([], new Rng(seed));
      expect(team).toHaveLength(TEAM_SIZE);
      expect(new Set(team).size).toBe(TEAM_SIZE);
      expect(count(team, 'Marksman'), `seed ${seed}`).toBe(1);
      expect(count(team, 'Support'), `seed ${seed}`).toBe(1);
      const top = roles(team).filter((r) => TOP.includes(r)).length;
      const mid = roles(team).filter((r) => MID.includes(r)).length;
      const flex = count(team, 'Skirmisher');
      expect(top).toBeLessThanOrEqual(2);
      expect(mid).toBeLessThanOrEqual(1);
      expect(top + mid + flex).toBe(3);
    }
  });

  it('repeats for a seed and varies across seeds', () => {
    expect(fillTeam([], new Rng(3))).toEqual(fillTeam([], new Rng(3)));
    const lineups = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      lineups.add([...fillTeam([], new Rng(seed))].sort().join(','));
    }
    expect(lineups.size).toBeGreaterThan(3);
  });

  it('complements what the team holds: a lone marksman gets a support, never a second marksman', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const team = fillTeam([{ championId: 'vesk' }], new Rng(seed));
      expect(team).toHaveLength(4);
      expect(team).not.toContain('vesk');
      expect(count(team, 'Marksman')).toBe(0);
      expect(count(team, 'Support')).toBe(1);
    }
    const duo = fillTeam([{ championId: 'vesk' }, { championId: 'maera' }], new Rng(2));
    expect(duo).toHaveLength(3);
    expect(count(duo, 'Marksman') + count(duo, 'Support')).toBe(0);
  });

  it('seats fixed roles first, then the flex, a forged champion by its role, an unknown one anywhere', () => {
    // Rhoka held before the two top champions still leaves them their seats
    // and takes mid: only the bot lane is left to fill.
    const flexed = fillTeam(
      [{ championId: 'rhoka' }, { championId: 'korrath' }, { championId: 'dain' }],
      new Rng(1),
    );
    expect(roles(flexed).sort()).toEqual(['Marksman', 'Support']);
    const forged = fillTeam([{ championId: 'forged_1', role: 'Marksman' }], new Rng(1));
    expect(forged).toHaveLength(4);
    expect(count(forged, 'Marksman')).toBe(0);
    expect(count(forged, 'Support')).toBe(1);
    const unknown = fillTeam([{ championId: 'forged_2' }], new Rng(1));
    expect(unknown).toHaveLength(4);
    expect(count(unknown, 'Marksman')).toBe(1);
    expect(count(unknown, 'Support')).toBe(1);
  });

  it('honors the team size and gives nothing to a full team', () => {
    const trio = fillTeam([], new Rng(4), 3);
    expect(trio).toHaveLength(3);
    expect(new Set(trio).size).toBe(3);
    const full = ['korrath', 'dain', 'sylra', 'vesk', 'maera'].map((championId) => ({
      championId,
    }));
    expect(fillTeam(full, new Rng(4))).toEqual([]);
  });
});

describe('the fill on every host', () => {
  const HUMAN = {
    clientId: 1,
    name: 'human',
    team: 0 as const,
    championId: 'vesk',
    sigils: ['riftstep', 'mend'] as [string, string],
  };

  it('the server backfill seats house bots around the humans, drawn from the seed', () => {
    const picks = fillWithBots([HUMAN], 5);
    expect(picks).toHaveLength(10);
    const mine = picks.filter((p) => p.team === 0).map((p) => p.championId);
    expect(mine[0]).toBe('vesk');
    expect(count(mine, 'Marksman')).toBe(1);
    expect(count(mine, 'Support')).toBe(1);
    const theirs = picks.filter((p) => p.team === 1).map((p) => p.championId);
    expect(new Set(theirs).size).toBe(5);
    expect(count(theirs, 'Marksman')).toBe(1);
    expect(count(theirs, 'Support')).toBe(1);
    const lineup = (seed: number) =>
      fillWithBots([HUMAN], seed)
        .map((p) => p.championId)
        .join(',');
    const seen = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) seen.add(lineup(seed));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('sparring completes the bot team around its champion and draws the other whole', () => {
    const picks = sparringPicks(
      {
        name: 'x',
        championId: 'maera',
        sigils: ['riftstep', 'mend'],
        skin: 0,
        playbook: LANER_PLAYBOOK,
      },
      9,
    );
    expect(picks).toHaveLength(10);
    const mine = picks.filter((p) => p.team === 0).map((p) => p.championId);
    expect(mine[0]).toBe('maera');
    expect(count(mine, 'Support')).toBe(1);
    expect(count(mine, 'Marksman')).toBe(1);
    const theirs = picks.filter((p) => p.team === 1).map((p) => p.championId);
    expect(count(theirs, 'Support')).toBe(1);
    expect(count(theirs, 'Marksman')).toBe(1);
  });

  it('the sim then seats the lineup in its home lanes: the support beside the marksman', () => {
    const picks = sparringPicks(
      {
        name: 'x',
        championId: 'vesk',
        sigils: ['riftstep', 'mend'],
        skin: 0,
        playbook: LANER_PLAYBOOK,
      },
      9,
    );
    const { sim, unitIds } = buildMatchSim(starOrchard(), 9, picks);
    const team = unitIds.slice(0, 5).map((id) => sim.units.get(id)!);
    expect(team[0]!.lane).toBe('bot');
    const support = team.find((u) => CHAMPIONS[u.championId!]!.role === 'Support')!;
    expect(support.lane).toBe('bot');
    const lanes = team.map((u) => u.lane);
    expect(lanes.filter((l) => l === 'top')).toHaveLength(2);
    expect(lanes.filter((l) => l === 'mid')).toHaveLength(1);
    expect(lanes.filter((l) => l === 'bot')).toHaveLength(2);
  });
});
