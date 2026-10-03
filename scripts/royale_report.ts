// What a battle royale of fifty house bots looks like on the Wanderseed
// (ADR 0031, docs/plan-royale.md): plays N seeds of each variant headless
// on the shipped planet and prints, per match, its length, the first
// takedown, the takedowns minute by minute, the winner (champion, skill,
// kills, level), the top five killers, the deaths to the Dusk, the pads
// used, the caches opened minute by minute, the camps taken, the final
// levels, the fights between the bot skills, how long each skill lasted in
// One life, and the tick's cost; then one line per match to compare a
// tuning against. With --passive N, N seats of every One life match are a
// passive stand-in instead (it only walks to caches, keeps to the light,
// and backs off when hit: a newcomer who never fights back), and the
// report says how long they lasted. Bundled and run by
// scripts/royale_report.mjs:
//   node scripts/royale_report.mjs [--seeds 4] [--from 1]
//     [--variant both|respawn|one_life] [--passive 0] [--quiet]

import { readFileSync } from 'node:fs';
import { buildRoyaleSim, type ReplayPick, type RoyalePlanet } from '../src/net/replay';
import { ROYALE_SKILLS, type RoyaleSkillId } from '../src/sim/content/bots/royale_skills';
import { assemblePlanet } from '../src/sim/content/planet';
import { dist } from '../src/sim/geo';
import { SphereGround } from '../src/sim/ground';
import type { Action, Observation } from '../src/sim/policy';
import type { Rng } from '../src/sim/rng';
import { pickDropPoint } from '../src/sim/royale/bot/drop_pick';
import { awayPoint, escapeCast } from '../src/sim/royale/bot/fight';
import { buildSense, p3 } from '../src/sim/royale/bot/sense';
import {
  beatDusk,
  leaveDark,
  lootCache,
  moveTo,
  pickCache,
  roam,
} from '../src/sim/royale/bot/travel';
import { royaleHouseChampions } from '../src/sim/royale/fill';
import type { RoyaleLayout } from '../src/sim/royale/layout';
import { DROP_S, PLAY_S, type RoyaleVariant } from '../src/sim/royale/types';
import { decodeSphereNav, findSpherePath, SphereNavGrid } from '../src/sim/sphere_nav';
import { TICK_RATE } from '../src/sim/types';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};
const seeds = Number(opt('--seeds', '4'));
const firstSeed = Number(opt('--from', '1'));
const variantArg = opt('--variant', 'both');
const passiveSeats = Number(opt('--passive', '0'));
const quiet = args.includes('--quiet');
const variants: RoyaleVariant[] =
  variantArg === 'respawn' || variantArg === 'one_life' ? [variantArg] : ['respawn', 'one_life'];

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

// The passive stand-in: lands where a bot would, keeps to the light, walks
// to the nearest cache and opens it, and backs off from anyone who hits
// it; it never attacks.
function passivePolicy(layout: RoyaleLayout) {
  const skill = ROYALE_SKILLS.gentle;
  return (obs: Observation, rng: Rng): Action => {
    const r = obs.royale;
    if (!r) return { kind: 'noop' };
    if (r.stage === 'drop') {
      if (r.drop) return { kind: 'noop' };
      const p = pickDropPoint(layout, rng);
      return { kind: 'drop', x: p.x, y: p.y, z: p.z };
    }
    if (r.stage !== 'play' || obs.self.dead || r.flying) return { kind: 'noop' };
    const sense = buildSense(obs, r, layout, skill);
    const dark = sense.now.radius <= 0 ? null : leaveDark(sense);
    if (dark) return dark;
    if (sense.struck && sense.enemies.length > 0) {
      return escapeCast(sense) ?? moveTo(sense, awayPoint(sense, 8));
    }
    const close = sense.enemies.find((e) => dist(sense.me, p3(e)) < 6);
    if (close) return moveTo(sense, awayPoint(sense, 8));
    if (r.opening) return sense.s.dest ? { kind: 'stop' } : { kind: 'noop' };
    const ahead = beatDusk(sense);
    if (ahead) return ahead;
    const c = pickCache(sense);
    if (c) return lootCache(sense, c);
    return roam(sense);
  };
}

interface Seat {
  id: number;
  championId: string;
  skill: RoyaleSkillId | 'passive';
}

