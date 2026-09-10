// The shipped Star Orchard as a Node process reads it (docs/star-orchard.md,
// ADR 0021): the three records under public/map/star-orchard in a checkout,
// or under dist/ where only the built client ships (the container). Read
// once per process and handed to every match; the Arena's worker threads
// read their own copy. The model is never read here: nothing in Node
// renders.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assembleStarOrchard,
  type StarOrchard,
  type StarOrchardLayout,
  type StarOrchardManifest,
} from '../src/sim/content/star_orchard';

const FOLDER = path.join('map', 'star-orchard');

// Where the export is, under `root`: the checkout's public/ first, since a
// stale dist/ beside it would otherwise win.
export function starOrchardDir(root = process.cwd()): string {
  for (const base of ['public', 'dist']) {
    const dir = path.join(root, base, FOLDER);
    if (existsSync(path.join(dir, 'manifest.json'))) return dir;
  }
  throw new Error(`the Star Orchard export is missing under ${root} (public/ or dist/)`);
}

export function readStarOrchard(root = process.cwd()): StarOrchard {
  const dir = starOrchardDir(root);
  const manifest = JSON.parse(
    readFileSync(path.join(dir, 'manifest.json'), 'utf8'),
  ) as StarOrchardManifest;
  const layout = JSON.parse(
    readFileSync(path.join(dir, 'gameplay.json'), 'utf8'),
  ) as StarOrchardLayout;
  const binary = readFileSync(path.join(dir, manifest.navigation));
  const navigation = binary.buffer.slice(
    binary.byteOffset,
    binary.byteOffset + binary.byteLength,
  ) as ArrayBuffer;
  return assembleStarOrchard(layout, manifest, navigation);
}

let cached: StarOrchard | null = null;

// The process's one copy, read on first use.
export function starOrchard(): StarOrchard {
  cached ??= readStarOrchard();
  return cached;
}
