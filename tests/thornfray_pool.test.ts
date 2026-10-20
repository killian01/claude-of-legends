// The kinds a Thornfray draws from on a server (server/thornfray_pool.ts):
// the released pool, unless a local stack opens the kinds in progress.

import { describe, expect, it } from 'vitest';
import { THORNFRAY_UNRELEASED, thornfrayPool } from '../server/thornfray_pool';
import { BOUT_KINDS, boutPool } from '../src/sim/content/bouts';
import { testKind } from './thornfray_fixture';

describe('the Thornfray pool on a server', () => {
  it('is the released pool by default', () => {
    expect(thornfrayPool({})).toEqual(boutPool());
    expect(thornfrayPool({ [THORNFRAY_UNRELEASED]: '0' })).toEqual(boutPool());
    const kinds = [testKind({ id: 'a', released: true }), testKind({ id: 'b', released: false })];
    expect(thornfrayPool({}, kinds).map((k) => k.id)).toEqual(['a']);
  });

  it('holds every registered kind on a stack that asks for them', () => {
    expect(thornfrayPool({ [THORNFRAY_UNRELEASED]: '1' })).toEqual([...BOUT_KINDS]);
    const kinds = [testKind({ id: 'a', released: true }), testKind({ id: 'b', released: false })];
    expect(thornfrayPool({ [THORNFRAY_UNRELEASED]: ' 1 ' }, kinds).map((k) => k.id)).toEqual([
      'a',
      'b',
    ]);
  });
});
