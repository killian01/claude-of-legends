// The engine's counterplay levers (plan-bots phase 16): the fight's odds
// and the commit that never walks in under them, the wave management
// (freeze, shove) with its last hits and the stop verb, the observation
// fields they read, and the validator's door for all of it.

import { describe, expect, it } from 'vitest';
import { parseAction } from '../src/net/policy_wire';
import { dispatchAction } from '../src/sim/action_dispatch';
import { GAME_MAP } from '../src/sim/content/map';
import { buildObservation } from '../src/sim/observe';
import { validatePlaybook } from '../src/sim/playbook';
import { runBehavior } from '../src/sim/playbook/behaviors';
import { buildSlotContext } from '../src/sim/playbook/micro';
import { fightOdds, strengthOf } from '../src/sim/playbook/odds';
import { holds } from '../src/sim/playbook/triggers';
import { FREEZE_AHEAD, freeze, freezeSpot, laneTower } from '../src/sim/playbook/wave';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { createMinion } from '../src/sim/unit';

function scene(meId = 'korrath') {
  const sim = new Sim(9);
  const me = sim.addChampion(0, undefined, meId, 0);
  const ally = sim.addChampion(0, undefined, 'dain', 0);
  const foe1 = sim.addChampion(1, undefined, 'torv', 0);
  const foe2 = sim.addChampion(1, undefined, 'sylra', 0);
  me.pos = { x: 75, z: 75 };
  ally.pos = { x: 78, z: 75 };
  foe1.pos = { x: 85, z: 75 };
  foe2.pos = { x: 84, z: 79 };
  sim.tick();
  return { sim, me, ally, foe1, foe2 };
}

function ctxOf(sim: Sim, id: number) {
  return buildSlotContext(buildObservation(sim, id)!, new Rng(1));
}

describe('the odds', () => {
  it('weigh a champion by health and level', () => {
    expect(strengthOf(1, 1)).toBe(1);
    expect(strengthOf(1, 18)).toBeCloseTo(2);
    expect(strengthOf(0.5, 1)).toBe(0.5);
    expect(strengthOf(1, undefined)).toBe(1);
  });

  it('are my side over both within the radius: even, outnumbered, nobody', () => {
    const { sim, me, ally, foe1, foe2 } = scene();
    expect(fightOdds(ctxOf(sim, me.id))).toBeCloseTo(0.5);
    ally.pos = { x: 40, z: 40 };
    sim.tick();
    expect(fightOdds(ctxOf(sim, me.id))).toBeCloseTo(1 / 3);
    // Health weighs: half mine, the odds drop.
    me.hp = me.maxHp / 2;
    sim.tick();
    expect(fightOdds(ctxOf(sim, me.id))).toBeLessThan(0.3);
    foe1.pos = { x: 130, z: 130 };
    foe2.pos = { x: 130, z: 132 };
    sim.tick();
    expect(fightOdds(ctxOf(sim, me.id))).toBe(1);
  });

  it('are a trigger, within a radius of twenty when none is said', () => {
    const { sim, me } = scene();
    const ctx = ctxOf(sim, me.id);
    expect(holds({ kind: 'odds', atLeast: 0.5 }, ctx)).toBe(true);
    expect(holds({ kind: 'odds', below: 0.5 }, ctx)).toBe(false);
    // Within 5: the ally beside me, no enemy.
    expect(holds({ kind: 'odds', within: 5, atLeast: 0.99 }, ctx)).toBe(true);
  });

  it('gate the fight: under the commit the bot never walks in, over it it does', () => {
    const { sim, me, ally } = scene();
    ally.pos = { x: 40, z: 40 };
    sim.tick();
    const ctx = ctxOf(sim, me.id);
    // A melee ten units from its target: the front stance chases.
    const chase = runBehavior({ kind: 'fight', stance: 'front' }, ctx);
    expect(chase?.kind).toBe('move');
    // One against two: the commit at even odds passes the turn.
    expect(runBehavior({ kind: 'fight', stance: 'front', commitAt: 0.5 }, ctx)).toBeNull();
    // A commit the odds clear walks in.
    expect(runBehavior({ kind: 'fight', stance: 'front', commitAt: 0.3 }, ctx)?.kind).toBe('move');
  });

  it('let an uncommitted bot strike what reaches it, and kite instead of approaching', () => {
    const { sim, me, ally, foe1 } = scene('vesk');
    ally.pos = { x: 40, z: 40 };
    // Out of reach, inside the approach band: the kite approaches only committed.
    sim.tick();
    const far = ctxOf(sim, me.id);
    expect(runBehavior({ kind: 'fight', stance: 'kite' }, far)?.kind).toBe('move');
    expect(runBehavior({ kind: 'fight', stance: 'kite', commitAt: 0.5 }, far)).toBeNull();
    // In reach: the strike lands whatever the odds.
    foe1.pos = { x: 80, z: 75 };
    sim.tick();
    const near = ctxOf(sim, me.id);
    // (Idle defense may already have a swing in the air: then the kite
    // holds it with a noop rather than stepping.)
    const strike = runBehavior({ kind: 'fight', stance: 'kite', commitAt: 0.5 }, near);
    expect(['attack', 'cast', 'noop']).toContain(strike?.kind);
  });
});

