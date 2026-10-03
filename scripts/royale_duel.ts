// Every pairing of champions on the Wanderseed, one against one (the
// planet balance's gate, src/sim/content/royale_tuning.ts): two house bots
// of the same skill set 8 m apart in the open, every cache near them
// taken away, fighting until the first death or a time cap. Each pairing
// plays every seed once, the sides swapped on every other seed. Two
// stages: at landing (level 3, nothing in the bag) and after the calm
// (the median level and the median count of loot pieces a seat of a
// fifty-bot Respawn match holds when the calm ends, measured first, each
// duelist given its own seat build's pieces). Prints the matrix, every
// champion's win rate, the time to kill (first hit between the two to the
// death) and the gate: every champion 35 to 65 percent, every pairing 25
// to 75 percent, the post-calm median time to kill at least 4 s. Bundled
// and run by scripts/royale_duel.mjs:
//   node scripts/royale_duel.mjs [--seeds 10] [--from 1]
//     [--variant respawn|one_life] [--skill normal|gentle|strong]
//     [--stage both|landing|post-calm] [--only fenn]

import { readFileSync } from 'node:fs';
import { buildRoyaleSim, type ReplayPick, type RoyalePlanet } from '../src/net/replay';
import { royalePolicy } from '../src/sim/content/bots/royale';
import type { RoyaleSkillId } from '../src/sim/content/bots/royale_skills';
import { CHAMPION_LIST } from '../src/sim/content/champions';
import { assemblePlanet } from '../src/sim/content/planet';
import { dist, heading, type Vec3 } from '../src/sim/geo';
import { SphereGround } from '../src/sim/ground';
import { royaleHouseChampions } from '../src/sim/royale/fill';
import { along } from '../src/sim/royale/layout';
import { grantXp } from '../src/sim/royale/levels';
import { grantPieces } from '../src/sim/royale/loot';
import { CALM_S, DROP_S, type RoyaleVariant } from '../src/sim/royale/types';
import { decodeSphereNav, findSpherePath, SphereNavGrid } from '../src/sim/sphere_nav';
import { xpForNext } from '../src/sim/stats';
import type { Unit } from '../src/sim/unit';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};
const seeds = Number(opt('--seeds', '10'));
const firstSeed = Number(opt('--from', '1'));
const variant = opt('--variant', 'respawn') as RoyaleVariant;
const skill = opt('--skill', 'normal') as RoyaleSkillId;
const stageArg = opt('--stage', 'both');
const only = opt('--only', '');

// The cap on one duel: past it the duel has no result.
const CAP_S = 120;
// Half the distance the two start apart, meters.
const HALF_GAP_M = 4;
// Caches this close to the duel are taken away, so it stays a duel.
const CLEAR_M = 40;
// The gate (final_spec planet-balance).
const CHAMPION_RATE = [0.35, 0.65] as const;
const PAIRING_RATE = [0.25, 0.75] as const;
const MIN_KILL_S = 4;

function loadPlanet(dir = 'public/map/planet/'): RoyalePlanet {
  const planet = assemblePlanet(JSON.parse(readFileSync(`${dir}layout.json`, 'utf8')));
  const bin = readFileSync(`${dir}navigation.bin`);
  const buffer = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer;
  const data = decodeSphereNav(planet.nav, buffer);
  return {
    layout: planet,
    ground: () => new SphereGround(new SphereNavGrid(data), findSpherePath),
  };
}

interface Stage {
  name: 'landing' | 'post-calm';
  level: number;
  pieces: number;
}

const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

