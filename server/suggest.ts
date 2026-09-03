// The Forge's kit conversation (grown out of the one-shot splash
// suggestion): the creator iterates in a chat. The client keeps the
// whole thread (session-lived; nothing is stored here) and sends it
// back each turn together with the def as it stands on the form; the
// server prepends the game's grammar, the price schedule, and the
// budget arithmetic, replays the thread to the model, and validates
// every proposal through validateForged before it reaches the editor.
// The numbers are not the model's job: every proposal is fitted to the
// budget line by the power dial's own scaling (one shared factor across
// the four spells) before validation, so the model owns structure and
// theme and a well-shaped answer lands in one call. A kit too light
// even at the dial's maximum goes back for more structure; one that
// survives every retry still returns, bill in plain sight, because a
// playable proposal beats an error. Metered on the 'agent' quota: one
// player message, one unit, however many internal retries it takes.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AbilityDef } from '../src/sim/combat/casting';
import { ABILITY_BOUNDS } from '../src/sim/forge/bounds';
import {
  AVAIL_PIVOT,
  AVAIL_SOFT,
  type BudgetBreakdown,
  budgetOf,
  CAST_PRICES,
  EFFECT_PRICES,
  POWER_BUDGET,
} from '../src/sim/forge/budget';
import type { ForgedChampionDef, ForgedPassiveRef } from '../src/sim/forge/forged_def';
import { PASSIVE_TEMPLATE_LIST } from '../src/sim/forge/passive_templates';
import { fitKitPower, POWER_DIAL_MAX, POWER_DIAL_MIN } from '../src/sim/forge/spell_power';
import { validateForged } from '../src/sim/forge/validate';
import type { ForgeOutcome } from './forge';
import type { ForgeStore } from './forge_store';

export interface SuggestDeps {
  store: ForgeStore;
  // Absent key: the surface answers honestly instead of pretending.
  apiKey: string | null;
  assetsDir: string;
  model?: string;
  // A valid kit spending under this share of what the budget leaves the
  // kit is sent back for strengthening; 0 disables the floor (tests).
  budgetFloor?: number;
  // Injectable for tests; production uses global fetch.
  fetchFn?: typeof fetch;
  readImage?: (absPath: string) => Buffer;
}

export const SUGGEST_MODEL_DEFAULT = 'claude-sonnet-5';
export const BUDGET_FLOOR_DEFAULT = 0.85;
// Model calls per player message: the first answer plus corrective
// retries (validation errors or a timid budget).
export const SUGGEST_ATTEMPTS = 3;
// One model call's wall-clock allowance: past it the call is abandoned
// and the creator gets a plain "try again" instead of a bubble that
// thinks forever.
export const SUGGEST_CALL_TIMEOUT_MS = 120_000;

// One turn of the conversation as the client keeps it: user turns are
// the creator's own words, assistant turns are the model's raw answers
// (replayed verbatim so the model can iterate on its own proposals).
export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export const CHAT_TURNS_MAX = 20;
export const CHAT_USER_TEXT_MAX = 2000;
export const CHAT_RAW_TEXT_MAX = 24000;

// The kit grammar, told compactly: the CastSpec and EffectSpec unions
// the sim executes (src/sim/combat/casting.ts, effects.ts). Kept by hand
// beside those types; validateForged catches any drift the hard way.
const GRAMMAR = `
An ability is: { "name": string, "manaCost": n, "cooldown": n, "castRange": n,
  "windup"?: seconds, "spec": CastSpec }.
CastSpec is ONE of:
  { "kind": "skillshot", "speed": n, "radius": n, "range": n, "pierce"?: bool, "onHit": Effect[] }
  { "kind": "zone", "radius": n, "duration": n, "tickEvery"?: n, "onEnter"?: Effect[], "onTick"?: Effect[], "detonateDelay"?: n, "onDetonate"?: Effect[], "reveal"?: bool }
  { "kind": "self_or_ally", "searchRadius": n, "effects": Effect[] }
  { "kind": "enemy_target", "searchRadius": n, "effects": Effect[], "selfEffects"?: Effect[] }
  { "kind": "cone", "range": n, "halfAngle": radians, "onHit": Effect[] }
  { "kind": "burst", "radius": n, "effects": Effect[], "selfEffects"?: Effect[] }
  { "kind": "dash", "range": n, "speed"?: n, "landRadius"?: n, "onLand"?: Effect[], "selfEffects"?: Effect[] }
  { "kind": "wall", "length": n, "duration": n }
Effect is ONE of:
  { "kind": "damage", "base": n, "adRatio"?: n, "apRatio"?: n, "dtype": "physical" | "magic" | "true" }
  { "kind": "heal", "base": n, "apRatio"?: n }
  { "kind": "slow", "pct": 0..1, "duration": n }
  { "kind": "root", "duration": n } | { "kind": "stun", "duration": n }
  { "kind": "knockback", "distance": n } | { "kind": "knockup", "duration": n }
  { "kind": "shield", "base": n, "apRatio"?: n, "duration": n }
  { "kind": "dot", "duration": n, "perSecond": n, "dtype": "physical" | "magic" }
  { "kind": "buff", "duration": n, "msPct"?: 0..1, "asPct"?: 0..1, "armor"?: n, "mr"?: n }
  { "kind": "stealth", "duration": n }
  { "kind": "mark", "duration": n, "stacksToTrigger": int, "onTrigger": Effect[] }
Rules: distances are world units (a lane is ~12 wide, castRange tops out
around 10 for most spells). An INSTANT stun, root, knockup or long
knockback needs "windup" >= 0.35 (the telegraph rule). R is the
ultimate: bigger, longer cooldown.
`;

