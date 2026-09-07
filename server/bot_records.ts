// The Record (CONTEXT.md): the matches a bot played, newest first, each
// with its kind, its result, the bot's line, its plays, its deaths and
// its replay. Sparring and series entries arrive from the browser, where
// the Academy played them: unrated, so the server keeps what it is told
// inside bounds and never re-simulates. Arena and live entries are written
// by the server at match end. Kept in the bots store (server/bot_store.ts),
// capped per bot, the oldest leaving first; a replay a living entry
// references is held out of the global prune (server/store.ts).

import { FAST_MATCH_MAX_TICKS } from '../src/fast_match';
import type { NewRecordEntry, RecordEntry, RecordKind, RecordRow } from '../src/net/record';
import { REPLAY_VERSION, type ReplayPick, type ReplayRecord } from '../src/net/replay';
import { CHAMPIONS } from '../src/sim/content/champions';
import { contentFingerprint } from '../src/sim/content/fingerprint';
import { ITEMS } from '../src/sim/content/items';
import { SIGILS } from '../src/sim/content/sigils';
import { type DeathScene, SCENE_CAP, type SceneUnit } from '../src/sim/playbook/death_context';
import type { DeathNote, PlayReport, UnitPlayReport } from '../src/sim/playbook/report';
import { validatePlaybook } from '../src/sim/playbook/validate';
import { INVENTORY_SLOTS } from '../src/sim/sim';
import type { ScoreRow, TeamId } from '../src/sim/types';
import type { BotStore } from './bot_store';

// Entries per bot; past it the oldest leave with the replays only they held.
export const RECORD_CAP = 50;
// An upload: the ten rows, the report, and a bot-only replay record (a few
// kilobytes: seed and picks, no events).
export const RECORD_UPLOAD_MAX = 256 * 1024;

export type { NewRecordEntry, RecordEntry, RecordKind, RecordRow } from '../src/net/record';

const KINDS: readonly RecordKind[] = ['sparring', 'series', 'arena', 'live'];

export function wonBy(e: { team: TeamId; winner: TeamId | null }): boolean | null {
  return e.winner === null ? null : e.winner === e.team;
}

export function rowOf(e: RecordEntry): RecordRow {
  const { score, report: _report, botId: _botId, ...rest } = e;
  return { ...rest, line: score.find((r) => r.unitId === e.botUnitId) ?? null };
}

// One more entry, then the cap: returns the new id and the replay ids the
// dropped entries referenced (the caller prunes the files it no longer
// holds).
export function addEntry(
  store: BotStore,
  botId: string,
  accountId: number,
  entry: NewRecordEntry,
): { id: number; dropped: number[] } {
  const id = store.addRecord({
    botId,
    accountId,
    kind: entry.kind,
    at: entry.at,
    won: wonBy(entry),
    replayId: entry.replayId,
    entry,
  });
  const dropped = store.pruneRecords(botId, RECORD_CAP);
  return { id, dropped };
}

export function listEntries(store: BotStore, botId: string): RecordRow[] {
  return store
    .listRecords(botId)
    .map(({ id, entry }) => rowOf({ ...(entry as NewRecordEntry), id, botId }));
}

export function getEntry(store: BotStore, botId: string, id: number): RecordEntry | null {
  const r = store.getRecord(id);
  if (!r || r.botId !== botId) return null;
  return { ...(r.entry as NewRecordEntry), id: r.id, botId };
}

// --- the upload from the Academy -----------------------------------------

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function fail<T>(error: string): Parsed<T> {
  return { ok: false, error };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function int(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;
}

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length >= 1 && v.length <= max ? v : null;
}

function team(v: unknown): TeamId | null {
  return v === 0 || v === 1 ? v : null;
}

function scoreRow(raw: unknown): ScoreRow | null {
  if (!isRecord(raw)) return null;
  const unitId = int(raw.unitId, 0, 100_000);
  const name = str(raw.name, 32);
  const championId = str(raw.championId, 32);
  const t = team(raw.team);
  const level = int(raw.level, 1, 18);
  const kills = int(raw.kills, 0, 999);
  const deaths = int(raw.deaths, 0, 999);
  const assists = int(raw.assists, 0, 999);
  const cs = int(raw.cs, 0, 9_999);
  if (
    unitId === null ||
    name === null ||
    championId === null ||
    CHAMPIONS[championId] === undefined ||
    t === null ||
    level === null ||
    kills === null ||
    deaths === null ||
    assists === null ||
    cs === null
  ) {
    return null;
  }
  const player = raw.player === null || raw.player === undefined ? null : str(raw.player, 32);
  if (player === null && raw.player !== null && raw.player !== undefined) return null;
  if (!Array.isArray(raw.items) || raw.items.length > INVENTORY_SLOTS) return null;
  const items: string[] = [];
  for (const id of raw.items) {
    if (typeof id !== 'string' || ITEMS[id] === undefined) return null;
    items.push(id);
  }
  return { unitId, name, championId, player, team: t, level, kills, deaths, assists, cs, items };
}

