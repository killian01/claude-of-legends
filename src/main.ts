import { Sim } from './sim/sim';
import { TICK_RATE } from './sim/types';

const app = document.querySelector('#app');
const sim = new Sim(42);
for (let i = 0; i < TICK_RATE; i++) sim.tick();

if (app) {
  app.textContent =
    `Claude of Legends scaffold: sim ticked ${sim.tickCount} times, ` +
    `t=${sim.time.toFixed(2)}s. The map arrives in phase 2.`;
}
