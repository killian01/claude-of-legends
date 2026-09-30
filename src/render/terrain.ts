import type * as THREE from 'three';
import type { Unit } from '../sim/unit';

export type GroundHeight = (worldX: number, worldZ: number) => number;

export interface RenderTerrain {
  highDetail?: boolean;
  root: THREE.Group;
  minimap: HTMLCanvasElement;
  heightAt(worldX: number, worldZ: number): number;
  structure(unit: Readonly<Unit>): { holder: THREE.Group; barY: number } | null;
  // Uploads every texture of the terrain through `upload`, then closes the
  // decoded pictures the GPU now holds its own copy of; how many it closed
  // (src/render/terrain_images.ts).
  releaseImages?(upload: (texture: THREE.Texture) => void): number;
  // Decodes the closed pictures again, for the uploads a restored WebGL
  // context makes; nothing may be drawn until it resolves.
  restoreImages?(): Promise<void>;
  dispose(): void;
}
