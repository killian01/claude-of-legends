// Render the shipped Voidmaul and all six clips in a local Three.js scene.
// Requires a Vite dev server (CLIENT defaults to http://127.0.0.1:5173).
// Uses a separate headless browser; screenshots and JSON go to .tmp/voidmaul-smoke.
// VOIDMAUL_GLB and VOIDMAUL_OUTPUT select a preserved baseline and its output.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const output = process.env.VOIDMAUL_OUTPUT ?? '.tmp/voidmaul-smoke';
const origin = process.env.CLIENT ?? 'http://127.0.0.1:5173';
const source = process.env.VOIDMAUL_GLB ?? 'public/models/creatures/voidmaul.glb';
const modelBytes = await readFile(source);
const metadataBytes = await readFile(source.replace(/\.glb$/i, '.export.json'));
const metadata = JSON.parse(metadataBytes.toString());
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  timeout: 60000,
  protocolTimeout: 60000,
  args: [
    '--no-sandbox',
    '--window-size=1280,960',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
process.once('SIGINT', async () => {
  await browser.close();
  process.exit(130);
});
const report = {
  source,
  sha256: createHash('sha256').update(modelBytes).digest('hex'),
  clips: {},
  timelines: {},
  errors: [],
};
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 960, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(message.text());
  });
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.url() === `${origin}/models/creatures/voidmaul.glb`) {
      void request.respond({ status: 200, contentType: 'model/gltf-binary', body: modelBytes });
    } else if (request.url() === `${origin}/models/creatures/voidmaul.export.json`) {
      void request.respond({ status: 200, contentType: 'application/json', body: metadataBytes });
    } else if (request.url() === `${origin}/__voidmaul_smoke`) {
      void request.respond({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#161628"><script type="module">
import * as THREE from '/node_modules/three/build/three.module.js';
import {preloadVoidmaul, createVoidmaulVisual} from '/src/render/creatures/voidmaul_visual.ts';
await preloadVoidmaul();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x161628);
const camera = new THREE.PerspectiveCamera(38, 1280 / 960, 0.1, 100);
camera.position.set(11, 7, 12);
camera.lookAt(0, 3, 0);
const renderer = new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setSize(1280, 960);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
document.body.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xd8e5ff, 0x302742, 1.8));
const sun = new THREE.DirectionalLight(0xfff2e7, 2.6);
sun.position.set(7, 13, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, {left:-9,right:9,top:9,bottom:-9,near:0.1,far:40});
sun.shadow.bias = -0.0005;
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40,40),
  new THREE.MeshLambertMaterial({color:0x363449}));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.001;
