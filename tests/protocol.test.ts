// Wire protocol gate: parsing is safe on garbage and strict on shape.

import { describe, expect, it } from 'vitest';
import { isFiniteVec, parseClientMsg } from '../src/net/protocol';

describe('protocol', () => {
  it('parses well-formed client messages', () => {
    expect(parseClientMsg('{"t":"move","x":1,"z":2}')).toMatchObject({ t: 'move', x: 1, z: 2 });
    expect(parseClientMsg('{"t":"hello","name":"a"}')).toMatchObject({ t: 'hello' });
  });

  it('rejects garbage without throwing', () => {
    expect(parseClientMsg('not json')).toBeNull();
    expect(parseClientMsg('42')).toBeNull();
    expect(parseClientMsg('{"x":1}')).toBeNull();
    expect(parseClientMsg('null')).toBeNull();
  });

  it('validates finite vectors', () => {
    expect(isFiniteVec(1, 2)).toBe(true);
    expect(isFiniteVec(Number.NaN, 2)).toBe(false);
    expect(isFiniteVec(Number.POSITIVE_INFINITY, 2)).toBe(false);
    expect(isFiniteVec('1', 2)).toBe(false);
  });
});
