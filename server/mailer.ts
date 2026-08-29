// Getting a link out of the box, and the only place in this repo that
// talks to a third party.
//
// It is an HTTPS call and nothing more: no SMTP client, no new package
// (CLAUDE.md keeps the dependency set tiny), and no inbound port. The
// container still publishes nothing and still sits off the km01 network
// (docs/deploy.md); it only makes an outbound request.
//
// Delivery is best effort by design. Every caller of send() treats false
// as "the player did not get their link", never as "the operation failed":
// registration must succeed with the mail relay down, or an outage at a
// third party becomes an outage of the game (ADR 0007).

export interface Mail {
  to: string;
  subject: string;
  // Plain text only. An HTML mail from a game nobody has heard of is what
  // a spam filter is looking for, and there is nothing here to lay out.
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<boolean>;
  // What the boot log says about it, so a misconfigured relay is visible
  // at startup rather than the first time somebody forgets a password.
  readonly description: string;
}

// How long to wait on the provider before giving up. A registration is
// blocked on this, so it is short: the player gets their account either
// way, and a slow relay must not hold the response open.
export const SEND_TIMEOUT_MS = 8000;

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export class ResendMailer implements Mailer {
  readonly description: string;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly endpoint: string = RESEND_ENDPOINT,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.description = `resend, from ${from}`;
  }

  async send(mail: Mail): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        // The address is a player's, so it stays out of the log; the
        // status is what an operator needs and all they need.
        console.error(`mail send refused with ${res.status}`);
        return false;
      }
      return true;
    } catch (err) {
      console.error('mail send failed', err);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

// No relay configured: the link goes to the log so a developer can follow
// it, and the boot line says loudly that this is what is happening. This
// prints a bearer credential, which is exactly why it refuses to be the
// production answer: server/main.ts only reaches for it without an API
// key, and the startup log makes that impossible to miss.
export class LogMailer implements Mailer {
  readonly description = 'log only (no MAIL_API_KEY set): links are printed, not sent';

  async send(mail: Mail): Promise<boolean> {
    console.log(`[mail:log-only] to=${mail.to} subject=${mail.subject}\n${mail.text}`);
    return true;
  }
}

// Picks from the environment. The key is the switch: with one, mail is
// really sent; without, links are logged and the operator has been told.
export function mailerFromEnv(env: NodeJS.ProcessEnv): Mailer {
  const key = env.MAIL_API_KEY?.trim();
  const from = env.MAIL_FROM?.trim();
  if (!key || !from) return new LogMailer();
  return new ResendMailer(key, from);
}
