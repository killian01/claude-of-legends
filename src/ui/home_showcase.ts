// The home screen's living backdrop: a cinematic night stage behind the
// menu card. A handful of champions stand in a moonlit clearing over a
// glowing rune circle, ground mist drifts through, embers float up, and the
// camera drifts slowly; one of them swings now and then. Benchmarked
// against the big genre launchers: no gameplay UI on stage (no team rings),
// low heroic camera, strong rim light, layered atmosphere. Pure
// presentation; the returned stop() tears the canvas and the GPU resources
// down when the home screen resolves.

import * as THREE from 'three';
import { createChampionVisual, preloadChampionAssets } from '../render/champions';
import { CHAMPION_VISUALS } from '../render/champions/manifest';
import type { ChampionVisual } from '../render/champions/visual';
import { toonifyMaterials } from '../render/toon';

// Soft radial glow texture shared by the moon, embers, and mist sprites.
function glowTexture(inner: string, outer: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, inner);
    grad.addColorStop(1, outer);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}

export function startHomeShowcase(host: HTMLElement): () => void {
  const gl = new THREE.WebGLRenderer({ antialias: true });
  gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  gl.setSize(host.clientWidth || window.innerWidth, host.clientHeight || window.innerHeight);
  gl.domElement.className = 'menu-showcase-canvas';
  host.appendChild(gl.domElement);

  const scene = new THREE.Scene();
  // Deep night-blue stage, matching the menu's navy theme.
  scene.background = new THREE.Color(0x0a1120);
  scene.fog = new THREE.Fog(0x0a1120, 14, 34);
  scene.add(new THREE.HemisphereLight(0xbdd8ff, 0x141d33, 0.7));
  const key = new THREE.DirectionalLight(0xffe0b0, 1.7);
  key.position.set(6, 10, 8);
  scene.add(key);
  // A hard cool rim from behind sells the silhouettes against the dark.
  const rim = new THREE.DirectionalLight(0x86b8f0, 2.4);
  rim.position.set(-6, 6, -8);
  scene.add(rim);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(70, 48),
    new THREE.MeshLambertMaterial({ color: 0x121d33 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  toonifyMaterials(scene);

  const disposables: (THREE.Texture | THREE.Material | THREE.BufferGeometry)[] = [];
  const track = <T extends THREE.Texture | THREE.Material | THREE.BufferGeometry>(r: T): T => {
    disposables.push(r);
    return r;
  };

  // The moon and its halo, hanging over the lineup's shoulder.
  const moonTex = track(glowTexture('rgba(235, 242, 255, 1)', 'rgba(235, 242, 255, 0)'));
  const moon = new THREE.Sprite(
    track(
      new THREE.SpriteMaterial({
        map: moonTex,
        color: 0xdce8ff,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        fog: false,
      }),
    ),
  );
  moon.position.set(13, 10.5, -22);
  moon.scale.setScalar(7);
  scene.add(moon);
  const halo = new THREE.Sprite(
    track(
      new THREE.SpriteMaterial({
        map: moonTex,
        color: 0x6a8ecc,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    ),
  );
  halo.position.copy(moon.position);
  halo.scale.setScalar(18);
  scene.add(halo);

  // The rune circle the honor guard stands on: two glowing rings plus a
  // faint filled disc, pulsing slowly in the frame loop.
  const runeMat = track(
    new THREE.MeshBasicMaterial({
      color: 0x5b8fd9,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  const runeGroup = new THREE.Group();
  const ringOuter = new THREE.Mesh(track(new THREE.RingGeometry(7.0, 7.18, 72)), runeMat);
  const ringInner = new THREE.Mesh(track(new THREE.RingGeometry(5.6, 5.68, 64)), runeMat);
  const runeDisc = new THREE.Mesh(
    track(new THREE.CircleGeometry(7.0, 64)),
    track(
      new THREE.MeshBasicMaterial({
        color: 0x2a4a80,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
      }),
    ),
  );
  // Tick marks around the outer ring, in place of glyphs (ADR 0004: no
  // borrowed iconography, just abstract geometry).
  for (let i = 0; i < 12; i++) {
    const tick = new THREE.Mesh(track(new THREE.PlaneGeometry(0.1, 0.55)), runeMat);
    const a = (i / 12) * Math.PI * 2;
    tick.position.set(Math.cos(a) * 6.35, 0, Math.sin(a) * 6.35);
    tick.rotation.z = -a;
    runeGroup.add(tick);
  }
  runeGroup.add(ringOuter, ringInner, runeDisc);
  runeGroup.rotation.x = -Math.PI / 2;
  runeGroup.position.set(6.4, 0.04, 1);
  scene.add(runeGroup);

  // Ground mist: wide soft sprites drifting sideways through the lineup.
  const mistTex = track(glowTexture('rgba(140, 170, 220, 0.55)', 'rgba(140, 170, 220, 0)'));
  const mists: { sprite: THREE.Sprite; speed: number; phase: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const sprite = new THREE.Sprite(
      track(
        new THREE.SpriteMaterial({
          map: mistTex,
          transparent: true,
          opacity: 0.16,
          depthWrite: false,
        }),
      ),
    );
    sprite.position.set(-2 + i * 4.2, 0.5 + (i % 2) * 0.4, -1.5 + (i % 3) * 2.2);
    sprite.scale.set(9 + (i % 3) * 3, 2.6, 1);
    scene.add(sprite);
    mists.push({ sprite, speed: 0.00018 + (i % 3) * 0.0001, phase: i * 1.7 });
  }

  // Floating embers rising through the moonlight.
  const emberTex = track(glowTexture('rgba(255, 230, 190, 1)', 'rgba(255, 230, 190, 0)'));
  const embers: { sprite: THREE.Sprite; speed: number; sway: number; phase: number }[] = [];
  for (let i = 0; i < 36; i++) {
    const sprite = new THREE.Sprite(
      track(
        new THREE.SpriteMaterial({
          map: emberTex,
          color: i % 3 === 0 ? 0xffd9a0 : 0x9fc4f5,
          transparent: true,
          opacity: 0.5 + Math.random() * 0.4,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      ),
    );
    sprite.position.set(-4 + Math.random() * 22, Math.random() * 7, -6 + Math.random() * 12);
    sprite.scale.setScalar(0.06 + Math.random() * 0.12);
    scene.add(sprite);
    embers.push({
      sprite,
      speed: 0.25 + Math.random() * 0.5,
      sway: 0.2 + Math.random() * 0.5,
      phase: Math.random() * Math.PI * 2,
    });
  }

  const camera = new THREE.PerspectiveCamera(
    38,
    (host.clientWidth || 1) / (host.clientHeight || 1),
    0.1,
    80,
  );

  preloadChampionAssets(gl);
  const visuals: ChampionVisual[] = [];
  // A fresh honor guard every visit; slots fan out to the right of the
  // menu card, front row closer and larger. No team rings on stage.
  const ids = Object.keys(CHAMPION_VISUALS)
    .map((id) => ({ id, k: Math.random() }))
    .sort((a, b) => a.k - b.k)
    .slice(0, 4)
    .map((x) => x.id);
  const slots = [
    { x: 2.8, z: 2.0, yaw: -0.25 },
    { x: 5.6, z: -0.4, yaw: -0.4 },
    { x: 8.8, z: 2.2, yaw: -0.55 },
    { x: 11.8, z: -0.8, yaw: -0.7 },
  ];
  for (const [i, id] of ids.entries()) {
    void createChampionVisual(id, i % 2 === 0 ? 0x4a7dd6 : 0xd65c5c, 0, { ring: false }).then(
      (v) => {
        if (!v || stopped) return;
        const slot = slots[i] ?? slots[0]!;
        v.root.position.set(slot.x, 0, slot.z);
        v.root.rotation.y = slot.yaw;
        toonifyMaterials(v.root);
        scene.add(v.root);
        visuals.push(v);
      },
    );
  }

  let stopped = false;
  let raf = 0;
  let last = performance.now();
  let nextSwing = last + 2500;
  const frame = (now: number): void => {
    if (stopped) return;
    const dt = Math.min(100, now - last);
    last = now;
    // Low heroic drift: the camera glides at chest height, far enough back
    // that the whole lineup composes, like a launcher key shot.
    const t = now * 0.00006;
    camera.position.set(6.4 + Math.sin(t) * 1.6, 2.5 + Math.sin(t * 0.7) * 0.2, 12.2);
    camera.lookAt(6.4, 1.6, 0);
    if (now > nextSwing && visuals.length > 0) {
      nextSwing = now + 2800 + Math.random() * 2600;
      visuals[Math.floor(Math.random() * visuals.length)]?.playAttack();
    }
    for (const v of visuals) v.update(dt, { moving: false, windingUp: false, dead: false });
    // Atmosphere upkeep: the rune circle breathes, mist drifts, embers rise.
    runeMat.opacity = 0.38 + 0.14 * Math.sin(now * 0.0011);
    runeGroup.rotation.z = now * 0.00006;
    for (const m of mists) {
      m.sprite.position.x += Math.sin(now * m.speed + m.phase) * 0.003 * dt;
    }
    for (const e of embers) {
      e.sprite.position.y += e.speed * (dt / 1000);
      e.sprite.position.x += Math.sin(now * 0.0008 + e.phase) * e.sway * (dt / 1000);
      if (e.sprite.position.y > 8) e.sprite.position.y = 0;
    }
    gl.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  const onResize = (): void => {
    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;
    gl.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    for (const v of visuals) {
      v.dispose();
      v.root.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          const mat = mesh.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mat)) for (const m of mat) m.dispose();
          else mat.dispose();
        }
        const skinned = child as THREE.SkinnedMesh;
        if (skinned.isSkinnedMesh) skinned.skeleton.dispose();
      });
    }
    for (const r of disposables) r.dispose();
    gl.dispose();
    gl.domElement.remove();
  };
}
