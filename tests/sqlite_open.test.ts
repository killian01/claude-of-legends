// A store that cannot open at boot because the disk is short waits in
// place and opens once the disk is back, instead of crashing the server
// into a restart loop. Any other failure still throws at once.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ForgeStore } from '../server/forge_store';
import { isPassingDiskError, openWithRetry } from '../server/sqlite_open';

// The error node:sqlite throws when the shared-memory file of a WAL
// database cannot be sized (SQLITE_IOERR_SHMSIZE).
function shmSizeError(): Error {
  return Object.assign(new Error('disk I/O error'), {
    code: 'ERR_SQLITE_ERROR',
    errcode: 4874,
    errstr: 'disk I/O error',
  });
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('isPassingDiskError', () => {
  it('waits on an I/O error, extended or not, and on a full disk', () => {
    expect(isPassingDiskError(shmSizeError())).toBe(true);
    expect(isPassingDiskError({ code: 'ERR_SQLITE_ERROR', errcode: 10 })).toBe(true);
    expect(isPassingDiskError({ code: 'ERR_SQLITE_ERROR', errcode: 13 })).toBe(true);
  });

  it('does not wait on a corrupt file, a schema error, or anything not SQLite', () => {
    expect(isPassingDiskError({ code: 'ERR_SQLITE_ERROR', errcode: 11 })).toBe(false);
    expect(isPassingDiskError({ code: 'ERR_SQLITE_ERROR', errcode: 1 })).toBe(false);
    expect(isPassingDiskError(new Error('disk I/O error'))).toBe(false);
    expect(isPassingDiskError(null)).toBe(false);
  });
});

describe('openWithRetry', () => {
  it('opens the store once the disk is back, logging one line', () => {
    let tries = 0;
    const waits: number[] = [];
    const lines: string[] = [];
    const store = openWithRetry(
      'forge.sqlite3',
      () => {
        tries++;
        if (tries < 4) throw shmSizeError();
        return 'open';
      },
      { attempts: 10, waitMs: 1000, sleep: (ms) => waits.push(ms), log: (l) => lines.push(l) },
    );
    expect(store).toBe('open');
    expect(tries).toBe(4);
    expect(waits).toEqual([1000, 1000, 1000]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('forge.sqlite3');
  });

  it('throws the last error when the disk never comes back', () => {
    let tries = 0;
    expect(() =>
      openWithRetry(
        'forge.sqlite3',
        () => {
          tries++;
          throw shmSizeError();
        },
        { attempts: 3, waitMs: 1, sleep: () => {}, log: () => {} },
      ),
    ).toThrow('disk I/O error');
    expect(tries).toBe(3);
  });

  it('throws any other failure on the first try', () => {
    let tries = 0;
    const corrupt = Object.assign(new Error('database disk image is malformed'), {
      code: 'ERR_SQLITE_ERROR',
      errcode: 11,
    });
    expect(() =>
      openWithRetry(
        'forge.sqlite3',
        () => {
          tries++;
          throw corrupt;
        },
        { attempts: 5, waitMs: 1, sleep: () => {}, log: () => {} },
      ),
    ).toThrow(corrupt);
    expect(tries).toBe(1);
  });

  it('throws a real store that cannot open for a reason that will not pass at once', () => {
    // A directory where the file should be: SQLite refuses it, and no
    // amount of waiting would change that.
    const dir = mkdtempSync(path.join(tmpdir(), 'loc-open-'));
    dirs.push(dir);
    let tries = 0;
    expect(() =>
      openWithRetry(
        'forge.sqlite3',
        () => {
          tries++;
          return new ForgeStore(dir);
        },
        { attempts: 5, waitMs: 1, sleep: () => {}, log: () => {} },
      ),
    ).toThrow();
    expect(tries).toBe(1);
  });

  it('opens a real store on the first try when the disk is fine', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'loc-open-'));
    dirs.push(dir);
    const store = openWithRetry(
      'forge.sqlite3',
      () => new ForgeStore(path.join(dir, 'forge.sqlite3')),
      { attempts: 5, waitMs: 1, sleep: () => {}, log: () => {} },
    );
    expect(store).toBeInstanceOf(ForgeStore);
    store.close();
  });
});
