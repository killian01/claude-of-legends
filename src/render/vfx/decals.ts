// Pooled ground decals: scorch marks, frost sheets, and crack webs painted
// procedurally to small canvases at boot. Normal (not additive) blending so
// a scorch can actually darken the ground. Fade in fast, hold, burn away.

import * as THREE from 'three';

const POOL = 12;
const TEX = 128;

export type DecalKind = 'scorch' | 'frost' | 'cracks';

const textures = new Map<DecalKind, THREE.CanvasTexture>();

function paintScorch(g: CanvasRenderingContext2D): void {
  const c = TEX / 2;
  const grad = g.createRadialGradient(c, c, 4, c, c, c - 4);
  grad.addColorStop(0, 'rgba(0,0,0,0.72)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.5)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, TEX, TEX);
  // Ragged edge: punch soft holes around the rim.
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.4;
    const r = c * (0.72 + 0.2 * Math.sin(i * 3.7));
    const hole = g.createRadialGradient(
      c + Math.cos(a) * r,
      c + Math.sin(a) * r,
      1,
      c + Math.cos(a) * r,
      c + Math.sin(a) * r,
      TEX * 0.14,
    );
    hole.addColorStop(0, 'rgba(0,0,0,0.8)');
    hole.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = hole;
    g.fillRect(0, 0, TEX, TEX);
  }
  g.globalCompositeOperation = 'source-over';
}

function paintFrost(g: CanvasRenderingContext2D): void {
  const c = TEX / 2;
  const grad = g.createRadialGradient(c, c, 4, c, c, c - 4);
  grad.addColorStop(0, 'rgba(255,255,255,0.5)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.3)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, TEX, TEX);
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.beginPath();
    g.moveTo(c, c);
    g.lineTo(c + Math.cos(a) * c * 0.8, c + Math.sin(a) * c * 0.8);
    g.stroke();
  }
}

function paintCracks(g: CanvasRenderingContext2D): void {
  const c = TEX / 2;
  const grad = g.createRadialGradient(c, c, 2, c, c, c - 4);
  grad.addColorStop(0, 'rgba(0,0,0,0.6)');
  grad.addColorStop(0.4, 'rgba(0,0,0,0.22)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, TEX, TEX);
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + Math.sin(i * 5.1) * 0.5;
    g.lineWidth = 3.5;
    g.beginPath();
    g.moveTo(c, c);
    let x = c;
    let y = c;
    let ang = a;
    for (let seg = 0; seg < 4; seg++) {
      const step = c * (0.16 + 0.07 * Math.sin(i + seg * 2.3));
      ang += Math.sin(i * 7.7 + seg * 3.1) * 0.55;
      x += Math.cos(ang) * step;
      y += Math.sin(ang) * step;
      g.lineTo(x, y);
      g.lineWidth *= 0.7;
    }
    g.stroke();
  }
}

function decalTexture(kind: DecalKind): THREE.CanvasTexture {
  const cached = textures.get(kind);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = TEX;
  canvas.height = TEX;
  const g = canvas.getContext('2d');
  if (g) {
    if (kind === 'scorch') paintScorch(g);
    else if (kind === 'frost') paintFrost(g);
    else paintCracks(g);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  textures.set(kind, tex);
  return tex;
}

interface DecalSlot {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  bornAt: number;
  duration: number;
  peak: number;
  active: boolean;
}

export class GroundDecals {
  private readonly slots: DecalSlot[] = [];
  private readonly geometry = new THREE.CircleGeometry(1, 24);

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: decalTexture('scorch'),
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      mat.toneMapped = false;
      const mesh = new THREE.Mesh(this.geometry, mat);
      mesh.userData.sharedGeo = true;
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.04 + i * 0.002;
      mesh.renderOrder = 3;
      mesh.visible = false;
      scene.add(mesh);
      this.slots.push({ mesh, mat, bornAt: 0, duration: 1, peak: 1, active: false });
    }
  }

  spawn(
    x: number,
    z: number,
    radius: number,
    kind: DecalKind,
    durationMs: number,
    opts?: { color?: number; alpha?: number },
  ): void {
    let slot = this.slots.find((s) => !s.active);
    if (!slot) slot = this.slots.reduce((a, b) => (a.bornAt <= b.bornAt ? a : b));
    slot.active = true;
    slot.bornAt = performance.now();
    slot.duration = durationMs;
    slot.peak = opts?.alpha ?? 0.9;
    slot.mesh.visible = true;
    slot.mesh.position.x = x;
    slot.mesh.position.z = z;
    slot.mesh.rotation.z = Math.random() * Math.PI * 2;
    slot.mesh.scale.setScalar(Math.max(0.1, radius));
    slot.mat.map = decalTexture(kind);
    slot.mat.color.set(opts?.color ?? 0xffffff);
  }

  update(now: number): void {
    for (const s of this.slots) {
      if (!s.active) continue;
      const t = (now - s.bornAt) / s.duration;
      if (t >= 1) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      // Etch in fast (a fixed 260 ms), then burn away over the tail.
      const inK = Math.min(1, (now - s.bornAt) / 260);
      const outK = t > 0.55 ? 1 - (t - 0.55) / 0.45 : 1;
      s.mat.opacity = s.peak * inK * outK * outK;
    }
  }
}
