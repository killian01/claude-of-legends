// The tower's shot on screen, drawn from the timeline in
// src/render/tower_shot.ts (the Blender animation as data): a gather at
// the crown that the renderer starts ahead of the bolt, a flash and two
// rings where the bolt leaves, the missile itself with its three wound
// filaments and the sparks it sheds, and the burst where it lands. Every
// piece is a pooled group of additive meshes stepped from the clock the
// renderer feeds; particles, ground rings and light go through the
// shared VfxSystem. Presentation only.

import * as THREE from 'three';
import type { GroundHeight } from '../terrain';
import {
  CHARGE_AURA,
  CHARGE_AURA_RADIUS,
  CHARGE_CRYSTAL,
  CHARGE_END_FRAME,
  CHARGE_PARTICLES,
  CHARGE_RINGS,
  CHARGE_S,
  CORE,
  chargeParticle,
  chargeRingRadius,
  chargeRingScale,
  chargeRingSpin,
  chargeRingWidth,
  DIM,
  envelope,
  FILAMENT_RADIUS,
  FILAMENTS,
  FLIGHT_FILAMENTS,
  FLIGHT_HEAD,
  FRAGMENT_GRAVITY,
  filamentPoint,
  frameAt,
  GOLD,
  IMPACT_BURST,
  IMPACT_BURST_RADIUS,
  IMPACT_END_FRAME,
  IMPACT_FRAME,
  IMPACT_GROUND_RING_RADIUS,
  IMPACT_GROUND_RING_S,
  IMPACT_GROUND_RINGS,
  IMPACT_RINGS,
  impactFragments,
  impactGroundRingStartS,
  impactRingLean,
  impactRingScale,
  impactRingWidth,
  impactRingWidthBase,
  LAUNCH_END_FRAME,
  LAUNCH_FLASH,
  LAUNCH_FRAME,
  LAUNCH_RING_RADIUS,
  LAUNCH_RINGS,
  launchRingScale,
  launchRingWidth,
  SOURCE_FPS,
  SPARK_DRIFT_DOWN,
  SPARK_DRIFT_FORWARD,
  SPARK_LIFE_S,
  SPARK_RATE_PER_S,
  SPARK_SPREAD,
  TRAIL_SPIN_RAD_S,
} from '../tower_shot';
import { basicMat } from './shapes';
import { SPRITE } from './sprites';
import type { VfxSystem } from './system';

const LAUNCH_POOL = 6;
const IMPACT_POOL = 6;
const MOTE_SCALE = new THREE.Vector3(0.04, 0.04, 0.15);
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);

let glowTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.4)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  glowTex = new THREE.CanvasTexture(canvas);
  return glowTex;
}

function glowSprite(color: number): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: glowTexture(),
    color,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  mat.toneMapped = false;
  return new THREE.Sprite(mat);
}

function opacityOf(mesh: THREE.Mesh): THREE.MeshBasicMaterial {
  return mesh.material as THREE.MeshBasicMaterial;
}

interface Charge {
  root: THREE.Group;
  aura: THREE.Mesh;
  glow: THREE.Sprite;
  rings: THREE.Mesh[];
  motes: THREE.Mesh[];
  // When the bolt is expected to leave; the gather peaks there.
  launchAt: number;
  windowS: number;
  active: boolean;
}

interface Launch {
  root: THREE.Group;
  flash: THREE.Mesh;
  rings: THREE.Mesh[];
  bornAt: number;
  active: boolean;
}

interface Impact {
  root: THREE.Group;
  burst: THREE.Mesh;
  rings: THREE.Mesh[];
  bornAt: number;
  active: boolean;
}

