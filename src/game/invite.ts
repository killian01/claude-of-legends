// Invite links for private lobbies: /?join=CODE deep-links a friend
// straight into the lobby. Pure string work, testable without a DOM;
// src/main.ts consumes the code at boot and src/ui/menu.ts renders the
// link in the lobby screen.

// Codes are 6 letters (matchmaker CODE_LETTERS excludes ambiguous ones,
// but the server is the validator; the client only shape-checks). Five
// are still read: a lobby lives in the server's memory, so no five-letter
// code outlives a deploy, but a link may be opened from an older page.
const CODE_SHAPE = /^[A-Za-z]{5,6}$/;
// The longest code a field takes: every field a code is typed in uses it,
// so none cuts a pasted code short.
export const CODE_MAX = 6;

export function parseJoinCode(search: string): string | null {
  const raw = new URLSearchParams(search).get('join');
  if (!raw || !CODE_SHAPE.test(raw)) return null;
  return raw.toUpperCase();
}

export function inviteUrl(origin: string, code: string): string {
  return `${origin}/?join=${code}`;
}

// The code as typed on the home's join line: trimmed and uppercased, or
// null when it is not the shape of a code at all.
export function normalizeJoinCode(raw: string): string | null {
  const typed = raw.trim();
  if (!CODE_SHAPE.test(typed)) return null;
  return typed.toUpperCase();
}
