// The party packer: groups stay whole, sides balance, the unpackable wait.

import { describe, expect, it } from 'vitest';
import { packGroups } from '../server/party';

const pack = (sizes: number[], exact: boolean) => packGroups(sizes, 10, 5, { exact });

describe('party packing', () => {
  it('splits ten solos five and five', () => {
    const seated = pack(Array(10).fill(1), true);
    expect(seated).toHaveLength(10);
    expect(seated?.filter((s) => s.team === 0)).toHaveLength(5);
  });

  it('keeps parties whole on opposite sides and fills with solos', () => {
    const seated = pack([4, 4, 1, 1], true);
    expect(seated).toHaveLength(4);
    const teamOf = (i: number) => seated?.find((s) => s.index === i)?.team;
    expect(teamOf(0)).not.toBe(teamOf(1));
    // The solos land where room is left: one per side.
    expect(teamOf(2)).not.toBe(teamOf(3));
  });

  it('exact formation returns null when whole groups cannot reach the target', () => {
    // 3+3 fill to six, the third trio fits neither side, the solo gets to
    // seven: not a full match, nobody starts.
    expect(pack([3, 3, 3, 1], true)).toBeNull();
  });

  it('loose packing seats what fits and skips what does not', () => {
    const seated = pack([3, 3, 3, 1], false);
    expect(seated?.map((s) => s.index)).toEqual([0, 1, 3]);
    // A lone duo starts a bot game on one side, whole.
    const duo = pack([2], false);
    expect(duo).toEqual([{ index: 0, team: 0 }]);
  });

  it('never seats a group beyond the team cap', () => {
    const seated = pack([5, 5], true);
    expect(seated).toHaveLength(2);
    expect(seated?.[0]?.team).not.toBe(seated?.[1]?.team);
    expect(pack([6], false)).toEqual([]);
  });
});
