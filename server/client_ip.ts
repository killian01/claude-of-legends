// The address the per-connection abuse caps are keyed on.
//
// Behind a reverse proxy every socket carries the proxy's own address, so
// keying the caps on the raw socket collapses them onto the whole player
// base at once: the ninth player anywhere in the world would be refused.
// The proxy is then the only source that still knows who the client is.
//
// Trust is opt-in (TRUST_PROXY) because these headers are attacker-supplied
// on a direct connection. The front proxy MUST overwrite both headers rather
// than append to what the client sent, or the caps become trivially
// spoofable by anyone sending their own X-Forwarded-For.

// Structurally what node's IncomingHttpHeaders is, without dragging a node
// http import into a module that is otherwise pure and trivially testable.
export type ForwardHeaders = Readonly<Record<string, string | string[] | undefined>>;

export function resolveClientIp(
  headers: ForwardHeaders,
  socketAddress: string | undefined,
  trustProxy: boolean,
): string {
  if (trustProxy) {
    // A chain reads "client, proxy1, proxy2": the client is leftmost.
    const client = firstHeader(headers['x-forwarded-for'])?.split(',')[0]?.trim();
    if (client) return client;
    // No chain: a proxy that sets only the peer address (no CDN in front).
    const real = firstHeader(headers['x-real-ip'])?.trim();
    if (real) return real;
  }
  return socketAddress ?? 'unknown';
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
