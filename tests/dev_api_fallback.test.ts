// The dev proxy's answer when no game server is running. It is small, and
// it is tested because the thing it protects is a first impression: a
// stranger's first `pnpm dev`, with the browser console open.

import { describe, expect, it } from 'vitest';
import { offlineApiNotice, offlineApiReply } from '../scripts/dev_api_fallback';

describe('the reply that stands in for an absent server', () => {
  it('is a success, because any error at all paints the console red', () => {
    // The whole point: Chrome logs "Failed to load resource" for every
    // status outside 2xx, and four of those are what this exists to stop.
    for (const method of ['GET', 'POST', undefined]) {
      expect(offlineApiReply(method).status).toBeLessThan(300);
      expect(offlineApiReply(method).status).toBeGreaterThanOrEqual(200);
    }
  });

  it('says null to a GET, which every caller already handles', () => {
    // src/ui/auth.ts, page.ts, home_bar.ts and profile_panel.ts each have a
    // null branch written for a server that answers "nothing yet". Reusing
    // it is what keeps this from being a fiction with its own behaviour.
    const reply = offlineApiReply('GET');
    expect(reply).toEqual({ status: 200, type: 'application/json', body: 'null' });
    expect(JSON.parse(reply.body)).toBeNull();
  });

  it('is case-insensitive about the method, since node does not promise one', () => {
    expect(offlineApiReply('get').body).toBe('null');
  });

  it('says nothing at all to the visit ping, which is fire and forget', () => {
    expect(offlineApiReply('POST')).toEqual({ status: 204, body: '' });
  });
});

describe('the line printed in the terminal instead', () => {
  it('names the port and the command that fixes it', () => {
    // The browser is told a harmless truth; the developer is told the
    // whole one, in the place they are actually looking.
    const notice = offlineApiNotice(8787);
    expect(notice).toContain('8787');
    expect(notice).toContain('pnpm server');
  });
});
