// Shared presentation boot for both hosts of the one sim: the offline Sim
// and the online ClientWorld. Builds the renderer, HUD, minimap, and input
// against IWorld only, and interpolates rendering between world ticks
// whatever drives them (a local accumulator offline, snapshot arrivals
// online). Also the home of client-side action feedback: deny sounds and
// toasts fire here from mirrored state, before (or instead of) the
// authoritative answer.

import type { PointsReason } from '../net/protocol';
import { schoolColorOf } from '../render/ability_vfx';
import { aspectColor } from '../render/aspect_colors';
import { Renderer } from '../render/renderer';
import type { RenderTerrain } from '../render/terrain';
import { effectiveRank } from '../sim/stats';
import type { AbilityKey, TeamId, Vec2 } from '../sim/types';
import { DT } from '../sim/types';
import type { Unit } from '../sim/unit';
import { attackCursor, defaultCursor } from '../ui/cursors';
import { Hud, type NetHooks } from '../ui/hud';
import { LaneArrow, laneArrowHalf } from '../ui/lane_arrow';
import {
  ARROW_HEAD_M,
  arrowPlace,
  arrowWanted,
  clearOfCard,
  type GuideMode,
  leadToward,
  onScreen,
} from '../ui/lane_guide';
import { Minimap } from '../ui/minimap';
import { slotTap } from '../ui/slot_tap';
import { buildThumbStickView } from '../ui/thumb_stick_view';
import { buildTouchBar } from '../ui/touch_bar';
import { unlearnedLine } from '../ui/unlearned_line';
import type { IWorld } from '../world_api';
import { castSoundOf } from './champion_sounds';
import { installCursorLock } from './cursor_lock';
import type { PostMatchAction } from './flow';
import { requestGameFullscreen } from './fullscreen';
import { type InputHandlers, setupInput } from './input';
import { buildMatchStage, stageSizeOf } from './match_stage';
import { moveRingWanted } from './move_ring';
import { startMusic, stopMusic } from './music';
import { lockLandscape, unlockOrientation } from './orientation';
import { nearestEnemy, pickEnemyAt, pickEnemyOnScreen, pickUnitOnScreen } from './picking';
import type { MatchCover } from './practice_clock';
import { getSettings, updateSettings } from './settings';
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
  // Points this player's seat banked on the ladder (ADR 0027): the total
  // beside the K/D/A and a pop with the reason.
  showPoints(delta: number, total: number, reason: PointsReason): void;
  // The pause menu, where Leave match lives: what the browser's Back does
  // mid-match instead of leaving (src/game/nav.ts). Back again resumes.
  toggleEscapeMenu(): void;
  // What stands over the match right now (the turn wall, the pause menu,
  // the opening shop), for the practice clock (game/practice_clock.ts). A
  // match against the server never asks.
  covers(): MatchCover;
  // The box the match is built in (game/match_stage.ts), turned with it on
  // a phone held upright: a host's own bar over the match (the replay's,
  // the coach's) goes in here so it turns too.
  readonly stage: HTMLElement;
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
    // No account behind this match: the end screen makes the account offer
    // (ui/account_offer.ts).
    guest?: boolean;
    // Which mode this match runs in, for the feedback box's context
    // (ui/feedback_box.ts). Practice unless the host says otherwise.
    mode?: 'practice' | 'online';
    // Who is in front of the screen, for the lane guidance (ui/lane_guide.ts;
    // ADR 0026): a person on the seat (the card, the minimap's lane, the
    // arrow), a coach whose bot plays it (the card and the lane, no walk,
    // no arrow), or a replay viewer (none of it).
    guide?: GuideMode;
  },
): Presentation {
  const guide = options.guide ?? 'play';
  // Set by dispose(): an answer from the browser that comes after it is
  // for a match that is gone.
  let disposed = false;
  const coarsePointer =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  // The match's stage (game/match_stage.ts): everything below is built in
  // it rather than in the page, so a phone held upright that the browser
  // will not turn gets all of it turned a quarter (game/rotated_view.ts).
  const stage = buildMatchStage(container, { coarsePointer });
  const renderer = new Renderer(stage.el, world, options.terrain);
  options.onRenderer?.(renderer);
  // The recorded bank decodes while the match loads, so the first swing
  // plays a recording rather than the synthesis.
  preloadSfx();
  renderer.followUnit(selfId);
  renderer.setViewerTeam(selfTeam);
  renderer.domElement.style.cursor = defaultCursor();
  const hud = new Hud(
    stage.el,
    world,
    selfId,
    selfTeam,
    onExit,
    options.guest === true,
    options.mode ?? 'practice',
    guide,
  );
  // The thumb controls (CONTEXT.md: Thumb stick): a touchscreen playing
  // by the stick, which moves the minimap and the touch bar out of the
  // thumbs' way and hands the HUD's slots to the cast touch.
  const thumbControls = coarsePointer && getSettings().touchScheme === 'thumbs';
  const minimap = new Minimap(
    stage.el,
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

  // The phone turns itself for the match (game/orientation.ts): the lock
  // is granted to a fullscreen document, so it is asked for right after
  // the screen is taken, and again on the backstop below. A browser that
  // refuses (iOS has no lock) gets the stage turned inside the page
  // instead, or the HUD's line asking for a turn when the player chose it.
  const askLandscape = (): void => {
    void lockLandscape().then((locked) => {
      if (disposed) return;
      stage.setLandscapeLocked(locked);
      hud.setLandscapeLocked(locked);
    });
  };
  askLandscape();

  // Fullscreen backstop: the entry clicks (lock-in, start buttons) usually
  // took the screen already, but a match reached without one (auto-lock,
  // rejoin) grabs it on the first click inside, the earliest gesture a
  // browser accepts a fullscreen request from.
  const onFirstPointerDown = (): void => {
    if (options.fullscreen !== false) void requestGameFullscreen().then(askLandscape);
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
  // browser e2e scripts read the champion's position off it, and whether
  // the stage is turned.
  (window as unknown as { __match?: unknown }).__match = { world, selfId, renderer, stage };

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

  // Why a spell with no rank did nothing: the deny sound and the line
  // (ui/unlearned_line.ts), in the words of the hands on the screen.
  const sayUnlearned = (u: Readonly<Unit>, key: AbilityKey, name: string): void => {
    playSfx('deny');
    hud.toast(unlearnedLine(name, key, u.level, coarsePointer, u.skillPoints));
  };
  // The level-up command, whoever asks for it (Alt+key, a tap on a spell
  // not learned yet): the one the slot's + sends, recorded and replayed
  // like any command, with a sound that says whether it took.
  const learnAbility = (key: AbilityKey): void => {
    if (world.levelAbility(selfId, key)) playSfx('buy');
    else playSfx('deny');
  };
  // A spell not learned yet, pressed on its slot (a finger in either touch
  // scheme, or a click): learned while a skill point waits for it, refused
  // with the line otherwise (ui/slot_tap.ts). True when the press went to
  // the spell's rank, so it arms and casts nothing.
  const pressUnlearned = (key: AbilityKey): boolean => {
    const u = world.units.get(selfId);
    const def = u?.championId ? world.championDef(u.championId) : null;
    const ab = def?.abilities[key];
    if (!u || !ab) return false;
    const tap = slotTap(u, key);
    if (tap === 'cast') return false;
    if (tap === 'learn') learnAbility(key);
    else sayUnlearned(u, key, ab.name);
    return true;
  };

  // Client-side cast gate: the sim (or server) still decides, but the player
  // hears and reads WHY nothing happened instead of pressing a dead key.
  const tryCast = (key: AbilityKey, aim: Vec2): void => {
    pendingCast = null;
    const u = world.units.get(selfId);
    const def = u?.championId ? world.championDef(u.championId) : null;
    const ab = def?.abilities[key];
    if (u && ab) {
      if (effectiveRank(u, key) <= 0) {
        sayUnlearned(u, key, ab.name);
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
  // The click that orders: an attack on the enemy under the cursor, else a
  // walk to the ground point. The right click's, and the left click's too
  // unless the player turned that off (onLeftClick below).
  const clickOrder = (p: Vec2, sx: number, sy: number): void => {
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
  };
  const inputHandlers: InputHandlers = {
    onRightClick: (p: Vec2, sx, sy) => clickOrder(p, sx, sy),
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
      // A spell not learned yet has nothing to aim: its press is spent on
      // the rank when it ends (onThumbCast).
      if (slotTap(u, key) !== 'cast') return;
      if (aimingKey !== key) inputHandlers.onCast(key, { x: 0, z: 0 });
      thumbAim = dir ? aimedPoint(u.pos, dir, k, ab.castRange) : { x: u.pos.x, z: u.pos.z };
      renderer.setAimWorld(thumbAim);
    },
    onThumbCast: (key, press) => {
      const u = world.units.get(selfId);
      const def = u?.championId ? world.championDef(u.championId) : null;
      const ab = def?.abilities[key];
      if (!u || !ab) return;
      if (press !== 'cancel' && pressUnlearned(key)) return;
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
      // And, unless the player turned it off, the right click's order too
      // (settings.ts leftClickMoves): a trackpad clicks left. Never while a
      // cast is being aimed, whose release is what casts it.
      if (aimingKey !== null || !getSettings().leftClickMoves) return;
      const p = renderer.groundPointAt(sx, sy);
      if (p) clickOrder(p, sx, sy);
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
    onLevelAbility: (key) => learnAbility(key),
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
  // A phone's stick is drawn only where there is a thumb to hold it, on
  // the match's stage (turned for an upright iPhone, match_stage.ts). A
  // newcomer's first matches with it show the Move ring too, counted on
  // this device (game/move_ring.ts).
  const shownIn = getSettings().moveRingMatches;
  const moveRing = moveRingWanted(thumbControls, guide === 'play', shownIn);
  if (moveRing) updateSettings({ moveRingMatches: shownIn + 1 });
  const stickView = coarsePointer ? buildThumbStickView(stage.el, { moveRing }) : null;
  const touch = setupTouchControls(renderer, inputHandlers, {
    onArmedChange: (label) => hud.setArmedSlot(label),
    scheme: () => getSettings().touchScheme,
    ...(stickView ? { stick: stickView } : {}),
  });
  hud.setCastTaps({
    // A spell not learned yet is learned (or refused) by its tap rather
    // than armed for a cast the sim would refuse.
    ability: (key) => {
      if (!pressUnlearned(key)) touch.armAbility(key);
    },
    sigil: (slot) => touch.armSigil(slot),
  });
  // A mouse casts by the keys; its click on a slot answers only for a
  // spell not learned yet, the way a finger's tap does.
  hud.setSlotClick((key) => {
    pressUnlearned(key);
  });
  // The lane card's walk: one move order, the way a right-click on the
  // ground gives it, recorded and budgeted like any other.
  hud.setLaneWalk((p) => {
    pendingCast = null;
    world.orderMove(selfId, p.x, p.z);
    renderer.setAttackTarget(null);
    renderer.flashMarker(p.x, p.z);
  });
  // The arrow toward the lane, for a person on the seat only.
  const laneArrow = guide === 'play' ? new LaneArrow(stage.el) : null;
  const arrowHalf = laneArrowHalf();
  if (thumbControls) hud.setCastTouch(touch.castTouch);
  const teardownTouchBar = coarsePointer
    ? buildTouchBar(
        stage.el,
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
  // The champion's last two positions, for the arrow to ride between ticks
  // as the renderer's model does.
  let selfPrev: Vec2 | null = null;
  let selfCurr: Vec2 | null = null;
  const onWorldTick = (notes?: WorldNotes): void => {
    lastTick = performance.now();
    const me = world.units.get(selfId);
    selfPrev = selfCurr;
    selfCurr = me ? { x: me.pos.x, z: me.pos.z } : null;
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
    minimap.setLaneGuide(hud.laneGuide());
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

  // The arrow each frame: from the champion (between its last two ticks)
  // toward the lane's target, hidden once the player is there, while the
  // target stands in view close by, and under a modal.
  const ARROW_LIFT = 0.3;
  const placeArrow = (alpha: number): void => {
    if (!laneArrow) return;
    const lane = hud.laneGuide();
    const me = world.units.get(selfId);
    const from = selfPrev ?? selfCurr;
    const self =
      me && !me.dead && from && selfCurr
        ? {
            x: from.x + (selfCurr.x - from.x) * alpha,
            z: from.z + (selfCurr.z - from.z) * alpha,
          }
        : null;
    const target = lane?.target ?? null;
    // Nothing projected once it has nothing to show (the common case).
    if (
      !self ||
      !target ||
      world.winner !== null ||
      hud.blocksCamera() ||
      !arrowWanted(guide, lane, self, false)
    ) {
      laneArrow.place(null);
      return;
    }
    const shown = renderer.projectToScreen(target.x, ARROW_LIFT, target.z);
    const view = stageSizeOf(stage.el);
    const lead = arrowWanted(guide, lane, self, onScreen(shown, view))
      ? leadToward(self, target)
      : null;
    const feet = lead ? renderer.projectToScreen(self.x, ARROW_LIFT, self.z) : null;
    const top = renderer.overheadTop(selfId) ?? ARROW_HEAD_M;
    const head = feet ? renderer.projectToScreen(self.x, top, self.z) : null;
    const ahead = lead && head ? renderer.projectToScreen(lead.x, ARROW_LIFT, lead.z) : null;
    const at = feet && head && ahead ? arrowPlace(feet, head, ahead) : null;
    laneArrow.place(at ? clearOfCard(at, hud.laneCardRect(), arrowHalf) : null);
  };

  let rafId = 0;
  function frame(now: number): void {
    if (disposed) return;
    const alpha = Math.max(0, Math.min(1, (now - lastTick) / TICK_MS));
    renderer.render(alpha);
    placeArrow(alpha);
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
    showPoints: (delta, total, reason) => hud.showPoints(delta, total, reason),
    toggleEscapeMenu: () => hud.toggleEscapeMenu(),
    covers: () => hud.covers(),
    stage: stage.el,
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
      laneArrow?.dispose();
      minimap.dispose();
      renderer.dispose();
      stage.dispose();
      stopMusic();
      // The screen turns with the phone again once the match is over.
      unlockOrientation();
    },
  };
}
