// E2E for the landing's own panel (src/ui/own_panel_view.ts, ADR 0033): who
// the visitor is from the first page, at three sizes: 1280x720, a phone
// held sideways (844x390, touch) and upright (390x844, touch).
//
// FIXTURE=1 answers the landing's one request (POST /api/public/landing)
// and the rename (POST /api/ladder/name) from the page itself, so it needs
// the Vite client alone. Four states: a fresh Guest, a handed-out name with
// 85 points, Thornwick (a named Guest, #12 with 340 points) and Marrow (an
// account). Each is measured: the name and the gold button inside the first
// screen, no horizontal scroll, no overlap inside the panel. On Thornwick
// the rename walks a too-short name and a name with a space (refused with no
// request), a taken name (refused by the server's words) and a good one
// (Saved., and the ladder's own row reads it), then Keep it on every device
// opens the register tab with the name in it and the password focused.
//
// Without FIXTURE it walks the real stack (seed it with
// node scripts/seed_home.mjs first): a fresh browser reads a handed-out
// 'Wanderer NNNN', renames, reloads and keeps the name; a browser holding
// the cookie loc_guest=seed-home-guest reads Thornwick with 340 points,
// Level 4 and a best of 9.
//
// On every state the five ways to play under the gold button are measured
// too (ui/landing_modes.ts LANDING_WAYS): Respawn, One life, the Thornfray
// with its own emblem, the 5v5 and a private lobby, each row whole inside
// the card, none over another, its words at a readable size, and the code
// line under them; with PRESENCE=1 the Thornfray's row says its gathering
// on one line.
//
// In fixture mode an invite link (/?join=KMNPQR, ADR 0036) is opened on four
// more states, the landing's answer read off the request's JSON body:
// 'invited' (Marrow's lobby, 3 of 10), 'closed', 'full' and 'limited'. The
// band under the bar is measured: the code rode the body and never the
// address, the title, the name field and Join inside the first screen of a
// phone either way up, Join inside the first screen everywhere, the band at
// most 175 px on a short screen, the field over Join at 560 px wide and
// under, the gold halo on the band while it can be taken and back on the
// Play now card when it cannot. On 'invited' a taken name is refused in the
// server's words with no join, a good one is saved before the Guest is
// asked for (POST /api/ladder/name before POST /api/guest), and Not now puts
// the band away.
//
// CHROME and E2E_URL from the environment, SHOT_DIR for the PNGs, SIZES to
// pick among desktop,laptop,wide,landscape,portrait, PRESENCE=1 for someone
// on (fixture mode). One browser.
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.E2E_URL ?? 'http://localhost:5173';
const SHOT_DIR = process.env.SHOT_DIR ?? '';
const FIXTURE = process.env.FIXTURE === '1';
// Someone on: the presence line stands over the gold button, the tallest the
// card gets. The button then has to stay inside the first screen, not
// inside the tighter target.
const PRESENCE = process.env.PRESENCE === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The sizes, and the targets each holds: the name's box and the gold
// button's inside the first screen.
const SIZES = [
  {
    id: 'desktop',
    viewport: { width: 1280, height: 720 },
    nameTop: 300,
    playBottom: 640,
  },
  {
    id: 'laptop',
    viewport: { width: 1280, height: 800 },
    nameTop: 300,
    playBottom: 760,
  },
  {
    id: 'wide',
    viewport: { width: 1920, height: 1080 },
    nameTop: 360,
    playBottom: 1000,
  },
  {
    id: 'landscape',
    viewport: { width: 844, height: 390, isMobile: true, hasTouch: true },
    nameBottom: 390,
    playBottom: 390,
  },
  {
    id: 'portrait',
    viewport: { width: 390, height: 844, isMobile: true, hasTouch: true },
    nameBottom: 480,
    playBottom: 844,
  },
].filter((s) => !process.env.SIZES || process.env.SIZES.split(',').includes(s.id));

function check(cond, what) {
  if (!cond) throw new Error(`check failed: ${what}`);
  console.log(`ok: ${what}`);
}

async function shot(page, name) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
}

async function waitFor(page, fn, label, timeout = 20000, ...args) {
  try {
    await page.waitForFunction(fn, { timeout, polling: 100 }, ...args);
  } catch {
    throw new Error(`timeout waiting for: ${label}`);
  }
}

// --- the fixtures: what server/landing_page.ts answers for each state ---

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const FILLER = [
  'Ashgrove',
  'Brindle',
  'Cinderwake',
  'Dovetail',
  'Emberly',
  'Fallowmere',
  'Gloamrider',
  'Hollowell',
  'Ironbark',
  'Juniper',
  'Kestrelle',
  'Larkspur',
  'Mosswhistle',
  'Nettlebright',
  'Oakhollow',
  'Pebblefoot',
  'Quietbrook',
  'Rushwater',
  'Saltmarsh',
  'Tallowmere',
  'Umberline',
  'Vesperine',
  'Willowisp',
  'Yarrowfen',
  'Zephyrine',
  'Amberlode',
  'Bramblet',
  'Copperfern',
  'Duskmere',
  'Eldertide',
  'Flintwick',
  'Galefen',
  'Hazelrook',
  'Ivoryash',
  'Jadecrest',
  'Kindlewood',
  'Lanternfly',
  'Marigold',
  'Nightjar',
  'Orchardine',
];
const WEEK = {
  rotation: ['korrath', 'vesk', 'maera'],
  starters: ['torv', 'fenn', 'ashvyn', 'sylra'],
  turnsAt: NOW + 5 * DAY + 3 * 60 * 60 * 1000,
};

