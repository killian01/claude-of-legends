// Production Attack + resolved simulation ground slam, in real WebGL.
// Requires task-local Vite (CLIENT defaults to :5187). The 133 PNG frames
// cover 0..5.5 seconds at24 fps; separate stills expose the long-lived scar.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const origin = process.env.CLIENT ?? 'http://127.0.0.1:5187';
const output = process.env.VOIDMAUL_OUTPUT ?? '.tmp/voidmaul-attack-arena-smoke';
const arenaLayoutPath = 'public/map/star-orchard/gameplay.json';
const arenaLayout = JSON.parse(await readFile(arenaLayoutPath, 'utf8'));
const sourceArena = arenaLayout.objectiveSites.find((site) => site.lane === 'top');
assert.ok(sourceArena, 'Missing production Voidmaul arena');
const source = process.env.VOIDMAUL_GLB ?? 'public/models/creatures/voidmaul.glb';
const modelBytes = await readFile(source);
const metadata = JSON.parse(await readFile(source.replace(/\.glb$/i, '.export.json'), 'utf8'));
const quick = process.argv.includes('--quick');
const measureOnly = process.argv.includes('--measure-only');
const fps = 24,
  duration = 5.5,
  frameCount = quick || measureOnly ? 0 : duration * fps + 1;
const stages = quick
  ? [1.75, 2.15, 2.8, 5.5]
  : [0, 0.5, 1, 1.5, 1.7, 1.75, 1.83, 1.95, 2.15, 2.45, 2.8, 3.2, 4, 5.5, 11.75, 31.75];
const files = {
  model: source,
  metadata: source.replace(/\.glb$/i, '.export.json'),
  effect: 'src/render/vfx/voidmaul_attack_fx.ts',
  manager: 'src/render/voidmaul_impacts.ts',
  visual: 'src/render/creatures/voidmaul_visual.ts',
  content: 'src/sim/content/voidmaul_slam.ts',
  combat: 'src/sim/combat/voidmaul_slam.ts',
  notes: 'src/game/voidmaul_slam_notes.ts',
  arenaLayout: arenaLayoutPath,
  arena: 'src/render/voidmaul_arena.ts',
  feedback: 'src/render/voidmaul_attack_feedback.ts',
  renderer: 'src/render/renderer.ts',
};
async function hashes() {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([key, path]) => [
        key,
        createHash('sha256')
          .update(await readFile(path))
          .digest('hex'),
      ]),
    ),
  );
}
const pinned = await hashes();
assert.equal(createHash('sha256').update(modelBytes).digest('hex'), pinned.model);
await mkdir(`${output}/frames`, { recursive: true });
const report = {
  source,
  sha256: pinned.model,
  sourceHashes: pinned,
  origin,
  fps,
  previewDurationSeconds: duration,
  previewFrames: frameCount,
  captureMode: measureOnly
    ? 'model_contact_only'
    : quick
      ? 'preliminary_stills'
      : 'full_validation',
  renderedScope:
    'Production model, impact manager, fracture shaders and simulation point on a contrasting circular arena with the exact StarOrchard radius. Terrain steps are checked geometrically; Renderer pooled lights, camera shake and damage dispatch are checked separately.',
  arenaSource: { path: arenaLayoutPath, revision: arenaLayout.revision, ...sourceArena },
  stages: {},
  errors: [],
  warnings: [],
  shaderErrors: [],
};