const PLAY_ID_MAX = 48;
const PLAYS_MAX = 64;
const DEATHS_MAX = 200;

const SCENE_KINDS = ['champion', 'tower', 'sanctum'] as const;

function coord(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 200 ? v : null;
}

// The Death card's scene, bounded: a dozen units at most, coordinates on
// the map, health as a fraction.
function deathSceneOf(raw: unknown): DeathScene | null {
  if (!isRecord(raw)) return null;
  const x = coord(raw.x);
  const z = coord(raw.z);
  const allies = int(raw.allies, 0, 10);
  const enemies = int(raw.enemies, 0, 10);
  if (x === null || z === null || allies === null || enemies === null) return null;
  if (typeof raw.underTower !== 'boolean') return null;
  if (!Array.isArray(raw.around) || raw.around.length > SCENE_CAP) return null;
  const around: SceneUnit[] = [];
  for (const u of raw.around) {
    if (!isRecord(u)) return null;
    const id = int(u.id, 0, 100_000);
    const ux = coord(u.x);
    const uz = coord(u.z);
    const t = team(u.team);
    const hp = typeof u.hp === 'number' && u.hp >= 0 && u.hp <= 1 ? u.hp : null;
    const kind = (SCENE_KINDS as readonly string[]).includes(String(u.kind))
      ? (u.kind as SceneUnit['kind'])
      : null;
    if (id === null || ux === null || uz === null || t === null || hp === null || kind === null) {
      return null;
    }
    around.push({ id, team: t, kind, x: ux, z: uz, hp });
  }
  return { x, z, underTower: raw.underTower, allies, enemies, around };
}

function unitReport(raw: unknown): UnitPlayReport | null {
  if (!isRecord(raw)) return null;
  const unitId = int(raw.unitId, 0, 100_000);
  const deaths = int(raw.deaths, 0, 999);
  if (unitId === null || deaths === null || !isRecord(raw.plays)) return null;
  const plays: UnitPlayReport['plays'] = {};
  const keys = Object.keys(raw.plays);
  if (keys.length > PLAYS_MAX) return null;
  for (const key of keys) {
    if (key.length === 0 || key.length > PLAY_ID_MAX) return null;
    const s = raw.plays[key];
    if (!isRecord(s)) return null;
    const ticks = int(s.ticks, 0, FAST_MATCH_MAX_TICKS);
    const d = int(s.deaths, 0, 999);
    if (ticks === null || d === null) return null;
    plays[key] = { ticks, deaths: d };
  }
  const out: UnitPlayReport = { unitId, plays, deaths };
  if (raw.deathsAt !== undefined) {
    if (!Array.isArray(raw.deathsAt) || raw.deathsAt.length > DEATHS_MAX) return null;
    const notes: DeathNote[] = [];
    for (const n of raw.deathsAt) {
      if (!isRecord(n)) return null;
      const tick = int(n.tick, 0, FAST_MATCH_MAX_TICKS);
      const killerId = int(n.killerId, 0, 100_000);
      const play = n.play === null ? null : str(n.play, PLAY_ID_MAX);
      if (tick === null || killerId === null || (play === null && n.play !== null)) return null;
      const note: DeathNote = { tick, play, killerId };
      if (n.scene !== undefined) {
        const scene = deathSceneOf(n.scene);
        if (!scene) return null;
        note.scene = scene;
      }
      notes.push(note);
    }
    out.deathsAt = notes;
  }
  return out;
}

function report(raw: unknown): PlayReport | null {
  if (!isRecord(raw)) return null;
  const ticks = int(raw.ticks, 0, FAST_MATCH_MAX_TICKS);
  if (ticks === null || !Array.isArray(raw.units) || raw.units.length > 10) return null;
  const units: UnitPlayReport[] = [];
  for (const u of raw.units) {
    const parsed = unitReport(u);
    if (!parsed) return null;
    units.push(parsed);
  }
  return { ticks, units };
}

