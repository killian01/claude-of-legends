// Touch controls: the phone's route to the same InputHandlers the mouse and
// keyboard feed (input.ts skips touch pointers entirely and leaves them
// here). One finger taps to move or attack, the right-click semantics, and
// drags to pan the camera; two fingers pinch to zoom. Casting is two-step:
// the HUD arms a slot through armAbility/armSigil (the aim preview comes
// up), then a tap fires the cast at the tapped ground point, and a drag
// aims before the release fires at the finger. Tapping the armed slot again
// cancels. Gesture classification lives in TouchGestures, a pure state
// machine with no DOM, so tests can drive it event by event.

import type { Renderer } from '../render/renderer';
import type { AbilityKey } from '../sim/types';
import type { InputHandlers } from './input';

export const TAP_SLOP_PX = 14;

export type GestureAction =
  | { kind: 'tap'; x: number; y: number }
  | { kind: 'pan'; fromX: number; fromY: number; toX: number; toY: number }
  | { kind: 'aim'; x: number; y: number }
  | { kind: 'pinch'; factor: number };

// The label the HUD highlights while a two-step cast is armed.
export type ArmedLabel = AbilityKey | 'D' | 'F';

export class TouchGestures {
  private readonly points = new Map<number, { x: number; y: number }>();
  private tap: { id: number; x: number; y: number } | null = null;
  private dragging = false;
  private pinchDist = 0;
  private armed = false;

  // While armed, a drag aims instead of panning and its release casts.
  setArmed(armed: boolean): void {
    this.armed = armed;
  }

  down(id: number, x: number, y: number): GestureAction | null {
    this.points.set(id, { x, y });
    if (this.points.size === 1) {
      this.tap = { id, x, y };
      this.dragging = false;
    } else {
      // A second finger ends any tap or pan in progress and starts a pinch.
      this.tap = null;
      this.dragging = false;
      this.pinchDist = this.spread();
    }
    return null;
  }

  move(id: number, x: number, y: number): GestureAction | null {
    const p = this.points.get(id);
    if (!p) return null;
    const fromX = p.x;
    const fromY = p.y;
    p.x = x;
    p.y = y;
    if (this.points.size >= 2) {
      const d = this.spread();
      const action: GestureAction | null =
        this.pinchDist > 0 && d > 0 ? { kind: 'pinch', factor: d / this.pinchDist } : null;
      this.pinchDist = d;
      return action;
    }
    if (this.tap && this.tap.id === id && !this.dragging) {
      // Fingers wobble: nothing is a drag until it clears the tap slop.
      if (Math.hypot(x - this.tap.x, y - this.tap.y) < TAP_SLOP_PX) return null;
      this.dragging = true;
    }
    if (!this.dragging) return null;
    return this.armed ? { kind: 'aim', x, y } : { kind: 'pan', fromX, fromY, toX: x, toY: y };
  }

  up(id: number, x: number, y: number): GestureAction | null {
    this.points.delete(id);
    const t = this.tap;
    if (!t || t.id !== id) return null;
    this.tap = null;
    if (this.dragging) {
      this.dragging = false;
      // Releasing an armed aim drag fires the cast at the finger.
      return this.armed ? { kind: 'tap', x, y } : null;
    }
    // No time cap: press-and-release without moving is an order however
    // long the press, like holding right-click in the genre. Only movement
    // past the slop turns the touch into a drag.
    return { kind: 'tap', x, y };
  }

  cancel(id: number): void {
    this.points.delete(id);
    if (this.tap?.id === id) {
      this.tap = null;
      this.dragging = false;
    }
  }

  private spread(): number {
    const [a, b] = [...this.points.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}

export interface TouchControls {
  armAbility(key: AbilityKey): void;
  armSigil(slot: number): void;
  dispose(): void;
}

export interface TouchControlsOptions {
  onArmedChange?(label: ArmedLabel | null): void;
}

// Wires TouchGestures to the canvas. The listeners are inert without a
// touchscreen: every handler returns immediately for mouse and pen pointers.
export function setupTouchControls(
  renderer: Renderer,
  handlers: InputHandlers,
  opts: TouchControlsOptions = {},
): TouchControls {
  const el = renderer.domElement;
  const gestures = new TouchGestures();
  let armedAbility: AbilityKey | null = null;
  let armedSigil: number | null = null;

  const clearArmed = (): void => {
    armedAbility = null;
    armedSigil = null;
    gestures.setArmed(false);
    renderer.clearPointerHint();
    opts.onArmedChange?.(null);
  };

  const cancelAim = (): void => {
    if (armedAbility !== null) handlers.onAimEnd(armedAbility, null);
    clearArmed();
  };

  const onTap = (x: number, y: number): void => {
    const p = renderer.groundPointAt(x, y);
    if (!p) return;
    if (armedAbility !== null) {
      const key = armedAbility;
      clearArmed();
      handlers.onAimEnd(key, p);
    } else if (armedSigil !== null) {
      const slot = armedSigil;
      clearArmed();
      handlers.onCastSigil(slot, p);
    } else {
      handlers.onRightClick(p, x, y);
    }
  };

  const dispatch = (action: GestureAction | null): void => {
    if (!action) return;
    if (action.kind === 'tap') {
      onTap(action.x, action.y);
    } else if (action.kind === 'pan') {
      // Ground-anchored pan: the world point under the finger stays under
      // the finger, whatever the zoom or camera angle.
      const from = renderer.groundPointAt(action.fromX, action.fromY);
      const to = renderer.groundPointAt(action.toX, action.toY);
      if (from && to) renderer.panBy(from.x - to.x, from.z - to.z);
    } else if (action.kind === 'aim') {
      renderer.setPointerHint(action.x, action.y);
    } else {
      renderer.scaleZoom(action.factor);
    }
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    dispatch(gestures.down(e.pointerId, e.clientX, e.clientY));
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    dispatch(gestures.move(e.pointerId, e.clientX, e.clientY));
  };
  const onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    dispatch(gestures.up(e.pointerId, e.clientX, e.clientY));
  };
  const onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    gestures.cancel(e.pointerId);
  };
  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerCancel);

  return {
    armAbility: (key: AbilityKey): void => {
      if (armedAbility === key) {
        cancelAim();
        return;
      }
      if (armedAbility !== null) handlers.onAimEnd(armedAbility, null);
      armedSigil = null;
      armedAbility = key;
      // The press only raises the aim preview; boot ignores the aim point.
      handlers.onCast(key, { x: 0, z: 0 });
      gestures.setArmed(true);
      opts.onArmedChange?.(key);
    },
    armSigil: (slot: number): void => {
      if (armedSigil === slot) {
        clearArmed();
        return;
      }
      if (armedAbility !== null) handlers.onAimEnd(armedAbility, null);
      armedAbility = null;
      armedSigil = slot;
      gestures.setArmed(true);
      opts.onArmedChange?.(slot === 0 ? 'D' : 'F');
    },
    dispose: (): void => {
      cancelAim();
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
    },
  };
}
