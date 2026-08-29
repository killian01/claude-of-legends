// The one place this repo talks to a third party. No network here: a fake
// fetch stands in, so what is pinned is the request we send, the timeout,
// and the rule that a delivery failure is never an operation failure.

import { describe, expect, it, vi } from 'vitest';
import {
  LogMailer,
  type Mail,
  mailerFromEnv,
  ResendMailer,
  SEND_TIMEOUT_MS,
} from '../server/mailer';

const MAIL: Mail = { to: 'bob@example.com', subject: 'Subject', text: 'Body' };

function fakeFetch(res: Partial<Response> | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    if (res instanceof Error) throw res;
    return res as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('ResendMailer', () => {
  it('posts the mail as JSON with the key in the header', async () => {
    const { impl, calls } = fakeFetch({ ok: true, status: 200 });
    const mailer = new ResendMailer(
      'key-123',
      'Game <no-reply@example.com>',
      'https://api/x',
      impl,
    );
    expect(await mailer.send(MAIL)).toBe(true);

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe('https://api/x');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer key-123');
    expect(headers['content-type']).toBe('application/json');
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      from: 'Game <no-reply@example.com>',
      to: ['bob@example.com'],
      subject: 'Subject',
      text: 'Body',
    });
    // Plain text only: nothing here needs laying out, and an HTML mail
    // from a game nobody has heard of is what a spam filter looks for.
    expect(body.html).toBeUndefined();
  });

  it('reports a refusal as false rather than throwing', async () => {
    const { impl } = fakeFetch({ ok: false, status: 422 });
    const mailer = new ResendMailer('k', 'a@b.com', 'https://api/x', impl);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await mailer.send(MAIL)).toBe(false);
    // The status is what an operator needs; the player's address is not.
    expect(String(spy.mock.calls[0]?.[0])).toContain('422');
    expect(String(spy.mock.calls[0]?.[0])).not.toContain('bob@example.com');
    spy.mockRestore();
  });

  it('reports a dead relay as false too, so registration survives it', async () => {
    const { impl } = fakeFetch(new Error('ECONNREFUSED'));
    const mailer = new ResendMailer('k', 'a@b.com', 'https://api/x', impl);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await mailer.send(MAIL)).toBe(false);
    spy.mockRestore();
  });

  it('gives the provider a bounded amount of time', async () => {
    const { impl, calls } = fakeFetch({ ok: true, status: 200 });
    await new ResendMailer('k', 'a@b.com', 'https://api/x', impl).send(MAIL);
    // A registration waits on this call, so it must not wait forever.
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(SEND_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });
});

describe('mailerFromEnv', () => {
  it('needs both the key and the sender before it will send anything', () => {
    expect(mailerFromEnv({}).description).toContain('log only');
    expect(mailerFromEnv({ MAIL_API_KEY: 'k' }).description).toContain('log only');
    expect(mailerFromEnv({ MAIL_FROM: 'a@b.com' }).description).toContain('log only');
    // Blank is not configured, whatever the deploy tooling wrote.
    expect(mailerFromEnv({ MAIL_API_KEY: '  ', MAIL_FROM: 'a@b.com' }).description).toContain(
      'log only',
    );
  });

  it('sends for real once both are set, and says so at boot', () => {
    const m = mailerFromEnv({ MAIL_API_KEY: 'k', MAIL_FROM: 'Game <no-reply@example.com>' });
    expect(m).toBeInstanceOf(ResendMailer);
    expect(m.description).toContain('resend');
    // The boot line must never carry the key itself.
    expect(m.description).not.toContain('k');
  });
});

describe('LogMailer', () => {
  it('prints the link and admits in its own description that it did', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const m = new LogMailer();
    expect(await m.send(MAIL)).toBe(true);
    expect(String(spy.mock.calls[0]?.[0])).toContain('Body');
    spy.mockRestore();
    // It prints a bearer credential, so the boot log has to be loud.
    expect(m.description).toContain('no MAIL_API_KEY');
  });
});
