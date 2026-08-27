// E2E for identity and the career panel: a fresh browser has no career;
// touching the online flow (hello) creates the identity, and the panel
// then shows the handle. The /api surface is also probed directly.
import puppeteer from 'puppeteer-core';

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
  // API guardrails first: junk tokens and unknown ids answer 404.
  const bad = await fetch('http://localhost:8787/api/me?token=nope');
  if (bad.status !== 404) throw new Error(`/api/me junk token: ${bad.status}`);
  const missing = await fetch('http://localhost:8787/api/player/999999');
  if (missing.status !== 404) throw new Error(`/api/player unknown: ${missing.status}`);
  console.log('api guardrails OK');

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

  // Touch the online flow: hello registers the identity, then leave.
  await page.evaluate(() => {
    const input = document.querySelector('.menu-card input.menu-input');
    input.value = 'carrier';
    input.dispatchEvent(new Event('input'));
  });
  await clickButton(page, 'Play online');
  await waitFor(page, findBtn('Start now with bots'), 'queue');
  await clickButton(page, 'Cancel');
  await waitFor(page, findBtn('Play online'), 'home back');

  // The panel now greets the registered handle.
  await clickButton(page, 'Profile and history');
  await waitFor(
    page,
    `document.querySelector('.prof-handle')?.textContent.startsWith('carrier#')`,
    'handle rendered',
  );
  const handle = await page.evaluate(() => document.querySelector('.prof-handle').textContent);
  if (!/^carrier#\d{4}$/.test(handle)) throw new Error(`bad handle shape: ${handle}`);
  const empty = await page.evaluate(() =>
    document.querySelector('.prof-panel').textContent.includes('No online matches'),
  );
  if (!empty) throw new Error('expected the zero-matches line');
  console.log('identity registered, handle', handle);

  // The same identity through the public endpoint, via the stored token.
  const token = await page.evaluate(() => localStorage.getItem('loc-token'));
  const me = await (await fetch(`http://localhost:8787/api/me?token=${token}`)).json();
  if (me.handle !== handle) throw new Error(`api handle mismatch: ${me.handle} vs ${handle}`);
  const pub = await (await fetch(`http://localhost:8787/api/player/${me.id}`)).json();
  if (pub.handle !== handle || 'token' in pub) throw new Error('public player leaks or mismatches');
  console.log('api identity consistent, token never echoed');

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
