// Ships the site logo from its raw generation. Two files come out of the
// generator (art_src/logo/, ignored like the other raw art): mark.png, the
// crest alone, and lockup.png, the same crest over the wordmark.
//
// The crest is what the platforms ask for as an icon, so it becomes the
// tab icon, the home screen icon and the landing bar's crest. The lockup
// is the brand signature: one wide WebP for the README and anywhere else
// the name is set in art rather than in text.
//
// Both arrive cut out already, so there is no background to flood away;
// what they need is a trim to the art, a square frame and the sizes. Two
// things still have to be repaired:
//
//  - The generator's "opaque" is alpha 250 to 254, never 255, so the art
//    is faintly see-through everywhere. Anything at or above OPAQUE_FLOOR
//    is pushed to a real 255.
//  - The lockup sits in a wide soft black glow, half the image by pixel
//    count. On this navy site it reads as a drop shadow; on a light README
//    it is a smudge. GLOW_LO/GLOW_HI remap the alpha ramp so the glow is
//    gone and the art keeps a few pixels of feather. The pair is tuned by
//    eye against a white plate: lower and a grey haze survives, higher and
//    the thin strokes in OF LEGENDS start to erode.
//
// One-shot tool, not a build step. Needs the headless Chrome the other
// shot scripts use: node scripts/site_icon.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.SHOT_CHROME ??
  process.env.CHROME ??
  '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const MARK = 'art_src/logo/mark.png';
const LOCKUP = 'art_src/logo/lockup.png';
const PLATE = '#0a1120';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
page.on('console', (m) => console.log(m.text()));
await page.setContent('<body style="margin:0">');

const dataUrl = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
const files = await page.evaluate(
  async (markSrc, lockupSrc, plate) => {
    const OPAQUE_FLOOR = 240;
    const GLOW_LO = 170;
    const GLOW_HI = 215;

    // The cut canvas for one source: alpha repaired, plus the box the art
    // actually occupies so every later crop can be stated against it.
    const cut = async (src, glow) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const id = g.getImageData(0, 0, c.width, c.height);
      const px = id.data;
      const W = c.width;
      const H = c.height;

      let x0 = W;
      let y0 = H;
      let x1 = -1;
      let y1 = -1;
      for (let p = 0; p < W * H; p++) {
        const i = p * 4 + 3;
        let a = px[i];
        if (glow) a = Math.round(((a - GLOW_LO) * 255) / (GLOW_HI - GLOW_LO));
        if (a >= OPAQUE_FLOOR) a = 255;
        else if (a < 0) a = 0;
        px[i] = a;
        // Half alpha is the honest edge of the art: below it the pixel is
        // more background than art, and letting it set the box would grow
        // the frame by the width of the feather.
        if (a > 127) {
          const x = p % W;
          const y = (p - x) / W;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      g.putImageData(id, 0, 0);
      const box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
      console.log(
        `${glow ? 'lockup' : 'mark'} ${box.w}x${box.h} at ${box.x},${box.y} of ${W}x${H}`,
      );
      return { canvas: c, box };
    };

    // Everything shipped is a crop of one cut canvas; the downscale from
    // full resolution is what feathers the edge.
    const draw = (c, w, h, sx, sy, sw, sh) => {
      const o = document.createElement('canvas');
      o.width = w;
      o.height = h;
      const og = o.getContext('2d');
      og.imageSmoothingQuality = 'high';
      og.drawImage(c, sx, sy, sw, sh, 0, 0, w, h);
      return o;
    };

    const mark = await cut(markSrc, false);
    // A square frame around the art's own center, so the crest keeps the
    // breathing room the artist gave it on whichever side is narrower.
    const side = Math.max(mark.box.w, mark.box.h);
    const crest = (size) =>
      draw(
        mark.canvas,
        size,
        size,
        mark.box.x + (mark.box.w - side) / 2,
        mark.box.y + (mark.box.h - side) / 2,
        side,
        side,
      );
    // iOS gets a full bleed opaque plate; it applies its own rounding.
    const plated = (size, art) => {
      const o = document.createElement('canvas');
      o.width = size;
      o.height = size;
      const og = o.getContext('2d');
      og.fillStyle = plate;
      og.fillRect(0, 0, size, size);
      const m = Math.round(size * 0.05);
      og.drawImage(art, m, m, size - 2 * m, size - 2 * m);
      return o;
    };

    const lockup = await cut(lockupSrc, true);
    // The lockup is only ever seen wide; 960 is twice the widest place it
    // is drawn, which is all a raster wordmark needs to stay crisp.
    const wide = 960;
    const signature = draw(
      lockup.canvas,
      wide,
      Math.round((wide * lockup.box.h) / lockup.box.w),
      lockup.box.x,
      lockup.box.y,
      lockup.box.w,
      lockup.box.h,
    );

    const png = (c) => c.toDataURL('image/png').split(',')[1];
    return {
      'public/icon-512.png': png(crest(512)),
      'public/icon-192.png': png(crest(192)),
      'public/icon-32.png': png(crest(32)),
      'public/apple-touch-icon.png': png(plated(180, crest(360))),
      'public/logo.webp': signature.toDataURL('image/webp', 0.9).split(',')[1],
    };
  },
  dataUrl(MARK),
  dataUrl(LOCKUP),
  PLATE,
);

for (const [file, b64] of Object.entries(files)) {
  const bytes = Buffer.from(b64, 'base64');
  writeFileSync(file, bytes);
  console.log(`${file} ${(bytes.length / 1024).toFixed(1)} kB`);
}
await browser.close();
