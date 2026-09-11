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

import { starOrchard } from '../server/star_orchard';
import { CHAMPIONS } from '../src/sim/content/champions';
import { nextKitStep, roleBuild } from '../src/sim/playbook/kit';
import { Sim } from '../src/sim/sim';
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
