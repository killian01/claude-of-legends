// The minimap: a 2D canvas projection of the world, fog-respecting (it only
// draws what IWorld exposes as visible to the viewer's team). Right-click on
// it issues a move order at the corresponding world point.

import type { TeamId, Vec2 } from '../sim/types';
import type { IWorld } from '../world_api';

const SIZE_PX = 168;
const TEAM_COLORS = ['#4a7dd6', '#d65c5c'];

export class Minimap {
  private readonly world: IWorld;
  private readonly viewerTeam: TeamId;
  private readonly selfId: number;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly scale: number;
  private readonly pings: { x: number; z: number; until: number }[] = [];

  constructor(
    container: HTMLElement,
    world: IWorld,
    viewerTeam: TeamId,
    selfId: number,
    onMoveOrder: (p: Vec2) => void,
  ) {
    this.world = world;
    this.viewerTeam = viewerTeam;
    this.selfId = selfId;
    this.scale = SIZE_PX / world.map.size;

    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE_PX;
    this.canvas.height = SIZE_PX;
    this.canvas.style.cssText =
      'position:absolute;right:12px;bottom:12px;border:1px solid #466030;' +
      'border-radius:6px;pointer-events:auto;z-index:5;opacity:0.88;';
    container.appendChild(this.canvas);

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 2) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * world.map.size;
      const z = (1 - (e.clientY - rect.top) / rect.height) * world.map.size;
      onMoveOrder({ x, z });
    });

    const g = this.canvas.getContext('2d');
    if (!g) throw new Error('minimap canvas 2d context unavailable');
    this.g = g;
  }

  addPing(x: number, z: number): void {
    this.pings.push({ x, z, until: performance.now() + 2500 });
  }

  // World z points "up" on the minimap: flip the vertical axis.
  private px(x: number): number {
    return x * this.scale;
  }
  private pz(z: number): number {
    return SIZE_PX - z * this.scale;
  }

  update(): void {
    const { g } = this;
    const map = this.world.map;
    g.fillStyle = '#18240e';
    g.fillRect(0, 0, SIZE_PX, SIZE_PX);

    g.strokeStyle = '#6b6044';
    g.lineWidth = Math.max(2, map.laneWidth * this.scale * 0.7);
    for (const lane of Object.values(map.lanes)) {
      g.beginPath();
      g.moveTo(this.px(lane[0]!.x), this.pz(lane[0]!.z));
      for (const p of lane.slice(1)) g.lineTo(this.px(p.x), this.pz(p.z));
      g.stroke();
    }

    g.fillStyle = '#0f1a07';
    for (const w of map.walls) {
      g.beginPath();
      g.arc(this.px(w.x), this.pz(w.z), w.r * this.scale, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#33611f';
    for (const b of map.brush) {
      g.beginPath();
      g.arc(this.px(b.x), this.pz(b.z), b.r * this.scale, 0, Math.PI * 2);
      g.fill();
    }

    for (const u of this.world.units.values()) {
      if (u.dead) continue;
      if (!this.world.isVisible(this.viewerTeam, u.id)) continue;
      const color = TEAM_COLORS[u.team] ?? '#fff';
      const x = this.px(u.pos.x);
      const z = this.pz(u.pos.z);
      if (u.kind === 'tower') {
        g.fillStyle = color;
        g.fillRect(x - 2.5, z - 2.5, 5, 5);
      } else if (u.kind === 'sanctum') {
        g.fillStyle = color;
        g.beginPath();
        g.moveTo(x, z - 4);
        g.lineTo(x + 4, z);
        g.lineTo(x, z + 4);
        g.lineTo(x - 4, z);
        g.closePath();
        g.fill();
      } else if (u.kind === 'champion') {
        g.fillStyle = color;
        g.beginPath();
        g.arc(x, z, 3, 0, Math.PI * 2);
        g.fill();
        if (u.id === this.selfId) {
          g.strokeStyle = '#ffffff';
          g.lineWidth = 1.5;
          g.stroke();
        }
      } else {
        g.fillStyle = color;
        g.fillRect(x - 1, z - 1, 2, 2);
      }
    }

    const now = performance.now();
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i]!;
      if (now > p.until) {
        this.pings.splice(i, 1);
        continue;
      }
      const age = 1 - (p.until - now) / 2500;
      g.strokeStyle = '#ffd94a';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(this.px(p.x), this.pz(p.z), 4 + age * 10, 0, Math.PI * 2);
      g.stroke();
    }
  }
}
