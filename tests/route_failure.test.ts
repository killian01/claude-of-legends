import { describe, expect, it } from 'vitest';
import { failureReply } from '../server/route_failure';

// The error node:sqlite throws when a write cannot reach the disk.
function sqliteError(errcode: number, message: string): Error {
  return Object.assign(new Error(message), { code: 'ERR_SQLITE_ERROR', errcode, errstr: message });
}

describe('failureReply', () => {
  it('answers a store write that hits a disk I/O error with 503 and a retry', () => {
    const reply = failureReply('/api/bots/save', sqliteError(4874, 'disk I/O error'));
    expect(reply.status).toBe(503);
    expect(reply.headers['content-type']).toBe('application/json');
    expect(reply.headers['retry-after']).toBe('5');
    expect(JSON.parse(reply.body).error).toMatch(/try again/i);
    expect(reply.log).toBe(true);
  });

  it('answers a full disk on an API route with 503 too', () => {
    expect(
      failureReply('/api/forge/draft', sqliteError(13, 'database or disk is full')).status,
    ).toBe(503);
  });

  it('answers any other throw on an API route with a logged JSON 500, not a missing route', () => {
    const reply = failureReply('/api/ladder', new TypeError('x is undefined'));
    expect(reply.status).toBe(500);
    expect(reply.headers['content-type']).toBe('application/json');
    expect(reply.headers['retry-after']).toBeUndefined();
    expect(typeof JSON.parse(reply.body).error).toBe('string');
    expect(reply.log).toBe(true);
  });

  it('keeps a plain 404 for a file that cannot be served', () => {
    const reply = failureReply('/assets/missing.js', new Error('ENOENT'));
    expect(reply.status).toBe(404);
    expect(reply.headers['content-type']).toBe('text/plain');
    expect(reply.body).toBe('not found');
    expect(reply.log).toBe(false);
  });

  it('never shows the error text to the client', () => {
    const reply = failureReply('/api/me', new Error('SELECT secret FROM accounts'));
    expect(reply.body).not.toContain('secret');
  });
});
