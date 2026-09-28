// A Guest for the public queue (ADR 0024): asks the server for one and
// answers with the name it handed out, or null when there is no server to
// ask. The cookie that makes the Guest rides the answer, httpOnly, so this
// module never sees it.

export const GUEST_ROUTE = '/api/guest';

export async function openGuest(
  post: typeof fetch = (input, init) => fetch(input, init),
): Promise<string | null> {
  try {
    const res = await post(GUEST_ROUTE, { method: 'POST', credentials: 'same-origin' });
    if (!res.ok) return null;
    const body = (await res.json()) as { name?: unknown };
    return typeof body.name === 'string' && body.name.length > 0 ? body.name : null;
  } catch {
    return null;
  }
}
