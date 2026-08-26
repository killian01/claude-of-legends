// Three.js top-down renderer. Reads the world through IWorld only and never
// mutates it. Static map geometry is built once; units, projectiles, and
// zones are synced each sim tick, and moving things are interpolated between
// ticks for smooth motion.

import * as THREE from 'three';
import { playSfx } from '../game/sfx';
import { isRooted, isStunned } from '../sim/combat/status';
import type { Vec2 } from '../sim/types';
import type { Unit } from '../sim/unit';
import type { IWorld } from '../world_api';
import { buildChampionMesh } from './champion_shapes';
import { FloatingText, makeTextSprite } from './floating_text';
import { buildMapDressing, type MapDressing, SKIRT_COLOR } from './map_dressing';
import { buildSanctumMesh, buildTowerMesh } from './structure_shapes';

const TEAM_COLORS: readonly number[] = [0x4a7dd6, 0xd65c5c];
const TEAM_LIGHT: readonly number[] = [0x9dbcf5, 0xf5a3a3];

// Background and fog share the forest-skirt tone so the world edge melts
// into haze instead of ending on a void.
const COLOR_BACKGROUND = SKIRT_COLOR;
const COLOR_BAR_BACK = 0x1a1a1a;

function enableShadows(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) child.castShadow = true;
  });
}

// Structure crystals tagged userData.spin turn slowly in the render loop.
function collectSpinners(holder: THREE.Object3D): void {
  const spinners: THREE.Object3D[] = [];
  holder.traverse((c) => {
    if (c.userData.spin) spinners.push(c);
  });
  if (spinners.length > 0) holder.userData.spinners = spinners;
}

// Releases the GPU resources of a removed object tree; geometries flagged
// userData.sharedGeo are pooled and survive.
function disposeDeep(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const c = child as THREE.Mesh & THREE.Sprite & { isMesh?: boolean; isSprite?: boolean };
    if (c.isMesh) {
      if (!child.userData.sharedGeo) (c.geometry as THREE.BufferGeometry | undefined)?.dispose();
      const mat = c.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) for (const m of mat) m.dispose();
      else mat?.dispose();
    } else if (c.isSprite) {
      const mat = c.material as THREE.SpriteMaterial | undefined;
      mat?.map?.dispose();
      mat?.dispose();
    }
  });
}

interface TrackedUnit {
  mesh: THREE.Object3D;
  kind: string;
  hpFill: THREE.Sprite;
  hpBack: THREE.Sprite;
  barWidth: number;
  barY: number;
  lastHp: number;
  stunMark: THREE.Sprite | null;
  rootMark: THREE.Mesh | null;
  namePlate: THREE.Sprite | null;
  nameKey: string;
  prev: Vec2;
  curr: Vec2;
}

export interface CombatNotes {
  golds: readonly number[];
  casts: readonly number[];
}

interface TrackedMobile {
  mesh: THREE.Object3D;
  prev: Vec2;
  curr: Vec2;
}

export class Renderer {
  private readonly world: IWorld;
  private readonly gl: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly unitLayer = new THREE.Group();
  private readonly tracked = new Map<number, TrackedUnit>();
  private readonly trackedProjectiles = new Map<number, TrackedMobile>();
  private readonly trackedZones = new Map<number, THREE.Object3D>();
  private readonly cameraOffset = new THREE.Vector3(0, 40, 24);
  private readonly markerGeometry = new THREE.RingGeometry(0.5, 0.8, 24);
  private readonly rootGeometry = new THREE.RingGeometry(0.7, 0.95, 18);
  private readonly markers: {
    mesh: THREE.Mesh;
    material: THREE.MeshBasicMaterial;
    bornAt: number;
  }[] = [];
  private readonly fct: FloatingText;
  private readonly selfRing: THREE.Mesh;
  private readonly fogCanvas = document.createElement('canvas');
  private readonly fogTexture: THREE.CanvasTexture;
  private readonly dying: { mesh: THREE.Object3D; start: number }[] = [];
  private zoom = 1;
  private followId: number | null = null;
  private viewerTeam = 0;
  private dressing: MapDressing | null = null;

