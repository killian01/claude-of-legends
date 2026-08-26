// Structural gate: src/sim/ stays host-agnostic and deterministic. Scans every
// sim file for banned dependencies and wall-clock or unseeded randomness.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const simDir = fileURLToPath(new URL('../src/sim', import.meta.url));

function simFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...simFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const FORBIDDEN: { re: RegExp; why: string }[] = [
  { re: /Math\.random/, why: 'sim randomness must go through Rng' },
  { re: /Date\.now/, why: 'sim time is tick-driven, never wall-clock' },
  { re: /performance\.now/, why: 'sim time is tick-driven, never wall-clock' },
  { re: /from\s+'three/, why: 'sim never imports the renderer stack' },
  { re: /from\s+'[^']*\/(render|ui|net)\//, why: 'sim never imports presentation or network code' },
  { re: /\b(document|window|navigator)\s*\./, why: 'sim runs outside the DOM' },
  { re: /\bWebSocket\b/, why: 'sim never touches the network' },
];

describe('sim architecture', () => {
  it('keeps src/sim free of DOM, renderer, network, and wall-clock dependencies', () => {
    const offenders: string[] = [];
    for (const file of simFiles(simDir)) {
      const text = readFileSync(file, 'utf8');
      for (const rule of FORBIDDEN) {
        if (rule.re.test(text)) offenders.push(`${file}: ${rule.re} (${rule.why})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
