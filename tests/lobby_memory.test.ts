// What a tab keeps of a private lobby (ADR 0036): the lobby it is in, for a
// reload, and an invitation waiting on a Discord sign-in, used once.

import { describe, expect, it } from 'vitest';
import {
  type CodeStore,
  forgetLobby,
  LOBBY_KEY,
  PENDING_JOIN_KEY,
  PENDING_JOIN_MS,
  readLobby,
  rememberLobby,
  rememberPendingJoin,
  takePendingJoin,
} from '../src/game/lobby_memory';

function memory(): CodeStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
}

function broken(): CodeStore {
  return {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
    removeItem: () => {
      throw new Error('denied');
    },
  };
}

describe('the lobby a tab is in', () => {
  it('is kept shaped, read back, and forgotten', () => {
    const s = memory();
    rememberLobby(s, ' kmnpqr ');
    expect(s.data.get(LOBBY_KEY)).toBe('KMNPQR');
    expect(readLobby(s)).toBe('KMNPQR');
    expect(readLobby(s)).toBe('KMNPQR');
    forgetLobby(s);
    expect(readLobby(s)).toBeNull();
  });

  it('keeps nothing that is not a code, and reads nothing that is not one', () => {
    const s = memory();
    rememberLobby(s, 'not a code');
    expect(s.data.size).toBe(0);
    s.data.set(LOBBY_KEY, '<script>');
    expect(readLobby(s)).toBeNull();
  });

  it('fails quietly without storage', () => {
    expect(() => rememberLobby(broken(), 'KMNPQR')).not.toThrow();
    expect(readLobby(broken())).toBeNull();
    expect(() => forgetLobby(broken())).not.toThrow();
    expect(readLobby(null)).toBeNull();
  });
});

describe('an invitation waiting on a Discord sign-in', () => {
  it('is taken once, fresh', () => {
    const s = memory();
    rememberPendingJoin(s, 'kmnpqr', 1000);
    expect(takePendingJoin(s, 2000)).toBe('KMNPQR');
    expect(takePendingJoin(s, 3000)).toBeNull();
  });

  it('is dropped when stale, or dated in the future', () => {
    const s = memory();
    rememberPendingJoin(s, 'KMNPQR', 0);
    expect(takePendingJoin(s, PENDING_JOIN_MS + 1)).toBeNull();
    expect(s.data.has(PENDING_JOIN_KEY)).toBe(false);
    rememberPendingJoin(s, 'KMNPQR', 5000);
    expect(takePendingJoin(s, 1000)).toBeNull();
  });

  it('is removed and ignored when it is not a code', () => {
    const s = memory();
    for (const junk of ['{', '42', 'null', '{"code":42,"at":1}', '{"code":"ABC","at":1}']) {
      s.data.set(PENDING_JOIN_KEY, junk);
      expect(takePendingJoin(s, 2)).toBeNull();
      expect(s.data.has(PENDING_JOIN_KEY)).toBe(false);
    }
  });

  it('fails quietly without storage', () => {
    expect(() => rememberPendingJoin(broken(), 'KMNPQR', 1)).not.toThrow();
    expect(takePendingJoin(broken(), 1)).toBeNull();
    expect(takePendingJoin(null, 1)).toBeNull();
  });
});