function templateCatalog(): string {
  return PASSIVE_TEMPLATE_LIST.map(
    (t) =>
      `${t.id}: ${t.summary} params: ${t.params
        .map((p) => `${p.key} ${p.min}..${p.max}${p.integer ? ' int' : ''}`)
        .join(', ')}`,
  ).join('\n');
}

// The price schedule, verbatim from the sim's own costing (budget.ts):
// the model can estimate its bill instead of guessing, and the server
// still verifies against the real arithmetic after validation.
function costSchedule(): string {
  return [
    `Every kit fits a power budget of ${POWER_BUDGET} shared with base stats and growth.`,
    `Effect prices (cost = value * price, durations in seconds): ${JSON.stringify(EFFECT_PRICES)}.`,
    `Delivery prices and multipliers: ${JSON.stringify(CAST_PRICES)}.`,
    `An ability's bill is its delivery cost times ${AVAIL_PIVOT}/(${AVAIL_SOFT}+cooldown),`,
    'relieved up to 20 percent each by mana cost and windup.',
    'Size the amounts roughly: the server then scales every amount (damage, healing, crowd ' +
      `control durations) by one shared factor between ${POWER_DIAL_MIN} and ${POWER_DIAL_MAX} ` +
      'so the kit lands exactly on the budget line. Structure, shapes and rhythm are yours and ' +
      'never scaled: land within a factor of two of the line and spend your care on the design.',
  ].join(' ');
}

// What the budget leaves the kit once stats and growth are paid, and
// what the current kit spends of it.
function kitBudgetOf(bill: BudgetBreakdown): { cap: number; spend: number } {
  const a = bill.abilities;
  return {
    cap: POWER_BUDGET - bill.stats - bill.growth,
    spend: bill.passive + a.Q + a.W + a.E + a.R,
  };
}

function billLine(bill: BudgetBreakdown): string {
  const a = bill.abilities;
  return (
    `Q ${Math.round(a.Q)}, W ${Math.round(a.W)}, E ${Math.round(a.E)}, ` +
    `R ${Math.round(a.R)}, passive ${Math.round(bill.passive)}`
  );
}

function preamble(def: ForgedChampionDef): string {
  const intro =
    'You design a champion kit for a small deterministic MOBA, in conversation ' +
    "with the champion's creator. The image is their chosen splash art: read its " +
    'theme (weapon, element, silhouette, mood) and propose kits that match it, ' +
    'then rework your latest proposal as the creator asks.';
  const task =
    'Every answer is ONLY a JSON object, no prose around it: { "comment": string, ' +
    '"passive": { "template": id, "params": {..}, "name": string }, "abilities": ' +
    '{ "Q": Ability, "W": Ability, "E": Ability, "R": Ability } }. "comment" is one ' +
    'or two plain sentences to the creator about what you proposed or changed. ' +
    'Spell names must be original English, no borrowed game IP. Compact JSON: no ' +
    'indentation, no line breaks. The creator may write in any language: answer them in ' +
    'their own language inside "comment", but every name (the passive and the four ' +
    'spells) is plain English, like every other champion in the game.';
  const bounds = `Numeric bounds per ability field: ${JSON.stringify(ABILITY_BOUNDS)} (cooldown uses basicCooldown for Q W E and ultCooldown for R).`;
  const current = `The champion (name, role, stats stay as they are; you rework passive and abilities): ${JSON.stringify(
    {
      name: def.name,
      title: def.title,
      role: def.role,
      base: def.base,
    },
  )}`;
  return [
    intro,
    GRAMMAR,
    `Passive templates (pick ONE):\n${templateCatalog()}`,
    bounds,
    costSchedule(),
    current,
    task,
  ].join('\n\n');
}

