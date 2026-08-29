// E2E for identity and the career panel: a fresh browser has no career;
// touching the online flow (hello) creates the identity, and the panel
// then shows the account name. The /api surface is also probed, from
// inside the page so the session cookie rides the request.
import puppeteer from 'puppeteer-core';
import { apiFromPage, e2eName, signIn } from './e2e_signin.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickButton(page, text) {
  const ok = await page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((e) =>
      (e.textContent || '').trim().startsWith(t),
    );
    if (!b) return false;
    b.click();
    return true;
  }, text);
  if (!ok) throw new Error(`button not found: ${text}`);
}

async function waitFor(page, fnBody, label, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fnBody)) return;
    await sleep(250);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

const findBtn = (t) =>
  `[...document.querySelectorAll('button')].some((e) => (e.textContent || '').trim().startsWith('${t}'))`;

const run = async () => {
  // API guardrails first. Nothing under /api answers without a session
  // now, not even to say that an id is unknown (ADR 0006): the wall comes
  // before the lookup, so it cannot be used to probe which ids exist.
  for (const route of ['/api/me', '/api/account/999999', '/api/ladder', '/api/live']) {
    const res = await fetch(`http://localhost:8787${route}`);
    if (res.status !== 401) throw new Error(`${route} answered ${res.status} with no session`);
  }
  const forged = await fetch('http://localhost:8787/api/me', {
    headers: { cookie: 'loc_session=deadbeefdeadbeefdeadbeefdeadbeef' },
  });
  if (forged.status !== 401) throw new Error(`forged cookie answered ${forged.status}`);
  console.log('api guardrails OK: every route refuses without a live session');

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--use-gl=swiftshader', '--window-size=1500,900', '--mute-audio'],
    defaultViewport: { width: 1500, height: 900 },
  });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL, { waitUntil: 'load' });
  await waitFor(page, findBtn('Play online'), 'home');

  // Fresh browser: no token yet, the panel says so.
  await clickButton(page, 'Profile and history');
  await waitFor(
    page,
    `document.querySelector('.prof-panel')?.textContent.includes('Play an online match')`,
    'empty career message',
  );
  console.log('fresh browser shows no career');

  // Touch the online flow, then leave: the career is empty until a match
  // is recorded against the account, not merely because nobody signed in.
  await clickButton(page, 'Play online');
  await waitFor(page, findBtn('Start now with bots'), 'queue');
  await clickButton(page, 'Cancel');
  await waitFor(page, findBtn('Play online'), 'home back');

  // The panel now greets the signed-in account.
  await clickButton(page, 'Profile and history');
  await waitFor(
    page,
    `!!document.querySelector('.prof-name')?.textContent`,
    'account name rendered',
  );
  const shown = await page.evaluate(() => document.querySelector('.prof-name').textContent);
  if (!/^[A-Za-z0-9_-]{3,16}$/.test(shown)) throw new Error(`bad name shape: ${shown}`);
  const empty = await page.evaluate(() =>
    document.querySelector('.prof-panel').textContent.includes('No online matches'),
  );
  if (!empty) throw new Error('expected the zero-matches line');
  console.log('account signed in, name', shown);

  // The same account through the public endpoint. Both calls go through
  // the page, so the session cookie rides them; from node they would be
  // refused, which is itself worth asserting.
  const me = (await apiFromPage(page, '/api/me')).body;
  if (me.name !== shown) throw new Error(`api name mismatch: ${me.name} vs ${shown}`);
  const pub = (await apiFromPage(page, `/api/account/${me.id}`)).body;
  if (pub.name !== shown) throw new Error('public account mismatches');
  for (const key of ['password', 'salt', 'hash', 'token', 'sessionId']) {
    if (key in pub || key in me) throw new Error(`api leaks ${key}`);
  }
  const cookieless = await fetch('http://localhost:8787/api/me');
  if (cookieless.status !== 401) throw new Error('api/me answered without a session');
  console.log('api identity consistent, no credential echoed, refused without a session');

  if (errors.length > 0) {
    console.log('PAGE ERRORS:', errors.join('\n'));
    throw new Error('page errors occurred');
  }
  console.log('ALL PROFILE E2E PASSED');
  await browser.close();
};

run().catch((e) => {
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});
