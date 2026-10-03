// The seat report (server/seat_report.ts, PRIVACY.md): what one line says
// about a seat a person held online, how a live match counts it (orders,
// the first one, the walk, the load, the points, the first moments, the
// frame rate), and that nothing in it names anybody.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { freshStats, Match, noteMoments, WALK_STEP_MAX } from '../server/match';
import {
  buildSeatReport,
  countryOf,
  fpsOnWire,
  isMobileAgent,
  median,
  SEAT_REPORT_VERSION,
} from '../server/seat_report';
import { stepOnWire } from '../src/net/protocol';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function duel(): { match: Match; aliceId: number } {
  const match = new Match(5, [
    { clientId: 1, name: 'alice', team: 0, championId: 'korrath', sigils: ['riftstep', 'mend'] },
    { clientId: 2, name: 'bob', team: 1, championId: 'fenn', sigils: ['zephyr', 'sear'] },
  ]);
  return { match, aliceId: match.players.get(1)!.unitId };
}

describe('the seat report', () => {
  it('reads the country Cloudflare names, and nothing it cannot place', () => {
    expect(countryOf('BR')).toBe('BR');
    expect(countryOf(['US'])).toBe('US');
    expect(countryOf('XX')).toBeNull();
    expect(countryOf('T1')).toBeNull();
    expect(countryOf('fr')).toBeNull();
    expect(countryOf(undefined)).toBeNull();
  });

  it('tells a phone from a computer by what the browser says', () => {
    expect(
      isMobileAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'),
    ).toBe(true);
    expect(isMobileAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36')).toBe(
      true,
    );
    expect(isMobileAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0')).toBe(false);
    expect(isMobileAgent(undefined)).toBe(false);
  });

  it('takes the median and the worst of the round trips', () => {
    expect(median([])).toBeNull();
    expect(median([120, 80, 300])).toBe(120);
    expect(median([100, 200])).toBe(150);
  });

  it('counts a live seat: its orders, the first one, its walk, its load and its points', () => {
    const { match } = duel();
    const p = match.players.get(1)!;
    expect(p.stats.orders).toBe(0);
    for (let i = 0; i < 20; i++) match.tick();
    match.markLoaded(1);
    const loadedAt = p.stats.loadedTick;
    match.markLoaded(1);
    // Only the first word counts.
    expect(p.stats.loadedTick).toBe(loadedAt);
    const self = match.sim.units.get(p.unitId)!;
    match.handleCommand(1, { t: 'move', x: self.pos.x + 30, z: self.pos.z });
    for (let i = 0; i < 60; i++) match.tick();
    match.handleCommand(1, { t: 'move', x: self.pos.x - 5, z: self.pos.z });
    match.handleCommand(1, { t: 'skill', key: 'Q' });
    // A kind the report does not name counts as other, so a client cannot
    // grow the record with names of its own.
    match.handleCommand(1, { t: 'made_up' } as never);
    expect(p.stats.orders).toBe(4);
    expect(p.stats.kinds).toEqual({ move: 2, skill: 1, other: 1 });
    expect(p.stats.firstOrderTick).toBe(20);
    expect(p.stats.walked).toBeGreaterThan(10);
    match.notePoints(1, 3);
    match.notePoints(1, 10);
    expect(p.stats.points).toBe(13);
    // The first steps the client says it did (src/ui/first_steps.ts), in
    // order and each once, and the guide hidden.
    match.noteStep(1, 'learn');
    match.noteStep(1, 'learn');
    match.noteStep(1, 'off');
    expect(p.stats.steps).toEqual(['learn', 'off']);
    // A seat a bot stood in for and its player took back starts afresh.
    const seat = match.handleDisconnect(1)!;
    match.restorePlayer(9, seat);
    expect(match.players.get(9)?.stats.orders).toBe(0);
    expect(match.players.get(9)?.stats.startTick).toBe(match.sim.tickCount);
  });

  it('leaves a jump out of the walk: a respawn or a blink is not walking', () => {
    const { match } = duel();
    const p = match.players.get(1)!;
    const self = match.sim.units.get(p.unitId)!;
    match.tick();
    self.pos = { x: self.pos.x + WALK_STEP_MAX * 10, z: self.pos.z };
    match.tick();
    expect(p.stats.walked).toBeLessThan(WALK_STEP_MAX);
  });

  it('says it in seconds from the seat, and names nobody', () => {
    const rec = buildSeatReport({
      at: 1000,
      how: 'closed',
      queue: 'public',
      guest: true,
      dropIn: false,
      mobile: false,
      country: 'IT',
      stats: {
        startTick: 100,
        loadedTick: 160,
        orders: 4,
        kinds: { buy: 1, skill: 2, move: 1 },
        firstOrderTick: 200,
        steps: ['learn', 'last_hit'],
        walked: 41.6,
        lastX: 0,
        lastZ: 0,
        points: 2,
        firstHitTick: 300,
        firstHurtTick: 260,
        firstTakedownTick: null,
        firstDeathTick: 1100,
        firstCacheTick: null,
      },
      tickCount: 1300,
      unit: { level: 2, kills: 0, deaths: 1, assists: 0, cs: 2 },
      pings: [62, 58, 140],
      fps: [58.2, 31.4, 60],
    });
    expect(rec).toEqual({
      v: SEAT_REPORT_VERSION,
      at: 1000,
      how: 'closed',
      queue: 'public',
      guest: true,
      dropIn: false,
      mobile: false,
      country: 'IT',
      heldS: 60,
      matchS: 65,
      loadS: 3,
      firstOrderS: 5,
      orders: 4,
      kinds: { buy: 1, skill: 2, move: 1 },
      steps: ['learn', 'last_hit'],
      walkedM: 42,
      points: 2,
      level: 2,
      kills: 0,
      deaths: 1,
      assists: 0,
      cs: 2,
      pingMs: 62,
      pingMaxMs: 140,
      firstHitS: 10,
      firstHurtS: 8,
      firstTakedownS: null,
      diedS: 50,
      firstCacheS: null,
      fps: 58,
      fpsLow: 31,
    });
    const none = buildSeatReport({
      at: 0,
      how: 'menu',
      queue: 'lobby',
      guest: false,
      dropIn: true,
      mobile: true,
      country: null,
      stats: {
        startTick: 0,
        loadedTick: null,
        orders: 0,
        kinds: {},
        firstOrderTick: null,
        steps: [],
        walked: 0,
        lastX: 0,
        lastZ: 0,
        points: 0,
        firstHitTick: null,
        firstHurtTick: null,
        firstTakedownTick: null,
        firstDeathTick: null,
        firstCacheTick: null,
      },
      tickCount: 0,
      unit: null,
      pings: [],
      fps: [],
    });
    expect(none.loadS).toBeNull();
    expect(none.firstOrderS).toBeNull();
    expect(none.pingMs).toBeNull();
    expect(none.fps).toBeNull();
    expect(none.firstHitS).toBeNull();
    for (const key of Object.keys(rec)) expect(key).not.toMatch(/name|account|addr|ip|id$/i);
  });

  it("notes a seat's first moments once each, champions only", () => {
    // The visitors of the first days left inside two minutes: had anything
    // happened to them by then?
    const stats = freshStats(0, 0, 0);
    const champion = (id: number) => id < 100;
    noteMoments(stats, 7, [{ type: 'damage', sourceId: 7, targetId: 150 }], 10, champion);
    expect(stats.firstHitTick).toBeNull();
    noteMoments(stats, 7, [{ type: 'damage', sourceId: 7, targetId: 8 }], 20, champion);
    noteMoments(stats, 7, [{ type: 'damage', sourceId: 8, targetId: 7 }], 25, champion);
    noteMoments(stats, 7, [{ type: 'damage', sourceId: 7, targetId: 8 }], 30, champion);
    noteMoments(stats, 7, [{ type: 'royale_cache', unitId: 7 }], 40, champion);
    noteMoments(stats, 7, [{ type: 'death', unitId: 8, killerId: 7 }], 50, champion);
    noteMoments(stats, 7, [{ type: 'death', unitId: 7, killerId: 9 }], 60, champion);
    expect(stats.firstHitTick).toBe(20);
    expect(stats.firstHurtTick).toBe(25);
    expect(stats.firstCacheTick).toBe(40);
    expect(stats.firstTakedownTick).toBe(50);
    expect(stats.firstDeathTick).toBe(60);
  });

  it("hears the battle royale's first steps and a frame rate off the wire", () => {
    expect(stepOnWire('br_cache')).toBe('br_cache');
    expect(stepOnWire('br_takedown')).toBe('br_takedown');
    expect(stepOnWire('learn')).toBe('learn');
    expect(stepOnWire('off')).toBe('off');
    expect(stepOnWire('br_nothing')).toBeNull();
    expect(fpsOnWire(58.4)).toBe(58.4);
    expect(fpsOnWire(0)).toBeNull();
    expect(fpsOnWire(5000)).toBeNull();
    expect(fpsOnWire('60')).toBeNull();
    expect(fpsOnWire(Number.NaN)).toBeNull();
  });

  it('is named in the privacy notice, file and module alike', () => {
    const page = readFileSync(path.join(ROOT, 'PRIVACY.md'), 'utf8');
    expect(page).toContain('`seats.jsonl`');
    expect(page).toContain('`server/seat_report.ts`');
    expect(page).toContain('`scripts/seat_report.mjs`');
  });
});
