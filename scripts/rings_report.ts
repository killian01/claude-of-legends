// What the rings do in house bot matches (docs/plan-rings.md, phase 5):
// runs full matches on the shipped export, the fill on both sides, and
// prints per match how long it ran, which creatures fell to whom and
// when, the favors each side held at the end, the Wardens, the Ascendants
// (when the first rose, who took the Wrath), the winner; then the totals. The measurement behind the timings, rerun after a
// tuning. Bundled and run by scripts/rings_report.mjs:
//   node scripts/rings_report.mjs [--seeds 6] [--from 1] [--max-min 25]

import { starOrchard } from '../server/star_orchard';
import { attachBot } from '../src/sim/content/bots';
import { houseSeats } from '../src/sim/content/bots/house';
import { ASPECT_IDS, type AspectId, CREATURES } from '../src/sim/content/rings';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { TerrainNavGrid } from '../src/sim/terrain_nav';
import { TICK_RATE } from '../src/sim/types';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};
const seeds = Number(opt('--seeds', '6'));
const firstSeed = Number(opt('--from', '1'));
const maxTicks = Number(opt('--max-min', '25')) * 60 * TICK_RATE;

interface Fall {
  at: number;
  creature: string;
  aspect: AspectId;
  team: number;
}

function clock(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function play(seed: number) {
  const orchard = starOrchard();
  const sim = new Sim(seed, {
    map: orchard.map,
    nav: new TerrainNavGrid(orchard.navigation),
    strictNavigation: true,
  });
  const rng = new Rng(seed);
  for (const team of [0, 1] as const) {
    for (const seat of houseSeats([], rng)) {
      attachBot(sim, sim.addChampion(team, undefined, seat.championId).id, seat.bot);
    }
  }
  const falls: Fall[] = [];
  const wardens: { at: number; team: number }[] = [];
  const wraths: { at: number; creature: string; team: number }[] = [];
  let ascendantAt: number | null = null;
  const started = Date.now();
  let ticks = 0;
  for (; ticks < maxTicks && sim.winner === null; ticks++) {
    for (const e of sim.tick()) {
      if (e.type === 'favor') {
        falls.push({ at: sim.time, creature: e.creature ?? '?', aspect: e.aspect, team: e.team });
      } else if (e.type === 'wrath') {
        wraths.push({ at: sim.time, creature: e.creature, team: e.team });
      } else if (e.type === 'death') {
        const victim = sim.units.get(e.unitId);
        const killer = sim.units.get(e.killerId);
        if (victim?.kind === 'warden' && killer?.kind === 'champion') {
          wardens.push({ at: sim.time, team: killer.team });
        }
      }
    }
    if (ascendantAt === null && sim.ringClocks().some((c) => c.ascendant && c.unitId !== null)) {
      ascendantAt = sim.time;
    }
  }
  return {
    seed,
    minutes: sim.time / 60,
    winner: sim.winner,
    falls,
    wardens,
    wraths,
    ascendantAt,
    favors: [sim.teamFavors(0), sim.teamFavors(1)],
    wallMs: Date.now() - started,
  };
}

const runs = [];
for (let seed = firstSeed; seed < firstSeed + seeds; seed++) {
  const r = play(seed);
  runs.push(r);
  const fallsText = r.falls
    .map(
      (f) =>
        `${clock(f.at)} ${CREATURES[f.creature as keyof typeof CREATURES]?.name ?? f.creature}(${f.aspect}) t${f.team}`,
    )
    .join(', ');
  const wardensText = r.wardens.map((w) => `${clock(w.at)} t${w.team}`).join(', ');
  const wrathsText = r.wraths
    .map(
      (w) =>
        `${clock(w.at)} ${CREATURES[w.creature as keyof typeof CREATURES]?.ascendant.name ?? w.creature} t${w.team}`,
    )
    .join(', ');
  const ascendantText =
    r.ascendantAt === null ? 'no Ascendant' : `first Ascendant at ${clock(r.ascendantAt)}`;
  console.log(
    `seed ${seed}: ${r.minutes.toFixed(1)} min, winner ${r.winner ?? 'none'}, ` +
      `${r.falls.length} creatures [${fallsText}], ${r.wardens.length} wardens [${wardensText}], ` +
      `${ascendantText}, ${r.wraths.length} wraths [${wrathsText}], ${(r.wallMs / 1000).toFixed(0)} s`,
  );
}

const total = runs.reduce((n, r) => n + r.falls.length, 0);
const first = runs.map((r) => r.falls[0]?.at ?? Number.NaN).filter((t) => !Number.isNaN(t));
const byAspect: Record<AspectId, number> = {
  might: 0,
  tide: 0,
  tempo: 0,
  bulwark: 0,
  swiftness: 0,
  resolve: 0,
};
for (const r of runs) for (const f of r.falls) byAspect[f.aspect] += 1;
const favorWinner = runs
  .filter((r) => r.winner !== null)
  .map((r) => {
    const held = (team: 0 | 1): number => ASPECT_IDS.reduce((n, a) => n + r.favors[team]![a], 0);
    return held(r.winner as 0 | 1) > held((1 - (r.winner as number)) as 0 | 1);
  });
console.log(
  `\n${runs.length} matches, median ${clock(
    [...runs].map((r) => r.minutes * 60).sort((a, b) => a - b)[Math.floor(runs.length / 2)] ?? 0,
  )}: ${(total / runs.length).toFixed(1)} creatures a match, first at ${
    first.length > 0 ? clock(first.reduce((a, b) => a + b, 0) / first.length) : 'never'
  } on average, ${(runs.reduce((n, r) => n + r.wardens.length, 0) / runs.length).toFixed(1)} Wardens a match, ` +
    `an Ascendant rose in ${runs.filter((r) => r.ascendantAt !== null).length}, ` +
    `${runs.reduce((n, r) => n + r.wraths.length, 0)} Wraths claimed`,
);
console.log(
  `aspects taken: ${ASPECT_IDS.map((a) => `${a} ${byAspect[a]}`).join(', ')}; ` +
    `the side holding more favors won ${favorWinner.filter(Boolean).length} of ${favorWinner.length} decided matches`,
);
