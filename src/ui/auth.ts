// Proving who someone is: the session already open from a previous visit,
// the credential panel, and signing out. Every connection to the server
// belongs to an account (ADR 0006), so one of these has to succeed before
// anything else in the client can talk to it.
//
// The panel only; the page it sits on is ui/landing.ts. Nothing here
// decides layout, so the same form could sit anywhere.

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
}

type Mode = 'login' | 'register';

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
  mode: Mode,
  name: string,
  password: string,
): Promise<{ ok: true; account: AuthedAccount } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(mode === 'login' ? '/api/login' : '/api/register', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, password }),
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

// Just the credential panel: the tabs, the two fields, the error line and
// the button. The page around it (ui/landing.ts) owns the layout, so this
// module stays about proving who someone is and nothing else.
export function buildAuthForm(onSignedIn: (account: AuthedAccount) => void): HTMLElement {
  ensureCss();
  const root = el('div', 'auth-form');
  let mode: Mode = 'login';
  let busy = false;

  const tabs = el('div', 'auth-tabs');
  const loginTab = el('button', 'auth-tab on', 'Sign in');
  const registerTab = el('button', 'auth-tab', 'Create account');
  tabs.append(loginTab, registerTab);

  const name = el('input', 'menu-input') as HTMLInputElement;
  name.maxLength = 16;
  name.autocomplete = 'username';
  name.placeholder = 'Your name';

  const password = el('input', 'menu-input') as HTMLInputElement;
  password.type = 'password';
  password.maxLength = 200;
  password.autocomplete = 'current-password';
  password.placeholder = 'Password';

  const error = el('p', 'auth-error');
  const go = el('button', 'menu-btn primary', 'Sign in');
  const note = el('p', 'auth-note');

  root.append(tabs, name, password, error, go, note);

  const setMode = (next: Mode): void => {
    mode = next;
    loginTab.classList.toggle('on', next === 'login');
    registerTab.classList.toggle('on', next === 'register');
    go.textContent = next === 'login' ? 'Sign in' : 'Create account';
    password.autocomplete = next === 'login' ? 'current-password' : 'new-password';
    // Said out loud, on the tab where it matters: there is no email in
    // this game, so there is no reset link to fall back on.
    note.textContent =
      next === 'login'
        ? ''
        : 'Letters, digits, _ and - , 3 to 16 characters. There is no email and no password ' +
          'reset: lose the password and the account goes with it.';
    error.textContent = '';
    name.focus();
  };

  const attempt = (): void => {
    if (busy) return;
    const typedName = name.value.trim();
    const typedPassword = password.value;
    if (typedName.length === 0 || typedPassword.length === 0) {
      error.textContent = 'Both fields, please.';
      return;
    }
    busy = true;
    go.textContent = mode === 'login' ? 'Signing in...' : 'Creating...';
    error.textContent = '';
    void submit(mode, typedName, typedPassword).then((result) => {
      busy = false;
      go.textContent = mode === 'login' ? 'Sign in' : 'Create account';
      if (result.ok) onSignedIn(result.account);
      else error.textContent = result.error;
    });
  };

  loginTab.addEventListener('click', () => setMode('login'));
  registerTab.addEventListener('click', () => setMode('register'));
  go.addEventListener('click', attempt);
  for (const field of [name, password]) {
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
