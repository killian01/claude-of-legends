// Linking a Discord account, from both sides of the sign-in screen: the
// offer on the signup form, and the row on the home screen that says what
// the account is linked to and undoes it.
//
// The whole flow is a top-level navigation, not a popup: a popup is what
// a phone browser blocks and what an ad blocker eats, and this has to
// work on the same page a player just typed their name into. So the
// button leaves for Discord, Discord comes back to the server, and the
// server sends the browser home with ?discord=... saying how it went.
//
// Nothing here holds a token or talks to Discord. The client only ever
// sees a name to show and an outcome to report (ADR 0008).

import { el, ensureMenuCss } from './menu';

const CSS = `
.dsc-row { margin: 4px 0 0; }
.dsc-btn {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  background: #4b57c4; border-color: #6b76e0;
}
.dsc-btn:hover:not(:disabled) { background: #5a66d8; border-color: #8b95ff; }
.dsc-said { margin: 8px 0 0; font-size: 11.5px; color: #8fa2bf; line-height: 1.5; }
.dsc-said b { color: #dceaff; }
.dsc-said:empty { display: none; }
.dsc-note {
  border: 1px solid #3b4278; border-radius: 12px; padding: 12px 16px;
  background: rgba(18, 20, 44, 0.62); backdrop-filter: blur(7px);
  margin: 12px 0 0; max-width: 900px; font-size: 12.5px; line-height: 1.55; color: #c3c9ee;
}
.dsc-note b { color: #e2e6ff; }
.dsc-note.good { border-color: #35603c; background: rgba(12, 30, 16, 0.62); color: #b6d9bd; }
.dsc-note .dsc-line { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.dsc-note .menu-btn { width: auto; margin: 0; padding: 6px 14px; font-size: 12px; }
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
// 'ready' is a link waiting for a signup to finish; the rest are final.
export type DiscordResult = 'ready' | 'linked' | 'taken' | 'failed' | 'off';

const RESULTS = new Set<string>(['ready', 'linked', 'taken', 'failed', 'off']);

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

export interface DiscordPending {
  // Whether this server has a Discord application configured at all.
  // False means the offer is never shown, rather than shown and broken.
  configured: boolean;
  // The Discord name waiting to be attached to the next account created
  // in this browser, or null.
  discord: string | null;
}

export async function fetchPendingDiscord(): Promise<DiscordPending> {
  try {
    const res = await fetch('/api/discord/pending', { credentials: 'same-origin' });
    if (!res.ok) return { configured: false, discord: null };
    const body = (await res.json()) as Partial<DiscordPending>;
    return {
      configured: body.configured === true,
      discord: typeof body.discord === 'string' ? body.discord : null,
    };
  } catch {
    // Offline, or the server is down: the form says so when it is used.
    return { configured: false, discord: null };
  }
}

// Leaves for Discord. The server owns the state and the redirect, so
// there is nothing to build here but the departure.
export function startDiscordLink(): void {
  window.location.assign('/api/discord/start');
}

export async function unlinkDiscord(): Promise<string | null> {
  try {
    const res = await fetch('/api/discord/unlink', {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (res.ok) return null;
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return body?.error ?? 'That did not work.';
  } catch {
    return 'Cannot reach the server. Check your connection.';
  }
}

const SIGNUP_OFFER =
  'Optional. It proves the account is yours on our Discord, and nothing else: we only ever ' +
  'read your name, never your messages, and you can undo it at any time.';

// The offer on the signup form. Built hidden and shown only once the
// server has said it can do this at all, so a deployment without a
// Discord application never advertises a button that cannot work.
//
// `onPending` fires when a link is already waiting for this browser, so
// the form can open the tab that will spend it: somebody coming back from
// Discord was creating an account, and landing on the sign-in tab would
// bury the thing they just did.
export function buildDiscordSignupRow(
  result: DiscordResult | null,
  onPending?: (username: string) => void,
): HTMLElement {
  ensureCss();
  const row = el('div', 'dsc-row');
  row.hidden = true;
  const go = el('button', 'menu-btn dsc-btn', 'Link a Discord account');
  const said = el('p', 'dsc-said');
  row.append(go, said);
  go.addEventListener('click', () => {
    go.disabled = true;
    go.textContent = 'Off to Discord...';
    startDiscordLink();
  });

  const explain = (pending: DiscordPending): void => {
    if (pending.discord !== null) {
      said.textContent = '';
      said.append(
        document.createTextNode('Linking '),
        el('b', '', pending.discord),
        document.createTextNode(' to the account you create below. Not linked to anything yet.'),
      );
      go.textContent = 'Link a different one';
      return;
    }
    said.textContent =
      result === 'taken'
        ? 'That Discord account is already linked to an account here. Sign in with that ' +
          'account instead, or link a different Discord.'
        : result === 'failed'
          ? 'That did not go through. Nothing was linked; you can try again.'
          : SIGNUP_OFFER;
  };

  void fetchPendingDiscord().then((pending) => {
    // 'off' is the server saying it has no Discord application: there is
    // nothing to offer, so nothing appears.
    if (!pending.configured) return;
    row.hidden = false;
    explain(pending);
    if (pending.discord !== null) onPending?.(pending.discord);
  });
  return row;
}

// The row on the home screen: what this account is linked to, and the one
// button that changes it. One line and a button rather than a strip of
// prose, because unlike the email notice (ui/email_status.ts) it is not
// asking for anything: it is the only place a link can be made or undone
// after signup, so it has to be findable rather than loud.
//
// It says nothing at all on a server with no Discord application, and
// that is decided by the server rather than guessed at here.
export function buildDiscordNotice(
  linked: string | null,
  result: DiscordResult | null,
): HTMLElement {
  ensureCss();
  const note = el('div', `dsc-note${result === 'linked' ? ' good' : ''}`);
  const line = el('div', 'dsc-line');
  const said = el('p', 'dsc-said');
  // Something happened, or something is linked: either way there is
  // something to say without asking anybody. Otherwise this is only an
  // offer, and an offer waits until the server says it can be taken up.
  note.hidden = linked === null && result === null;
  if (note.hidden) {
    void fetchPendingDiscord().then((pending) => {
      if (pending.configured) note.hidden = false;
    });
  }

  const head = el('span', '');
  if (linked !== null) {
    head.append(
      document.createTextNode(result === 'linked' ? 'Discord linked: ' : 'Linked to Discord as '),
      el('b', '', linked),
      document.createTextNode('. Only you can see this.'),
    );
  } else if (result === 'taken') {
    head.textContent = 'That Discord account is already linked to another account here.';
  } else if (result === 'off') {
    head.textContent = 'Discord linking is not set up on this server.';
  } else if (result === 'failed') {
    head.textContent = 'That Discord link did not go through. Nothing changed.';
  } else {
    head.textContent = 'No Discord account is linked to this one.';
  }
  line.appendChild(head);

  if (linked !== null) {
    const drop = el('button', 'menu-btn', 'Unlink');
    drop.addEventListener('click', () => {
      drop.disabled = true;
      drop.textContent = 'Unlinking...';
      void unlinkDiscord().then((failure) => {
        drop.disabled = false;
        drop.textContent = 'Unlink';
        said.textContent = failure ?? 'Unlinked. That Discord account is free to link elsewhere.';
        if (!failure) drop.hidden = true;
      });
    });
    line.appendChild(drop);
  } else if (result !== 'off') {
    const go = el('button', 'menu-btn dsc-btn', 'Link Discord');
    go.addEventListener('click', () => {
      go.disabled = true;
      go.textContent = 'Off to Discord...';
      startDiscordLink();
    });
    line.appendChild(go);
  }

  note.append(line, said);
  return note;
}