describe('the wave', () => {
  function withMinions(sim: Sim, me: { pos: { x: number; z: number } }, enemyHp?: number) {
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const id = 9000 + i;
      const m = createMinion(id, 1, 'melee', 'top', { x: me.pos.x + 3 + i, z: me.pos.z + 1 });
      if (enemyHp !== undefined) m.hp = enemyHp;
      sim.units.set(id, m);
      ids.push(id);
    }
    const own = createMinion(9100, 0, 'melee', 'top', { x: me.pos.x - 2, z: me.pos.z });
    sim.units.set(9100, own);
    sim.tick();
    return ids;
  }

  it('is counted by the minions trigger, a side at a time', () => {
    const { sim, me } = scene();
    withMinions(sim, me);
    const ctx = ctxOf(sim, me.id);
    expect(holds({ kind: 'minions', side: 'enemy', within: 8, atLeast: 3 }, ctx)).toBe(true);
    expect(holds({ kind: 'minions', side: 'own', within: 8, atLeast: 2 }, ctx)).toBe(false);
    expect(holds({ kind: 'minions', side: 'own', within: 8, atMost: 1 }, ctx)).toBe(true);
  });

  it('is last hit only when a strike kills: the farm in lastHit mode', () => {
    const { sim, me } = scene();
    withMinions(sim, me);
    const healthy = ctxOf(sim, me.id);
    expect(runBehavior({ kind: 'farm', mode: 'lastHit' }, healthy)).toBeNull();
    expect(runBehavior({ kind: 'farm' }, healthy)?.kind).toBe('attack');
    const ad = sim.units.get(me.id)!.stats.ad;
    for (const id of [9000, 9001, 9002]) sim.units.get(id)!.hp = ad - 1 + (id - 9000) * 5;
    sim.tick();
    const low = ctxOf(sim, me.id);
    expect(low.s.attackDamage).toBe(ad);
    // The lowest of the killable ones.
    expect(runBehavior({ kind: 'farm', mode: 'lastHit' }, low)).toEqual({
      kind: 'attack',
      targetId: 9000,
    });
  });

  it('freezes in front of the lane tower: walk to the spot, hold there, last hit what dies', () => {
    const { sim, me, ally, foe1, foe2 } = scene();
    for (const u of [ally, foe1, foe2]) u.pos = { x: 140, z: 140 };
    me.lane = 'top';
    const outer = GAME_MAP.towers.find((t) => t.team === 0 && t.lane === 'top' && t.tier === 1)!;
    const towardEnemy = {
      x:
        (GAME_MAP.sanctums[1]!.x - outer.x) /
        Math.hypot(GAME_MAP.sanctums[1]!.x - outer.x, GAME_MAP.sanctums[1]!.z - outer.z),
      z:
        (GAME_MAP.sanctums[1]!.z - outer.z) /
        Math.hypot(GAME_MAP.sanctums[1]!.x - outer.x, GAME_MAP.sanctums[1]!.z - outer.z),
    };
    me.pos = { x: outer.x + towardEnemy.x * 25, z: outer.z + towardEnemy.z * 25 };
    sim.tick();
    const far = ctxOf(sim, me.id);
    const tower = laneTower(far)!;
    expect(tower).not.toBeNull();
    expect(Math.hypot(tower.x - outer.x, tower.z - outer.z)).toBeLessThan(1);
    const spot = freezeSpot(far, tower);
    expect(Math.hypot(spot.x - tower.x, spot.z - tower.z)).toBeCloseTo(FREEZE_AHEAD);
    const walk = freeze(far);
    expect(walk?.kind).toBe('move');
    if (walk?.kind === 'move') {
      expect(Math.hypot(walk.x - spot.x, walk.z - spot.z)).toBeLessThan(2.5);
    }
    // At the spot: stop, then hold (noop) once the sim says holding.
    me.pos = { x: spot.x, z: spot.z };
    sim.tick();
    const at = ctxOf(sim, me.id);
    expect(freeze(at)).toEqual({ kind: 'stop' });
    expect(dispatchAction(sim, me.id, { kind: 'stop' })).toBe(true);
    expect(sim.units.get(me.id)!.holding).toBe(true);
    sim.tick();
    const holding = ctxOf(sim, me.id);
    expect(holding.s.holding).toBe(true);
    expect(freeze(holding)).toEqual({ kind: 'noop' });
    // A killable minion in reach is the freeze's strike.
    const ad = sim.units.get(me.id)!.stats.ad;
    withMinions(sim, me, ad - 1);
    const hit = runBehavior({ kind: 'manageWave', intent: 'freeze' }, ctxOf(sim, me.id));
    expect(hit?.kind).toBe('attack');
    // No lane tower left: the freeze passes the turn.
    for (const u of sim.units.values()) {
      if (u.kind === 'tower' && u.team === 0 && u.structure?.lane === 'top') {
        u.dead = true;
        u.hp = 0;
      }
    }
    sim.tick();
    expect(freeze(ctxOf(sim, me.id))).toBeNull();
  });

  it('shoves through the same behavior', () => {
    const { sim, me } = scene();
    withMinions(sim, me);
    expect(runBehavior({ kind: 'manageWave', intent: 'shove' }, ctxOf(sim, me.id))?.kind).toBe(
      'attack',
    );
  });
});

