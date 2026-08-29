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

// Registration needs an address now (ADR 0007). example.com is reserved by
// RFC 2606 and can never be a real mailbox, so a run that somehow reached
// a live relay would still send nothing anywhere real. It is never
// confirmed, so these accounts have no reset path, which is correct: they
// are burned after one run anyway.
export function e2eEmail(name) {
  return `${name}@example.com`;
}

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

// Leaves the page on the home screen, signed in as `name`. Idempotent: a
// page that already has a live session cookie skips straight through.
export async function signIn(page, name, timeout = 20000) {
  // Either the landing page (not signed in) or the home card (a live
  // session cookie carried us straight through).
  await page.waitForSelector('.auth-form, .pg.home', { timeout });
  const needsAuth = await page.evaluate(() => document.querySelector('.auth-tabs') !== null);
  if (!needsAuth) return name;

  const attempt = async (mode) => {
    // The tab first, then the fields, then submit. Tab and button carry
    // the same label, so the submit is the last .menu-btn in the form.
    await page.evaluate((m) => {
      const label = m === 'register' ? 'Create account' : 'Sign in';
      [...document.querySelectorAll('.auth-tab')]
        .find((b) => b.textContent?.includes(label))
        ?.click();
    }, mode);
    await fill(page, '.auth-form input.menu-input', name);
    if (mode === 'register') {
      await fill(page, '.auth-form input[type="email"]', e2eEmail(name));
    }
    await fill(page, '.auth-form input[type="password"]', E2E_PASSWORD);
    await page.evaluate(() => {
      [...document.querySelectorAll('.auth-form .menu-btn')].pop()?.click();
    });
    try {
      // Landing gone and the home card up: the only proof that worked.
      await page.waitForSelector('.pg.home', { timeout: 10000 });
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

export async function signInSeeded(page, timeout = 20000) {
  await page.waitForSelector('.auth-form, .pg.home', { timeout });
  const needsAuth = await page.evaluate(() => document.querySelector('.auth-tabs') !== null);
  if (!needsAuth) return SEEDED_NAME;
  await fill(page, '.auth-form input.menu-input', SEEDED_NAME);
  await fill(page, '.auth-form input[type="password"]', SEEDED_PASSWORD);
  await page.evaluate(() => {
    [...document.querySelectorAll('.auth-form .menu-btn')].pop()?.click();
  });
  await page.waitForSelector('.pg.home', { timeout: 10000 });
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
