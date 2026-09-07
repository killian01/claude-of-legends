// The Forge's stat conversation, the kit conversation's sibling on the
// Tuning tab: the creator says what kind of body the champion should
// have ("a tanky frontliner", "faster but frailer") and each answer
// proposes base stats and growth. The model owns the shape and the melee
// or ranged choice; the numbers are not its job: every proposal is
// fitted to the Stat and Growth envelope lines by the sim's own stat fit
// (one shared factor per group, reach held), then validated in full
// before it reaches the editor, where nothing touches the polygons until
// the creator applies it. No image rides along: the kit on the form and
// the role say what the body is for. Metered on the 'agent' quota: one
// player message, one unit, however many internal retries.

import type { AbilityDef, CastSpec } from '../src/sim/combat/casting';
import type { ChampionBaseStats, ChampionGrowth } from '../src/sim/content/champions';
import { CHAMPION_LIST } from '../src/sim/content/champions';
import { BASE_STAT_BOUNDS, GROWTH_BOUNDS } from '../src/sim/forge/bounds';
import { BASE_STAT_PRICES, budgetOf, GROWTH_PRICES } from '../src/sim/forge/budget';
import { ENVELOPES, envelopeSpend } from '../src/sim/forge/envelopes';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { fitStats, MELEE_REACH, RANGED_MIN } from '../src/sim/forge/stat_fit';
import { validateForged } from '../src/sim/forge/validate';
import type { AbilityKey } from '../src/sim/types';
import type { ForgeOutcome } from './forge';
import {
  type ApiMessage,
  askModel,
  CHAT_RAW_TEXT_MAX,
  SUGGEST_ATTEMPTS,
  type SuggestDeps,
  type SuggestRequest,
  threadError,
} from './suggest';

const KIT_KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];

// The roster's stat lines, the model's reference for what a body of each
// role looks like in this game.
function rosterLines(): string {
  return CHAMPION_LIST.map(
    (c) =>
      `${c.name} (${c.role}): base ${JSON.stringify(c.base)} growth ${JSON.stringify(c.growth)}`,
  ).join('\n');
}

// The effect kinds a cast spec carries, at any depth the grammar has.
function effectKinds(spec: CastSpec): string[] {
  const kinds: string[] = [];
  for (const v of Object.values(spec as unknown as Record<string, unknown>)) {
    if (!Array.isArray(v)) continue;
    for (const e of v) {
      if (
        typeof e === 'object' &&
        e !== null &&
        typeof (e as { kind?: unknown }).kind === 'string'
      ) {
        kinds.push((e as { kind: string }).kind);
      }
    }
  }
  return [...new Set(kinds)];
}

// The kit in one line per spell: what the body is for.
function kitSummary(def: ForgedChampionDef): string {
  const lines = KIT_KEYS.map((k) => {
    const a: AbilityDef = def.abilities[k];
    return `${k} ${a.name}: ${a.spec.kind}, cooldown ${a.cooldown}, ${effectKinds(a.spec).join('/') || 'no effects'}`;
  });
  lines.unshift(`passive ${def.passive.name || def.passive.template}: ${def.passive.template}`);
  return lines.join('; ');
}

// The stat half of the grammar: bounds, prices, envelopes and the roster
// to read them against. Shared with the brief (server/forge_brief.ts),
// which asks for a kit and a body in one answer, so the two surfaces
// cannot drift apart on what a legal stat line is.
export const STAT_RULES = statRules();

function statRules(): string {
  const rules = [
    `Base stat bounds: ${JSON.stringify(BASE_STAT_BOUNDS)}. Growth bounds: ${JSON.stringify(GROWTH_BOUNDS)}.`,
    `Price per point above each floor: base ${JSON.stringify(BASE_STAT_PRICES)}, growth ${JSON.stringify(GROWTH_PRICES)}.`,
    `Base stats fit the Stat envelope of ${ENVELOPES.stats} points and growth the Growth envelope ` +
      `of ${ENVELOPES.growth}; the two never trade with each other or with the kit.`,
    'Size the numbers roughly: the server scales the points above each floor by one shared ' +
      'factor per group so each envelope lands exactly on its line. The SHAPE is yours (which ' +
      'stats are high and which are dumped); the level is the arithmetic. AP is always 0 (it ' +
      'comes from items) and radius is body size, free of charge.',
    `The reach is an identity, never scaled: attackRange at or under 2 makes a melee champion ` +
      `(pinned at ${MELEE_REACH}); above 2 a ranged one, ${RANGED_MIN} to ` +
      `${BASE_STAT_BOUNDS.attackRange.max}, priced like any stat. Keep the choice the kit implies ` +
      'unless the creator asks otherwise.',
  ].join(' ');
  return [`The roster, for reference:\n${rosterLines()}`, rules].join('\n\n');
}

function preamble(): string {
  const intro =
    'You tune the base stats and per-level growth of a champion for a small deterministic ' +
    "MOBA, in conversation with the champion's creator. Read the champion's role and kit, " +
    'then propose a stat line that fits the body they describe, and rework your latest ' +
    'proposal as the creator asks.';
  const task =
    'Every answer is ONLY a JSON object, no prose around it: { "comment": string, "base": ' +
    '{ "hp", "mana", "ad", "armor", "mr", "attackRange", "attackSpeed", "moveSpeed", ' +
    '"hpRegen", "manaRegen", "radius" }, "growth": { "hp", "mana", "ad", "armor", "mr" } }, ' +
    'every value a number. "comment" is one or two plain sentences to the creator about ' +
    'the body you proposed or what you changed, in their own language. Compact JSON: no ' +
    'indentation, no line breaks.';
  return [intro, STAT_RULES, task].join('\n\n');
}