interface Match {
  variant: RoyaleVariant;
  seed: number;
  duration: number;
  firstTakedown: number | null;
  takedownsByMin: number[];
  cachesByMin: number[];
  takedowns: number;
  winner: { championId: string; skill: string; kills: number; level: number } | null;
  top: { championId: string; skill: string; kills: number; deaths: number; level: number }[];
  duskDeaths: number;
  pads: number;
  camps: number;
  levels: number[];
  // Every seat's champion, skill and takedowns.
  seats: { championId: string; skill: string; kills: number; deaths: number }[];
  // Takedowns between skills: killer skill -> victim skill -> count.
  duels: Record<string, Record<string, number>>;
  // One life: seconds from landing each seat fell (the end for the last).
  lastedBySkill: Record<string, number[]>;
  tickAvgMs: number;
  tickMaxMs: number;
}

function clock(seconds: number | null): string {
  if (seconds === null) return '-';
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function play(planet: RoyalePlanet, variant: RoyaleVariant, seed: number, passive: number): Match {
  const champions = royaleHouseChampions(seed, 50);
  const passiveAt = new Set<number>();
  for (let k = 0; k < passive; k++) passiveAt.add(Math.floor((k * 50) / passive));
  const picks: ReplayPick[] = champions.map((championId, i) => ({
    name: `house${i}`,
    team: i,
    championId,
    sigils: ['riftstep', 'mend'],
    ...(passiveAt.has(i) ? {} : { bot: 'royale' }),
  }));
  const { sim, unitIds } = buildRoyaleSim(planet, seed, picks, variant);
  const mode = sim.royaleMode!;
  const seats = new Map<number, Seat>();
  unitIds.forEach((id, i) => {
    const skill = passiveAt.has(i) ? 'passive' : mode.skillOf(id);
    seats.set(id, { id, championId: champions[i]!, skill });
    if (passiveAt.has(i)) sim.attachPolicy(id, passivePolicy(mode.layout));
  });
  const landAt = DROP_S;
  const cap = Math.round((DROP_S + PLAY_S + 90) * TICK_RATE);
  const takedownsByMin: number[] = [];
  const cachesByMin: number[] = [];
  const duels: Record<string, Record<string, number>> = {};
  const fellAt = new Map<number, number>();
  const bump = (arr: number[], i: number) => {
    while (arr.length <= i) arr.push(0);
    arr[i]! += 1;
  };
  let tickMs = 0;
  let tickMax = 0;
  let playTicks = 0;
  let ticks = 0;
  while (mode.state.stage !== 'over' && ticks < cap) {
    const t0 = performance.now();
    const events = sim.tick();
    const ms = performance.now() - t0;
    ticks++;
    if (mode.state.stage !== 'drop') {
      tickMs += ms;
      playTicks++;
      if (ms > tickMax) tickMax = ms;
    }
    const minute = Math.max(0, Math.floor((sim.time - landAt) / 60));
    for (const e of events) {
      if (e.type === 'royale_cache') bump(cachesByMin, minute);
      if (e.type !== 'death') continue;
      const victim = seats.get(e.unitId);
      if (!victim) continue;
      if (variant === 'one_life' && !fellAt.has(e.unitId)) fellAt.set(e.unitId, sim.time - landAt);
      const killer = seats.get(e.killerId);
      if (!killer || killer.id === victim.id) continue;
      bump(takedownsByMin, minute);
      duels[killer.skill] ??= {};
      duels[killer.skill]![victim.skill] = (duels[killer.skill]![victim.skill] ?? 0) + 1;
    }
  }
  const end = sim.time - landAt;
  const champs = [...sim.units.values()].filter((u) => u.kind === 'champion');
  const ranked = [...champs].sort(
    (a, b) => b.kills - a.kills || a.deaths - b.deaths || a.id - b.id,
  );
  const winnerUnit = mode.state.winnerId !== null ? sim.units.get(mode.state.winnerId) : undefined;
  const lastedBySkill: Record<string, number[]> = {};
  if (variant === 'one_life') {
    for (const s of seats.values()) {
      lastedBySkill[s.skill] ??= [];
      lastedBySkill[s.skill]!.push(fellAt.get(s.id) ?? end);
    }
  }
  return {
    variant,
    seed,
    duration: end,
    firstTakedown: mode.tally.firstTakedownAt === null ? null : mode.tally.firstTakedownAt - landAt,
    takedownsByMin,
    cachesByMin,
    takedowns: mode.tally.takedowns,
    winner: winnerUnit
      ? {
          championId: winnerUnit.championId ?? '?',
          skill: seats.get(winnerUnit.id)?.skill ?? '?',
          kills: winnerUnit.kills,
          level: winnerUnit.level,
        }
      : null,
    top: ranked.slice(0, 5).map((u) => ({
      championId: u.championId ?? '?',
      skill: seats.get(u.id)?.skill ?? '?',
      kills: u.kills,
      deaths: u.deaths,
      level: u.level,
    })),
    duskDeaths: mode.tally.duskDeaths,
    pads: mode.tally.padsUsed,
    camps: mode.tally.campsTaken,
    levels: champs.map((u) => u.level).sort((a, b) => a - b),
    seats: champs.map((u) => ({
      championId: u.championId ?? '?',
      skill: seats.get(u.id)?.skill ?? '?',
      kills: u.kills,
      deaths: u.deaths,
    })),
    duels,
    lastedBySkill,
    tickAvgMs: playTicks > 0 ? tickMs / playTicks : 0,
    tickMaxMs: tickMax,
  };
}

function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function histogram(levels: readonly number[]): string {
  const counts = new Map<number, number>();
  for (const l of levels) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([l, n]) => `${l}:${n}`)
    .join(' ');
}

