// Shared presentation boot for both hosts of the one sim: the offline Sim
// and the online ClientWorld. Builds the renderer, HUD, minimap, and input
// against IWorld only, and interpolates rendering between world ticks
// whatever drives them (a local accumulator offline, snapshot arrivals
// online).

import { Renderer } from '../render/renderer';
import type { TeamId, Vec2 } from '../sim/types';
import { DT } from '../sim/types';
import { Hud, type NetHooks } from '../ui/hud';
import { Minimap } from '../ui/minimap';
import type { IWorld } from '../world_api';
import { setupInput } from './input';
import { pickEnemyAt } from './picking';
import { playSfx } from './sfx';

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
  pushChat(from: string, team: TeamId, text: string): void;
  showPing(x: number, z: number, from: string, team: TeamId): void;
  setNetHooks(hooks: NetHooks): void;
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

  let hooks: NetHooks = {};
  const showPing = (x: number, z: number, from: string, team: TeamId): void => {
    playSfx('ping');
    renderer.flashMarker(x, z, 0xffd94a);
    minimap.addPing(x, z);
    hud.pushChat(from, team, 'pinged the map');
  };

  setupInput(renderer, {
    onRightClick: (p: Vec2) => {
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
    onAttackMove: (aim) => {
      world.orderAttackMove(selfId, aim.x, aim.z);
      renderer.flashMarker(aim.x, aim.z, 0xffa53e);
    },
    onRecall: () => world.startRecall(selfId),
    onToggleShop: () => hud.toggleShop(),
    onToggleScoreboard: () => hud.toggleScoreboard(),
    onToggleMenu: () => hud.toggleEscapeMenu(),
    onOpenChat: () => hud.openChat(),
    onPing: (aim) => {
      if (hooks.sendPing) hooks.sendPing(aim.x, aim.z);
      else showPing(aim.x, aim.z, 'You', selfTeam);
    },
    isTyping: () => hud.isChatOpen(),
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

  return {
    onWorldTick,
    pushChat: (from, team, text) => hud.pushChat(from, team, text),
    showPing,
    setNetHooks: (h) => {
      hooks = h;
      hud.setNetHooks(h);
    },
  };
}
