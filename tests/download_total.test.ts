// The map's progress bar counts against the decoded size (src/game/
// download_total.ts): a gzip twin's Content-Length is the compressed one,
// and counting against it filled the bar long before the map was in.

import { describe, expect, it } from 'vitest';
import { downloadTotal } from '../src/game/download_total';

const headers = (h: Record<string, string>) => new Headers(h);

describe('the size a download counts against', () => {
  it("is the server's length for a body sent as it is", () => {
    expect(downloadTotal(headers({ 'content-length': '14102380' }), 14_000_000)).toBe(14_102_380);
    expect(
      downloadTotal(headers({ 'content-length': '500', 'content-encoding': 'identity' }), 9),
    ).toBe(500);
  });

  it('is the expected size for an encoded body, whatever the length says', () => {
    expect(
      downloadTotal(
        headers({ 'content-length': '9265933', 'content-encoding': 'gzip' }),
        14_102_380,
      ),
    ).toBe(14_102_380);
    expect(downloadTotal(headers({ 'content-encoding': 'br' }), 42)).toBe(42);
  });

  it('is the expected size when the server does not say', () => {
    expect(downloadTotal(headers({}), 14_102_380)).toBe(14_102_380);
  });
});