  constructor(container: HTMLElement, world: IWorld) {
    this.world = world;
    this.gl = new THREE.WebGLRenderer({ antialias: true });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.setSize(container.clientWidth, container.clientHeight);
    this.gl.shadowMap.enabled = true;
    // Plain PCF, not PCFSoft: it is the kernel that honors shadow.radius.
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.18;
    container.appendChild(this.gl.domElement);
    this.scene.background = new THREE.Color(COLOR_BACKGROUND);
    this.scene.fog = new THREE.Fog(COLOR_BACKGROUND, 120, 300);
    this.scene.add(this.unitLayer);

    // A cheap display grade: slight saturation and contrast on the canvas
    // plus a vignette overlay. The HUD lives outside this container.
    this.gl.domElement.style.filter = 'saturate(1.08) contrast(1.05)';
    if (!container.style.position) container.style.position = 'relative';
    const vignette = document.createElement('div');
    vignette.style.cssText =
      'position:absolute;inset:0;pointer-events:none;' +
      'background:radial-gradient(ellipse at center, transparent 55%, rgba(8,12,5,0.3) 100%);';
    container.appendChild(vignette);

    const aspect = container.clientWidth / Math.max(1, container.clientHeight);
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 500);

    window.addEventListener('resize', () => {
      this.gl.setSize(container.clientWidth, container.clientHeight);
      this.camera.aspect = container.clientWidth / Math.max(1, container.clientHeight);
      this.camera.updateProjectionMatrix();
    });

