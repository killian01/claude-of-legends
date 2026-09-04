// The one piece of the account that needs saying on the home screen: an
// address that has not been confirmed yet, and what to do about it.
//
// It is a strip rather than a modal because it is not urgent. An
// unconfirmed account plays, is rated and places on the ladder exactly
// like any other (ADR 0007); the only thing it cannot do is recover a
// forgotten password. So this informs, offers the two useful actions, and
// never blocks anything.

import type { AuthedAccount } from './auth';
import { el, ensureMenuCss } from './menu';
import { ensurePageCss } from './page';

const CSS = `
.mail-note {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  border: 1px solid #6b5a2e; border-radius: 8px; padding: 8px 14px;
  background: rgba(30, 24, 8, 0.62); backdrop-filter: blur(7px);
  margin: 10px 0 0; font-size: 12px; line-height: 1.4; color: #d8c9a0;
}
.mail-note.good { border-color: #35603c; background: rgba(12, 30, 16, 0.62); color: #b6d9bd; }
.mail-note b { color: #f0deae; }
.mail-note .mail-act {
  background: none; border: 0; padding: 0; font: inherit; font-size: 12px; font-weight: 700;
  color: #e6d7a8; cursor: pointer; text-decoration: underline; text-underline-offset: 3px;
}
.mail-note .mail-act:hover { color: #fff2c8; }
.mail-note .mail-act:disabled { opacity: 0.5; cursor: default; text-decoration: none; }
.mail-note .mail-row { display: flex; gap: 8px; align-items: center; }
.mail-note .menu-btn { width: auto; margin: 0; padding: 5px 12px; font-size: 12px; }
.mail-note .menu-input { width: 220px; max-width: 100%; margin: 0; padding: 5px 10px; font-size: 12.5px; }
.mail-note .mail-said { margin: 0; font-size: 12px; color: #9db0c9; }
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

export type ConfirmResult = 'ok' | 'failed';

// What the confirmation link redirected back with, if this page load came
// from one. Read once and stripped from the address bar, so a reload does
// not repeat the message.
export function takeConfirmResult(loc: Location = window.location): ConfirmResult | null {
  const raw = new URLSearchParams(loc.search).get('confirmed');
  if (raw === null) return null;
  window.history.replaceState(null, '', loc.pathname);
  return raw === '1' ? 'ok' : 'failed';
}

async function post(path: string, body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    if (res.ok) return null;
    const parsed = (await res.json().catch(() => null)) as { error?: string } | null;
    return parsed?.error ?? 'That did not work.';
  } catch {
    return 'Cannot reach the server. Check your connection.';
  }
}

// The line, or null when there is nothing to say: a confirmed address
// needs no notice, and a page that always carries one trains people to
// stop reading it. One line, not a box: it sits between the bar and the
// tiles and must never push them off the screen.
export function buildEmailNotice(
  account: AuthedAccount,
  justConfirmed: ConfirmResult | null,
): HTMLElement | null {
  if (account.emailConfirmed && justConfirmed !== 'failed') {
    if (justConfirmed !== 'ok') return null;
    ensureCss();
    const done = el('div', 'mail-note good');
    done.append(el('span', '', 'Email confirmed. A forgotten password can be reset from now on.'));
    return done;
  }
  // A Discord account with no address gets no line at all (ADR 0009):
  // it has no password to recover, its way back in is the Discord button,
  // and a notice about either would only be noise.
  if (account.email === null && account.discord !== null) return null;
  ensureCss();
  const note = el('div', 'mail-note');
  const said = el('span', 'mail-said');

  if (justConfirmed === 'failed') {
    note.append(
      el(
        'span',
        '',
        'That confirmation link did not work: used already, or expired. Send yourself a fresh one.',
      ),
    );
  } else if (account.email === null) {
    note.append(
      el(
        'span',
        '',
        'No email address on this account. Add one to be able to reset a forgotten password.',
      ),
    );
  } else {
    const line = el('span', '');
    line.append(
      document.createTextNode('Confirm '),
      el('b', '', account.email),
      document.createTextNode(
        ' to be able to reset a forgotten password; it is held for you for a week.',
      ),
    );
    note.appendChild(line);
  }

  const busy = (button: HTMLButtonElement, label: string, work: Promise<string | null>): void => {
    const original = button.textContent ?? label;
    button.disabled = true;
    button.textContent = label;
    void work.then((failure) => {
      button.disabled = false;
      button.textContent = original;
      said.textContent = failure ?? 'Sent. Check your inbox, and the spam folder.';
    });
  };

  if (account.email !== null) {
    const resend = el('button', 'mail-act', 'Send the link again');
    resend.type = 'button';
    resend.addEventListener('click', () => {
      busy(resend, 'Sending...', post('/api/email/resend'));
    });
    note.appendChild(resend);
  }

  // The field: shown at once when there is no address to keep, folded
  // behind a link when there is one and changing it is the rarer move.
  const row = el('div', 'mail-row');
  const field = el('input', 'menu-input');
  field.type = 'email';
  field.maxLength = 254;
  field.autocomplete = 'email';
  field.placeholder = account.email === null ? 'Email address' : 'A different address';
  const save = el('button', 'menu-btn', account.email === null ? 'Add it' : 'Change it');
  save.type = 'button';
  save.addEventListener('click', () => {
    const typed = field.value.trim();
    if (typed.length === 0) {
      said.textContent = 'An email address, please.';
      return;
    }
    busy(save, 'Saving...', post('/api/email', { email: typed }));
  });
  field.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') save.click();
  });
  row.append(field, save);
  if (account.email === null) {
    note.appendChild(row);
  } else {
    const change = el('button', 'mail-act', 'Use a different address');
    change.type = 'button';
    change.addEventListener('click', () => {
      change.replaceWith(row);
      field.focus();
    });
    note.appendChild(change);
  }

  note.appendChild(said);
  return note;
}
