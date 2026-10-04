// What a neutral body costs to kill (docs/plan-rings.md, round two): a
// lone champion, a duo and a full team against the Pyrefang, the Warden
// and the Ascendant at several clocks, each champion at the level and
// with the items a laner has at that clock, every ability used. The
// measurement behind the bodies and the growth curves in
// src/sim/content/rings.ts and src/sim/content/warden.ts: rerun it after
// a tuning and read it against the targets it prints. A verdict reads a
// ring creature's solo off the median of the champions that kill it (the
// tanks and the supports are meant to fail) and a team body's duo off the
// fastest duo (the tank pair is meant to fail). Bundled and run by
// scripts/creature_report.mjs:
//   node scripts/creature_report.mjs [--clocks 240,390,720,1200] [--which pyrefang,warden,ascendant]
// With --planet it measures the battle royale's bodies instead (content/
// royale_events.ts PLANET_NEUTRAL_SCALE): every champion alone, at level 6
// with four pieces of its seat build, against the Pyrefang and the Voidmaul
// at their 3:00 rise and the Warden at its rise in each variant, on the
// Wanderseed with the Dusk's burn held off; the standard is a big creature
// in 18 to 25 s with 30% of the health left or more, the Warden in 25 to
// 35 s (the median of the ten):
//   node scripts/creature_report.mjs --planet [--level 6] [--pieces 4] [--seed 3]

import { readFileSync } from 'node:fs';
import { starOrchard } from '../server/star_orchard';
import { buildRoyaleSim, type ReplayPick, type RoyalePlanet } from '../src/net/replay';
import { CHAMPIONS } from '../src/sim/content/champions';
import { assemblePlanet } from '../src/sim/content/planet';
import { RING_RISE_AT_S, WARDEN_RISE_AT_S } from '../src/sim/content/royale_events';
import { SphereGround } from '../src/sim/ground';
import { nextKitStep, roleBuild } from '../src/sim/playbook/kit';
import { grantXp } from '../src/sim/royale/levels';
import { grantPieces } from '../src/sim/royale/loot';
import { DROP_S } from '../src/sim/royale/types';
import { Sim } from '../src/sim/sim';
import { decodeSphereNav, findSpherePath, SphereNavGrid } from '../src/sim/sphere_nav';
import { xpForNext } from '../src/sim/stats';
import { TerrainNavGrid } from '../src/sim/terrain_nav';
import type { AbilityKey } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};
const clocks = opt('--clocks', '240,390,720,1200').split(',').map(Number);
const which = opt('--which', 'pyrefang,warden,ascendant').split(',') as Body[];
type Body = 'pyrefang' | 'warden' | 'ascendant';

// A laner at a clock: the level and the gold in items, read off house bot
// matches (a human farms a little better).
function lanerAt(time: number): { level: number; gold: number } {
  const min = time / 60;
  return { level: Math.min(18, Math.round(2.5 + 0.65 * min)), gold: Math.round(200 + 250 * min) };
}

// The standard (docs/plan-rings.md, round two), in seconds: a lone
// champion takes a ring creature in a minute or more and leaves bleeding,
// a duo in about thirty seconds, five in about twelve; the Warden wants a
// team, a duo takes it in about a minute; the Ascendant wants a team and
// about forty seconds. The bands read the standard with the spread of ten
// champions and one seed in mind.
const TARGETS: Record<
  Body,
  { solo: [number, number] | null; duo: [number, number] | null; five: [number, number] }
