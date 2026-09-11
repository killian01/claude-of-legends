// The locked cursor's pure parts (src/game/cursor_lock.ts): the virtual
// position never leaves the window, and the painted cursor is read off a
// CSS cursor value with its hotspot.

import { describe, expect, it } from 'vitest';
import { clampToViewport, cursorImageOf } from '../src/game/cursor_lock';

describe('the locked cursor', () => {
  it('clamps the virtual position to the window', () => {
    expect(clampToViewport(10, 20, 800, 600)).toEqual({ x: 10, y: 20 });
    expect(clampToViewport(-5, 700, 800, 600)).toEqual({ x: 0, y: 599 });
    expect(clampToViewport(900, -1, 800, 600)).toEqual({ x: 799, y: 0 });
  });

  it('reads the painted cursor and its hotspot off a CSS cursor, none off a keyword', () => {
    expect(cursorImageOf('url("data:image/png;base64,AAAA") 3 1, auto')).toEqual({
      url: 'data:image/png;base64,AAAA',
      hotX: 3,
      hotY: 1,
    });
    expect(cursorImageOf("url('x.png'), pointer")).toEqual({ url: 'x.png', hotX: 0, hotY: 0 });
    expect(cursorImageOf('pointer')).toBeNull();
    expect(cursorImageOf('')).toBeNull();
  });
});
