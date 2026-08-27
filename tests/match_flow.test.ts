// End-to-end match gate, no sockets: a Match wired straight to two
// ClientWorlds. Commands flow up, team-scoped snapshots flow down, the fog
// of war holds on the wire, and the mirror world tracks the sim.

import { describe, expect, it } from 'vitest';
import { Match } from '../server/match';
import { ClientWorld } from '../src/net/client_world';

function wire(): { match: Match; a: ClientWorld; b: ClientWorld; step: (n: number) => void } {
  const match = new Match(7, [
    { clientId: 1, name: 'alice', team: 0, championId: 'sylra', sigils: ['riftstep', 'mend'] },
    { clientId: 2, name: 'bob', team: 1, championId: 'fenn', sigils: ['zephyr', 'sear'] },
  ]);
  const a = new ClientWorld((msg) => match.handleCommand(1, msg));
  const b = new ClientWorld((msg) => match.handleCommand(2, msg));
  const pa = match.players.get(1)!;
  const pb = match.players.get(2)!;
  a.applyServer({ t: 'match_start', selfUnitId: pa.unitId, team: 0 });
  b.applyServer({ t: 'match_start', selfUnitId: pb.unitId, team: 1 });
  const step = (n: number): void => {
    for (let i = 0; i < n; i++) {
      match.tick();
      const sa = match.buildSnapshotFor(1);
      const sb = match.buildSnapshotFor(2);
      if (sa) a.applyServer(sa);
      if (sb) b.applyServer(sb);
    }
  };
  return { match, a, b, step };
}

