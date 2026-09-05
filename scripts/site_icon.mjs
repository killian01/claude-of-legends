// Ships the site icon from its raw generation. The generator hands back a
// square JPG with a checkerboard painted into the pixels where it thinks
// the transparency is (art_src/icon/mark.jpg, ignored like the other raw
// art); this cuts the medallion out of it and writes the sizes the
// platforms ask for.
//
// The tab icon is the medallion alone on real transparency; iOS wants an
// opaque square plate, because it rounds the corners itself. The 32 is a
// tight crop on the center: the whole medallion turns to mush that small,
// and a favicon is allowed to differ per size.
//
// One-shot tool, not a build step. Needs the headless Chrome the other shot
// scripts use: node scripts/site_icon.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.SHOT_CHROME ??
  process.env.CHROME ??
  '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const SRC = 'art_src/icon/mark.jpg';
const PLATE = '#0a1120';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
page.on('console', (m) => console.log(m.text()));
await page.setContent('<body style="margin:0">');

const dataUrl = `data:image/jpeg;base64,${readFileSync(SRC).toString('base64')}`;
const files = await page.evaluate(
  async (src, plate) => {
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

    // The painted checkerboard is grey at every brightness once the JPEG
    // has blurred its squares together, so brightness cannot separate it.
    // Saturation can: the medallion is gold and navy everywhere, grey is
    // neither. Flooding from the frame instead of testing every pixel is
    // what keeps the medallion's own pale grey bevels: they are grey, but
    // they are not connected to the outside.
    const grey = (i) =>
      Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]) < 20;

    // The flood needs a guard: the darkest navy in the medallion is as
    // neutral as the checkerboard's black squares, so an ungated flood
    // leaks through the rim and eats the petals. Pass one has no guard and
    // only serves to measure the medallion; pass two refuses to travel
    // inside that radius, which is where a leak would have to start.
    const flood = (guard, cx, cy, rr) => {
      const bg = new Uint8Array(W * H);
      const stack = new Int32Array(W * H);
      let top = 0;
      const push = (p) => {
        if (bg[p]) return;
        if (guard > 0) {
          const x = p % W;
          const y = (p - x) / W;
          const dx = (x - cx) / rr;
          const dy = (y - cy) / rr;
          if (dx * dx + dy * dy < guard * guard) return;
        }
        if (!grey(p * 4)) return;
        bg[p] = 1;
        stack[top++] = p;
      };
      for (let x = 0; x < W; x++) {
        push(x);
        push((H - 1) * W + x);
      }
      for (let y = 0; y < H; y++) {
        push(y * W);
        push(y * W + W - 1);
      }
      while (top > 0) {
        const p = stack[--top];
        const x = p % W;
        const y = (p - x) / W;
        if (x > 0) push(p - 1);
        if (x < W - 1) push(p + 1);
        if (y > 0) push(p - W);
        if (y < H - 1) push(p + W);
      }
      return bg;
    };
    const extent = (bg) => {
      let a = W;
      let b = H;
      let cc = 0;
      let d = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (bg[y * W + x]) continue;
          if (x < a) a = x;
          if (x > cc) cc = x;
          if (y < b) b = y;
          if (y > d) d = y;
        }
      }
      return { x: a, y: b, w: cc - a + 1, h: d - b + 1 };
    };

    const rough = extent(flood(0, 0, 0, 1));
    const bg = flood(
      0.95,
      rough.x + rough.w / 2,
      rough.y + rough.h / 2,
      Math.max(rough.w, rough.h) / 2,
    );

    // Grow the background one pixel into the art, for the grey JPEG halo
    // that hugs the rim and survives the flood. Two passes bit into the
    // outer bevel where it fades to grey.
    for (let pass = 0; pass < 1; pass++) {
      const grown = bg.slice();
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const p = y * W + x;
          if (bg[p]) continue;
          if (bg[p - 1] || bg[p + 1] || bg[p - W] || bg[p + W]) grown[p] = 1;
        }
      }
      bg.set(grown);
    }

    let x0 = W;
    let y0 = H;
    let x1 = 0;
    let y1 = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (bg[p]) {
          px[p * 4 + 3] = 0;
          continue;
        }
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    g.putImageData(id, 0, 0);
    const box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    console.log(`mark ${box.w}x${box.h} at ${box.x},${box.y} of ${W}x${H}`);

    // Everything else is a crop of that one cut canvas; the downscale from
    // full resolution is what feathers the edge.
    const draw = (size, sx, sy, sw, sh) => {
      const o = document.createElement('canvas');
      o.width = size;
      o.height = size;
      const og = o.getContext('2d');
      og.imageSmoothingQuality = 'high';
      og.drawImage(c, sx, sy, sw, sh, 0, 0, size, size);
      return o;
    };
    const side = Math.max(box.w, box.h);
    const disc = (size) =>
      draw(size, box.x + (box.w - side) / 2, box.y + (box.h - side) / 2, side, side);
    const heart = (size, frac) => {
      const s = side * frac;
      return draw(size, box.x + (box.w - s) / 2, box.y + (box.h - s) / 2, s, s);
    };
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

    const out = {
      'public/icon-512.png': disc(512),
      'public/icon-192.png': disc(192),
      'public/icon-32.png': heart(32, 0.46),
      'public/apple-touch-icon.png': plated(180, disc(360)),
    };
    return Object.fromEntries(
      Object.entries(out).map(([k, v]) => [k, v.toDataURL('image/png').split(',')[1]]),
    );
  },
  dataUrl,
  PLATE,
);

for (const [file, b64] of Object.entries(files)) {
  writeFileSync(file, Buffer.from(b64, 'base64'));
  console.log(file);
}
await browser.close();