    // Mouse-wheel zoom within sane bounds.
    this.gl.domElement.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom = Math.max(0.65, Math.min(1.45, this.zoom + e.deltaY * 0.0008));
      },
      { passive: false },
    );

    // Fog-of-war ground overlay: dark where the viewer's team has no sight.
    this.fogCanvas.width = 128;
    this.fogCanvas.height = 128;
    this.fogTexture = new THREE.CanvasTexture(this.fogCanvas);
    const fogMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(world.map.size, world.map.size),
      new THREE.MeshBasicMaterial({
        map: this.fogTexture,
        transparent: true,
        depthWrite: false,
        // Scene haze must not lighten the fog of war.
        fog: false,
      }),
    );
    fogMesh.rotation.x = -Math.PI / 2;
    // High enough that grass blades and boulders sit under the fog sheet
    // instead of poking through it fully lit.
    fogMesh.position.set(world.map.size / 2, 2.6, world.map.size / 2);
    this.scene.add(fogMesh);

    this.fct = new FloatingText(this.scene);
    this.selfRing = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1.05, 28),
      new THREE.MeshBasicMaterial({ color: 0x86e06d, transparent: true, opacity: 0.8 }),
    );
    this.selfRing.rotation.x = -Math.PI / 2;
    this.selfRing.position.y = 0.07;
    this.selfRing.visible = false;
    this.scene.add(this.selfRing);

    this.buildLights();
    this.buildMap();
    this.onSimTick();
    // First sync has no history: snap prev onto curr so nothing lerps from 0,0.
    for (const t of this.tracked.values()) t.prev = { ...t.curr };
  }

  get domElement(): HTMLCanvasElement {
    return this.gl.domElement;
  }

  followUnit(id: number): void {
    this.followId = id;
  }

  // The team whose fog of war this client renders.
  setViewerTeam(team: number): void {
    this.viewerTeam = team;
  }

  // A brief ground ring: move orders (green) and cast flashes (team tint).
  flashMarker(x: number, z: number, color = 0x9be86a): void {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.markerGeometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.15, z);
    this.scene.add(mesh);
    this.markers.push({ mesh, material, bornAt: performance.now() });
  }

  // One-shot combat notes from world events: gold popups over the followed
  // champion, cast flashes on visible casters.
  onCombatNotes(notes: CombatNotes): void {
    const self = this.followId !== null ? this.world.units.get(this.followId) : undefined;
    for (const amount of notes.golds) {
      playSfx('gold');
      if (self) this.fct.spawn(`+${amount}g`, '#ffd94a', self.pos.x, 3.4, self.pos.z, 0.9);
    }
    if (notes.casts.length > 0) playSfx('cast');
    for (const casterId of notes.casts) {
      const caster = this.world.units.get(casterId);
      if (!caster) continue;
      // Offline guard: never flash a cast the viewer's team cannot see.
      if (!this.world.isVisible(this.viewerTeam as 0 | 1, casterId)) continue;
      const color = caster.team === this.viewerTeam ? 0x9dbcf5 : 0xf5a3a3;
      this.flashMarker(caster.pos.x, caster.pos.z, color);
    }
  }

  private buildLights(): void {
    // Warm golden key against a cool sky fill and a green ground bounce:
    // the color contrast between key and fill does most of the work.
    this.scene.add(new THREE.HemisphereLight(0xdcefff, 0x465f39, 1.15));
    const sun = new THREE.DirectionalLight(0xffdfaa, 2.4);
    const half = this.world.map.size / 2;
    sun.position.set(half + 70, 120, half - 45);
    sun.target.position.set(half, 0, half);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 30;
    sun.shadow.camera.far = 330;
    const s = 115;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = 2.25;
    this.scene.add(sun, sun.target);
  }

  private buildMap(): void {
    this.dressing = buildMapDressing(this.scene, this.world.map, TEAM_COLORS, TEAM_LIGHT);
  }

  private buildUnitMesh(u: Readonly<Unit>): { holder: THREE.Group; barY: number } {
    const kind = u.kind;
    const color = TEAM_COLORS[u.team] ?? 0xffffff;
    const holder = new THREE.Group();
    if (kind === 'minion') {
      const ranged = u.stats.attackRange > 2;
      const body = ranged
        ? new THREE.Mesh(
            new THREE.ConeGeometry(0.45, 1.2, 6),
            new THREE.MeshLambertMaterial({ color, flatShading: true }),
          )
        : new THREE.Mesh(
            new THREE.BoxGeometry(0.8, 1.0, 0.8),
            new THREE.MeshLambertMaterial({ color, flatShading: true }),
          );
      body.position.y = 0.6;
      body.castShadow = true;
      holder.add(body);
      return { holder, barY: 1.8 };
    }
    if (kind === 'tower') {
      holder.add(buildTowerMesh(color));
      enableShadows(holder);
      collectSpinners(holder);
      return { holder, barY: 8.6 };
    }
    if (kind === 'sanctum') {
      holder.add(buildSanctumMesh(color));
      enableShadows(holder);
      collectSpinners(holder);
      return { holder, barY: 7.2 };
    }
    holder.add(buildChampionMesh(u.championId, color, u.skin));
    enableShadows(holder);
    return { holder, barY: 3.0 };
  }

  private buildHpBar(
    holder: THREE.Group,
    barY: number,
    width: number,
  ): { fill: THREE.Sprite; back: THREE.Sprite } {
    const back = new THREE.Sprite(new THREE.SpriteMaterial({ color: COLOR_BAR_BACK }));
    back.center.set(0, 0.5);
    back.scale.set(width + 0.14, 0.34, 1);
    back.position.set(-(width + 0.14) / 2, barY, 0);
    const fill = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffffff }));
    fill.center.set(0, 0.5);
    fill.scale.set(width, 0.24, 1);
    fill.position.set(-width / 2, barY, 0);
    holder.add(back, fill);
    return { fill, back };
  }

  // Health bar color by relation to the viewer: green self, blue allies,
  // red enemies (readability review F.3).
  private barColor(unitId: number, team: number): number {
    if (team !== this.viewerTeam) return 0xe0574a;
    return unitId === this.followId ? 0x58d84e : 0x5f96e8;
  }

  // Called once after every sim tick: shifts interpolation history and syncs
  // the mesh sets with the world's units, projectiles, and zones.
  onSimTick(): void {
    const scoreRows = this.world.scoreboard();
    for (const [id, u] of this.world.units) {
      let t = this.tracked.get(id);
      if (!t) {
        const { holder, barY } = this.buildUnitMesh(u);
        const barWidth = u.kind === 'champion' ? 1.8 : u.kind === 'minion' ? 1.0 : 2.2;
        const { fill, back } = this.buildHpBar(holder, barY, barWidth);
        holder.position.set(u.pos.x, 0, u.pos.z);
        holder.userData.unitId = id;
        holder.userData.team = u.team;
        this.unitLayer.add(holder);
        t = {
          mesh: holder,
          kind: u.kind,
          hpFill: fill,
          hpBack: back,
          barWidth,
          barY,
          lastHp: u.hp,
          stunMark: null,
          rootMark: null,
          namePlate: null,
          nameKey: '',
          prev: { x: u.pos.x, z: u.pos.z },
          curr: { x: u.pos.x, z: u.pos.z },
        };
        this.tracked.set(id, t);
      } else {
        t.prev = t.curr;
        t.curr = { x: u.pos.x, z: u.pos.z };
      }
      const visible =
        !u.dead &&
        (u.team === this.viewerTeam || this.world.isVisible(this.viewerTeam as 0 | 1, id));
      t.mesh.visible = visible;

      // Floating damage numbers from hp deltas: no wire cost, works in both
      // hosts, and heals at the fountain stay silent.
      const dhp = t.lastHp - u.hp;
      if (visible && dhp >= 1) {
        const color = u.team === this.viewerTeam ? '#ff6a5e' : '#ffe9a8';
        this.fct.spawn(`-${Math.round(dhp)}`, color, u.pos.x, t.barY + 0.9, u.pos.z);
        if (id === this.followId) playSfx('hit');
      }
      t.lastHp = u.hp;

      // Nameplate: player or bot name plus level, rebuilt on change only.
      if (u.kind === 'champion') {
        const row = scoreRows.find((r) => r.unitId === id);
        const label = `${row?.name ?? u.championId ?? ''}  Lv${u.level}`;
        if (t.nameKey !== label) {
          if (t.namePlate) {
            t.mesh.remove(t.namePlate);
            const mat = t.namePlate.material as THREE.SpriteMaterial;
            mat.map?.dispose();
            mat.dispose();
          }
          const plate = makeTextSprite(
            label,
            u.team === this.viewerTeam ? '#d8ecff' : '#ffd8d2',
            0.55,
            256,
            24,
          );
          if (plate) {
            plate.position.set(0, t.barY + 0.5, 0);
            t.mesh.add(plate);
            t.namePlate = plate;
          }
          t.nameKey = label;
        }
      }

      const frac = Math.max(0, Math.min(1, u.hp / u.maxHp));
      t.hpFill.scale.x = Math.max(0.001, t.barWidth * frac);
      (t.hpFill.material as THREE.SpriteMaterial).color.set(this.barColor(id, u.team));
      // Minion bars only show once damaged, like the genre: less clutter.
      const barVisible = visible && (u.kind !== 'minion' || u.hp < u.maxHp - 1);
      t.hpFill.visible = barVisible;
      t.hpBack.visible = barVisible;

      // Crowd-control telegraphs: a yellow "!" for stuns, a ground ring for
      // roots (fairness rule: never hide actionable state).
      const stunned = visible && isStunned(u, this.world.time);
      if (stunned && !t.stunMark) {
        const mark = makeTextSprite('!', '#ffd94a', 0.8);
        if (mark) {
          mark.position.set(0, t.barY + 0.55, 0);
          t.mesh.add(mark);
          t.stunMark = mark;
        }
      }
      if (t.stunMark) t.stunMark.visible = stunned;
      const rooted = visible && !stunned && isRooted(u, this.world.time);
      if (rooted && !t.rootMark) {
        const ring = new THREE.Mesh(
          this.rootGeometry,
          new THREE.MeshBasicMaterial({ color: 0xb0733a, transparent: true, opacity: 0.85 }),
        );
        ring.userData.sharedGeo = true;
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.09;
        t.mesh.add(ring);
        t.rootMark = ring;
      }
      if (t.rootMark) t.rootMark.visible = rooted;
    }
    for (const [id, t] of this.tracked) {
      if (!this.world.units.has(id)) {
        // Fade out instead of popping, then dispose for real (units churn
        // by the hundreds per match).
        this.dying.push({ mesh: t.mesh, start: performance.now() });
        this.tracked.delete(id);
      }
    }

    for (const [id, p] of this.world.projectiles) {
      const t = this.trackedProjectiles.get(id);
      if (!t) {
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(Math.max(0.25, p.radius), 10, 8),
          new THREE.MeshLambertMaterial({
            color: TEAM_LIGHT[p.team] ?? 0xffffff,
            emissive: TEAM_LIGHT[p.team] ?? 0xffffff,
            emissiveIntensity: 0.5,
          }),
        );
        mesh.position.set(p.pos.x, 1.2, p.pos.z);
        this.scene.add(mesh);
        this.trackedProjectiles.set(id, {
          mesh,
          prev: { x: p.pos.x, z: p.pos.z },
          curr: { x: p.pos.x, z: p.pos.z },
        });
      } else {
        t.prev = t.curr;
        t.curr = { x: p.pos.x, z: p.pos.z };
      }
    }
    for (const [id, t] of this.trackedProjectiles) {
      if (!this.world.projectiles.has(id)) {
        this.scene.remove(t.mesh);
        disposeDeep(t.mesh);
        this.trackedProjectiles.delete(id);
      }
    }

    for (const [id, z] of this.world.zones) {
      if (!this.trackedZones.has(id)) {
        const mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(z.radius, z.radius, 0.15, 24),
          new THREE.MeshLambertMaterial({
            color: TEAM_COLORS[z.team] ?? 0xffffff,
            transparent: true,
            opacity: 0.3,
          }),
        );
        mesh.position.set(z.pos.x, 0.1, z.pos.z);
        this.scene.add(mesh);
        this.trackedZones.set(id, mesh);
      }
    }
    for (const [id, mesh] of this.trackedZones) {
      if (!this.world.zones.has(id)) {
        this.scene.remove(mesh);
        disposeDeep(mesh);
        this.trackedZones.delete(id);
      }
    }

    this.paintFog();
  }

  // Dark ground where the viewer's team has no sight, soft-edged holes
  // around every friendly unit.
  private paintFog(): void {
    const g = this.fogCanvas.getContext('2d');
    if (!g) return;
    const scale = 128 / this.world.map.size;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(0, 0, 0, 0.44)';
    g.fillRect(0, 0, 128, 128);
    g.globalCompositeOperation = 'destination-out';
    for (const u of this.world.units.values()) {
      if (u.team !== this.viewerTeam || u.dead) continue;
      const r = Math.max(4, u.sightRange) * scale;
      const x = u.pos.x * scale;
      const y = u.pos.z * scale;
      const grad = g.createRadialGradient(x, y, r * 0.55, x, y, r);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    this.fogTexture.needsUpdate = true;
  }

  // alpha in [0, 1): progress through the current tick, for interpolation.
  render(alpha: number): void {
    const now = performance.now();
    this.dressing?.animate(now);
    let followPos: THREE.Vector3 | null = null;
    for (const [id, t] of this.tracked) {
      const x = t.prev.x + (t.curr.x - t.prev.x) * alpha;
      const z = t.prev.z + (t.curr.z - t.prev.z) * alpha;
      // A light walk bob for living things on the move.
      const moving =
        Math.abs(t.curr.x - t.prev.x) + Math.abs(t.curr.z - t.prev.z) > 0.02 &&
        (t.kind === 'champion' || t.kind === 'minion');
      const bobY = moving ? Math.abs(Math.sin(now * 0.012 + id)) * 0.12 : 0;
      t.mesh.position.set(x, bobY, z);
      const spinners = t.mesh.userData.spinners as THREE.Object3D[] | undefined;
      if (spinners) for (const sp of spinners) sp.rotation.y = now * 0.0006;
      if (id === this.followId) followPos = new THREE.Vector3(x, 0, z);
    }
    for (const t of this.trackedProjectiles.values()) {
      const x = t.prev.x + (t.curr.x - t.prev.x) * alpha;
      const z = t.prev.z + (t.curr.z - t.prev.z) * alpha;
      t.mesh.position.set(x, 1.2, z);
      const ddx = t.curr.x - t.prev.x;
      const ddz = t.curr.z - t.prev.z;
      if (Math.hypot(ddx, ddz) > 0.01) {
        t.mesh.rotation.y = -Math.atan2(ddz, ddx);
        t.mesh.scale.set(1.7, 0.85, 0.85);
      }
    }
    for (const [id, mesh] of this.trackedZones) {
      const s = 1 + 0.05 * Math.sin(now * 0.006 + id);
      mesh.scale.set(s, 1, s);
    }
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i]!;
      const age = (now - d.start) / 320;
      if (age >= 1) {
        this.unitLayer.remove(d.mesh);
        this.scene.remove(d.mesh);
        disposeDeep(d.mesh);
        this.dying.splice(i, 1);
      } else {
        d.mesh.scale.setScalar(Math.max(0.01, 1 - age));
      }
    }
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i]!;
      const age = (now - m.bornAt) / 600;
      if (age >= 1) {
        this.scene.remove(m.mesh);
        m.material.dispose();
        this.markers.splice(i, 1);
      } else {
        m.mesh.scale.setScalar(1 - 0.4 * age);
        m.material.opacity = 0.9 * (1 - age);
      }
    }

    this.fct.update(now);

    if (followPos) {
      this.selfRing.position.x = followPos.x;
      this.selfRing.position.z = followPos.z;
    }
    const selfUnit = this.followId !== null ? this.world.units.get(this.followId) : undefined;
    this.selfRing.visible = selfUnit !== undefined && !selfUnit.dead;

    const target =
      followPos ?? new THREE.Vector3(this.world.map.size / 2, 0, this.world.map.size / 2);
    this.camera.position.copy(target).addScaledVector(this.cameraOffset, this.zoom);
    this.camera.lookAt(target);
    this.gl.render(this.scene, this.camera);
  }

  // Unprojects a client-space pointer position onto the ground plane.
  groundPointAt(clientX: number, clientY: number): Vec2 | null {
    this.setRayFrom(clientX, clientY);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) {
      return { x: hit.x, z: hit.z };
    }
    return null;
  }

  private setRayFrom(clientX: number, clientY: number): void {
    const rect = this.gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
  }
}
