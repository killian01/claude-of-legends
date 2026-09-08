// Dev seeding for a server with people on it: eight accounts placed by
// hand with a match log behind them, six ranked bots with Arena play in
// their Records, and seven sealed forged champions with likes. A fresh
// state directory shows every surface's empty state (the home's panels,
// the ladder page, the Arena pool, the gallery) and nothing else, which is
// the wrong thing to look at while working on any of them. Run via
// scripts/seed_home.mjs with the server down, against the directory the
// stack will use (docs/dev-local.md); never in production.
//
// Everything is written straight into the stores through their own
// classes, so the rows are shaped exactly like ones the server writes.
// Nothing goes through generation: the forged champions are the roster's
// twins under new names, with placeholder splashes.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AccountRegistry } from '../server/accounts';
import { BotStore } from '../server/bot_store';
import { ForgeStore } from '../server/forge_store';
import { placeholderPng } from '../server/generation/placeholder';
import type { MatchPlayerRecord, MatchRecord } from '../server/records';
import { appendJsonl } from '../server/store';
import type { NewRecordEntry } from '../src/net/record';
import { LANER_PLAYBOOK } from '../src/sim/content/playbooks/laner';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import type { ScoreRow, TeamId } from '../src/sim/types';
// The twins are a test fixture, but they are also the only ten forged
// definitions known to pass the validator without a provider in the loop.
import { FORGED_TWINS } from '../tests/forged_twins';

// The stack's default state directory (.claude/skills/dev-server/stack.sh),
// never data/: the seed is fiction and the ordinary local state is not.
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), '.dev/data');
export const SEED_PASSWORD = 'seed-home-shots';
const HOUR = 3600_000;
const now = Date.now();

const NAMES = ['Marrow', 'Quillon', 'Ashvale', 'Tessaly', 'Bramble', 'Orrin', 'Vexley', 'Halloway'];
const CHAMPS = [
  'torv',
  'fenn',
  'ashvyn',
  'sylra',
  'korrath',
  'dain',
  'elowen',
  'vesk',
  'maera',
  'rhoka',
];

// --- accounts and the hand ladder ---------------------------------------

mkdirSync(DATA_DIR, { recursive: true });
const registry = new AccountRegistry(path.join(DATA_DIR, 'accounts.json'));
if (registry.authenticate(NAMES[0]!, SEED_PASSWORD)) {
  console.log(`already seeded: ${DATA_DIR} has ${NAMES[0]}; delete the directory to start over`);
  process.exit(0);
}
const ids = new Map<string, number>();
for (const name of NAMES) {
  const r = registry.register(
    name,
    SEED_PASSWORD,
    `${name.toLowerCase()}@example.com`,
    now - 30 * 24 * HOUR,
  );
  if (!r.ok) throw new Error(`seed: cannot register ${name} (${r.error})`);
  ids.set(name, r.value.id);
}
const idOf = (name: string): number => {
  const id = ids.get(name);
  if (id === undefined) throw new Error(`seed: no account ${name}`);
  return id;
};

const favorite: Record<string, string> = {
  Marrow: 'vesk',
  Quillon: 'sylra',
  Ashvale: 'fenn',
  Tessaly: 'maera',
  Bramble: 'torv',
  Orrin: 'ashvyn',
  Vexley: 'dain',
  Halloway: 'elowen',
};
// Rated matches by hand per account, and how many of them were won. The
// last two are still placing (under MIN_RATED_GAMES).
const PLAN: readonly [string, number, number][] = [
  ['Marrow', 14, 11],
  ['Quillon', 12, 8],
  ['Ashvale', 9, 6],
  ['Tessaly', 8, 5],
  ['Bramble', 10, 5],
  ['Orrin', 6, 3],
  ['Vexley', 4, 1],
  ['Halloway', 2, 1],
];
const matchesFile = path.join(DATA_DIR, 'matches.jsonl');
let seq = 0;
for (const [name, games, wins] of PLAN) {
  const id = idOf(name);
  // One other person on the far side, so the record reads as rated; only
  // the near seat's rating moves here, the other's plan covers its own.
  const otherName = NAMES[(NAMES.indexOf(name) + 1) % NAMES.length]!;
  const otherId = idOf(otherName);
  for (let g = 0; g < games; g++) {
    const won = g < wins;
    const delta = won ? 12 : -10;
    registry.applyRating(id, delta);
    seq++;
    const at = now - (games - g) * 5 * HOUR - seq * 60_000;
    const champ = g % 3 === 0 ? CHAMPS[(g + id) % CHAMPS.length]! : favorite[name]!;
    const players: MatchPlayerRecord[] = [];
    for (let seat = 0; seat < 10; seat++) {
      const team: TeamId = seat < 5 ? 0 : 1;
      const mine = seat === 0;
      const theirs = seat === 5;
      players.push({
        accountId: mine ? id : theirs ? otherId : null,
        name: mine ? name : theirs ? otherName : `House ${seat}`,
        championId: mine ? champ : CHAMPS[(seat * 3 + g) % CHAMPS.length]!,
        team,
        level: 12 + (seat % 5),
        kills: mine ? 4 + (g % 5) : 2 + (seat % 4),
        deaths: mine ? 1 + (g % 3) : 2 + (seat % 3),
        assists: mine ? 6 + (g % 6) : 3 + (seat % 5),
        cs: 90 + seat * 7 + g,
        ...(mine ? { ratingDelta: delta } : {}),
      });
    }
    const rec: MatchRecord = {
      at,
      durationS: 1100 + (g % 7) * 60,
      winner: won ? 0 : 1,
      rated: true,
      players,
    };
    appendJsonl(matchesFile, rec);
  }
}

