// What the dev proxy answers when the game server is not running.
//
// `pnpm dev` alone is enough to play the practice match, which is what the
// README promises and what a stranger tries first. But the client asks the
// server four things on the way in (the session, the public counts, whether
// Discord is configured, and the once-a-day hello to the counter), and
// without a server every one of them came back 502. Four red lines in the
// console of a project someone is meeting for the first time read as
// broken, not as "an optional server is not running".
//
// So the proxy answers those requests the way a server with nothing to say
// would: no session, no stats, no Discord. That is not a fiction. Every one
// of those calls is on a path you can only reach without a server anyway,
// since signing in is exactly what needs one. The truth about the missing
// server belongs in the terminal, where the developer is, and it is printed
// there instead.

export interface OfflineReply {
  status: number;
  type?: string;
  body: string;
}

// null rather than {}: every caller in src/ui already has the null branch
// written and tested, because a server that is up can legitimately answer
// "no session" and "no stats yet".
export function offlineApiReply(method: string | undefined): OfflineReply {
  if ((method ?? 'GET').toUpperCase() === 'GET') {
    return { status: 200, type: 'application/json', body: 'null' };
  }
  // A POST here is the visit ping and nothing else today. It is fire and
  // forget by construction, so the honest answer is an empty success.
  return { status: 204, body: '' };
}

export function offlineApiNotice(port: number): string {
  return `  /api is unanswered: no game server on :${port}. Offline play does not need one; run "pnpm server" for the rest.`;
}
