// Shared presentation boot for both hosts of the one sim: the offline Sim
// and the online ClientWorld. Builds the renderer, HUD, minimap, and input
// against IWorld only, and interpolates rendering between world ticks
// whatever drives them (a local accumulator offline, snapshot arrivals
// online). Also the home of client-side action feedback: deny sounds and
// toasts fire here from mirrored state, before (or instead of) the
// authoritative answer.

import { schoolColorOf, schoolTagOf } from '../render/ability_vfx';
import { Renderer } from '../render/renderer';
import { effectiveRank, ULT_RANK_LEVELS } from '../sim/stats';
import type { AbilityKey, TeamId, Vec2 } from '../sim/types';
import { DT } from '../sim/types';
import { Hud, type NetHooks } from '../ui/hud';
import { Minimap } from '../ui/minimap';
import type { IWorld } from '../world_api';
import type { PostMatchAction } from './flow';
import { setupInput } from './input';
import { startMusic, stopMusic } from './music';
import { pickEnemyAt, pickEnemyOnScreen, pickUnitOnScreen } from './picking';
import { playCastSfx, playSfx } from './sfx';

export interface KillNote {
  unitId: number;
  killerId: number;
}

// A visible cast: the key is present for abilities (per-spell visuals) and
// absent for sigil casts.
export interface CastNote {
  unitId: number;
  key?: AbilityKey;
}

// One-shot combat notes accompanying a world tick.
export interface WorldNotes {
  kills: readonly KillNote[];
  golds: readonly number[];
  casts: readonly CastNote[];
  // Damage the player dealt this tick, for personal combat numbers.
  hits: readonly { targetId: number; amount: number }[];
  // Auto-attacks fired by visible units, for swing animations.
  attacks: readonly { unitId: number; targetId: number }[];
}

export interface Presentation {
  // Call once after every world tick (sim tick offline, snapshot online).
  onWorldTick(notes?: WorldNotes): void;
  pushChat(from: string, team: TeamId, text: string): void;
  showPing(x: number, z: number, from: string, team: TeamId): void;
  setNetHooks(hooks: NetHooks): void;
  // Same-page teardown: render loop, input, HUD, minimap, GL, music. The
  // menu returns on the same document; nothing may keep running behind it.
  dispose(): void;
}

const TICK_MS = DT * 1000;
const HOVER_CHECK_MS = 40;

