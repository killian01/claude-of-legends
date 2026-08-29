// The environment as a line stream: newline-delimited JSON on stdin and
// stdout, the transport ADR 0002 phase 2 names. A trainer in any language
// spawns this process, writes one request per line, and reads one response
// per line. stdout carries nothing but protocol; diagnostics go to stderr.
//
// Requests (handled in headless/requests.ts):
//   {"t":"info"}                                  -> {"t":"info", ...}
//   {"t":"reset","seed":1,"seats":[...]}          -> {"t":"obs", ...}
//   {"t":"step","actions":{"0":{"kind":"noop"}}}  -> {"t":"obs", ...}
//   {"t":"close"}                                 -> {"t":"bye"} then exits

import { createInterface } from 'node:readline';
import { Env } from './env';
import { handleRequest } from './requests';

let env = new Env();
const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });

rl.on('line', (line) => {
  const text = line.trim();
  if (text === '') return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    process.stdout.write(`${JSON.stringify({ t: 'error', message: 'malformed json' })}\n`);
    return;
  }
  const result = handleRequest(env, parsed);
  env = result.env;
  process.stdout.write(`${JSON.stringify(result.response)}\n`);
  if (result.close) rl.close();
});

rl.on('close', () => {
  process.exit(0);
});
