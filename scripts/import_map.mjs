// Ships one Blender revision of the Star Orchard (docs/star-orchard.md).
// The raw export under art_src/map_exports/star-orchard-<rev>/ weighs
// 180 MB, most of it 4K JPEG floors and four sets of vertex UVs the
// renderer never reads; nothing that size belongs in the repository or in
// a browser's first load. This copies the gameplay records as they are and
// rewrites the model into public/map/star-orchard/ at a size a match can
// pull: unused vertex attributes pruned, textures capped at 2048 and
// re-encoded as WebP, geometry quantized and meshopt-compressed (the
// loader already carries the decoder for the champion models).
//
// One-shot tool, not a build step. The model rewrite runs gltf-transform
// through `pnpm dlx`, fetched on first use; the gameplay records need
// nothing. Usage: node scripts/import_map.mjs [revision]   (default: the
// highest light revision exported)

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EXPORTS = 'art_src/map_exports';
const SHIPPED = 'public/map/star-orchard';
const TEXTURE_SIZE = 2048;
const WEBP_QUALITY = 75;
const RECORDS = ['manifest.json', 'gameplay.json', 'navigation.bin'];

function latestRevision() {
  const revisions = readdirSync(EXPORTS)
    .map((name) => /^star-orchard-(\d+)$/.exec(name))
    .filter((m) => m !== null)
    .map((m) => Number(m[1]));
  if (revisions.length === 0) throw new Error(`no light export under ${EXPORTS}`);
  return Math.max(...revisions);
}

function gltfTransform(args) {
  const run = spawnSync('pnpm', ['dlx', '@gltf-transform/cli', ...args], {
    stdio: 'inherit',
    shell: true,
  });
  if (run.status !== 0) throw new Error(`gltf-transform ${args[0]} failed`);
}

const revision = Number(process.argv[2] ?? latestRevision());
const source = `${EXPORTS}/star-orchard-${revision}`;
for (const name of [...RECORDS, 'map.glb']) statSync(`${source}/${name}`);
const manifest = JSON.parse(readFileSync(`${source}/manifest.json`, 'utf8'));
const layout = JSON.parse(readFileSync(`${source}/gameplay.json`, 'utf8'));
if (manifest.revision !== revision || layout.revision !== revision) {
  throw new Error(`export ${source} is not revision ${revision}`);
}
if (layout.sourceSha256 !== manifest.sourceSha256) {
  throw new Error('gameplay.json and manifest.json come from different Blender sources');
}

mkdirSync(SHIPPED, { recursive: true });
const work = mkdtempSync(path.join(tmpdir(), 'loc-map-'));
try {
  const stages = ['pruned', 'resized', 'webp', 'packed'].map((n) => path.join(work, `${n}.glb`));
  gltfTransform([
    'prune',
    '--keep-attributes',
    'false',
    '--keep-leaves',
    'false',
    `${source}/map.glb`,
    stages[0],
  ]);
  gltfTransform([
    'resize',
    '--width',
    String(TEXTURE_SIZE),
    '--height',
    String(TEXTURE_SIZE),
    stages[0],
    stages[1],
  ]);
  gltfTransform(['webp', '--quality', String(WEBP_QUALITY), stages[1], stages[2]]);
  gltfTransform(['meshopt', '--level', 'medium', stages[2], stages[3]]);
  copyFileSync(stages[3], `${SHIPPED}/map.glb`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
for (const name of RECORDS) {
  if (name !== 'manifest.json') copyFileSync(`${source}/${name}`, `${SHIPPED}/${name}`);
}
const shippedBytes = statSync(`${SHIPPED}/map.glb`).size;
manifest.visualReport = {
  ...manifest.visualReport,
  sourceGlbBytes: manifest.visualReport?.glbBytes,
  glbBytes: shippedBytes,
  shipped: {
    textureSize: TEXTURE_SIZE,
    webpQuality: WEBP_QUALITY,
    compression: 'meshopt',
  },
};
writeFileSync(`${SHIPPED}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `Shipped Star Orchard revision ${revision}: map.glb ${(shippedBytes / 1e6).toFixed(1)} MB` +
    ` (from ${((manifest.visualReport.sourceGlbBytes ?? 0) / 1e6).toFixed(1)} MB)`,
);
