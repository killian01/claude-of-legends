// Bots on the account, server side (ADR 0013): create, edit, version,
// deposit, delete, every one gated on ownership and on the playbook
// validator, the one door untrusted data goes through. Every bot starts
// as the Laner plus the coach play, on the champion its owner chose, and
// every applied playbook change is a version the owner can return to.
// Identity arrives already resolved: the routes in main.ts hand these
// functions the account behind the session cookie (ADR 0006), never a raw
// request.

import { randomBytes } from 'node:crypto';
import { CHAMPIONS } from '../src/sim/content/champions';
import { NEW_BOT_PLAYBOOK } from '../src/sim/content/playbooks/new_bot';
import { SIGILS } from '../src/sim/content/sigils';
import { clampSkin } from '../src/sim/content/skins';
import type { PlaybookDef } from '../src/sim/playbook/types';
import { validatePlaybook } from '../src/sim/playbook/validate';
import type { BotRow, BotStore } from './bot_store';
import { findBlockedWord } from './word_filter';

// Bots are unlimited in spirit; this is a hard abuse rail, not a product
// quota, like the Forge's draft cap.
export const BOT_CAP = 100;
// Deposited bots per account, the Arena's CPU bound (docs/design/bots.md).
export const DEPOSIT_CAP = 3;
// Bounds the stored JSON; a playbook inside the validator's structural
// limits sits far under this.
export const PLAYBOOK_JSON_MAX = 32_000;
export const BOT_NAME_MAX = 24;
export const BOT_ID_PATTERN = /^bot_[a-f0-9]{16}$/;

export interface BotDeps {
  store: BotStore;
  botCap?: number;
  depositCap?: number;
  now?: () => number;
  // Injectable for tests; production draws from node:crypto.
  newId?: () => string;
}

export type BotOutcome<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// A bot name is a display string, unique within its account on a
// case-folded reading, and clean.
function checkName(
  deps: BotDeps,
  accountId: number,
  raw: unknown,
  exceptId: string | null,
): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'a bot needs a name' };
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length === 0 || name.length > BOT_NAME_MAX) {
    return { ok: false, error: `a bot name is 1 to ${BOT_NAME_MAX} characters` };
  }
  if (/[\p{C}]/u.test(name)) return { ok: false, error: 'a bot name is plain text' };
  const blocked = findBlockedWord([name]);
  if (blocked !== null) {
    return { ok: false, error: `pick a different name: '${blocked}' cannot be on a card` };
  }
  const folded = name.toLowerCase();
  for (const other of deps.store.listByAccount(accountId)) {
    if (other.id !== exceptId && other.name.toLowerCase() === folded) {
      return { ok: false, error: 'you already have a bot with that name' };
    }
  }
  return { ok: true, name };
}

function checkSigils(
  raw: unknown,
): { ok: true; sigils: [string, string] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length !== 2)
    return { ok: false, error: 'a bot picks two sigils' };
  const [a, b] = raw as unknown[];
  if (typeof a !== 'string' || typeof b !== 'string' || !SIGILS[a] || !SIGILS[b] || a === b) {
    return { ok: false, error: 'a bot picks two different sigils from the pool' };
  }
  return { ok: true, sigils: [a, b] };
}

function checkPlaybook(
  raw: unknown,
): { ok: true; def: PlaybookDef } | { ok: false; error: string } {
  if (JSON.stringify(raw).length > PLAYBOOK_JSON_MAX) {
    return { ok: false, error: 'this playbook is too large to store' };
  }
  const v = validatePlaybook(raw);
  if (!v.ok) return { ok: false, error: `playbook rejected: ${v.errors.slice(0, 5).join('; ')}` };
  return { ok: true, def: v.def };
}

function newBotId(deps: BotDeps): string {
  return deps.newId ? deps.newId() : `bot_${randomBytes(8).toString('hex')}`;
}

// The owner's bot, or the reason there is none to act on.
function owned(deps: BotDeps, accountId: number, id: unknown): BotOutcome<{ bot: BotRow }> {
  if (typeof id !== 'string' || !BOT_ID_PATTERN.test(id)) {
    return { ok: false, error: 'malformed bot id' };
  }
  const bot = deps.store.getBot(id);
  if (!bot || bot.accountId !== accountId)
    return { ok: false, error: 'no such bot on this account' };
  return { ok: true, bot };
}

export function listBots(deps: BotDeps, accountId: number): BotOutcome<{ bots: BotRow[] }> {
  return { ok: true, bots: deps.store.listByAccount(accountId) };
}

