// One line of the ladder, from a Guest to an account (ADR 0027): the
// registry and the Guests linked the way server/main.ts links them, so a
// name is free among both at once, and registering in the browser of a
// Guest takes that Guest's points and name and retires it.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountRegistry } from '../server/accounts';
import { GuestStore, guestClaim } from '../server/guests';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function linked(): { registry: AccountRegistry; guests: GuestStore; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'loc-claim-'));
  dirs.push(dir);
  const registry = new AccountRegistry(path.join(dir, 'accounts.json'));
  let n = 0;
  const guests = new GuestStore({ file: path.join(dir, 'guests.json'), tokenGen: () => `t${n++}` });
  registry.holdNamesElsewhere((fold) => guests.holderOf(fold) !== undefined);
  return { registry, guests, dir };
}

const heldBy = (registry: AccountRegistry) => (fold: string) => registry.holdsName(fold);

describe('a name on the ladder', () => {
  it('is free among the accounts and the Guests at once', () => {
    const { registry, guests } = linked();
    const bob = registry.register('bob', 'a good password', '', 0);
    if (!bob.ok) throw new Error('fixture');
    // An account's name, and the one it left behind, are out of a Guest's reach.
    registry.rename(bob.value.id, 'robert', 1);
    const g = guests.issue(2).guest;
    expect(guests.setName(g.id, 'Bob', 3, heldBy(registry))).toEqual({
      ok: false,
      error: 'taken',
    });
    expect(guests.setName(g.id, 'Robert', 3, heldBy(registry))).toEqual({
      ok: false,
      error: 'taken',
    });
    // And a Guest's name is out of an account's.
    expect(guests.setName(g.id, 'Starling', 3, heldBy(registry)).ok).toBe(true);
    expect(registry.register('starling', 'a good password', '', 4)).toEqual({
      ok: false,
      error: 'name_taken',
    });
  });
});

describe('registering in a Guest browser', () => {
  it("takes the Guest's name and points, and retires the Guest", () => {
    const { registry, guests, dir } = linked();
    const { token, guest } = guests.issue(0);
    guests.addPoints(guest.id, 340, 1);
    guests.setName(guest.id, 'Starling', 2, heldBy(registry));
    const made = registry.register('Starling', 'a good password', '', 3, guestClaim(guest));
    if (!made.ok) throw new Error(`expected the claim to register, got ${made.error}`);
    guests.retire(guest.id);
    expect(made.value.points).toBe(340);
    expect(guests.resolve(token, 4)).toBeUndefined();
    // The name is the account's now, for good.
    expect(guests.holderOf('starling')).toBeUndefined();
    expect(registry.holdsName('starling')).toBe(true);
    // A restart finds one line, not two.
    registry.flush();
    guests.flush();
    const again = new GuestStore({ file: path.join(dir, 'guests.json') });
    expect(again.findById(guest.id)).toBeUndefined();
    expect(
      new AccountRegistry(path.join(dir, 'accounts.json')).findById(made.value.id)?.points,
    ).toBe(340);
  });

  it("moves an unnamed Guest's points under whatever name the account takes", () => {
    const { registry, guests } = linked();
    const { guest } = guests.issue(0);
    guests.addPoints(guest.id, 25, 1);
    const made = registry.register('Nightjar', 'a good password', '', 2, guestClaim(guest));
    expect(made.ok && made.value.points).toBe(25);
  });

  it('cannot take the name another Guest holds, cookie or not', () => {
    const { registry, guests } = linked();
    const holder = guests.issue(0).guest;
    guests.setName(holder.id, 'Starling', 1, heldBy(registry));
    const other = guests.issue(2).guest;
    expect(registry.register('Starling', 'a good password', '', 3, guestClaim(other))).toEqual({
      ok: false,
      error: 'name_taken',
    });
    expect(guestClaim(undefined)).toBeUndefined();
  });
});
