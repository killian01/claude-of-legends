// Render the shipped Spawn clip with the independently anchored ground rift.
// Requires Vite (CLIENT defaults to the task-local port 5186). Outputs staged
// multiview stills and 24 fps PNG frames suitable for a native preview encode.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const origin = process.env.CLIENT ?? 'http://127.0.0.1:5186';
const output = process.env.VOIDMAUL_OUTPUT ?? '.tmp/voidmaul-rift-smoke';
const source = process.env.VOIDMAUL_GLB ?? 'public/models/creatures/voidmaul.glb';
const modelBytes = await readFile(source);
const metadataSource = source.replace(/\.glb$/i, '.export.json');
const metadataBytes = await readFile(metadataSource);
const metadata = JSON.parse(metadataBytes.toString());
const quick = process.argv.includes('--quick');
const stages = quick
  ? [0.72, 2.3]
  : [0, 0.2, 0.45, 0.6, 0.72, 0.9, 1.15, 1.82, 2.02, 2.3, 2.4, 2.8, 3.2, 4.2, 4.6, 5];
const fps = 24;
const previewDurationSeconds = 5;
const previewFrames = quick ? 0 : previewDurationSeconds * fps + 1;
const hashedFiles = {
  model: source,
  metadata: metadataSource,
  effect: 'src/render/vfx/voidmaul_rift_fx.ts',
  bursts: 'src/render/vfx/voidmaul_rift_burst_fx.ts',
  helper: 'src/render/voidmaul_rifts.ts',
  visual: 'src/render/creatures/voidmaul_visual.ts',
  timing: 'src/render/voidmaul_spawn.ts',
};
const sourceHashes = Object.fromEntries(
  await Promise.all(
    Object.entries(hashedFiles).map(async ([name, path]) => [
      name,
      createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
    ]),
  ),
);
assert.equal(
  createHash('sha256').update(modelBytes).digest('hex'),
  sourceHashes.model,
  'Model changed while the capture sources were being pinned',
);
assert.equal(
  createHash('sha256').update(metadataBytes).digest('hex'),
  sourceHashes.metadata,
  'Export metadata changed while the capture sources were being pinned',
);
await mkdir(`${output}/frames`, { recursive: true });
const report = {
  source,
  sha256: sourceHashes.model,
  effectSha256: sourceHashes.effect,
  helperSha256: sourceHashes.helper,
  burstSha256: sourceHashes.bursts,
  visualSha256: sourceHashes.visual,
  sourceHashes,
  origin,
  captureMode: quick ? 'preliminary_stills' : 'full_validation',
  fullClipCaptured: !quick,
  fps,
  previewDurationSeconds,
  previewFrames,
  worldScale: 6.6,
  terrainGround: 0,
  stages: {},
  shaderErrors: [],
  errors: [],
  warnings: [],
};
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

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 960, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(message.text());
    if (message.type() === 'warn') report.warnings.push(message.text());
  });
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.url() === `${origin}/models/creatures/voidmaul.glb`) {
      void request.respond({ status: 200, contentType: 'model/gltf-binary', body: modelBytes });
    } else if (request.url() === `${origin}/__voidmaul_rift_smoke`) {
      void request.respond({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#101920"><script type="module">
import {preloadVoidmaul, createVoidmaulVisual, VOIDMAUL_SCALE}
  from '/src/render/creatures/voidmaul_visual.ts';
import {VoidmaulRifts} from '/src/render/voidmaul_rifts.ts';
import {VOIDMAUL_SPAWN_TIMING, VOIDMAUL_SPAWN_BEATS} from '/src/render/voidmaul_spawn.ts';
// Use the exact transformed Three import URL from the effect so this harness
// shares the production module instance, including Vite's dependency version.
const fxModule = await fetch('/src/render/vfx/voidmaul_rift_fx.ts').then(r=>r.text());
const threeLine = fxModule.split('\\n').find(line=>line.includes('import * as THREE from'));
const threeUrl = threeLine?.split(/["']/)[1];
if(!threeUrl) throw new Error('Unable to resolve the effect Three.js module');
const THREE = await import(threeUrl);
const fxExports = await import('/src/render/vfx/voidmaul_rift_fx.ts');
const effectDuration = fxExports.VOIDMAUL_RIFT_DURATION_S;
await preloadVoidmaul();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101920);
const camera = new THREE.PerspectiveCamera(38, 1280 / 960, .1, 100);
const renderer = new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setSize(1280,960);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.debug.checkShaderErrors = true;
const shaderErrors = [];
renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
  shaderErrors.push({
    program: gl.getProgramInfoLog(program),
    vertex: gl.getShaderInfoLog(vertex),
    fragment: gl.getShaderInfoLog(fragment),
  });
};
document.body.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xc9e6e6,0x24342a,1.55));
const sun = new THREE.DirectionalLight(0xfff0df,2.5);
sun.position.set(7,13,8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048,2048);
Object.assign(sun.shadow.camera,{left:-12,right:12,top:12,bottom:-12,near:.1,far:40});
sun.shadow.bias = -.00025;
scene.add(sun);
// A mottled opaque orchard floor exposes readability and correct occlusion of
// the authored below-ground Spawn. It deliberately has no imitation rift.
const terrain = document.createElement('canvas');
terrain.width = terrain.height = 256;
const terrainCtx = terrain.getContext('2d');
for (let y=0;y<256;y++) for(let x=0;x<256;x++) {
  const n = (x*19+y*31+(x*y)%47)%29;
  const broad = Math.sin(x*.11)*Math.cos(y*.07)*5;
  terrainCtx.fillStyle = 'rgb('+(38+n*.25+broad)+','+(52+n*.38+broad)+','+(43+n*.3+broad)+')';
  terrainCtx.fillRect(x,y,1,1);
}
const terrainMap = new THREE.CanvasTexture(terrain);
terrainMap.colorSpace = THREE.SRGBColorSpace;
terrainMap.wrapS = terrainMap.wrapT = THREE.RepeatWrapping;
terrainMap.repeat.set(8,8);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(50,50),
  new THREE.MeshLambertMaterial({map:terrainMap,color:0xdde7db}));