describe('the observation and the wire', () => {
  it('carry health in points, the level, the attack damage and the hold', () => {
    const { sim, me, foe1 } = scene();
    const obs = buildObservation(sim, me.id)!;
    const foe = obs.units.find((u) => u.id === foe1.id)!;
    expect(foe.hp).toBe(foe1.hp);
    expect(foe.maxHp).toBe(foe1.maxHp);
    expect(foe.level).toBe(foe1.level);
    expect(obs.self.attackDamage).toBe(me.stats.ad);
    expect(obs.self.holding).toBe(false);
  });

  it('parse stop and sell off the wire', () => {
    expect(parseAction({ kind: 'stop' })).toEqual({ kind: 'stop' });
    expect(parseAction({ kind: 'sell', slot: 2 })).toEqual({ kind: 'sell', slot: 2 });
    expect(parseAction({ kind: 'sell', slot: -1 })).toBeNull();
  });
});

describe('the validator', () => {
  const play = (when: unknown, doo: unknown) => ({
    version: 4,
    plays: [{ id: 'p', when, do: doo }],
  });

  it('accepts the odds, the minions, the commit, the farm mode and the wave', () => {
    expect(
      validatePlaybook(play({ kind: 'odds', atLeast: 0.5 }, { kind: 'fight', commitAt: 0.5 })).ok,
    ).toBe(true);
    expect(
      validatePlaybook(
        play(
          { kind: 'minions', side: 'enemy', within: 12, atLeast: 4 },
          { kind: 'farm', mode: 'lastHit' },
        ),
      ).ok,
    ).toBe(true);
    expect(
      validatePlaybook(play({ kind: 'always' }, { kind: 'manageWave', intent: 'freeze' })).ok,
    ).toBe(true);
  });

  it('refuses what is out of bounds or unnamed', () => {
    expect(validatePlaybook(play({ kind: 'odds', within: 20 }, { kind: 'farm' })).ok).toBe(false);
    expect(validatePlaybook(play({ kind: 'odds', atLeast: 2 }, { kind: 'farm' })).ok).toBe(false);
    expect(
      validatePlaybook(play({ kind: 'minions', within: 12, atLeast: 4 }, { kind: 'farm' })).ok,
    ).toBe(false);
    expect(validatePlaybook(play({ kind: 'always' }, { kind: 'fight', commitAt: 1.5 })).ok).toBe(
      false,
    );
    expect(validatePlaybook(play({ kind: 'always' }, { kind: 'farm', mode: 'deny' })).ok).toBe(
      false,
    );
    expect(validatePlaybook(play({ kind: 'always' }, { kind: 'manageWave' })).ok).toBe(false);
  });
});

describe('the collapse', () => {
  it('names the threatened tower and walks to it, passing beside it or with none', () => {
    const { sim, me, ally, foe1, foe2 } = scene();
    ally.pos = { x: 140, z: 140 };
    foe2.pos = { x: 140, z: 140 };
    // The mid outer tower of team 0 stands at 57, 57; an enemy beside it.
    me.pos = { x: 68, z: 68 };
    foe1.pos = { x: 60, z: 60 };
    sim.tick();
    const ctx = ctxOf(sim, me.id);
    expect(holds({ kind: 'towerThreatened' }, ctx)).toBe(true);
    expect(holds({ kind: 'towerThreatened', within: 12 }, ctx)).toBe(false);
    const go = runBehavior({ kind: 'defendTower' }, ctx);
    expect(go?.kind).toBe('move');
    if (go?.kind === 'move') expect(Math.hypot(go.x - 57, go.z - 57)).toBeLessThan(2.5);
    expect(runBehavior({ kind: 'defendTower', within: 12 }, ctx)).toBeNull();
    // Beside the tower: the plays below take the slot.
    me.pos = { x: 60, z: 62 };
    sim.tick();
    expect(runBehavior({ kind: 'defendTower' }, ctxOf(sim, me.id))).toBeNull();
    // The enemy gone: nothing to defend.
    foe1.pos = { x: 90, z: 90 };
    sim.tick();
    expect(holds({ kind: 'towerThreatened' }, ctxOf(sim, me.id))).toBe(false);
  });

  it('is accepted by the validator with its radius, and refused past the map', () => {
    const ok = validatePlaybook({
      version: 4,
      plays: [
        { id: 'd', when: { kind: 'towerThreatened', within: 60 }, do: { kind: 'defendTower' } },
      ],
    });
    expect(ok.ok).toBe(true);
    const far = validatePlaybook({
      version: 4,
      plays: [{ id: 'd', when: { kind: 'always' }, do: { kind: 'defendTower', within: 500 } }],
    });
    expect(far.ok).toBe(false);
  });
});