// Forty rows around the reader's own line and the one above it.
function ladderAround(own) {
  const rows = [];
  let filler = 0;
  for (let rank = 1; rank <= 40; rank++) {
    let name;
    let points;
    let guest = rank % 3 === 0;
    if (own?.rank === rank) {
      name = own.name;
      points = own.points;
      guest = !own.account;
    } else if (own?.above?.rank === rank) {
      name = own.above.name;
      points = own.above.points;
    } else {
      name = FILLER[filler++ % FILLER.length];
      if (!own || own.rank === null) points = 600 - (rank - 1) * 14;
      else if (rank < own.rank) points = own.above.points + (own.above.rank - rank) * 20;
      else points = Math.max(1, own.points - (rank - own.rank) * 6);
    }
    rows.push({ rank, name, points, guest });
  }
  const me = own
    ? { rank: own.rank, points: own.points, name: own.name, guest: !own.account, named: own.named }
    : null;
  return { total: rows.length, rows, me };
}

const STATES = {
  fresh: {
    name: 'Wanderer 0421',
    named: false,
    account: false,
    rank: null,
    points: 0,
    level: { level: 1, from: 0, to: 50 },
    best: 0,
    above: null,
    since: NOW,
  },
  handed: {
    name: 'Wanderer 0421',
    named: false,
    account: false,
    rank: 31,
    points: 85,
    level: { level: 2, from: 50, to: 125 },
    best: 3,
    above: { rank: 30, name: 'Wanderer 7710', points: 90, gap: 6 },
    since: NOW - 3 * DAY,
  },
  thornwick: {
    name: 'Thornwick',
    named: true,
    account: false,
    rank: 12,
    points: 340,
    level: { level: 4, from: 225, to: 350 },
    best: 9,
    above: { rank: 11, name: 'Quillon', points: 352, gap: 13 },
    since: NOW - 3 * DAY,
  },
  marrow: {
    name: 'Marrow',
    named: true,
    account: true,
    rank: 3,
    points: 1240,
    level: { level: 9, from: 1100, to: 1350 },
    best: 14,
    above: { rank: 2, name: 'Quillon', points: 1302, gap: 63 },
    since: Date.UTC(2026, 8, 12),
  },
};

// What the landing answers of the invite code, by state (server/landing_page.ts).
const CODE = 'KMNPQR';
const INVITES = {
  invited: { open: true, host: 'Marrow', players: 3, seats: 10 },
  closed: { open: false },
  full: { open: true, host: 'Marrow', players: 10, seats: 10 },
  limited: { open: false, limited: true },
};

const TAKEN = 'Somebody already plays under that name. Pick another one.';
const BLOCKED = 'That name is not allowed on the ladder. Pick another one.';

// The page's requests answered from the fixtures: the landing, the rename,
// the count under the hero a live server draws, and with PRESENCE=1 the
// presence line over the gold button.
async function intercept(page, fixture) {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const path = new globalThis.URL(req.url()).pathname;
    const json = (status, body) =>
      req.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/public/landing' && req.method() === 'POST') {
      const own = STATES[fixture.state];
      const join = JSON.parse(req.postData() || '{}').join ?? null;
      fixture.joins.push({ join, address: req.url() });
      const answer = { ladder: ladderAround(own), own, week: WEEK };
      if (join !== null && fixture.invite) answer.invite = INVITES[fixture.invite];
      json(200, answer);
      return;
    }
    if (path === '/api/ladder/name' && req.method() === 'POST') {
      const name = JSON.parse(req.postData() ?? '{}').name;
      fixture.renames.push(name);
      fixture.log.push('name');
      if (name === 'Thornwick2' || name === 'Brindle2') json(200, { name });
      else if (name === 'Quillon') json(409, { error: TAKEN });
      else json(400, { error: BLOCKED });
      return;
    }
    if (path === '/api/public/presence' && PRESENCE) {
      json(200, {
        playing: 3,
        queued: 0,
        joinable: true,
        royale: { playing: 3, joinable: true, endsInS: 420 },
        thornfray: { playing: 5, gathering: 3 },
      });
      return;
    }
    if (path === '/api/public/stats') {
      json(200, { online: 3, matches: 1, accounts: 1240 });
      return;
    }
    if (path === '/api/me') {
      json(401, { error: 'not signed in' });
      return;
    }
    // The Guest a Join asks for: counted, and refused, so the page goes no
    // further than the order of the two requests.
    if (path === '/api/guest' && req.method() === 'POST') {
      fixture.log.push('guest');
      json(503, { error: 'not in this script' });
      return;
    }
    req.continue();
  });
}