export function startPresentation(
  container: HTMLElement,
  world: IWorld,
  selfId: number,
  selfTeam: TeamId,
  onExit: (action: PostMatchAction) => void,
): Presentation {
  const renderer = new Renderer(container, world);
  renderer.followUnit(selfId);
  renderer.setViewerTeam(selfTeam);
  const hud = new Hud(container, world, selfId, selfTeam, onExit);
  const minimap = new Minimap(
    container,
    world,
    selfTeam,
    selfId,
    (p) => {
      world.orderMove(selfId, p.x, p.z);
      renderer.flashMarker(p.x, p.z);
    },
    (p) => renderer.lookAtPoint(p.x, p.z),
  );
  // No edge panning while a modal is up or the cursor sits on the minimap
  // (its corner position would otherwise drag the camera while clicking it).
  renderer.setEdgePanGate(() => !hud.blocksCamera() && !minimap.hovered);

  let hooks: NetHooks = {};
  const showPing = (x: number, z: number, from: string, team: TeamId): void => {
    playSfx('ping');
    renderer.flashMarker(x, z, 0xffd94a);
    minimap.addPing(x, z);
    hud.pushChat(from, team, 'pinged the map');
  };

  const project = (x: number, y: number, z: number) => renderer.projectToScreen(x, y, z);

  // A ground-placed cast aimed beyond range walks into range first, then
  // fires at the EXACT aimed point, like the genre without quickcast. Any
  // other order cancels it. Client-side only: the sim contract (and the
  // bots) keep the instant clamped cast.
  let pendingCast: { key: AbilityKey; aim: Vec2 } | null = null;
  // The ability key currently held for aiming (range preview visible).
  let aimingKey: AbilityKey | null = null;
  const onWindowBlur = (): void => {
    aimingKey = null;
    renderer.hideAimPreview();
  };
  window.addEventListener('blur', onWindowBlur);

  // Client-side cast gate: the sim (or server) still decides, but the player
  // hears and reads WHY nothing happened instead of pressing a dead key.
  const tryCast = (key: AbilityKey, aim: Vec2): void => {
    pendingCast = null;
    const u = world.units.get(selfId);
    const def = u?.championId ? world.championDef(u.championId) : null;
    const ab = def?.abilities[key];
    if (u && ab) {
      if (effectiveRank(u, key) <= 0) {
        playSfx('deny');
        hud.toast(
          key === 'R' && u.level < ULT_RANK_LEVELS[0]!
            ? `${ab.name} unlocks at level ${ULT_RANK_LEVELS[0]}.`
            : `${ab.name} needs a skill point: Alt+${key} or click the +.`,
        );
        return;
      }
      if ((u.cooldowns[key] ?? 0) > world.time) {
        playSfx('deny');
        return;
      }
      if (u.mana < ab.manaCost) {
        playSfx('deny');
        hud.toast(`Not enough mana: ${ab.name} costs ${ab.manaCost}.`);
        hud.flashMana();
        return;
      }
      if (ab.spec.kind === 'zone') {
        const d = Math.hypot(u.pos.x - aim.x, u.pos.z - aim.z);
        if (d > ab.castRange) {
          pendingCast = { key, aim: { x: aim.x, z: aim.z } };
          world.orderMove(selfId, aim.x, aim.z);
          renderer.flashMarker(aim.x, aim.z, 0x6ac9e8);
          return;
        }
      }
    }
    const ok = world.castAbility(selfId, key, aim);
    // The sim can still refuse (decision budget, stun): that denial must be
    // audible, never a silently dead key.
    if (!ok) playSfx('deny');
    // Your own casts sound like THEIR school, not the shared whoosh.
    if (ok && ab) playCastSfx(schoolTagOf(ab.spec));
    // Instant abilities spawn no projectile or zone: flash their shape in
    // the ability's school color so the cast visibly happened.
    if (
      ok &&
      u &&
      ab &&
      ['cone', 'burst', 'dash', 'enemy_target', 'self_or_ally'].includes(ab.spec.kind)
    ) {
      const spec = ab.spec as { radius?: number; range?: number; halfAngle?: number };
      renderer.spawnCastFx(
        {
          castRange: ab.castRange,
          kind: ab.spec.kind,
          radius: spec.radius,
          range: spec.range,
          halfAngle: spec.halfAngle,
        },
        schoolColorOf(ab.spec).main,
        { x: u.pos.x, z: u.pos.z },
        aim,
      );
    }
  };

  // Fires the queued ground cast the moment the champion is in range.
  const stepPendingCast = (): void => {
    if (!pendingCast) return;
    const u = world.units.get(selfId);
    const def = u?.championId ? world.championDef(u.championId) : null;
    const ab = def?.abilities[pendingCast.key];
    if (!u || u.dead || !ab) {
      pendingCast = null;
      return;
    }
    const d = Math.hypot(u.pos.x - pendingCast.aim.x, u.pos.z - pendingCast.aim.z);
    if (d <= ab.castRange * 0.98) {
      const queued = pendingCast;
      pendingCast = null;
      tryCast(queued.key, queued.aim);
      // Stop like the genre does: the walk was for the cast, not a move.
      const me = world.units.get(selfId);
      if (me) world.orderMove(selfId, me.pos.x, me.pos.z);
    }
  };

  let lastHoverAt = 0;
  const teardownInput = setupInput(renderer, {
    onRightClick: (p: Vec2, sx, sy) => {
      pendingCast = null;
      const enemy =
        pickEnemyOnScreen(world, selfTeam, sx, sy, project) ?? pickEnemyAt(world, p, selfTeam);
      if (enemy) {
        world.orderAttack(selfId, enemy.id);
        renderer.setAttackTarget(enemy.id);
        hud.setTarget(enemy.id);
      } else {
        // A move order drops the attack reticle but keeps the SELECTION
        // frame, like the genre; left-click on ground clears that.
        world.orderMove(selfId, p.x, p.z);
        renderer.setAttackTarget(null);
        renderer.flashMarker(p.x, p.z);
      }
    },
    onLeftClick: (sx, sy) => {
      // LoL-style selection: any visible unit shows its frame with exact
      // health; clicking empty ground clears it (an attack order still
      // repopulates it).
      const unit = pickUnitOnScreen(world, selfTeam, sx, sy, project);
      hud.setTarget(unit?.id ?? null);
    },
    onHover: (sx, sy) => {
      const now = performance.now();
      if (now - lastHoverAt < HOVER_CHECK_MS) return;
      lastHoverAt = now;
      const enemy = pickEnemyOnScreen(world, selfTeam, sx, sy, project);
      renderer.setHoverTarget(enemy?.id ?? null);
      renderer.domElement.style.cursor = enemy ? 'crosshair' : 'default';
    },
    onCast: (key, aim) => {
      // Quickcast with indicator: fire NOW, keep the range preview up while
      // the key stays held (it helps the follow-up cast).
      const u = world.units.get(selfId);
      const def = u?.championId ? world.championDef(u.championId) : null;
      const ab = def?.abilities[key];
      if (u && !u.dead && ab) {
        aimingKey = key;
        const spec = ab.spec as { radius?: number; range?: number; halfAngle?: number };
        renderer.showAimPreview({
          castRange: ab.castRange,
          kind: ab.spec.kind,
          radius: spec.radius,
          range: spec.range,
          halfAngle: spec.halfAngle,
        });
      }
      tryCast(key, aim);
    },
    onAimEnd: (key) => {
      if (aimingKey !== key) return;
      aimingKey = null;
      renderer.hideAimPreview();
    },
    onLevelAbility: (key) => {
      if (world.levelAbility(selfId, key)) playSfx('buy');
      else playSfx('deny');
    },
    onCastSigil: (slot, aim) => {
      pendingCast = null;
      const u = world.units.get(selfId);
      if (u && (u.sigilCooldowns[slot] ?? 0) > world.time) {
        playSfx('deny');
        return;
      }
      world.castSigil(selfId, slot, aim);
    },
    onAttackMove: (aim) => {
      pendingCast = null;
      world.orderAttackMove(selfId, aim.x, aim.z);
      renderer.flashMarker(aim.x, aim.z, 0xffa53e);
    },
    onRecall: () => {
      pendingCast = null;
      world.startRecall(selfId);
    },
    onStop: () => {
      pendingCast = null;
      world.orderStop(selfId);
      renderer.setAttackTarget(null);
    },
    onRecenterCamera: () => renderer.recenterCamera(),
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

  startMusic();

  let lastTick = performance.now();
  let wardenWasUp = false;
  const onWorldTick = (notes?: WorldNotes): void => {
    lastTick = performance.now();
    stepPendingCast();
    // Warden spawn: ping its pit on the minimap and flash the ground so
    // nobody misses it (the HUD adds the announcement and the voice).
    const wardenUp = world.objectiveSpawnAt() === null;
    if (wardenUp && !wardenWasUp) {
      const warden = [...world.units.values()].find((u) => u.kind === 'warden');
      if (warden) {
        minimap.addPing(warden.pos.x, warden.pos.z);
        renderer.flashMarker(warden.pos.x, warden.pos.z, 0xb06ae8);
      }
    }
    wardenWasUp = wardenUp;
    renderer.onSimTick();
    hud.update();
    minimap.update();
    if (notes) {
      if (notes.kills.length > 0) hud.pushKills(notes.kills);
      if (
        notes.golds.length > 0 ||
        notes.casts.length > 0 ||
        notes.hits.length > 0 ||
        notes.attacks.length > 0
      )
        renderer.onCombatNotes(notes);
    }
    if (world.winner !== null) stopMusic();
  };

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
    onWorldTick,
    pushChat: (from, team, text) => hud.pushChat(from, team, text),
    showPing,
    setNetHooks: (h) => {
      hooks = h;
      hud.setNetHooks(h);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener('blur', onWindowBlur);
      teardownInput();
      hud.dispose();
      minimap.dispose();
      renderer.dispose();
      stopMusic();
    },
  };
}
