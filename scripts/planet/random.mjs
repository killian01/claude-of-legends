// The generator's own randomness: a seeded stream (mulberry32, the same
// generator as src/sim/rng.ts) and a seeded 3D gradient noise for the
// relief. Never Math.random: the same seed gives the same planet.

export class Stream {
  constructor(seed) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  next() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo, hi) {
    return lo + this.next() * (hi - lo);
  }

  int(n) {
    return Math.floor(this.next() * n);
  }

  pick(list) {
    return list[this.int(list.length)];
  }

  // A child stream, so one region's draws never shift another's.
  fork(tag) {
    let h = this.s ^ 0x85ebca6b;
    for (let i = 0; i < tag.length; i++) h = Math.imul(h ^ tag.charCodeAt(i), 0x01000193);
    return new Stream(h >>> 0);
  }
}

// Classic 3D gradient noise over a seeded permutation, in [-1, 1].
export class Noise3 {
  constructor(seed) {
    const rng = new Stream(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = rng.int(i + 1);
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  static fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  static grad(h, x, y, z) {
    const g = h & 15;
    const u = g < 8 ? x : y;
    const v = g < 4 ? y : g === 12 || g === 14 ? x : z;
    return ((g & 1) === 0 ? u : -u) + ((g & 2) === 0 ? v : -v);
  }

  at(x, y, z) {
    const P = this.perm;
    const X = Math.floor(x);
    const Y = Math.floor(y);
    const Z = Math.floor(z);
    x -= X;
    y -= Y;
    z -= Z;
    const xi = X & 255;
    const yi = Y & 255;
    const zi = Z & 255;
    const u = Noise3.fade(x);
    const v = Noise3.fade(y);
    const w = Noise3.fade(z);
    const A = P[xi] + yi;
    const AA = P[A] + zi;
    const AB = P[A + 1] + zi;
    const B = P[xi + 1] + yi;
    const BA = P[B] + zi;
    const BB = P[B + 1] + zi;
    const g = Noise3.grad;
    const l1 = (a, b, t) => a + (b - a) * t;
    return l1(
      l1(
        l1(g(P[AA], x, y, z), g(P[BA], x - 1, y, z), u),
        l1(g(P[AB], x, y - 1, z), g(P[BB], x - 1, y - 1, z), u),
        v,
      ),
      l1(
        l1(g(P[AA + 1], x, y, z - 1), g(P[BA + 1], x - 1, y, z - 1), u),
        l1(g(P[AB + 1], x, y - 1, z - 1), g(P[BB + 1], x - 1, y - 1, z - 1), u),
        v,
      ),
      w,
    );
  }

  // Fractal sum over a direction scaled to meters, roughly in [-1, 1].
  fbm(d, metersPerUnit, octaves = 4) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 80 / metersPerUnit;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.at(d[0] * f + 17.3 * o, d[1] * f - 9.1 * o, d[2] * f + 4.7 * o);
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return (sum / norm) * 1.6;
  }
}
