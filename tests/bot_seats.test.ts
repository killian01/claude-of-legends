// Bot seats in a live match (ADR 0013, plan-bots phase 5): the owner is a
// coach who only orders, never steers, is never idle-swept and never a
// leaver; the seat plays its own playbook whether the coach is connected
// or not; and the matchmaker seats a bot through the account boundary.

import { describe, expect, it } from 'vitest';
import { Match, type MatchPick } from '../server/match';
import { type BotSeat, Matchmaker, type MatchSource } from '../server/matchmaker';
import type { ServerMsg } from '../src/net/protocol';
import { NEW_BOT_PLAYBOOK } from '../src/sim/content/playbooks/new_bot';

const BOT_PICK: MatchPick = {
  clientId: 7,
  name: 'alice (Nightfall)',
  team: 0,
  championId: 'vesk',
  sigils: ['riftstep', 'sear'],
  skin: 1,
  playbook: NEW_BOT_PLAYBOOK,
};
const HAND_PICK: MatchPick = {
  clientId: 8,
  name: 'bob',
  team: 1,
  championId: 'korrath',
  sigils: ['riftstep', 'mend'],
};

describe('a bot seat in a match', () => {
  it('seats the owner as a coach: orders go through, steering does not', () => {
    const match = new Match(3, [BOT_PICK, HAND_PICK]);
    const coach = match.players.get(7)!;
    const hand = match.players.get(8)!;
    expect(coach.coach).toBe(true);
    expect(hand.coach).toBe(false);
    expect(match.sim.policies.has(coach.unitId)).toBe(true);
    expect(match.sim.policies.has(hand.unitId)).toBe(false);

    const unit = match.sim.units.get(coach.unitId)!;
    match.handleCommand(7, { t: 'move', x: 100, z: 100 });
    expect(unit.path).toEqual([]);
    match.handleCommand(7, { t: 'order', kind: 'goto', x: 100, z: 100 });
    expect(unit.coachOrder).toEqual({ kind: 'goto', x: 100, z: 100 });
    // The order is a recorded command, like any other.
    expect(match.replayEvents.at(-1)).toMatchObject({ u: coach.unitId, e: 'cmd' });

    // A hand seat cannot order itself.
    const handUnit = match.sim.units.get(hand.unitId)!;
    match.handleCommand(8, { t: 'order', kind: 'back' });
    expect(handUnit.coachOrder).toBeNull();
    match.handleCommand(8, { t: 'move', x: 100, z: 100 });
    expect(handUnit.path.length).toBeGreaterThan(0);
  });

  it('never sweeps a silent coach as idle', () => {
    const match = new Match(3, [BOT_PICK, HAND_PICK]);
    for (let i = 0; i < 50; i++) match.tick();
    expect(match.idleClientIds(10)).toEqual([8]);
  });

  it('keeps the bot playing when the coach drops, and takes the coach back', () => {
    const match = new Match(3, [BOT_PICK, HAND_PICK]);
    const unitId = match.players.get(7)!.unitId;
    const left = match.handleDisconnect(7);
    expect(left).toEqual({ name: 'alice (Nightfall)', team: 0, unitId, coach: true });
    expect(match.players.has(7)).toBe(false);
    expect(match.sim.policies.has(unitId)).toBe(true);
    // No stand-in was recorded: nothing changed on the map.
    expect(match.replayEvents.some((e) => e.e === 'bot_on')).toBe(false);
    match.restorePlayer(9, left!);
    expect(match.players.get(9)?.coach).toBe(true);
    expect(match.sim.policies.has(unitId)).toBe(true);
    expect(match.replayEvents.some((e) => e.e === 'bot_off')).toBe(false);
  });

  it('carries the playbook into the replay picks and the scoreboard name', () => {
    const match = new Match(3, [BOT_PICK, HAND_PICK]);
    expect(match.replayPicks[0]).toMatchObject({
      name: 'alice (Nightfall)',
      playbook: NEW_BOT_PLAYBOOK,
    });
    expect(match.replayPicks[1]!.playbook).toBeUndefined();
    const score = match.buildScore();
    expect(score.t === 'score' && score.rows.find((r) => r.team === 0)?.player).toBe(
      'alice (Nightfall)',
    );
  });
});

describe('a bot pick at select', () => {
  function harness(resolveBot: (clientId: number, botId: string) => BotSeat | null) {
    const sent = new Map<number, ServerMsg[]>();
    const matches: MatchPick[][] = [];
    const sources: MatchSource[] = [];
    const mm = new Matchmaker(
      (clientId, msg) => {
        const list = sent.get(clientId) ?? [];
        list.push(msg);
        sent.set(clientId, list);
      },
      (picks, source) => {
        matches.push(picks);
        sources.push(source);
      },
      undefined,
      { resolveBot },
    );
    return { mm, sent, matches };
  }
  const SEAT: BotSeat = {
    name: 'Nightfall',
    championId: 'vesk',
    sigils: ['zephyr', 'sear'],
    skin: 2,
    playbook: NEW_BOT_PLAYBOOK,
  };

  it('seats the resolved bot with its own champion, sigils and skin', () => {
    const { mm, matches } = harness((clientId, botId) =>
      clientId === 1 && botId === 'bot_1' ? SEAT : null,
    );
    mm.addToQueue(1, 'alice', 0);
    mm.startNow(1, 0);
    mm.pick(1, 'korrath', ['riftstep', 'mend'], 0, 'bot_1');
    expect(matches).toHaveLength(1);
    expect(matches[0]![0]).toMatchObject({
      clientId: 1,
      name: 'alice (Nightfall)',
      championId: 'vesk',
      sigils: ['zephyr', 'sear'],
      skin: 2,
      playbook: NEW_BOT_PLAYBOOK,
    });
  });

  it('falls back to a hand pick when the resolver says no', () => {
    const { mm, matches } = harness(() => null);
    mm.addToQueue(1, 'alice', 0);
    mm.startNow(1, 0);
    mm.pick(1, 'korrath', ['riftstep', 'mend'], 0, 'bot_nope');
    expect(matches[0]![0]).toMatchObject({ name: 'alice', championId: 'korrath' });
    expect(matches[0]![0]!.playbook).toBeUndefined();
  });
});
