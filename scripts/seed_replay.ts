// Dev seeding for the replay e2e: runs a short scripted match headless
// through the REAL Match code, saves its replay under data/replays/, and
// writes a matching match record and account so the career panel shows a
// Watch button. Sign in as 'seer' with the password below to see it. Run
// via scripts/seed_replay.mjs; never in production.

import path from 'node:path';
import { AccountRegistry } from '../server/accounts';
import { fillWithBots } from '../server/bot_fill';
import { Match } from '../server/match';
import { buildMatchRecord } from '../server/records';
import { appendJsonl, saveJsonAtomic } from '../server/store';

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data');

const picks = fillWithBots([
  { clientId: 1, name: 'seer', team: 0, championId: 'fenn', sigils: ['riftstep', 'mend'] },
]);
const match = new Match(424242, picks);
const seat = match.players.get(1);
if (!seat) throw new Error('seed: no human seat');

// Ninety seconds of scripted match: walk the lane, level and cast, shop.
const TICKS = 1800;
for (let k = 0; k < TICKS; k++) {
  if (k === 20) match.handleCommand(1, { t: 'move', x: 45, z: 45 });
  if (k === 100) match.handleCommand(1, { t: 'skill', key: 'Q' });
  if (k === 140) match.handleCommand(1, { t: 'cast', key: 'Q', x: 50, z: 50 });
  if (k === 400) match.handleCommand(1, { t: 'attack_move', x: 60, z: 60 });
  if (k === 900) match.handleCommand(1, { t: 'recall' });
  if (k === 1200) match.handleCommand(1, { t: 'buy', itemId: 'long_blade' });
  if (k === 1300) match.handleCommand(1, { t: 'attack_move', x: 70, z: 70 });
  match.tick();
}

saveJsonAtomic(path.join(DATA_DIR, 'replays', '1.json'), {
  version: 1,
  seed: match.seed,
  picks: match.replayPicks,
  events: match.replayEvents,
  ticks: match.sim.tickCount,
});

const score = match.buildScore();
if (score.t !== 'score') throw new Error('seed: no score');
// The account first, so the match record can point at the id it really
// got. Through the real registry, so the seeded account is hashed and
// shaped exactly like a registered one rather than hand-written next to it.
const SEED_PASSWORD = 'seed-replay-e2e';
const registry = new AccountRegistry(path.join(DATA_DIR, 'accounts.json'));
const created = registry.register('seer', SEED_PASSWORD, 'seer@example.com', Date.now());
// Re-seeding an existing data dir: the account is already there.
const seer = created.ok ? created.value : registry.authenticate('seer', SEED_PASSWORD);
if (!seer) throw new Error('seed: cannot make or reach the seer account');

const rec = buildMatchRecord(
  score.rows,
  new Map([[seat.unitId, seer.id]]),
  0,
  match.sim.time,
  Date.now(),
  undefined,
  1,
);
appendJsonl(path.join(DATA_DIR, 'matches.jsonl'), rec);
console.log(`seeded replay 1 (${match.replayEvents.length} events, ${TICKS} ticks)`);
console.log(`sign in as "seer" / "${SEED_PASSWORD}" to see it on the career panel`);