export class TowerShotFx {
  private readonly charges = new Map<number, Charge>();
  private readonly launches: Launch[] = [];
  private readonly impacts: Impact[] = [];
  private readonly sphere = new THREE.SphereGeometry(1, 16, 12);
  private readonly mote = new THREE.SphereGeometry(1, 6, 4);
  private readonly chargeRings: THREE.TorusGeometry[] = [];
  private readonly launchRing = new THREE.TorusGeometry(LAUNCH_RING_RADIUS, 0.024, 6, 64);
  private readonly impactRings: THREE.TorusGeometry[] = [];
  private readonly filaments: THREE.TubeGeometry[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundHeight?: GroundHeight,
  ) {
    for (let i = 0; i < CHARGE_RINGS; i++) {
      this.chargeRings.push(
        new THREE.TorusGeometry(chargeRingRadius(i), chargeRingWidth(i), 6, 64),
      );
    }
    for (let i = 0; i < IMPACT_RINGS; i++) {
      this.impactRings.push(new THREE.TorusGeometry(1, impactRingWidthBase(i), 6, 64));
    }
    for (let i = 0; i < FILAMENTS; i++) {
      const points: THREE.Vector3[] = [];
      for (let j = 0; j <= 44; j++) {
        const [x, y, z] = filamentPoint(i, j / 44);
        points.push(new THREE.Vector3(x, y, z));
      }
      this.filaments.push(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 44, FILAMENT_RADIUS, 5, false),
      );
    }
    for (let i = 0; i < LAUNCH_POOL; i++) this.launches.push(this.buildLaunch());
    for (let i = 0; i < IMPACT_POOL; i++) this.impacts.push(this.buildImpact());
  }

  // ---------------------------------------------------------------- charge

  private buildCharge(): Charge {
    const root = new THREE.Group();
    root.visible = false;
    const aura = new THREE.Mesh(this.sphere, basicMat(CORE, 0.9, true));
    root.add(aura);
    const glow = glowSprite(GOLD);
    root.add(glow);
    const rings: THREE.Mesh[] = [];
    for (let i = 0; i < CHARGE_RINGS; i++) {
      const ring = new THREE.Mesh(this.chargeRings[i]!, basicMat(i === 0 ? CORE : GOLD, 1, true));
      root.add(ring);
      rings.push(ring);
    }
    const motes: THREE.Mesh[] = [];
    for (let i = 0; i < CHARGE_PARTICLES; i++) {
      const m = new THREE.Mesh(this.mote, basicMat(GOLD, 1, true));
      m.visible = false;
      root.add(m);
      motes.push(m);
    }
    this.scene.add(root);
    return { root, aura, glow, rings, motes, launchAt: 0, windowS: CHARGE_S, active: false };
  }

  // Begin (or restart) a tower's gather at its crown, peaking `windowS`
  // seconds from now. A gather already running keeps its own clock.
  charge(towerId: number, x: number, y: number, z: number, windowS: number, now: number): void {
    let c = this.charges.get(towerId);
    if (!c) {
      c = this.buildCharge();
      this.charges.set(towerId, c);
    }
    c.root.position.set(x, y, z);
    if (c.active && frameAt((now - c.launchAt) / 1000, c.windowS) < LAUNCH_FRAME) return;
    c.active = true;
    c.root.visible = true;
    c.windowS = Math.max(0.05, windowS);
    c.launchAt = now + c.windowS * 1000;
  }

  // The sim announced the strike: the bolt leaves `windupS` from now. A
  // running gather is re-timed onto that beat without a jump in its
  // frame; a tower not gathering starts one that fills over the windup.
  confirm(towerId: number, x: number, y: number, z: number, windupS: number, now: number): void {
    const c = this.charges.get(towerId);
    if (!c?.active) {
      this.charge(towerId, x, y, z, windupS, now);
      return;
    }
    const frame = frameAt((now - c.launchAt) / 1000, c.windowS);
    if (frame >= LAUNCH_FRAME) return;
    const remaining = LAUNCH_FRAME - frame;
    c.windowS = Math.max(0.05, (CHARGE_S * SOURCE_FPS * windupS) / remaining);
    c.launchAt = now + windupS * 1000;
  }

  // The bolt left: whatever the gather's clock says, it collapses now.
  private release(towerId: number, now: number): void {
    const c = this.charges.get(towerId);
    if (c?.active && c.launchAt > now) c.launchAt = now;
  }

  private stepCharge(c: Charge, now: number): void {
    const frame = frameAt((now - c.launchAt) / 1000, c.windowS);
    if (frame >= CHARGE_END_FRAME) {
      c.active = false;
      c.root.visible = false;
      return;
    }
    c.aura.scale.setScalar(Math.max(1e-4, CHARGE_AURA_RADIUS * envelope(CHARGE_AURA, frame)));
    const crystal = envelope(CHARGE_CRYSTAL, frame);
    c.glow.scale.setScalar(1.6 + 3 * crystal);
    (c.glow.material as THREE.SpriteMaterial).opacity = 0.95 * crystal;
    for (let i = 0; i < CHARGE_RINGS; i++) {
      const ring = c.rings[i]!;
      const s = envelope(chargeRingScale(i), frame);
      ring.visible = s > 1e-3;
      ring.scale.setScalar(Math.max(1e-4, s));
      const [rx, ry, rz] = chargeRingSpin(i, frame);
      ring.rotation.set(rx, ry, rz);
    }
    for (let i = 0; i < CHARGE_PARTICLES; i++) {
      const m = c.motes[i]!;
      const p = chargeParticle(i, frame);
      if (!p || p.scale <= 1e-3) {
        m.visible = false;
        continue;
      }
      m.visible = true;
      m.position.set(p.x, p.y, p.z);
      // Pointed at the crown: a mote is a streak flying in, not a bead.
      m.lookAt(c.root.position);
      m.scale.copy(MOTE_SCALE).multiplyScalar(p.scale);
    }
  }

  // ---------------------------------------------------------------- launch

  private buildLaunch(): Launch {
    const root = new THREE.Group();
    root.visible = false;
    const flash = new THREE.Mesh(this.sphere, basicMat(CORE, 0.95, true));
    root.add(flash);
    const rings: THREE.Mesh[] = [];
    for (let i = 0; i < LAUNCH_RINGS; i++) {
      const ring = new THREE.Mesh(this.launchRing, basicMat(i === 0 ? CORE : GOLD, 1, true));
      root.add(ring);
      rings.push(ring);
    }
    this.scene.add(root);
    return { root, flash, rings, bornAt: 0, active: false };
  }

  // The bolt leaves the crown along (dx, dy, dz): the gather collapses,
  // a flat flash and two rings open across the flight line.
  launch(
    towerId: number,
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    now: number,
    fx: VfxSystem,
  ): void {
    this.release(towerId, now);
    let slot = this.launches.find((l) => !l.active);
    if (!slot) slot = this.launches.reduce((a, b) => (a.bornAt <= b.bornAt ? a : b));
    slot.active = true;
    slot.bornAt = now;
    slot.root.visible = true;
    slot.root.position.set(x, y, z);
    this.tmp.set(x + dx, y + dy, z + dz);
    slot.root.lookAt(this.tmp);
    fx.lightPulse(x, z, GOLD, 3, 260);
  }

  private stepLaunch(l: Launch, now: number): void {
    const frame = frameAt((now - l.bornAt) / 1000);
    if (frame >= LAUNCH_END_FRAME) {
      l.active = false;
      l.root.visible = false;
      return;
    }
    const f = envelope(LAUNCH_FLASH, frame);
    l.flash.visible = f > 1e-3;
    l.flash.scale.set(0.55 * f, 0.55 * f, 0.18 * f).addScalar(1e-4);
    for (let i = 0; i < LAUNCH_RINGS; i++) {
      const ring = l.rings[i]!;
      const s = envelope(launchRingScale(i), frame);
      const w = envelope(launchRingWidth(i), frame);
      ring.visible = w > 1e-4;
      ring.scale.setScalar(Math.max(1e-4, s));
      opacityOf(ring).opacity = Math.min(1, w / 0.024);
    }
  }

  // --------------------------------------------------------------- missile

  // The missile: an ivory core stretched along +x (the renderer turns the
  // holder onto the flight line) with three amber filaments wound round
  // it and a glow. Opts out of the generic bolt stretch.
  projectile(now: number): THREE.Object3D {
    const holder = new THREE.Group();
    const head = new THREE.Mesh(this.sphere, basicMat(CORE, 1));
    head.scale.set(0.55, 0.22, 0.22);
    holder.add(head);
    const wound = new THREE.Group();
    for (let i = 0; i < FILAMENTS; i++) {
      wound.add(new THREE.Mesh(this.filaments[i]!, basicMat(GOLD, 0.95, true)));
    }
    holder.add(wound);
    const glow = glowSprite(GOLD);
    glow.scale.setScalar(1.6);
    holder.add(glow);
    holder.userData.stretch = false;
    holder.userData.towerShot = { head, wound, bornAt: now, sparkDebt: 0 };
    return holder;
  }

  // Per frame while the missile flies: the core fills over its first
  // beats, the filaments turn about the line, and sparks stream behind.
  tickProjectile(holder: THREE.Object3D, dtMs: number, now: number, fx: VfxSystem): void {
    const state = holder.userData.towerShot as
      | { head: THREE.Mesh; wound: THREE.Group; bornAt: number; sparkDebt: number }
      | undefined;
    if (!state) return;
    const frame = frameAt((now - state.bornAt) / 1000);
    const h = envelope(FLIGHT_HEAD, frame);
    state.head.scale.set(0.55 * h, 0.22 * h, 0.22 * h).addScalar(1e-4);
    state.wound.scale.setScalar(Math.max(1e-4, envelope(FLIGHT_FILAMENTS, frame)));
    state.wound.rotation.x = ((now - state.bornAt) / 1000) * TRAIL_SPIN_RAD_S;
    // Forward is +x turned by the holder's yaw.
    const fx0 = Math.cos(holder.rotation.y);
    const fz0 = -Math.sin(holder.rotation.y);
    const px = holder.position.x;
    const pz = holder.position.z;
    const y = holder.position.y - (this.groundHeight?.(px, pz) ?? 0);
    state.sparkDebt += (dtMs / 1000) * SPARK_RATE_PER_S;
    while (state.sparkDebt >= 1) {
      state.sparkDebt -= 1;
      const side = (Math.random() * 2 - 1) * SPARK_SPREAD;
      const lift = (Math.random() * 2 - 1) * SPARK_SPREAD;
      // Born just off the line, drifting on, apart and down over its life.
      fx.particles.spawn({
        x: px - fz0 * side,
        y: y + lift,
        z: pz + fx0 * side,
        vx: (fx0 * SPARK_DRIFT_FORWARD - fz0 * side) / SPARK_LIFE_S,
        vy: (lift - SPARK_DRIFT_DOWN) / SPARK_LIFE_S,
        vz: (fz0 * SPARK_DRIFT_FORWARD + fx0 * side) / SPARK_LIFE_S,
        life: SPARK_LIFE_S,
        size0: 0.16,
        size1: 0.04,
        color0: CORE,
        color1: GOLD,
        alpha0: 1,
        alpha1: 0,
        sprite: SPRITE.fleck,
      });
      // The volute: a soft knot of glow left on the line, shrinking.
      fx.particles.spawn({
        x: px - fx0 * 0.3,
        y,
        z: pz - fz0 * 0.3,
        life: 0.22,
        size0: 0.7,
        size1: 0.15,
        color0: CORE,
        color1: GOLD,
        alpha0: 0.55,
        alpha1: 0,
        sprite: SPRITE.glow,
      });
    }
  }

  // ---------------------------------------------------------------- impact

  private buildImpact(): Impact {
    const root = new THREE.Group();
    root.visible = false;
    const burst = new THREE.Mesh(this.sphere, basicMat(CORE, 0.95, true));
    root.add(burst);
    const rings: THREE.Mesh[] = [];
    for (let i = 0; i < IMPACT_RINGS; i++) {
      const ring = new THREE.Mesh(this.impactRings[i]!, basicMat(i === 0 ? CORE : GOLD, 1, true));
      root.add(ring);
      rings.push(ring);
    }
    this.scene.add(root);
    return { root, burst, rings, bornAt: 0, active: false };
  }

  // The bolt struck at (x, y, z) flying along (dx, dy, dz): a burst, three
  // rings leaning off the line, two rings on the ground, fragments thrown
  // and falling, and a light.
  impact(
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    now: number,
    fx: VfxSystem,
  ): void {
    let slot = this.impacts.find((s) => !s.active);
    if (!slot) slot = this.impacts.reduce((a, b) => (a.bornAt <= b.bornAt ? a : b));
    slot.active = true;
    slot.bornAt = now;
    slot.root.visible = true;
    slot.root.position.set(x, y, z);
    const dir = this.tmp.set(dx, dy, dz);
    if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
    dir.normalize();
    const aside = this.tmpB.crossVectors(dir, UP).normalize();
    for (let i = 0; i < IMPACT_RINGS; i++) {
      const [up, side] = impactRingLean(i);
      const normal = new THREE.Vector3()
        .copy(dir)
        .addScaledVector(UP, up)
        .addScaledVector(aside, side)
        .normalize();
      slot.rings[i]!.quaternion.setFromUnitVectors(FORWARD, normal);
    }
    const yRel = y - (this.groundHeight?.(x, z) ?? 0);
    fx.glowFlash(x, yRel, z, 2.4, CORE, 0.2);
    fx.lightPulse(x, z, GOLD, 4.5, (14 / SOURCE_FPS) * 1000);
    for (let i = 0; i < IMPACT_GROUND_RINGS; i++) {
      fx.schedule(impactGroundRingStartS(i) * 1000, () =>
        fx.rings.spawn(x, z, IMPACT_GROUND_RING_RADIUS, DIM, IMPACT_GROUND_RING_S * 1000, {
          alpha: 0.7,
          width: 0.1,
        }),
      );
    }
    for (const f of impactFragments()) {
      fx.particles.spawn({
        x,
        y: yRel,
        z,
        vx: f.dx * f.speed,
        vy: f.dy * f.speed,
        vz: f.dz * f.speed,
        life: f.lifeS,
        size0: f.bright ? 0.22 : 0.16,
        size1: 0.03,
        color0: f.bright ? 0xffffff : CORE,
        color1: f.bright ? CORE : GOLD,
        alpha0: 1,
        alpha1: 0,
        sprite: SPRITE.fleck,
        gravity: FRAGMENT_GRAVITY,
      });
    }
  }

  private stepImpact(s: Impact, now: number): void {
    const frame = IMPACT_FRAME + ((now - s.bornAt) / 1000) * SOURCE_FPS;
    if (frame >= IMPACT_END_FRAME) {
      s.active = false;
      s.root.visible = false;
      return;
    }
    const b = envelope(IMPACT_BURST, frame);
    s.burst.visible = b > 1e-3;
    s.burst.scale.setScalar(Math.max(1e-4, IMPACT_BURST_RADIUS * b));
    for (let i = 0; i < IMPACT_RINGS; i++) {
      const ring = s.rings[i]!;
      const sc = envelope(impactRingScale(i), frame);
      const w = envelope(impactRingWidth(i), frame);
      ring.visible = w > 1e-4;
      ring.scale.setScalar(Math.max(1e-4, sc));
      opacityOf(ring).opacity = Math.min(1, w / 0.023);
    }
  }

  // ------------------------------------------------------------------ loop

  update(now: number): void {
    for (const c of this.charges.values()) if (c.active) this.stepCharge(c, now);
    for (const l of this.launches) if (l.active) this.stepLaunch(l, now);
    for (const s of this.impacts) if (s.active) this.stepImpact(s, now);
  }

  dispose(): void {
    const roots = [
      ...[...this.charges.values()].map((c) => c.root),
      ...this.launches.map((l) => l.root),
      ...this.impacts.map((s) => s.root),
    ];
    for (const root of roots) {
      this.scene.remove(root);
      root.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
          (o.material as THREE.Material).dispose();
        }
      });
    }
    this.charges.clear();
    for (const g of [
      this.sphere,
      this.mote,
      this.launchRing,
      ...this.chargeRings,
      ...this.impactRings,
      ...this.filaments,
    ]) {
      g.dispose();
    }
  }
}
