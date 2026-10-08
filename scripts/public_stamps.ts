// The content stamps of the files under public/: every file the game
// loads by a fixed name (the map export, the models, the portraits, the
// icons, the sounds) goes out with a hash of its own bytes as its ?v=
// stamp (src/game/asset_version.ts), so an address can only ever mean one
// content. The stamp used to be the deployment's, which moved with every
// deploy and every restart, several a day, and made every browser
// download the map and the models again each time; now a deployment that
// leaves a file alone leaves its address alone, and one that changes it
// gives it an address no cache has seen.
//
// The build hashes public/ once (vite.config.ts): the bundle carries the
// table, and a copy lands beside the built client for the server, which
// promises a stamped address never changes only when the stamp is the one
// the table gives that file (server/static_files.ts). Node built-ins only:
// the Vite config loads this file.

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// The copy beside the built client, under the name the server reads it by
// (server/static_files.ts; tests/public_stamps.test.ts holds the two to one
// name).
export const STAMPS_FILE = 'stamps.json';

// Hex digits kept of the file's SHA-256: 40 bits, so two versions of one
// file drawing the same stamp is a one in a trillion event.
export const STAMP_LENGTH = 10;

export function contentStamp(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, STAMP_LENGTH);
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

// Every file under dir by the address it is served at ('/models/a.glb'),
// in address order, so the same files always make the same table (and the
// same bundle): the client's StampTable (src/game/asset_version.ts). One
// file at a time: the full map alone is 43 MB.
export async function stampTable(dir: string): Promise<Record<string, string>> {
  const files: string[] = [];
  for await (const file of walk(dir)) files.push(file);
  const addresses = files
    .map((file) => ({ file, address: `/${path.relative(dir, file).split(path.sep).join('/')}` }))
    .sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
  const table: Record<string, string> = {};
  for (const { file, address } of addresses) table[address] = contentStamp(await readFile(file));
  return table;
}