// A new bot: a name, a roster champion, two sigils, a skin, and the default
// playbook as version 1.
export function createBot(
  deps: BotDeps,
  accountId: number,
  input: unknown,
): BotOutcome<{ bot: BotRow }> {
  if (!isRecord(input)) return { ok: false, error: 'malformed request' };
  const name = checkName(deps, accountId, input.name, null);
  if (!name.ok) return name;
  const championId = input.championId;
  if (typeof championId !== 'string' || !CHAMPIONS[championId]) {
    return { ok: false, error: 'a bot plays a roster champion' };
  }
  const sigils = checkSigils(input.sigils ?? ['riftstep', 'mend']);
  if (!sigils.ok) return sigils;
  const cap = deps.botCap ?? BOT_CAP;
  if (deps.store.countByAccount(accountId) >= cap) {
    return { ok: false, error: `bot cap reached (${cap}); delete one first` };
  }
  const at = (deps.now ?? Date.now)();
  const bot: BotRow = {
    id: newBotId(deps),
    accountId,
    name: name.name,
    championId,
    sigils: sigils.sigils,
    skin: clampSkin(championId, input.skin),
    playbook: NEW_BOT_PLAYBOOK,
    version: 1,
    deposited: false,
    createdAt: at,
    updatedAt: at,
  };
  deps.store.insertBot(bot);
  deps.store.addVersion({ botId: bot.id, version: 1, playbook: bot.playbook, author: 'owner', at });
  return { ok: true, bot };
}

// Edits name, sigils, skin, and the playbook. A changed playbook is a new
// version; an unchanged one is not, so saving the form twice costs nothing.
export function saveBot(
  deps: BotDeps,
  accountId: number,
  input: unknown,
): BotOutcome<{ bot: BotRow }> {
  if (!isRecord(input)) return { ok: false, error: 'malformed request' };
  const found = owned(deps, accountId, input.id);
  if (!found.ok) return found;
  const bot = found.bot;
  let name = bot.name;
  if (input.name !== undefined) {
    const checked = checkName(deps, accountId, input.name, bot.id);
    if (!checked.ok) return checked;
    name = checked.name;
  }
  let sigils = bot.sigils;
  if (input.sigils !== undefined) {
    const checked = checkSigils(input.sigils);
    if (!checked.ok) return checked;
    sigils = checked.sigils;
  }
  const skin = input.skin !== undefined ? clampSkin(bot.championId, input.skin) : bot.skin;
  let playbook = bot.playbook;
  let version = bot.version;
  const at = (deps.now ?? Date.now)();
  if (input.playbook !== undefined) {
    const checked = checkPlaybook(input.playbook);
    if (!checked.ok) return checked;
    if (JSON.stringify(checked.def) !== JSON.stringify(bot.playbook)) {
      playbook = checked.def;
      version = bot.version + 1;
      deps.store.addVersion({ botId: bot.id, version, playbook, author: 'owner', at });
    }
  }
  deps.store.updateBot(bot.id, { name, sigils, skin, playbook, version, updatedAt: at });
  return { ok: true, bot: { ...bot, name, sigils, skin, playbook, version, updatedAt: at } };
}

export function deleteBot(deps: BotDeps, accountId: number, id: unknown): BotOutcome {
  const found = owned(deps, accountId, id);
  if (!found.ok) return found;
  deps.store.deleteBot(found.bot.id);
  return { ok: true };
}

// Into or out of the Arena's pool, under the per-account cap.
export function setDeposited(
  deps: BotDeps,
  accountId: number,
  id: unknown,
  on: unknown,
): BotOutcome<{ bot: BotRow }> {
  if (typeof on !== 'boolean') return { ok: false, error: 'malformed request' };
  const found = owned(deps, accountId, id);
  if (!found.ok) return found;
  const bot = found.bot;
  if (on && !bot.deposited) {
    const cap = deps.depositCap ?? DEPOSIT_CAP;
    if (deps.store.depositedCount(accountId) >= cap) {
      return { ok: false, error: `at most ${cap} bots in the Arena at once; withdraw one first` };
    }
  }
  deps.store.setDeposited(bot.id, on);
  return { ok: true, bot: { ...bot, deposited: on } };
}

export function listVersions(
  deps: BotDeps,
  accountId: number,
  id: unknown,
): BotOutcome<{ versions: { version: number; author: string; at: number }[] }> {
  const found = owned(deps, accountId, id);
  if (!found.ok) return found;
  return { ok: true, versions: deps.store.listVersions(found.bot.id) };
}

// Returning to an earlier playbook is itself a new version, so the history
// only ever grows and nothing is lost by changing one's mind twice.
export function revertBot(
  deps: BotDeps,
  accountId: number,
  id: unknown,
  version: unknown,
): BotOutcome<{ bot: BotRow }> {
  const found = owned(deps, accountId, id);
  if (!found.ok) return found;
  const bot = found.bot;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return { ok: false, error: 'malformed request' };
  }
  const target = deps.store.getVersion(bot.id, version);
  if (!target) return { ok: false, error: 'no such version' };
  // A stored version validated when it was stored; it validates again in
  // case the engine tightened a bound since.
  const checked = checkPlaybook(target.playbook);
  if (!checked.ok) return checked;
  const at = (deps.now ?? Date.now)();
  const next = bot.version + 1;
  deps.store.addVersion({
    botId: bot.id,
    version: next,
    playbook: checked.def,
    author: `revert:${version}`,
    at,
  });
  deps.store.updateBot(bot.id, {
    name: bot.name,
    sigils: bot.sigils,
    skin: bot.skin,
    playbook: checked.def,
    version: next,
    updatedAt: at,
  });
  return { ok: true, bot: { ...bot, playbook: checked.def, version: next, updatedAt: at } };
}
