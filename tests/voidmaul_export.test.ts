import { readFileSync, statSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import {
  VOIDMAUL_ATTACK_RELEASE_S,
  VOIDMAUL_CLIPS,
  type VoidmaulTemplate,
  VoidmaulVisual,
} from '../src/render/creatures/voidmaul_visual';
import { VOIDMAUL_SPAWN_TIMING } from '../src/render/voidmaul_spawn';

const PATH = process.env.VOIDMAUL_GLB ?? 'public/models/creatures/voidmaul.glb';
const REPORT = PATH.replace(/\.glb$/i, '.export.json');

function glb() {
  const bytes = readFileSync(PATH);
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString());
  return { bytes, json, length };
}

// Keep the shipped skin and samples. Strip only browser image loading so
// the real glTF loader and mixer can verify the export in plain Node.
async function readModel() {
  const { bytes, json, length } = glb();
  delete json.images;
  delete json.textures;
  delete json.materials;
  for (const mesh of json.meshes) {
    for (const primitive of mesh.primitives) delete primitive.material;
  }
  const raw = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 0x20);
  raw.copy(padded);
  const tail = bytes.subarray(20 + length);
  const out = Buffer.alloc(20 + padded.length + tail.length);
  bytes.subarray(0, 20).copy(out);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(padded.length, 12);
  padded.copy(out, 20);
  tail.copy(out, 20 + padded.length);
  return new GLTFLoader().parseAsync(
    out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength),
    '',
  );
}

function poses(scene: THREE.Object3D): Map<string, THREE.Matrix4> {
  scene.updateMatrixWorld(true);
  const result = new Map<string, THREE.Matrix4>();
  scene.traverse((node) => {
    if ((node as THREE.Bone).isBone) result.set(node.name, node.matrixWorld.clone());
  });
  return result;
}

function startClip(model: { scene: THREE.Group; animations: THREE.AnimationClip[] }, name: string) {
  const mixer = new THREE.AnimationMixer(model.scene);
  const clip = model.animations.find((c) => c.name === name)!;
  const start = Math.min(...clip.tracks.map((track) => track.times[0]!));
  const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const rig = model.scene.getObjectByName('Voidmaul_ExportRig')!;
  return {
    duration: clip.duration - start,
    rig,
    sample(seconds: number): THREE.Matrix4 {
      // LoopOnce pauses on its endpoint; restart before every absolute
      // seek so a later sample never falls back to frame zero.
      action.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
      mixer.setTime(start + seconds);
      model.scene.updateMatrixWorld(true);
      return rig.matrixWorld.clone().invert();
    },
  };
}

function proximalShoulderPatch(scene: THREE.Object3D, inverse: THREE.Matrix4, side = 'R') {
  const vertices: { mesh: THREE.SkinnedMesh; index: number; rest: THREE.Vector3 }[] = [];
  const identifiers = new Map<string, number>();
  const upperRight = new Set<number>();
  const edgeIds = new Set<string>();
  let centre: THREE.Vector3 | null = null;
  scene.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    if (!centre) {
      const shoulderName = side === 'R' ? 'bone_10' : 'tripo::0_Left_Limb_0';
      const joint = mesh.skeleton.bones.findIndex(
        (bone) => bone.name === THREE.PropertyBinding.sanitizeNodeName(shoulderName),
      );
      if (joint >= 0) {
        centre = new THREE.Vector3()
          .setFromMatrixPosition(mesh.skeleton.boneInverses[joint]!.clone().invert())
          .applyMatrix4(inverse);
      }
    }
    const positions = mesh.geometry.getAttribute('position');
    const ids: number[] = [];
    for (let index = 0; index < positions.count; index++) {
      const rest = new THREE.Vector3()
        .fromBufferAttribute(positions, index)
        .applyMatrix4(mesh.matrixWorld)
        .applyMatrix4(inverse);
      const key = rest
        .toArray()
        .map((value) => Math.round(value * 1e6))
        .join(',');
      let id = identifiers.get(key);
      if (id === undefined) {
        id = vertices.length;
        identifiers.set(key, id);
        vertices.push({ mesh, index, rest });
      }
      ids.push(id);
      if (mesh.name.includes(`ForeUpper${side}`)) upperRight.add(id);
    }
    const index = mesh.geometry.index;
    const count = index?.count ?? positions.count;
    for (let i = 0; i < count; i += 3) {
      const triangle = [0, 1, 2].map((j) => ids[index ? index.getX(i + j) : i + j]!);
      for (const [a, b] of [
        [0, 1],
        [1, 2],
        [2, 0],
      ]) {
        const x = triangle[a!]!;
        const y = triangle[b!]!;
        edgeIds.add(`${Math.min(x, y)},${Math.max(x, y)}`);
      }
    }
  });
  if (!centre) throw new Error('Missing shoulder bind joint');
  const patch = new Set(
    [...upperRight].filter((id) => vertices[id]!.rest.distanceTo(centre!) < 0.16),
  );
  const edges = [...edgeIds]
    .map((key) => key.split(',').map(Number) as [number, number])
    .filter(([a, b]) => patch.has(a) && patch.has(b))
    .map(([a, b]) => ({ a, b, rest: vertices[a]!.rest.distanceTo(vertices[b]!.rest) }))
    .filter((edge) => edge.rest > 1e-7);
  return { vertices, patch, edges };
}

