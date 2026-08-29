// The Cookie and Set-Cookie headers, by hand. Pure string work, no
// dependency: the session cookie is the only one this server sets
// (ADR 0006), so a full cookie library would be a package to audit for
// two functions.
//
// The parser is deliberately forgiving in one direction only. It reads
// whatever a browser or a proxy sends without throwing, and returns
// nothing for anything it does not understand: an unreadable Cookie
// header means "not logged in", never a crash and never a guess.

export interface CookieOptions {
  maxAgeS: number;
  // Off only for a plain-http origin that is not localhost, which
  // production never is: Caddy terminates TLS in front of this process.
  secure: boolean;
}

// name -> value. A repeated name keeps the first, which is what browsers
// send first for the most specific path; later duplicates are the ones a
// stale wider-scoped cookie would contribute.
export function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (name.length === 0 || out.has(name)) continue;
    let value = part.slice(eq + 1).trim();
    // Values with separators in them arrive quoted (RFC 6265).
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    out.set(name, decodeCookieValue(value));
  }
  return out;
}

// A malformed percent escape is a client's problem, not ours: keep the
// raw text rather than throwing, and let the session lookup miss.
function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// SameSite=Lax rather than Strict: the invite link (?join=CODE) is a
// top-level navigation from someone else's chat window, and Strict would
// drop the session exactly there. Lax still refuses the cross-site POST
// that CSRF needs.
export function serializeCookie(name: string, value: string, opts: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(opts.maxAgeS))}`,
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

// Clearing is setting the same cookie empty and already expired; the
// attributes have to match or the browser keeps the old one alongside.
export function clearCookie(name: string, opts: Pick<CookieOptions, 'secure'>): string {
  return serializeCookie(name, '', { maxAgeS: 0, secure: opts.secure });
}
