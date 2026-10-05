// The minimap: a 2D canvas projection of the world, fog-respecting (it only
// draws what IWorld exposes as visible to the viewer's team). Right-click on
// it issues a move order at the corresponding world point; left-click points
// the camera there (Space snaps it back to the champion). The player's own
// assigned lane is stroked in gold (ui/lane_guide.ts; ADR 0026).

import { pointOnStage, rectOnStage, stageSizeOf } from '../game/match_stage';
import { getSettings } from '../game/settings';
import { followUiScale } from '../game/ui_scale';
import { aspectColor, WRATH_COLOR } from '../render/aspect_colors';
import type { TeamId, Vec2 } from '../sim/types';
import type { IWorld } from '../world_api';
import { type LaneGuide, ownCamps } from './lane_guide';
import { teamLook } from './team_look';

const SIZE_PX = 168;
const TEAM_COLORS = ['#4a7dd6', '#d65c5c'];

export class Minimap {
  private readonly world: IWorld;
  private readonly viewerTeam: TeamId;
  private readonly selfId: number;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly scale: number;
  private readonly fog = document.createElement('canvas');
  private readonly pings: { x: number; z: number; until: number }[] = [];
  // The seat's assigned lane, stroked under the units (ui/lane_guide.ts;
  // ADR 0026); null draws nothing (a replay, a spectator).
  private laneGuide: Pick<LaneGuide, 'lane' | 'arrived'> | null = null;
  // The interface size (src/game/ui_scale.ts), followed while on screen.
  private readonly stopScale: () => void;
  // True while the cursor is over the minimap; the edge-pan gate reads it.
  hovered = false;

