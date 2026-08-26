// Shared presentation boot for both hosts of the one sim: the offline Sim
// and the online ClientWorld. Builds the renderer, HUD, minimap, and input
// against IWorld only, and interpolates rendering between world ticks
// whatever drives them (a local accumulator offline, snapshot arrivals
// online).

import { Renderer } from '../render/renderer';
import type { TeamId } from '../sim/types';
import { DT } from '../sim/types';
import { Hud } from '../ui/hud';
import { Minimap } from '../ui/minimap';
import type { IWorld } from '../world_api';
import { setupInput } from './input';
import { pickEnemyAt } from './picking';

export interface KillNote {
  unitId: number;
  killerId: number;
}

// One-shot combat notes accompanying a world tick.
export interface WorldNotes {
  kills: readonly KillNote[];
  golds: readonly number[];
  casts: readonly number[];
}

export interface Presentation {
  // Call once after every world tick (sim tick offline, snapshot online).
  onWorldTick(notes?: WorldNotes): void;
}

const TICK_MS = DT * 1000;

export function startPresentation(
  container: HTMLElement,
  world: IWorld,
  selfId: number,
  selfTeam: TeamId,
): Presentation {
  const renderer = new Renderer(container, world);
  renderer.followUnit(selfId);
  renderer.setViewerTeam(selfTeam);
  const hud = new Hud(container, world, selfId, selfTeam);
  const minimap = new Minimap(container, world, selfTeam, selfId, (p) => {
    world.orderMove(selfId, p.x, p.z);
    renderer.flashMarker(p.x, p.z);
  });

  setupInput(renderer, {
    onRightClick: (p) => {
      const enemy = pickEnemyAt(world, p, selfTeam);
      if (enemy) {
        world.orderAttack(selfId, enemy.id);
      } else {
        world.orderMove(selfId, p.x, p.z);
        renderer.flashMarker(p.x, p.z);
      }
    },
    onCast: (key, aim) => world.castAbility(selfId, key, aim),
    onCastSigil: (slot, aim) => world.castSigil(selfId, slot, aim),
    onToggleShop: () => hud.toggleShop(),
    onToggleScoreboard: () => hud.toggleScoreboard(),
  });

  let lastTick = performance.now();
  const onWorldTick = (notes?: WorldNotes): void => {
    lastTick = performance.now();
    renderer.onSimTick();
    hud.update();
    minimap.update();
    if (notes) {
      if (notes.kills.length > 0) hud.pushKills(notes.kills);
      if (notes.golds.length > 0 || notes.casts.length > 0) renderer.onCombatNotes(notes);
    }
  };

  function frame(now: number): void {
    const alpha = Math.max(0, Math.min(1, (now - lastTick) / TICK_MS));
    renderer.render(alpha);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { onWorldTick };
}
