// A structural gate for the deployment seam. Three files have to agree on
// one set of names: the server reads them, docker-compose.yml passes them
// into the container, and .env.example tells a self-hoster they exist. A
// rename that touches only one of the three is silent everywhere: the
// container keeps forwarding a dead name and the knob simply stops
// working, which is how CREATIONS_PER_WEEK and GENERATIONS_PER_DAY
// outlived the rename to the ember ledger (ADR 0017).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

// Names the deployment sets rather than the operator: compose writes them
// as literals, or they only exist for a developer's own machine. They are
// documented in docs/deploy.md and in .env.example's prose, not as a line
// a self-hoster fills in.
const DEPLOYMENT_SET = new Set([
  'DATA_DIR',
  'TRUST_PROXY',
  'ALLOWED_ORIGINS',
  'PUBLIC_URL',
  'DISCORD_REDIRECT_URI',
  // Never set in production: it swaps the Forge's provider for a keyless
  // pipeline with placeholder assets.
  'GENERATION_PROVIDER',
]);

function serverFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...serverFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

// Comment lines are dropped first: this repo names its variables in prose
// right above the code that reads them, and a mention is not a read.
function code(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

// The three shapes a name is read in: process.env.NAME, process.env['NAME'],
// envNumber('NAME', ...), and env.NAME on the injected environment record
// that edge.ts, mailer.ts and discord_oauth.ts take.
const READ =
  /(?:\benv\.([A-Z][A-Z0-9_]{2,})\b)|(?:\benv\[['"]([A-Z][A-Z0-9_]{2,})['"]\])|(?:\benvNumber\(['"]([A-Z][A-Z0-9_]{2,})['"])/g;

function namesRead(): Set<string> {
  const found = new Set<string>();
  for (const file of serverFiles(join(root, 'server'))) {
    const text = code(readFileSync(file, 'utf8'));
    for (const m of text.matchAll(READ)) {
      const name = m[1] ?? m[2] ?? m[3];
      if (name) found.add(name);
    }
  }
  return found;
}

// The keys under the game service's `environment:` block, in file order.
function composeKeys(): string[] {
  const lines = readFileSync(join(root, 'docker-compose.yml'), 'utf8').split('\n');
  const start = lines.findIndex((l) => l.trim() === 'environment:');
  expect(start).toBeGreaterThan(-1);
  const indent = (lines[start] ?? '').search(/\S/) + 2;
  const keys: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') continue;
    if (line.search(/\S/) < indent) break;
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*:/.exec(line);
    if (m?.[1]) keys.push(m[1]);
  }
  return keys;
}

function exampleKeys(): string[] {
  return readFileSync(join(root, '.env.example'), 'utf8')
    .split('\n')
    .map((l) => /^([A-Z][A-Z0-9_]*)=/.exec(l)?.[1])
    .filter((k): k is string => Boolean(k));
}

describe('deployment env wiring', () => {
  it('passes nothing into the container that the server stopped reading', () => {
    const read = namesRead();
    const dead = composeKeys().filter((k) => !read.has(k));
    expect(dead).toEqual([]);
  });

  it('documents every knob the server reads', () => {
    const documented = new Set([...exampleKeys(), ...DEPLOYMENT_SET]);
    const undocumented = [...namesRead()].filter((n) => !documented.has(n)).sort();
    expect(undocumented).toEqual([]);
  });

  it('lets every documented knob reach the container', () => {
    const passed = new Set(composeKeys());
    const stranded = exampleKeys().filter((k) => !passed.has(k));
    expect(stranded).toEqual([]);
  });
});
