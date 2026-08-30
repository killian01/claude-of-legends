// The Discord door on the entry screen (ADR 0009): one button that
// creates an account from a Discord identity, or signs back into the one
// that identity already made. The server decides which; the client only
// ever offers the departure and reports how the round trip went.
//
// The whole flow is a top-level navigation, not a popup: a popup is what
// a phone browser blocks and what an ad blocker eats. So the button
// leaves for Discord, Discord comes back to the server, and the server
// sends the browser home with ?discord=... saying how it went. Nothing
// here holds a token or talks to Discord.

import { el, ensureMenuCss } from './menu';

const CSS = `
.dsc-row { margin: 4px 0 0; }
.dsc-btn {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  background: #4b57c4; border-color: #6b76e0;
}
.dsc-btn:hover:not(:disabled) { background: #5a66d8; border-color: #8b95ff; }
.dsc-said { margin: 8px 0 0; font-size: 11.5px; color: #8fa2bf; line-height: 1.5; }
.dsc-said:empty { display: none; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  ensureMenuCss();
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

// What the round trip came back with, if this page load came from one.
// 'created' and 'signedin' arrive with a session already open, so the
// page that reads them is already past the entry screen.
export type DiscordResult = 'created' | 'signedin' | 'failed' | 'off';

const RESULTS = new Set<string>(['created', 'signedin', 'failed', 'off']);

// Read once and stripped from the address bar, so a reload does not
// repeat the message. Only this one parameter is removed: an invite code
// beside it in the query belongs to somebody else's flow.
export function takeDiscordResult(loc: Location = window.location): DiscordResult | null {
  const params = new URLSearchParams(loc.search);
  const raw = params.get('discord');
  if (raw === null) return null;
  params.delete('discord');
  const rest = params.toString();
  window.history.replaceState(null, '', rest ? `${loc.pathname}?${rest}` : loc.pathname);
  return RESULTS.has(raw) ? (raw as DiscordResult) : 'failed';
}

// Whether this server has a Discord application at all. False means the
// button is never shown, rather than shown and broken.
export async function fetchDiscordConfigured(): Promise<boolean> {
  try {
    const res = await fetch('/api/discord/status', { credentials: 'same-origin' });
    if (!res.ok) return false;
    const body = (await res.json()) as { configured?: unknown };
    return body.configured === true;
  } catch {
    // Offline, or the server is down: the form says so when it is used.
    return false;
  }
}

const OFFER =
  'No name or password to pick: your account is made from your Discord name, and Discord is ' +
  'how you get back into it. We only ever read your name, never your messages.';

// The door itself. Built hidden and shown only once the server has said
// it can do this at all, so a deployment without a Discord application
// never advertises a button that cannot work.
export function buildDiscordEntry(result: DiscordResult | null): HTMLElement {
  ensureCss();
  const row = el('div', 'dsc-row');
  row.hidden = true;
  const go = el('button', 'menu-btn dsc-btn', 'Continue with Discord');
  const said = el('p', 'dsc-said');
  said.textContent =
    result === 'failed'
      ? 'That did not go through. Nothing was created or changed; you can try again.'
      : OFFER;
  row.append(go, said);
  go.addEventListener('click', () => {
    go.disabled = true;
    go.textContent = 'Off to Discord...';
    window.location.assign('/api/discord/start');
  });
  void fetchDiscordConfigured().then((configured) => {
    row.hidden = !configured;
  });
  return row;
}
