// The viewer's refusal wording (src/ui/replay_notice.ts) and the build the
// server tells (server/build_info.ts): a record the server wrote under
// its own build is never "an older version", the page is.

import { describe, expect, it } from 'vitest';
import { buildInfo } from '../server/build_info';
import { starOrchard } from '../server/star_orchard';
import { REPLAY_VERSION } from '../src/net/replay';
import { contentFingerprint } from '../src/sim/content/fingerprint';
import { replayRefusal } from '../src/ui/replay_notice';

describe('the replay refusal', () => {
  const orchard = starOrchard();
  const here = contentFingerprint(orchard);
  const server = buildInfo(orchard);

  it('tells the build the server runs, as a replay reads it', () => {
    expect(server).toEqual({ version: REPLAY_VERSION, content: here });
    expect(Object.keys(server).sort()).toEqual(['content', 'version']);
  });

  it('says a record is gone when there is none', () => {
    expect(replayRefusal(null, server, here).text).toMatch(/gone/);
    expect(replayRefusal({}, server, here).text).toMatch(/gone/);
  });

  it('says a record is older when the server would refuse it too', () => {
    const old = { version: REPLAY_VERSION - 1, content: 'deadbeef' };
    const r = replayRefusal(old, server, here);
    expect(r.title).toBe('Replay unavailable');
    expect(r.text).toMatch(/older version/);
    // Without a server to ask, the record gets the same benefit of nothing.
    expect(replayRefusal(old, null, here).text).toMatch(/older version/);
  });

  it('says the page is out of date when the server wrote the record under its own build', () => {
    const fresh = { version: REPLAY_VERSION, content: 'c0ffee00' };
    const newer = { version: REPLAY_VERSION, content: 'c0ffee00' };
    const r = replayRefusal(fresh, newer, here);
    expect(r.title).toBe('This page is out of date');
    expect(r.text).toMatch(/Reload the page/);
    // A server past this page's version says the same, whatever the record.
    const later = replayRefusal(
      { version: REPLAY_VERSION + 1, content: 'x' },
      { version: REPLAY_VERSION + 1, content: 'y' },
      here,
    );
    expect(later.title).toBe('This page is out of date');
  });
});
