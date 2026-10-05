// The second scar and paired pressure bursts of the two-paw Crush impact.
// The parent fracture effect owns and disposes every cloned resource here.
import * as THREE from 'three';

export class VoidmaulCrushPawFx {
  readonly root = new THREE.Group();
  readonly groundMeshes: THREE.Mesh<THREE.BufferGeometry>[];
  private readonly rightCrater: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly rightCracks: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly waves: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[] = [];

  constructor(
    leftCrater: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>,
    leftCracks: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>,
    centralWave: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>,
    spread: number,
    spreadForward: number,
  ) {
    this.root.name = 'Voidmaul_CrushPawImpacts';
    this.root.userData.pawSpread = spread;
    this.root.userData.pawSpreadForward = spreadForward;
    this.rightCrater = new THREE.Mesh(
      leftCrater.geometry.clone().translate(spread * 2, 0, spreadForward * 2),
      leftCrater.material.clone(),
    );
    this.rightCrater.name = 'Voidmaul_CrushCrater_Right';
    this.rightCrater.position.y = leftCrater.position.y;
    this.rightCrater.renderOrder = leftCrater.renderOrder;
    this.rightCracks = new THREE.Mesh(
      leftCracks.geometry.clone().translate(spread * 2, 0, spreadForward * 2),
      leftCracks.material.clone(),
    );
    this.rightCracks.name = 'Voidmaul_CrushCracks_Right';
    this.rightCracks.position.y = leftCracks.position.y;
    this.rightCracks.renderOrder = leftCracks.renderOrder;
    for (const [side, name] of [
      [-1, 'Left'],
      [1, 'Right'],
    ] as const) {
      const wave = new THREE.Mesh(
        centralWave.geometry
          .clone()
          .scale(0.42, 1, 0.42)
          .translate(spread * side, 0, spreadForward * side),
        centralWave.material.clone(),
      );
      wave.name = `Voidmaul_CrushPawBurst_${name}`;
      wave.position.y = 0.04;
      wave.renderOrder = centralWave.renderOrder;
      this.waves.push(wave);
    }
    this.groundMeshes = [this.rightCrater, this.rightCracks, ...this.waves];
    this.root.add(...this.groundMeshes);
  }

  update(age: number, imprint: number): void {
    this.rightCrater.material.uniforms.uAge!.value = age;
    this.rightCrater.material.uniforms.uFade!.value = imprint;
    this.rightCracks.material.opacity = imprint * 0.89;
    for (const wave of this.waves) {
      // The local paw bursts grow rapidly; the central disk carries damage reach.
      const t = Math.min(1, Math.max(0, (age - 0.12) / 0.36));
      wave.visible = age < 0.48;
      wave.material.uniforms.uAge!.value = age * 1.45;
      wave.material.uniforms.uFade!.value = (1 - t * t * (3 - 2 * t)) * 1.45;
    }
  }
}
