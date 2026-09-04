// Dev-only VFX showcase (vfx.html): boots the real sim and renderer with
// every champion at ultimate rank and exposes window.__vfxDemo.trigger(id)
// so a headless browser, or a curious human, can fire each ultimate and
// look at it. Presentation only; never imported by the game.

import { Renderer } from '../render/renderer';
import type { ChampionDef } from '../sim/content/champions';
import { CHAMPIONS } from '../sim/content/champions';
import { Sim } from '../sim/sim';
import type { SpellLook } from '../sim/spell_look';
import type { AbilityKey, Vec2 } from '../sim/types';
import { DT } from '../sim/types';
import type { Unit } from '../sim/unit';

const app = document.querySelector<HTMLElement>('#app');
const label = document.querySelector<HTMLElement>('#label');
if (!app) throw new Error('missing #app root element');

const CENTER: Vec2 = { x: 75, z: 75 };
const sim = new Sim(42);

// A forged champion carrying spell looks (src/sim/spell_look.ts), which is
// the whole point of the look: its id cannot appear in the authored VFX
// catalog, so without one every spell here would draw the same
// school-derived generic. Sylra's kit and stats verbatim (they already are
// forged-shaped data and they clear the power budget), its passive as the
// matching template, and one look per key. Dev-only, like this file.
const SYLRA = CHAMPIONS.sylra;
if (!SYLRA) throw new Error('the roster lost sylra');
const DEMO_LOOKS: Readonly<Record<AbilityKey, SpellLook>> = {
  Q: {
    palette: { main: 0x2f6fe0, glow: 0xbfe4ff },
    projectile: { body: 'shard', trail: 'embers', spin: 2.5 },
    impact: { shape: 'shatter', density: 0.8, mark: 'frost' },
  },
  W: { zone: { floor: 'pool', edge: 'soft', motion: 'rain' } },
  E: { cast: { shape: 'bloom', scale: 1.4 }, palette: { main: 0x7ad05a, glow: 0xc8ff9a } },
  R: {
    palette: { main: 0xc84fe0, glow: 0xf0c2ff },
    zone: { floor: 'runes', edge: 'hard', motion: 'swirl' },
    detonate: { shape: 'pillar', scale: 1.8, density: 0.9, smoke: true, shake: 0.25 },
  },
};
const LOOK_DEMO_ID = 'forged_lookdemo';
// ?plain=1 registers the same champion with NO looks: the side-by-side
// that says what a look is worth, since without one every forged spell
// falls back to the same school-derived generic.
const PLAIN = new URLSearchParams(window.location.search).has('plain');
sim.addForgedChampion({
  id: LOOK_DEMO_ID,
  name: 'Look Demo',
  title: '',
  tagline: 'Every spell wearing its own look.',
  role: SYLRA.role,
  creator: 'dev#0000',
  passive: { template: 'kit_inscribed', params: {}, name: 'Barbed Marks' },
  base: SYLRA.base,
  growth: SYLRA.growth,
  abilities: Object.fromEntries(
    (['Q', 'W', 'E', 'R'] as const).map((k) => [
      k,
      PLAIN ? SYLRA.abilities[k] : { ...SYLRA.abilities[k], look: DEMO_LOOKS[k] },
    ]),
  ) as ChampionDef['abilities'],
});

// Team 0 dummies around the center soak the hits and grant the viewer
// sight of the arena.
const DUMMIES: readonly [string, number, number][] = [
  ['korrath', 74, 74.2],
  ['maera', 76.4, 75.2],
  ['sylra', 75, 76.8],
];
for (const [id, x, z] of DUMMIES) sim.addChampion(0, { x, z }, id);

interface Shot {
  from: Vec2;
  aim: Vec2;
  key: AbilityKey;
  look?: Vec2;
}

