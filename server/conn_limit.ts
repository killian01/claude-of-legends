// How many sockets one address may hold at once.
//
// A socket now needs an account to exist at all (ADR 0006), but registering
// one is free and instant, so this is still what stands between the server
// and a script that opens sockets until the process runs out of memory. It
// counts per player address (server/edge.ts), never per proxy, or it would
// cap the whole player base together.
//
// The bound is not "how many players do we want", it is "how many people can
// legitimately share one internet connection": a flat, an office, a LAN party.
// A player uses one socket, so 32 covers those comfortably while still
// stopping a flood long before it costs anything.

export const MAX_CONN_PER_IP = 32;

export class ConnectionLimiter {
  private readonly counts = new Map<string, number>();

  constructor(private readonly max: number = MAX_CONN_PER_IP) {}

  // Takes a slot for this address, or reports that the address is at its cap.
  acquire(address: string): boolean {
    const held = this.counts.get(address) ?? 0;
    if (held >= this.max) return false;
    this.counts.set(address, held + 1);
    return true;
  }

  // Gives a slot back. Deleting at zero keeps the map from growing one entry
  // per address ever seen, which on a public server is unbounded.
  release(address: string): void {
    const remaining = (this.counts.get(address) ?? 1) - 1;
    if (remaining <= 0) this.counts.delete(address);
    else this.counts.set(address, remaining);
  }

  held(address: string): number {
    return this.counts.get(address) ?? 0;
  }

  get trackedAddresses(): number {
    return this.counts.size;
  }
}
