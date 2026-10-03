// The columns of light that stand on the Wanderseed for what everyone
// should find (CONTEXT.md: Seedfall, Rising, Wrath, Lodestar): a registry
// of instanced column kinds, one draw per kind, that the features add to.
// A Beacon is the crossroads' own light (planet_marks.ts), not one of these.
// Mounted by PlanetMarks, which hands it the pillars of the frame; it draws
// nothing yet.

import * as THREE from 'three';
import type { Vec3 } from '../sim/geo';
import type { PlanetGround } from './planet_terrain';

export type PillarKind = 'seedfall' | 'rising' | 'wrath' | 'lodestar';

// One column this frame: its kind, where it stands, and when what it
// marks happens (a landing, a rise), for a countdown ring.
export interface Pillar {
  kind: PillarKind;
  at: Vec3;
  until?: number;
}

export class PlanetPillars {
  readonly group = new THREE.Group();
  private shown: readonly Pillar[] = [];

  constructor(
    readonly ground: PlanetGround,
    readonly radius: number,
  ) {
    this.group.name = 'planet-pillars';
  }

  // The columns to stand this frame.
  setPillars(pillars: readonly Pillar[]): void {
    this.shown = pillars;
  }

  // How many columns stand now.
  get count(): number {
    return this.shown.length;
  }

  dispose(): void {
    this.shown = [];
  }
}
