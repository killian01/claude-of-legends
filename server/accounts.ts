// Account identity, still keyed on the browser's session token (the same
// token the reconnect flow already carries): the first hello creates an
// account, later hellos update the name and last-seen. Handles display as
// name#disc; the discriminator is unique per name so two bobs stay
// distinguishable in history and on the ladder. The credential and the
// owned name arrive in a later change (ADR 0006); this one only renames.

import { randomInt } from 'node:crypto';
import { BASE_RATING } from './rating';
import { loadJson, saveJsonAtomic } from './store';

export interface Account {
  id: number;
  token: string;
  name: string;
  disc: number;
  createdAt: number;
  seenAt: number;
  // Elo (server/rating.ts); only rated matches move it.
  rating: number;
  ratedGames: number;
}

export function handleOf(p: Pick<Account, 'name' | 'disc'>): string {
  return `${p.name}#${p.disc}`;
}

function randomDisc(used: ReadonlySet<number>): number {
  for (let guard = 0; guard < 100; guard++) {
    const d = randomInt(1000, 10000);
    if (!used.has(d)) return d;
  }
  // Practically unreachable (9000 values); fall back to a linear scan.
  for (let d = 1000; d < 10000; d++) if (!used.has(d)) return d;
  return 0;
}

export class AccountRegistry {
  private readonly byToken = new Map<string, Account>();
  private nextId = 1;

  constructor(
    private readonly file: string,
    // Injectable for tests; production uses the crypto-random default.
    private readonly discGen: (used: ReadonlySet<number>) => number = randomDisc,
  ) {
    for (const p of loadJson<Account[]>(file, [])) {
      // Records written before ratings existed load at the base rating.
      p.rating = typeof p.rating === 'number' ? p.rating : BASE_RATING;
      p.ratedGames = typeof p.ratedGames === 'number' ? p.ratedGames : 0;
      this.byToken.set(p.token, p);
      this.nextId = Math.max(this.nextId, p.id + 1);
    }
  }

  private persist(): void {
    // A broken disk must not break gameplay: identities keep working in
    // memory and the failure is loud in the log.
    try {
      saveJsonAtomic(this.file, [...this.byToken.values()]);
    } catch (err) {
      console.error('player registry persist failed', err);
    }
  }

  private usedDiscs(name: string, exceptId?: number): Set<number> {
    const used = new Set<number>();
    for (const p of this.byToken.values()) {
      if (p.name === name && p.id !== exceptId) used.add(p.disc);
    }
    return used;
  }

  // Called on every hello: creates the player, or refreshes name and
  // last-seen. A rename that lands on another player's name#disc gets a
  // fresh discriminator; otherwise the disc is stable for life.
  getOrCreate(token: string, name: string, now: number): Account {
    const existing = this.byToken.get(token);
    if (existing) {
      const renamed = existing.name !== name;
      if (renamed) {
        existing.name = name;
        if (this.usedDiscs(name, existing.id).has(existing.disc)) {
          existing.disc = this.discGen(this.usedDiscs(name, existing.id));
        }
      }
      existing.seenAt = now;
      if (renamed) this.persist();
      return existing;
    }
    const created: Account = {
      id: this.nextId++,
      token,
      name,
      disc: this.discGen(this.usedDiscs(name)),
      createdAt: now,
      seenAt: now,
      rating: BASE_RATING,
      ratedGames: 0,
    };
    this.byToken.set(token, created);
    this.persist();
    return created;
  }

  // One rated match landed for this player; the delta is already signed.
  applyRating(id: number, delta: number): void {
    const p = this.findById(id);
    if (!p) return;
    p.rating += delta;
    p.ratedGames += 1;
    this.persist();
  }

  // A leaver penalty: rating drops without counting a rated game (a
  // walk-out must not speed a placement up).
  penalize(id: number, amount: number): void {
    const p = this.findById(id);
    if (!p) return;
    p.rating -= amount;
    this.persist();
  }

  all(): Account[] {
    return [...this.byToken.values()];
  }

  findByToken(token: string): Account | undefined {
    return this.byToken.get(token);
  }

  findById(id: number): Account | undefined {
    for (const p of this.byToken.values()) if (p.id === id) return p;
    return undefined;
  }

  get count(): number {
    return this.byToken.size;
  }
}
