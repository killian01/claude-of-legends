// Opening a SQLite store at boot, and waiting out a disk that cannot take
// it yet. A store's file can fail to open with an I/O error for a while
// after a deploy (its shared-memory file cannot be sized while the disk is
// short); a server that throws there is restarted by the host with a
// growing delay, so the game stays down well past the moment the disk is
// back. Waiting in place opens the store within a second of it.

// SQLite's primary result codes this waits on: an I/O error and a full
// disk. Anything else (a corrupt file, a bad schema) is not the disk's
// passing state and throws at once.
const SQLITE_IOERR = 10;
const SQLITE_FULL = 13;

export function isPassingDiskError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { code, errcode } = err as { code?: unknown; errcode?: unknown };
  if (code !== 'ERR_SQLITE_ERROR' || typeof errcode !== 'number') return false;
  // An extended code (4874 is an I/O error on the shared-memory file)
  // carries its primary code in the low byte.
  const primary = errcode & 0xff;
  return primary === SQLITE_IOERR || primary === SQLITE_FULL;
}

export interface OpenRetry {
  // How many tries in all, the first included.
  attempts: number;
  waitMs: number;
  // The pause between tries; a blocking sleep by default, since a store
  // opens in a constructor before the server listens.
  sleep?: (ms: number) => void;
  log?: (line: string) => void;
}

// Boot waits about a minute and a half before it gives up and throws.
export const BOOT_OPEN_RETRY: OpenRetry = { attempts: 90, waitMs: 1000 };

function blockingSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function openWithRetry<T>(what: string, open: () => T, retry: OpenRetry): T {
  const sleep = retry.sleep ?? blockingSleep;
  const log = retry.log ?? ((line: string) => console.warn(line));
  for (let attempt = 1; ; attempt++) {
    try {
      return open();
    } catch (err) {
      if (!isPassingDiskError(err) || attempt >= retry.attempts) throw err;
      if (attempt === 1) {
        log(
          `[store] ${what} did not open (${(err as Error).message}); trying again every ${retry.waitMs} ms`,
        );
      }
      sleep(retry.waitMs);
    }
  }
}