ground.rotation.x = -Math.PI/2;
ground.position.y = -.001;
ground.receiveShadow = true;
scene.add(ground);
let visual, rifts, effectRoot, age = 0, stepEndAge = 0, beats = [], effectVisible = true;
const idleInput = {moving:false,speed:0};
function render() {
  renderer.render(scene,camera);
  const code = renderer.getContext().getError();
  if(code) shaderErrors.push({webglError:code,age});
}
function view(name) {
  camera.position.set(...(name==='front' ? [0,5.4,18] : [11,12,12]));
  camera.lookAt(0,2,0);
  render();
}
function reset(seconds=0) {
  if(visual) {scene.remove(visual.root);visual.dispose();}
  if(rifts) rifts.dispose();
  visual = createVoidmaulVisual(seconds,1.1);
  if(!visual) throw new Error('Voidmaul failed to load');
  visual.root.scale.setScalar(1.1);
  scene.add(visual.root);
  age = seconds;
  beats = [];
  effectVisible = true;
  rifts = new VoidmaulRifts(scene,(kind,anchor)=>{
    beats.push({kind,time:stepEndAge,position:anchor.toArray()});
  });
  const before = new Set(scene.children);
  const started = rifts.start(71,seconds,new THREE.Vector3(0,0,0),VOIDMAUL_SCALE*1.1,0,
    ()=>effectVisible);
  effectRoot = scene.children.find(node=>!before.has(node)) ?? null;
  render();
  return started;
}
function step(milliseconds,input=idleInput) {
  for(let elapsed=0;elapsed<milliseconds;elapsed+=10) {
    const dt = Math.min(10,milliseconds-elapsed);
    stepEndAge = age+dt/1000;
    visual.update(dt,input);
    rifts.update(dt);
    age += dt/1000;
  }
  render();
}
function stepSingle(milliseconds,input=idleInput) {
  stepEndAge = age+milliseconds/1000;
  visual.update(milliseconds,input);
  rifts.update(milliseconds);
  age = stepEndAge;
  render();
}
function state() {
  scene.updateMatrixWorld(true);
  const position = effectRoot?.getWorldPosition(new THREE.Vector3()).toArray() ?? null;
  const effectScale = effectRoot?.getWorldScale(new THREE.Vector3()).toArray() ?? null;
  let visibleMeshes=0, finite=true, skinnedMeshes=0;
  const objects=[], effectBounds=new THREE.Box3();
  const point=new THREE.Vector3(), matrix=new THREE.Matrix4(), instanceBox=new THREE.Box3();
  scene.traverse(node=>{
    finite &&= node.matrixWorld.elements.every(Number.isFinite);
    if(node.isSkinnedMesh) {
      skinnedMeshes++;
      finite &&= node.skeleton.boneMatrices.every(Number.isFinite);
    }
    if(node.isInstancedMesh) finite &&= node.instanceMatrix.array.every(Number.isFinite);
    if(node.isPoints) finite &&= node.geometry.attributes.position.array.every(Number.isFinite);
  });
  effectRoot?.traverse(node=>{
    if(!node.isMesh && !node.isPoints && !node.isSprite && !node.isLight) return;
    let visible=true;
    for(let parent=node;parent;parent=parent.parent) visible &&= parent.visible;
    if(visible && node.isMesh) visibleMeshes++;
    if(node.geometry?.attributes.position)
      finite &&= node.geometry.attributes.position.array.every(Number.isFinite);
    let activeInstances;
    if(node.isInstancedMesh) {
      activeInstances=0;
      node.geometry.computeBoundingBox();
      for(let i=0;i<node.count;i++) {
        node.getMatrixAt(i,matrix);
        if(!visible || Math.abs(matrix.determinant()) < 1e-12) continue;
        activeInstances++;
        matrix.premultiply(node.matrixWorld);
        instanceBox.copy(node.geometry.boundingBox).applyMatrix4(matrix);
        effectBounds.union(instanceBox);
      }
    } else if(visible && node.geometry?.attributes.position) {
      const positions=node.geometry.attributes.position;
      const fades=node.geometry.attributes.aFade;
      const sizes=node.geometry.attributes.aSize;
      const faded=node.material?.opacity===0 || node.material?.uniforms?.uFade?.value===0;
      if(!faded) for(let i=0;i<positions.count;i++) {
        if(fades && fades.getX(i)<=0) continue;
        if(sizes && sizes.getX(i)<=0) continue;
        point.fromBufferAttribute(positions,i).applyMatrix4(node.matrixWorld);
        effectBounds.expandByPoint(point);
      }
    }
    objects.push({name:node.name,type:node.type,visible,
      instances:node.isInstancedMesh ? node.count : undefined,
      activeInstances,
      points:node.isPoints ? node.geometry.attributes.position.count : undefined,
      opacity:node.material?.opacity,
      position:node.position.toArray(),scale:node.scale.toArray()});
  });
  return {
    age,count:rifts.count,rising:visual.rising,
    effectAttached:effectRoot?.parent===scene,
    effectName:effectRoot?.name ?? null,position,effectScale,visibleMeshes,
    spawnTime:visual.actions.get('Spawn')?.time,
    idleTime:visual.actions.get('Idle')?.time,
    finite,skinnedMeshes,objects,beats:beats.map(beat=>({...beat})),
    effectBounds:effectRoot?.parent && !effectBounds.isEmpty() ?
      {min:effectBounds.min.toArray(),max:effectBounds.max.toArray()} : null,
    render:{...renderer.info.render},
  };
}
function poseGeometry() {
  scene.updateMatrixWorld(true);
  const regions=[];
  visual.root.traverse(mesh=>{
    if(!mesh.isSkinnedMesh) return;
    mesh.skeleton.update();
    const positions=mesh.geometry.attributes.position;
    const bounds=new THREE.Box3(), point=new THREE.Vector3();
    let belowGround=0,finite=true;
    for(let i=0;i<positions.count;i++) {
      point.fromBufferAttribute(positions,i);
      mesh.applyBoneTransform(i,point).applyMatrix4(mesh.matrixWorld);
      finite &&= point.toArray().every(Number.isFinite);
      belowGround += point.y < -.002 ? 1 : 0;
      bounds.expandByPoint(point);
    }
    regions.push({name:mesh.name,vertices:positions.count,belowGround,finite,
      min:bounds.min.toArray(),max:bounds.max.toArray()});
  });
  return regions;
}
const readCanvas = document.createElement('canvas');
readCanvas.width=1280;readCanvas.height=960;
const readCtx = readCanvas.getContext('2d',{willReadFrequently:true});
function pixels() {
  readCtx.drawImage(renderer.domElement,0,0);
  return readCtx.getImageData(0,0,1280,960).data;
}
function difference(first,second) {
  let changedPixels=0,absoluteDifference=0,maxDifference=0;
  const bounds = [1280,960,-1,-1];
  for(let index=0;index<first.length;index+=4) {
    let total=0;
    for(let channel=0;channel<3;channel++) {
      const diff=Math.abs(first[index+channel]-second[index+channel]);
      total+=diff;maxDifference=Math.max(maxDifference,diff);
    }
    absoluteDifference+=total;
    if(total>12) {
      changedPixels++;
      const pixel=index/4,x=pixel%1280,y=Math.floor(pixel/1280);
      bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);
      bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y);
    }
  }
  return {changedPixels,absoluteDifference,maxDifference,bounds};
}
view('elevated_three_quarter');
reset(0);
window.voidmaulRiftSmoke = {THREE,scene,camera,renderer,reset,step,stepSingle,view,state,
  pixels,difference,render,poseGeometry,effectDuration,
  timing:VOIDMAUL_SPAWN_TIMING,birthBeats:VOIDMAUL_SPAWN_BEATS,
  setEffectVisible(value){effectVisible=value;},
  shaderErrors,get visual(){return visual;},get rifts(){return rifts;},get effectRoot(){return effectRoot;}};