// What a seat holds when the calm ends: the median level and the median
// count of loot pieces over the fifty seats of a house-bot match.
function postCalm(planet: RoyalePlanet): Stage {
  const champions = royaleHouseChampions(firstSeed, 50);
  const picks: ReplayPick[] = champions.map((championId, i) => ({
    name: `house${i}`,
    team: i,
    championId,
    sigils: ['riftstep', 'mend'],
    bot: 'royale',
  }));
  const { sim, unitIds } = buildRoyaleSim(planet, firstSeed, picks, variant);
  const pieces = new Map<number, number>(unitIds.map((id) => [id, 0]));
  while (sim.time < DROP_S + CALM_S) {
    for (const e of sim.tick()) {
      if (e.type === 'royale_loot') pieces.set(e.unitId, (pieces.get(e.unitId) ?? 0) + 1);
    }
  }
  const levels = unitIds.map((id) => sim.units.get(id)!.level);
  return { name: 'post-calm', level: median(levels), pieces: median([...pieces.values()]) };
}

function raise(u: Unit, level: number): void {
  for (let n = 0; n < 30 && u.level < level; n++) grantXp(u, xpForNext(u.level) - u.xp);
}

interface Result {
  // 0 or 1: which side won; -1 no result in the cap; -2 never placed.
  winner: number;
  // Seconds from the first hit between the two to the death.
  t: number;
}

function duel(planet: RoyalePlanet, a: string, b: string, seed: number, stage: Stage): Result {
  const picks: ReplayPick[] = [a, b].map((championId, i) => ({
    name: `d${i}`,
    team: i,
    championId,
    sigils: ['riftstep', 'mend'],
    bot: 'royale',
  }));
  const { sim, unitIds } = buildRoyaleSim(planet, seed, picks, variant);
  const m = sim.royaleMode!;
  for (const id of unitIds) {
    m.skills.set(id, skill);
    sim.attachPolicy(id, royalePolicy(m.layout, skill));
  }
  while (sim.time < DROP_S + 0.05) sim.tick();
  const ua = sim.units.get(unitIds[0]!)!;
  const ub = sim.units.get(unitIds[1]!)!;
  for (const u of [ua, ub]) {
    raise(u, stage.level);
    grantPieces(u, m.builds.get(u.id)!, stage.pieces);
    u.hp = u.maxHp;
    u.mana = u.maxMana;
  }
  const regions = m.layout.regions.filter((r) => r.id !== 'sanctuary');
  let center: Vec3 | null = null;
  for (let tries = 0; tries < 40 && center === null; tries++) {
    const heart = regions[(seed + tries) % regions.length]!.heart;
    const dir = heading(heart, ((seed + tries * 13) * 0.7) % 6.28) as Vec3;
    const c = m.ground.nearestWalkable(
      along(heart, heading(heart, tries * 1.3) as Vec3, tries * 3, m.layout.radius),
    );
    if (!c) continue;
    const back = { x: -dir.x, y: -(dir.y ?? 0), z: -dir.z };
    const pa = m.ground.nearestWalkable(along(c, dir, HALF_GAP_M, m.layout.radius));
    const pb = m.ground.nearestWalkable(along(c, back, HALF_GAP_M, m.layout.radius));
    if (!pa || !pb) continue;
    ua.pos = { ...pa };
    ub.pos = { ...pb };
    ua.path = [];
    ub.path = [];
    sim.tick();
    if (
      dist(ua.pos, ub.pos) < 10 &&
      sim.isVisible(ua.team, ub.id) &&
      sim.isVisible(ub.team, ua.id)
    ) {
      center = c;
    }
  }
  if (center === null) return { winner: -2, t: 0 };
  for (const c of m.state.caches) if (dist(c.pos, center) < CLEAR_M) c.present = false;
  const start = sim.time;
  let firstHit: number | null = null;
  const pair = new Set([ua.id, ub.id]);
  while (sim.time - start < CAP_S) {
    for (const e of sim.tick()) {
      if (
        e.type === 'damage' &&
        firstHit === null &&
        pair.has(e.sourceId) &&
        pair.has(e.targetId)
      ) {
        firstHit = sim.time;
      }
      if (e.type === 'death' && pair.has(e.unitId)) {
        return { winner: e.unitId === ua.id ? 1 : 0, t: sim.time - (firstHit ?? start) };
      }
    }
  }
  return { winner: -1, t: CAP_S };
}

