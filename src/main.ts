// Client entry: boots the offline sim, the renderer, and the input loop.
// Fixed-timestep accumulator, same pattern the server loop will use: the sim
// ticks at exactly 20 Hz regardless of display refresh rate.

import { setupInput } from './game/input';
import { pickEnemyAt } from './game/picking';
import { Renderer } from './render/renderer';
import { Sim } from './sim/sim';
import { DT } from './sim/types';
import { Hud } from './ui/hud';
import type { IWorld } from './world_api';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('missing #app root element');

const sim = new Sim(42);
const world: IWorld = sim;

// Pick a champion with ?champ=<id> (fenn, korrath, maera, ...). Sylra is the
// default until the champion select screen lands in phase 6.
const requested = new URLSearchParams(window.location.search).get('champ');
const championId = requested && sim.championDef(requested) ? requested : undefined;
const self = sim.addChampion(0, undefined, championId);

// Practice dummies on mid lane until real opponents land (phases 4 and 7).
sim.addChampion(1, { x: 66, z: 66 }, 'korrath');
sim.addChampion(1, { x: 80, z: 80 }, 'vesk');

const renderer = new Renderer(app, world);
renderer.followUnit(self.id);
renderer.setViewerTeam(self.team);
const hud = new Hud(app, world, self.id, self.team);
setupInput(renderer, {
  onRightClick: (p) => {
    const enemy = pickEnemyAt(world, p, self.team);
    if (enemy) sim.orderAttack(self.id, enemy.id);
    else sim.orderMove(self.id, p.x, p.z);
  },
  onCast: (key, aim) => sim.castAbility(self.id, key, aim),
  onCastSigil: (slot, aim) => sim.castSigil(self.id, slot, aim),
  onToggleShop: () => hud.toggleShop(),
});

const TICK_MS = DT * 1000;
let last = performance.now();
let acc = 0;

function frame(now: number): void {
  acc += Math.min(now - last, 250);
  last = now;
  while (acc >= TICK_MS) {
    sim.tick();
    renderer.onSimTick();
    hud.update();
    acc -= TICK_MS;
  }
  renderer.render(acc / TICK_MS);
  requestAnimationFrame(frame);
}

requestAnimationFrame((t) => {
  last = t;
  requestAnimationFrame(frame);
});
