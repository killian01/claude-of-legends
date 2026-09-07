// The Forge's brief: one sentence in, a whole champion out. It exists
// because assembling a champion asks the creator to be three people at
// once (an art director, a game designer and a technical artist), and
// nobody arrives as all three. So the first door of the Forge writes a
// complete, legal champion from one line of intent, and the creator
// spends their time CHANGING it rather than authoring it from a blank
// form.
//
// One answer carries identity, kit and body together, because they are
// one design decision: a name, a role, a passive plus four spells, base
// stats and growth, and the splash line the art step starts from.
//
// It is a CONVERSATION, like the kit and the stats: the first line gets
// a whole champion, and the creator then reworks it in their own words
// ("make him a bruiser instead", "same idea but ice", "the ultimate
// should be a leap"). Every answer is a whole champion again, read
// against what is on the form, so iterating on the style is the normal
// way to use it rather than rerolling from scratch.
//
// The numbers are not the model's job here either: the kit is fitted to
// its envelope by the power dial's own scaling and the stats by the
// sim's stat fit, exactly as the two conversations do, then the whole
// thing goes through validateForged before it reaches the editor. What
// comes back is a proposal: nothing touches the form until the creator
// takes it. Priced as one turn per message, on the same 'agent' meter,
// however many internal retries it takes.

import type { AbilityDef } from '../src/sim/combat/casting';
import type { ChampionBaseStats, ChampionGrowth, ChampionRole } from '../src/sim/content/champions';
import { budgetOf } from '../src/sim/forge/budget';
import { ENVELOPES, envelopeSpend, KIT_ENVELOPE, kitSpendOf } from '../src/sim/forge/envelopes';
import type { ForgedChampionDef, ForgedPassiveRef } from '../src/sim/forge/forged_def';
import { fitKitPower } from '../src/sim/forge/spell_power';
import { fitStats } from '../src/sim/forge/stat_fit';
import { FORGED_ROLES, validateForged } from '../src/sim/forge/validate';
import type { AbilityKey } from '../src/sim/types';
import { EMBER_PRICES } from './embers';
import type { ForgeOutcome } from './forge';
import { usageSample } from './spend';
import {
  type ApiMessage,
  askModel,
  CHAT_RAW_TEXT_MAX,
  type ChatTurn,
  SUGGEST_ATTEMPTS,
  type SuggestDeps,
  type SuggestProgress,
  threadError,
} from './suggest';
import { STAT_RULES } from './suggest_stats';
import { findBlockedWord } from './word_filter';

// The identity limits the validator enforces, restated for the model so
// a name that cannot be stored is never proposed.
const NAME_MAX = 40;
const TAGLINE_MAX = 90;

const KIT_KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];

export interface BriefRequest {
  id: string;
  // The thread as the client keeps it: the creator's own words, the
  // model's raw answers replayed verbatim so it can rework its own
  // champion.
  messages: readonly ChatTurn[];
  // The def as it stands on the form, unsaved edits included; absent
  // falls back to the stored draft.
  def?: unknown;
  onProgress?: (progress: SuggestProgress) => void;
}

export interface BriefProposal {
  // One or two sentences to the creator, in their own language.
  comment: string;
  name: string;
  title: string;
  tagline: string;
  role: ChampionRole;
  // The art line Step 1 starts from: the champion as a picture, in the
  // words the splash generator wants.
  splash: string;
  passive: ForgedPassiveRef;
  abilities: Record<AbilityKey, AbilityDef>;
  base: ChampionBaseStats;
  growth: ChampionGrowth;
  raw: string;
  budget: {
    kit: { spend: number; cap: number };
    stats: { spend: number; cap: number };
    growth: { spend: number; cap: number };
  };
  // What each fit had to do to the model's own numbers; 1 means they
  // stood as written.
  fit: { kit: number; stats: number; growth: number };
  // The spells a burst cap held while the others took the room.
  held: readonly AbilityKey[];
}