// --- what is measured on each state ---

async function openLanding(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await waitFor(
    page,
    () => document.querySelector('.pg.land.own-on .own:not(.own-wait) .own-name') !== null,
    'the own panel',
  );
  await page.evaluate(() => document.fonts.ready);
  await sleep(300);
}

async function measure(page) {
  return page.evaluate(() => {
    const box = (e) => {
      if (!e || e.offsetParent === null) return null;
      const r = e.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, h: r.height };
    };
    const overlap = (a, b) =>
      a && b
        ? Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
          Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
        : 0;
    const own = document.querySelector('.own');
    const parts = [...own.children].map(box).filter(Boolean);
    const tiles = [...own.querySelectorAll('.own-tile')].map(box);
    let worst = 0;
    for (const set of [parts, tiles]) {
      for (let i = 0; i < set.length; i++) {
        for (let j = i + 1; j < set.length; j++) worst = Math.max(worst, overlap(set[i], set[j]));
      }
    }
    const name = document.querySelector('.own-name');
    const change = document.querySelector('.own-change');
    worst = Math.max(worst, overlap(box(name), box(change)));
    const pg = document.querySelector('.pg');
    const card = document.querySelector('.pg-card.plain');
    const text = (sel) => document.querySelector(sel)?.textContent ?? '';
    const tileTexts = [...own.querySelectorAll('.own-tile')].map((t) => ({
      label: t.querySelector('small')?.textContent ?? '',
      value: t.querySelector('b')?.textContent ?? '',
      line: t.querySelector('span')?.textContent ?? '',
    }));
    const gold = document.querySelector('.pg-card.gold');
    return {
      name: box(name),
      nameText: name?.textContent ?? '',
      change: box(change),
      // The Play now card's own gold button: the invitation's Join is gold too.
      play: box(document.querySelector('.pg-card.plain .menu-btn.pg-play')),
      playGlow: document.querySelector('.pg-card.plain')?.classList.contains('glow') ?? false,
      own: box(own),
      card: box(card),
      overlap: worst,
      docScroll: document.documentElement.scrollWidth,
      pgScroll: pg.scrollWidth,
      pgClient: pg.clientWidth,
      width: window.innerWidth,
      sub: text('.own-sub-text'),
      keep: box(document.querySelector('.own-keep')) ? text('.own-keep') : null,
      next: text('.own-next'),
      tiles: tileTexts,
      banner: box(document.querySelector('.pg-new')) !== null,
      presence: box(document.querySelector('.pg-presence')) !== null,
      accountCard: gold && !gold.hidden ? text('.pg-card.gold > h2') : null,
      week: box(document.querySelector('.pg-way-week')) ? text('.pg-way-week-text') : null,
      weekFaces: box(document.querySelector('.pg-way-week-faces'))
        ? document.querySelectorAll('.pg-way-week-faces img').length
        : 0,
      join: text('.pg-ladder-join .menu-btn'),
      ownRow: text('.pg-ladder li.me .pg-ladder-name'),
      face: document.querySelector('.own-mark img.own-face')?.getAttribute('src') ?? null,
      emblem: document.querySelector('.own-mark .planet-emblem') !== null,
      ways: [...document.querySelectorAll('.pg-way')].map((row) => {
        const words = row.querySelector('.pg-way-words');
        const live = row.querySelector('.pg-way-live');
        const liveText = live?.querySelector('span');
        return {
          id: row.dataset.way,
          box: box(row),
          words: box(words),
          title: row.querySelector('.pg-way-words b')?.textContent ?? '',
          lineSize: Number.parseFloat(
            getComputedStyle(row.querySelector('.pg-way-words span')).fontSize,
          ),
          clipped: words.scrollWidth > words.clientWidth + 1,
          emblem: [...(row.querySelector('.planet-emblem')?.classList ?? [])].join(' '),
          rings: row.querySelectorAll('.planet-emblem .pe-rim, .planet-emblem .pe-close').length,
          live: box(live) ? (liveText?.textContent ?? '') : null,
          liveOneLine: liveText ? liveText.getBoundingClientRect().height < 20 : true,
          liveWhole: liveText ? liveText.scrollWidth <= liveText.clientWidth + 1 : true,
        };
      }),
      waysLabel: text('.pg-ways-label'),
      code: (() => {
        const line = document.querySelector('.pg-code');
        const field = document.querySelector('.pg-code-field');
        const go = document.querySelector('.pg-code-go');
        return {
          line: box(line),
          field: box(field),
          go: box(go),
          label: text('.pg-code-label'),
          fieldSize: field ? Number.parseFloat(getComputedStyle(field).fontSize) : 0,
          inRow: line?.closest('.pg-way') !== null,
        };
      })(),
    };
  });
}

