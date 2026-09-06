// The wall in front of the roster (ADR 0018): what an account may pick,
// what a match pays it, what the shop refuses, and the one case that
// would have broken blind pick if the duplicate rule had kept drawing
// from the whole roster.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountRegistry } from '../server/accounts';
import { BotStore } from '../server/bot_store';
import { createBot } from '../server/bots';
import {
  backfillLaurels,
  CHAMPION_PRICES,
  FIRST_WIN_BONUS,
  MATCH_LAURELS,
  playableAt,
  STARTER_COLLECTION,
  WIN_LAURELS,
} from '../server/laurels';
import type { MatchPick } from '../server/match';
import { Matchmaker, type MatchSource } from '../server/matchmaker';
import type { MatchRecord } from '../server/records';
import type { ServerMsg } from '../src/net/protocol';

const dirs: string[] = [];
function tmpFile(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'loc-collection-'));
  dirs.push(d);
  return path.join(d, 'accounts.json');
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function account(registry: AccountRegistry, name: string): number {
  const made = registry.register(name, 'a good password', `${name}@example.com`, 0);
  if (!made.ok) throw new Error('fixture failed to register');
  return made.value.id;
}

// A matchmaker whose clients all hold the same playable set, which is the
// worst case the wall has to survive: a lobby of fresh accounts.
function harness(playable: readonly string[] | null): {
  mm: Matchmaker;
  matches: MatchPick[][];
} {
  const sent = new Map<number, ServerMsg[]>();
  const matches: MatchPick[][] = [];
  const sources: MatchSource[] = [];
  const mm = new Matchmaker(
    (clientId, msg) => {
      const list = sent.get(clientId) ?? [];
      list.push(msg);
      sent.set(clientId, list);
    },
    (picks, source) => {
      matches.push(picks);
      sources.push(source);
    },
    undefined,
    { resolvePlayable: () => playable },
  );
  return { mm, matches };
}

