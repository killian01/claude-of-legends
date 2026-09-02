// The scouting report (docs/design/bots.md, the bar): what a player would
// have done differently, measured. Plays a set of 5v5 matches, the working
// tree's default Laner (or a candidate playbook) on one side and a git
// ref's Laner on the other, sides swapped every other seed, and records
// every champion death with what was around it: the play that was
// running, the numbers at the spot (allies plus one, minus enemies, within
// 18 units), whether an enemy tower reached it, the gold it died holding,
// the minute. Then the tally per side: deaths, the share taken outnumbered,
// under a tower, with a full purse, by play, and the bank left at the end.
// Usage:
//   node scripts/scout.mjs [--prev <git-ref>] [--seeds 6] [--playbook file.json]

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const ref = opt('--prev', 'HEAD');
const seeds = Number(opt('--seeds', '6'));
// The Arena's own cap (src/fast_match.ts): past it a match is a draw.
const maxTicks = Number(opt('--max-ticks', String(20 * 60 * 40)));
const candidate = opt('--playbook', null);
const distName = opt('--dist', 'dist-gate-scout');
const NEAR = 18;
const TOWER_REACH = 11.5;
const RICH = 1500;

const root = process.cwd();
const dist = path.join(root, distName);
rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, 'prev'), { recursive: true });
execSync(`git archive --format=tar -o ${distName}/prev.tar ${ref} src`, { stdio: 'inherit' });
execSync(`tar -xf ${distName}/prev.tar -C ${distName}/prev`, { stdio: 'inherit' });
writeFileSync(
  path.join(dist, 'current.ts'),
  [
    "export { Sim } from '../src/sim/sim';",
    "export { fillTeam } from '../src/sim/fill';",
    "export { Rng } from '../src/sim/rng';",
    "export { LANER_PLAYBOOK } from '../src/sim/content/playbooks/laner';",
    "export { validatePlaybook } from '../src/sim/playbook';",
    '',
  ].join('\n'),
);
writeFileSync(
  path.join(dist, 'prev.ts'),
  "export { LANER } from './prev/src/sim/content/bots/laner';\n",
);
const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  logLevel: 'silent',
};
await build({
  ...shared,
  entryPoints: [path.join(dist, 'current.ts')],
  outfile: path.join(dist, 'current.cjs'),
});
await build({
  ...shared,
  entryPoints: [path.join(dist, 'prev.ts')],
  outfile: path.join(dist, 'prev.cjs'),
});
const require = createRequire(import.meta.url);
const cur = require(path.join(dist, 'current.cjs'));
const prev = require(path.join(dist, 'prev.cjs'));
let playbook = cur.LANER_PLAYBOOK;
if (candidate) {
  const v = cur.validatePlaybook(JSON.parse(readFileSync(candidate, 'utf8')));
  if (!v.ok) throw new Error(`candidate playbook: ${v.errors.join('; ')}`);
  playbook = v.def;
}

const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function tally() {
  return {
    matches: 0,
    wins: 0,
    deaths: 0,
    outnumbered: 0,
    underTower: 0,
    rich: 0,
    goldAtDeath: 0,
    byPlay: new Map(),
    byMinute: new Map(),
    kills: 0,
    bankAtEnd: 0,
    towersLost: 0,
  };
}
const sides = { current: tally(), previous: tally() };

