// Shared presentation boot for both hosts of the one sim: the offline Sim
// and the online ClientWorld. Builds the renderer, HUD, minimap, and input
// against IWorld only, and interpolates rendering between world ticks
// whatever drives them (a local accumulator offline, snapshot arrivals
// online). Also the home of client-side action feedback: deny sounds and
// toasts fire here from mirrored state, before (or instead of) the
// authoritative answer.

import { schoolColorOf } from '../render/ability_vfx';
import { aspectColor } from '../render/aspect_colors';
import { Renderer } from '../render/renderer';
import type { RenderTerrain } from '../render/terrain';
import { effectiveRank, ULT_RANK_LEVELS } from '../sim/stats';
import type { AbilityKey, TeamId, Vec2 } from '../sim/types';
import { DT } from '../sim/types';
import { attackCursor, defaultCursor } from '../ui/cursors';
import { Hud, type NetHooks } from '../ui/hud';
import { Minimap } from '../ui/minimap';
import { buildThumbStickView } from '../ui/thumb_stick_view';
import { buildTouchBar } from '../ui/touch_bar';
import type { IWorld } from '../world_api';
import { castSoundOf } from './champion_sounds';
import { installCursorLock } from './cursor_lock';
import type { PostMatchAction } from './flow';
import { requestGameFullscreen } from './fullscreen';
import { type InputHandlers, setupInput } from './input';
import { startMusic, stopMusic } from './music';
import { nearestEnemy, pickEnemyAt, pickEnemyOnScreen, pickUnitOnScreen } from './picking';
import { getSettings } from './settings';
import { playCastSfx, playSfx, preloadSfx } from './sfx';
import { aimedPoint, quickPoint } from './thumb_cast';
import { leadPoint, STICK_LEAD_M, type StickOrder, shouldResend } from './thumb_stick';
import { setupTouchControls } from './touch';

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
  // The server's rating verdict for this player, shown on the end screen;
  // queue 'forge' labels the number as the Forge queue's own ladder.
  setMatchResult(rated: boolean, delta: number, rating: number, queue?: 'forge', way?: 'bot'): void;
  // The pause menu, where Leave match lives: what the browser's Back does
  // mid-match instead of leaving (src/game/nav.ts). Back again resumes.
  toggleEscapeMenu(): void;
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
  options: {
    terrain: RenderTerrain;
    onRenderer?: (renderer: Renderer) => void;
    fullscreen?: boolean;
  },
): Presentation {
  const renderer = new Renderer(container, world, options.terrain);
  options.onRenderer?.(renderer);
  // The recorded bank decodes while the match loads, so the first swing
  // plays a recording rather than the synthesis.
  preloadSfx();
  renderer.followUnit(selfId);
  renderer.setViewerTeam(selfTeam);
  renderer.domElement.style.cursor = defaultCursor();
  const hud = new Hud(container, world, selfId, selfTeam, onExit);
  // The thumb controls (CONTEXT.md: Thumb stick): a touchscreen playing
  // by the stick, which moves the minimap and the touch bar out of the
  // thumbs' way and hands the HUD's slots to the cast touch.
  const thumbControls =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches &&
    getSettings().touchScheme === 'thumbs';
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
    options.terrain.minimap,
    { corner: thumbControls ? 'top-right' : 'bottom-right' },
  );
  // No edge panning while a modal is up or the cursor sits on the minimap
  // (its corner position would otherwise drag the camera while clicking it).
  renderer.setEdgePanGate(() => !hud.blocksCamera() && !minimap.hovered);

  // Fullscreen backstop: the entry clicks (lock-in, start buttons) usually
  // took the screen already, but a match reached without one (auto-lock,
  // rejoin) grabs it on the first click inside, the earliest gesture a
  // browser accepts a fullscreen request from.
  const onFirstPointerDown = (): void => {
    if (options.fullscreen !== false) requestGameFullscreen();
  };
  container.addEventListener('pointerdown', onFirstPointerDown, { once: true });

  let hooks: NetHooks = {};
  const showPing = (x: number, z: number, from: string, team: TeamId): void => {
    playSfx('ping');
    renderer.flashMarker(x, z, 0xffd94a);
    minimap.addPing(x, z);
    hud.pushChat(from, team, 'pinged the map');
  };

  const project = (x: number, y: number, z: number) => renderer.projectToScreen(x, y, z);
  // A dev probe like the replay viewer's (src/main.ts __replay): the
  // browser e2e scripts read the champion's position off it.
  (window as unknown as { __match?: unknown }).__match = { world, selfId };

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
      if (ab.spec.kind === 'zone' || ab.spec.kind === 'wall') {
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
    // Your own casts sound like THEIR school (or the creator's pick), not
    // the shared whoosh.
    if (ok && ab) playCastSfx(castSoundOf(ab));
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
  const coarsePointer =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  // One handlers object for every input source: mouse and keyboard
  // (setupInput), fingers (setupTouchControls), and the touch bar.
  // The last order the left thumb's stick gave (thumb_stick.ts), for the
  // resend rule; null while the thumb rests.
  let stickOrder: StickOrder | null = null;
  // Where the stick points, for a quick cast with no target in range.
  const stickFacing = (): Vec2 | null => (stickOrder ? { x: stickOrder.x, z: stickOrder.z } : null);
  // Where the right thumb's aim stands while a slot is held (thumb_cast.ts).
  let thumbAim: Vec2 | null = null;
  // How far a sigil reaches (Riftstep's dash), and how far the attack
  // button looks for somebody to hit.
  const SIGIL_REACH = 5.5;
  const ATTACK_REACH = 14;
  const inputHandlers: InputHandlers = {
    onRightClick: (p: Vec2, sx, sy) => {
      pendingCast = null;
      // The genre's cancel: a right-click while aiming drops the cast and
      // the release becomes a no-op; the move or attack order still goes.
      if (aimingKey !== null) {
        aimingKey = null;
        renderer.hideAimPreview();
      }
      const enemy =
        pickEnemyOnScreen(world, selfTeam, sx, sy, project) ?? pickEnemyAt(world, p, selfTeam);
      if (enemy) {
        world.orderAttack(selfId, enemy.id);
        renderer.setAttackTarget(enemy.id);
        hud.setTarget(enemy.id);
      } else {
        // A move order drops the attack reticle but keeps the SELECTION
        // frame, like the genre; left-click on ground clears that. Touch
        // has no left-click, so there a ground tap clears the frame too,
        // or a tapped target would cover the top of the screen forever.
        world.orderMove(selfId, p.x, p.z);
        renderer.setAttackTarget(null);
        renderer.flashMarker(p.x, p.z);
        if (coarsePointer) hud.setTarget(null);
      }
    },
    // The left thumb's stick (thumb_stick.ts): a direction while it
    // steers, null when it rests or lifts. A direction becomes a move
    // order a few meters ahead, resent as the thumb turns and on a
    // keep-alive, so the champion never arrives and stops between two. A
    // rest orders a move to where the champion stands, which halts it
    // without a stop order's hold, so idle defense keeps answering. The
    // stick drops the attack reticle, like a walk order does, and brings
    // the camera back onto the champion after a look at the minimap.
    onThumbMove: (dir) => {
      const self = world.units.get(selfId);
      if (!self) return;
      if (dir === null) {
        if (stickOrder === null) return;
        stickOrder = null;
        world.orderMove(selfId, self.pos.x, self.pos.z);
        return;
      }
      const now = performance.now();
      if (!shouldResend(stickOrder, dir, now)) return;
      stickOrder = { x: dir.x, z: dir.z, at: now };
      const p = leadPoint(self.pos, dir, STICK_LEAD_M, world.map.size);
      world.orderMove(selfId, p.x, p.z);
      renderer.setAttackTarget(null);
      renderer.recenterCamera();
    },
    // The right thumb on a slot (thumb_cast.ts). A slide aims: the preview
    // comes up as for a held key and follows a point along the slide's
    // direction, as far along the range as the slide is long. The press
    // then ends as a quick tap (the nearest enemy in range, else ahead
    // along the stick, else the feet), an aimed cast, or a cancel.
    onThumbAim: (key, dir, k) => {
      const u = world.units.get(selfId);
      const def = u?.championId ? world.championDef(u.championId) : null;
      const ab = def?.abilities[key];
      if (!u || !ab) return;
      if (aimingKey !== key) inputHandlers.onCast(key, { x: 0, z: 0 });
      thumbAim = dir ? aimedPoint(u.pos, dir, k, ab.castRange) : { x: u.pos.x, z: u.pos.z };
      renderer.setAimWorld(thumbAim);
    },
    onThumbCast: (key, press) => {
      const u = world.units.get(selfId);
      const def = u?.championId ? world.championDef(u.championId) : null;
      const ab = def?.abilities[key];
      if (!u || !ab) return;
      if (press === 'tap') {
        if (aimingKey === key) inputHandlers.onAimEnd(key, null);
        const target = nearestEnemy(world, selfTeam, u.pos, ab.castRange);
        tryCast(key, quickPoint(u.pos, target?.pos ?? null, stickFacing(), ab.castRange));
        return;
      }
      const aim = press === 'aimed' ? thumbAim : null;
      thumbAim = null;
      if (aimingKey === key) inputHandlers.onAimEnd(key, aim);
      else if (aim) tryCast(key, aim);
    },
    onThumbSigil: (slot, press, dir, k) => {
      const u = world.units.get(selfId);
      if (!u || press === 'cancel') return;
      const target = press === 'tap' ? nearestEnemy(world, selfTeam, u.pos, SIGIL_REACH) : null;
      const aim =
        press === 'aimed' && dir
          ? aimedPoint(u.pos, dir, k, SIGIL_REACH)
          : quickPoint(u.pos, target?.pos ?? null, stickFacing(), SIGIL_REACH);
      inputHandlers.onCastSigil(slot, aim);
    },
    // The attack button: the nearest enemy in reach, champions first, or
    // an attack-move a step ahead when nobody is.
    onThumbAttack: () => {
      const u = world.units.get(selfId);
      if (!u) return;
      const target = nearestEnemy(world, selfTeam, u.pos, ATTACK_REACH);
      if (target) {
        pendingCast = null;
        world.orderAttack(selfId, target.id);
        renderer.setAttackTarget(target.id);
        hud.setTarget(target.id);
        return;
      }
      const f = stickFacing();
      inputHandlers.onAttackMove(
        f ? { x: u.pos.x + f.x * 3, z: u.pos.z + f.z * 3 } : { x: u.pos.x, z: u.pos.z },
      );
    },
    onLeftClick: (sx, sy) => {
      // MOBA-style selection: any visible unit shows its frame with exact
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
      // A drawn sword over anything attackable, the painted dart otherwise
      // (playtest round 2: the browser crosshair read as a debug build).
      renderer.domElement.style.cursor = enemy ? attackCursor() : defaultCursor();
    },
    onCast: (key, _aim) => {
      // Aim-then-cast: the press only raises the preview; the cast fires on
      // release, at wherever the cursor stands THEN. A quick tap still
      // casts almost instantly; right-click cancels the aim.
      const u = world.units.get(selfId);
      const def = u?.championId ? world.championDef(u.championId) : null;
      const ab = def?.abilities[key];
      if (u && !u.dead && ab) {
        aimingKey = key;
        const spec = ab.spec as {
          radius?: number;
          range?: number;
          halfAngle?: number;
          length?: number;
        };
        renderer.showAimPreview({
          castRange: ab.castRange,
          kind: ab.spec.kind,
          radius: spec.radius,
          range: spec.range,
          halfAngle: spec.halfAngle,
          length: spec.length,
        });
      }
    },
    onAimEnd: (key, aim) => {
      if (aimingKey !== key) return;
      aimingKey = null;
      renderer.hideAimPreview();
      if (aim) tryCast(key, aim);
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
  };
  const teardownInput = setupInput(renderer, inputHandlers);
  // In fullscreen the mouse stays on the game (cursor_lock.ts): a second
  // monitor beside it must not take a click mid-fight.
  const teardownCursorLock = coarsePointer ? () => undefined : installCursorLock(container);

  // Touch: the same handlers behind finger gestures (tap to move or attack,
  // two-step casts armed by tapping HUD slots). The gesture listeners are
  // inert without a touchscreen; the button bar for key-only orders builds
  // on coarse-pointer devices only.
  // A phone's stick is drawn only where there is a thumb to hold it.
  const stickView = coarsePointer ? buildThumbStickView(container) : null;
  const touch = setupTouchControls(renderer, inputHandlers, {
    onArmedChange: (label) => hud.setArmedSlot(label),
    scheme: () => getSettings().touchScheme,
    ...(stickView ? { stick: stickView } : {}),
  });
  hud.setCastTaps({
    ability: (key) => touch.armAbility(key),
    sigil: (slot) => touch.armSigil(slot),
  });
  if (thumbControls) hud.setCastTouch(touch.castTouch);
  const teardownTouchBar = coarsePointer
    ? buildTouchBar(
        container,
        {
          onRecall: () => inputHandlers.onRecall(),
          onToggleShop: () => inputHandlers.onToggleShop(),
          onToggleMenu: () => inputHandlers.onToggleMenu(),
          onRecenterCamera: () => inputHandlers.onRecenterCamera(),
        },
        { side: thumbControls ? 'left' : 'right' },
      )
    : null;

  startMusic();

  let lastTick = performance.now();
  let wardenWasUp = false;
  const ringWasUp = new Map<string, boolean>();
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
    // A ring creature rises: the same ping and flash, in its aspect's color.
    for (const clock of world.ringClocks()) {
      const up = clock.unitId !== null;
      if (up && ringWasUp.get(clock.ring) === false) {
        minimap.addPing(clock.x, clock.z);
        renderer.flashMarker(clock.x, clock.z, aspectColor(clock.aspect, clock.ascendant).hex);
      }
      ringWasUp.set(clock.ring, up);
    }
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
    setMatchResult: (rated, delta, rating, queue, way) =>
      hud.setMatchResult(rated, delta, rating, queue, way),
    toggleEscapeMenu: () => hud.toggleEscapeMenu(),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(rafId);
      container.removeEventListener('pointerdown', onFirstPointerDown);
      window.removeEventListener('blur', onWindowBlur);
      teardownInput();
      teardownCursorLock();
      touch.dispose();
      stickView?.dispose();
      teardownTouchBar?.();
      hud.dispose();
      minimap.dispose();
      renderer.dispose();
      stopMusic();
    },
  };
}
