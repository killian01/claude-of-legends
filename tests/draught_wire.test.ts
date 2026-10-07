// A Sapdraught on the wire: the seat's own block carries the draught, so
// an online client knows one runs. Its Drink button and bag slot grey, its
// chip shows, and a second drink is refused on the client with the same
// answer the sim gives offline, instead of a tap that does nothing visible.

import { describe, expect, it } from 'vitest';
import { Match } from '../server/match';
import { starOrchard } from '../server/star_orchard';
import { ClientWorld } from '../src/net/client_world';
import type { ClientMsg } from '../src/net/protocol';
import { draughtLeft } from '../src/sim/draught';
import { drinkButton } from '../src/ui/touch_bar';

function drinkingAlice(): { match: Match; aliceId: number } {
  const match = new Match(11, [
    { clientId: 1, name: 'alice', team: 0, championId: 'korrath', sigils: ['riftstep', 'mend'] },
    { clientId: 2, name: 'bob', team: 1, championId: 'fenn', sigils: ['zephyr', 'sear'] },
  ]);
  const aliceId = match.players.get(1)!.unitId;
  match.sim.units.get(aliceId)!.items = ['sapdraught', 'sapdraught'];
  return { match, aliceId };
}

function mirror(match: Match, aliceId: number, sent: ClientMsg[]): ClientWorld {
  const client = new ClientWorld((m) => sent.push(m), starOrchard().map);
  client.applyServer({ t: 'match_start', selfUnitId: aliceId, team: 0 });
  const snap = match.buildSnapshotFor(1);
  if (snap?.t !== 'snap') throw new Error('expected a snap message');
  client.applyServer(snap);
  return client;
}

describe('a Sapdraught on the wire', () => {
  it('mirrors a running draught on the own champion and refuses a second drink', () => {
    const { match, aliceId } = drinkingAlice();
    expect(match.sim.drinkItem(aliceId, 0)).toBe(true);
    match.tick();
    const sent: ClientMsg[] = [];
    const client = mirror(match, aliceId, sent);
    const me = client.units.get(aliceId)!;
    expect(draughtLeft(me, client.time)).toBeGreaterThan(0);
    expect(me.statuses.some((s) => s.kind === 'draught')).toBe(true);
    expect(client.drinkItem(aliceId, 0)).toBe(false);
    expect(sent.filter((m) => m.t === 'drink')).toEqual([]);
    expect(drinkButton(me, client.time)).toBe('busy');
  });

  it('lets the next drink go up once the draught is done', () => {
    const { match, aliceId } = drinkingAlice();
    expect(match.sim.drinkItem(aliceId, 0)).toBe(true);
    for (let i = 0; i < 12 * 20; i++) match.tick();
    const sent: ClientMsg[] = [];
    const client = mirror(match, aliceId, sent);
    const me = client.units.get(aliceId)!;
    expect(draughtLeft(me, client.time)).toBe(0);
    expect(drinkButton(me, client.time)).toBe('ready');
    expect(client.drinkItem(aliceId, 0)).toBe(true);
    expect(sent.filter((m) => m.t === 'drink')).toEqual([{ t: 'drink', slot: 0 }]);
  });

  it('hides the Drink button with nothing to drink or a dead champion', () => {
    const { match, aliceId } = drinkingAlice();
    const me = match.sim.units.get(aliceId)!;
    expect(drinkButton(me, match.sim.time)).toBe('ready');
    me.items = ['iron_blade'];
    expect(drinkButton(me, match.sim.time)).toBe('hidden');
    me.items = ['sapdraught'];
    me.dead = true;
    expect(drinkButton(me, match.sim.time)).toBe('hidden');
    expect(drinkButton(undefined, match.sim.time)).toBe('hidden');
  });
});
