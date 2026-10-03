// Who sits in a battle royale (server/royale_seats.ts, server/royale_names.ts,
// ADR 0031): the person's pick made valid, the bots' invented names, the
// softening, and fifty seats each on its own team.

import { describe, expect, it } from 'vitest';
import { BOT_HANDLES, botNames } from '../server/royale_names';
import { DEFAULT_SIGILS, type RoyalePerson, royalePick, royaleSeats } from '../server/royale_seats';
import { CHAMPION_LIST, CHAMPIONS } from '../src/sim/content/champions';
import { SIGILS } from '../src/sim/content/sigils';
import { Rng } from '../src/sim/rng';
import { ROYALE_SEATS } from '../src/sim/royale/types';

const person = (clientId: number, name: string, guest = false): RoyalePerson => ({
  clientId,
  owner: guest ? -clientId : clientId,
  name,
  guest,
  pick: { championId: 'fenn', sigils: ['zephyr', 'sear'], skin: 1 },
});

describe('the bots names', () => {
  it('holds at least 120 distinct handles that read like names people pick', () => {
    expect(BOT_HANDLES.length).toBeGreaterThanOrEqual(120);
    const folded = new Set(BOT_HANDLES.map((h) => h.toLowerCase()));
    expect(folded.size).toBe(BOT_HANDLES.length);
    for (const h of BOT_HANDLES) {
      // The account name rules' shape: letters only here, 3 to 16, and no
      // space, which a Guest's handed-out name has.
      expect(h).toMatch(/^[A-Z][a-z]{2,15}$/);
    }
  });

  it('names nothing the game already names', () => {
    const taken = [
      ...CHAMPION_LIST.map((c) => c.id),
      ...Object.keys(SIGILS),
      'pyrefang',
      'voidmaul',
      'warden',
      'ascendant',
      'barkmaw',
      'spinecrest',
      'brackenlings',
      'wanderer',
      'wanderseed',
    ];
    for (const h of BOT_HANDLES) {
      for (const word of taken) expect(h.toLowerCase().includes(word), `${h} ${word}`).toBe(false);
    }
  });

  it('draws distinct names from the seed, clear of the people in the match', () => {
    const a = botNames(49, new Rng(7), ['Mossmantle']);
    const b = botNames(49, new Rng(7), ['Mossmantle']);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(49);
    expect(a).not.toContain('Mossmantle');
    expect(botNames(49, new Rng(8))).not.toEqual(a);
  });
});

describe('the pick', () => {
  it('keeps a valid pick and repairs the rest', () => {
    expect(royalePick({ championId: 'fenn', sigils: ['zephyr', 'sear'], skin: 1 }, null)).toEqual({
      championId: 'fenn',
      sigils: ['zephyr', 'sear'],
      skin: 1,
    });
    const bad = royalePick({ championId: 'nobody', sigils: ['zephyr', 'zephyr'], skin: 99 }, null);
    expect(CHAMPIONS[bad.championId]).toBeDefined();
    expect(bad.sigils).toEqual(DEFAULT_SIGILS);
    expect(bad.skin).toBe(0);
  });

  it('holds to what the person may pick (ADR 0018)', () => {
    expect(royalePick({ championId: 'vesk' }, ['torv', 'fenn']).championId).toBe('torv');
    expect(royalePick({ championId: 'fenn' }, ['torv', 'fenn']).championId).toBe('fenn');
  });
});

describe('the seats', () => {
  it('seats the people first, each on their pick, and bots on every other seat', () => {
    const seats = royaleSeats([person(1, 'alice')], 42);
    expect(seats).toHaveLength(ROYALE_SEATS);
    expect(seats[0]).toMatchObject({ name: 'alice', clientId: 1, championId: 'fenn', skin: 1 });
    expect(seats[0]!.bot).toBeUndefined();
    // Each its own team (ADR 0030).
    expect(new Set(seats.map((s) => s.team)).size).toBe(ROYALE_SEATS);
    const bots = seats.slice(1);
    expect(bots.every((s) => s.bot !== undefined && s.clientId === null)).toBe(true);
    expect(new Set(bots.map((s) => s.name)).size).toBe(bots.length);
    for (const s of bots) {
      expect(CHAMPIONS[s.championId]).toBeDefined();
      expect(s.sigils[0]).not.toBe(s.sigils[1]);
      expect(s.bot?.softened).toBe(false);
    }
  });

  it('seats the same match from the same seed', () => {
    expect(royaleSeats([person(1, 'alice')], 9)).toEqual(royaleSeats([person(1, 'alice')], 9));
    expect(royaleSeats([person(1, 'alice')], 9)).not.toEqual(royaleSeats([person(1, 'alice')], 10));
  });

  it('softens the bots when every person is a Guest', () => {
    const guests = royaleSeats([person(1, 'Wanderer 1', true)], 3);
    expect(guests.slice(1).every((s) => s.bot?.softened === true)).toBe(true);
    const mixed = royaleSeats([person(1, 'Wanderer 1', true), person(2, 'bob')], 3);
    expect(mixed.slice(2).every((s) => s.bot?.softened === false)).toBe(true);
  });
});
