// The three.js loaders share one loading manager by default, and the
// manager rewrites every address it is handed before a request is made.
// Installed once at boot, it stamps every model, clip, texture and
// transcoder the renderer fetches (src/game/asset_version.ts); a blob or
// data address a loader makes for itself passes through untouched.

import { DefaultLoadingManager } from 'three';
import { versioned } from '../game/asset_version';

export function installVersionedLoading(): void {
  DefaultLoadingManager.setURLModifier(versioned);
}