// --- ranked bots with Arena play -------------------------------------------

const bots = new BotStore(path.join(DATA_DIR, 'bots.sqlite3'));
// Owner, bot name, its champion (a starter, as a new account could field),
// Arena matches, wins. The last one is still placing.
const BOTS: readonly [string, string, string, number, number][] = [
  ['Marrow', 'Ironquill', 'torv', 9, 7],
  ['Quillon', 'Lanternjaw', 'fenn', 8, 5],
  ['Ashvale', 'Sootwing', 'ashvyn', 7, 4],
  ['Tessaly', 'Bramblecoat', 'sylra', 6, 2],
  ['Orrin', 'Wickfast', 'fenn', 5, 3],
  ['Bramble', 'Duskhollow', 'torv', 2, 1],
];
for (const [owner, name, champ, games, wins] of BOTS) {
  const accountId = idOf(owner);
  // The store's id shape (server/bots.ts BOT_ID_PATTERN): sixteen hex
  // digits, drawn from the name so a re-seed elsewhere gives the same ids.
  const botId = `bot_${createHash('sha1').update(name).digest('hex').slice(0, 16)}`;
  bots.insertBot({
    id: botId,
    accountId,
    name,
    championId: champ,
    sigils: ['riftstep', 'mend'],
    skin: 0,
    playbook: LANER_PLAYBOOK,
    version: 1,
    deposited: true,
    autoApply: false,
    openPlaybook: true,
    createdAt: now - 20 * 24 * HOUR,
    updatedAt: now - 2 * 24 * HOUR,
  });
  for (let g = 0; g < games; g++) {
    const won = g < wins;
    const delta = won ? 11 : -9;
    bots.applyBotRating(botId, accountId, 'arena', delta);
    const at = now - (games - g) * HOUR;
    // Ten seats, the bot first on its side, so the Match sheet reads whole.
    const score: ScoreRow[] = [];
    for (let seat = 0; seat < 10; seat++) {
      const mine = seat === 0;
      const championId = mine ? champ : CHAMPS[(seat * 3 + g) % CHAMPS.length]!;
      score.push({
        unitId: seat + 1,
        name: championId,
        championId,
        player: mine ? name : `House ${seat}`,
        team: seat < 5 ? 0 : 1,
        level: 13 + (seat % 4),
        kills: mine ? 3 + (g % 4) : 2 + (seat % 3),
        deaths: mine ? 2 + (g % 2) : 2 + (seat % 3),
        assists: mine ? 5 + (g % 5) : 3 + (seat % 4),
        cs: 100 + seat * 5 + g,
        items: [],
      });
    }
    const entry: NewRecordEntry = {
      kind: 'arena',
      at,
      seed: 1000 + g,
      team: 0,
      winner: won ? 0 : 1,
      ticks: 12000,
      version: 1,
      edited: false,
      botUnitId: 1,
      score,
      report: { ticks: 12000, units: [] },
      replayId: null,
      ratingDelta: delta,
    };
    bots.addRecord({ botId, accountId, kind: 'arena', at, won, replayId: null, entry });
  }
}
bots.close();

// --- sealed forged champions ---------------------------------------------

const forge = new ForgeStore(path.join(DATA_DIR, 'forge.sqlite3'));
// Creator, name, title, which twin's kit, likes.
const FORGED: readonly [string, string, string, number, number][] = [
  ['Marrow', 'Ilsabet', 'Warden of Ash', 0, 7],
  ['Tessaly', 'Corvane', 'the Quiet Blade', 3, 4],
  ['Quillon', 'Oderic', 'Lanternbearer', 8, 2],
  ['Ashvale', 'Maelis', 'the Grey Pilgrim', 4, 5],
  ['Orrin', 'Brannoc', 'Ironbound', 0, 1],
  ['Vexley', 'Seraphel', 'Tidecaller', 7, 0],
  ['Halloway', 'Wrenna', 'of the Hollow', 6, 3],
];
const assetsDir = path.join(DATA_DIR, 'assets');
FORGED.forEach(([creator, name, title, twin, likes], k) => {
  const id = `forged_${name.toLowerCase()}`;
  const accountId = idOf(creator);
  const def: ForgedChampionDef = { ...FORGED_TWINS[twin]!, id, name, title, creator };
  const at = now - (FORGED.length - k) * 7 * HOUR;
  forge.saveForged({
    id,
    accountId,
    def,
    status: 'finalized',
    createdAt: at - HOUR,
    updatedAt: at,
  });
  // A placeholder splash on most of them; every third keeps the monogram,
  // which is what a champion sealed without art looks like.
  if (k % 3 !== 2) {
    const rel = `forged/${id}/splash.png`;
    mkdirSync(path.join(assetsDir, 'forged', id), { recursive: true });
    writeFileSync(path.join(assetsDir, rel), placeholderPng(`${id}-splash`));
    forge.setForgedFinalized(id, { splash: rel }, at);
  }
  let liked = 0;
  for (const other of NAMES) {
    if (liked >= likes) break;
    if (other === creator) continue;
    forge.setLike(idOf(other), id, true, at + liked * 1000);
    liked++;
  }
});
forge.close();

console.log(
  `seeded ${NAMES.length} accounts, ${BOTS.length} ranked bots, ${FORGED.length} forged champions into ${DATA_DIR}`,
);
console.log(`sign in as any of ${NAMES.join(', ')} with the password "${SEED_PASSWORD}"`);
