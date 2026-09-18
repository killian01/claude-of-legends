// What a practice match tells the server at its end (PRIVACY.md): the
// scoreboard, the result, the minutes, on what kind of device, whether an
// account was signed in. Nothing that names anybody. A practice match is
// played against house bots in the browser and the server never sees it
// run; this is the one thing it learns of it, so the maintainer can tell
// whether the bots are the right strength for the people who meet them
// first. Built pure over the world's scoreboard, sent once at the same
// moment the counter hears the match's end (src/net/stats.ts).

import type { ScoreRow, TeamId } from '../sim/types';

export const PRACTICE_REPORT_ROUTE = '/api/practice/report';
export const PRACTICE_REPORT_VERSION = 1;

export type PracticeResult = 'won' | 'lost' | 'left';

export interface PracticeRow {
  championId: string;
  team: TeamId;
  // The seat the person played; every other row is a house bot.
  self: boolean;
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  items: readonly string[];
}

export interface PracticeReport {
  v: number;
  result: PracticeResult;
  seconds: number;
  // A Forge test drive rather than a roster champion.
  forged: boolean;
  // Played by touch (a phone or a tablet) rather than a mouse.
  touch: boolean;
  signedIn: boolean;
  rows: PracticeRow[];
}

export interface PracticeReportInput {
  rows: readonly ScoreRow[];
  selfId: number;
  selfTeam: TeamId;
  // The world's winner as the world types it: a team's number, or none yet.
  winner: number | null;
  seconds: number;
  forged: boolean;
  touch: boolean;
  signedIn: boolean;
}

export function practiceResult(winner: number | null, selfTeam: TeamId): PracticeResult {
  if (winner === null) return 'left';
  return winner === selfTeam ? 'won' : 'lost';
}

export function buildPracticeReport(input: PracticeReportInput): PracticeReport {
  return {
    v: PRACTICE_REPORT_VERSION,
    result: practiceResult(input.winner, input.selfTeam),
    seconds: Math.max(0, Math.round(input.seconds)),
    forged: input.forged,
    touch: input.touch,
    signedIn: input.signedIn,
    rows: input.rows.map((r) => ({
      championId: r.championId,
      team: r.team,
      self: r.unitId === input.selfId,
      level: r.level,
      kills: r.kills,
      deaths: r.deaths,
      assists: r.assists,
      cs: r.cs,
      items: [...r.items],
    })),
  };
}

// Fire and forget, with keepalive so a report sent as the page goes away
// still leaves with it. The server's answer changes nothing here.
export function sendPracticeReport(
  report: PracticeReport,
  post: typeof fetch = (input, init) => fetch(input, init),
): void {
  try {
    void post(PRACTICE_REPORT_ROUTE, {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
    }).catch(() => undefined);
  } catch {
    // No fetch, no report; the match was still played.
  }
}
