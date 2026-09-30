// The offline practice match's seed, a new one per match: the seed is the
// match's input (the lineup the fill draws, the styles, every roll), and
// practice records no replay, so nothing needs it again. A fixed seed gave
// every practice match the same enemy five. Client glue: the draw happens
// here, outside src/sim/, and the sim only ever sees the number.

// The span the seeds are drawn from: positive, inside the 32 bits the Rng
// keeps, like the server's match seeds.
export const PRACTICE_SEED_SPAN = 2_000_000_000;

export function practiceSeed(random: () => number = Math.random): number {
  return 1 + Math.floor(random() * PRACTICE_SEED_SPAN);
}
