// Ships the painted art as WebP. The generators hand back 512px icons and
// 896x1200 portraits as PNG, half a megabyte and two megabytes each, which is
// 57 MB of a 133 MB client for images the HUD draws at 56 px. Re-encoded at
// the same resolution, the set costs about a tenth of that with no visible
// difference (measured SSIM 0.96 on the icons, 0.97 on the portraits).
//
// One-shot tool, not a build step: run it when new art lands, commit the
// WebP. Needs ffmpeg with libwebp on PATH; the PNG sources stay in art_src/.
// Usage: node scripts/convert_art.mjs [--keep]

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

// Icons carry sharp painted detail and are read up close in tooltips;
// portraits are large and always seen whole, so they take the deeper cut.
const TARGETS = [
  { dir: 'public/icons', quality: 90 },
  { dir: 'public/portraits', quality: 85 },
];
const keep = process.argv.includes('--keep');

function pngsUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...pngsUnder(full));
    else if (entry.name.endsWith('.png')) out.push(full);
  }
  return out;
}

let before = 0;
let after = 0;
let failed = 0;
for (const { dir, quality } of TARGETS) {
  for (const png of pngsUnder(dir)) {
    const webp = `${png.slice(0, -4)}.webp`;
    // yuva420p keeps the alpha channel: the icon paintings are cut out.
    const run = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-i',
        png,
        '-c:v',
        'libwebp',
        '-pix_fmt',
        'yuva420p',
        '-quality',
        String(quality),
        '-compression_level',
        '6',
        '-preset',
        'picture',
        webp,
      ],
      { encoding: 'utf8' },
    );
    if (run.status !== 0) {
      console.error(`failed: ${png}\n${run.stderr ?? run.error?.message ?? ''}`);
      failed++;
      continue;
    }
    before += statSync(png).size;
    after += statSync(webp).size;
    if (!keep) unlinkSync(png);
  }
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
console.log(
  `${mb(before)} of PNG to ${mb(after)} of WebP${failed > 0 ? `, ${failed} failed` : ''}`,
);
if (failed > 0) process.exitCode = 1;
