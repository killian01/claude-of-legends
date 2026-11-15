// What the online mirror keeps of a match's start for its end screen (ADR
// 0036, ADR 0027): the private lobby the seat came from, and whether the
// match banks points, both told by match_start and told again on a rejoin.

import { describe, expect, it } from 'vitest';
import { starOrchard } from '../server/star_orchard';
import { ClientWorld } from '../src/net/client_world';

function world(): ClientWorld {
  return new ClientWorld(() => undefined, starOrchard().map);
}

describe("the mirror's match start", () => {
  it('knows no lobby and no points before a match starts', () => {
    const w = world();
    expect(w.lobby).toBeNull();
    expect(w.scores).toBe(false);
  });

  it('keeps the lobby a seat came from and whether the match scores', () => {
    const w = world();
    w.applyServer({ t: 'match_start', selfUnitId: 1, team: 0, lobby: 'KMNPQR' });
    expect(w.lobby).toBe('KMNPQR');
    expect(w.scores).toBe(false);
    const q = world();
    q.applyServer({ t: 'match_start', selfUnitId: 1, team: 0, scores: true });
    expect(q.lobby).toBeNull();
    expect(q.scores).toBe(true);
  });

  it('takes both from the latest start, a rejoin included', () => {
    const w = world();
    w.applyServer({ t: 'match_start', selfUnitId: 1, team: 0, lobby: 'KMNPQR' });
    w.applyServer({ t: 'match_start', selfUnitId: 1, team: 0, scores: true });
    expect(w.lobby).toBeNull();
    expect(w.scores).toBe(true);
  });

  it('keeps only a code of the right shape', () => {
    const w = world();
    w.applyServer({ t: 'match_start', selfUnitId: 1, team: 0, lobby: 'not a code' });
    expect(w.lobby).toBeNull();
    w.applyServer({ t: 'match_start', selfUnitId: 1, team: 0, lobby: 'kmnpqr' });
    expect(w.lobby).toBe('KMNPQR');
  });
});