function bodyHeight(scene: THREE.Object3D, inverse: THREE.Matrix4) {
  let bodyY = 0;
  let bodyCount = 0;
  let lo = Infinity;
  let hi = -Infinity;
  scene.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const points = mesh.geometry.getAttribute('position');
    const position = new THREE.Vector3();
    for (let i = 0; i < points.count; i++) {
      mesh.getVertexPosition(i, position);
      position.applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
      lo = Math.min(lo, position.y);
      hi = Math.max(hi, position.y);
      if (mesh.name.startsWith('Voidmaul_Body')) {
        bodyY += position.y;
        bodyCount++;
      }
    }
  });
  return { bodyY: bodyY / bodyCount, height: hi - lo, minimumY: lo };
}

function footHeight(scene: THREE.Object3D, inverse: THREE.Matrix4, region: string) {
  let minimum = Infinity;
  const position = new THREE.Vector3();
  scene.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.name.includes(region)) return;
    const count = mesh.geometry.getAttribute('position').count;
    for (let i = 0; i < count; i++) {
      mesh.getVertexPosition(i, position);
      position.applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
      minimum = Math.min(minimum, position.y);
    }
  });
  if (!Number.isFinite(minimum)) throw new Error(`Missing foot surface: ${region}`);
  return minimum;
}

