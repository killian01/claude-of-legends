// The Forge queue (plan-forge phase 6): the forge-flavored Matchmaker
// resolving forged picks through the account boundary, Match embedding the
// match's forged definitions for distribution and replay, and the queue's
// own rating pair in the Forge store.

import { describe, expect, it } from 'vitest';
import { fillWithBots } from '../server/bot_fill';
import { ForgeStore } from '../server/forge_store';
import { Match, type MatchPick } from '../server/match';
import { Matchmaker, type MatchmakerOptions, type MatchSource } from '../server/matchmaker';
import { BASE_RATING } from '../server/rating';
import type { ServerMsg } from '../src/net/protocol';
import { DEFAULT_CHAMPION_ID } from '../src/sim/content/champions';
import { FORGED_TWINS } from './forged_twins';

const TWIN = FORGED_TWINS[0]!;
const TWIN2 = FORGED_TWINS[1]!;
const SIGILS: [string, string] = ['riftstep', 'mend'];

function harness(opts?: MatchmakerOptions): {
  mm: Matchmaker;
  sent: Map<number, ServerMsg[]>;
  matches: MatchPick[][];
  sources: MatchSource[];
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
    opts,
  );
  return { mm, sent, matches, sources };
}

const last = (msgs: ServerMsg[] | undefined, t: string): ServerMsg | undefined =>
  msgs?.filter((m) => m.t === t).at(-1);

describe('forge queue matchmaking', () => {
  it('tags its selects forge; the classic queue stays untagged', () => {
    const forge = harness({ forge: true, resolveForged: () => TWIN });
    forge.mm.addToQueue(1, 'alice', 0);
    forge.mm.startNow(1, 0);
    expect(last(forge.sent.get(1), 'select_start')).toMatchObject({ forge: true });

    const classic = harness();
    classic.mm.addToQueue(1, 'alice', 0);
    classic.mm.startNow(1, 0);
    const msg = last(classic.sent.get(1), 'select_start');
    expect(msg?.t === 'select_start' && msg.forge).toBeUndefined();
  });

  it('a resolved forged pick locks and rides into the match picks', () => {
    const asked: [number, string][] = [];
    const { mm, matches } = harness({
      forge: true,
      resolveForged: (clientId, championId) => {
        asked.push([clientId, championId]);
        return championId === TWIN.id ? TWIN : null;
      },
    });
    mm.addToQueue(1, 'alice', 0);
    mm.addToQueue(2, 'bob', 0);
    mm.startNow(1, 0);
    mm.startNow(2, 0);
    mm.pick(1, TWIN.id, SIGILS);
    mm.pick(2, 'fenn', SIGILS);
    expect(asked).toEqual([[1, TWIN.id]]);
    expect(matches).toHaveLength(1);
    expect(matches[0]![0]).toMatchObject({ clientId: 1, championId: TWIN.id });
    expect(matches[0]![0]!.forged).toBe(TWIN);
    expect(matches[0]![1]!.forged).toBeUndefined();
  });

  it('a forged pick the resolver refuses falls back to the default champion', () => {
    const { mm, matches } = harness({ forge: true, resolveForged: () => null });
    mm.addToQueue(1, 'alice', 0);
    mm.startNow(1, 0);
    mm.pick(1, TWIN.id, SIGILS);
    expect(matches[0]![0]).toMatchObject({ championId: DEFAULT_CHAMPION_ID });
    expect(matches[0]![0]!.forged).toBeUndefined();
  });

  it('a forged champion taken by a teammate falls back to the roster', () => {
    const { mm, sent, matches } = harness({ forge: true, resolveForged: () => TWIN });
    mm.createLobby(1, 'host');
    const lobbyMsg = last(sent.get(1), 'lobby');
    const code = lobbyMsg?.t === 'lobby' ? lobbyMsg.code : '';
    mm.joinLobby(2, 'friend', code);
    mm.setLobbyTeam(2, 0);
    mm.startLobby(1, 0);
    mm.pick(1, TWIN.id, SIGILS);
    mm.pick(2, TWIN.id, SIGILS);
    expect(matches).toHaveLength(1);
    expect(matches[0]![0]).toMatchObject({ championId: TWIN.id });
    expect(matches[0]![0]!.forged).toBe(TWIN);
    // The duplicate keeps its team but not the champion, forged def dropped.
    expect(matches[0]![1]!.championId).not.toBe(TWIN.id);
    expect(matches[0]![1]!.forged).toBeUndefined();
  });

  it('the classic matchmaker never resolves a forged id', () => {
    const { mm, matches } = harness();
    mm.addToQueue(1, 'alice', 0);
    mm.startNow(1, 0);
    mm.pick(1, TWIN.id, SIGILS);
    expect(matches[0]![0]).toMatchObject({ championId: DEFAULT_CHAMPION_ID });
    expect(matches[0]![0]!.forged).toBeUndefined();
  });
});

describe('forge match construction', () => {
  it('collects unique forged defs, resolves them in the sim, and backfills bots from the roster', () => {
    const picks: MatchPick[] = [
      { clientId: 1, name: 'alice', team: 0, championId: TWIN.id, sigils: SIGILS, forged: TWIN },
      { clientId: 2, name: 'bob', team: 1, championId: TWIN.id, sigils: SIGILS, forged: TWIN },
      { clientId: 3, name: 'cara', team: 0, championId: TWIN2.id, sigils: SIGILS, forged: TWIN2 },
    ];
    const match = new Match(7, fillWithBots(picks));
    expect(match.forgedDefs.map((d) => d.id)).toEqual([TWIN.id, TWIN2.id]);
    // Ten seats: three humans on forged champions, seven roster bots.
    const champs = [...match.sim.units.values()].filter((u) => u.kind === 'champion');
    expect(champs).toHaveLength(10);
    const aliceUnit = match.players.get(1);
    expect(aliceUnit).toBeDefined();
    const unit = match.sim.units.get(aliceUnit!.unitId);
    expect(unit?.championId).toBe(TWIN.id);
    // The registry resolved the def: the unit carries a champion, not null.
    expect(unit?.champion?.name).toContain(TWIN.name);
    for (const p of match.replayPicks.filter((r) => r.bot)) {
      expect(p.championId.startsWith('forged_')).toBe(false);
    }
  });

  it('a roster-only match embeds nothing', () => {
    const picks: MatchPick[] = [
      { clientId: 1, name: 'alice', team: 0, championId: 'fenn', sigils: SIGILS },
    ];
    const match = new Match(7, fillWithBots(picks));
    expect(match.forgedDefs).toHaveLength(0);
  });
});

describe('the forge rating pair', () => {
  it('defaults, moves with games, and takes penalties without counting one', () => {
    const store = new ForgeStore(':memory:');
    try {
      expect(store.forgeRating(1)).toEqual({ rating: BASE_RATING, games: 0 });
      store.applyForgeRating(1, 12);
      expect(store.forgeRating(1)).toEqual({ rating: BASE_RATING + 12, games: 1 });
      store.applyForgeRating(1, -5);
      expect(store.forgeRating(1)).toEqual({ rating: BASE_RATING + 7, games: 2 });
      // A leaver penalty on a fresh account creates the row gameless.
      store.penalizeForgeRating(2, 15);
      expect(store.forgeRating(2)).toEqual({ rating: BASE_RATING - 15, games: 0 });
      store.applyForgeRating(2, 10);
      expect(store.forgeRating(2)).toEqual({ rating: BASE_RATING - 5, games: 1 });
    } finally {
      store.close();
    }
  });
});