describe('the wall at champion select', () => {
  it('refuses a champion outside the collection and lands on one inside it', () => {
    const { mm, matches } = harness(STARTER_COLLECTION);
    mm.addToQueue(1, 'alice', 0);
    mm.startNow(1, 0);
    // Korrath is for sale, not owned; the pick falls back like any other
    // invalid one rather than reaching the match.
    mm.pick(1, 'korrath', ['riftstep', 'mend']);
    expect(matches).toHaveLength(1);
    expect(STARTER_COLLECTION).toContain(matches[0]![0]!.championId);
  });

  it('lets a champion of the week through without owning it', () => {
    const week = playableAt(STARTER_COLLECTION, Date.UTC(2026, 8, 6));
    const rotating = week.find((id) => !STARTER_COLLECTION.includes(id));
    expect(rotating).toBeDefined();
    const { mm, matches } = harness(week);
    mm.addToQueue(1, 'alice', 0);
    mm.startNow(1, 0);
    mm.pick(1, rotating as string, ['riftstep', 'mend']);
    expect(matches[0]![0]!.championId).toBe(rotating);
  });

  it('never hands a whole team a champion nobody owns', () => {
    // The case that forced the rotation to exist. Ten fresh accounts, the
    // same seven playable champions, every one of them asking for the
    // same champion: the duplicate rule has to find each of them another
    // one, and every one it finds must be theirs to play.
    const week = playableAt(STARTER_COLLECTION, Date.UTC(2026, 8, 6));
    const { mm, matches } = harness(week);
    for (let id = 1; id <= 10; id++) mm.addToQueue(id, `p${id}`, 0);
    for (let id = 1; id <= 10; id++) mm.pick(id, 'sylra', ['riftstep', 'mend']);
    expect(matches).toHaveLength(1);
    const picks = matches[0]!;
    expect(picks).toHaveLength(10);
    for (const p of picks) expect(week).toContain(p.championId);
    // And the duplicate rule still holds within each team.
    for (const team of [0, 1]) {
      const ids = picks.filter((p) => p.team === team).map((p) => p.championId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('picks freely when no wall is injected, which is what practice is', () => {
    const { mm, matches } = harness(null);
    mm.addToQueue(1, 'alice', 0);
    mm.startNow(1, 0);
    mm.pick(1, 'korrath', ['riftstep', 'mend']);
    expect(matches[0]![0]!.championId).toBe('korrath');
  });
});

describe('the laurel balance on an account', () => {
  it('starts at the starter collection and nothing else', () => {
    const registry = new AccountRegistry(tmpFile());
    const id = account(registry, 'alice');
    expect(registry.collection(id)).toEqual([...STARTER_COLLECTION]);
    expect(registry.laurels(id)).toBe(0);
  });

  it('pays the first win of a day once, and the day after again', () => {
    const registry = new AccountRegistry(tmpFile());
    const id = account(registry, 'alice');
    const day = Date.UTC(2026, 8, 6, 12);
    expect(registry.award(id, true, day, true)).toBe(WIN_LAURELS + FIRST_WIN_BONUS);
    expect(registry.award(id, true, day + 3600_000, true)).toBe(WIN_LAURELS);
    expect(registry.award(id, false, day + 7200_000, true)).toBe(MATCH_LAURELS);
    expect(registry.award(id, true, day + 24 * 3600_000, true)).toBe(WIN_LAURELS + FIRST_WIN_BONUS);
    expect(registry.laurels(id)).toBe(3 * WIN_LAURELS + 2 * FIRST_WIN_BONUS + MATCH_LAURELS);
  });

  it('leaves the day bonus standing when the only win was unrated', () => {
    // A stroll against house bots pays the fixed part and must not spend
    // the bonus a contested match is meant to claim.
    const registry = new AccountRegistry(tmpFile());
    const id = account(registry, 'alice');
    const day = Date.UTC(2026, 8, 6, 12);
    expect(registry.award(id, true, day, false)).toBe(MATCH_LAURELS);
    expect(registry.award(id, true, day + 3600_000, true)).toBe(WIN_LAURELS + FIRST_WIN_BONUS);
  });

  it('recruits a champion, once, and only with the laurels for it', () => {
    const registry = new AccountRegistry(tmpFile());
    const id = account(registry, 'alice');
    const price = CHAMPION_PRICES.korrath as number;
    expect(registry.recruit(id, 'korrath')).toEqual({
      ok: false,
      error: 'not_enough_laurels',
    });
    registry.seedLaurels(id, price + 10, null);
    const bought = registry.recruit(id, 'korrath');
    expect(bought).toEqual({ ok: true, value: 10 });
    expect(registry.collection(id)).toContain('korrath');
    expect(registry.recruit(id, 'korrath')).toEqual({ ok: false, error: 'already_owned' });
    // A starter is not for sale, and neither is anything that is not a
    // roster champion.
    expect(registry.recruit(id, 'sylra')).toEqual({ ok: false, error: 'not_for_sale' });
    expect(registry.recruit(id, 'nobody')).toEqual({ ok: false, error: 'not_for_sale' });
  });

  it('survives a reload, because a restart must not take a champion back', () => {
    const file = tmpFile();
    const first = new AccountRegistry(file);
    const id = account(first, 'alice');
    first.seedLaurels(id, 900, null);
    expect(first.recruit(id, 'vesk').ok).toBe(true);
    const second = new AccountRegistry(file);
    expect(second.collection(id)).toContain('vesk');
    expect(second.laurels(id)).toBe(900 - (CHAMPION_PRICES.vesk as number));
  });
});

describe('the crossing', () => {
  const rec = (at: number, winner: 0 | 1, way?: 'bot', queue?: 'arena'): MatchRecord => ({
    at,
    durationS: 1200,
    winner,
    rated: true,
    ...(queue ? { queue } : {}),
    players: [
      {
        accountId: 7,
        name: 'alice',
        championId: 'sylra',
        team: 0,
        level: 18,
        kills: 1,
        deaths: 1,
        assists: 1,
        cs: 100,
        ...(way ? { way } : {}),
      },
    ],
  });

  it('credits what the recorded matches would have earned', () => {
    const day = Date.UTC(2026, 8, 6, 12);
    const out = backfillLaurels([rec(day, 0), rec(day + 3600_000, 1)], 7);
    // A first win of the day, then a loss.
    expect(out.laurels).toBe(WIN_LAURELS + FIRST_WIN_BONUS + MATCH_LAURELS);
    expect(out.lastWinDay).not.toBeNull();
  });

  it('credits an unrated win the fixed part, as it would today', () => {
    const day = Date.UTC(2026, 8, 6, 12);
    const out = backfillLaurels([{ ...rec(day, 0), rated: false }], 7);
    expect(out.laurels).toBe(MATCH_LAURELS);
    expect(out.lastWinDay).toBeNull();
  });

  it('pays nothing for the ways a bot played', () => {
    const day = Date.UTC(2026, 8, 6, 12);
    expect(backfillLaurels([rec(day, 0, 'bot')], 7).laurels).toBe(0);
    expect(backfillLaurels([rec(day, 0, undefined, 'arena')], 7).laurels).toBe(0);
  });

  it('runs once: an account already carrying a balance is left alone', () => {
    const registry = new AccountRegistry(tmpFile());
    const id = account(registry, 'alice');
    expect(registry.seedLaurels(id, 500, null)).toBe(true);
    expect(registry.seedLaurels(id, 9999, null)).toBe(false);
    expect(registry.laurels(id)).toBe(500);
  });
});

describe('the Academy', () => {
  it('refuses a bot on a champion its owner does not hold', () => {
    const deps = {
      store: new BotStore(':memory:'),
      collectionOf: () => STARTER_COLLECTION,
    };
    const outside = createBot(deps, 1, { name: 'Scout', championId: 'korrath' });
    expect(outside.ok).toBe(false);
    const inside = createBot(deps, 1, { name: 'Scout', championId: 'sylra' });
    expect(inside.ok).toBe(true);
  });
});