function pick(raw: unknown): ReplayPick | null {
  if (!isRecord(raw)) return null;
  const name = str(raw.name, 32);
  const t = team(raw.team);
  const championId = str(raw.championId, 32);
  const skin = int(raw.skin, 0, 9);
  if (
    name === null ||
    t === null ||
    championId === null ||
    CHAMPIONS[championId] === undefined ||
    skin === null ||
    !Array.isArray(raw.sigils) ||
    raw.sigils.length !== 2
  ) {
    return null;
  }
  const sigils = raw.sigils as unknown[];
  const a = typeof sigils[0] === 'string' && SIGILS[sigils[0]] ? sigils[0] : null;
  const b = typeof sigils[1] === 'string' && SIGILS[sigils[1]] ? sigils[1] : null;
  if (a === null || b === null) return null;
  const out: ReplayPick = { name, team: t, championId, sigils: [a, b], skin };
  if (raw.bot !== undefined) {
    const bot = str(raw.bot, 32);
    if (bot === null) return null;
    out.bot = bot;
  }
  if (raw.playbook !== undefined) {
    // The one door untrusted playbook JSON goes through.
    const v = validatePlaybook(raw.playbook);
    if (!v.ok) return null;
    out.playbook = v.def;
  }
  return out;
}

function replay(raw: unknown, seed: number, ticks: number): ReplayRecord | null {
  if (!isRecord(raw)) return null;
  if (raw.version !== REPLAY_VERSION || raw.seed !== seed || raw.ticks !== ticks) return null;
  // A sparring's record has no events: the bots decided everything from
  // the seed. Anything else is not a sparring.
  if (!Array.isArray(raw.events) || raw.events.length !== 0) return null;
  if (raw.forged !== undefined) return null;
  if (!Array.isArray(raw.picks) || raw.picks.length !== 10) return null;
  const picks: ReplayPick[] = [];
  for (const p of raw.picks) {
    const parsed = pick(p);
    if (!parsed) return null;
    picks.push(parsed);
  }
  // Rebuilt here rather than trusted, the content fingerprint included:
  // it is this server that will serve the record back, and it is this
  // server's content the replay will be re-simulated against.
  return { version: REPLAY_VERSION, content: contentFingerprint(), seed, picks, events: [], ticks };
}

export interface RecordUpload {
  entry: Omit<NewRecordEntry, 'replayId'>;
  record: ReplayRecord;
}

// The Academy's sparring, as sent: every field bounded, the replay record
// rebuilt from validated parts, the picks' playbooks through the
// validator. Refuses anything that is not the shape of a local sparring.
export function parseUpload(raw: unknown, now: number): Parsed<RecordUpload> {
  if (!isRecord(raw)) return fail('a record entry is an object');
  const kind = raw.kind;
  if (kind !== 'sparring' && kind !== 'series') return fail('kind must be sparring or series');
  const seed = int(raw.seed, 0, 2_147_483_647);
  const t = team(raw.team);
  const winner = raw.winner === null ? null : team(raw.winner);
  const ticks = int(raw.ticks, 1, FAST_MATCH_MAX_TICKS);
  const version = int(raw.version, 1, 1_000_000);
  const botUnitId = int(raw.botUnitId, 0, 100_000);
  if (seed === null) return fail('seed');
  if (t === null) return fail('team');
  if (winner === null && raw.winner !== null) return fail('winner');
  if (ticks === null) return fail('ticks');
  if (version === null) return fail('version');
  if (typeof raw.edited !== 'boolean') return fail('edited');
  if (botUnitId === null) return fail('botUnitId');
  if (!Array.isArray(raw.score) || raw.score.length !== 10) return fail('score: ten rows');
  const score: ScoreRow[] = [];
  for (const r of raw.score) {
    const row = scoreRow(r);
    if (!row) return fail('score: a row is malformed');
    score.push(row);
  }
  if (!score.some((r) => r.unitId === botUnitId && r.team === t)) {
    return fail('score: the bot is not on its side');
  }
  const rep = report(raw.report);
  if (!rep) return fail('report');
  const rec = replay(raw.record, seed, ticks);
  if (!rec) return fail('record: not a sparring replay');
  const entry: RecordUpload['entry'] = {
    kind,
    at: now,
    seed,
    team: t,
    winner,
    ticks,
    version,
    edited: raw.edited,
    botUnitId,
    score,
    report: rep,
  };
  if (kind === 'series') {
    const seriesId = str(raw.seriesId, 40);
    const seriesIndex = int(raw.seriesIndex, 1, 10);
    const seriesOf = int(raw.seriesOf, 1, 10);
    if (seriesId === null || !/^[a-z0-9_-]+$/.test(seriesId)) return fail('seriesId');
    if (seriesIndex === null || seriesOf === null || seriesIndex > seriesOf) {
      return fail('series place');
    }
    entry.seriesId = seriesId;
    entry.seriesIndex = seriesIndex;
    entry.seriesOf = seriesOf;
  }
  if (raw.versus !== undefined) {
    const versus = str(raw.versus, 80);
    if (versus === null) return fail('versus');
    entry.versus = versus;
  }
  return { ok: true, value: { entry, record: rec } };
}

export function isRecordKind(v: unknown): v is RecordKind {
  return typeof v === 'string' && (KINDS as readonly string[]).includes(v);
}
