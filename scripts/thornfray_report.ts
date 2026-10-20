// What a Thornfray of house bots looks like (ADR 0035, docs/plan-thornfray.md
// slice 8): plays whole matches headless on the shipped Wanderseed, each
// built the way the server builds one nobody joined (server/thornfray_match.ts
// dealThornfray and nextBoutBuild over the ledger, every bout through
// server/royale_build.ts royaleFactory, so through buildBoutSim), eight
// seats, six bouts, and prints per kind and over the matches:
// - each bout's length from its landing, and whether its rule (One life's
//   last one standing) or its clock ended it, and its first fall;
// - the spread of places (the mean place and the wins of each bot skill)
//   and of bushels (the totals by final place, the winner's margin);
// - how often the leader before the Final wins the match, and how often a
//   bout's winner wins the next one (the prize Graft's weight), under each
//   PRIZE_LASTS the matches were played with;
// - of the seconds a bot had an enemy in its sight within ENGAGE_M, the
//   share it spent fighting (it dealt a champion damage in the last
//   ENGAGED_S), royale_report.ts's yardstick, with the same share in a
//   battle royale of fifty house bots beside it (the planet's figure);
// - the takedowns, the falls to the Dusk, and the caches gleaned per seat
//   and per region (the Seedfall caches apart); the counts the kind keeps;
// - what the bots decided (the brain's labels, through decide's trace);
// - the stand-in's bushels and places; the cost of a tick.
//
//   node scripts/thornfray_report.mjs [--seeds 6] [--from 1] [--bout <id>]
//     [--prize next|all] [--standin] [--planet 1] [--dump out.json]
//     [--merge a.json,b.json] [--quiet]
//
// --bout <id> plays every bout of every match on that kind alone (a kind
// in progress, unreleased, included); without it the matches draw from the
// released pool. --prize sets how long the prize Graft lasts (the open
// question, docs/design/thornfray.md): the next bout only, or the rest of
// the match; the shipped PRIZE_LASTS by default. --standin seats seat 0
// with no bot and no person behind it: a seat that gives no order, landed
// where the drop puts a seat with no pick. --planet N plays N battle
// royales of each death rule the kinds use (seeds --from on) for the
// planet's fighting share; 0 skips them. --dump writes what was played,
// and --merge prints the summary of dumps written before (a run split over
// several processes, each its own --from and --seeds, or one per --prize).
// Bundled and run by scripts/thornfray_report.mjs; what it plays and the
// figures it prints are scripts/thornfray_measure.ts.

import { readFileSync, writeFileSync } from 'node:fs';
import { planet } from '../server/planet';
import { royaleFactory } from '../server/royale_build';
import {
  boutLine,
  type Dump,
  formatSummary,
  type MatchRow,
  matchLine,
  mergeDumps,
  type PlanetRow,
  type PlayOptions,
  planetLine,
  playPlanet,
  playThornfray,
  poolOf,
  readArgs,
} from './thornfray_measure';

function main(): void {
  const args = readArgs(process.argv.slice(2));
  if (args.merge.length > 0) {
    const dumps = args.merge.map((f) => JSON.parse(readFileSync(f, 'utf8')) as Dump);
    console.log(formatSummary(mergeDumps(dumps)));
    return;
  }
  const pool = poolOf(args.bout);
  const factory = royaleFactory(planet);
  const opts: PlayOptions = { prize: args.prize, standin: args.standin ? 0 : null };
  const matches: MatchRow[] = [];
  for (let seed = args.from; seed < args.from + args.seeds; seed++) {
    const m = playThornfray(seed, pool, factory, opts, (row) => {
      if (!args.quiet) console.log(boutLine(row));
    });
    matches.push(m);
    console.log(matchLine(m));
  }
  const planetRows: PlanetRow[] = [];
  const variants = [...new Set(pool.map((k) => k.base))];
  for (const variant of variants) {
    for (let seed = args.from; seed < args.from + args.planet; seed++) {
      const p = playPlanet(factory, variant, seed);
      planetRows.push(p);
      console.log(planetLine(p));
    }
  }
  const dump: Dump = { matches, planet: planetRows };
  if (args.dump !== '') writeFileSync(args.dump, JSON.stringify(dump));
  console.log(`\n${formatSummary(dump)}`);
}

main();