// The five ways under the gold button, and the code line under them, on
// every state.
function checkWays(m, size, label) {
  const at = `${size.id} ${label}`;
  const ids = m.ways.map((w) => w.id).join(',');
  check(ids === 'respawn,one_life,thornfray,classic,lobby', `${at}: five ways in (${ids})`);
  check(m.waysLabel === 'Five ways to play', `${at}: ${m.waysLabel}`);
  const lobby = m.ways.find((w) => w.id === 'lobby');
  check(lobby?.title === 'Private lobby', `${at}: the lobby row reads ${lobby?.title}`);
  const code = m.code;
  check(code.line !== null && code.label === 'Have a code?', `${at}: the code line is drawn`);
  check(!code.inRow, `${at}: the code line stands outside every row`);
  check(
    code.line.left >= m.card.left - 0.5 && code.line.right <= m.card.right + 0.5,
    `${at}: the code line stays inside the card`,
  );
  const last = m.ways[m.ways.length - 1].box;
  check(code.line.top >= last.bottom - 0.5, `${at}: the code line stands under the rows`);
  check(code.fieldSize >= 16, `${at}: the code field at ${code.fieldSize} px`);
  if (size.viewport.hasTouch) {
    check(
      code.field.h >= 32 && code.go.h >= 32,
      `${at}: the code field and Join are ${Math.round(code.field.h)} and ${Math.round(code.go.h)} px tall`,
    );
  }
  let worst = 0;
  for (let i = 0; i < m.ways.length; i++) {
    const w = m.ways[i];
    check(w.box !== null, `${at}: the ${w.id} row is drawn`);
    check(
      w.box.left >= m.card.left - 0.5 && w.box.right <= m.card.right + 0.5,
      `${at}: the ${w.id} row stays inside the card`,
    );
    check(!w.clipped, `${at}: the ${w.id} row's words fit their column`);
    check(w.lineSize >= 11, `${at}: the ${w.id} row's line at ${w.lineSize} px`);
    for (let j = i + 1; j < m.ways.length; j++) {
      const o = m.ways[j].box;
      worst = Math.max(
        worst,
        Math.max(0, Math.min(w.box.bottom, o.bottom) - Math.max(w.box.top, o.top)),
      );
    }
  }
  check(worst < 1, `${at}: no row over another (${worst.toFixed(1)})`);
  const tf = m.ways.find((w) => w.id === 'thornfray');
  check(tf?.title === 'Thornfray', `${at}: the Thornfray row reads ${tf?.title}`);
  check(
    /\bthornfray\b/.test(tf?.emblem ?? '') && tf?.rings === 2,
    `${at}: the Thornfray wears its own emblem (${tf?.emblem}, ${tf?.rings} rings)`,
  );
  if (PRESENCE) {
    check(
      tf?.live === 'Gathering now: 3 of 8. Join in.',
      `${at}: the Thornfray row says ${tf?.live}`,
    );
    check(tf.liveOneLine && tf.liveWhole, `${at}: its count keeps one line, whole`);
  } else {
    check(tf?.live === null, `${at}: no count on the Thornfray row with nobody on`);
  }
}

function checkLayout(m, size, label) {
  const at = `${size.id} ${label}`;
  check(m.name !== null && m.play !== null, `${at}: the name and the gold button are drawn`);
  if (size.nameTop !== undefined) {
    check(
      m.name.top < size.nameTop,
      `${at}: the name's top ${Math.round(m.name.top)} < ${size.nameTop}`,
    );
  }
  if (size.nameBottom !== undefined) {
    check(
      m.name.bottom <= size.nameBottom,
      `${at}: the name's bottom ${Math.round(m.name.bottom)} <= ${size.nameBottom}`,
    );
  }
  // Someone on, as the fixture's PRESENCE=1 or as a real stack shows it:
  // the presence line stands over the button, which then has to stay
  // inside the first screen rather than inside the tighter target.
  const playBottom = PRESENCE || m.presence ? size.viewport.height : size.playBottom;
  check(
    m.play.bottom <= playBottom && m.play.top >= 0,
    `${at}: the gold button's bottom ${Math.round(m.play.bottom)} <= ${playBottom}`,
  );
  check(
    m.docScroll <= m.width && m.pgScroll <= m.pgClient,
    `${at}: no horizontal scroll (${m.docScroll}/${m.pgScroll} in ${m.width})`,
  );
  check(m.overlap < 1, `${at}: nothing in the panel overlaps (${m.overlap.toFixed(1)})`);
  check(m.playGlow, `${at}: the Play now card breathes the gold halo`);
  check(m.own.right <= m.card.right + 0.5, `${at}: the panel stays inside the card`);
  if (size.viewport.hasTouch && m.change) {
    check(m.change.h >= 32, `${at}: Change is ${Math.round(m.change.h)} px tall`);
  }
}

