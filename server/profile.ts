// Career stats derived from the match log at request time: at our scale
// a linear pass beats any precomputed aggregate that could drift. Pure,
// so the numbers the profile screen shows are pinned by tests. The career
// is the account's own play, the seats it held by hand (server/ways.ts):
// its bots' matches, live or in the Arena, belong to each bot's Record
// and page, and to the bot ladders.

import { masteryRank, masteryTitle } from './mastery';
import type { MatchRecord } from './records';
import { playedByHand, seatWay } from './ways';

export interface ChampionLine {
  championId: string;
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  // Cosmetic mastery (CONTEXT.md), stamped from games at build time.
  mastery: number;
  masteryTitle: string;
}

export interface RecentMatch {
  at: number;
  durationS: number;
  win: boolean;
  championId: string;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  // Signed Elo movement when the match was rated.
  ratingDelta?: number;
  // Saved replay id, when the server kept one.
  replayId?: number;
}

export interface ProfileStats {
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  perChampion: ChampionLine[];
  // Newest first, capped.
  recent: RecentMatch[];
}

export const RECENT_CAP = 10;

export function buildProfile(records: readonly MatchRecord[], accountId: number): ProfileStats {
  const out: ProfileStats = {
    games: 0,
    wins: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    perChampion: [],
    recent: [],
  };
  const perChamp = new Map<string, ChampionLine>();
  for (const rec of records) {
    const me = rec.players.find((p) => p.accountId === accountId);
    if (!me || !playedByHand(seatWay(rec, me))) continue;
    const win = me.team === rec.winner;
    out.games++;
    if (win) out.wins++;
    out.kills += me.kills;
    out.deaths += me.deaths;
    out.assists += me.assists;
    let line = perChamp.get(me.championId);
    if (!line) {
      line = {
        championId: me.championId,
        games: 0,
        wins: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        cs: 0,
        mastery: 0,
        masteryTitle: masteryTitle(0),
      };
      perChamp.set(me.championId, line);
    }
    line.games++;
    if (win) line.wins++;
    line.kills += me.kills;
    line.deaths += me.deaths;
    line.assists += me.assists;
    line.cs += me.cs;
    out.recent.push({
      at: rec.at,
      durationS: rec.durationS,
      win,
      championId: me.championId,
      kills: me.kills,
      deaths: me.deaths,
      assists: me.assists,
      cs: me.cs,
      ...(me.ratingDelta !== undefined ? { ratingDelta: me.ratingDelta } : {}),
      ...(rec.replayId !== undefined ? { replayId: rec.replayId } : {}),
    });
  }
  for (const line of perChamp.values()) {
    line.mastery = masteryRank(line.games);
    line.masteryTitle = masteryTitle(line.mastery);
  }
  out.perChampion = [...perChamp.values()].sort((a, b) => b.games - a.games);
  out.recent.sort((a, b) => b.at - a.at);
  out.recent = out.recent.slice(0, RECENT_CAP);
  return out;
}
