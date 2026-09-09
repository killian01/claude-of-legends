import type * as THREE from 'three';
import type { Unit } from '../sim/unit';

export type GroundHeight = (worldX: number, worldZ: number) => number;

export interface RenderTerrain {
  highDetail?: boolean;
  root: THREE.Group;
  minimap: HTMLCanvasElement;
  heightAt(worldX: number, worldZ: number): number;
  structure(unit: Readonly<Unit>): { holder: THREE.Group; barY: number } | null;
  dispose(): void;
}