async function selectAndType(page, text) {
  await page.evaluate(() => {
    const field = document.querySelector('.own-field');
    field.focus();
    field.select();
  });
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

async function fixtureRun(browser, size) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewport(size.viewport);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const fixture = { state: 'fresh', invite: null, renames: [], joins: [], log: [] };
  await intercept(page, fixture);

  for (const state of Object.keys(STATES)) {
    fixture.state = state;
    if (state === 'marrow') {
      // A browser that has played a battle royale: the mark is the champion
      // its quick pick remembers (game/settings.ts royalePick).
      await page.evaluate(() => {
        let kept = {};
        try {
          kept = JSON.parse(localStorage.getItem('loc-settings') ?? '{}') ?? {};
        } catch {}
        const royalePick = { championId: 'korrath', skin: 0, sigils: ['a', 'b'] };
        localStorage.setItem('loc-settings', JSON.stringify({ ...kept, royalePick }));
      });
    }
    await openLanding(page);
    const m = await measure(page);
    checkLayout(m, size, state);
    console.log(
      `${size.id} ${state}: the gold button at ${Math.round(m.play.top)} to ` +
        `${Math.round(m.play.bottom)}, the rows from ${Math.round(m.ways[0].box.top)} to ` +
        `${Math.round(m.ways[m.ways.length - 1].box.bottom)}`,
    );
    checkWays(m, size, state);
    const own = STATES[state];
    check(m.nameText === own.name, `${size.id} ${state}: the name reads ${own.name}`);
    await shot(page, `own-${size.id}-${state}`);
    if (state === 'fresh') {
      check(m.tiles[0]?.value === 'Not yet', `${size.id} fresh: Ladder Not yet`);
      check(m.keep === null, `${size.id} fresh: no keep offer yet`);
      check(m.accountCard === 'Create a free account', `${size.id} fresh: the plain account offer`);
      check(m.join === 'Take your place', `${size.id} fresh: the ladder says Take your place`);
      check(
        m.banner === (size.id !== 'landscape'),
        `${size.id} fresh: the New banner ${size.id === 'landscape' ? 'gives way' : 'shows'}`,
      );
      check(
        m.next === 'Next: one match puts Wanderer 0421 on the ladder.',
        `${size.id} fresh: ${m.next}`,
      );
    }
    if (state === 'handed') {
      check(m.tiles[0]?.value === '#31', `${size.id} handed: Ladder #31`);
      check(m.keep === 'Keep it on every device', `${size.id} handed: the keep offer`);
      check(!m.banner, `${size.id} handed: no New banner for a kept Guest`);
      check(m.join === 'Play to climb', `${size.id} handed: the ladder says Play to climb`);
    }
    if (state === 'thornwick') {
      check(
        m.tiles.map((t) => t.value).join(' ') === '#12 4 9',
        `${size.id} thornwick: #12, Level 4, best 9`,
      );
      check(m.accountCard === 'Keep it on every device', `${size.id} thornwick: the keep card`);
      check(m.ownRow === 'Thornwick', `${size.id} thornwick: the ladder marks the own row`);
      check(
        m.tiles[1]?.line === '10 points to Level 5',
        `${size.id} thornwick: ${m.tiles[1]?.line}`,
      );
    }
    if (state === 'fresh') {
      check(m.emblem && m.face === null, `${size.id} fresh: the mark is the Wanderseed`);
    }
    if (state === 'marrow') {
      check(/korrath/.test(m.face ?? ''), `${size.id} marrow: the mark is the last champion`);
      check(m.change === null, `${size.id} marrow: no Change for an account`);
      check(m.keep === 'Open your home', `${size.id} marrow: Open your home`);
      check(m.accountCard === null, `${size.id} marrow: no account card for an account`);
      check(m.sub === 'Your account since Sep 12.', `${size.id} marrow: ${m.sub}`);
    }
    check(
      m.week === "This week's three: Korrath, Vesk and Maera, for 5 more days.",
      `${size.id} ${state}: the week's three on the 5v5's way in`,
    );
    // Sideways, the faces give way and the words keep one line.
    check(
      m.weekFaces === (size.id === 'landscape' ? 0 : 3),
      `${size.id} ${state}: ${m.weekFaces} faces of the week`,
    );
  }

  // The rename, on Thornwick.
  fixture.state = 'thornwick';
  await openLanding(page);
  await page.click('.own-change');
  await waitFor(page, () => !document.querySelector('.own-edit').hidden, 'the name form');
  const opened = await page.evaluate(() => ({
    value: document.querySelector('.own-field').value,
    focused: document.activeElement === document.querySelector('.own-field'),
    save: document.querySelector('.own-save').getBoundingClientRect().height,
  }));
  check(opened.value === 'Thornwick' && opened.focused, `${size.id}: Change opens the field`);
  if (size.viewport.hasTouch)
    check(opened.save >= 32, `${size.id}: Save is ${opened.save} px tall`);
  const formBox = await measure(page);
  check(formBox.overlap < 1, `${size.id}: the open form overlaps nothing`);
  check(formBox.docScroll <= formBox.width, `${size.id}: the open form scrolls no wider`);
  await shot(page, `own-${size.id}-rename-open`);

  const status = () => page.evaluate(() => document.querySelector('.own-status').textContent);
  await selectAndType(page, 'ab');
  check(
    (await status()) === 'A name needs at least 3 letters or digits.' &&
      fixture.renames.length === 0,
    `${size.id}: 'ab' is too short, with no request`,
  );
  await selectAndType(page, 'Bad name');
  check(
    (await status()) === 'A name may use letters, digits, underscores and hyphens only.' &&
      fixture.renames.length === 0,
    `${size.id}: 'Bad name' has a space, with no request`,
  );
  await selectAndType(page, 'Quillon');
  await waitFor(
    page,
    (t) => document.querySelector('.own-status').textContent === t,
    'taken',
    5000,
    TAKEN,
  );
  const kept = await page.evaluate(() => ({
    open: !document.querySelector('.own-edit').hidden,
    focused: document.activeElement === document.querySelector('.own-field'),
  }));
  check(
    kept.open && kept.focused && fixture.renames.length === 1,
    `${size.id}: 'Quillon' is refused in the server's words, the form kept`,
  );
  // The refusal reads right under the field: the sub line steps aside while
  // the form is open, and the field, Save and Cancel share one row.
  const edit = await page.evaluate(() => {
    const box = (sel) => document.querySelector(sel).getBoundingClientRect();
    const field = box('.own-field');
    return {
      subShown: getComputedStyle(document.querySelector('.own-sub')).display !== 'none',
      gap: box('.own-status').top - field.bottom,
      saveRow: Math.abs(
        box('.own-save').top + box('.own-save').height / 2 - field.top - field.height / 2,
      ),
      cancelRow: Math.abs(
        box('.own-cancel').top + box('.own-cancel').height / 2 - field.top - field.height / 2,
      ),
    };
  });
  check(!edit.subShown, `${size.id}: the sub line steps aside while the name is edited`);
  check(
    edit.saveRow < 4 && edit.cancelRow < 4,
    `${size.id}: field, Save and Cancel share a row (${edit.saveRow}, ${edit.cancelRow})`,
  );
  check(edit.gap <= 40, `${size.id}: the refusal is ${edit.gap.toFixed(1)} px under the field`);
  await shot(page, `own-${size.id}-refused`);
  await selectAndType(page, 'Thornwick2');
  await waitFor(
    page,
    () => document.querySelector('.own-status').textContent === 'Saved.',
    'Saved.',
  );
  const saved = await measure(page);
  check(saved.nameText === 'Thornwick2', `${size.id}: the panel reads Thornwick2`);
  check(saved.ownRow === 'Thornwick2', `${size.id}: the ladder's own row reads Thornwick2`);
  check(fixture.renames.length === 2, `${size.id}: two requests in all`);
  await shot(page, `own-${size.id}-saved`);

  // Keep it on every device: the register tab, the name in it, the password focused.
  await page.click('.own-keep');
  await sleep(900);
  const reg = await page.evaluate(() => {
    const form = document.querySelector('.auth-form');
    const inputs = [...form.querySelectorAll('input.menu-input')];
    const password = inputs.find((i) => i.type === 'password');
    const name = inputs.find((i) => i.type !== 'password' && i.type !== 'email');
    const card = document.querySelector('.pg-card.gold').getBoundingClientRect();
    return {
      tab: document.querySelector('.auth-tab.on')?.textContent ?? '',
      name: name?.value ?? '',
      focused: document.activeElement === password,
      cardTop: card.top,
      height: window.innerHeight,
    };
  });
  check(reg.tab === 'Create account', `${size.id}: Keep opens the register tab`);
  check(reg.name === 'Thornwick2', `${size.id}: the name field holds Thornwick2`);
  check(reg.focused, `${size.id}: the password field has focus`);
  check(reg.cardTop < reg.height, `${size.id}: the account card is on screen`);
  await shot(page, `own-${size.id}-keep`);

  await inviteRun(page, fixture, size);

  check(
    errors.length === 0,
    `${size.id}: no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`,
  );
  await ctx.close();
}

