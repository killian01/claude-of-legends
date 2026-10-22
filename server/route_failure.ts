// What a request that threw is answered with. A route that throws past its
// own checks lands in the server's last catch; a file that cannot be
// served is a plain 404 there, but an API route is a fault: it is logged,
// and the client gets JSON it can read. A store write that cannot reach
// the disk (an I/O error, a full disk) is the disk's passing state, so it
// is a 503 with a retry, not a missing route.

import { isPassingDiskError } from './sqlite_open';

export interface FailureReply {
  status: number;
  headers: Record<string, string>;
  body: string;
  // Whether the error is worth a line in the server's log.
  log: boolean;
}

// The pause a 503 asks the client to wait before it tries again.
const RETRY_AFTER_S = 5;

function jsonReply(status: number, error: string, extra: Record<string, string> = {}) {
  return {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
    body: JSON.stringify({ error }),
    log: true,
  };
}

export function failureReply(url: string, err: unknown): FailureReply {
  if (!url.startsWith('/api/')) {
    return {
      status: 404,
      headers: { 'content-type': 'text/plain' },
      body: 'not found',
      log: false,
    };
  }
  if (isPassingDiskError(err)) {
    return jsonReply(503, 'The server cannot save right now; try again in a moment.', {
      'retry-after': String(RETRY_AFTER_S),
    });
  }
  return jsonReply(500, 'Something went wrong on the server; try again.');
}
