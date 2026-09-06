// How many arrivals one network may add to a day's visitor count.
//
// The count itself comes from the browser (src/net/pulse_ping.ts), because
// the browser is the only thing that knows whether it has been here today.
// That is what makes the number honest, and it is also what makes it
// forgeable: a script can POST the ping in a loop and write any figure it
// likes onto the maintainer's report. This is the bound that stops it, and
// it is the only place in the pulse that looks at an address at all.
//
// The address is hashed with a salt that is random per day and held only in
// memory, the way the visitor set used to be. What is kept is a small count
// per bucket and never an address, and at midnight the salt goes with the
// counts, which leaves nothing behind that could be asked about a person.
//
// The bucket is the network and not the address: an abuser on IPv6 owns a
// whole /64 and would otherwise be a fresh visitor at every address in it.
// A /64 is one LAN, which is the smallest thing worth calling one place.

import { createHash, randomBytes } from 'node:crypto';
import { dayKey } from './pulse';

// Visits one network may contribute in a day. Generous for a household, a
// shared office or a classroom on one address, and useless to anyone trying
// to put a number on the report: a thousand fake visitors would need a
// hundred networks. When a real crowd does sit behind one address the count
// stops short, which is the safe direction for a figure whose whole job is
// to be believed.
export const VISITS_PER_NETWORK = 12;
// Networks tracked in a day, which is what bounds the memory. Past it a
// network that has not been seen today is refused rather than admitted, so
// the day's visitors stop rising; a day that gets here has larger news to
// report than its exact count.
export const NETWORKS_PER_DAY = 100_000;

// The bucket an address counts against: itself when it is IPv4, and its
// /64 when it is IPv6. Anything unparseable is its own bucket rather than
// a shared one, so a shape we cannot read can never open the gate wider.
export function network(address: string): string {
  if (!address.includes(':')) return address;
  const groups = expand(address);
  return groups === null ? address : `${groups.slice(0, 4).join(':')}::/64`;
}

// The eight groups of an IPv6 address, with "::" filled back in. Returns
// null for anything that is not eight groups once expanded; server/edge.ts
// has already lowercased and shape-checked whatever reaches here.
function expand(address: string): string[] | null {
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const head = (halves[0] ?? '').split(':').filter((g) => g !== '');
  const tail = halves.length === 2 ? (halves[1] ?? '').split(':').filter((g) => g !== '') : [];
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  if (halves.length === 1 && fill !== 0) return null;
  const groups = [...head, ...new Array<string>(fill).fill('0'), ...tail];
  if (groups.some((g) => g.length > 4)) return null;
  // 0db8 and db8 are the same group, and two spellings of one network are
  // two buckets unless they are folded here.
  return groups.map((g) => g.replace(/^0+(?=.)/, ''));
}

export interface VisitGuardOptions {
  // Injectable for the tests; production uses the constants above.
  perNetwork?: number;
  networks?: number;
  // Injectable for the tests; production uses crypto-random.
  salt?: () => string;
}

export class VisitGuard {
  private readonly perNetwork: number;
  private readonly limit: number;
  private readonly newSalt: () => string;
  private counts = new Map<string, number>();
  private day = '';
  private salt = '';

  constructor(opts: VisitGuardOptions = {}) {
    this.perNetwork = opts.perNetwork ?? VISITS_PER_NETWORK;
    this.limit = opts.networks ?? NETWORKS_PER_DAY;
    this.newSalt = opts.salt ?? (() => randomBytes(16).toString('hex'));
  }

  // Whether this ping may count. Rolls the day over on its own, like the
  // counters it guards, so nothing has to schedule midnight.
  allow(at: number, address: string): boolean {
    const day = dayKey(at);
    if (day !== this.day) {
      this.day = day;
      this.salt = this.newSalt();
      this.counts = new Map();
    }
    const key = createHash('sha256')
      .update(`${this.salt}:${network(address)}`)
      .digest('base64');
    const seen = this.counts.get(key) ?? 0;
    if (seen >= this.perNetwork) return false;
    if (seen === 0 && this.counts.size >= this.limit) return false;
    this.counts.set(key, seen + 1);
    return true;
  }

  get trackedNetworks(): number {
    return this.counts.size;
  }
}