// One caster per champion, team 1, each with a scripted spot and aim.
const SHOTS: Readonly<Record<string, Shot>> = {
  korrath: { from: { x: 69, z: 69 }, aim: CENTER, key: 'R' },
  dain: { from: { x: 81, z: 70 }, aim: CENTER, key: 'R' },
  sylra: { from: { x: 68, z: 78 }, aim: CENTER, key: 'R' },
  fenn: { from: { x: 76.6, z: 76 }, aim: { x: 75, z: 76.8 }, key: 'R' },
  elowen: { from: { x: 81, z: 79 }, aim: CENTER, key: 'R' },
  vesk: { from: { x: 79, z: 83 }, aim: { x: 55, z: 5 }, key: 'R', look: { x: 76, z: 74 } },
  ashvyn: { from: { x: 70, z: 82 }, aim: CENTER, key: 'R' },
  maera: { from: { x: 84, z: 75 }, aim: { x: 66, z: 75 }, key: 'R' },
  torv: { from: { x: 84, z: 80 }, aim: { x: 68, z: 71 }, key: 'R' },
  rhoka: { from: { x: 73, z: 71 }, aim: { x: 73, z: 71 }, key: 'R' },
  // The look demo, one shot per key: the same champion drawn four ways.
  look_q: { from: { x: 68, z: 84 }, aim: { x: 76.5, z: 79 }, key: 'Q' },
  look_w: { from: { x: 66, z: 75 }, aim: CENTER, key: 'W' },
  look_e: { from: { x: 73.5, z: 73 }, aim: { x: 73.5, z: 73 }, key: 'E' },
  look_r: { from: { x: 66, z: 75 }, aim: CENTER, key: 'R' },
};

const casters = new Map<string, Unit>();
for (const [id, shot] of Object.entries(SHOTS)) {
  const championId = id.startsWith('look_') ? LOOK_DEMO_ID : id;
  casters.set(id, sim.addChampion(1, { x: shot.from.x, z: shot.from.z }, championId));
}

// Everyone stays alive, ranked, and mana-flush so any spell fires any time.
function topUp(): void {
  for (const u of sim.units.values()) {
    if (u.kind !== 'champion') continue;
    u.level = 6;
    u.abilityRanks = { Q: 1, W: 1, E: 1, R: 1 };
    u.hp = u.maxHp;
    u.mana = u.maxMana;
    u.cooldowns = {};
  }
}
topUp();

const renderer = new Renderer(app, sim);
renderer.setViewerTeam(0);
renderer.lookAtPoint(CENTER.x, CENTER.z);

function trigger(id: string): boolean {
  const shot = SHOTS[id];
  const caster = casters.get(id);
  if (!shot || !caster) return false;
  topUp();
  caster.pos = { x: shot.from.x, z: shot.from.z };
  caster.path = [];
  const look = shot.look ?? CENTER;
  renderer.lookAtPoint(look.x, look.z);
  const ok = sim.castAbility(caster.id, shot.key, { x: shot.aim.x, z: shot.aim.z });
  if (label) label.textContent = `${id} ${shot.key}${ok ? '' : ' (refused)'}`;
  return ok;
}

(window as unknown as { __vfxDemo: { trigger: (id: string) => boolean } }).__vfxDemo = {
  trigger,
};
// Debug probe for headless inspection; TS privacy is compile-time only.
(window as unknown as { __r: unknown }).__r = renderer;
(window as unknown as { __sim: unknown }).__sim = sim;

const TICK_MS = DT * 1000;
let last = performance.now();
let acc = 0;
function frame(now: number): void {
  acc += Math.min(now - last, 250);
  last = now;
  while (acc >= TICK_MS) {
    topUp();
    const casts: { unitId: number; key?: AbilityKey }[] = [];
    const attacks: { unitId: number; targetId: number }[] = [];
    for (const ev of sim.tick()) {
      if (ev.type === 'cast') casts.push({ unitId: ev.unitId, key: ev.key });
      else if (ev.type === 'attack') attacks.push({ unitId: ev.unitId, targetId: ev.targetId });
    }
    renderer.onSimTick();
    try {
      renderer.onCombatNotes({ golds: [], casts, hits: [], attacks });
    } catch {
      // Audio may be unavailable headless; the visuals must go on.
    }
    acc -= TICK_MS;
  }
  renderer.render(Math.max(0, Math.min(1, acc / TICK_MS)));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
