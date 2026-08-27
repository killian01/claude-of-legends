// The seatless presentation for watching a live match: renderer plus
// minimap on one team's fog, a SPECTATOR bar (follow the next champion,
// exit), no HUD and no order input. Reads IWorld only, like everything
// presentational.

import { Renderer } from '../render/renderer';
import type { TeamId } from '../sim/types';
import { DT } from '../sim/types';
import { Minimap } from '../ui/minimap';
import type { IWorld } from '../world_api';
import type { WorldNotes } from './boot';
import { startMusic, stopMusic } from './music';

const TICK_MS = DT * 1000;

const CSS = `
.spec-bar {
  position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 6px; align-items: center; z-index: 11;
  background: rgba(10, 15, 7, 0.88); border: 1px solid #6b5a2e; border-radius: 8px;
  padding: 6px 10px; pointer-events: auto; font-family: system-ui, sans-serif;
}
.spec-badge { color: #c9a84a; font-weight: 800; font-size: 12px; letter-spacing: 2px; margin-right: 4px; }
.spec-btn {
  padding: 5px 12px; border-radius: 6px; border: 1px solid #466030;
  background: #1d2a14; color: #d8e6c0; font-size: 12px; font-weight: 600; cursor: pointer;
}
.spec-btn:hover { border-color: #7ca050; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

export interface SpectatorView {
  onWorldTick(notes?: WorldNotes): void;
  dispose(): void;
}

export function startSpectator(
  container: HTMLElement,
  world: IWorld,
  team: TeamId,
  onExit: () => void,
): SpectatorView {
  ensureCss();
  const renderer = new Renderer(container, world);
  renderer.setViewerTeam(team);
  const minimap = new Minimap(
    container,
    world,
    team,
    0,
    (p) => renderer.lookAtPoint(p.x, p.z),
    (p) => renderer.lookAtPoint(p.x, p.z),
  );
  renderer.setEdgePanGate(() => !minimap.hovered);
  renderer.lookAtPoint(world.map.size / 2, world.map.size / 2);

  // Follow the watched team's champions, cycling on demand.
  const teamChampions = (): number[] =>
    [...world.units.values()]
      .filter((u) => u.kind === 'champion' && u.team === team)
      .map((u) => u.id)
      .sort((a, b) => a - b);
  let followAt = -1;
  const followNext = (): void => {
    const ids = teamChampions();
    if (ids.length === 0) return;
    followAt = (followAt + 1) % ids.length;
    renderer.followUnit(ids[followAt]!);
  };

  const bar = document.createElement('div');
  bar.className = 'spec-bar';
  const badge = document.createElement('span');
  badge.className = 'spec-badge';
  badge.textContent = 'SPECTATOR';
  const follow = document.createElement('button');
  follow.className = 'spec-btn';
  follow.textContent = 'Follow next champion';
  follow.addEventListener('click', followNext);
  const exit = document.createElement('button');
  exit.className = 'spec-btn';
  exit.textContent = 'Stop watching';
  exit.addEventListener('click', onExit);
  bar.append(badge, follow, exit);
  container.appendChild(bar);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') onExit();
  };
  window.addEventListener('keydown', onKeyDown);

  startMusic();
  let lastTick = performance.now();
  let disposed = false;
  let rafId = 0;
  function frame(now: number): void {
    if (disposed) return;
    const alpha = Math.max(0, Math.min(1, (now - lastTick) / TICK_MS));
    renderer.render(alpha);
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  return {
    onWorldTick(notes?: WorldNotes): void {
      lastTick = performance.now();
      renderer.onSimTick();
      minimap.update();
      if (notes && (notes.casts.length > 0 || notes.attacks.length > 0)) {
        renderer.onCombatNotes(notes);
      }
      if (world.winner !== null) stopMusic();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', onKeyDown);
      bar.remove();
      minimap.dispose();
      renderer.dispose();
      stopMusic();
    },
  };
}
