// Dev-only harness for the planet's renderer (planet.html): the real
// presentation (renderer, HUD, minimap, input) over a stand-in world on the
// Wanderseed (planet_demo_world.ts), stepped at the sim's 20 Hz. Query
// flags: ?drop=8 seconds of drop over the globe (0 lands at once),
// ?dusk=near puts the Dusk's edge a few meters off, ?seed=n. A probe at
// window.__planetDemo lets a headless browser steer it. Never imported by
// the game.

import { startPresentation } from '../game/boot';
import { whenChampionModelsReady } from '../render/champions/readiness';
import { loadPlanetGround, planetTerrain } from '../render/planet_terrain';
import type { Renderer } from '../render/renderer';
import { DT } from '../sim/types';
import { PlanetDemoWorld } from './planet_demo_world';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('missing #app root element');

const params = new URLSearchParams(window.location.search);
const dropS = Number(params.get('drop') ?? 8);
const coarse =
  typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

// ?hud=0: the renderer and the minimap alone, for a clean look.
if (params.get('hud') === '0') {
  const style = document.createElement('style');
  style.textContent = '.hud { display: none !important; }';
  document.head.appendChild(style);
}

const [ground] = await Promise.all([
  loadPlanetGround({ light: coarse }),
  whenChampionModelsReady(),
]);
const at = params.get('at')?.split(',').map(Number);
const world = new PlanetDemoWorld(ground, {
  ...(at && at.length === 3 && at.every(Number.isFinite)
    ? { at: { x: at[0]!, y: at[1]!, z: at[2]! } }
    : {}),
  dropS: Number.isFinite(dropS) ? dropS : 8,
  duskNear: params.get('dusk') === 'near',
  seed: Number(params.get('seed') ?? 3),
});
const terrain = planetTerrain(ground);
let renderer: Renderer | null = null;
// The draw's own time, frame by frame (the last 120), for the probe.
const frameMs: number[] = [];
const pres = startPresentation(app, world, world.selfId, 0, () => undefined, {
  terrain,
  fullscreen: false,
  guide: 'watch',
  onRenderer: (r) => {
    renderer = r;
    const render = r.render.bind(r);
    r.render = (alpha: number) => {
      const t0 = performance.now();
      render(alpha);
      frameMs.push(performance.now() - t0);
      if (frameMs.length > 120) frameMs.shift();
    };
  },
});

let paused = params.get('paused') === '1';
let last = performance.now();
let acc = 0;
function frame(now: number): void {
  if (!paused) {
    acc += Math.min(250, now - last);
    while (acc >= DT * 1000) {
      acc -= DT * 1000;
      pres.onWorldTick(world.step());
    }
  }
  last = now;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

(window as unknown as { __planetDemo: unknown }).__planetDemo = {
  world,
  ground,
  get renderer() {
    return renderer;
  },
  // Steps the world by hand (for a still shot), n ticks.
  step(n = 1) {
    for (let i = 0; i < n; i++) pres.onWorldTick(world.step());
  },
  pause(on = true) {
    paused = on;
  },
  placeholder: ground.placeholder,
  // The draw's cost over the last frames: milliseconds and draw calls.
  frameStats() {
    const sorted = [...frameMs].sort((x, y) => x - y);
    const at = (q: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
    return {
      frames: sorted.length,
      medianMs: at(0.5),
      p95Ms: at(0.95),
      ...(renderer ? renderer.renderStats() : {}),
    };
  },
};