describe('shipped Voidmaul export', () => {
  it('ships the complete clip set, skinned segments, UVs and embedded texture', () => {
    const { json } = glb();
    const report = JSON.parse(readFileSync(REPORT, 'utf8'));
    expect(json.animations.map((clip: { name: string }) => clip.name).sort()).toEqual(
      [...VOIDMAUL_CLIPS].sort(),
    );
    expect(json.meshes.length).toBeGreaterThanOrEqual(14);
    expect(json.skins.length).toBeGreaterThanOrEqual(1);
    expect(json.skins[0].joints.length).toBeGreaterThanOrEqual(18);
    expect(json.images.length).toBeGreaterThan(0);
    for (const image of json.images) expect(image.bufferView).toBeDefined();
    for (const mesh of json.meshes) {
      for (const primitive of mesh.primitives) {
        expect(primitive.attributes.TEXCOORD_0, mesh.name).toBeDefined();
        expect(primitive.attributes.JOINTS_0, mesh.name).toBeDefined();
        expect(primitive.attributes.WEIGHTS_0, mesh.name).toBeDefined();
      }
    }
    expect(report.attack_release_s).toBeCloseTo(VOIDMAUL_ATTACK_RELEASE_S, 5);
    expect(report.spawn_beats_s).toEqual({
      rupture: VOIDMAUL_SPAWN_TIMING.rupture,
      landing: VOIDMAUL_SPAWN_TIMING.fullEmergence,
      stomp: VOIDMAUL_SPAWN_TIMING.stomp,
    });
    expect(report.spawn_ground_occlusion_until_s).toBeCloseTo(
      VOIDMAUL_SPAWN_TIMING.fullEmergence,
      5,
    );
    expect(report.size_bytes).toBe(statSync(PATH).size);
  });

  it('closes the idle and walk without a skeleton pose jump', async () => {
    const model = await readModel();
    const mixer = new THREE.AnimationMixer(model.scene);
    for (const name of ['Idle', 'Walk']) {
      mixer.stopAllAction();
      const clip = model.animations.find((c) => c.name === name)!;
      const start = Math.min(...clip.tracks.map((track) => track.times[0]!));
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      mixer.setTime(start);
      const initial = poses(model.scene);
      mixer.setTime(clip.duration);
      const final = poses(model.scene);
      let worst = 0;
      for (const [bone, matrix] of initial) {
        const end = final.get(bone)!;
        for (let i = 0; i < 16; i++) {
          worst = Math.max(worst, Math.abs(matrix.elements[i]! - end.elements[i]!));
        }
      }
      expect(worst, `${name} loop seam`).toBeLessThan(0.0001);
    }
  });

  it('plays the baked attack at contact and gives the rig back to its walk', async () => {
    const model = await readModel();
    const clips = new Map(
      model.animations.map((clip) => {
        const start = Math.min(...clip.tracks.map((track) => track.times[0]!));
        const shifted = new THREE.AnimationClip(
          clip.name,
          -1,
          clip.tracks.map((track) => track.clone().shift(-start)),
        );
        return [clip.name, shifted];
      }),
    );
    const template: VoidmaulTemplate = { scene: model.scene, clips };
    const visual = new VoidmaulVisual(template, null, 1.1);
    visual.playAttack(0.5);
    for (let i = 0; i < 50; i++) visual.update(10, { moving: false, speed: 0 });
    const actions = (visual as unknown as { actions: Map<string, THREE.AnimationAction> }).actions;
    expect(actions.get('Attack')!.time).toBeCloseTo(VOIDMAUL_ATTACK_RELEASE_S, 5);
    const atContact = poses(visual.root);
    expect(atContact.size).toBeGreaterThanOrEqual(18);
    for (const matrix of atContact.values())
      expect(matrix.elements.every(Number.isFinite)).toBe(true);
    for (let i = 0; i < 120; i++) visual.update(10, { moving: true, speed: 2.8 });
    expect(actions.get('Attack')!.getEffectiveWeight()).toBeLessThan(0.01);
    expect(actions.get('Walk')!.getEffectiveWeight()).toBeGreaterThan(0.99);
    visual.dispose();
  });

  it('preserves the Blender joint positions after baking controls and IK', async () => {
    const model = await readModel();
    const report = JSON.parse(readFileSync(REPORT, 'utf8'));
    const rig = model.scene.getObjectByName('Voidmaul_ExportRig');
    expect(rig).toBeDefined();
    const mixer = new THREE.AnimationMixer(model.scene);
    const gaps: { clip: string; seconds: number; bone: string; metres: number }[] = [];
    for (const sample of report.native_skeletal_pose_samples) {
      mixer.stopAllAction();
      const clip = model.animations.find((c) => c.name === sample.clip)!;
      const start = Math.min(...clip.tracks.map((track) => track.times[0]!));
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      mixer.setTime(start + sample.seconds);
      model.scene.updateMatrixWorld(true);
      const inverse = rig!.matrixWorld.clone().invert();
      for (const [name, rows] of Object.entries(sample.bone_matrices_gltf_armature)) {
        const bone = model.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
        expect(bone, name).toBeDefined();
        const matrix = rows as number[][];
        const expected = new THREE.Vector3(matrix[0]![3], matrix[1]![3], matrix[2]![3]);
        const actual = bone!.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse);
        gaps.push({
          clip: sample.clip,
          seconds: sample.seconds,
          bone: name,
          metres: expected.distanceTo(actual),
        });
      }
    }
    gaps.sort((a, b) => b.metres - a.metres);
    expect(gaps.length).toBeGreaterThan(100);
    // glTF interpolates baked TRS samples; the source uses Blender's IK
    // and splines. Allow three millimetres on this one-metre source model.
    expect(gaps[0]!.metres, JSON.stringify(gaps.slice(0, 5))).toBeLessThan(0.003);
  });

  it.each([
    ['Attack', 'R'],
    ['AttackCrush', 'R'],
    ['AttackCrush', 'L'],
  ])('preserves the %s %s shoulder through the raised and contact poses', async (clip, side) => {
    const model = await readModel();
    const playback = startClip(model, clip);
    const initialInverse = playback.sample(0);
    const shoulder = model.scene.getObjectByName(
      THREE.PropertyBinding.sanitizeNodeName(side === 'R' ? 'bone_10' : 'tripo::0_Left_Limb_0'),
    )!;
    const initialRotation = shoulder.quaternion.clone();
    const { vertices, patch, edges } = proximalShoulderPatch(model.scene, initialInverse, side);
    expect(patch.size).toBeGreaterThan(200);
    expect(edges.length).toBeGreaterThan(500);
    let maximumRotation = 0;
    let worstP05 = 1;
    let maximumCrushedFraction = 0;
    const deformed = new Map<number, THREE.Vector3>();
    // Quarter-frame sampling catches the original transient pole flip,
    // including the compressed shoulder before the held top pose.
    for (let frame = 0; frame <= 76 * 4; frame++) {
      const inverse = playback.sample(frame / (24 * 4));
      maximumRotation = Math.max(maximumRotation, initialRotation.angleTo(shoulder.quaternion));
      for (const id of patch) {
        const vertex = vertices[id]!;
        const position = deformed.get(id) ?? new THREE.Vector3();
        vertex.mesh.getVertexPosition(vertex.index, position);
        position.applyMatrix4(vertex.mesh.matrixWorld).applyMatrix4(inverse);
        deformed.set(id, position);
      }
      const ratios = edges
        .map(({ a, b, rest }) => deformed.get(a)!.distanceTo(deformed.get(b)!) / rest)
        .sort((a, b) => a - b);
      worstP05 = Math.min(worstP05, ratios[Math.floor(ratios.length * 0.05)]!);
      maximumCrushedFraction = Math.max(
        maximumCrushedFraction,
        ratios.filter((ratio) => ratio < 0.5).length / ratios.length,
      );
    }
    const diagnostics = JSON.stringify({ maximumRotation, worstP05, maximumCrushedFraction });
    expect(maximumRotation, diagnostics).toBeLessThan(THREE.MathUtils.degToRad(100));
    expect(worstP05, diagnostics).toBeGreaterThan(0.65);
    expect(maximumCrushedFraction, diagnostics).toBeLessThan(0.1);
  });

  it('rears on its hindfeet and lands both forepaws together in the distinct crush clip', async () => {
    const model = await readModel();
    const playback = startClip(model, 'AttackCrush');
    const initialInverse = playback.sample(0);
    const initial = poses(model.scene);
    const rest = bodyHeight(model.scene, initialInverse);
    const raisedInverse = playback.sample(1.2);
    const raised = bodyHeight(model.scene, raisedInverse);
    for (const side of ['L', 'R']) {
      expect(footHeight(model.scene, raisedInverse, `ForeFoot${side}`)).toBeGreaterThan(
        rest.height * 0.15,
      );
      expect(footHeight(model.scene, raisedInverse, `HindFoot${side}`)).toBeLessThan(0.003);
    }
    expect(raised.bodyY - rest.bodyY).toBeGreaterThan(rest.height * 0.05);
    const contactInverse = playback.sample(VOIDMAUL_ATTACK_RELEASE_S);
    for (const side of ['L', 'R']) {
      expect(footHeight(model.scene, contactInverse, `ForeFoot${side}`)).toBeLessThan(0.004);
    }
    for (let frame = 0; frame <= 76 * 4; frame++) {
      const inverse = playback.sample(frame / 96);
      for (const side of ['L', 'R']) {
        const height = footHeight(model.scene, inverse, `HindFoot${side}`);
        expect(height).toBeGreaterThan(-0.001);
        expect(height).toBeLessThan(0.003);
      }
    }
    playback.sample(playback.duration);
    const final = poses(model.scene);
    let worst = 0;
    for (const [name, matrix] of initial) {
      for (let i = 0; i < 16; i++) {
        worst = Math.max(worst, Math.abs(matrix.elements[i]! - final.get(name)!.elements[i]!));
      }
    }
    expect(worst).toBeLessThan(0.0001);
  });

  it('buckles its forelegs before the hips and finishes as a low corpse without a rigid side roll', async () => {
    const model = await readModel();
    const playback = startClip(model, 'Death');
    const global = model.scene.getObjectByName('CTRL_Global')!;
    const body = model.scene.getObjectByName('CTRL_Body')!;
    const foreNames = [
      'bone_10',
      'tripo::1_Left_Limb_0',
      'tripo::0_Left_Limb_0',
      'tripo::0_Left_Limb_1',
    ];
    const hindNames = ['tripo::0_Right_Limb_0', 'tripo::0_Right_Limb_1', 'tripo::1_Right_Limb_0'];
    const rotations = (names: string[]) =>
      names.map((name) =>
        model.scene
          .getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name))!
          .quaternion.clone(),
      );
    const initialInverse = playback.sample(0);
    const initialGlobal = global.quaternion.clone();
    const initialBody = body.quaternion.clone();
    const initialHeight = bodyHeight(model.scene, initialInverse);
    playback.sample(0.25);
    const foreEarly = rotations(foreNames);
    const hindEarly = rotations(hindNames);
    playback.sample(0.75);
    const foreLater = rotations(foreNames);
    const hindLater = rotations(hindNames);
    const foreChange = Math.max(...foreEarly.map((q, i) => q.angleTo(foreLater[i]!)));
    const hindChange = Math.max(...hindEarly.map((q, i) => q.angleTo(hindLater[i]!)));
    playback.sample(1.25);
    const foreAfterDrop = rotations(foreNames);
    const foreRelaxation = Math.max(...foreLater.map((q, i) => q.angleTo(foreAfterDrop[i]!)));
    let maximumGlobalRotation = 0;
    let maximumBodyRotation = 0;
    for (let frame = 0; frame <= 77 * 4; frame++) {
      playback.sample(frame / (24 * 4));
      maximumGlobalRotation = Math.max(
        maximumGlobalRotation,
        initialGlobal.angleTo(global.quaternion),
      );
      maximumBodyRotation = Math.max(maximumBodyRotation, initialBody.angleTo(body.quaternion));
    }
    const final = bodyHeight(model.scene, playback.sample(playback.duration));
    const diagnostics = JSON.stringify({
      foreChange,
      foreRelaxation,
      hindChange,
      maximumGlobalRotation,
      maximumBodyRotation,
      initialHeight,
      final,
    });
    expect(foreChange, diagnostics).toBeGreaterThan(THREE.MathUtils.degToRad(15));
    expect(foreChange, diagnostics).toBeGreaterThan(hindChange);
    expect(foreRelaxation, diagnostics).toBeGreaterThan(THREE.MathUtils.degToRad(10));
    expect(maximumGlobalRotation, diagnostics).toBeLessThan(THREE.MathUtils.degToRad(20));
    expect(maximumBodyRotation, diagnostics).toBeLessThan(THREE.MathUtils.degToRad(20));
    expect(final.bodyY, diagnostics).toBeLessThan(initialHeight.bodyY * 0.8);
    expect(final.height, diagnostics).toBeLessThan(initialHeight.height * 0.85);
    expect(final.minimumY, diagnostics).toBeGreaterThan(-0.001);
  });

  it('emerges before the climax, stomps a raised forepaw and articulates its crest during the bellow', async () => {
    const model = await readModel();
    const playback = startClip(model, 'Spawn');
    const height = bodyHeight(model.scene, playback.sample(playback.duration)).height;
    let postEmergenceMinimumY = bodyHeight(
      model.scene,
      playback.sample(VOIDMAUL_SPAWN_TIMING.fullEmergence),
    ).minimumY;
    const raisedFootY = footHeight(model.scene, playback.sample(2.16), 'ForeFootR');
    const stompFootY = footHeight(
      model.scene,
      playback.sample(VOIDMAUL_SPAWN_TIMING.stomp),
      'ForeFootR',
    );
    // The 24 fps glTF samples interpolate the 2.30 s strike. It must be
    // almost grounded on that beat and fully planted within one frame.
    const plantedFootY = footHeight(model.scene, playback.sample(2.34), 'ForeFootR');
    playback.sample(VOIDMAUL_SPAWN_TIMING.stomp);
    const crest = [1, 2, 3, 4].map(
      (i) =>
        model.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(`tripo::Spine_${i}`))!,
    );
    const initial = crest.map((bone) => bone.quaternion.clone());
    let maximumCrestArticulation = 0;
    // Local joint changes catch a distributed crest bellow; tipping one
    // global control while the whole creature stays rigid cannot pass.
    for (
      let frame = Math.ceil(VOIDMAUL_SPAWN_TIMING.fullEmergence * 96);
      frame <= 96 * 4;
      frame++
    ) {
      const time = frame / 96;
      const inverse = playback.sample(time);
      postEmergenceMinimumY = Math.min(
        postEmergenceMinimumY,
        bodyHeight(model.scene, inverse).minimumY,
      );
      if (time >= VOIDMAUL_SPAWN_TIMING.stomp) {
        maximumCrestArticulation = Math.max(
          maximumCrestArticulation,
          ...crest.map((bone, i) => initial[i]!.angleTo(bone.quaternion)),
        );
      }
    }
    const diagnostics = JSON.stringify({
      height,
      postEmergenceMinimumY,
      raisedFootY,
      stompFootY,
      plantedFootY,
      maximumCrestArticulation,
    });
    expect(postEmergenceMinimumY, diagnostics).toBeGreaterThan(-height * 0.001);
    expect(raisedFootY, diagnostics).toBeGreaterThan(height * 0.1);
    expect(stompFootY, diagnostics).toBeLessThan(height * 0.006);
    expect(plantedFootY, diagnostics).toBeLessThan(height * 0.002);
    expect(maximumCrestArticulation, diagnostics).toBeGreaterThan(THREE.MathUtils.degToRad(3));
  });
});
