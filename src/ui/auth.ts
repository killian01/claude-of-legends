// The way in. Every connection to the server belongs to an account
// (ADR 0006), so this is the first screen a visitor meets, and the only
// one they can reach without one.
//
// Two things are deliberate here. The offline practice match is one click
// away without an account, because it opens no connection and a login
// wall in front of it would only add a dependency it does not have. And
// the screen says plainly that a lost password cannot be recovered: there
// is no email anywhere in this game, so that is not a detail to discover
// later.

import { el, screen } from './menu';

const CSS = `
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
.auth-note { margin: 14px 0 0; font-size: 11px; color: #6d809c; line-height: 1.5; }
.auth-offline {
  display: block; margin: 16px 0 0; font-size: 12px; color: #7e93b2;
  background: none; border: 0; cursor: pointer; text-decoration: underline; font: inherit;
  font-size: 12px; padding: 0;
}
.auth-offline:hover { color: #c9d9ee; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
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

export type AuthResult =
  // Signed in: everything the server allows is now reachable.
  | { kind: 'account'; account: AuthedAccount }
  // Chose the offline practice match instead, which needs no account.
  | { kind: 'offline' };

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

export function showAuth(container: HTMLElement): Promise<AuthResult> {
  ensureCss();
  return new Promise((resolve) => {
    const { root, card } = screen(container);
    let mode: Mode = 'login';
    let busy = false;

    card.append(
      el('h1', 'menu-title', 'Claude of Legends'),
      el('p', 'menu-sub', '5v5 in the browser. No install.'),
    );

    const tabs = el('div', 'auth-tabs');
    const loginTab = el('button', 'auth-tab on', 'Sign in');
    const registerTab = el('button', 'auth-tab', 'Create account');
    tabs.append(loginTab, registerTab);
    card.appendChild(tabs);

    card.appendChild(el('div', 'menu-label', 'Name'));
    const name = el('input', 'menu-input') as HTMLInputElement;
    name.maxLength = 16;
    name.autocomplete = 'username';
    card.appendChild(name);

    card.appendChild(el('div', 'menu-label', 'Password'));
    const password = el('input', 'menu-input') as HTMLInputElement;
    password.type = 'password';
    password.maxLength = 200;
    password.autocomplete = 'current-password';
    card.appendChild(password);

    const error = el('p', 'auth-error');
    card.appendChild(error);

    const go = el('button', 'menu-btn primary', 'Sign in');
    card.appendChild(go);

    const note = el('p', 'auth-note');
    card.appendChild(note);

    const offline = el('button', 'auth-offline', 'Play offline against bots, no account needed');
    card.appendChild(offline);

    const setMode = (next: Mode): void => {
      mode = next;
      loginTab.classList.toggle('on', next === 'login');
      registerTab.classList.toggle('on', next === 'register');
      go.textContent = next === 'login' ? 'Sign in' : 'Create account';
      password.autocomplete = next === 'login' ? 'current-password' : 'new-password';
      // The whole reason to say this out loud: there is no email in this
      // game, so there is no reset link to fall back on.
      note.textContent =
        next === 'login'
          ? ''
          : 'Letters, digits, _ and - , 3 to 16 characters. There is no email and no password ' +
            'reset: if you lose the password, the account and its rating are gone.';
      error.textContent = '';
      name.focus();
    };

    const finish = (result: AuthResult): void => {
      root.remove();
      resolve(result);
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
        if (result.ok) finish({ kind: 'account', account: result.account });
        else error.textContent = result.error;
      });
    };

    loginTab.addEventListener('click', () => setMode('login'));
    registerTab.addEventListener('click', () => setMode('register'));
    go.addEventListener('click', attempt);
    offline.addEventListener('click', () => finish({ kind: 'offline' }));
    for (const field of [name, password]) {
      field.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') attempt();
      });
    }

    setMode('login');
  });
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