ground.receiveShadow = true;
scene.add(ground);
let visual;
const input = {moving:false, speed:0};
function reset(age = null) {
  if (visual) {scene.remove(visual.root); visual.dispose();}
  visual = createVoidmaulVisual(age, 1.1);
  if (!visual) throw new Error('Voidmaul failed to load');
  visual.root.scale.setScalar(1.1);
  scene.add(visual.root);
  renderer.render(scene, camera);
}
function step(ms, moving = false, speed = 0) {
  const tick = {moving, speed};
  for (let t = 0; t < ms; t += 10) visual.update(Math.min(10,ms-t), tick);
  renderer.render(scene, camera);
}
reset();
window.voidmaulSmoke = {THREE,scene,camera,renderer,reset,step,get visual(){return visual;}};
</script></body></html>`,
      });
    } else {
      void request.continue();
    }
  });
  await page.goto(`${origin}/__voidmaul_smoke`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction(() => window.voidmaulSmoke, { timeout: 60000 });

  report.asset = await page.evaluate(() => {
    const { visual } = window.voidmaulSmoke;
    const textures = [];
    let meshes = 0;
    let maxBones = 0;
    visual.root.traverse((node) => {
      if (!node.isMesh) return;
      meshes++;
      maxBones = Math.max(maxBones, node.skeleton?.bones.length ?? 0);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (material.map) textures.push([material.map.image.width, material.map.image.height]);
      }
    });
    return { meshes, maxBones, textures, clips: [...visual.actions.keys()] };
  });
  assert.deepEqual(report.asset.clips.sort(), ['Attack', 'Death', 'Hurt', 'Idle', 'Spawn', 'Walk']);
  assert.ok(report.asset.meshes >= 14, JSON.stringify(report.asset));
  assert.ok(report.asset.maxBones > 15, JSON.stringify(report.asset));
  assert.ok(report.asset.textures.length > 0, 'The shipped material must load its texture');

  report.exportComparison = await page.evaluate(async () => {
    const s = window.voidmaulSmoke;
    const { THREE } = s;
    const metadata = await fetch('/models/creatures/voidmaul.export.json').then((r) => r.json());
    const rig = s.visual.root.getObjectByName('Voidmaul_ExportRig');
    if (!rig) throw new Error('Missing export rig');
    s.visual.root.updateMatrixWorld(true);
    const groups = new Map();
    const point = new THREE.Vector3();
    const initialInverse = rig.matrixWorld.clone().invert();
    s.visual.root.traverse((mesh) => {
      if (!mesh.isSkinnedMesh) return;
      const positions = mesh.geometry.getAttribute('position');
      for (let index = 0; index < positions.count; index++) {
        point.fromBufferAttribute(positions, index);
        point.applyMatrix4(mesh.matrixWorld).applyMatrix4(initialInverse);
        const key = point
          .toArray()
          .map((value) => Math.round(value * 1e6))
          .join(',');
        const group = groups.get(key) ?? [];
        group.push({ mesh, index });
        groups.set(key, group);
      }
    });
    const seams = [...groups.values()].filter(
      (group) => new Set(group.map((ref) => ref.mesh.uuid)).size > 1,
    );
    let maxJointGapMetres = 0;
    let maxSeamGapMetres = 0;
    let jointsChecked = 0;
    let worstJoint = null;
    const other = new THREE.Vector3();
    for (const sample of metadata.native_skeletal_pose_samples) {
      const mixer = s.visual.mixer;
      mixer.stopAllAction();
      const action = s.visual.actions.get(sample.clip);
      action.reset().setLoop(THREE.LoopOnce, 1).setEffectiveTimeScale(1).setEffectiveWeight(1);
      action.clampWhenFinished = true;
      action.play();
      mixer.setTime(sample.seconds);
      s.visual.root.updateMatrixWorld(true);
      const inverse = rig.matrixWorld.clone().invert();
      for (const [name, rows] of Object.entries(sample.bone_matrices_gltf_armature)) {
        const bone = s.visual.root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
        if (!bone) throw new Error(`Missing ${name}`);
        const expected = new THREE.Vector3(rows[0][3], rows[1][3], rows[2][3]);
        const actual = bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse);
        const gap = actual.distanceTo(expected);
        jointsChecked++;
        if (gap > maxJointGapMetres) {
          maxJointGapMetres = gap;
          worstJoint = { clip: sample.clip, seconds: sample.seconds, bone: name, gap };
        }
      }
      for (const group of seams) {
        const first = group[0];
        first.mesh.getVertexPosition(first.index, point);
        point.applyMatrix4(first.mesh.matrixWorld).applyMatrix4(inverse);
        for (const ref of group.slice(1)) {
          ref.mesh.getVertexPosition(ref.index, other);
          other.applyMatrix4(ref.mesh.matrixWorld).applyMatrix4(inverse);
          maxSeamGapMetres = Math.max(maxSeamGapMetres, point.distanceTo(other));
        }
      }
    }
    return {
      jointsChecked,
      posesChecked: metadata.native_skeletal_pose_samples.length,
      maxJointGapMetres,
      worstJoint,
      seamGroups: seams.length,
      maxSeamGapMetres,
    };
  });
  assert.ok(report.exportComparison.jointsChecked > 100);
  assert.ok(report.exportComparison.maxJointGapMetres < 0.003);
  assert.ok(report.exportComparison.seamGroups > 50);
  assert.ok(report.exportComparison.maxSeamGapMetres < 0.0001);
  console.log(`Export comparison: ${JSON.stringify(report.exportComparison)}`);

  async function capture(name, clip, ms, { moving = false, speed = 0, age = null } = {}) {
    report.clips[name] = await page.evaluate(
      ({ clip, ms, moving, speed, age }) => {
        const s = window.voidmaulSmoke;
        s.reset(age);
        if (clip === 'Attack') s.visual.playAttack(0.5);
        if (clip === 'Hurt') s.visual.playHit();
        if (clip === 'Death') s.visual.playDeath();
        s.step(ms, moving, speed);
        const action = s.visual.actions.get(clip);
        let finite = true;
        s.scene.updateMatrixWorld(true);
        s.visual.root.traverse((node) => {
          finite &&= node.matrixWorld.elements.every(Number.isFinite);
        });
        return {
          clip: action.getClip().name,
          time: action.time,
          weight: action.getEffectiveWeight(),
          rate: action.getEffectiveTimeScale(),
          running: action.isRunning(),
          finite,
          rising: s.visual.rising,
        };
      },
      { clip, ms, moving, speed, age },
    );
    assert.ok(report.clips[name].finite, JSON.stringify(report.clips[name]));
    const screenshot = await page.evaluate(
      () => window.voidmaulSmoke.renderer.domElement.toDataURL('image/png').split(',')[1],
    );
    await writeFile(`${output}/${name}.png`, Buffer.from(screenshot, 'base64'));
    console.log(`${name}: ${JSON.stringify(report.clips[name])}`);
  }
  await capture('idle', 'Idle', 1000);
  await capture('walk', 'Walk', 280, { moving: true, speed: 2.8 });
  await capture('attack_charge', 'Attack', 400);
  await capture('attack_contact', 'Attack', 500);
  assert.ok(Math.abs(report.clips.attack_contact.time - 1.75) < 1e-4);
  await capture('hurt', 'Hurt', 220);
  await capture('death', 'Death', 2600);
  await capture('spawn', 'Spawn', 0, { age: 2.2 });
  assert.ok(report.clips.spawn.rising);

  // Twelve source-time stages expose deformation and the full death
  // sequence, which a single late corpse frame cannot establish.
  const timelineTimes = {
    Attack: [0, 0.25, 0.5, 0.75, 1, 1.25, 1.45, 1.65, 1.75, 1.9, 2.3, metadata.clips.Attack],
    Death: [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.4, 2.8, metadata.clips.Death],
  };
  const sheetPage = await browser.newPage();
  await sheetPage.setViewport({ width: 1600, height: 1028, deviceScaleFactor: 1 });
  for (const [clip, times] of Object.entries(timelineTimes)) {
    report.timelines[clip] = {};
    for (const view of ['front_three_quarter', 'side']) {
      const frames = [];
      for (let index = 0; index < times.length; index++) {
        const seconds = times[index];
        console.log(`${clip} ${view} stage ${index + 1}/${times.length}: ${seconds.toFixed(2)} s`);
        const pose = await page.evaluate(
          ({ clip, seconds, view, deformBones }) => {
            const s = window.voidmaulSmoke;
            const { THREE } = s;
            s.reset();
            s.camera.position.set(...(view === 'side' ? [16, 6, 1] : [11, 7, 12]));
            s.camera.lookAt(0, 3, 0);
            s.visual.mixer.stopAllAction();
            const action = s.visual.actions.get(clip);
            action
              .reset()
              .setLoop(THREE.LoopOnce, 1)
              .setEffectiveTimeScale(1)
              .setEffectiveWeight(1);
            action.clampWhenFinished = true;
            action.play();
            s.visual.mixer.setTime(seconds);
            s.visual.root.updateMatrixWorld(true);
            const rig = s.visual.root.getObjectByName('Voidmaul_ExportRig');
            const inverse = rig.matrixWorld.clone().invert();
            const joints = {};
            for (const name of deformBones) {
              const bone = s.visual.root.getObjectByName(
                THREE.PropertyBinding.sanitizeNodeName(name),
              );
              if (bone) joints[name] = bone.quaternion.toArray();
            }
            const meshes = {};
            s.visual.root.traverse((mesh) => {
              if (!mesh.isSkinnedMesh) return;
              const points = [];
              const position = mesh.geometry.getAttribute('position');
              const index = mesh.geometry.index;
              for (let i = 0; i < position.count; i++) {
                const p = mesh.getVertexPosition(i, new THREE.Vector3());
                points.push(p.applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse));
              }
              let volume = 0;
              const areas = [];
              const edgeA = new THREE.Vector3();
              const edgeB = new THREE.Vector3();
              const cross = new THREE.Vector3();
              const count = index?.count ?? points.length;
              for (let i = 0; i < count; i += 3) {
                const a = points[index ? index.getX(i) : i];
                const b = points[index ? index.getX(i + 1) : i + 1];
                const c = points[index ? index.getX(i + 2) : i + 2];
                cross.crossVectors(b, c);
                volume += a.dot(cross) / 6;
                edgeA.subVectors(b, a);
                edgeB.subVectors(c, a);
                areas.push(cross.crossVectors(edgeA, edgeB).length() / 2);
              }
              meshes[mesh.name] = { signedVolume: volume, areas };
            });
            s.renderer.render(s.scene, s.camera);
            return {
              seconds,
              time: action.time,
              joints,
              meshes,
              image: s.renderer.domElement.toDataURL('image/png').split(',')[1],
            };
          },
          { clip, seconds, view, deformBones: metadata.deform_bones },
        );
        const baseline = frames[0]?.pose;
        const previous = frames.at(-1)?.pose;
        pose.deformation = {};
        pose.articulationFromStart = { maxLocalJointRotationRadians: 0, bone: null };
        pose.articulationSincePrevious = { maxLocalJointRotationRadians: 0, bone: null };
        if (baseline) {
          for (const [name, quaternion] of Object.entries(pose.joints)) {
            const initial = baseline.joints[name];
            const dot = Math.abs(quaternion.reduce((sum, value, i) => sum + value * initial[i], 0));
            const radians = 2 * Math.acos(Math.min(1, dot));
            if (radians > pose.articulationFromStart.maxLocalJointRotationRadians) {
              pose.articulationFromStart = { maxLocalJointRotationRadians: radians, bone: name };
            }
            const prior = previous.joints[name];
            const previousDot = Math.abs(
              quaternion.reduce((sum, value, i) => sum + value * prior[i], 0),
            );
            const previousRadians = 2 * Math.acos(Math.min(1, previousDot));
            if (previousRadians > pose.articulationSincePrevious.maxLocalJointRotationRadians) {
              pose.articulationSincePrevious = {
                maxLocalJointRotationRadians: previousRadians,
                bone: name,
              };
            }
          }
          for (const [name, mesh] of Object.entries(pose.meshes)) {
            const initial = baseline.meshes[name];
            const ratios = mesh.areas
              .map((area, i) => (initial.areas[i] > 1e-12 ? area / initial.areas[i] : null))
              .filter((ratio) => ratio !== null)
              .sort((a, b) => a - b);
            pose.deformation[name] = {
              volumeRatio: mesh.signedVolume / initial.signedVolume,
              areaRatioP01: ratios[Math.floor(ratios.length * 0.01)],
              trianglesBelowTenPercentArea: ratios.filter((ratio) => ratio < 0.1).length,
              trianglesMeasured: ratios.length,
            };
          }
        }
        const image = pose.image;
        delete pose.image;
        await writeFile(
          `${output}/${clip.toLowerCase()}_${view}_${String(index).padStart(2, '0')}.png`,
          Buffer.from(image, 'base64'),
        );
        frames.push({ image, seconds, pose });
      }
      report.timelines[clip][view] = frames.map(({ pose }) => {
        const { meshes: _meshAreas, ...summary } = pose;
        return summary;
      });
      await sheetPage.setContent('<body style="margin:0;background:#161628"></body>');
      const sheetImage = await sheetPage.evaluate(
        async ({ frames, title }) => {
          const canvas = document.createElement('canvas');
          canvas.width = 1600;
          canvas.height = 1028;
          document.body.appendChild(canvas);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#161628';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#f1f0ff';
          ctx.font = '22px sans-serif';
          ctx.fillText(title, 12, 30);
          for (let i = 0; i < frames.length; i++) {
            const x = (i % 4) * 400;
            const y = 44 + Math.floor(i / 4) * 328;
            const image = new Image();
            image.src = `data:image/png;base64,${frames[i].image}`;
            await image.decode();
            ctx.font = '17px sans-serif';
            ctx.fillText(`${frames[i].seconds.toFixed(2)} s`, x + 10, y + 20);
            ctx.drawImage(image, x, y + 28, 400, 300);
          }
          return canvas.toDataURL('image/png').split(',')[1];
        },
        {
          frames: frames.map(({ image, seconds }) => ({ image, seconds })),
          title: `${clip} · ${view} · ${report.sha256.slice(0, 12)}`,
        },
      );
      await writeFile(
        `${output}/${clip.toLowerCase()}_${view}_sheet.png`,
        Buffer.from(sheetImage, 'base64'),
      );
    }
  }
  await sheetPage.close();
  assert.deepEqual(report.errors, [], JSON.stringify(report.errors));
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Voidmaul browser smoke passed: ${output}`);
} finally {
  await browser.close();
}