// The brief's own instructions. The kit grammar itself rides the system
// block (server/suggest.ts) on every one of these calls, so only what is
// particular to a brief is written here.
function briefRules(): string {
  const intro =
    'You invent a whole champion for a small deterministic MOBA from one line by its ' +
    'creator. They have written nothing else: no name, no kit, no stats, no art. Read their ' +
    'line for theme, fantasy and role, and answer with a complete champion they can play ' +
    'with immediately and then change. Be specific and opinionated: a champion that reads ' +
    'as somebody is worth more than a safe one.';
  const identity = [
    `Identity: "name" at most ${NAME_MAX} characters, "title" at most ${NAME_MAX} (the words ` +
      'after the name, no comma of your own), "tagline" at most ' +
      `${TAGLINE_MAX} (the one line that tells four allies what this kit does).`,
    `"role" is exactly one of ${FORGED_ROLES.join(', ')}.`,
    'Names and titles are original English, like every other champion in the game: no ' +
      'borrowed game IP, no accents, ASCII letters only.',
  ].join(' ');
  const splash =
    '"splash" is one sentence describing the champion as a PICTURE, for the art step: ' +
    'silhouette, materials, mood, one accent colour, one memorable detail. No camera or ' +
    'style words, no artist names.';
  const task =
    'Answer with ONLY a JSON object, no prose around it: { "comment": string, "name": string, ' +
    '"title": string, "tagline": string, "role": string, "splash": string, "passive": ' +
    '{ "template": id, "params": {..}, "name": string, "flavor": string }, "abilities": ' +
    '{ "Q": Ability, "W": Ability, "E": Ability, "R": Ability }, "base": { "hp", "mana", "ad", ' +
    '"armor", "mr", "attackRange", "attackSpeed", "moveSpeed", "hpRegen", "manaRegen", ' +
    '"radius" }, "growth": { "hp", "mana", "ad", "armor", "mr" } }. "comment" is one or two ' +
    'plain sentences to the creator saying what you made of their line, in THEIR language. ' +
    'Compact JSON: no indentation, no line breaks.';
  return [intro, identity, splash, STAT_RULES, task].join('\n\n');
}

// Built once: everything in it comes from data tables.
export const BRIEF_RULES = briefRules();

interface BriefSuggestion {
  comment: string;
  name: string;
  title: string;
  tagline: string;
  role: string;
  splash: string;
  passive: ForgedPassiveRef;
  abilities: Record<AbilityKey, AbilityDef>;
  base: Partial<ChampionBaseStats>;
  growth: Partial<ChampionGrowth>;
}

function text(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.trim().slice(0, max) : '';
}

function numbersOf(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

function parseBrief(answer: string): BriefSuggestion | null {
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const raw = JSON.parse(answer.slice(start, end + 1)) as Partial<BriefSuggestion>;
    if (typeof raw !== 'object' || raw === null) return null;
    if (typeof raw.passive !== 'object' || typeof raw.abilities !== 'object') return null;
    if (typeof raw.base !== 'object' || typeof raw.growth !== 'object') return null;
    return {
      comment: text(raw.comment, 400),
      name: text(raw.name, NAME_MAX),
      title: text(raw.title, NAME_MAX),
      tagline: text(raw.tagline, TAGLINE_MAX),
      role: text(raw.role, NAME_MAX),
      splash: text(raw.splash, 400),
      passive: raw.passive,
      abilities: raw.abilities,
      base: numbersOf(raw.base),
      growth: numbersOf(raw.growth),
    };
  } catch {
    return null;
  }
}

// Every authored string a brief writes, for the same filter a save runs:
// a word that cannot be stored is caught here, where the model can be
// asked for another, instead of on the creator's next autosave.
function authoredText(s: BriefSuggestion): string[] {
  return [
    s.name,
    s.title,
    s.tagline,
    s.splash,
    s.passive?.name ?? '',
    s.passive?.flavor ?? '',
    ...KIT_KEYS.flatMap((k) => [s.abilities[k]?.name ?? '', s.abilities[k]?.flavor ?? '']),
  ];
}

// Names outside plain ASCII: the game's own naming rule (ADR 0004), the
// same check the kit conversation makes.
function foreignNames(s: BriefSuggestion): string[] {
  return [s.name, s.title, s.passive?.name, ...KIT_KEYS.map((k) => s.abilities[k]?.name)].filter(
    (n): n is string => typeof n === 'string' && n !== '' && !/^[\x20-\x7e]*$/.test(n),
  );
}