> = {
  pyrefang: { solo: [50, 90], duo: [25, 40], five: [8, 15] },
  warden: { solo: null, duo: [50, 80], five: [18, 30] },
  ascendant: { solo: null, duo: null, five: [35, 55] },
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, '0')}`;

function orchardSim(seed: number): Sim {
  const o = starOrchard();
  return new Sim(seed, {
    map: o.map,
    nav: new TerrainNavGrid(o.navigation),
    strictNavigation: true,
  });
}

function equip(sim: Sim, id: number, level: number, gold: number): void {
  const u = sim.units.get(id)!;
  sim.setLevel(id, level);
  const order: AbilityKey[] = ['Q', 'W', 'E'];
  let guard = 0;
  while (u.skillPoints > 0 && guard++ < 40) {
    if (sim.levelAbility(id, 'R')) continue;
    let done = false;
    for (const k of order) {
      if (sim.levelAbility(id, k)) {
        done = true;
        break;
      }
    }
    if (!done) break;
  }
  const fountain = sim.map.fountains.find((f) => f.team === u.team)!;
  const saved = { ...u.pos };
  u.pos = { x: fountain.x, z: fountain.z };
  u.gold = gold;
  const build = roleBuild(u.championId);
  for (let i = 0; i < 12; i++) {
    const step = nextKitStep(build, u.items, u.gold);
    if (step?.kind !== 'buy') break;
    if (!sim.buyItem(id, step.itemId)) break;
  }
  u.pos = saved;
}

// The body alone on the map: the other ring's creature is held back and
// the Warden's clock is left alone, so what rises is what is measured.
function summon(sim: Sim, body: Body): Unit | undefined {
  const find = (): Unit | undefined =>
    [...sim.units.values()].find((u) =>
      body === 'warden'
        ? u.kind === 'warden'
        : u.creatureId === 'pyrefang' && u.ascendant === (body === 'ascendant') && !u.dead,
    );
  for (const st of sim.ringStates) st.nextRiseAt = Number.POSITIVE_INFINITY;
  if (body === 'warden') {
    sim.objectives.nextSpawnAt = sim.time;
  } else {
    const st = sim.ringStates.find((s) => s.creature === 'pyrefang')!;
    st.nextRiseAt = sim.time;
    st.unitId = null;
    st.riseIndex = body === 'ascendant' ? 3 : 0;
  }
  for (let i = 0; i < 200 && !find(); i++) sim.tick();
  return find();
}

interface Outcome {
  killed: boolean;
  seconds: number;
  hpLeft: number[];
  deaths: number;
  bodyLeft: number;
}

function fight(champs: readonly string[], body: Body, time: number, seed = 3): Outcome {
  const sim = orchardSim(seed);
  // Jump the clock without the waves it skipped: the fight is measured on
  // an empty ring, and catching twelve minutes of waves up in one tick
  // would fill the map and slow every tick that follows.
  sim.time = time;
  (sim as unknown as { nextWaveAt: number }).nextWaveAt = time;
  const target = summon(sim, body);
  if (!target) throw new Error(`${body} never rose`);
  const laner = lanerAt(time);
  const ids = champs.map((ch, i) => {
    const u = sim.addChampion(0, { x: target.pos.x + 3 + i, z: target.pos.z + (i % 2) }, ch);
    equip(sim, u.id, laner.level, laner.gold);
    return u.id;
  });
  const start = sim.time;
  const maxHp0 = ids.map((id) => sim.units.get(id)!.maxHp);
  let deaths = 0;
  while (sim.time - start < 240 && sim.units.has(target.id)) {
    for (const id of ids) {
      const u = sim.units.get(id)!;
      if (u.dead) continue;
      if (u.attackTargetId !== target.id) sim.orderAttack(id, target.id);
      for (const k of ['R', 'Q', 'W', 'E'] as AbilityKey[]) {
        sim.castAbility(id, k, { x: target.pos.x, z: target.pos.z });
      }
    }
    for (const e of sim.tick()) if (e.type === 'death' && ids.includes(e.unitId)) deaths++;
    if (ids.every((id) => sim.units.get(id)!.dead)) break;
  }
  return {
    killed: !sim.units.has(target.id),
    seconds: sim.time - start,
    hpLeft: ids.map((id, i) => Math.max(0, sim.units.get(id)!.hp) / maxHp0[i]!),
    deaths,
    bodyLeft: sim.units.has(target.id) ? target.hp / target.maxHp : 0,
  };
}

const pct = (f: number) => `${Math.round(f * 100)}%`;
function line(label: string, o: Outcome): string {
  const result = o.killed
    ? `killed in ${o.seconds.toFixed(0)} s`
    : `NOT killed (body at ${pct(o.bodyLeft)} after ${o.seconds.toFixed(0)} s)`;
  return `  ${label}: ${result}, hp left ${o.hpLeft.map(pct).join('/')}${o.deaths ? `, deaths ${o.deaths}` : ''}`;
}
const inRange = (v: number, r: [number, number]) => v >= r[0] && v <= r[1];
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

const DUOS: readonly (readonly string[])[] = [
  ['ashvyn', 'torv'],
  ['dain', 'korrath'],
  ['sylra', 'fenn'],
];
const FIVE: readonly string[] = ['ashvyn', 'torv', 'dain', 'sylra', 'fenn'];

// The battle royale's bodies (--planet).
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

type PlanetBody = 'pyrefang' | 'voidmaul' | 'warden-one-life' | 'warden-respawn';
const PLANET_TARGETS: Record<PlanetBody, { s: [number, number]; hp: number }> = {
  pyrefang: { s: [18, 25], hp: 0.3 },
  voidmaul: { s: [18, 25], hp: 0.3 },
  'warden-one-life': { s: [25, 35], hp: 0 },
  'warden-respawn': { s: [25, 35], hp: 0 },
};

function planetFight(
  planet: RoyalePlanet,
  championId: string,
  body: PlanetBody,
  level: number,
  pieces: number,
  seed: number,
): Outcome {
  // One life's clock, on a Respawn match: a lone seat would win One life
  // on the first tick.
  const clockOf = body === 'warden-one-life' ? 'one_life' : 'respawn';
  const picks: ReplayPick[] = [{ name: 'solo', team: 0, championId, sigils: ['riftstep', 'mend'] }];
  const { sim, unitIds } = buildRoyaleSim(planet, seed, picks, 'respawn');
  const m = sim.royaleMode!;
  // The Dusk's burn held off: the body is what is measured.
  m.stepDusk = () => {};
  while (sim.time < DROP_S + 4) sim.tick();
  const u = sim.units.get(unitIds[0]!)!;
  for (let n = 0; n < 30 && u.level < level; n++) grantXp(u, xpForNext(u.level) - u.xp);
  grantPieces(u, m.builds.get(u.id)!, pieces);
  u.hp = u.maxHp;
  u.mana = u.maxMana;
  const at =
    body === 'pyrefang' || body === 'voidmaul'
      ? DROP_S + RING_RISE_AT_S
      : DROP_S + WARDEN_RISE_AT_S[clockOf];
  sim.time = at;
  for (const st of sim.ringStates) {
    st.nextRiseAt = st.creature === body ? sim.time : Number.POSITIVE_INFINITY;
  }
  sim.objectives.nextSpawnAt = body.startsWith('warden') ? sim.time : Number.POSITIVE_INFINITY;
  let target: Unit | undefined;
  for (let i = 0; i < 5 && !target; i++) {
    sim.tick();
    target = [...sim.units.values()].find(
      (x) => (x.kind === 'creature' || x.kind === 'warden') && !x.dead,
    );
  }
  if (!target) throw new Error(`${body} never rose`);
  const near = sim.ground.nearestWalkable(
    { x: target.pos.x + 2.5, y: target.pos.y, z: target.pos.z },
    10,
  );
  if (near) u.pos = { ...near };
  u.path = [];
  const start = sim.time;
  // The lowest the champion fell (the last hit's prize heals it all).
  let lowest = 1;
  let deaths = 0;
  while (sim.time - start < 120 && sim.units.has(target.id) && !u.dead) {
    lowest = Math.min(lowest, u.hp / u.maxHp);
    if (u.attackTargetId !== target.id) sim.orderAttack(u.id, target.id);
    for (const k of ['R', 'Q', 'W', 'E'] as AbilityKey[]) {
      sim.castAbility(u.id, k, { x: target.pos.x, y: target.pos.y, z: target.pos.z });
    }
    for (const e of sim.tick()) if (e.type === 'death' && e.unitId === u.id) deaths++;
  }
  return {
    killed: !sim.units.has(target.id) || target.dead,
    seconds: sim.time - start,
    hpLeft: [u.dead ? 0 : lowest],
    deaths,
    bodyLeft: sim.units.has(target.id) ? target.hp / target.maxHp : 0,
  };
}

function planetReport(): void {
  const level = Number(opt('--level', '6'));
  const pieces = Number(opt('--pieces', '4'));
  const seed = Number(opt('--seed', '3'));
  const planet = loadPlanet();
  const out: string[] = [];
  for (const body of Object.keys(PLANET_TARGETS) as PlanetBody[]) {
    console.log(`\n== ${body} on the planet, champions L${level} with ${pieces} pieces`);
    const solos = Object.keys(CHAMPIONS).map(
      (ch) => [ch, planetFight(planet, ch, body, level, pieces, seed)] as const,
    );
    for (const [ch, o] of solos) console.log(line(ch, o));
    const t = PLANET_TARGETS[body];
    const kills = solos.filter(([, o]) => o.killed);
    const secs = median(kills.map(([, o]) => o.seconds));
    const left = median(kills.map(([, o]) => o.hpLeft[0]!));
    const ok = kills.length >= 8 && inRange(secs, t.s) && left >= t.hp;
    const v = `${ok ? 'OK ' : 'KO '} ${body}: ${kills.length}/10 kill it alone, median ${secs.toFixed(0)} s (want ${t.s[0]}-${t.s[1]}), lowest health median ${pct(left)}${t.hp > 0 ? ` (want ${pct(t.hp)} or more)` : ''}`;
    console.log(`  -> ${v}`);
    out.push(v);
  }
  console.log(`\n${out.join('\n')}`);
}

if (args.includes('--planet')) {
  planetReport();
  process.exit(0);
}

const verdicts: string[] = [];
for (const time of clocks) {
  const laner = lanerAt(time);
  for (const body of which) {
    console.log(`\n== ${body} at ${clock(time)}, champions L${laner.level} with ${laner.gold}g`);
    const solos = Object.keys(CHAMPIONS).map((ch) => [ch, fight([ch], body, time)] as const);
    for (const [ch, o] of solos) console.log(line(ch, o));
    const duos = DUOS.map((pair) => [pair.join('+'), fight(pair, body, time)] as const);
    for (const [label, o] of duos) console.log(line(label, o));
    const five = fight(FIVE, body, time);
    console.log(line('five', five));
    const t = TARGETS[body];
    const soloKills = solos.filter(([, o]) => o.killed).map(([, o]) => o.seconds);
    const soloText = t.solo
      ? `solo ${soloKills.length}/10 kill it, median ${median(soloKills).toFixed(0)} s (want ${t.solo[0]}-${t.solo[1]}), fastest ${Math.min(...soloKills).toFixed(0)} s, survivors leave at ${pct(median(solos.filter(([, o]) => o.killed).map(([, o]) => o.hpLeft[0]!)))} (want under 30%)`
      : `solo ${soloKills.length}/10 kill it (want 0)`;
    const duoKills = duos.filter(([, o]) => o.killed).map(([, o]) => o.seconds);
    // A ring creature's duo is any duo; a team body's is the strongest.
    const duoRead = t.solo ? median(duoKills) : Math.min(...duoKills);
    const duoText = t.duo
      ? `duo ${duoKills.length}/3, ${t.solo ? 'median' : 'fastest'} ${duoRead.toFixed(0)} s (want ${t.duo[0]}-${t.duo[1]})`
      : `duo ${duoKills.length}/3 kill it (want 0)`;
    const fiveText = `five ${five.killed ? `${five.seconds.toFixed(0)} s` : 'fail'} (want ${t.five[0]}-${t.five[1]})`;
    const ok =
      (t.solo ? inRange(median(soloKills), t.solo) : soloKills.length === 0) &&
      (t.duo ? duoKills.length > 0 && inRange(duoRead, t.duo) : duoKills.length === 0) &&
      five.killed &&
      inRange(five.seconds, t.five);
    const verdict = `${ok ? 'OK ' : 'KO '} ${body} at ${clock(time)}: ${soloText}; ${duoText}; ${fiveText}`;
    console.log(`  -> ${verdict}`);
    verdicts.push(verdict);
  }
}
console.log(`\n${verdicts.join('\n')}`);
