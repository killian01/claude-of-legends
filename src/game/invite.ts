// Invite links for private lobbies: /?join=CODE deep-links a friend
// straight into the lobby. Pure string work, testable without a DOM;
// src/main.ts consumes the code at boot and src/ui/menu.ts renders the
// link in the lobby screen.

// Codes are 5 letters (matchmaker CODE_LETTERS excludes ambiguous ones,
// but the server is the validator; the client only shape-checks).
const CODE_SHAPE = /^[A-Za-z]{5}$/;

export function parseJoinCode(search: string): string | null {
  const raw = new URLSearchParams(search).get('join');
  if (!raw || !CODE_SHAPE.test(raw)) return null;
  return raw.toUpperCase();
}

export function inviteUrl(origin: string, code: string): string {
  return `${origin}/?join=${code}`;
}
