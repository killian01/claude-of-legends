// Space over the Wanderseed (docs/plan-royale.md step 8): stars all
// around, and a sun hung in the band of sky the top of the screen shows
// above the planet's horizon. The sky rides with the camera, never bent,
// never fogged; the sun keeps its place in the view so it is always in
// that band and never over the play.

import * as THREE from 'three';

const STARS = 2200;
const SKY_R = 420;

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function glowTexture(inner: string, outer: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, inner);
    grad.addColorStop(0.18, inner);
    grad.addColorStop(0.32, outer);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(canvas);
}

function starTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const g = canvas.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.8)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
  }
  return new THREE.CanvasTexture(canvas);
}

export class PlanetSky {
  // A child of the renderer's scene, placed at the camera each frame.
  readonly group = new THREE.Group();
  private readonly stars: THREE.Points;
  private readonly sun: THREE.Sprite;
  private readonly halo: THREE.Sprite;
  private readonly owned: { dispose(): void }[] = [];

  constructor() {
    this.group.userData.unbent = true;
    this.group.userData.chartFixed = true;
    this.group.name = 'planet-sky';
    const rand = seeded(5);
    const positions = new Float32Array(STARS * 3);
    const colors = new Float32Array(STARS * 3);
    for (let i = 0; i < STARS; i++) {
      const z = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - z * z);
      positions[i * 3] = s * Math.cos(a) * SKY_R;
      positions[i * 3 + 1] = z * SKY_R;
      positions[i * 3 + 2] = s * Math.sin(a) * SKY_R;
      // Mostly white, a few warm and a few cold, most of them faint.
      const b = 0.35 + rand() ** 3 * 0.65;
      const tint = rand();
      colors[i * 3] = b * (tint > 0.85 ? 1 : tint < 0.15 ? 0.75 : 0.95);
      colors[i * 3 + 1] = b * 0.92;
      colors[i * 3 + 2] = b * (tint < 0.15 ? 1 : tint > 0.85 ? 0.7 : 0.95);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const starMap = starTexture();
    const starMat = new THREE.PointsMaterial({
      size: 2.6,
      sizeAttenuation: false,
      map: starMap,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.stars = new THREE.Points(geo, starMat);
    this.stars.renderOrder = -10;
    this.stars.frustumCulled = false;
    const sunMap = glowTexture('rgba(255,250,232,1)', 'rgba(255,214,150,0.55)');
    const haloMap = glowTexture('rgba(255,226,170,0.45)', 'rgba(255,170,90,0.12)');
    this.sun = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: sunMap,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    this.sun.scale.setScalar(34);
    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: haloMap,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    this.halo.scale.setScalar(150);
    for (const s of [this.sun, this.halo]) {
      s.renderOrder = -9;
      s.frustumCulled = false;
    }
    this.group.add(this.stars, this.halo, this.sun);
    this.owned.push(geo, starMat, starMap, sunMap, haloMap, this.sun.material, this.halo.material);
  }

  // Rides with the camera (in the scene's mirrored space: world z is the
  // scene's -z about `mirrorZ`), the sun up and to the right of the view.
  follow(camera: THREE.Camera, mirrorZ: number): void {
    const p = camera.position;
    this.group.position.set(p.x, p.y, mirrorZ - p.z);
    const m = camera.matrixWorld.elements;
    const right = new THREE.Vector3(m[0], m[1], m[2]);
    const up = new THREE.Vector3(m[4], m[5], m[6]);
    const back = new THREE.Vector3(m[8], m[9], m[10]);
    // Twenty-one degrees above the view's middle, eighteen to its right.
    const dir = back
      .clone()
      .multiplyScalar(-1)
      .addScaledVector(up, Math.tan((21 * Math.PI) / 180))
      .addScaledVector(right, Math.tan((18 * Math.PI) / 180))
      .normalize();
    // World to the scene's space: z flips.
    this.sun.position.set(dir.x * 380, dir.y * 380, -dir.z * 380);
    this.halo.position.copy(this.sun.position).multiplyScalar(0.99);
  }

  dispose(): void {
    for (const o of this.owned) o.dispose();
  }
}