// The form as it stands, appended to the creator's LATEST message: a
// champion the creator has taken and hand-edited is what the next
// message reworks, so identity, kit and body all travel with it. On the
// very first message it is the blank draft, and the rules above say to
// invent rather than to rework.
function formState(def: ForgedChampionDef): string {
  return [
    `The champion on the form right now: ${JSON.stringify({
      name: def.name,
      title: def.title,
      tagline: def.tagline,
      role: def.role,
    })}.`,
    `Its kit: ${JSON.stringify({ passive: def.passive, abilities: def.abilities })}.`,
    `Its body: base ${JSON.stringify(def.base)}, growth ${JSON.stringify(def.growth)}.`,
    'Rework THIS champion when the creator asks for a change; keep everything they did not ' +
      'ask you to touch, and always answer with the whole champion.',
  ].join(' ');
}

// The thread as the model sees it: the brief's rules ride the FIRST user
// turn (the kit grammar itself is the cached system block), the live form
// state the LAST, exactly like the kit and stat conversations.
function toApiMessages(turns: readonly ChatTurn[], state: string): ApiMessage[] {
  return turns.map((t, i) => {
    if (t.role === 'assistant') return { role: 'assistant', content: t.text };
    let text = i === 0 ? `${BRIEF_RULES}\n\nThe creator's line: ${t.text}` : t.text;
    if (i === turns.length - 1) text = `${text}\n\n${state}`;
    return { role: 'user', content: text };
  });
}