function print(m: Match): void {
  const perMin = m.takedowns / Math.max(1 / 60, m.duration / 60);
  console.log(
    `\n${m.variant} seed ${m.seed}: over at ${clock(m.duration)}, first takedown ${clock(m.firstTakedown)}, ` +
      `${m.takedowns} takedowns (${perMin.toFixed(1)}/min)`,
  );
  console.log(`  takedowns by minute: ${m.takedownsByMin.join(' ')}`);
  console.log(`  caches by minute:    ${m.cachesByMin.join(' ')}`);
  const w = m.winner;
  console.log(
    `  winner: ${w ? `${w.championId} (${w.skill}) ${w.kills} kills, level ${w.level}` : 'none'}`,
  );
  console.log(
    `  top kills: ${m.top.map((t) => `${t.championId}/${t.skill} ${t.kills}-${t.deaths} L${t.level}`).join(', ')}`,
  );
  console.log(`  dusk deaths ${m.duskDeaths}, pads ${m.pads}, camps ${m.camps}`);
  console.log(
    `  levels: ${histogram(m.levels)} (median ${m.levels[Math.floor(m.levels.length / 2)]})`,
  );
  const d = (a: string, b: string) => m.duels[a]?.[b] ?? 0;
  console.log(
    `  duels: normal beat gentle ${d('normal', 'gentle')}, gentle beat normal ${d('gentle', 'normal')}; ` +
      `strong beat gentle ${d('strong', 'gentle')}, gentle beat strong ${d('gentle', 'strong')}; ` +
      `strong beat normal ${d('strong', 'normal')}, normal beat strong ${d('normal', 'strong')}`,
  );
  if (m.variant === 'one_life') {
    const lasted = Object.entries(m.lastedBySkill)
      .map(([skill, xs]) => `${skill} ${clock(mean(xs))} (n ${xs.length})`)
      .join(', ');
    console.log(`  lasted on average: ${lasted}`);
  }
  console.log(`  tick ${m.tickAvgMs.toFixed(2)} ms average, ${m.tickMaxMs.toFixed(1)} ms max`);
}

