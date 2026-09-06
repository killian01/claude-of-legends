// Find the match worth filming, and save it as a replay.
//
// The clip is the whole of a launch post, and a MOBA will not hand you one
// on request: most of a match is walking. So this plays whole matches
// headless through the real Match code, scores every tick for how it would
// read to a stranger (scripts/clip_window.ts), and reports the best window
// in each. The winner is written to data/replays/ so the replay viewer can
// be pointed at it, on this machine or on any other: the sim is
// deterministic, so the same seed is the same fight everywhere.
//
// Run via scripts/clip_seed.mjs. Never in production.

import path from 'node:path';
import { fillWithBots } from '../server/bot_fill';
import { Match } from '../server/match';
import { saveJsonAtomic } from '../server/store';
import { REPLAY_VERSION } from '../src/net/replay';
import { DT } from '../src/sim/types';
import { bestWindow, type ClipTick, mixedCluster, type Spot, tickScore } from './clip_window';

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data');
const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : Number.NaN;
  return Number.isFinite(v) ? v : fallback;
};

const SEEDS = arg('seeds', 16);
const FROM = arg('from', 1);
const MINUTES = arg('minutes', 14);
const WINDOW_S = arg('window', 30);
const REPLAY_ID = arg('replay-id', 7);
// How close two champions count as being in the same fight. The camera
// covers appreciably more than this, so a cluster this size fills a frame.
const FIGHT_RADIUS = 13;

const MAX_TICKS = Math.round((MINUTES * 60) / DT);
const WINDOW_TICKS = Math.round(WINDOW_S / DT);

interface Scouted {
  seed: number;
  at: number;
  total: number;
  // Kills inside the chosen window, not in the whole match: the number
  // that says whether the window is a fight, and the one to distrust the
  // score by when it is zero.
  kills: number;
  deaths: number;
  ticks: number;
}

function play(seed: number): { match: Match; beats: ClipTick[]; deaths: number } {
  const match = new Match(seed, fillWithBots([], seed));
  const kinds = new Map<number, string>();
  const beats: ClipTick[] = [];
  let deaths = 0;
  for (let k = 0; k < MAX_TICKS; k++) {
    for (const u of match.sim.units.values()) kinds.set(u.id, u.kind);
    match.tick();

    let tickDeaths = 0;
    let towers = 0;
    let warden = 0;
    let casts = 0;
    let over = false;
    for (const ev of match.lastEvents) {
      if (ev.type === 'death') {
        const kind = kinds.get(ev.unitId);
        if (kind === 'champion') tickDeaths += 1;
        else if (kind === 'tower') towers += 1;
        else if (kind === 'warden') warden += 1;
      } else if (ev.type === 'cast') {
        if (kinds.get(ev.unitId) === 'champion') casts += 1;
      } else if (ev.type === 'victory') {
        over = true;
      }
    }
    deaths += tickDeaths;

    const spots: Spot[] = [];
    for (const u of match.sim.units.values()) {
      if (u.kind === 'champion' && u.hp > 0) {
        spots.push({ team: u.team, x: u.pos.x, z: u.pos.z });
      }
    }
    beats.push({
      deaths: tickDeaths,
      towers,
      warden,
      casts,
      clustered: mixedCluster(spots, FIGHT_RADIUS),
    });
    if (over) break;
  }
  return { match, beats, deaths };
}

const clock = (ticks: number): string => {
  const s = Math.round(ticks * DT);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const found: Scouted[] = [];
for (let i = 0; i < SEEDS; i++) {
  const seed = FROM + i;
  const started = Date.now();
  const { beats, deaths } = play(seed);
  const win = bestWindow(beats.map(tickScore), WINDOW_TICKS);
  const kills = beats
    .slice(win.start, win.start + WINDOW_TICKS)
    .reduce((n, b) => n + b.deaths + b.towers + b.warden, 0);
  found.push({ seed, at: win.start, total: win.total, kills, deaths, ticks: beats.length });
  console.log(
    `seed ${String(seed).padStart(4)}  best ${clock(win.start)}  score ${String(
      Math.round(win.total),
    ).padStart(5)}  in-window ${String(kills).padStart(2)}  match kills ${String(deaths).padStart(
      3,
    )}  ${clock(beats.length)} played  ${Date.now() - started}ms`,
  );
}

found.sort((a, b) => b.total - a.total);
const best = found[0];
if (!best) throw new Error('clip: no seed played');

console.log('\ntop five:');
for (const f of found.slice(0, 5)) {
  console.log(
    `  seed ${f.seed}  film from ${clock(f.at)}  score ${Math.round(f.total)}  ${f.kills} things die in shot`,
  );
}

// Replayed rather than kept from the scout, because a Match holding a full
// game of events per seed is the one thing here worth not doing sixteen
// times over.
const { match } = play(best.seed);
saveJsonAtomic(path.join(DATA_DIR, 'replays', `${REPLAY_ID}.json`), {
  version: REPLAY_VERSION,
  seed: match.seed,
  picks: match.replayPicks,
  events: match.replayEvents,
  ticks: match.sim.tickCount,
});
console.log(
  `\nsaved replay ${REPLAY_ID} from seed ${best.seed}: ${match.replayEvents.length} events, ${clock(
    match.sim.tickCount,
  )} of match.`,
);
console.log(
  `Film from ${clock(best.at)}. REPLAY_ID=${REPLAY_ID} REPLAY_AT=${Math.round(best.at * DT)}`,
);