export async function briefChampion(
  deps: SuggestDeps,
  accountId: number,
  req: BriefRequest,
): Promise<ForgeOutcome<BriefProposal>> {
  if (!deps.apiKey) {
    return { ok: false, error: 'suggestions are not configured on this server yet' };
  }
  const row = deps.store.getForged(req.id);
  if (!row || row.accountId !== accountId) {
    return { ok: false, error: 'no such champion on this account' };
  }
  if (row.status === 'finalized') {
    return { ok: false, error: 'this champion is sealed; unseal it to rework the whole thing' };
  }
  const badThread = threadError(req.messages);
  if (badThread !== null) return { ok: false, error: badThread };
  const first = req.messages[0];
  if (!first || first.text.trim() === '') {
    return { ok: false, error: 'say what the champion is, in one line' };
  }
  // The working def: what is on the form beats what was last saved, but
  // identity of the ROW (its id and creator) is never the client's.
  let base = row.def;
  if (req.def !== undefined) {
    if (typeof req.def !== 'object' || req.def === null) {
      return { ok: false, error: 'malformed form state' };
    }
    base = { ...(req.def as ForgedChampionDef), id: row.def.id, creator: row.def.creator };
  }
  // Priced per player message like the conversations, and checked before
  // any of it runs: the retries inside are the server's problem, not a
  // second bill (ADR 0017).
  const price = EMBER_PRICES.kitTurn;
  const held = deps.store.creditBalance(accountId);
  if (held < price) {
    return { ok: false, error: `this costs ${price} embers and you have ${held}` };
  }

  const apiMessages = toApiMessages(req.messages, formState(base));
  const progress = req.onProgress ?? (() => {});
  let stage =
    req.messages.length > 1
      ? 'Reworking the champion'
      : 'Reading your line and inventing the champion';
  let lastErrors: readonly string[] = [];
  for (let attempt = 0; attempt < SUGGEST_ATTEMPTS; attempt += 1) {
    progress({ kind: 'stage', text: stage });
    let answer: string;
    try {
      answer = await askModel(
        deps,
        apiMessages,
        (delta) => progress({ kind: 'text', text: delta }),
        (usage) => {
          const at = (deps.now ?? Date.now)();
          deps.store.addSpendSample(usageSample('agent', 'kit', accountId, at, usage));
          // Debited on the answer, never on the ask: a call that never
          // reached the model is a call the creator never made.
          deps.store.addCreditEntry({
            accountId,
            delta: -price,
            reason: 'spend',
            ref: req.id,
            at,
          });
        },
      );
    } catch (err) {
      const e = err as Error;
      const why =
        e.name === 'TimeoutError' ? 'the model took too long to answer; try again' : e.message;
      return { ok: false, error: `the brief call failed: ${why}` };
    }
    progress({ kind: 'stage', text: 'Fitting the envelopes and checking the rules' });
    const retry = (feedback: string, next: string): void => {
      apiMessages.push({ role: 'assistant', content: answer }, { role: 'user', content: feedback });
      stage = next;
    };
    const suggestion = parseBrief(answer);
    if (!suggestion) {
      lastErrors = ['the answer was not the requested JSON object'];
      retry(
        'That was not the requested JSON object; answer with ONLY the JSON.',
        'The answer was not a champion, asking again',
      );
      continue;
    }
    const foreign = foreignNames(suggestion);
    if (foreign.length > 0) {
      lastErrors = [`names not in English: ${foreign.join(', ')}`];
      retry(
        `These names are not plain English: ${foreign.join(', ')}. Rewrite them in English ` +
          '(ASCII letters only), keep everything else, and answer with ONLY the JSON object.',
        'The names were not English, asking again',
      );
      continue;
    }
    const blocked = findBlockedWord(authoredText(suggestion));
    if (blocked !== null) {
      lastErrors = [`a word that cannot go on a card: ${blocked}`];
      retry(
        `The word '${blocked}' cannot appear on a champion card. Rewrite whatever carries ` +
          'it, keep everything else, and answer with ONLY the JSON object.',
        'A word could not go on a card, asking again',
      );
      continue;
    }
    const role = FORGED_ROLES.find((r) => r.toLowerCase() === suggestion.role.toLowerCase());
    if (!role) {
      lastErrors = [`unknown role: ${suggestion.role}`];
      retry(
        `'${suggestion.role}' is not a role. Use exactly one of ${FORGED_ROLES.join(', ')}, ` +
          'keep everything else, and answer with ONLY the JSON object.',
        'The role was not one of ours, asking again',
      );
      continue;
    }
    // Both fits, then one validation on the whole champion: the kit's
    // amounts scaled to its envelope line, the body's points to theirs.
    // A shape that cannot be scaled at all is left as written for the
    // validator to describe.
    const statFit = fitStats(suggestion.base, suggestion.growth);
    const drafted: ForgedChampionDef = {
      ...base,
      name: suggestion.name,
      title: suggestion.title,
      tagline: suggestion.tagline,
      role,
      passive: suggestion.passive,
      abilities: suggestion.abilities,
      base: statFit.base,
      growth: statFit.growth,
    };
    let kitFit: ReturnType<typeof fitKitPower> = null;
    try {
      kitFit = fitKitPower(drafted);
    } catch {
      kitFit = null;
    }
    const candidate: ForgedChampionDef = kitFit
      ? { ...drafted, abilities: kitFit.abilities }
      : drafted;
    const v = validateForged(candidate);
    if (!v.ok) {
      lastErrors = v.errors;
      retry(
        `Your champion failed validation with these errors, fix them precisely: ${v.errors.join('; ')}`,
        'The champion broke a rule, asking for a fix',
      );
      continue;
    }
    const bill = budgetOf(candidate);
    const spend = envelopeSpend(bill);
    return {
      ok: true,
      comment: suggestion.comment,
      name: candidate.name,
      title: candidate.title,
      tagline: candidate.tagline,
      role,
      splash: suggestion.splash,
      passive: candidate.passive,
      abilities: candidate.abilities,
      base: candidate.base,
      growth: candidate.growth,
      raw: answer.slice(0, CHAT_RAW_TEXT_MAX),
      budget: {
        kit: { spend: Math.round(kitSpendOf(bill)), cap: KIT_ENVELOPE },
        stats: { spend: Math.round(spend.stats), cap: ENVELOPES.stats },
        growth: { spend: Math.round(spend.growth), cap: ENVELOPES.growth },
      },
      fit: {
        kit: kitFit?.factor ?? 1,
        stats: statFit.factor.stats,
        growth: statFit.factor.growth,
      },
      held: kitFit?.held ?? [],
    };
  }
  return {
    ok: false,
    error: `the brief did not clear validation: ${lastErrors.slice(0, 3).join('; ')}`,
  };
}