function summary(all: readonly Match[]): void {
  console.log(
    '\nvariant   seed  length first  td/min  last2/min peak/min winner                 top5 kills       dusk pads caches(0-3) camps lvl-med tick',
  );
  for (const m of all) {
    const perMin = m.takedowns / Math.max(1 / 60, m.duration / 60);
    const mins = m.takedownsByMin;
    const fullMins = Math.floor(m.duration / 60);
    const last2 = (mins[fullMins - 1] ?? 0) + (mins[fullMins - 2] ?? 0);
    const peak = Math.max(0, ...mins.slice(0, Math.max(1, fullMins)));
    const w = m.winner;
    const win = w ? `${w.championId}/${w.skill} ${w.kills}k L${w.level}` : 'none';
    const top = m.top.map((t) => t.kills).join(',');
    const early = (m.cachesByMin[0] ?? 0) + (m.cachesByMin[1] ?? 0) + (m.cachesByMin[2] ?? 0);
    const median = m.levels[Math.floor(m.levels.length / 2)];
    console.log(
      `${m.variant.padEnd(9)} ${String(m.seed).padStart(4)}  ${clock(m.duration).padStart(5)}  ${clock(m.firstTakedown).padStart(5)} ` +
        `${perMin.toFixed(0).padStart(6)} ${String(last2 / 2).padStart(9)} ${String(peak).padStart(8)} ${win.padEnd(22)} ${top.padEnd(16)} ` +
        `${String(m.duskDeaths).padStart(4)} ${String(m.pads).padStart(4)} ` +
        `${`${m.cachesByMin.reduce((a, b) => a + b, 0)}(${early})`.padStart(11)} ${String(m.camps).padStart(5)} ${String(median).padStart(7)} ${m.tickAvgMs.toFixed(2)}`,
    );
  }
  const totals: Record<string, Record<string, number>> = {};
  for (const m of all) {
    for (const [a, row] of Object.entries(m.duels)) {
      for (const [b, n] of Object.entries(row)) {
        totals[a] ??= {};
        totals[a]![b] = (totals[a]![b] ?? 0) + n;
      }
    }
  }
  const t = (a: string, b: string) => totals[a]?.[b] ?? 0;
  const share = (a: number, b: number) => (a + b > 0 ? `${Math.round((100 * a) / (a + b))}%` : '-');
  console.log(
    `\nfights won by the stronger skill: normal over gentle ${share(t('normal', 'gentle'), t('gentle', 'normal'))}, ` +
      `strong over gentle ${share(t('strong', 'gentle'), t('gentle', 'strong'))}, ` +
      `strong over normal ${share(t('strong', 'normal'), t('normal', 'strong'))}`,
  );
  const ol = all.filter((m) => m.variant === 'one_life');
  if (ol.length > 0) {
    const lasted: Record<string, number[]> = {};
    for (const m of ol) {
      for (const [k, xs] of Object.entries(m.lastedBySkill)) {
        lasted[k] = [...(lasted[k] ?? []), ...xs];
      }
    }
    console.log(
      `one life, lasted on average: ${Object.entries(lasted)
        .map(([k, xs]) => `${k} ${clock(mean(xs))} (n ${xs.length})`)
        .join(', ')}`,
    );
  }
  for (const variant of ['respawn', 'one_life'] as const) {
    const ms = all.filter((x) => x.variant === variant);
    if (ms.length === 0) continue;
    const by = new Map<string, { kills: number; deaths: number; n: number }>();
    for (const m of ms) {
      for (const s of m.seats) {
        const row = by.get(s.championId) ?? { kills: 0, deaths: 0, n: 0 };
        row.kills += s.kills;
        row.deaths += s.deaths;
        row.n++;
        by.set(s.championId, row);
      }
    }
    console.log(
      `${variant} takedowns per seat by champion: ${[...by.entries()]
        .sort((a, b) => b[1].kills / b[1].n - a[1].kills / a[1].n)
        .map(([id, r]) => `${id} ${(r.kills / r.n).toFixed(1)}/${(r.deaths / r.n).toFixed(1)}`)
        .join(', ')}`,
    );
  }
  const wins = new Map<string, number>();
  for (const m of all.filter((x) => x.variant === 'respawn')) {
    const id = m.winner?.championId ?? 'none';
    wins.set(id, (wins.get(id) ?? 0) + 1);
  }
  if (wins.size > 0) {
    console.log(
      `respawn winners: ${[...wins.entries()].map(([id, n]) => `${id} ${n}`).join(', ')}`,
    );
  }
}

const planet = loadPlanet();
const all: Match[] = [];
for (const variant of variants) {
  for (let seed = firstSeed; seed < firstSeed + seeds; seed++) {
    const m = play(planet, variant, seed, variant === 'one_life' ? passiveSeats : 0);
    all.push(m);
    if (!quiet) print(m);
  }
}
summary(all);