  constructor(
    container: HTMLElement,
    world: IWorld,
    viewerTeam: TeamId,
    selfId: number,
    onMoveOrder: (p: Vec2) => void,
    onLook: (p: Vec2) => void,
    // The terrain's own picture of the map (src/render/terrain_loader.ts).
    private readonly background: HTMLCanvasElement,
    // Which corner: the bottom right, or the top right when the right thumb
    // owns the bottom (the thumb controls' cluster).
    opts: { corner?: 'bottom-right' | 'top-right' } = {},
  ) {
    this.world = world;
    this.viewerTeam = viewerTeam;
    this.selfId = selfId;
    this.scale = SIZE_PX / world.map.size;

    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE_PX;
    this.canvas.height = SIZE_PX;
    // Sized once: setting a canvas's size allocates its picture anew, and
    // the fog is redrawn on every world tick.
    this.fog.width = SIZE_PX;
    this.fog.height = SIZE_PX;
    // Touchscreens are phone-sized: the map draws at full resolution but
    // displays smaller, leaving the middle of the screen to the game. The
    // click mapping below reads the on-screen rect, so it needs no change.
    const coarse =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    const displayPx = coarse ? 112 : SIZE_PX;
    // Stepped in from a phone's notch and rounded corners (the safe area;
    // zero on a screen without them), the match stage's edges' own
    // (game/match_stage.ts: they trade places on a turned stage).
    const edge =
      opts.corner === 'top-right'
        ? 'top:calc(58px + var(--safe-top, env(safe-area-inset-top, 0px)))'
        : 'bottom:calc(12px + var(--safe-bottom, env(safe-area-inset-bottom, 0px)))';
    this.canvas.style.cssText =
      `width:${displayPx}px;height:${displayPx}px;position:absolute;` +
      `right:calc(12px + var(--safe-right, env(safe-area-inset-right, 0px)));${edge};` +
      'border:1px solid #466030;border-radius:6px;pointer-events:auto;z-index:5;opacity:0.88;';
    container.appendChild(this.canvas);
    this.stopScale = followUiScale(
      this.canvas,
      () => getSettings().uiScale,
      () => stageSizeOf(container).height,
    );

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('pointerenter', () => {
      this.hovered = true;
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.hovered = false;
    });
    // The press and the map's rect both in the stage's pixels, which on a
    // stage turned for a phone held upright are not the page's.
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      const rect = rectOnStage(this.canvas, this.canvas.getBoundingClientRect());
      const at = pointOnStage(this.canvas, e.clientX, e.clientY);
      const x = ((at.x - rect.left) / rect.width) * world.map.size;
      const z = (1 - (at.y - rect.top) / rect.height) * world.map.size;
      if (e.button === 2) onMoveOrder({ x, z });
      else onLook({ x, z });
    });

    const g = this.canvas.getContext('2d');
    if (!g) throw new Error('minimap canvas 2d context unavailable');
    this.g = g;
  }

  setLaneGuide(guide: Pick<LaneGuide, 'lane' | 'arrived'> | null): void {
    this.laneGuide = guide;
  }

  addPing(x: number, z: number): void {
    this.pings.push({ x, z, until: performance.now() + 2500 });
  }

  // Same-page teardown; the listeners die with the canvas.
  dispose(): void {
    this.stopScale();
    this.canvas.remove();
  }

  // The minimap matches the camera: +z runs UP the screen (team 0 at the
  // bottom-left, the top lane along the left and the top), so the minimap
  // maps +z up too. What you see top-right in the world is top-right here.
  private px(x: number): number {
    return x * this.scale;
  }
  private pz(z: number): number {
    return SIZE_PX - z * this.scale;
  }

  update(): void {
    const { g } = this;
    g.drawImage(this.background, 0, 0, SIZE_PX, SIZE_PX);

    // Fog of war shading: darken everything, then punch soft holes around
    // friendly sight before drawing units on top.
    const f = this.fog.getContext('2d');
    if (f) {
      f.globalCompositeOperation = 'source-over';
      f.clearRect(0, 0, SIZE_PX, SIZE_PX);
      f.fillStyle = 'rgba(0, 0, 0, 0.42)';
      f.fillRect(0, 0, SIZE_PX, SIZE_PX);
      f.globalCompositeOperation = 'destination-out';
      for (const u of this.world.units.values()) {
        // A neutral body carries a nominal team and gives nobody sight.
        if (u.team !== this.viewerTeam || u.dead || u.neutral) continue;
        const r = Math.max(4, u.sightRange) * this.scale;
        const x = this.px(u.pos.x);
        const z = this.pz(u.pos.z);
        const grad = f.createRadialGradient(x, z, r * 0.55, x, z, r);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        f.fillStyle = grad;
        f.beginPath();
        f.arc(x, z, r, 0, Math.PI * 2);
        f.fill();
      }
      g.drawImage(this.fog, 0, 0);
    }

    this.drawLaneGuide();

    for (const u of this.world.units.values()) {
      if (u.dead) continue;
      if (!this.world.isVisible(this.viewerTeam, u.id)) continue;
      const color = TEAM_COLORS[teamLook(u.team, this.viewerTeam, this.world.teamCount)] ?? '#fff';
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
      } else if (u.kind === 'camp') {
        // A camp body by its size: a Brackenling small, the Barkmaw big.
        g.fillStyle = '#d8a24f';
        g.beginPath();
        g.arc(
          x,
          z,
          u.campKind === 'barkmaw' ? 3.2 : u.campKind === 'brackenlings' ? 1.8 : 2.5,
          0,
          Math.PI * 2,
        );
        g.fill();
      } else if (u.kind === 'creature') {
        // A ring creature: a blotch in its aspect's color, for both teams;
        // the Ascendant a bigger one in the Wrath's.
        g.fillStyle = u.ascendant ? WRATH_COLOR.css : aspectColor(u.aspect).css;
        g.beginPath();
        g.arc(x, z, u.ascendant ? 6 : 4.5, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#fff3e0';
        g.lineWidth = 1.5;
        g.stroke();
      } else if (u.kind === 'warden') {
        // The Warden: a violet blotch both teams can track.
        g.fillStyle = '#c06ae8';
        g.beginPath();
        g.arc(x, z, 5, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#f0d8ff';
        g.lineWidth = 1.5;
        g.stroke();
      } else if (u.kind === 'champion') {
        g.fillStyle = color;
        g.beginPath();
        g.arc(x, z, 4, 0, Math.PI * 2);
        g.fill();
        if (u.id === this.selfId) {
          g.strokeStyle = '#ffffff';
          g.lineWidth = 1.5;
          g.stroke();
        }
        g.font = 'bold 6px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = '#ffffff';
        g.fillText((u.championId?.[0] ?? '?').toUpperCase(), x, z + 0.5);
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

  // The player's lane in gold: the lane's line, or for the forest a ring
  // round each of the team's own camps. Dashed and marching out of the own
  // base until the player arrives, faint after: a reminder, not a call.
  private drawLaneGuide(): void {
    const guide = this.laneGuide;
    if (!guide) return;
    const { g } = this;
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = 3;
    if (guide.arrived) {
      g.strokeStyle = 'rgba(255, 217, 74, 0.42)';
      g.setLineDash([]);
    } else {
      g.strokeStyle = 'rgba(255, 217, 74, 0.95)';
      g.setLineDash([6, 4]);
      // Each lane runs from team 0's base: the dashes walk away from home.
      const march = (performance.now() / 90) % 10;
      g.lineDashOffset = this.viewerTeam === 0 ? -march : march;
    }
    g.beginPath();
    if (guide.lane !== null) {
      for (const [i, p] of this.world.map.lanes[guide.lane].entries()) {
        if (i === 0) g.moveTo(this.px(p.x), this.pz(p.z));
        else g.lineTo(this.px(p.x), this.pz(p.z));
      }
    } else {
      for (const c of ownCamps(this.world.map, this.viewerTeam)) {
        g.moveTo(this.px(c.x) + 7, this.pz(c.z));
        g.arc(this.px(c.x), this.pz(c.z), 7, 0, Math.PI * 2);
      }
    }
    g.stroke();
    g.restore();
  }
}
