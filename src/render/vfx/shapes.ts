// The mesh helpers every spell visual is built from: flat ground shapes,
// the additive-or-not basic material, and the delayed-zone telegraph (a
// dark contrast band under a hard rim, a faint fill, and a sweep disc the
// fuse grows). Shared because two builders now draw spells: the authored
// catalog (catalog.ts, code) and the look interpreter (looks.ts, data),
// and both must produce the same vocabulary of ground marks.

import * as THREE from 'three';

export function basicMat(
  color: number,
  opacity: number,
  additive = false,
): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  mat.toneMapped = false;
  return mat;
}

export function flatRing(
  rIn: number,
  rOut: number,
  color: number,
  opacity: number,
  y: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(rIn, rOut, 48), basicMat(color, opacity));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  return mesh;
}

export function flatDisc(r: number, color: number, opacity: number, y: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(r, 40), basicMat(color, opacity));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  return mesh;
}

// A warning telegraph for delayed zones: a dark contrast band under a hard
// colored rim (readable even on the glowing river), a faint fill, and a
// sweep disc the zoneTick grows with the fuse (the area must be readable
// the instant it appears; the sweep says how long is left).
export function telegraphZone(radius: number, rimColor: number, sweepColor: number): THREE.Group {
  const holder = new THREE.Group();
  holder.add(flatRing(radius - 0.52, radius + 0.14, 0x0a0a0a, 0.55, 0.09));
  const rim = flatRing(radius - 0.34, radius, rimColor, 0.95, 0.1);
  holder.add(rim);
  holder.add(flatDisc(radius, rimColor, 0.14, 0.08));
  const sweep = flatDisc(radius, sweepColor, 0.34, 0.11);
  sweep.scale.setScalar(0.01);
  holder.add(sweep);
  holder.userData.rim = rim;
  holder.userData.sweep = sweep;
  return holder;
}

export function pulseRim(holder: THREE.Object3D, ageMs: number, urgency: number): void {
  const rim = holder.userData.rim as THREE.Mesh | undefined;
  if (!rim) return;
  const mat = rim.material as THREE.MeshBasicMaterial;
  // Never dip low: the pulse is a heartbeat, not a fade (readability rule).
  mat.opacity = 0.82 + 0.18 * Math.sin(ageMs * (0.008 + urgency * 0.02));
}

export function growSweep(holder: THREE.Object3D, progress: number): void {
  const sweep = holder.userData.sweep as THREE.Mesh | undefined;
  sweep?.scale.setScalar(Math.max(0.01, Math.min(1, progress)));
}
