// Dev-only Pyrefang lab (pyrefang.html): the real sim and renderer on the
// Star Orchard with the camera on the bot ring, and buttons that make the
// ring's creature rise now (its opening and the fire column), send a
// champion at it (it turns, walks and bites), finish it (its fall), or
// raise the Ascendant. Presentation check only; never imported by the game.

import { loadStarOrchardMatch } from '../game/star_orchard';
import { orchardSim } from '../net/replay';
import { Renderer } from '../render/renderer';
import { DT } from '../sim/types';

const app = document.querySelector<HTMLElement>('#app');
const label = document.querySelector<HTMLElement>('#label');
if (!app) throw new Error('missing #app root element');

const { orchard, terrain } = await loadStarOrchardMatch(() => {});
const sim = orchardSim(orchard, 42);
const ring = sim.ringStates.find((r) => r.creature === 'pyrefang');
if (!ring) throw new Error('the map has no Pyrefang ring');
const site = ring.site;

// A fighter at the foot of the ring, the viewer's team, kept alive.
const champion = sim.addChampion(0, { x: site.x + 7, z: site.z + 3 }, 'korrath');
function topUp(): void {
  champion.level = 11;
  champion.hp = champion.maxHp;
  champion.mana = champion.maxMana;
}

const renderer = new Renderer(app, sim, terrain);
renderer.setViewerTeam(0);
renderer.lookAtPoint(site.x, site.z);

function creature() {
  return ring?.unitId != null ? sim.units.get(ring.unitId) : undefined;
}

function say(text: string): void {
  if (label) label.textContent = text;
}

// The ring's creature, gone at once, rises again in `delay` seconds.
function rise(ascendant = false, delay = 1): void {
  const c = creature();
  if (c) sim.units.delete(c.id);
  if (!ring) return;
  ring.unitId = null;
  ring.riseIndex = ascendant ? 3 : 0;
  ring.nextRiseAt = sim.time + delay;
  champion.attackTargetId = null;
  champion.path = [];
  champion.pos = { x: site.x + 7, z: site.z + 3 };
  renderer.lookAtPoint(site.x, site.z);
  say(ascendant ? 'Ascendant rising' : 'Pyrefang rising');
}

function fight(): void {
  const c = creature();
  if (!c) {
    say('no creature on the ring');
    return;
  }
  champion.attackTargetId = c.id;
  say('fight: the Pyrefang answers');
}

function finish(): void {
  const c = creature();
  if (!c) {
    say('no creature on the ring');
    return;
  }
  c.hp = 1;
  champion.attackTargetId = c.id;
  say('finish: its last bite');
}

const actions: Record<string, () => void> = {
  rise: () => rise(false),
  ascendant: () => rise(true),
  fight,
  finish,
};
for (const [id, run] of Object.entries(actions)) {
  document.querySelector(`#${id}`)?.addEventListener('click', run);
}
window.addEventListener('keydown', (e) => {
  const key = { '1': 'rise', '2': 'fight', '3': 'finish', '4': 'ascendant' }[e.key];
  if (key) actions[key]?.();
});

(window as unknown as { __lab: unknown }).__lab = { sim, renderer, ...actions };
rise(false, 1.5);

const TICK_MS = DT * 1000;
let last = performance.now();
let acc = 0;
function frame(now: number): void {
  acc += Math.min(now - last, 250);
  last = now;
  while (acc >= TICK_MS) {
    topUp();
    const attacks: { unitId: number; targetId: number }[] = [];
    for (const ev of sim.tick()) {
      if (ev.type === 'attack') attacks.push({ unitId: ev.unitId, targetId: ev.targetId });
    }
    renderer.onSimTick();
    try {
      renderer.onCombatNotes({ golds: [], casts: [], hits: [], attacks });
    } catch {
      // Audio may be unavailable headless; the visuals must go on.
    }
    acc -= TICK_MS;
  }
  renderer.render(Math.max(0, Math.min(1, acc / TICK_MS)));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