// --- the invitation (ui/invite_card.ts), in fixture mode ---

async function openInvited(page, fixture, invite) {
  fixture.state = 'fresh';
  fixture.invite = invite;
  fixture.joins.length = 0;
  fixture.log.length = 0;
  fixture.renames.length = 0;
  await page.goto(`${URL}/?join=${CODE}`, { waitUntil: 'domcontentloaded' });
  await waitFor(
    page,
    () => document.querySelector('.pg.land.own-on .own:not(.own-wait) .own-name') !== null,
    'the own panel',
  );
  await waitFor(page, () => document.querySelector('.pg-invite') !== null, 'the invitation');
  await page.evaluate(() => document.fonts.ready);
  await sleep(300);
}

async function measureInvite(page) {
  return page.evaluate(() => {
    const box = (e) => {
      if (!e || e.offsetParent === null) return null;
      const r = e.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, h: r.height };
    };
    const band = document.querySelector('.pg-invite');
    const field = document.querySelector('.pg-invite-field');
    const go = document.querySelector('.pg-invite-go');
    const hero = document.querySelector('.pg-hero');
    const text = (sel) => document.querySelector(sel)?.textContent ?? '';
    const following = Node.DOCUMENT_POSITION_FOLLOWING;
    return {
      band: box(band),
      bandGlow: band?.classList.contains('glow') ?? false,
      beforeHero: band && hero ? (band.compareDocumentPosition(hero) & following) > 0 : false,
      title: box(document.querySelector('.pg-invite-title')),
      titleText: text('.pg-invite-title'),
      lineText: text('.pg-invite-line'),
      field: box(field),
      fieldValue: field?.value ?? '',
      fieldSize: field ? Number.parseFloat(getComputedStyle(field).fontSize) : 0,
      fieldFocused: document.activeElement === field,
      label: text('.pg-invite-label'),
      go: box(go),
      goText: go?.textContent ?? '',
      goDisabled: go?.disabled ?? true,
      own: box(document.querySelector('.pg-invite-own')),
      links: [...document.querySelectorAll('.pg-invite-links button')]
        .filter((b) => b.offsetParent !== null)
        .map((b) => b.textContent),
      status: text('.pg-invite-status'),
      play: box(document.querySelector('.pg-card.plain .menu-btn.pg-play')),
      playGlow: document.querySelector('.pg-card.plain')?.classList.contains('glow') ?? false,
      search: window.location.search,
      docScroll: document.documentElement.scrollWidth,
      width: window.innerWidth,
      height: window.innerHeight,
    };
  });
}

