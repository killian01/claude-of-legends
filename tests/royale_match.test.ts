// Fifty house bots play a whole battle royale on the real Wanderseed, once
// per variant, twice each from the same seed: the same match to the last
// checksum, ended on time (Respawn when the last light goes out, One life
// once one champion is left, a little past it at worst), with numbers that
// read like a match (an early first takedown, fights all along, the caches
// looted, few deaths to the Dusk, a winner who levelled up).

import { describe, expect, it } from 'vitest';
import { buildRoyaleSim, type ReplayPick } from '../src/net/replay';
import { royaleHouseChampions } from '../src/sim/royale/fill';
import type { RoyaleTally } from '../src/sim/royale/mode';
import { DROP_S, PLAY_S, type RoyaleVariant } from '../src/sim/royale/types';
import { loadPlanet } from './royale_planet';

interface Played {
  checks: number[];
  ticks: number;
  winnerId: number | null;
  tally: RoyaleTally;
  levels: number[];
  winnerLevel: number;
  winnerItems: string[];
}

function play(variant: RoyaleVariant, seed: number): Played {
  const picks: ReplayPick[] = royaleHouseChampions(seed, 50).map((championId, i) => ({
    name: `house${i}`,
    team: i,
    championId,
    sigils: ['riftstep', 'mend'],
    bot: 'royale',
  }));
  const { sim } = buildRoyaleSim(loadPlanet(), seed, picks, variant);
  const mode = sim.royaleMode!;
  const checks: number[] = [];
  const cap = Math.round((DROP_S + PLAY_S + 90) * 20);
  let ticks = 0;
  while (mode.state.stage !== 'over' && ticks < cap) {
    sim.tick();
    ticks++;
    if (ticks % 200 === 0) checks.push(sim.checksum());
  }
  const champs = [...sim.units.values()].filter((u) => u.kind === 'champion');
  const winner = mode.state.winnerId !== null ? sim.units.get(mode.state.winnerId) : undefined;
  return {
    checks,
    ticks,
    winnerId: mode.state.winnerId,
    tally: { ...mode.tally },
    levels: champs.map((u) => u.level).sort((a, b) => a - b),
    winnerLevel: winner?.level ?? 0,
    winnerItems: winner ? [...winner.items] : [],
  };
}

describe('a whole battle royale of fifty house bots', () => {
  it('plays Respawn to the last light, the same match twice', () => {
    const a = play('respawn', 7);
    const b = play('respawn', 7);
    expect(b).toEqual(a);
    // Over exactly when the last light goes out.
    expect(a.ticks).toBe(Math.round((DROP_S + PLAY_S) * 20) + 1);
    expect(a.winnerId).not.toBeNull();
    expect(a.tally.firstTakedownAt).not.toBeNull();
    expect(a.tally.firstTakedownAt!).toBeLessThan(DROP_S + 120);
    expect(a.tally.takedowns).toBeGreaterThan(150);
    expect(a.tally.cachesOpened).toBeGreaterThan(150);
    expect(a.tally.duskDeaths).toBeLessThan(a.tally.takedowns / 5);
    expect(a.tally.campsTaken).toBeGreaterThan(15);
    expect(a.winnerLevel).toBeGreaterThanOrEqual(9);
    expect(a.winnerItems.length).toBeGreaterThanOrEqual(3);
    // The middle of the field levelled up too.
    expect(a.levels[25]!).toBeGreaterThanOrEqual(6);
  }, 300_000);

  it('plays One life to the last standing, the same match twice', () => {
    const a = play('one_life', 7);
    const b = play('one_life', 7);
    expect(b).toEqual(a);
    expect(a.winnerId).not.toBeNull();
    // Ended by the last standing, at worst a little past the last light.
    expect(a.ticks).toBeLessThan(Math.round((DROP_S + PLAY_S + 60) * 20));
    expect(a.tally.firstTakedownAt).not.toBeNull();
    expect(a.tally.firstTakedownAt!).toBeLessThan(DROP_S + 150);
    expect(a.tally.takedowns + a.tally.duskDeaths).toBeGreaterThanOrEqual(40);
    expect(a.tally.duskDeaths).toBeLessThan(25);
    expect(a.tally.cachesOpened).toBeGreaterThan(100);
    expect(a.winnerLevel).toBeGreaterThanOrEqual(6);
    expect(a.winnerItems.length).toBeGreaterThanOrEqual(3);
  }, 300_000);
});
