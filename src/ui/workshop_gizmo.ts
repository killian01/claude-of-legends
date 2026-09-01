// The workshop's editor-grade manipulation layer (playtest round 9: grip
// placement by sliders alone is too hard): click the weapon, get the
// standard three.js transform gizmo with move arrows and rotate rings,
// plus a fixed corner axes marker to stay oriented. This module owns the
// TransformControls lifecycle, the mode shortcuts (G move, R rotate,
// Escape deselect, Ctrl snaps), and the value clamping that keeps every
// manipulation inside what the server-side sanitizer accepts. The
// workshop wires it to the prop and the sliders. Size has no gizmo mode
// on purpose (playtest: scaling by axis handles felt wrong), the Size
// slider owns it.

import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

export type GizmoMode = 'translate' | 'rotate';

export interface WeaponGizmoOpts {
  camera: THREE.Camera;
  dom: HTMLElement;
  scene: THREE.Scene;
  // The sanitizer's bound: position per axis.
  posLimit: number;
  // Fired after every manipulation, transform already clamped.
  onChange(obj: THREE.Object3D): void;
  // Orbit control must sleep while a handle drags.
  onDragging(active: boolean): void;
  // Toolbar highlight follows the mode wherever it was set from.
  onModeChange(mode: GizmoMode): void;
}

export interface WeaponGizmo {
  attach(obj: THREE.Object3D): void;
  detach(): void;
  attached(): boolean;
  dragging(): boolean;
  setMode(mode: GizmoMode): void;
  // True when the key was consumed (the caller skips its own bindings).
  handleKey(e: KeyboardEvent): boolean;
  dispose(): void;
}

// Angles wrap instead of clamping: +181 degrees must become -179, not
// stick at the fence the way the sanitizer's plain clamp would leave it.
function wrapAngle(v: number): number {
  const twoPi = Math.PI * 2;
  return ((((v + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target;
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLSelectElement ||
    t instanceof HTMLTextAreaElement
  );
}

export function createWeaponGizmo(opts: WeaponGizmoOpts): WeaponGizmo {
  const controls = new TransformControls(opts.camera, opts.dom);
  // World space: the arrows and rings match the corner axes marker, so
  // what the tripod names is what a drag does. The weapon's own axes are
  // trustworthy anyway: its geometry is normalized long-axis-up at load.
  controls.setSpace('world');
  controls.setSize(0.9);
  opts.scene.add(controls.getHelper());

  let target: THREE.Object3D | null = null;

  controls.addEventListener('dragging-changed', (e) => {
    opts.onDragging((e as unknown as { value: boolean }).value === true);
  });

  controls.addEventListener('objectChange', () => {
    if (!target) return;
    const p = target.position;
    p.set(
      Math.min(opts.posLimit, Math.max(-opts.posLimit, p.x)),
      Math.min(opts.posLimit, Math.max(-opts.posLimit, p.y)),
      Math.min(opts.posLimit, Math.max(-opts.posLimit, p.z)),
    );
    const r = target.rotation;
    r.set(wrapAngle(r.x), wrapAngle(r.y), wrapAngle(r.z));
    opts.onChange(target);
  });

  // Held Ctrl snaps, the editor way: 5 degree turns, 0.05 unit slides.
  const setSnaps = (on: boolean): void => {
    controls.setTranslationSnap(on ? 0.05 : null);
    controls.setRotationSnap(on ? (5 * Math.PI) / 180 : null);
  };
  const onSnapKey = (e: KeyboardEvent): void => setSnaps(e.ctrlKey);
  window.addEventListener('keydown', onSnapKey);
  window.addEventListener('keyup', onSnapKey);

  const setMode = (mode: GizmoMode): void => {
    controls.setMode(mode);
    opts.onModeChange(mode);
  };

  return {
    attach(obj) {
      target = obj;
      controls.attach(obj);
    },
    detach() {
      target = null;
      controls.detach();
    },
    attached: () => target !== null,
    dragging: () => controls.dragging,
    setMode,
    handleKey(e) {
      if (isTyping(e)) return false;
      if (e.key === 'Escape' && target !== null) {
        target = null;
        controls.detach();
        return true;
      }
      const mode =
        e.key === 'g' || e.key === 'G'
          ? 'translate'
          : e.key === 'r' || e.key === 'R'
            ? 'rotate'
            : null;
      if (mode === null || target === null) return false;
      setMode(mode);
      return true;
    },
    dispose() {
      window.removeEventListener('keydown', onSnapKey);
      window.removeEventListener('keyup', onSnapKey);
      controls.detach();
      opts.scene.remove(controls.getHelper());
      controls.dispose();
    },
  };
}

// The fixed corner axes marker: a small always-upright X/Y/Z tripod that
// follows only the camera's orientation, so 'which way is X' survives any
// orbit. Rendered as a second scissored pass in the corner of the canvas.
export interface AxesOverlay {
  render(renderer: THREE.WebGLRenderer, mainCamera: THREE.Camera): void;
}

function axisLetter(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, 32, 34);
  }
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }),
  );
  sprite.scale.setScalar(0.55);
  return sprite;
}

export function createAxesOverlay(): AxesOverlay {
  const scene = new THREE.Scene();
  scene.add(new THREE.AxesHelper(0.9));
  const x = axisLetter('X', '#ff6b6b');
  x.position.set(1.25, 0, 0);
  const y = axisLetter('Y', '#7ad97a');
  y.position.set(0, 1.25, 0);
  const z = axisLetter('Z', '#6ba9ff');
  z.position.set(0, 0, 1.25);
  scene.add(x, y, z);
  const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 20);
  const dir = new THREE.Vector3();
  return {
    render(renderer, mainCamera) {
      mainCamera.getWorldDirection(dir);
      cam.position.copy(dir).multiplyScalar(-3.2);
      cam.up.copy((mainCamera as THREE.PerspectiveCamera).up ?? cam.up);
      cam.lookAt(0, 0, 0);
      const size = renderer.getSize(new THREE.Vector2());
      const s = 86;
      const px = size.x - s - 8;
      const py = 8;
      renderer.clearDepth();
      renderer.setScissorTest(true);
      renderer.setScissor(px, py, s, s);
      renderer.setViewport(px, py, s, s);
      renderer.render(scene, cam);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, size.x, size.y);
    },
  };
}
