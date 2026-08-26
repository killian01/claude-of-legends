// Three.js top-down renderer. Reads the world through IWorld only and never
// mutates it. Static map geometry is built once; unit meshes are synced each
// sim tick and interpolated between ticks for smooth motion.

import * as THREE from 'three';
import type { Vec2 } from '../sim/types';
import type { IWorld } from '../world_api';

const TEAM_COLORS: readonly number[] = [0x4a7dd6, 0xd65c5c];

const COLOR_BACKGROUND = 0x131c0d;
const COLOR_GROUND = 0x2f4d1f;
const COLOR_LANE = 0x8a7a55;
const COLOR_WALL = 0x24401a;
const COLOR_BRUSH = 0x3e7a2c;
const COLOR_TOWER_BASE = 0x6b6b60;

interface TrackedUnit {
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
  private readonly tracked = new Map<number, TrackedUnit>();
  private readonly cameraOffset = new THREE.Vector3(0, 40, 24);
  private followId: number | null = null;

  constructor(container: HTMLElement, world: IWorld) {
    this.world = world;
    this.gl = new THREE.WebGLRenderer({ antialias: true });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.gl.domElement);
    this.scene.background = new THREE.Color(COLOR_BACKGROUND);

    const aspect = container.clientWidth / Math.max(1, container.clientHeight);
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 500);

    window.addEventListener('resize', () => {
      this.gl.setSize(container.clientWidth, container.clientHeight);
      this.camera.aspect = container.clientWidth / Math.max(1, container.clientHeight);
      this.camera.updateProjectionMatrix();
    });

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

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xdfe8c8, 0x20301a, 1.1));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.4);
    sun.position.set(60, 120, 40);
    this.scene.add(sun);
  }

  private buildMap(): void {
    const map = this.world.map;
    const half = map.size / 2;

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(map.size, map.size),
      new THREE.MeshLambertMaterial({ color: COLOR_GROUND }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(half, 0, half);
    this.scene.add(ground);

    const laneMat = new THREE.MeshLambertMaterial({ color: COLOR_LANE });
    for (const lane of Object.values(map.lanes)) {
      for (let i = 0; i + 1 < lane.length; i++) {
        const a = lane[i]!;
        const b = lane[i + 1]!;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len = Math.hypot(dx, dz);
        const seg = new THREE.Mesh(
          new THREE.BoxGeometry(len + map.laneWidth * 0.5, 0.12, map.laneWidth),
          laneMat,
        );
        seg.position.set((a.x + b.x) / 2, 0.06, (a.z + b.z) / 2);
        seg.rotation.y = -Math.atan2(dz, dx);
        this.scene.add(seg);
      }
    }

    const wallMat = new THREE.MeshLambertMaterial({ color: COLOR_WALL });
    for (const w of map.walls) {
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(w.r, w.r + 0.6, 3, 14), wallMat);
      wall.position.set(w.x, 1.5, w.z);
      this.scene.add(wall);
    }

    const brushMat = new THREE.MeshLambertMaterial({
      color: COLOR_BRUSH,
      transparent: true,
      opacity: 0.55,
    });
    for (const b of map.brush) {
      const brush = new THREE.Mesh(new THREE.CylinderGeometry(b.r, b.r, 0.6, 10), brushMat);
      brush.position.set(b.x, 0.3, b.z);
      this.scene.add(brush);
    }

    for (const f of map.fountains) {
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(f.r, f.r, 0.2, 24),
        new THREE.MeshLambertMaterial({ color: TEAM_COLORS[f.team] }),
      );
      pad.position.set(f.x, 0.1, f.z);
      this.scene.add(pad);
    }
  }

  private buildUnitMesh(kind: string, team: number): THREE.Object3D {
    const color = TEAM_COLORS[team] ?? 0xffffff;
    if (kind === 'tower') {
      const group = new THREE.Group();
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 1.4, 5, 10),
        new THREE.MeshLambertMaterial({ color: COLOR_TOWER_BASE }),
      );
      base.position.y = 2.5;
      const top = new THREE.Mesh(
        new THREE.ConeGeometry(1.3, 2, 8),
        new THREE.MeshLambertMaterial({ color }),
      );
      top.position.y = 6;
      group.add(base, top);
      return group;
    }
    if (kind === 'sanctum') {
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(2.4),
        new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35 }),
      );
      mesh.position.y = 3;
      const holder = new THREE.Group();
      holder.add(mesh);
      return holder;
    }
    const capsule = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.65, 1.0, 4, 12),
      new THREE.MeshLambertMaterial({ color }),
    );
    capsule.position.y = 1.15;
    const holder = new THREE.Group();
    holder.add(capsule);
    return holder;
  }

  // Called once after every sim tick: shifts interpolation history and syncs
  // the mesh set with the world's units.
  onSimTick(): void {
    for (const [id, u] of this.world.units) {
      const t = this.tracked.get(id);
      if (!t) {
        const mesh = this.buildUnitMesh(u.kind, u.team);
        mesh.position.set(u.pos.x, 0, u.pos.z);
        this.scene.add(mesh);
        this.tracked.set(id, {
          mesh,
          prev: { x: u.pos.x, z: u.pos.z },
          curr: { x: u.pos.x, z: u.pos.z },
        });
      } else {
        t.prev = t.curr;
        t.curr = { x: u.pos.x, z: u.pos.z };
      }
    }
    for (const [id, t] of this.tracked) {
      if (!this.world.units.has(id)) {
        this.scene.remove(t.mesh);
        this.tracked.delete(id);
      }
    }
  }

  // alpha in [0, 1): progress through the current tick, for interpolation.
  render(alpha: number): void {
    let followPos: THREE.Vector3 | null = null;
    for (const [id, t] of this.tracked) {
      const x = t.prev.x + (t.curr.x - t.prev.x) * alpha;
      const z = t.prev.z + (t.curr.z - t.prev.z) * alpha;
      t.mesh.position.set(x, 0, z);
      if (id === this.followId) followPos = new THREE.Vector3(x, 0, z);
    }
    const target =
      followPos ?? new THREE.Vector3(this.world.map.size / 2, 0, this.world.map.size / 2);
    this.camera.position.copy(target).add(this.cameraOffset);
    this.camera.lookAt(target);
    this.gl.render(this.scene, this.camera);
  }

  // Unprojects a client-space pointer position onto the ground plane.
  groundPointAt(clientX: number, clientY: number): Vec2 | null {
    const rect = this.gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) {
      return { x: hit.x, z: hit.z };
    }
    return null;
  }
}
