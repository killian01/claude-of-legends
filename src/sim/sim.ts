// The sim coordinator. Stays thin: systems land as sibling modules that the
// tick calls in a fixed order (the order is load-bearing for determinism).

import { Rng } from './rng';
import { DT } from './types';

export interface SimEvent {
  type: string;
}

export class Sim {
  readonly rng: Rng;
  time = 0;
  tickCount = 0;

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  tick(): SimEvent[] {
    this.time += DT;
    this.tickCount += 1;
    return [];
  }
}