async function inviteRun(page, fixture, size) {
  const phone = size.viewport.hasTouch;
  const short = size.viewport.height <= 560;
  const narrow = size.viewport.width <= 560;
  for (const invite of Object.keys(INVITES)) {
    const at = `${size.id} ${invite}`;
    await openInvited(page, fixture, invite);
    const m = await measureInvite(page);
    await shot(page, `invite-${size.id}-${invite}`);
    const asked = fixture.joins[fixture.joins.length - 1];
    check(asked?.join === CODE, `${at}: the landing's request carried the code in its body`);
    check(!asked.address.includes(CODE), `${at}: and never in its address`);
    check(!m.search.includes(CODE), `${at}: the address bar no longer holds the code`);
    check(m.band !== null && m.beforeHero, `${at}: the band stands before the hero`);
    check(m.docScroll <= m.width, `${at}: no horizontal scroll (${m.docScroll} in ${m.width})`);
    check(m.play !== null, `${at}: the Play now card's gold button is still there`);
    if (invite === 'invited' || invite === 'limited') {
      check(
        m.label === 'Your name (also your name on the ladder)',
        `${at}: the name field is labelled`,
      );
      check(m.fieldValue === 'Wanderer0421', `${at}: the field offers ${m.fieldValue}`);
      check(m.fieldSize >= 16, `${at}: the field at ${m.fieldSize} px`);
      check(!m.fieldFocused, `${at}: the field does not take the focus by itself`);
      check(m.goText === 'Join the lobby', `${at}: Join reads ${m.goText}`);
      check(
        m.go.top >= 0 && m.go.bottom <= m.height,
        `${at}: Join inside the first screen (${Math.round(m.go.bottom)} of ${m.height})`,
      );
      if (phone) {
        check(
          m.title.bottom <= m.height && m.field.bottom <= m.height,
          `${at}: the title and the field inside the first screen`,
        );
        check(
          m.field.h >= 32 && m.go.h >= 32,
          `${at}: the field and Join are ${Math.round(m.field.h)} and ${Math.round(m.go.h)} px`,
        );
      }
      if (narrow) check(m.go.top >= m.field.bottom - 1, `${at}: Join stands under the field`);
      else check(m.go.top < m.field.bottom, `${at}: the field and Join share a row`);
      check(
        m.links.join(',') === 'Sign in,Create an account,Not now',
        `${at}: the quiet links (${m.links.join(', ')})`,
      );
    }
    if (short) check(m.band.h <= 175, `${at}: the band is ${Math.round(m.band.h)} px tall`);
    if (invite === 'invited') {
      check(m.titleText === 'Marrow invited you to a private lobby', `${at}: ${m.titleText}`);
      check(
        m.lineText === '3 of 10 in the lobby. A 5v5 among friends, never rated.',
        `${at}: ${m.lineText}`,
      );
      check(!m.goDisabled, `${at}: Join is enabled`);
      check(m.bandGlow && !m.playGlow, `${at}: the band breathes the gold, Play now does not`);
    }
    if (invite === 'limited') {
      check(m.titleText === 'You are invited to a private lobby', `${at}: ${m.titleText}`);
      check(
        m.lineText ===
          'Too many wrong lobby codes from this connection. Try again in a few minutes.',
        `${at}: ${m.lineText}`,
      );
      check(m.goDisabled, `${at}: Join is disabled`);
      check(!m.bandGlow && m.playGlow, `${at}: the gold halo is back on Play now`);
    }
    if (invite === 'closed' || invite === 'full') {
      const title = invite === 'closed' ? 'This lobby has closed' : 'This lobby is full';
      check(m.titleText === title, `${at}: ${m.titleText}`);
      check(m.field === null && m.go === null, `${at}: no field and no Join`);
      check(m.own !== null, `${at}: Open a lobby is offered`);
      check(m.links.join(',') === 'Not now', `${at}: Not now alone (${m.links.join(', ')})`);
      check(!m.bandGlow && m.playGlow, `${at}: the gold halo is back on Play now`);
    }
  }

  // A taken name is refused in the server's words, and nothing joins.
  await openInvited(page, fixture, 'invited');
  const type = async (name) => {
    await page.evaluate(() => {
      const field = document.querySelector('.pg-invite-field');
      field.focus();
      field.select();
    });
    await page.keyboard.type(name);
  };
  await type('Quillon');
  await page.click('.pg-invite-go');
  await waitFor(
    page,
    (t) => document.querySelector('.pg-invite-status')?.textContent === t,
    'the refusal',
    5000,
    TAKEN,
  );
  check(
    fixture.renames.join(',') === 'Quillon' && !fixture.log.includes('guest'),
    `${size.id} invited: a taken name is refused and nothing joins`,
  );
  // A good one is saved before the Guest is asked for.
  await type('Brindle2');
  await page.click('.pg-invite-go');
  await waitFor(page, () => document.querySelector('.pg-invite') === null, 'the landing left');
  await sleep(500);
  const named = fixture.log.indexOf('name');
  check(
    named >= 0 && named < fixture.log.indexOf('guest'),
    `${size.id} invited: the rename before the Guest (${fixture.log.join(', ')})`,
  );

  // Not now puts the band away and gives the gold back.
  await openInvited(page, fixture, 'invited');
  await page.evaluate(() => {
    const links = [...document.querySelectorAll('.pg-invite-links button')];
    links.find((b) => b.textContent === 'Not now')?.click();
  });
  await sleep(200);
  const gone = await measureInvite(page);
  check(gone.band === null && gone.playGlow, `${size.id} invited: Not now puts the band away`);
  fixture.invite = null;
}

