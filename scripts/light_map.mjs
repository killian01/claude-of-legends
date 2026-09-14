// The light Star Orchard: the shipped model with its textures capped at
// LIGHT_TEXTURE_SIZE, for the phones and tablets that cannot hold the full
// one (docs/star-orchard.md, src/game/map_quality.ts). map.glb decodes to
// about 1.5 GB of textures on the GPU, which is what iOS and Android kill
// a tab for the moment it arrives, sending the player back to the landing
// with the terrain at 100%; at 384 the same scene decodes to about 200 MB.
// Same geometry, same objects, same names: only the pixels are fewer, and
// the sim reads none of them.
//
// Derived from the shipped map.glb rather than from the Blender export, so
// it can be rebuilt on a box without art_src/; import_map.mjs runs it last
// so the two never drift. One-shot tool, not a build step; gltf-transform
// comes through `pnpm dlx` like the import.
//
// Usage: node scripts/light_map.mjs

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SHIPPED = 'public/map/star-orchard';
export const LIGHT_MODEL = 'map-light.glb';
const LIGHT_TEXTURE_SIZE = 384;
const WEBP_QUALITY = 75;

function gltfTransform(args) {
  const run = spawnSync('pnpm', ['dlx', '@gltf-transform/cli', ...args], {
    stdio: 'inherit',
    shell: true,
  });
  if (run.status !== 0) throw new Error(`gltf-transform ${args[0]} failed`);
}

const full = `${SHIPPED}/map.glb`;
statSync(full);
const work = mkdtempSync(path.join(tmpdir(), 'loc-map-light-'));
try {
  const stages = ['resized', 'webp', 'packed'].map((n) => path.join(work, `${n}.glb`));
  gltfTransform([
    'resize',
    '--width',
    String(LIGHT_TEXTURE_SIZE),
    '--height',
    String(LIGHT_TEXTURE_SIZE),
    full,
    stages[0],
  ]);
  gltfTransform(['webp', '--quality', String(WEBP_QUALITY), stages[0], stages[1]]);
  gltfTransform(['meshopt', '--level', 'medium', stages[1], stages[2]]);
  copyFileSync(stages[2], `${SHIPPED}/${LIGHT_MODEL}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

const manifestPath = `${SHIPPED}/manifest.json`;
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const lightBytes = statSync(`${SHIPPED}/${LIGHT_MODEL}`).size;
manifest.modelLight = LIGHT_MODEL;
manifest.visualReport = {
  ...manifest.visualReport,
  light: { glbBytes: lightBytes, textureSize: LIGHT_TEXTURE_SIZE, webpQuality: WEBP_QUALITY },
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `Shipped the light Star Orchard: ${LIGHT_MODEL} ${(lightBytes / 1e6).toFixed(1)} MB` +
    ` (textures capped at ${LIGHT_TEXTURE_SIZE}, from map.glb ${(statSync(full).size / 1e6).toFixed(1)} MB)`,
);
