// Ships the Meshy character exports at a size a browser can pull mid-queue.
// They arrive with 2048px textures embedded as RGBA PNG: five files, 40 MB,
// 90 percent of it pixels, all of it downloaded before the first match. The
// meshes are already fine, so nothing here touches geometry or animation:
// each texture is downscaled to 1024 and re-encoded, and the GLB is rebuilt
// around the smaller images.
//
// A texture whose alpha channel is uniform (Meshy writes RGBA whatever the
// material does) becomes a JPEG; one that actually masks keeps PNG, so the
// cutout never turns into a rectangle. Both are core glTF, so no loader
// extension is involved.
//
// One-shot tool, not a build step. Needs ffmpeg on PATH. Originals are moved
// aside into art_src/models_raw/ (gitignored) before anything is rewritten.
// Usage: node scripts/shrink_models.mjs [file.glb ...]   (default: all)

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
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

const MODELS = 'public/models/champions';
const BACKUP = 'art_src/models_raw';
const MAX_SIZE = 1024;
// mjpeg quality scale, 2 (best) to 31. At 4 the difference is invisible on a
// character 100 px tall and the file is a fifteenth of the PNG.
const JPEG_Q = 4;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

function ffmpeg(args) {
  const run = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr ?? run.error?.message}`);
}

function probe(file, entries) {
  const run = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v', '-show_entries', entries, '-of', 'csv=p=0', file],
    { encoding: 'utf8' },
  );
  return run.stdout.trim();
}

// True when every pixel is fully opaque, so the alpha channel carries nothing
// a JPEG would lose. The lavfi movie filter cannot read a Windows drive
// letter, hence the relative name and the cwd.
function isOpaque(dir, name) {
  const run = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      `movie=${name},alphaextract,signalstats`,
      '-show_entries',
      'frame_tags=lavfi.signalstats.YMIN',
      '-of',
      'csv=p=0',
    ],
    { cwd: dir, encoding: 'utf8' },
  );
  return run.status === 0 && run.stdout.trim().split(/\r?\n/)[0] === '255';
}

function parseGlb(buf) {
  let off = 12;
  let json = null;
  let bin = Buffer.alloc(0);
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === JSON_CHUNK) json = JSON.parse(chunk.toString('utf8'));
    else if (type === BIN_CHUNK) bin = chunk;
    off += 8 + len;
  }
  return { json, bin };
}

// Every bufferView copied out in index order with fresh 4-byte aligned
// offsets: accessors keep their indices, so only the image payloads move.
function buildGlb(json, bin, replaced) {
  const parts = [];
  let offset = 0;
  for (const [i, view] of json.bufferViews.entries()) {
    const data =
      replaced.get(i) ??
      bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    parts.push(data);
    view.byteOffset = offset;
    view.byteLength = data.length;
    offset += data.length;
    const pad = (4 - (offset % 4)) % 4;
    if (pad > 0) {
      parts.push(Buffer.alloc(pad));
      offset += pad;
    }
  }
  const newBin = Buffer.concat(parts);
  json.buffers = [{ byteLength: newBin.length }];
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + newBin.length, 8);
  const chunkHead = (len, type) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(len, 0);
    h.writeUInt32LE(type, 4);
    return h;
  };
  return Buffer.concat([
    header,
    chunkHead(jsonChunk.length, JSON_CHUNK),
    jsonChunk,
    chunkHead(newBin.length, BIN_CHUNK),
    newBin,
  ]);
}

function shrink(file) {
  const before = statSync(file).size;
  const { json, bin } = parseGlb(readFileSync(file));
  const used = json.extensionsUsed ?? [];
  // A model already through a compressed pipeline (meshopt, Draco, KTX2) has
  // its payload in places this rebuild does not understand.
  if (
    used.some(
      (e) =>
        e.startsWith('EXT_meshopt') ||
        e.startsWith('KHR_draco') ||
        e.startsWith('KHR_texture_basisu'),
    )
  ) {
    console.log(`${path.basename(file)}: skipped (compressed pipeline)`);
    return [before, before];
  }
  const work = mkdtempSync(path.join(tmpdir(), 'loc-glb-'));
  const replaced = new Map();
  try {
    for (const [i, image] of (json.images ?? []).entries()) {
      if (image.bufferView === undefined) continue;
      const view = json.bufferViews[image.bufferView];
      const start = view.byteOffset ?? 0;
      const png = image.mimeType === 'image/png';
      const src = `img${i}.${png ? 'png' : 'jpg'}`;
      writeFileSync(path.join(work, src), bin.subarray(start, start + view.byteLength));
      const width = Number(probe(path.join(work, src), 'stream=width'));
      if (!png && width <= MAX_SIZE) continue;
      const keepAlpha = png && !isOpaque(work, src);
      const out = `out${i}.${keepAlpha ? 'png' : 'jpg'}`;
      ffmpeg([
        '-i',
        path.join(work, src),
        '-vf',
        `scale='min(${MAX_SIZE},iw)':-2:flags=lanczos`,
        ...(keepAlpha ? ['-pix_fmt', 'rgba'] : ['-q:v', String(JPEG_Q), '-pix_fmt', 'yuvj444p']),
        path.join(work, out),
      ]);
      replaced.set(image.bufferView, readFileSync(path.join(work, out)));
      image.mimeType = keepAlpha ? 'image/png' : 'image/jpeg';
    }
    if (replaced.size === 0) {
      console.log(`${path.basename(file)}: already small`);
      return [before, before];
    }
    mkdirSync(BACKUP, { recursive: true });
    const kept = path.join(BACKUP, path.basename(file));
    if (!existsSync(kept)) copyFileSync(file, kept);
    writeFileSync(file, buildGlb(json, bin, replaced));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  const after = statSync(file).size;
  const mb = (n) => (n / 1024 / 1024).toFixed(2);
  console.log(`${path.basename(file)}: ${mb(before)}MB to ${mb(after)}MB`);
  return [before, after];
}

const files =
  process.argv.length > 2
    ? process.argv.slice(2)
    : readdirSync(MODELS)
        .filter((f) => f.endsWith('.glb'))
        .map((f) => path.join(MODELS, f));
let before = 0;
let after = 0;
for (const f of files) {
  const [b, a] = shrink(f);
  before += b;
  after += a;
}
console.log(
  `total ${(before / 1024 / 1024).toFixed(1)}MB to ${(after / 1024 / 1024).toFixed(1)}MB`,
);