async function realRun(browser, size) {
  // A fresh browser: a handed-out name, renamed, and kept over a reload.
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewport(size.viewport);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await openLanding(page);
  let m = await measure(page);
  checkLayout(m, size, 'a fresh browser');
  check(/^Wanderer \d{4}$/.test(m.nameText), `${size.id}: a fresh browser reads ${m.nameText}`);
  await shot(page, `own-real-${size.id}-fresh`);
  const chosen = `Own${size.id.slice(0, 1)}${Date.now().toString(36).slice(-7)}`;
  await page.click('.own-change');
  await waitFor(page, () => !document.querySelector('.own-edit').hidden, 'the name form');
  await selectAndType(page, chosen);
  await waitFor(
    page,
    () => document.querySelector('.own-status').textContent === 'Saved.',
    'Saved.',
  );
  await openLanding(page);
  m = await measure(page);
  check(m.nameText === chosen, `${size.id}: the reload keeps ${chosen}`);
  check(/saved for this browser/.test(m.sub), `${size.id}: ${m.sub}`);
  await ctx.close();

  // The seeded Guest.
  const seeded = await browser.createBrowserContext();
  const p2 = await seeded.newPage();
  p2.on('pageerror', (e) => errors.push(String(e)));
  await p2.setViewport(size.viewport);
  await p2.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await p2.setCookie({ name: 'loc_guest', value: 'seed-home-guest', url: URL });
  await openLanding(p2);
  m = await measure(p2);
  checkLayout(m, size, 'the seeded Guest');
  check(m.nameText === 'Thornwick', `${size.id}: the seeded Guest reads Thornwick`);
  check(m.tiles[0]?.line === '340 points', `${size.id}: 340 points`);
  check(m.tiles[1]?.value === '4', `${size.id}: Level 4`);
  check(m.tiles[2]?.value === '9', `${size.id}: best 9`);
  await shot(p2, `own-real-${size.id}-thornwick`);
  check(
    errors.length === 0,
    `${size.id}: no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`,
  );
  await seeded.close();
}

const run = async () => {
  const args = [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--mute-audio',
  ];
  if (process.getuid?.() === 0) args.push('--no-sandbox');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args });
  try {
    for (const size of SIZES) {
      console.log(`--- ${size.id} ${size.viewport.width}x${size.viewport.height}`);
      if (FIXTURE) await fixtureRun(browser, size);
      else await realRun(browser, size);
    }
  } finally {
    await browser.close();
  }
  console.log(`e2e_landing: all checks passed (${FIXTURE ? 'fixtures' : 'real stack'})`);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
