// Fifty house bots play a whole battle royale on the real Wanderseed, once
// per variant, twice each from the same seed: the same match to the last
// checksum, ended on time (Respawn when the last light goes out, One life
// once one champion is left, a little past it at worst), with numbers that
// read like a match (an early first takedown, fights all along, the caches
// looted, few deaths to the Dusk, a winner who levelled up), and bots that
// fight one another: a bot with an enemy in sight close by is mostly
// fighting it, and few takedowns are steals (a playtest, 2026-10-03: in One
// life the bots let each other be and only came to finish a champion
// someone else had worn down).

import { describe, expect, it } from 'vitest';
import { buildRoyaleSim, type ReplayPick } from '../src/net/replay';
import { dist } from '../src/sim/geo';
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
  // Of the seconds a bot had an enemy in its sight within CLOSE_M, the
  // share it had hit a champion in the last HIT_S.
  fighting: number;
  // The share of takedowns whose killer dealt under STEAL_SHARE of the
  // champion damage the victim took in its last STEAL_S.
  steals: number;
}

const CLOSE_M = 8;
const HIT_S = 3;
const STEAL_SHARE = 0.25;
const STEAL_S = 10;

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
  const champ = (id: number) => sim.units.get(id)?.kind === 'champion';
  const lastHit = new Map<number, number>();
  const taken = new Map<number, { src: number; amount: number; t: number }[]>();
  let close = 0;
  let fighting = 0;
  let takedowns = 0;
  let steals = 0;
  let ticks = 0;
  while (mode.state.stage !== 'over' && ticks < cap) {
    for (const e of sim.tick()) {
      if (
        e.type === 'damage' &&
        e.sourceId !== e.targetId &&
        champ(e.sourceId) &&
        champ(e.targetId)
      ) {
        lastHit.set(e.sourceId, sim.time);
        const hits = (taken.get(e.targetId) ?? []).filter((h) => sim.time - h.t <= STEAL_S);
        hits.push({ src: e.sourceId, amount: e.amount, t: sim.time });
        taken.set(e.targetId, hits);
      }
      if (e.type === 'death' && e.killerId !== e.unitId && champ(e.unitId) && champ(e.killerId)) {
        const hits = (taken.get(e.unitId) ?? []).filter((h) => sim.time - h.t <= STEAL_S);
        const all = hits.reduce((a, h) => a + h.amount, 0);
        const own = hits.filter((h) => h.src === e.killerId).reduce((a, h) => a + h.amount, 0);
        takedowns++;
        if (all > 0 && own < all * STEAL_SHARE) steals++;
        taken.delete(e.unitId);
      }
    }
    ticks++;
    if (ticks % 200 === 0) checks.push(sim.checksum());
    if (mode.state.stage !== 'play' || ticks % 20 !== 0) continue;
    const alive = [...sim.units.values()].filter((u) => u.kind === 'champion' && !u.dead);
    for (const u of alive) {
      const near = alive.some(
        (o) => o !== u && dist(u.pos, o.pos) <= CLOSE_M && sim.isVisible(u.team, o.id),
      );
      if (!near) continue;
      close++;
      if (sim.time - (lastHit.get(u.id) ?? Number.NEGATIVE_INFINITY) <= HIT_S) fighting++;
    }
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
    fighting: close > 0 ? fighting / close : 0,
    steals: takedowns > 0 ? steals / takedowns : 0,
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
    expect(a.fighting).toBeGreaterThan(0.5);
    // The planet tuning evens the field: the weaker a champion, the more of
    // its takedowns are steals, and no champion is a free kill any more, so
    // the share rises with balance (27.9% before the tuning, 35% after).
    expect(a.steals).toBeLessThan(0.4);
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
    // The bots fight one another from the calm on: an enemy close by is
    // mostly fought (a tenth of the time before), few takedowns are steals,
    // and the field does not fall in the first minutes.
    expect(a.fighting).toBeGreaterThan(0.4);
    // A Seedfall's cache draws the few left standing to one point, so a
    // takedown lands a little more often on a champion someone else wore down.
    expect(a.steals).toBeLessThan(0.15);
    expect(a.ticks).toBeGreaterThan(Math.round((DROP_S + 360) * 20));
  }, 300_000);
});