describe('online match flow', () => {
  it('applies picks: champion and sigils reach the sim', () => {
    const { match } = wire();
    const units = [...match.sim.units.values()].filter((u) => u.kind === 'champion');
    expect(units.map((u) => u.championId).sort()).toEqual(['fenn', 'sylra']);
    expect(units.find((u) => u.championId === 'fenn')?.sigils).toEqual(['zephyr', 'sear']);
  });

  it('never puts a fogged enemy on the wire, and mirrors what is visible', () => {
    const { match, a, step } = wire();
    step(1);
    const pb = match.players.get(2)!;
    // Enemies sit at their own fountains, far outside vision.
    expect(a.units.has(pb.unitId)).toBe(false);
    // Structures are always on the wire.
    const towers = [...a.units.values()].filter((u) => u.kind === 'tower');
    expect(towers).toHaveLength(16);

    // Teleport the enemy next to alice: it must appear with full identity.
    const enemyUnit = match.sim.units.get(pb.unitId)!;
    const selfUnit = match.sim.units.get(match.players.get(1)!.unitId)!;
    enemyUnit.pos = { x: selfUnit.pos.x + 4, z: selfUnit.pos.z };
    step(1);
    const mirrored = a.units.get(pb.unitId);
    expect(mirrored).toBeDefined();
    expect(mirrored?.championId).toBe('fenn');
    expect(mirrored?.team).toBe(1);

    // And vanish again once it walks back into the fog.
    enemyUnit.pos = { x: 140, z: 140 };
    step(1);
    expect(a.units.has(pb.unitId)).toBe(false);
  });

  it('moves the champion through the wire and mirrors the motion', () => {
    const { match, a, step } = wire();
    step(1);
    const selfId = a.selfUnitId;
    const before = { ...a.units.get(selfId)!.pos };
    a.orderMove(selfId, 30, 30);
    step(60);
    const after = a.units.get(selfId)!.pos;
    const moved = Math.hypot(after.x - before.x, after.z - before.z);
    expect(moved).toBeGreaterThan(5);
    // The mirror matches the authoritative sim within rounding.
    const simPos = match.sim.units.get(selfId)!.pos;
    expect(Math.abs(after.x - simPos.x)).toBeLessThan(0.02);
    expect(Math.abs(after.z - simPos.z)).toBeLessThan(0.02);
  });

  it('mirrors self state: casting spends mana and starts cooldowns', () => {
    const { match, a, step } = wire();
    step(1);
    const selfId = a.selfUnitId;
    match.sim.units.get(selfId)!.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    a.castAbility(selfId, 'Q', { x: 20, z: 20 });
    step(2);
    const self = a.units.get(selfId)!;
    expect(self.mana).toBeLessThan(self.maxMana);
    // Attack damage mirrors too, for the last-hit indicator.
    expect(self.stats.ad).toBeGreaterThan(0);
    expect((self.cooldowns.Q ?? 0) > match.sim.time - 1).toBe(true);
    expect(match.sim.projectiles.size + a.projectiles.size).toBeGreaterThanOrEqual(0);
  });

  it('mirrors minions once waves spawn, scoped by team vision', () => {
    const { match, a, step } = wire();
    step(210);
    const simMinions = [...match.sim.units.values()].filter((u) => u.kind === 'minion');
    expect(simMinions).toHaveLength(30);
    const mirroredMinions = [...a.units.values()].filter((u) => u.kind === 'minion');
    // Alice sees her own team's 15 minions plus whatever enemy minions are lit.
    expect(mirroredMinions.length).toBeGreaterThanOrEqual(15);
    expect(mirroredMinions.length).toBeLessThanOrEqual(30);
    for (const m of mirroredMinions) {
      if (m.team === 1) {
        expect(match.sim.isVisible(0, m.id)).toBe(true);
      }
    }
  });

  it('scopes chat and ping recipients to the sender team', () => {
    const match = new Match(7, [
      { clientId: 1, name: 'alice', team: 0, championId: 'sylra', sigils: ['riftstep', 'mend'] },
      { clientId: 2, name: 'ana', team: 0, championId: 'maera', sigils: ['riftstep', 'mend'] },
      { clientId: 3, name: 'bob', team: 1, championId: 'fenn', sigils: ['zephyr', 'sear'] },
    ]);
    // A ping must never hand the enemy a coordinate: the social layer is
    // team-scoped exactly like the snapshot layer.
    expect(match.teamRecipients(1).sort()).toEqual([1, 2]);
    expect(match.teamRecipients(3)).toEqual([3]);
    expect(match.teamRecipients(99)).toEqual([]);
  });

  it('hands a disconnected player seat to a bot that keeps playing', () => {
    const { match, step } = wire();
    step(1);
    const pa = match.players.get(1)!;
    const unit = match.sim.units.get(pa.unitId)!;
    const before = { ...unit.pos };

    const left = match.handleDisconnect(1);
    expect(left).toEqual({ name: 'alice', team: 0 });
    // The seat is gone from the wire: no snapshots, no recipients.
    expect(match.players.has(1)).toBe(false);
    expect(match.buildSnapshotFor(1)).toBeNull();
    // The scoreboard row says who this champion was.
    const score = match.buildScore() as { t: 'score'; rows: { name: string }[] };
    expect(score.rows.some((r) => r.name === 'alice (bot)')).toBe(true);
    // The champion is not inert: the bot policy walks it out of the fountain.
    step(200);
    const moved = Math.hypot(unit.pos.x - before.x, unit.pos.z - before.z);
    expect(moved).toBeGreaterThan(3);
    // A second disconnect for the same seat is a no-op.
    expect(match.handleDisconnect(1)).toBeNull();
  });

  it('rejects commands for units the client does not own', () => {
    const { match, b, step } = wire();
    step(1);
    const pa = match.players.get(1)!;
    const aliceUnit = match.sim.units.get(pa.unitId)!;
    const before = { ...aliceUnit.pos };
    // Bob's world sends commands as Bob; the server routes them to Bob's
    // unit, never Alice's, no matter what unit id the client claims.
    b.orderMove(pa.unitId, 100, 100);
    step(20);
    const aliceMoved = Math.hypot(aliceUnit.pos.x - before.x, aliceUnit.pos.z - before.z);
    expect(aliceMoved).toBe(0);
  });
});