// The form as it stands, restated every turn: the kit may have changed
// since the conversation began, and the stats on the polygons too.
function formState(def: ForgedChampionDef): string {
  const spend = envelopeSpend(budgetOf(def));
  return [
    `The champion: ${JSON.stringify({ name: def.name, title: def.title, role: def.role })}.`,
    `Its kit: ${kitSummary(def)}.`,
    `The stats on the form right now: base ${JSON.stringify(def.base)}, growth ${JSON.stringify(def.growth)};`,
    `they spend ${Math.round(spend.stats)} of ${ENVELOPES.stats} and ${Math.round(spend.growth)} of ${ENVELOPES.growth}.`,
  ].join(' ');
}

interface StatSuggestion {
  comment: string;
  base: Partial<ChampionBaseStats>;
  growth: Partial<ChampionGrowth>;
}

function numbersOf(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

function parseStatSuggestion(text: string): StatSuggestion | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Partial<StatSuggestion>;
    if (typeof raw !== 'object' || raw === null) return null;
    if (typeof raw.base !== 'object' || typeof raw.growth !== 'object') return null;
    const comment = typeof raw.comment === 'string' ? raw.comment.slice(0, 400) : '';
    return { comment, base: numbersOf(raw.base), growth: numbersOf(raw.growth) };
  } catch {
    return null;
  }
}

// The thread as the model sees it: the preamble rides the FIRST turn,
// the live form state the LAST. No image: the stats follow the kit.
function toApiMessages(
  turns: SuggestRequest['messages'],
  intro: string,
  state: string,
): ApiMessage[] {
  return turns.map((t, i) => {
    if (t.role === 'assistant') return { role: 'assistant', content: t.text };
    let text = i === 0 ? `${intro}\n\nThe creator says: ${t.text}` : t.text;
    if (i === turns.length - 1) text = `${text}\n\n${state}`;
    return { role: 'user', content: text };
  });
}

export interface StatProposal {
  comment: string;
  base: ChampionBaseStats;
  growth: ChampionGrowth;
  // The model's raw answer, replayed as the assistant turn next time.
  raw: string;
  // What each group spends of its envelope after the fit.
  budget: { stats: { spend: number; cap: number }; growth: { spend: number; cap: number } };
  // The shared factor the fit applied to each group's shape: 1 means the
  // model's own numbers, above it raised to the line, below it trimmed.
  fit: { stats: number; growth: number };
}

export async function suggestStats(
  deps: SuggestDeps,
  accountId: number,
  req: SuggestRequest,
): Promise<ForgeOutcome<StatProposal>> {
  if (!deps.apiKey) {
    return { ok: false, error: 'suggestions are not configured on this server yet' };
  }
  const row = deps.store.getForged(req.id);
  if (!row || row.accountId !== accountId) {
    return { ok: false, error: 'no such champion on this account' };
  }
  if (row.status === 'finalized') {
    return { ok: false, error: 'the stats are sealed; suggestions retune drafts only' };
  }
  const badThread = threadError(req.messages);
  if (badThread !== null) return { ok: false, error: badThread };
  let base = row.def;
  if (req.def !== undefined) {
    if (typeof req.def !== 'object' || req.def === null) {
      return { ok: false, error: 'malformed form state' };
    }
    base = { ...(req.def as ForgedChampionDef), id: row.def.id, creator: row.def.creator };
  }
  const apiMessages = toApiMessages(req.messages, preamble(), formState(base));
  let lastErrors: readonly string[] = [];
  const progress = req.onProgress ?? (() => {});
  let stage = 'Reading the kit and shaping the stats';
  for (let attempt = 0; attempt < SUGGEST_ATTEMPTS; attempt += 1) {
    progress({ kind: 'stage', text: stage });
    let text: string;
    try {
      text = await askModel(deps, apiMessages, (delta) => progress({ kind: 'text', text: delta }));
    } catch (err) {
      const e = err as Error;
      const why =
        e.name === 'TimeoutError' ? 'the model took too long to answer; try again' : e.message;
      return { ok: false, error: `the suggestion call failed: ${why}` };
    }
    progress({ kind: 'stage', text: 'Fitting the envelopes and checking the rules' });
    const retry = (feedback: string, next: string): void => {
      apiMessages.push({ role: 'assistant', content: text }, { role: 'user', content: feedback });
      stage = next;
    };
    const suggestion = parseStatSuggestion(text);
    if (!suggestion) {
      lastErrors = ['the answer was not the requested JSON object'];
      retry(
        'That was not the requested JSON object; answer with ONLY the JSON.',
        'The answer was not a stat line, asking again',
      );
      continue;
    }
    const fit = fitStats(suggestion.base, suggestion.growth);
    const candidate: ForgedChampionDef = { ...base, base: fit.base, growth: fit.growth };
    const v = validateForged(candidate);
    if (!v.ok) {
      lastErrors = v.errors;
      retry(
        `Your stats failed validation with these errors, fix them precisely: ${v.errors.join('; ')}`,
        'The draft broke a rule, asking for a fix',
      );
      continue;
    }
    const spend = envelopeSpend(budgetOf(candidate));
    return {
      ok: true,
      comment: suggestion.comment,
      base: fit.base,
      growth: fit.growth,
      raw: text.slice(0, CHAT_RAW_TEXT_MAX),
      budget: {
        stats: { spend: Math.round(spend.stats), cap: ENVELOPES.stats },
        growth: { spend: Math.round(spend.growth), cap: ENVELOPES.growth },
      },
      fit: fit.factor,
    };
  }
  return {
    ok: false,
    error: `the suggestion did not clear validation: ${lastErrors.slice(0, 3).join('; ')}`,
  };
}
