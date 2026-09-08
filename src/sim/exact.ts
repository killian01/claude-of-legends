// Exactly rounded arithmetic for the sim (ADR 0019). IEEE 754 pins the
// four operations, the remainder and the square root to one correctly
// rounded result on every engine, and pins nothing else: the engine's own
// hypot, trigonometry and power functions are each its own algorithm,
// right in the last bit on one host and a different last bit on the next.
// A replay is a re-simulation on whatever engine opens it, and a match
// recorded on the server and viewed in a browser would drift by that bit
// and then by a whole fight. So the sim computes lengths with the exact
// formula and angles with a fixed polynomial over exact operations, and
// tests/architecture.test.ts keeps the engine's own versions out.

// The length of a ground-plane vector.
export function hypot(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

const TWO_PI = 2 * Math.PI;
const HALF_PI = Math.PI / 2;
// Taylor terms on [0, PI/2]: the tail past this many is below the last bit.
const TERMS = 12;

// Into [-PI, PI]. The remainder is exact, so nothing accumulates however
// many turns the angle carries.
function reduce(x: number): number {
  let r = x % TWO_PI;
  if (r > Math.PI) r -= TWO_PI;
  else if (r < -Math.PI) r += TWO_PI;
  return r;
}

// The series on [0, PI/2], summed from the smallest term (Horner form).
function cosQuadrant(x: number): number {
  const xx = x * x;
  let t = 1;
  for (let n = TERMS; n >= 1; n--) t = 1 - (xx / ((2 * n - 1) * (2 * n))) * t;
  return t;
}

function sinQuadrant(x: number): number {
  const xx = x * x;
  let t = 1;
  for (let n = TERMS; n >= 1; n--) t = 1 - (xx / (2 * n * (2 * n + 1))) * t;
  return x * t;
}

export function cos(x: number): number {
  const r = Math.abs(reduce(x));
  if (r > HALF_PI) return -cosQuadrant(Math.PI - r);
  return cosQuadrant(r);
}

export function sin(x: number): number {
  const r = reduce(x);
  const a = Math.abs(r);
  const s = a > HALF_PI ? sinQuadrant(Math.PI - a) : sinQuadrant(a);
  return r < 0 ? -s : s;
}