// The form as it stands right now, appended to the creator's latest
// message: the player may have applied a proposal or hand-edited since
// the conversation started, and the available budget moves with the
// stats, so both are restated every turn.
function formState(def: ForgedChampionDef): string {
  const bill = budgetOf(def);
  const kit = kitBudgetOf(bill);
  return [
    `The kit on the form right now: ${JSON.stringify({ passive: def.passive, abilities: def.abilities })}.`,
    `Base stats and growth cost ${Math.round(bill.stats + bill.growth)}, leaving the passive plus abilities ${Math.round(kit.cap)} to spend;`,
    `the form's kit spends ${Math.round(kit.spend)} of that (${billLine(bill)}).`,
  ].join(' ');
}

interface Suggestion {
  comment: string;
  passive: ForgedPassiveRef;
  abilities: Record<'Q' | 'W' | 'E' | 'R', AbilityDef>;
}

function parseSuggestion(text: string): Suggestion | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Partial<Suggestion>;
    if (typeof raw !== 'object' || raw === null) return null;
    if (typeof raw.passive !== 'object' || typeof raw.abilities !== 'object') return null;
    const comment = typeof raw.comment === 'string' ? raw.comment.slice(0, 400) : '';
    return { comment, passive: raw.passive, abilities: raw.abilities } as Suggestion;
  } catch {
    return null;
  }
}

// A readable rejection when the thread the client sent is not a thread;
// null means it is well formed.
export function threadError(messages: unknown): string | null {
  if (!Array.isArray(messages) || messages.length === 0) return 'malformed conversation';
  if (messages.length > CHAT_TURNS_MAX) {
    return 'this conversation is too long: apply what you like and start a fresh one';
  }
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i] as Partial<ChatTurn>;
    if (typeof m !== 'object' || m === null) return 'malformed conversation';
    if (m.role !== 'user' && m.role !== 'assistant') return 'malformed conversation';
    if (typeof m.text !== 'string') return 'malformed conversation';
    const cap = m.role === 'user' ? CHAT_USER_TEXT_MAX : CHAT_RAW_TEXT_MAX;
    if (m.text.length > cap) return 'a message in this conversation is too long';
    if (i > 0 && (messages[i - 1] as ChatTurn).role === m.role) return 'malformed conversation';
  }
  const first = messages[0] as ChatTurn;
  const last = messages[messages.length - 1] as ChatTurn;
  if (first.role !== 'user' || last.role !== 'user') return 'malformed conversation';
  return null;
}

type ApiContent = string | ({ type: string } & Record<string, unknown>)[];
interface ApiMessage {
  role: 'user' | 'assistant';
  content: ApiContent;
}

// The thread as the model sees it: the preamble and the splash image
// ride the FIRST turn only, the live form state rides the LAST.
function toApiMessages(
  turns: readonly ChatTurn[],
  intro: string,
  state: string,
  image: Buffer,
  mediaType: string,
): ApiMessage[] {
  return turns.map((t, i) => {
    if (t.role === 'assistant') return { role: 'assistant', content: t.text };
    let text = i === 0 ? `${intro}\n\nThe creator says: ${t.text}` : t.text;
    if (i === turns.length - 1) text = `${text}\n\n${state}`;
    if (i > 0) return { role: 'user', content: text } as ApiMessage;
    return {
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: image.toString('base64') },
        },
        { type: 'text', text },
      ],
    };
  });
}