</script></body></html>`,
      });
    } else {
      void request.continue();
    }
  });
  await page.goto(`${origin}/__voidmaul_rift_smoke`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction(() => window.voidmaulRiftSmoke, { timeout: 60000 });
  const runtime = await page.evaluate(() => {
    const s = window.voidmaulRiftSmoke;
    return { effectDuration: s.effectDuration, timing: s.timing, birthBeats: s.birthBeats };
  });
  Object.assign(report, runtime);
  assert.ok(runtime.effectDuration <= previewDurationSeconds);
  assert.equal(runtime.timing.fullEmergence, 2.02);
  assert.equal(runtime.timing.stomp, 2.3);

  report.exportComparison = await page.evaluate((metadata) => {
    const s = window.voidmaulRiftSmoke,
      { THREE } = s;
    s.reset(0);
    const rig = s.visual.root.getObjectByName('Voidmaul_ExportRig');
    if (!rig) throw new Error('Missing export rig');
    s.visual.root.updateMatrixWorld(true);
    const initialInverse = rig.matrixWorld.clone().invert(),
      groups = new Map();
    const point = new THREE.Vector3(),
      other = new THREE.Vector3();
    s.visual.root.traverse((mesh) => {
      if (!mesh.isSkinnedMesh) return;
      const positions = mesh.geometry.getAttribute('position');
      for (let index = 0; index < positions.count; index++) {
        point
          .fromBufferAttribute(positions, index)
          .applyMatrix4(mesh.matrixWorld)
          .applyMatrix4(initialInverse);
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
    let maxJointGapMetres = 0,
      maxSeamGapMetres = 0,
      jointsChecked = 0,
      worstJoint = null;
    const poses = [];
    for (const sample of metadata.native_skeletal_pose_samples) {
      const mixer = s.visual.mixer;
      mixer.stopAllAction();
      const action = s.visual.actions.get(sample.clip);
      action.reset().setLoop(THREE.LoopOnce, 1).setEffectiveTimeScale(1).setEffectiveWeight(1);
      action.clampWhenFinished = true;
      action.play();
      mixer.setTime(sample.seconds);
      s.visual.root.updateMatrixWorld(true);
      s.visual.root.traverse((mesh) => {
        if (mesh.isSkinnedMesh) mesh.skeleton.update();
      });
      const inverse = rig.matrixWorld.clone().invert();
      let poseJointGap = 0,
        poseSeamGap = 0;
      for (const [name, rows] of Object.entries(sample.bone_matrices_gltf_armature)) {
        const bone = s.visual.root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
        if (!bone) throw new Error(`Missing exported bone ${name}`);
        const expected = new THREE.Vector3(rows[0][3], rows[1][3], rows[2][3]);
        const actual = bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse);
        const gap = actual.distanceTo(expected);
        if (!Number.isFinite(gap)) throw new Error('Nonfinite native joint comparison');
        jointsChecked++;
        poseJointGap = Math.max(poseJointGap, gap);
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
          poseSeamGap = Math.max(poseSeamGap, point.distanceTo(other));
        }
      }
      maxSeamGapMetres = Math.max(maxSeamGapMetres, poseSeamGap);
      poses.push({
        clip: sample.clip,
        seconds: sample.seconds,
        maxJointGapMetres: poseJointGap,
        maxSeamGapMetres: poseSeamGap,
      });
    }
    s.reset(0);
    return {
      jointsChecked,
      posesChecked: poses.length,
      seamGroups: seams.length,
      maxJointGapMetres,
      maxSeamGapMetres,
      worstJoint,
      poses,
    };
  }, metadata);
  assert.equal(report.exportComparison.posesChecked, 8);
  assert.equal(report.exportComparison.jointsChecked, 168);
  assert.equal(report.exportComparison.seamGroups, 831);
  assert.ok(
    report.exportComparison.maxJointGapMetres < 0.003,
    JSON.stringify(report.exportComparison.worstJoint),
  );
  assert.ok(report.exportComparison.maxSeamGapMetres < 0.0001);
  console.log(`Native export comparison: ${JSON.stringify(report.exportComparison)}`);

  async function png(path) {
    const image = await page.evaluate(
      () => window.voidmaulRiftSmoke.renderer.domElement.toDataURL('image/png').split(',')[1],
    );
    await writeFile(`${output}/${path}`, Buffer.from(image, 'base64'));
    return image;
  }

  report.visibilityAtOneSecond = await page.evaluate(() => {
    const s = window.voidmaulRiftSmoke;
    s.reset(0);
    s.step(1000);
    const present = s.state();
    const withRift = s.pixels();
    const visible = s.effectRoot.visible;
    s.effectRoot.visible = false;
    s.render();
    const withoutRift = s.pixels();
    s.effectRoot.visible = visible;
    s.render();
    return { ...present, pixelDifference: s.difference(withRift, withoutRift) };
  });
  assert.equal(report.visibilityAtOneSecond.count, 1);
  assert.ok(report.visibilityAtOneSecond.effectAttached);
  assert.ok(report.visibilityAtOneSecond.pixelDifference.changedPixels > 500);
  await png('rift_visible_1s.png');

  report.lateSeek = await page.evaluate(() => {
    const s = window.voidmaulRiftSmoke;
    const checks = [];
    for (const seconds of [0.6, 0.72, 1.15, 2.02, 2.3, 3.2, 3.85]) {
      s.reset(0);
      s.step(seconds * 1000);
      const stepped = s.state(),
        first = s.pixels();
      s.reset(seconds);
      checks.push({
        seconds,
        stepped,
        seeked: s.state(),
        pixelDifference: s.difference(first, s.pixels()),
      });
    }
    return checks;
  });
  for (const check of report.lateSeek) {
    assert.ok(Math.abs(check.seeked.spawnTime - check.seconds) < 1e-6);
    assert.ok(check.pixelDifference.changedPixels < 1280 * 960 * 0.01, JSON.stringify(check));
    assert.deepEqual(check.seeked.beats, [], 'A late start replayed an earlier beat');
  }

  report.birthBeatCallbacks = await page.evaluate(() => {
    const s = window.voidmaulRiftSmoke;
    s.reset(0);
    s.step(3500);
    const stepped = s.state().beats;
    const duplicateStartAccepted = s.rifts.start(71, 0, new s.THREE.Vector3(0, 0, 0), 6.6);
    s.reset(0);
    s.stepSingle(3500);
    const largeStep = s.state().beats;
    s.reset(0);
    s.setEffectVisible(false);
    s.step(1300);
    const hidden = s.state();
    s.setEffectVisible(true);
    s.step(2200);
    const visibleAgain = s.state();
    return { stepped, largeStep, duplicateStartAccepted, hidden, visibleAgain };
  });
  const expectedKinds = runtime.birthBeats.map((beat) => beat.kind);
  assert.deepEqual(
    report.birthBeatCallbacks.stepped.map((beat) => beat.kind),
    expectedKinds,
  );
  assert.deepEqual(
    report.birthBeatCallbacks.largeStep.map((beat) => beat.kind),
    expectedKinds,
  );
  assert.equal(report.birthBeatCallbacks.duplicateStartAccepted, false);
  assert.deepEqual(report.birthBeatCallbacks.hidden.beats, []);
  assert.deepEqual(
    report.birthBeatCallbacks.visibleAgain.beats.map((beat) => beat.kind),
    expectedKinds.filter((kind) => kind !== 'rupture'),
  );
  for (const [index, beat] of report.birthBeatCallbacks.stepped.entries()) {
    assert.ok(beat.time >= runtime.birthBeats[index].at - 1e-9);
    assert.ok(beat.time <= runtime.birthBeats[index].at + 0.010001);
    assert.deepEqual(beat.position, [0, 0, 0]);
  }

  report.modelReadability = await page.evaluate(() => {
    const s = window.voidmaulRiftSmoke;
    return [0.45, 0.72, 1.15, 2.02, 2.3, 2.8, 3.2].map((seconds) => {
      s.reset(seconds);
      const both = s.pixels();
      s.visual.root.visible = false;
      s.render();
      const effectOnly = s.pixels();
      s.effectRoot.visible = false;
      s.visual.root.visible = true;
      s.render();
      const modelOnly = s.pixels();
      s.visual.root.visible = false;
      s.render();
      const floorOnly = s.pixels();
      s.visual.root.visible = true;
      s.effectRoot.visible = true;
      s.render();
      const withRift = s.difference(both, effectOnly);
      const withoutRift = s.difference(modelOnly, floorOnly);
      return {
        seconds,
        withRift,
        withoutRift,
        visiblePixelRatio: withRift.changedPixels / Math.max(1, withoutRift.changedPixels),
        pose: s.poseGeometry(),
      };
    });
  });
  for (const sample of report.modelReadability) {
    assert.ok(sample.pose.every((region) => region.finite));
    if (sample.seconds >= runtime.timing.fullEmergence) {
      assert.ok(sample.withRift.changedPixels > 2000, JSON.stringify(sample));
      assert.ok(
        sample.visiblePixelRatio > 0.3,
        `Energy obscured the emerged body at ${sample.seconds}s: ${sample.visiblePixelRatio}`,
      );
      if (!quick)
        assert.ok(
          sample.pose.every((region) => region.min[1] >= -0.01),
          `Emerged skin penetrated the floor at ${sample.seconds}s`,
        );
    }
  }

  report.anchorAfterMovement = await page.evaluate(() => {
    const s = window.voidmaulRiftSmoke;
    s.reset(2.2);
    const before = s.state();
    s.visual.root.position.set(3, 0, -2);
    s.visual.root.rotation.y = 0.9;
    s.step(200, { moving: true, speed: 2.8 });
    return { before, after: s.state(), modelPosition: s.visual.root.position.toArray() };
  });
  assert.deepEqual(report.anchorAfterMovement.before.position, [0, 0, 0]);
  assert.deepEqual(report.anchorAfterMovement.after.position, [0, 0, 0]);
  assert.equal(report.anchorAfterMovement.after.count, 1);
  assert.equal(report.anchorAfterMovement.after.rising, false);
  await png('anchored_after_movement.png');

  report.anchorAfterDeath = await page.evaluate(() => {
    const s = window.voidmaulRiftSmoke;
    s.reset(1.2);
    s.visual.playDeath();
    s.step(1000);
    return s.state();
  });
  assert.equal(report.anchorAfterDeath.count, 1);
  assert.deepEqual(report.anchorAfterDeath.position, [0, 0, 0]);

  report.raisedMirroredAnchor = await page.evaluate(() => {
    const s = window.voidmaulRiftSmoke;
    s.reset(0);
    s.rifts.dispose();
    s.scene.scale.z = -1;
    s.scene.position.z = 30;
    const before = new Set(s.scene.children);
    s.rifts.start(72, 0.72, new s.THREE.Vector3(4, 3, -2), 6.6, 0.8);
    const effect = s.scene.children.find((node) => !before.has(node));
    s.scene.updateMatrixWorld(true);
    const result = {
      local: effect.position.toArray(),
      world: effect.getWorldPosition(new s.THREE.Vector3()).toArray(),
      scale: effect.scale.toArray(),
      yaw: effect.rotation.y,
    };
    s.rifts.dispose();
    s.scene.scale.z = 1;
    s.scene.position.z = 0;
    s.reset(0);
    return result;
  });
  assert.deepEqual(report.raisedMirroredAnchor.local, [4, 3, -2]);
  assert.deepEqual(report.raisedMirroredAnchor.world, [4, 3, 32]);
  assert.deepEqual(report.raisedMirroredAnchor.scale, [6.6, 6.6, 6.6]);
  assert.equal(report.raisedMirroredAnchor.yaw, 0.8);

  report.removalBoundary = await page.evaluate(() => {
    const s = window.voidmaulRiftSmoke;
    s.reset(0);
    s.step(s.effectDuration * 1000 + 1);
    const justAfterBoundary = s.state();
    const lateStartAccepted = s.reset(s.effectDuration);
    return { justAfterBoundary, lateStartAccepted, lateStart: s.state() };
  });
  assert.equal(report.removalBoundary.justAfterBoundary.count, 0);
  assert.equal(report.removalBoundary.justAfterBoundary.effectAttached, false);
  assert.equal(report.removalBoundary.lateStartAccepted, false);
  assert.equal(report.removalBoundary.lateStart.count, 0);

  const sheetPage = await browser.newPage();
  for (const view of ['elevated_three_quarter', 'front']) {
    await page.evaluate((view) => {
      const s = window.voidmaulRiftSmoke;
      s.view(view);
      s.reset(0);
    }, view);
    let previous = 0;
    const frames = [];
    report.stages[view] = [];
    for (let index = 0; index < stages.length; index++) {
      const seconds = stages[index];
      const state = await page.evaluate((delta) => {
        const s = window.voidmaulRiftSmoke;
        s.step(delta * 1000);
        return s.state();
      }, seconds - previous);
      assert.ok(state.finite);
      // Repeated time additions can reach 4.599999999999947 at the 4.6 s
      // label. Test removal above the boundary separately, not that roundoff.
      if (seconds > runtime.effectDuration) {
        assert.equal(state.count, 0, JSON.stringify(state));
        assert.equal(state.effectAttached, false, JSON.stringify(state));
      }
      const filename = `spawn_rift_${view}_${String(index).padStart(2, '0')}.png`;
      const image = await png(filename);
      frames.push({ seconds, image });
      report.stages[view].push({ seconds, filename, ...state });
      previous = seconds;
      console.log(`Spawn rift ${view}: ${seconds.toFixed(2)} s`);
    }
    await sheetPage.setContent('<body style="margin:0;background:#101920"></body>');
    const sheet = await sheetPage.evaluate(
      async ({ frames, title }) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1600;
        canvas.height = 44 + Math.ceil(frames.length / 4) * 328;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#101920';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#e6f7ee';
        ctx.font = '22px sans-serif';
        ctx.fillText(title, 12, 30);
        for (let i = 0; i < frames.length; i++) {
          const x = (i % 4) * 400,
            y = 44 + Math.floor(i / 4) * 328;
          const image = new Image();
          image.src = `data:image/png;base64,${frames[i].image}`;
          await image.decode();
          ctx.font = '17px sans-serif';
          ctx.fillText(`${frames[i].seconds.toFixed(2)} s`, x + 10, y + 20);
          ctx.drawImage(image, x, y + 28, 400, 300);
        }
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { frames, title: `Voidmaul Spawn + ground rift | ${view}` },
    );
    await writeFile(`${output}/spawn_rift_${view}_sheet.png`, Buffer.from(sheet, 'base64'));
  }
  if (!quick) {
    const eruption = report.stages.elevated_three_quarter.find((stage) => stage.seconds === 0.9);
    assert.ok(
      eruption.objects.some(
        (object) =>
          object.name === 'Voidmaul_ThrownStones' &&
          object.instances === 72 &&
          object.activeInstances >= 24,
      ),
    );
    assert.ok(
      eruption.objects.some(
        (object) => object.name === 'Voidmaul_RuptureSparks' && object.points === 96,
      ),
    );
    assert.ok(
      eruption.objects.some(
        (object) => object.name === 'Voidmaul_RuptureDust' && object.points === 36,
      ),
    );
    assert.equal(
      eruption.objects.filter(
        (object) => object.name.startsWith('Voidmaul_EruptionArc_') && object.visible,
      ).length,
      14,
    );
    assert.ok(
      eruption.effectBounds.max[1] > report.worldScale * 0.75,
      'Main eruption did not reach above the body silhouette',
    );
  }
  await sheetPage.close();

  await page.evaluate(() => {
    const s = window.voidmaulRiftSmoke;
    s.view('elevated_three_quarter');
    s.reset(0);
  });
  let previous = 0;
  report.previewStates = [];
  for (let frame = 0; frame < previewFrames; frame++) {
    const seconds = frame / fps;
    const state = await page.evaluate((delta) => {
      const s = window.voidmaulRiftSmoke;
      s.step(delta * 1000);
      return s.state();
    }, seconds - previous);
    assert.ok(state.finite);
    await png(`frames/frame_${String(frame).padStart(4, '0')}.png`);
    report.previewStates.push({ frame, seconds, ...state });
    previous = seconds;
    if (frame % fps === 0)
      console.log(`Preview frame ${frame}/${previewFrames - 1}: ${seconds.toFixed(2)} s`);
  }
  report.shaderErrors = await page.evaluate(() => window.voidmaulRiftSmoke.shaderErrors);
  const capturedStates = [...Object.values(report.stages).flat(), ...report.previewStates];
  report.renderBudget = {
    peakDrawCalls: Math.max(...capturedStates.map((state) => state.render.calls)),
    peakTriangles: Math.max(...capturedStates.map((state) => state.render.triangles)),
    peakPoints: Math.max(...capturedStates.map((state) => state.render.points)),
    peakVisibleEffectMeshes: Math.max(...capturedStates.map((state) => state.visibleMeshes)),
  };
  report.renderedScope =
    'Production creature, rift, burst shaders and callback lifecycle in a dedicated WebGL scene; Renderer pooled lights and camera kicks are validated separately.';
  report.gpu = await page.evaluate(() => {
    const renderer = window.voidmaulRiftSmoke.renderer;
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      programs: renderer.info.programs.length,
      render: renderer.info.render,
    };
  });
  assert.deepEqual(report.shaderErrors, [], JSON.stringify(report.shaderErrors));
  assert.deepEqual(report.errors, [], JSON.stringify(report.errors));
  report.finalSourceHashes = Object.fromEntries(
    await Promise.all(
      Object.entries(hashedFiles).map(async ([name, path]) => [
        name,
        createHash('sha256')
          .update(await readFile(path))
          .digest('hex'),
      ]),
    ),
  );
  if (!quick)
    assert.deepEqual(
      report.finalSourceHashes,
      sourceHashes,
      'Production sources changed during this capture; rerun against the final files',
    );
  report.passed = true;
  console.log(`Voidmaul rift WebGL smoke passed: ${output}`);
} catch (error) {
  report.passed = false;
  report.failure = error.stack;
  throw error;
} finally {
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
