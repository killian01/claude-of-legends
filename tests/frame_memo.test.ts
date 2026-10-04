// A value read from the page at most once a frame (src/render/frame_memo.ts):
// the first ask reads, the rest of the frame shares it, and a forget (a new
// frame, a resize) makes the next ask read again.

import { describe, expect, it } from 'vitest';
import { FrameMemo } from '../src/render/frame_memo';

describe('a value read once a frame', () => {
  it('reads on the first ask and shares it until forgotten', () => {
    let reads = 0;
    const memo = new FrameMemo(() => ({ left: 0, top: 0, width: 800 + reads++, height: 400 }));
    const a = memo.get();
    const b = memo.get();
    expect(reads).toBe(1);
    expect(b).toBe(a);
    memo.forget();
    expect(memo.get().width).toBe(801);
    expect(reads).toBe(2);
  });

  it('keeps a value that reads as nothing', () => {
    let reads = 0;
    const memo = new FrameMemo(() => {
      reads++;
      return 0;
    });
    memo.get();
    memo.get();
    expect(reads).toBe(1);
  });
});