function play(seed, curTeam) {
  const sim = new cur.Sim(seed);
  // Both teams on the fill drawn from the seed (src/sim/fill.ts).
  const rng = new cur.Rng(seed);
  const sideOf = new Map();
  for (const team of [0, 1]) {
    for (const [i, championId] of cur.fillTeam([], rng).entries()) {
      const unit = sim.addChampion(team, undefined, championId, i % 3);
      unit.sigils = ['riftstep', 'mend'];
      if (team === curTeam) sim.attachPlaybook(unit.id, playbook);
      else sim.attachPolicy(unit.id, prev.LANER.policy);
      sideOf.set(unit.id, team === curTeam ? 'current' : 'previous');
    }
  }
  const towersAtStart = { 0: 0, 1: 0 };
  for (const u of sim.units.values()) if (u.kind === 'tower') towersAtStart[u.team]++;
  while (sim.winner === null && sim.tickCount < maxTicks) {
    const events = sim.tick();
    for (const ev of events) {
      if (ev.type !== 'death') continue;
      const victim = sim.units.get(ev.unitId);
      if (victim?.kind !== 'champion') continue;
      const side = sides[sideOf.get(victim.id)];
      const killer = sim.units.get(ev.killerId);
      if (killer && killer.kind === 'champion' && sideOf.has(killer.id)) {
        sides[sideOf.get(killer.id)].kills++;
      }
      let allies = 0;
      let enemies = 0;
      let tower = false;
      for (const u of sim.units.values()) {
        if (u.id === victim.id || u.dead) continue;
        const d = dist2(u.pos, victim.pos);
        if (u.kind === 'champion' && d <= NEAR) {
          if (u.team === victim.team) allies++;
          else enemies++;
        }
        if (u.kind === 'tower' && u.team !== victim.team && d <= TOWER_REACH) tower = true;
      }
      side.deaths++;
      if (allies + 1 < enemies) side.outnumbered++;
      if (tower) side.underTower++;
      if (victim.gold >= RICH) side.rich++;
      side.goldAtDeath += victim.gold;
      const playId = victim.play ?? '(previous engine)';
      side.byPlay.set(playId, (side.byPlay.get(playId) ?? 0) + 1);
      const minute = Math.floor(sim.time / 60);
      side.byMinute.set(minute, (side.byMinute.get(minute) ?? 0) + 1);
    }
  }
  for (const [id, sideName] of sideOf) {
    const u = sim.units.get(id);
    sides[sideName].bankAtEnd += u ? u.gold : 0;
  }
  const towersLeft = { 0: 0, 1: 0 };
  for (const u of sim.units.values()) if (u.kind === 'tower' && !u.dead) towersLeft[u.team]++;
  sides.current.towersLost += towersAtStart[curTeam] - towersLeft[curTeam];
  sides.previous.towersLost += towersAtStart[1 - curTeam] - towersLeft[1 - curTeam];
  sides.current.matches++;
  sides.previous.matches++;
  if (sim.winner === curTeam) sides.current.wins++;
  else if (sim.winner !== null) sides.previous.wins++;
  return { winner: sim.winner, seconds: Math.round(sim.time) };
}

const started = Date.now();
for (let seed = 1; seed <= seeds; seed++) {
  const curTeam = seed % 2 === 0 ? 1 : 0;
  const { winner, seconds } = play(seed, curTeam);
  console.log(
    `seed ${seed}: current on team ${curTeam}, winner ${winner}, ${seconds}s, ` +
      `${Math.round((Date.now() - started) / 1000)}s elapsed`,
  );
}

const pct = (n, d) => (d > 0 ? `${Math.round((100 * n) / d)}%` : '-');
for (const [name, s] of Object.entries(sides)) {
  console.log(
    `\n== ${name} (${candidate && name === 'current' ? candidate : name === 'current' ? 'working tree Laner' : ref})`,
  );
  console.log(
    `wins ${s.wins}/${s.matches}; kills ${s.kills}; deaths ${s.deaths} (${(s.deaths / s.matches / 5).toFixed(1)} per bot per match)`,
  );
  console.log(
    `deaths outnumbered ${pct(s.outnumbered, s.deaths)}; under a tower ${pct(s.underTower, s.deaths)}; ` +
      `holding ${RICH}+ gold ${pct(s.rich, s.deaths)}; avg gold at death ${Math.round(s.goldAtDeath / Math.max(1, s.deaths))}`,
  );
  console.log(
    `bank left at the end, per bot: ${Math.round(s.bankAtEnd / (s.matches * 5))}; towers lost per match ${(s.towersLost / s.matches).toFixed(1)}`,
  );
  const plays = [...s.byPlay.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`deaths by play: ${plays.map(([p, n]) => `${p} ${n}`).join(', ')}`);
  const minutes = [...s.byMinute.entries()].sort((a, b) => a[0] - b[0]);
  console.log(`deaths by minute: ${minutes.map(([m, n]) => `${m}:${n}`).join(' ')}`);
}
