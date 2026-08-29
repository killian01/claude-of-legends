// Signing a headless page in. Every e2e script needs this now: the server
// refuses the WebSocket upgrade and every /api route without a session
// (ADR 0006), so there is no way to reach the home screen without an
// account. One helper rather than the same twenty lines in eight scripts.
//
// Registration is free and instant, so each run just makes its own
// account. Names collide across runs against a long-lived dev server, and
// a name is never handed back once taken, so the caller passes a name it
// is willing to burn: signIn falls back to signing in when the name is
// already there from a previous run.

// Names are ASCII, 3 to 16, letters digits _ and - (server/account_name.ts).
// Anything an e2e script wants to call itself has to survive that.
export function e2eName(base, suffix = '') {
  const cleaned = `${base}${suffix}`.replace(/[^A-Za-z0-9_-]/g, '');
  return cleaned.slice(0, 16).padEnd(3, 'x');
}

// A password nobody has to remember: these accounts exist for one run.
export const E2E_PASSWORD = 'e2e-password-01';

async function fill(page, selector, value) {
  await page.evaluate(
    (sel, v) => {
      const input = document.querySelectorAll(sel)[0];
      if (!input) throw new Error(`no field at ${sel}`);
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
    selector,
    value,
  );
}

async function clickText(page, text) {
  const ok = await page.evaluate((t) => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(t));
    if (!el) return false;
    el.click();
    return true;
  }, text);
  if (!ok) throw new Error(`could not click "${text}"`);
  return true;
}

// Leaves the page on the home screen, signed in as `name`. Idempotent: a
// page that already has a live session cookie skips straight through.
export async function signIn(page, name, timeout = 15000) {
  await page.waitForSelector('.menu-card', { timeout });
  const needsAuth = await page.evaluate(() => document.querySelector('.auth-tabs') !== null);
  if (!needsAuth) return name;

  const attempt = async (mode) => {
    await clickText(page, mode === 'register' ? 'Create account' : 'Sign in');
    await fill(page, '.menu-card input.menu-input', name);
    await fill(page, '.menu-card input[type="password"]', E2E_PASSWORD);
    await clickText(page, mode === 'register' ? 'Create account' : 'Sign in');
    try {
      await page.waitForFunction(() => document.querySelector('.auth-tabs') === null, {
        timeout: 8000,
      });
      return true;
    } catch {
      return false;
    }
  };

  // New name on a fresh server, or a name this suite already burned on an
  // earlier run against the same data dir.
  if (await attempt('register')) return name;
  if (await attempt('login')) return name;
  const error = await page.evaluate(() => document.querySelector('.auth-error')?.textContent ?? '');
  throw new Error(`could not sign in as ${name}: ${error || 'no message'}`);
}

// The account scripts/seed_replay.ts creates, whose career holds the
// seeded match and therefore the Watch button.
export const SEEDED_NAME = 'seer';
export const SEEDED_PASSWORD = 'seed-replay-e2e';

export async function signInSeeded(page, timeout = 15000) {
  await page.waitForSelector('.menu-card', { timeout });
  const needsAuth = await page.evaluate(() => document.querySelector('.auth-tabs') !== null);
  if (!needsAuth) return SEEDED_NAME;
  await page.evaluate(
    (name, password) => {
      const buttons = [...document.querySelectorAll('button')];
      buttons.find((b) => b.textContent?.includes('Sign in'))?.click();
      const fields = [...document.querySelectorAll('.menu-card input')];
      const [nameField, passwordField] = fields;
      nameField.value = name;
      nameField.dispatchEvent(new Event('input', { bubbles: true }));
      passwordField.value = password;
      passwordField.dispatchEvent(new Event('input', { bubbles: true }));
      buttons
        .filter((b) => b.textContent?.includes('Sign in'))
        .pop()
        ?.click();
    },
    SEEDED_NAME,
    SEEDED_PASSWORD,
  );
  await page.waitForFunction(() => document.querySelector('.auth-tabs') === null, {
    timeout: 8000,
  });
  return SEEDED_NAME;
}

// A /api call made from inside the page, so the session cookie rides it.
// Fetching from node would arrive without one and be refused (ADR 0006).
export async function apiFromPage(page, apiPath) {
  return page.evaluate(async (p) => {
    const res = await fetch(p, { credentials: 'same-origin' });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, apiPath);
}
