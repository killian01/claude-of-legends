// Client entry: boots the offline sim, the renderer, and the input loop.
// Fixed-timestep accumulator, same pattern the server loop will use: the sim
// ticks at exactly 20 Hz regardless of display refresh rate.

import { setupInput } from './game/input';
import { Renderer } from './render/renderer';
import { Sim } from './sim/sim';
import { DT } from './sim/types';
import type { IWorld } from './world_api';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('missing #app root element');

const sim = new Sim(42);
const world: IWorld = sim;
const self = sim.addChampion(0);

const renderer = new Renderer(app, world);
renderer.followUnit(self.id);
setupInput(renderer, (p) => sim.orderMove(self.id, p.x, p.z));

const TICK_MS = DT * 1000;
let last = performance.now();
let acc = 0;

function frame(now: number): void {
  acc += Math.min(now - last, 250);
  last = now;
  while (acc >= TICK_MS) {
    sim.tick();
    renderer.onSimTick();
    acc -= TICK_MS;
  }
  renderer.render(acc / TICK_MS);
  requestAnimationFrame(frame);
}

requestAnimationFrame((t) => {
  last = t;
  requestAnimationFrame(frame);
});
