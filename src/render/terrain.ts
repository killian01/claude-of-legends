import type * as THREE from 'three';
import type { Unit } from '../sim/unit';
import type { PlanetGround } from './planet_terrain';

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
  // The battle royale's planet (ADR 0029, ADR 0031): a terrain carrying
  // one is drawn as the Wanderseed, the renderer's planet mode
  // (planet_stage.ts). The host chooses it by loading the planet's terrain
  // (planet_terrain.ts) instead of the Star Orchard's.
  planet?: PlanetGround;
  dispose(): void;
}
