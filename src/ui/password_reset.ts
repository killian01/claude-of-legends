// The screen a reset link lands on. Reached at /reset?token=..., which the
// server does not route: unknown paths fall through to the SPA, so this
// reads the token out of the address bar itself.
//
// It stands in front of everything, before the landing page and before any
// session check, because the whole point is that the person here cannot
// sign in. It is also the one screen that must survive the token being
// wrong, so every ending leads back to the front door.

import { startBackdrop } from './home_backdrop';
import { el, ensureMenuCss } from './menu';
import { buildPage, ensurePageCss } from './page';

export const RESET_PATH = '/reset';

const CSS = `
.pg.reset .pg-cards { max-width: 460px; }
.pg.reset .auth-error { min-height: 16px; margin: 10px 0 0; font-size: 12px; color: #f5a3a3; }
.pg.reset .reset-ok { margin: 10px 0 0; font-size: 12.5px; color: #9fd6a8; line-height: 1.5; }
.pg.reset .menu-input { margin: 0 0 8px; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  ensureMenuCss();
  ensurePageCss();
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

// The token this page load is carrying, or null for an ordinary visit.
// Read before anything else in the client runs.
export function pendingResetToken(loc: Location = window.location): string | null {
  if (loc.pathname !== RESET_PATH) return null;
  const token = new URLSearchParams(loc.search).get('token');
  return token && token.length > 0 ? token : null;
}

// Takes the token out of the address bar and puts the visitor back on the
// front door's URL. A reset link is a bearer credential: leaving it in
// history, in a bookmark or in a shared screenshot is how it leaks.
export function clearResetUrl(): void {
  window.history.replaceState(null, '', '/');
}

async function postReset(token: string, password: string): Promise<string | null> {
  try {
    const res = await fetch('/api/password/reset', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    if (res.ok) return null;
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return body?.error ?? 'That did not work.';
  } catch {
    return 'Cannot reach the server. Check your connection.';
  }
}

// Resolves once the visitor is done here, whether they set a password or
// gave up; the caller then shows the landing page as usual.
export function showPasswordReset(container: HTMLElement, token: string): Promise<void> {
  ensureCss();
  return new Promise((resolve) => {
    const { root, inner, nav, hero } = buildPage('reset');
    const stopBackdrop = startBackdrop(root);
    container.appendChild(root);

    const finish = (): void => {
      stopBackdrop();
      root.remove();
      clearResetUrl();
      resolve();
    };

    const skip = el('button', '', 'Back to the game');
    skip.addEventListener('click', finish);
    nav.append(skip);

    hero.append(
      el('h1', 'pg-title', 'New password'),
      el(
        'p',
        'pg-tag',
        'Set a new password for the account this link came from. Every session it had ' +
          'open is signed out at the same time.',
      ),
    );

    const cards = el('div', 'pg-cards');
    const card = el('section', 'pg-card gold');
    card.append(el('h2', '', 'Choose a password'));

    const password = el('input', 'menu-input');
    password.type = 'password';
    password.maxLength = 200;
    password.autocomplete = 'new-password';
    password.placeholder = 'New password';

    const again = el('input', 'menu-input');
    again.type = 'password';
    again.maxLength = 200;
    again.autocomplete = 'new-password';
    again.placeholder = 'The same again';

    const error = el('p', 'auth-error');
    const ok = el('p', 'reset-ok');
    const go = el('button', 'menu-btn primary', 'Set the password');
    let busy = false;

    const attempt = (): void => {
      if (busy) return;
      if (password.value.length === 0) {
        error.textContent = 'A password, please.';
        return;
      }
      // Checked here as well as on the server: a typo in a password you
      // cannot see costs the link, and the link only works once.
      if (password.value !== again.value) {
        error.textContent = 'Those two do not match.';
        return;
      }
      busy = true;
      error.textContent = '';
      go.textContent = 'Setting...';
      void postReset(token, password.value).then((failure) => {
        busy = false;
        go.textContent = 'Set the password';
        if (failure) {
          error.textContent = failure;
          return;
        }
        ok.textContent = 'Done. Sign in with the new password.';
        go.disabled = true;
        password.disabled = true;
        again.disabled = true;
        setTimeout(finish, 1800);
      });
    };

    for (const field of [password, again]) {
      field.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') attempt();
      });
    }
    go.addEventListener('click', attempt);

    card.append(password, again, error, go, ok);
    cards.appendChild(card);
    inner.appendChild(cards);
    password.focus();
  });
}
