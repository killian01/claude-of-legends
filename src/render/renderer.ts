// Three.js top-down renderer. Reads the world through IWorld only and never
// mutates it. Static map geometry is built once; units, projectiles, and
// zones are synced each sim tick, and moving things are interpolated between
// ticks for smooth motion.

import * as THREE from 'three';
import { isRooted, isStunned } from '../sim/combat/status';
import type { Vec2 } from '../sim/types';
import type { IWorld } from '../world_api';
import { FloatingText, makeTextSprite } from './floating_text';

const TEAM_COLORS: readonly number[] = [0x4a7dd6, 0xd65c5c];
const TEAM_LIGHT: readonly number[] = [0x9dbcf5, 0xf5a3a3];

const COLOR_BACKGROUND = 0x131c0d;
const COLOR_GROUND = 0x2f4d1f;
const COLOR_LANE = 0x8a7a55;
const COLOR_WALL = 0x24401a;
const COLOR_BRUSH = 0x3e7a2c;
const COLOR_TOWER_BASE = 0x6b6b60;
const COLOR_BAR_BACK = 0x1a1a1a;

interface TrackedUnit {
  mesh: THREE.Object3D;
  hpFill: THREE.Sprite;
  hpBack: THREE.Sprite;
  barWidth: number;
  barY: number;
  lastHp: number;
  stunMark: THREE.Sprite | null;
  rootMark: THREE.Mesh | null;
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
  private followId: number | null = null;
  private viewerTeam = 0;

  constructor(container: HTMLElement, world: IWorld) {
    this.world = world;
    this.gl = new THREE.WebGLRenderer({ antialias: true });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.gl.domElement);
    this.scene.background = new THREE.Color(COLOR_BACKGROUND);
    this.scene.add(this.unitLayer);

    const aspect = container.clientWidth / Math.max(1, container.clientHeight);
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 500);

    window.addEventListener('resize', () => {
      this.gl.setSize(container.clientWidth, container.clientHeight);
      this.camera.aspect = container.clientWidth / Math.max(1, container.clientHeight);
      this.camera.updateProjectionMatrix();
    });

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
      if (self) this.fct.spawn(`+${amount}g`, '#ffd94a', self.pos.x, 3.4, self.pos.z, 0.9);
    }
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

  private buildUnitMesh(
    kind: string,
    team: number,
    attackRange: number,
  ): { holder: THREE.Group; barY: number } {
    const color = TEAM_COLORS[team] ?? 0xffffff;
    const holder = new THREE.Group();
    if (kind === 'minion') {
      const ranged = attackRange > 2;
      const body = ranged
        ? new THREE.Mesh(
            new THREE.ConeGeometry(0.45, 1.2, 6),
            new THREE.MeshLambertMaterial({ color }),
          )
        : new THREE.Mesh(
            new THREE.BoxGeometry(0.8, 1.0, 0.8),
            new THREE.MeshLambertMaterial({ color }),
          );
      body.position.y = 0.6;
      holder.add(body);
      return { holder, barY: 1.8 };
    }
    if (kind === 'tower') {
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
      holder.add(base, top);
      return { holder, barY: 7.6 };
    }
    if (kind === 'sanctum') {
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(2.4),
        new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35 }),
      );
      mesh.position.y = 3;
      holder.add(mesh);
      return { holder, barY: 6.2 };
    }
    const capsule = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.65, 1.0, 4, 12),
      new THREE.MeshLambertMaterial({ color }),
    );
    capsule.position.y = 1.15;
    holder.add(capsule);
    return { holder, barY: 2.9 };
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
    for (const [id, u] of this.world.units) {
      let t = this.tracked.get(id);
      if (!t) {
        const { holder, barY } = this.buildUnitMesh(u.kind, u.team, u.stats.attackRange);
        const barWidth = u.kind === 'champion' ? 1.8 : u.kind === 'minion' ? 1.0 : 2.2;
        const { fill, back } = this.buildHpBar(holder, barY, barWidth);
        holder.position.set(u.pos.x, 0, u.pos.z);
        holder.userData.unitId = id;
        holder.userData.team = u.team;
        this.unitLayer.add(holder);
        t = {
          mesh: holder,
          hpFill: fill,
          hpBack: back,
          barWidth,
          barY,
          lastHp: u.hp,
          stunMark: null,
          rootMark: null,
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
      }
      t.lastHp = u.hp;

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
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.09;
        t.mesh.add(ring);
        t.rootMark = ring;
      }
      if (t.rootMark) t.rootMark.visible = rooted;
    }
    for (const [id, t] of this.tracked) {
      if (!this.world.units.has(id)) {
        this.unitLayer.remove(t.mesh);
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
        this.trackedZones.delete(id);
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
    for (const t of this.trackedProjectiles.values()) {
      const x = t.prev.x + (t.curr.x - t.prev.x) * alpha;
      const z = t.prev.z + (t.curr.z - t.prev.z) * alpha;
      t.mesh.position.set(x, 1.2, z);
    }
    const now = performance.now();
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
    this.camera.position.copy(target).add(this.cameraOffset);
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