async function browserMain() {
  const fxText = await fetch('/src/render/vfx/voidmaul_attack_fx.ts').then((r) => r.text());
  const line = fxText.split('\n').find((line) => line.includes('import * as THREE from'));
  const url = line?.split(/["']/)[1];
  if (!url) throw new Error('Unable to resolve production Three module');
  const THREE = await import(url);
  const { preloadVoidmaul, createVoidmaulVisual, VOIDMAUL_SCALE, VOIDMAUL_ATTACK_RELEASE_S } =
    await import('/src/render/creatures/voidmaul_visual.ts');
  const { VoidmaulImpacts, VOIDMAUL_MAX_IMPACTS } = await import('/src/render/voidmaul_impacts.ts');
  const { VOIDMAUL_ATTACK_FX_DURATION_S } = await import('/src/render/vfx/voidmaul_attack_fx.ts');
  const { VOIDMAUL_SLAM } = await import('/src/sim/content/voidmaul_slam.ts');
  const { voidmaulSlamPoint } = await import('/src/sim/combat/voidmaul_slam.ts');
  const { voidmaulArenaForImpact } = await import('/src/render/voidmaul_arena.ts');
  const layout = await fetch('/map/star-orchard/gameplay.json').then((r) => r.json());
  const sourceArena = layout.objectiveSites.find((site) => site.lane === 'top');
  const arena = voidmaulArenaForImpact(
    [{ id: 'top', x: sourceArena.center.x, z: sourceArena.center.z, r: sourceArena.radius }],
    () => 0,
    (point) => ({ x: point.x - sourceArena.center.x, z: point.z - sourceArena.center.z }),
  );
  if (!arena) throw new Error('Production arena helper rejected StarOrchard circle');
  await preloadVoidmaul();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101920);
  const camera = new THREE.PerspectiveCamera(38, 1280 / 960, 0.1, 250);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(1280, 960);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.debug.checkShaderErrors = true;
  const shaderErrors = [];
  renderer.debug.onShaderError = (gl, program, vertex, fragment) =>
    shaderErrors.push({
      program: gl.getProgramInfoLog(program),
      vertex: gl.getShaderInfoLog(vertex),
      fragment: gl.getShaderInfoLog(fragment),
    });
  document.body.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xc9e6e6, 0x24342a, 1.55));
  const sun = new THREE.DirectionalLight(0xfff0df, 2.5);
  sun.position.set(25, 45, 22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -30,
    right: 30,
    top: 30,
    bottom: -30,
    near: 0.1,
    far: 110,
  });
  sun.shadow.bias = -0.00025;
  scene.add(sun);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const n = (x * 19 + y * 31 + ((x * y) % 47)) % 29,
        b = Math.sin(x * 0.11) * Math.cos(y * 0.07) * 5;
      ctx.fillStyle = `rgb(${38 + n * 0.25 + b},${52 + n * 0.38 + b},${43 + n * 0.3 + b})`;
      ctx.fillRect(x, y, 1, 1);
    }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(12, 12);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90),
    new THREE.MeshLambertMaterial({ map: texture, color: 0xdde7db }),
  );
  ground.rotation.x = -Math.PI / 2;
  // Keep the surrounding presentation plane clear of the arena's depth buffer.
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  scene.add(ground);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(arena.radius, 128),
    new THREE.MeshLambertMaterial({ color: 0x6b7979 }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.receiveShadow = true;
  disc.name = 'QA_StarOrchardArena';
  scene.add(disc);
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(arena.radius - 0.09, arena.radius + 0.09, 128),
    new THREE.MeshBasicMaterial({ color: 0xc9b786, side: THREE.DoubleSide }),
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.012;
  scene.add(rim);
  const gridPoints = [];
  for (let ring = 1; ring < 8; ring++)
    for (let angle = 0; angle < 128; angle++) {
      const r = (arena.radius * ring) / 8,
        a = (angle * Math.PI * 2) / 128,
        b = ((angle + 1) * Math.PI * 2) / 128;
      gridPoints.push(
        r * Math.cos(a),
        0.008,
        r * Math.sin(a),
        r * Math.cos(b),
        0.008,
        r * Math.sin(b),
      );
    }
  for (let sector = 0; sector < 16; sector++) {
    const angle = (sector * Math.PI * 2) / 16;
    gridPoints.push(
      0,
      0.008,
      0,
      Math.cos(angle) * arena.radius,
      0.008,
      Math.sin(angle) * arena.radius,
    );
  }
  const gridGeometry = new THREE.BufferGeometry();
  gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPoints, 3));
  scene.add(
    new THREE.LineSegments(
      gridGeometry,
      new THREE.LineBasicMaterial({
        color: 0x97ada9,
        transparent: true,
        opacity: 0.15,
        depthWrite: false,
      }),
    ),
  );
  let visual,
    manager,
    effectRoot,
    note,
    seconds = 0,
    feedback = [],
    emitted = false,
    effectsEnabled = true;
  let groundHeight = () => 0;
  const input = { moving: false, speed: 0 };
  function render() {
    renderer.render(scene, camera);
    const error = renderer.getContext().getError();
    if (error) shaderErrors.push({ webglError: error, seconds });
  }
  function view(name) {
    if (name === 'front') camera.position.set(0, 25, 65);
    else if (name === 'arena_top') camera.position.set(0, 64, 25);
    else camera.position.set(35, 53, 44);
    camera.lookAt(0, 5, 0);
    render();
  }
  function reset(options = {}) {
    if (visual) {
      scene.remove(visual.root);
      visual.dispose();
    }
    if (manager) manager.dispose();
    const ascendant = options.ascendant ?? false,
      yaw = options.yaw ?? 0;
    const holderScale = 1.1 * (ascendant ? VOIDMAUL_SLAM.ascendantScale : 1);
    const position = options.position ?? [0, 0, 0];
    seconds = 0;
    feedback = [];
    emitted = false;
    effectRoot = null;
    effectsEnabled = options.effectsEnabled ?? true;
    visual = createVoidmaulVisual(null, holderScale);
    if (!visual) throw new Error('Production Voidmaul did not load');
    visual.root.scale.setScalar(holderScale);
    visual.root.rotation.y = yaw;
    visual.root.position.fromArray(position);
    scene.add(visual.root);
    visual.playAttack(VOIDMAUL_ATTACK_RELEASE_S);
    const attacker = { pos: { x: position[0], z: position[2] }, ascendant };
    const target = { x: position[0] + Math.sin(yaw) * 4, z: position[2] + Math.cos(yaw) * 4 };
    const point = voidmaulSlamPoint(attacker, target);
    note = {
      unitId: 71,
      targetId: 72,
      x: point.x,
      z: point.z,
      radius: ascendant ? VOIDMAUL_SLAM.ascendantRadius : VOIDMAUL_SLAM.radius,
      at: VOIDMAUL_ATTACK_RELEASE_S,
    };
    groundHeight =
      options.groundProfile === 'stepped'
        ? (x, z) => {
            const dx = x - note.x,
              dz = z - note.z;
            return position[1] + dx * 0.13 + dz * 0.07 + (dx > 1.4 ? 1.8 : dx < -1.4 ? -0.8 : 0);
          }
        : () => position[1];
    manager = new VoidmaulImpacts(scene, groundHeight, (anchor) =>
      feedback.push({ position: anchor.toArray(), at: seconds }),
    );
    render();
    return note;
  }
  function emit(worldTime = seconds, visible = true) {
    const before = new Set(scene.children);
    const accepted = manager.start(
      note,
      worldTime,
      new THREE.Vector3(note.x, groundHeight(note.x, note.z), note.z),
      visible,
      visual.root.rotation.y,
      arena,
    );
    effectRoot = scene.children.find((node) => !before.has(node)) ?? effectRoot;
    emitted = true;
    return accepted;
  }
  function step(milliseconds) {
    for (let elapsed = 0; elapsed < milliseconds; elapsed += 10) {
      const dt = Math.min(10, milliseconds - elapsed),
        before = seconds;
      visual.update(dt, input);
      manager.update(dt);
      seconds += dt / 1000;
      if (!emitted && before < note.at && seconds >= note.at - 1e-9) {
        if (effectsEnabled) emit(seconds);
        else emitted = true;
      }
    }
    render();
  }
  function effectOnly(age, visible = true, options = {}) {
    reset(options);
    visual.root.visible = false;
    seconds = note.at + age;
    emit(seconds, visible);
    render();
    return state();
  }
  function effectTimeline(options = {}) {
    effectOnly(0, true, options);
    const samples = [];
    for (let frame = 0; frame <= 180; frame++) {
      if (frame) {
        manager.update(1000 / 30);
        seconds += 1 / 30;
      }
      const sample = state(),
        clearances = sample.objects.flatMap((object) => object.stoneSurfaceClearances);
      samples.push({
        age: frame / 30,
        count: sample.stoneCount,
        finite: sample.finite,
        highestStone: sample.highestStone,
        lowestStone: sample.lowestStone,
        minimumSurfaceClearance: clearances.length ? Math.min(...clearances) : null,
        arenaCoverage: sample.arenaCoverage,
      });
    }
    manager.update(4000);
    seconds += 4;
    const rest = state(),
      clearances = rest.objects.flatMap((object) => object.stoneSurfaceClearances);
    render();
    return {
      options,
      samples,
      rest: {
        ...rest,
        stoneContact: { minimum: Math.min(...clearances), maximum: Math.max(...clearances) },
      },
    };
  }
  function state() {
    scene.updateMatrixWorld(true);
    let finite = true,
      skinMeshes = 0;
    scene.traverse((node) => {
      finite &&= node.matrixWorld.elements.every(Number.isFinite);
      if (node.isSkinnedMesh) {
        skinMeshes++;
        finite &&= node.skeleton.boneMatrices.every(Number.isFinite);
      }
    });
    const objects = [],
      stoneBox = new THREE.Box3(),
      point = new THREE.Vector3(),
      matrix = new THREE.Matrix4();
    let lowestStone = Infinity,
      highestStone = -Infinity,
      stoneCount = 0,
      maxStoneVertexArenaRadius = 0;
    const sectors = Array(16).fill(0),
      radialBands = Array(8).fill(0),
      cells = Array(128).fill(0);
    effectRoot?.traverse((node) => {
      if (!node.isMesh && !node.isPoints) return;
      if (node.geometry?.attributes.position)
        finite &&= node.geometry.attributes.position.array.every(Number.isFinite);
      let activeInstances = 0,
        instanceHeights = [],
        stoneSurfaceClearances = [],
        stonePositions = [];
      let groundSurfaceClearance = null;
      if (node.isInstancedMesh) {
        finite &&= node.instanceMatrix.array.every(Number.isFinite);
        node.geometry.computeBoundingBox();
        for (let i = 0; i < node.count; i++) {
          node.getMatrixAt(i, matrix);
          if (Math.abs(matrix.determinant()) < 1e-12) continue;
          activeInstances++;
          stoneCount++;
          instanceHeights.push(matrix.elements[13]);
          matrix.premultiply(node.matrixWorld);
          const x = matrix.elements[12] - arena.center.x,
            z = matrix.elements[14] - arena.center.z;
          const r = Math.hypot(x, z),
            angle = (Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2);
          const sector = Math.min(15, Math.floor((angle / (Math.PI * 2)) * 16));
          const band = Math.min(7, Math.floor((r / arena.radius) * 8));
          sectors[sector]++;
          radialBands[band]++;
          cells[sector * 8 + band]++;
          stonePositions.push([matrix.elements[12], matrix.elements[13], matrix.elements[14]]);
          stoneBox.copy(node.geometry.boundingBox).applyMatrix4(matrix);
          lowestStone = Math.min(lowestStone, stoneBox.min.y);
          highestStone = Math.max(highestStone, stoneBox.max.y);
          let clearance = Infinity;
          const vertices = node.geometry.attributes.position;
          for (let vertex = 0; vertex < vertices.count; vertex++) {
            point.fromBufferAttribute(vertices, vertex).applyMatrix4(matrix);
            clearance = Math.min(clearance, point.y - groundHeight(point.x, point.z));
            maxStoneVertexArenaRadius = Math.max(
              maxStoneVertexArenaRadius,
              Math.hypot(point.x - arena.center.x, point.z - arena.center.z),
            );
          }
          stoneSurfaceClearances.push(clearance);
        }
      } else if (
        node.name === 'Voidmaul_AttackCrater' ||
        node.name === 'Voidmaul_AttackGroundCracks' ||
        node.name === 'Voidmaul_AttackShockwave'
      ) {
        groundSurfaceClearance = { minimum: Infinity, maximum: -Infinity };
        const vertices = node.geometry.attributes.position;
        for (let vertex = 0; vertex < vertices.count; vertex++) {
          point.fromBufferAttribute(vertices, vertex).applyMatrix4(node.matrixWorld);
          const clearance = point.y - groundHeight(point.x, point.z);
          groundSurfaceClearance.minimum = Math.min(groundSurfaceClearance.minimum, clearance);
          groundSurfaceClearance.maximum = Math.max(groundSurfaceClearance.maximum, clearance);
        }
      }
      objects.push({
        name: node.name,
        type: node.type,
        visible: node.visible,
        instances: node.isInstancedMesh ? node.count : undefined,
        activeInstances,
        points: node.isPoints ? node.geometry.attributes.position.count : undefined,
        opacity: node.material?.opacity,
        fade: node.material?.uniforms?.uFade?.value,
        instanceHeights,
        stoneSurfaceClearances,
        stonePositions,
        groundSurfaceClearance,
      });
    });
    return {
      seconds,
      effectAge: seconds - note.at,
      count: manager.count,
      finite,
      skinMeshes,
      note: { ...note },
      feedback: feedback.map((item) => ({ ...item })),
      objects,
      effectAttached: effectRoot?.parent === scene,
      effectPosition: effectRoot?.position.toArray() ?? null,
      stoneCount,
      lowestStone: Number.isFinite(lowestStone) ? lowestStone : null,
      highestStone: Number.isFinite(highestStone) ? highestStone : null,
      arenaCoverage: {
        sectors,
        radialBands,
        cells,
        occupiedSectors: sectors.filter((n) => n > 0).length,
        occupiedBands: radialBands.filter((n) => n > 0).length,
        occupiedCells: cells.filter((n) => n > 0).length,
        maxStoneVertexArenaRadius,
      },
      attackTime: visual.actions.get('Attack')?.time,
      render: { ...renderer.info.render },
    };
  }
  function soleContact() {
    const prefix = THREE.PropertyBinding.sanitizeNodeName('Voidmaul_ForeFoot.R');
    let mesh;
    visual.root.traverse((node) => {
      if (node.isSkinnedMesh && node.name.startsWith(prefix)) mesh = node;
    });
    if (!mesh?.isSkinnedMesh) throw new Error('Missing production ForeFoot.R');
    scene.updateMatrixWorld(true);
    mesh.skeleton.update();
    const point = new THREE.Vector3(),
      points = [],
      positions = mesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      mesh.getVertexPosition(i, point);
      points.push(point.clone().applyMatrix4(mesh.matrixWorld));
    }
    const floor = Math.min(...points.map((point) => point.y));
    const threshold = 0.002 * VOIDMAUL_SCALE * visual.root.scale.x;
    const sole = points.filter((point) => point.y <= floor + threshold);
    const center = sole
      .reduce((sum, point) => sum.add(point), new THREE.Vector3())
      .divideScalar(sole.length);
    const target = new THREE.Vector3(note.x, center.y, note.z);
    let meshFloor = Infinity;
    visual.root.traverse((part) => {
      if (!part.isSkinnedMesh) return;
      part.skeleton.update();
      for (let i = 0; i < part.geometry.attributes.position.count; i++) {
        part.getVertexPosition(i, point);
        point.applyMatrix4(part.matrixWorld);
        meshFloor = Math.min(meshFloor, point.y);
      }
    });
    return {
      soleVertices: sole.length,
      soleCenter: center.toArray(),
      impactCenter: [note.x, visual.root.position.y, note.z],
      horizontalGap: center.distanceTo(target),
      soleMinimumY: floor,
      meshMinimumY: meshFloor,
    };
  }
  const read = document.createElement('canvas');
  read.width = 1280;
  read.height = 960;
  const readCtx = read.getContext('2d', { willReadFrequently: true });
  function pixels() {
    readCtx.drawImage(renderer.domElement, 0, 0);
    return readCtx.getImageData(0, 0, 1280, 960).data;
  }
  function difference(first, second) {
    let changedPixels = 0,
      absoluteDifference = 0;
    for (let i = 0; i < first.length; i += 4) {
      const delta =
        Math.abs(first[i] - second[i]) +
        Math.abs(first[i + 1] - second[i + 1]) +
        Math.abs(first[i + 2] - second[i + 2]);
      absoluteDifference += delta;
      if (delta > 12) changedPixels++;
    }
    return { changedPixels, absoluteDifference };
  }
  view('elevated_three_quarter');
  reset();
  window.voidmaulAttackSmoke = {
    THREE,
    scene,
    camera,
    renderer,
    reset,
    step,
    state,
    emit,
    view,
    soleContact,
    effectOnly,
    effectTimeline,
    pixels,
    difference,
    render,
    shaderErrors,
    scale: VOIDMAUL_SCALE,
    release: VOIDMAUL_ATTACK_RELEASE_S,
    content: VOIDMAUL_SLAM,
    arena,
    arenaSource: sourceArena,
    effectDuration: VOIDMAUL_ATTACK_FX_DURATION_S,
    maxImpacts: VOIDMAUL_MAX_IMPACTS,
    get visual() {
      return visual;
    },
    get manager() {
      return manager;
    },
    get effectRoot() {
      return effectRoot;
    },
  };
}

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
    if (request.url() === `${origin}/models/creatures/voidmaul.glb`)
      void request.respond({ status: 200, contentType: 'model/gltf-binary', body: modelBytes });
    else if (request.url() === `${origin}/__voidmaul_attack_smoke`)
      void request.respond({
        status: 200,
        contentType: 'text/html',
        body:
          '<!doctype html><body style="margin:0;background:#101920"><script type="module">(' +
          browserMain.toString() +
          ')();</script></body>',
      });
    else void request.continue();
  });
  await page.goto(`${origin}/__voidmaul_attack_smoke`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction(() => window.voidmaulAttackSmoke, { timeout: 60000 });
  Object.assign(
    report,
    await page.evaluate(() => {
      const s = window.voidmaulAttackSmoke;
      return {
        modelScale: s.scale,
        holderScale: 1.1,
        worldScale: s.scale * 1.1,
        attackReleaseSeconds: s.release,
        effectDurationSeconds: s.effectDuration,
        content: s.content,
        maxImpacts: s.maxImpacts,
        renderedArena: {
          center: s.arena.center.toArray(),
          radius: s.arena.radius,
          translatedSourceCenter: [
            -s.arenaSource.center.x,
            -s.arenaSource.height,
            -s.arenaSource.center.z,
          ],
        },
      };
    }),
  );
  assert.equal(report.attackReleaseSeconds, 1.75);
  assert.equal(report.modelScale, 12.9);
  assert.equal(report.content.radius, 5.5);
  assert.equal(report.content.ascendantRadius, 7.25);
  report.exportComparison = await page.evaluate((metadata) => {
    const s = window.voidmaulAttackSmoke,
      { THREE } = s;
    s.reset({ effectsEnabled: false });
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
            .join(','),
          group = groups.get(key) ?? [];
        group.push({ mesh, index });
        groups.set(key, group);
      }
    });
    const seams = [...groups.values()].filter(
      (group) => new Set(group.map((ref) => ref.mesh.uuid)).size > 1,
    );
    let maxJointGapMetres = 0,
      maxSeamGapMetres = 0,
      jointsChecked = 0;
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
      let jointGap = 0,
        seamGap = 0;
      for (const [name, rows] of Object.entries(sample.bone_matrices_gltf_armature)) {
        const bone = s.visual.root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
        if (!bone) throw new Error(`Missing exported bone ${name}`);
        const expected = new THREE.Vector3(rows[0][3], rows[1][3], rows[2][3]);
        const gap = bone
          .getWorldPosition(new THREE.Vector3())
          .applyMatrix4(inverse)
          .distanceTo(expected);
        if (!Number.isFinite(gap)) throw new Error('Nonfinite native joint comparison');
        jointsChecked++;
        jointGap = Math.max(jointGap, gap);
      }
      for (const group of seams) {
        const first = group[0];
        first.mesh.getVertexPosition(first.index, point);
        point.applyMatrix4(first.mesh.matrixWorld).applyMatrix4(inverse);
        for (const ref of group.slice(1)) {
          ref.mesh.getVertexPosition(ref.index, other);
          other.applyMatrix4(ref.mesh.matrixWorld).applyMatrix4(inverse);
          seamGap = Math.max(seamGap, point.distanceTo(other));
        }
      }
      maxJointGapMetres = Math.max(maxJointGapMetres, jointGap);
      maxSeamGapMetres = Math.max(maxSeamGapMetres, seamGap);
      poses.push({
        clip: sample.clip,
        seconds: sample.seconds,
        maxJointGapMetres: jointGap,
        maxSeamGapMetres: seamGap,
      });
    }
    s.reset();
    return {
      jointsChecked,
      posesChecked: poses.length,
      seamGroups: seams.length,
      maxJointGapMetres,
      maxSeamGapMetres,
      poses,
    };
  }, metadata);
  assert.equal(report.exportComparison.posesChecked, 8);
  assert.equal(report.exportComparison.jointsChecked, 168);
  assert.equal(report.exportComparison.seamGroups, 831);
  assert.ok(report.exportComparison.maxJointGapMetres < 0.003);
  assert.ok(report.exportComparison.maxSeamGapMetres < 0.0001);
  async function png(name) {
    const bytes = await page.evaluate(
      () => window.voidmaulAttackSmoke.renderer.domElement.toDataURL('image/png').split(',')[1],
    );
    await writeFile(`${output}/${name}`, Buffer.from(bytes, 'base64'));
    return bytes;
  }
  report.contactPlacement = await page.evaluate((measureOnly) => {
    const s = window.voidmaulAttackSmoke,
      results = [];
    for (const ascendant of [false, true])
      for (const yaw of [0, 0.9, Math.PI / 2, -Math.PI / 2]) {
        s.reset({ ascendant, yaw, position: [2, 0, -3], effectsEnabled: !measureOnly });
        s.step(1750);
        results.push({ ascendant, yaw, ...s.soleContact(), ...s.state() });
      }
    return results;
  }, measureOnly);
  for (const pose of report.contactPlacement) {
    assert.ok(pose.horizontalGap < 0.001, `Impact missed paw: ${JSON.stringify(pose)}`);
    assert.ok(pose.meshMinimumY > -0.005);
    if (!measureOnly) {
      assert.equal(pose.feedback.length, 1);
      assert.equal(pose.count, 1);
    }
  }
  console.log(
    'Contact placement: ' +
      JSON.stringify(
        report.contactPlacement.map((pose) => ({
          ascendant: pose.ascendant,
          yaw: pose.yaw,
          horizontalGap: pose.horizontalGap,
          soleCenter: pose.soleCenter,
          impactCenter: pose.impactCenter,
        })),
      ),
  );
  if (!measureOnly) {
    report.lifecycle = await page.evaluate(() => {
      const s = window.voidmaulAttackSmoke;
      s.reset();
      s.step(1700);
      const before = s.state();
      s.step(50);
      const contact = s.state();
      const duplicateAccepted = s.emit();
      s.visual.root.position.set(-12, 0, -10);
      s.visual.root.rotation.y = 1.7;
      s.step(1200);
      const afterMovement = s.state();
      s.effectOnly(10);
      const late = s.state();
      const lateDuplicate = s.emit();
      s.effectOnly(0, false);
      const hidden = s.state();
      const hiddenReplay = s.emit(1.75, true);
      s.effectOnly(s.effectDuration);
      const expiredStart = s.state();
      s.effectOnly(s.effectDuration - 0.01);
      s.manager.update(20);
      s.render();
      const removed = s.state();
      return {
        before,
        contact,
        duplicateAccepted,
        afterMovement,
        late,
        lateDuplicate,
        hidden,
        hiddenReplay,
        expiredStart,
        removed,
      };
    });
    assert.equal(report.lifecycle.before.count, 0);
    assert.equal(report.lifecycle.before.feedback.length, 0);
    assert.equal(report.lifecycle.contact.feedback.length, 1);
    assert.equal(report.lifecycle.duplicateAccepted, false);
    assert.deepEqual(
      report.lifecycle.afterMovement.effectPosition,
      report.lifecycle.contact.effectPosition,
    );
    assert.equal(report.lifecycle.late.feedback.length, 0);
    assert.equal(report.lifecycle.lateDuplicate, false);
    assert.equal(report.lifecycle.hidden.count, 0);
    assert.equal(report.lifecycle.hiddenReplay, false);
    assert.equal(report.lifecycle.expiredStart.count, 0);
    assert.equal(report.lifecycle.removed.count, 0);
    assert.equal(report.lifecycle.removed.effectAttached, false);

    report.readability = await page.evaluate(() => {
      const s = window.voidmaulAttackSmoke;
      return [1.83, 1.95, 2.15, 2.45, 2.8, 3.2, 4, 5.5].map((seconds) => {
        s.reset();
        s.step(seconds * 1000);
        const both = s.pixels();
        s.visual.root.visible = false;
        s.render();
        const fxOnly = s.pixels();
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
        const withFx = s.difference(both, fxOnly),
          withoutFx = s.difference(modelOnly, floorOnly);
        return {
          ...s.state(),
          seconds,
          withFx,
          withoutFx,
          visiblePixelRatio: withFx.changedPixels / Math.max(1, withoutFx.changedPixels),
        };
      });
    });
    for (const sample of report.readability) {
      assert.ok(sample.finite);
      assert.ok(sample.visiblePixelRatio > 0.65, `Debris/dust obscured body: ${sample.seconds}`);
    }
    const peak = report.readability.find((sample) => sample.seconds === 2.15);
    assert.equal(peak.stoneCount, 128);
    assert.ok(
      Math.max(...report.readability.map((sample) => sample.highestStone)) > 10,
      'The stronger burst should throw fragments above the previous 7.15m peak',
    );
    assert.equal(peak.objects.find((object) => object.name === 'Voidmaul_AttackDust').points, 112);
    assert.equal(
      peak.objects.find((object) => object.name === 'Voidmaul_AttackSparks').points,
      128,
    );
    report.arenaTrajectories = await page.evaluate(() => {
      const s = window.voidmaulAttackSmoke,
        results = [];
      for (const ascendant of [false, true])
        for (const yaw of [0, 0.9, Math.PI / 2]) results.push(s.effectTimeline({ ascendant, yaw }));
      results.push(s.effectTimeline({ position: [9, 0, 0], yaw: 0 }));
      return results;
    });
    for (const trajectory of report.arenaTrajectories) {
      for (const sample of trajectory.samples) {
        assert.ok(sample.finite);
        assert.ok(
          sample.arenaCoverage.maxStoneVertexArenaRadius <= report.arenaSource.radius + 0.001,
          'Rock trajectory escaped arena: ' +
            JSON.stringify({
              options: trajectory.options,
              age: sample.age,
              r: sample.arenaCoverage.maxStoneVertexArenaRadius,
            }),
        );
        if (sample.count) assert.ok(sample.minimumSurfaceClearance >= 0.003);
      }
      assert.equal(trajectory.rest.stoneCount, 128);
      assert.equal(trajectory.rest.arenaCoverage.occupiedSectors, 16);
      assert.equal(trajectory.rest.arenaCoverage.occupiedBands, 8);
      assert.equal(trajectory.rest.arenaCoverage.occupiedCells, 128);
      assert.ok(trajectory.rest.stoneContact.minimum >= 0.004);
      assert.ok(trajectory.rest.stoneContact.maximum <= 0.006);
    }
    report.terrainConformation = await page.evaluate(() => {
      const s = window.voidmaulAttackSmoke,
        results = [];
      for (const ascendant of [false, true])
        for (const yaw of [0, 0.9, Math.PI / 2])
          for (const age of [0.2, 0.7, 1.5, 3, 10]) {
            s.effectOnly(age, true, {
              ascendant,
              yaw,
              position: [2, 0, -3],
              groundProfile: 'stepped',
            });
            results.push({ ascendant, yaw, age, ...s.state() });
          }
      return results;
    });
    for (const sample of report.terrainConformation) {
      assert.ok(sample.finite);
      for (const object of sample.objects) {
        for (const clearance of object.stoneSurfaceClearances)
          assert.ok(
            clearance >= 0.003,
            'Rock surface penetrated terrain: ' +
              JSON.stringify({
                age: sample.age,
                yaw: sample.yaw,
                ascendant: sample.ascendant,
                clearance,
              }),
          );
        if (sample.age === 10)
          for (const clearance of object.stoneSurfaceClearances)
            assert.ok(clearance <= 0.006, 'Settled terrain rock floated above its support');
        if (object.groundSurfaceClearance) {
          const expected =
            object.name === 'Voidmaul_AttackCrater'
              ? 0.018
              : object.name === 'Voidmaul_AttackGroundCracks'
                ? 0.02
                : 0.035;
          assert.ok(Math.abs(object.groundSurfaceClearance.minimum - expected) < 0.00001);
          assert.ok(Math.abs(object.groundSurfaceClearance.maximum - expected) < 0.00001);
        }
      }
    }

    const sheetPage = await browser.newPage();
    for (const view of ['elevated_three_quarter', 'arena_top', 'front']) {
      await page.evaluate((view) => {
        const s = window.voidmaulAttackSmoke;
        s.view(view);
        s.reset();
      }, view);
      let previous = 0;
      const frames = [];
      report.stages[view] = [];
      for (let index = 0; index < stages.length; index++) {
        const seconds = stages[index];
        const state = await page.evaluate((delta) => {
          const s = window.voidmaulAttackSmoke;
          s.step(delta * 1000);
          return s.state();
        }, seconds - previous);
        assert.ok(state.finite);
        const filename = `attack_${view}_${String(index).padStart(2, '0')}.png`;
        frames.push({ seconds, image: await png(filename) });
        report.stages[view].push({ ...state, seconds, filename });
        previous = seconds;
        console.log(`Attack ${view}: ${seconds.toFixed(2)} s`);
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
              y = 44 + Math.floor(i / 4) * 328,
              img = new Image();
            img.src = `data:image/png;base64,${frames[i].image}`;
            await img.decode();
            ctx.font = '17px sans-serif';
            ctx.fillText(`${frames[i].seconds.toFixed(2)} s`, x + 10, y + 20);
            ctx.drawImage(img, x, y + 28, 400, 300);
          }
          return canvas.toDataURL('image/png').split(',')[1];
        },
        {
          frames,
          title:
            'Voidmaul Attack | ' +
            view +
            ' | StarOrchard radius ' +
            report.arenaSource.radius +
            'm',
        },
      );
      await writeFile(`${output}/attack_${view}_sheet.png`, Buffer.from(sheet, 'base64'));
    }
    await sheetPage.close();
    report.scarPersistence = [];
    for (const age of [10, 25, 29, 30, 33.5]) {
      const scar = await page.evaluate((age) => {
        const s = window.voidmaulAttackSmoke;
        s.effectOnly(age);
        const withScar = s.pixels();
        s.effectRoot.visible = false;
        s.render();
        const bare = s.pixels();
        s.effectRoot.visible = true;
        s.render();
        return { age, pixelDifference: s.difference(withScar, bare), ...s.state() };
      }, age);
      assert.equal(scar.count, 1);
      assert.ok(scar.pixelDifference.changedPixels > 100);
      const clearances = scar.objects.flatMap((object) => object.stoneSurfaceClearances);
      assert.equal(clearances.length, 128);
      scar.stoneContact = { minimum: Math.min(...clearances), maximum: Math.max(...clearances) };
      for (const clearance of clearances)
        assert.ok(
          clearance >= 0.004 && clearance <= 0.006,
          `Settled rock missed floor: ${JSON.stringify({ age, clearance })}`,
        );
      const filename = `scar_${String(age).replace('.', '_')}s_without_boss.png`;
      await png(filename);
      report.scarPersistence.push({ filename, ...scar });
    }
    await page.evaluate(() => {
      const s = window.voidmaulAttackSmoke;
      s.view('elevated_three_quarter');
      s.reset();
    });
    let previous = 0;
    report.previewStates = [];
    for (let frame = 0; frame < frameCount; frame++) {
      const seconds = frame / fps;
      const state = await page.evaluate((delta) => {
        const s = window.voidmaulAttackSmoke;
        s.step(delta * 1000);
        return s.state();
      }, seconds - previous);
      assert.ok(state.finite);
      await png(`frames/frame_${String(frame).padStart(4, '0')}.png`);
      report.previewStates.push({ ...state, frame, seconds });
      previous = seconds;
      if (frame % fps === 0)
        console.log(`Preview ${frame}/${frameCount - 1}: ${seconds.toFixed(2)} s`);
    }
    report.shaderErrors = await page.evaluate(() => window.voidmaulAttackSmoke.shaderErrors);
    assert.deepEqual(report.shaderErrors, []);
    assert.deepEqual(report.errors, []);
    report.finalSourceHashes = await hashes();
    if (!quick)
      assert.deepEqual(
        report.finalSourceHashes,
        pinned,
        'Production sources changed during capture; rerun final validation',
      );
    report.fullClipCaptured = !quick;
  }
  report.passed = true;
  console.log(`Voidmaul Attack WebGL smoke passed: ${output}`);
} catch (error) {
  report.passed = false;
  report.failure = error.stack;
  throw error;
} finally {
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