// The Messages API's server-sent events, text deltas only: the answer
// grows as the model writes it, and the caller hears every piece.
async function readEventStream(
  res: Response,
  onText: ((delta: string) => void) | undefined,
): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let text = '';
  const take = (frame: string): void => {
    for (const line of frame.split('\n')) {
      if (!line.startsWith('data:')) continue;
      let event: {
        type?: string;
        delta?: { type?: string; text?: string };
        error?: { message?: string };
      };
      try {
        event = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (event.type === 'error') throw new Error(event.error?.message ?? 'the stream broke');
      if (event.type !== 'content_block_delta' || event.delta?.type !== 'text_delta') continue;
      if (typeof event.delta.text !== 'string') continue;
      text += event.delta.text;
      onText?.(event.delta.text);
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    let cut = pending.indexOf('\n\n');
    while (cut >= 0) {
      take(pending.slice(0, cut));
      pending = pending.slice(cut + 2);
      cut = pending.indexOf('\n\n');
    }
  }
  if (pending.trim() !== '') take(pending);
  return text;
}

async function askModel(
  deps: SuggestDeps,
  messages: readonly ApiMessage[],
  onText?: (delta: string) => void,
): Promise<string> {
  const doFetch = deps.fetchFn ?? fetch;
  const res = await doFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': deps.apiKey ?? '',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: deps.model ?? SUGGEST_MODEL_DEFAULT,
      max_tokens: 4000,
      // No hidden reasoning: a kit is a design, not a proof, and the fit
      // owns the arithmetic. Measured 2026-09-01 on the default (adaptive
      // thinking, implicit on this model): 42 s per call, 34 of them
      // silent; disabled: 11 s.
      thinking: { type: 'disabled' },
      stream: true,
      messages,
    }),
    signal: AbortSignal.timeout(SUGGEST_CALL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`suggestion service answered ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('text/event-stream')) return readEventStream(res, onText);
  // A whole message at once: a stub, or a service that ignored the stream.
  const body = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = body.content?.find((c) => c.type === 'text')?.text ?? '';
  onText?.(text);
  return text;
}

// The image's real type, from its bytes: the art pipeline names every
// download .png and most live splashes are JPEG underneath, which the
// model service rejects outright when declared wrong.
export function imageMediaType(
  bytes: Buffer,
): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF') {
    if (bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  }
  if (bytes.length >= 4 && bytes.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  return 'image/png';
}

// Names the game cannot show: anything outside plain printable ASCII is
// not the English the roster speaks (ADR 0004), whatever language the
// creator wrote in. Plain words in another language slip through here;
// the prompt carries that rule.
function foreignNames(s: Suggestion): string[] {
  const a = s.abilities ?? ({} as Suggestion['abilities']);
  const names = [s.passive?.name, a.Q?.name, a.W?.name, a.E?.name, a.R?.name];
  return names.filter((n): n is string => typeof n === 'string' && !/^[\x20-\x7e]*$/.test(n));
}

// What the surface reports while a proposal is in the making: the
// model's own words as they stream (the client reads the comment as it
// is written) and the server's stages between calls.
export type SuggestProgress = { kind: 'text'; text: string } | { kind: 'stage'; text: string };

export interface SuggestRequest {
  id: string;
  messages: readonly ChatTurn[];
  // The def as it stands on the form, unsaved edits included; absent
  // falls back to the stored draft.
  def?: unknown;
  onProgress?: (progress: SuggestProgress) => void;
}

export interface KitProposal {
  comment: string;
  passive: ForgedPassiveRef;
  abilities: Suggestion['abilities'];
  // The model's raw answer, for the client to replay as the assistant
  // turn next time.
  raw: string;
  budget: { total: number; cap: number };
  // The shared factor the fit applied to the model's amounts: 1 means
  // the model's own numbers, above it they were raised to the line,
  // below it trimmed to fit.
  fit: number;
}

export async function suggestKit(
  deps: SuggestDeps,
  accountId: number,
  req: SuggestRequest,
): Promise<ForgeOutcome<KitProposal>> {
  if (!deps.apiKey) {
    return { ok: false, error: 'suggestions are not configured on this server yet' };
  }
  const row = deps.store.getForged(req.id);
  if (!row || row.accountId !== accountId) {
    return { ok: false, error: 'no such champion on this account' };
  }
  if (row.status === 'finalized') {
    return { ok: false, error: 'the kit is sealed; suggestions rework drafts only' };
  }
  const badThread = threadError(req.messages);
  if (badThread !== null) return { ok: false, error: badThread };
  const splash = deps.store.chosenArt(req.id, 'splash');
  if (!splash) {
    return { ok: false, error: 'make and pick the splash art first: the kit derives from it' };
  }
  // The working def: what is on the form beats what was last saved, but
  // identity is always the row's own.
  let base = row.def;
  if (req.def !== undefined) {
    if (typeof req.def !== 'object' || req.def === null) {
      return { ok: false, error: 'malformed form state' };
    }
    base = { ...(req.def as ForgedChampionDef), id: row.def.id, creator: row.def.creator };
  }
  const read = deps.readImage ?? ((p: string) => readFileSync(p));
  let image: Buffer;
  try {
    image = read(path.join(deps.assetsDir, splash.path));
  } catch {
    return { ok: false, error: 'the chosen splash file is missing on this server' };
  }
  const mediaType = imageMediaType(image);

  const apiMessages = toApiMessages(
    req.messages,
    preamble(base),
    formState(base),
    image,
    mediaType,
  );
  const floor = deps.budgetFloor ?? BUDGET_FLOOR_DEFAULT;
  let fallback: ForgeOutcome<KitProposal> | null = null;
  let lastErrors: readonly string[] = [];
  const progress = req.onProgress ?? (() => {});
  let stage = 'Reading the splash and writing the kit';
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
    progress({ kind: 'stage', text: 'Fitting the budget and checking the rules' });
    const retry = (feedback: string, next: string): void => {
      apiMessages.push({ role: 'assistant', content: text }, { role: 'user', content: feedback });
      stage = next;
    };
    const suggestion = parseSuggestion(text);
    if (!suggestion) {
      lastErrors = ['the answer was not the requested JSON object'];
      retry(
        'That was not the requested JSON object; answer with ONLY the JSON.',
        'The answer was not a kit, asking again',
      );
      continue;
    }
    const foreign = foreignNames(suggestion);
    if (foreign.length > 0) {
      lastErrors = [`names not in English: ${foreign.join(', ')}`];
      retry(
        `These names are not plain English: ${foreign.join(', ')}. Rename them in English ` +
          '(ASCII letters only), keep everything else, and answer with ONLY the JSON object.',
        'The names were not English, asking again',
      );
      continue;
    }
    const drafted: ForgedChampionDef = {
      ...base,
      passive: suggestion.passive,
      abilities: suggestion.abilities,
    };
    // The fit: every amount at one shared factor so the kit lands on the
    // budget line, the power dial's own scaling. An unvalidated shape may
    // not scale at all: a fit that throws or finds no factor leaves the
    // draft as it is for the validator to describe.
    let fit: ReturnType<typeof fitKitPower> = null;
    try {
      fit = fitKitPower(drafted);
    } catch {
      fit = null;
    }
    const candidate: ForgedChampionDef = fit ? { ...drafted, abilities: fit.abilities } : drafted;
    const v = validateForged(candidate);
    if (!v.ok) {
      lastErrors = v.errors;
      retry(
        `Your kit failed validation with these errors, fix them precisely: ${v.errors.join('; ')}`,
        'The draft broke a rule, asking for a fix',
      );
      continue;
    }
    const bill = budgetOf(candidate);
    const kit = kitBudgetOf(bill);
    const proposal: ForgeOutcome<KitProposal> = {
      ok: true,
      comment: suggestion.comment,
      passive: suggestion.passive,
      abilities: candidate.abilities,
      raw: text.slice(0, CHAT_RAW_TEXT_MAX),
      budget: { total: Math.round(bill.total), cap: POWER_BUDGET },
      fit: fit?.factor ?? 1,
    };
    if (floor <= 0 || kit.cap <= 0 || kit.spend >= floor * kit.cap) return proposal;
    // Valid but too light even at the dial's maximum: the structure is
    // the problem, not the amounts. Keep it as the fallback and push for
    // more.
    fallback = proposal;
    lastErrors = [];
    retry(
      `Valid, but too light: even with every amount scaled up to ${POWER_DIAL_MAX} times, the ` +
        `passive plus abilities spend ${Math.round(kit.spend)} of the ${Math.round(kit.cap)} the ` +
        `budget leaves them (${Math.round((100 * kit.spend) / kit.cap)} percent). Amounts cannot ` +
        'fix this: add substance to the structure (more effects per spell, shorter cooldowns, ' +
        `wider shapes, a pricier passive). The bill today: ${billLine(bill)}. ` +
        'Answer with ONLY the JSON object.',
      'The kit was too light, asking for more',
    );
  }
  if (fallback) return fallback;
  return {
    ok: false,
    error: `the suggestion did not clear validation: ${(lastErrors ?? []).slice(0, 3).join('; ')}`,
  };
}
