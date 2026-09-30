// The build's gzip twins: every file of the built client worth
// compressing gets a `.gz` beside it, written once at build time at the
// strongest level (vite.config.ts runs this when the build is on disk),
// and the server sends the twin to a browser that takes gzip
// (server/static_files.ts). The proxy in front compresses text on the
// fly but leaves model/gltf-binary and octet-stream alone, so the map and
// the models used to go out raw: the light map drops from 14.1 to 9.3 MB,
// the models select starts from 28.8 to about 16 MB, and the map's
// walkability grid from 460 to 13 kB.

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { constants, gzip } from 'node:zlib';

const gzipAsync = promisify(gzip);

// Formats that compress: the models (geometry, skins and clips), the
// map's records, the code. Pictures, sounds and fonts are compressed
// already, and the entry document is rewritten for every request.
export const PRECOMPRESSED_TYPES: ReadonlySet<string> = new Set([
  '.glb',
  '.bin',
  '.json',
  '.js',
  '.css',
  '.svg',
  '.wasm',
]);

// Too small to be worth a second file.
export const PRECOMPRESS_MIN_BYTES = 1024;
// A twin has to save at least this share of the file, or it is not kept.
// 15 percent: the full map (map.glb, 43 MB) only drops 10 percent and its
// twin would put 38 MB on a disk that has little to spare, for about 4 MB
// less on the wire; the light map (34 percent), the models and the
// navigation records (97 percent) clear it easily.
export const PRECOMPRESS_MIN_SAVING = 0.15;

export function worthCompressing(file: string, size: number): boolean {
  return size >= PRECOMPRESS_MIN_BYTES && PRECOMPRESSED_TYPES.has(path.extname(file).toLowerCase());
}

export interface PrecompressReport {
  // Twins written, with the bytes of their files and of the twins.
  files: number;
  before: number;
  after: number;
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

// One file at a time: the map alone is 43 MB, and the build box has
// other things to hold.
export async function precompressDir(dir: string): Promise<PrecompressReport> {
  const report: PrecompressReport = { files: 0, before: 0, after: 0 };
  for await (const file of walk(dir)) {
    const { size } = await stat(file);
    if (!worthCompressing(file, size)) continue;
    const packed = await gzipAsync(await readFile(file), { level: constants.Z_BEST_COMPRESSION });
    if (packed.length > size * (1 - PRECOMPRESS_MIN_SAVING)) continue;
    await writeFile(`${file}.gz`, packed);
    report.files++;
    report.before += size;
    report.after += packed.length;
  }
  return report;
}