const pct = (x: number) => `${Math.round(100 * x)}%`;

function runStage(planet: RoyalePlanet, stage: Stage): void {
  const champs = CHAMPION_LIST.map((c) => c.id).sort();
  const wins = new Map<string, number>();
  const games = new Map<string, number>();
  const rows: string[] = [];
  const offPairs: string[] = [];
  const times: number[] = [];
  let none = 0;
  let unplaced = 0;
  for (let i = 0; i < champs.length; i++) {
    for (let j = i + 1; j < champs.length; j++) {
      const ci = champs[i]!;
      const cj = champs[j]!;
      if (only && ci !== only && cj !== only) continue;
      let wi = 0;
      let wj = 0;
      for (let k = 0; k < seeds; k++) {
        const seed = firstSeed + k;
        const flip = k % 2 === 1;
        const r = flip ? duel(planet, cj, ci, seed, stage) : duel(planet, ci, cj, seed, stage);
        if (r.winner === -2) {
          unplaced++;
          continue;
        }
        if (r.winner === -1) {
          none++;
          continue;
        }
        times.push(r.t);
        const iWon = flip ? r.winner === 1 : r.winner === 0;
        if (iWon) wi++;
        else wj++;
      }
      wins.set(ci, (wins.get(ci) ?? 0) + wi);
      wins.set(cj, (wins.get(cj) ?? 0) + wj);
      games.set(ci, (games.get(ci) ?? 0) + wi + wj);
      games.set(cj, (games.get(cj) ?? 0) + wi + wj);
      rows.push(`${ci} ${wi}-${wj} ${cj}`);
      const n = wi + wj;
      if (n > 0 && (wi / n < PAIRING_RATE[0] || wi / n > PAIRING_RATE[1])) {
        offPairs.push(`${ci} ${wi}-${wj} ${cj}`);
      }
    }
  }
  const rate = (c: string) => (wins.get(c) ?? 0) / Math.max(1, games.get(c) ?? 0);
  const ranked = champs.filter((c) => games.has(c)).sort((p, q) => rate(q) - rate(p));
  const offChamps = ranked.filter((c) => rate(c) < CHAMPION_RATE[0] || rate(c) > CHAMPION_RATE[1]);
  const killMedian = median(times);
  console.log(
    `\n${variant} ${stage.name} (level ${stage.level}, ${stage.pieces} pieces), ${skill} against ${skill}, seeds ${firstSeed} to ${firstSeed + seeds - 1}`,
  );
  console.log(`  ${rows.join('; ')}`);
  console.log(`  win rate: ${ranked.map((c) => `${c} ${pct(rate(c))}`).join(', ')}`);
  console.log(
    `  time to kill: median ${killMedian.toFixed(1)} s over ${times.length} duels; no result ${none}, never placed ${unplaced}`,
  );
  console.log(
    `  gate: champions ${offChamps.length === 0 ? 'hold' : `off ${offChamps.map((c) => `${c} ${pct(rate(c))}`).join(', ')}`}` +
      `; pairings ${offPairs.length === 0 ? 'hold' : `${offPairs.length} off (${offPairs.join('; ')})`}` +
      (stage.name === 'post-calm'
        ? `; time to kill ${killMedian >= MIN_KILL_S ? 'holds' : 'off'} (${killMedian.toFixed(1)} s, at least ${MIN_KILL_S})`
        : ''),
  );
}

const planet = loadPlanet();
const stages: Stage[] = [];
if (stageArg === 'both' || stageArg === 'landing') {
  stages.push({ name: 'landing', level: 3, pieces: 0 });
}
if (stageArg === 'both' || stageArg === 'post-calm') stages.push(postCalm(planet));
for (const stage of stages) runStage(planet, stage);
