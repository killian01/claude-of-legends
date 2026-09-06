// Ships the site logo from its raw generation. Two files come out of the
// generator (art_src/logo/, ignored like the other raw art): mark.png, the
// crest alone, and lockup.png, the same crest over the wordmark.
//
// The crest is what the platforms ask for as an icon, so it becomes the
// tab icon, the home screen icon and the landing bar's crest. The lockup
// is the brand signature: one wide WebP for the site, and the same art on
// a plate of its own for the README.
//
// favicon.ico is not redundant with the PNG links in index.html. A browser
// asks for /favicon.ico on its own whether or not the page names one, and
// so do the places that show a site without loading its markup: bookmarks,
// history, a link unfurled elsewhere. Without the file the SPA fallback
// answered that request with index.html at 200, which is an HTML document
// wearing an image content type as far as the browser is concerned.
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
// What survives the remap is the feather itself: a few pixels of dark
// edge, which is right on the navy the site draws the logo on and reads
// as a dirty cut on a white one. The site owns its background and the
// README does not (GitHub gives the page whichever theme the reader
// picked), so the README copy carries a background with it: the same
// navy plate, gold-lit behind the crest, written to docs/screenshots.
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

    // The README copy: the signature on the site's own plate, so the cut
    // never has to survive a background we do not control. Rounded like
    // the cards on the home screen, lit warm behind the crest, and one
    // hairline of the site's border blue so the panel has an edge on a
    // white page as well as on a dark one.
    const onPlate = (art) => {
      const pad = Math.round(art.width * 0.085);
      const o = document.createElement('canvas');
      o.width = art.width + 2 * pad;
      o.height = art.height + 2 * pad;
      const og = o.getContext('2d');
      const r = Math.round(pad * 0.9);
      og.beginPath();
      og.roundRect(0, 0, o.width, o.height, r);
      og.clip();
      const sky = og.createLinearGradient(0, 0, 0, o.height);
      sky.addColorStop(0, '#101a2e');
      sky.addColorStop(1, '#070c18');
      og.fillStyle = sky;
      og.fillRect(0, 0, o.width, o.height);
      // The crest sits in the top third of the lockup; the glow sits
      // under it rather than in the middle of the panel, which would
      // put the brightest point on the wordmark.
      const glow = og.createRadialGradient(
        o.width / 2,
        o.height * 0.34,
        0,
        o.width / 2,
        o.height * 0.34,
        o.width * 0.52,
      );
      glow.addColorStop(0, 'rgba(230, 215, 168, 0.13)');
      glow.addColorStop(1, 'rgba(230, 215, 168, 0)');
      og.fillStyle = glow;
      og.fillRect(0, 0, o.width, o.height);
      og.drawImage(art, pad, pad);
      og.lineWidth = 2;
      og.strokeStyle = '#22314e';
      og.beginPath();
      og.roundRect(1, 1, o.width - 2, o.height - 2, r - 1);
      og.stroke();
      return o;
    };

    const png = (c) => c.toDataURL('image/png').split(',')[1];
    return {
      'public/icon-512.png': png(crest(512)),
      'public/icon-192.png': png(crest(192)),
      'public/apple-touch-icon.png': png(plated(180, crest(360))),
      'public/logo.webp': signature.toDataURL('image/webp', 0.9).split(',')[1],
      'docs/screenshots/logo-readme.webp': onPlate(signature)
        .toDataURL('image/webp', 0.92)
        .split(',')[1],
      // Packed into the .ico below, not written as they are. Three sizes so
      // the browser picks rather than downsamples: 16 for the tab, 32 for a
      // dense screen's tab, 48 for the bookmark bar and the history list.
      // All three take the same frame. A tighter crop at 16 is the obvious
      // idea and it does not work: measured, the C is 994 by 1030 inside a
      // 1044 by 1030 box, so it already fills the frame's height and the
      // only thing a smaller square can do is cut the top and bottom off
      // the ring. The 16 is small because the art is detailed, not because
      // the frame is loose.
      ico: [png(crest(16)), png(crest(32)), png(crest(48))],
    };
  },
  dataUrl(MARK),
  dataUrl(LOCKUP),
  PLATE,
);

// An .ico is a directory of images in one file. Every browser still in use
// reads a PNG payload inside one (it has been the normal way to carry the
// larger sizes since Vista), so the entries are the PNGs above rather than
// the bitmaps the format was written for.
function ico(pngs) {
  const images = pngs.map((b64) => Buffer.from(b64, 'base64'));
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon, 2 would be a cursor
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((img, i) => {
    // The size is read back out of the PNG's own header, so the entry can
    // never disagree with the image it points at. 256 is written as 0.
    const side = img.readUInt32BE(16);
    const at = 6 + 16 * i;
    header.writeUInt8(side >= 256 ? 0 : side, at);
    header.writeUInt8(side >= 256 ? 0 : side, at + 1);
    header.writeUInt8(0, at + 2); // palette size, 0 for a truecolour image
    header.writeUInt8(0, at + 3); // reserved
    header.writeUInt16LE(1, at + 4); // colour planes
    header.writeUInt16LE(32, at + 6); // bits per pixel
    header.writeUInt32LE(img.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += img.length;
  });
  return Buffer.concat([header, ...images]);
}

const { ico: icoPngs, ...plain } = files;
for (const [file, b64] of Object.entries(plain)) {
  const bytes = Buffer.from(b64, 'base64');
  writeFileSync(file, bytes);
  console.log(`${file} ${(bytes.length / 1024).toFixed(1)} kB`);
}
const icoBytes = ico(icoPngs);
writeFileSync('public/favicon.ico', icoBytes);
console.log(
  `public/favicon.ico ${(icoBytes.length / 1024).toFixed(1)} kB, ${icoPngs.length} sizes`,
);
await browser.close();
