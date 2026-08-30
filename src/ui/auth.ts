// Proving who someone is: the session already open from a previous visit,
// the credential panel, and signing out. Every connection to the server
// belongs to an account (ADR 0006), so one of these has to succeed before
// anything else in the client can talk to it.
//
// The panel only; the page it sits on is ui/landing.ts. Nothing here
// decides layout, so the same form could sit anywhere.

import { buildDiscordSignupRow, type DiscordResult } from './discord_link';
import { el, ensureMenuCss } from './menu';

const CSS = `
.auth-form { display: flex; flex-direction: column; }
.auth-tabs { display: flex; gap: 8px; margin: 0 0 14px; }
.auth-tab {
  flex: 1; padding: 8px 0; border-radius: 8px; cursor: pointer;
  background: rgba(20, 30, 50, 0.8); border: 1px solid #2e4468; color: #7e93b2;
  font: inherit; font-size: 13px; font-weight: 600;
}
.auth-tab.on { background: #24406e; border-color: #3e6ba8; color: #dceaff; }
.auth-error {
  min-height: 16px; margin: 10px 0 0; font-size: 12px; color: #f5a3a3;
}
.auth-note { margin: 12px 0 0; font-size: 11px; color: #6d809c; line-height: 1.5; }
/* Only the register tab has a note; an empty one would hold open a gap
   the sign-in tab has no use for. The error slot above keeps its height
   on purpose, so a failed attempt does not shift the button under the
   cursor. */
.auth-note:empty { display: none; }
.auth-form .menu-input { margin: 0 0 8px; }
.auth-form .menu-btn { margin: 4px 0 0; }
/* A quiet way out of the sign-in tab. It is not a menu-btn: offering the
   reset the same weight as signing in would suggest it is the usual way
   through, and it is not. */
.auth-alt {
  background: none; border: 0; padding: 6px 0 0; margin: 0; font: inherit; font-size: 11.5px;
  color: #6d829f; cursor: pointer; text-align: left; text-decoration: underline;
}
.auth-alt:hover { color: #dceaff; }
/* Below the note, and only on the register tab: an optional step reads as
   optional when it sits after everything the form actually requires. */
.auth-discord { margin: 12px 0 0; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  // These screens use .menu-btn and .menu-input without opening a card.
  ensureMenuCss();
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

export interface AuthedAccount {
  id: number;
  name: string;
  rating: number;
  ratedGames: number;
  // Your own address, and whether the link sent to it has been followed
  // (ADR 0007). Null on an account old enough to predate addresses, and
  // on one whose unconfirmed claim lapsed. Never present for any account
  // but your own: the server has two shapes for exactly that reason.
  email: string | null;
  emailConfirmed: boolean;
  // The Discord name this account is linked to, or null (ADR 0008). Like
  // the address, it is only ever sent to the owner of the account.
  discord: string | null;
}

// 'forgot' is not a way in, it is a way to be sent one.
type Mode = 'login' | 'register' | 'forgot';

// A session cookie from a previous visit, if it is still alive. Called
// once at startup so a returning player never sees this screen.
export async function currentAccount(): Promise<AuthedAccount | null> {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const body = (await res.json()) as AuthedAccount;
    return typeof body?.name === 'string' ? body : null;
  } catch {
    // Offline or the server is down: the sign-in screen will say so when
    // the visitor tries.
    return null;
  }
}

async function submit(
  mode: 'login' | 'register',
  name: string,
  password: string,
  email: string,
): Promise<{ ok: true; account: AuthedAccount } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(mode === 'login' ? '/api/login' : '/api/register', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(mode === 'login' ? { name, password } : { name, password, email }),
    });
  } catch {
    return { ok: false, error: 'Cannot reach the server. Check your connection.' };
  }
  let body: { error?: string } & Partial<AuthedAccount>;
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return { ok: false, error: 'The server answered with something unreadable.' };
  }
  if (!res.ok || typeof body.name !== 'string') {
    return { ok: false, error: body.error ?? 'That did not work.' };
  }
  return { ok: true, account: body as AuthedAccount };
}

// Asks for a reset link. The server answers the same way whether or not
// it found anything, so there is nothing here to report but "we tried":
// saying more would turn this form into a way to test whether an address
// has an account on it.
export async function requestReset(email: string): Promise<string | null> {
  try {
    const res = await fetch('/api/password/forgot', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (res.status === 429) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return body?.error ?? 'Too many requests. Try again shortly.';
    }
    return null;
  } catch {
    return 'Cannot reach the server. Check your connection.';
  }
}

// Just the credential panel: the tabs, the fields, the error line and the
// button. The page around it (ui/landing.ts) owns the layout, so this
// module stays about proving who someone is and nothing else.
//
// Three modes share one form because they share most of it. 'forgot' is
// not a way in, it is a way to be sent one, which is why it has no tab of
// its own and leaves by the same link that reached it.
//
// `discordResult` is what a round trip through Discord came back with, if
// this page load came from one (ADR 0008). The form only ever shows it;
// what was linked, if anything, is the server's business.
export function buildAuthForm(
  onSignedIn: (account: AuthedAccount) => void,
  discordResult: DiscordResult | null = null,
): HTMLElement {
  ensureCss();
  const root = el('div', 'auth-form');
  let mode: Mode = 'login';
  let busy = false;

  const tabs = el('div', 'auth-tabs');
  const loginTab = el('button', 'auth-tab on', 'Sign in');
  const registerTab = el('button', 'auth-tab', 'Create account');
  tabs.append(loginTab, registerTab);

  const name = el('input', 'menu-input');
  name.maxLength = 16;
  name.autocomplete = 'username';
  name.placeholder = 'Your name';

  const email = el('input', 'menu-input');
  email.type = 'email';
  email.maxLength = 254;
  email.autocomplete = 'email';
  email.placeholder = 'Email address';

  const password = el('input', 'menu-input');
  password.type = 'password';
  password.maxLength = 200;
  password.autocomplete = 'current-password';
  password.placeholder = 'Password';

  const error = el('p', 'auth-error');
  const go = el('button', 'menu-btn primary', 'Sign in');
  const note = el('p', 'auth-note');
  const alt = el('button', 'auth-alt', 'Forgot your password?');

  // The Discord offer belongs to the register tab, so it lives in a box
  // the mode hides. The row inside it hides itself as well, on a server
  // with no Discord application: two switches, because they answer two
  // different questions, and either one closes.
  const discordBox = el('div', 'auth-discord');
  const discordRow = buildDiscordSignupRow(discordResult, () => {
    // Coming back from Discord means creating an account, whatever tab
    // the page would otherwise have opened on.
    if (mode === 'login') setMode('register');
  });
  discordBox.appendChild(discordRow);

  root.append(tabs, name, email, password, error, go, alt, note, discordBox);

  const LABELS: Record<Mode, { go: string; busy: string }> = {
    login: { go: 'Sign in', busy: 'Signing in...' },
    register: { go: 'Create account', busy: 'Creating...' },
    forgot: { go: 'Send a reset link', busy: 'Sending...' },
  };

  const setMode = (next: Mode): void => {
    mode = next;
    loginTab.classList.toggle('on', next === 'login');
    registerTab.classList.toggle('on', next === 'register');
    // Each mode asks for exactly what it needs and hides the rest, rather
    // than showing a field the request will not carry.
    name.hidden = next === 'forgot';
    email.hidden = next === 'login';
    password.hidden = next === 'forgot';
    discordBox.hidden = next !== 'register';
    go.textContent = LABELS[next].go;
    password.autocomplete = next === 'login' ? 'current-password' : 'new-password';
    alt.hidden = next === 'register';
    alt.textContent = next === 'forgot' ? 'Back to signing in' : 'Forgot your password?';
    note.textContent =
      next === 'register'
        ? 'Letters, digits, _ and - , 3 to 16 characters. Your address is only ever used to ' +
          'confirm the account and to reset a forgotten password; nobody else can see it.'
        : next === 'forgot'
          ? 'A link goes to the address on the account, if there is one and it has been ' +
            'confirmed. An unconfirmed address cannot receive one, because it might not be yours.'
          : '';
    error.textContent = '';
    (next === 'forgot' ? email : name).focus();
  };

  const attempt = (): void => {
    if (busy) return;
    const typedName = name.value.trim();
    const typedEmail = email.value.trim();
    const typedPassword = password.value;

    if (mode === 'forgot') {
      if (typedEmail.length === 0) {
        error.textContent = 'Your email address, please.';
        return;
      }
      busy = true;
      go.textContent = LABELS.forgot.busy;
      error.textContent = '';
      void requestReset(typedEmail).then((failure) => {
        busy = false;
        go.textContent = LABELS.forgot.go;
        if (failure) {
          error.textContent = failure;
          return;
        }
        // Deliberately the same words whether or not anything was found.
        note.textContent =
          'If that address is on a confirmed account, a reset link is on its way. ' +
          'The link works once and expires in an hour.';
        go.disabled = true;
      });
      return;
    }

    if (typedName.length === 0 || typedPassword.length === 0) {
      error.textContent = 'Both fields, please.';
      return;
    }
    if (mode === 'register' && typedEmail.length === 0) {
      error.textContent = 'An email address, please.';
      return;
    }
    busy = true;
    go.textContent = LABELS[mode].busy;
    error.textContent = '';
    void submit(mode, typedName, typedPassword, typedEmail).then((result) => {
      busy = false;
      go.textContent = LABELS[mode].go;
      if (result.ok) onSignedIn(result.account);
      else error.textContent = result.error;
    });
  };

  loginTab.addEventListener('click', () => setMode('login'));
  registerTab.addEventListener('click', () => setMode('register'));
  alt.addEventListener('click', () => {
    go.disabled = false;
    setMode(mode === 'forgot' ? 'login' : 'forgot');
  });
  go.addEventListener('click', attempt);
  for (const field of [name, email, password]) {
    field.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') attempt();
    });
  }

  setMode('login');
  return root;
}

// Ends the session on this machine, or everywhere. Everywhere is what a
// player reaches for after playing on someone else's computer, and it is
// why sessions are stored server-side at all.
export async function signOut(everywhere = false): Promise<void> {
  try {
    await fetch(everywhere ? '/api/logout?all=1' : '/api/logout', {
      method: 'POST',
      credentials: 'same-origin',
    });
  } catch {
    // The cookie may outlive a failed request; the next call to a real
    // endpoint will bounce it anyway.
  }
}
