// Ships the tier emblems (docs/design/tier-emblem-prompts.md): a generator
// hands back a square painting of one shield on a pure black background;
// this keys the black out and writes the WebP with alpha the ladder loads
// (src/ui/tier_emblem.ts). The alpha comes from the brightest channel,
// opaque from 42 up and a ramp below, so the shield's anti-aliased edge and
// the Legend's halo fade instead of cutting. One square crop for the whole
// set keeps the five shields the same size on the page.
//
// One-shot tool, not a build step: run it when new emblems land, commit the
// WebP. Needs ffmpeg with libwebp on PATH; the sources stay in
// art_src/tiers/<tier>.(jpg|png), ignored like the other raw art.
// Usage: node scripts/convert_tiers.mjs [--crop W:H:X:Y] [--size N]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const TIERS = ['recruit', 'regular', 'veteran', 'elite', 'legend'];
const SRC = 'art_src/tiers';
const OUT = 'public/icons/tiers';

// Generators frame the shield at about three fifths of a 2048 square; this
// window holds the set with the flame of the Legend inside.
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const crop = flag('--crop', '1600:1600:165:160');
const size = Number(flag('--size', '512'));

const alpha = 'clip((max(max(r(X,Y),g(X,Y)),b(X,Y))-10)*8,0,255)';
const filters = [
  'format=rgba',
  `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alpha}'`,
  `crop=${crop}`,
  `scale=${size}:${size}:flags=lanczos`,
].join(',');

mkdirSync(OUT, { recursive: true });
let done = 0;
for (const tier of TIERS) {
  const src = ['jpg', 'png', 'jpeg']
    .map((ext) => path.join(SRC, `${tier}.${ext}`))
    .find(existsSync);
  if (!src) {
    console.log(`${tier}: no source in ${SRC}, skipped`);
    continue;
  }
  const out = path.join(OUT, `${tier}.webp`);
  const r = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-i',
      src,
      '-vf',
      filters,
      '-c:v',
      'libwebp',
      '-quality',
      '92',
      '-pix_fmt',
      'bgra',
      out,
    ],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) {
    console.error(`${tier}: ffmpeg failed`);
    process.exit(1);
  }
  console.log(`${tier}: ${src} -> ${out}`);
  done++;
}
console.log(`${done} emblem(s) written to ${OUT}`);
