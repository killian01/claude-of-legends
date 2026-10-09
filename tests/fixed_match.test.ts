// A recorded 5v5 pinned by its state (ADR 0029, ADR 0030): ten house bots
// play three minutes on the Star Orchard from one seed, and the state of
// every unit, to the last bit, hashes to the number below. The ground
// geometry and the team count were rewritten under this test: a change that
// moves the 5v5 by one rounding moves the hash. A deliberate change of the
// 5v5's rules updates the number in the same commit and says why.

import { describe, expect, it } from 'vitest';
import { starOrchard } from '../server/star_orchard';
import { buildMatchSim, type ReplayPick } from '../src/net/replay';
import { DEFAULT_BOT_ID } from '../src/sim/content/bots/index';
import { CHAMPIONS } from '../src/sim/content/champions/index';

function fnv(hash: number, s: string): number {
  let h = hash;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function playedHash(ticks: number): { hash: number; units: number } {
  const ids = Object.keys(CHAMPIONS).sort();
  const picks: ReplayPick[] = [];
  for (let t = 0; t < 2; t++) {
    for (let i = 0; i < 5; i++) {
      picks.push({
        name: `bot${t}${i}`,
        team: t as 0 | 1,
        championId: ids[(i * 2 + t) % ids.length]!,
        sigils: ['riftstep', 'mend'],
        bot: DEFAULT_BOT_ID,
      });
    }
  }
  const { sim } = buildMatchSim(starOrchard(), 11, picks);
  let hash = 2166136261;
  for (let i = 1; i <= ticks; i++) {
    sim.tick();
    if (i % 20 !== 0) continue;
    for (const u of sim.units.values()) {
      hash = fnv(
        hash,
        `${u.id}:${u.pos.x}:${u.pos.z}:${u.hp}:${u.dead ? 1 : 0}:${u.level}:${u.xp}:${u.gold};`,
      );
    }
  }
  return { hash, units: sim.units.size };
}

describe('a recorded 5v5', () => {
  it('plays to the same state, to the last bit', () => {
    const run = playedHash(20 * 180);
    expect(run.units).toBeGreaterThan(60);
    expect(run.hash).toBe(PINNED);
  }, 120_000);
});

// Moved when Nisk joined the roster: the sorted ids the seats are dealt
// from gained an eleventh, and Nisk plays one of the ten seats.
const PINNED = 1221962103;
