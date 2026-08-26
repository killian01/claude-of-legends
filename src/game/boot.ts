// Shared presentation boot for both hosts of the one sim: the offline Sim
// and the online ClientWorld. Builds the renderer, HUD, and input against
// IWorld only, and interpolates rendering between world ticks whatever
// drives them (a local accumulator offline, snapshot arrivals online).

import { Renderer } from '../render/renderer';
import type { TeamId } from '../sim/types';
import { DT } from '../sim/types';
import { Hud } from '../ui/hud';
import type { IWorld } from '../world_api';
import { setupInput } from './input';
import { pickEnemyAt } from './picking';

export interface Presentation {
  // Call once after every world tick (sim tick offline, snapshot online).
  onWorldTick(): void;
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

  setupInput(renderer, {
    onRightClick: (p) => {
      const enemy = pickEnemyAt(world, p, selfTeam);
      if (enemy) world.orderAttack(selfId, enemy.id);
      else world.orderMove(selfId, p.x, p.z);
    },
    onCast: (key, aim) => world.castAbility(selfId, key, aim),
    onCastSigil: (slot, aim) => world.castSigil(selfId, slot, aim),
    onToggleShop: () => hud.toggleShop(),
  });

  let lastTick = performance.now();
  const onWorldTick = (): void => {
    lastTick = performance.now();
    renderer.onSimTick();
    hud.update();
  };

  function frame(now: number): void {
    const alpha = Math.max(0, Math.min(1, (now - lastTick) / TICK_MS));
    renderer.render(alpha);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { onWorldTick };
}
