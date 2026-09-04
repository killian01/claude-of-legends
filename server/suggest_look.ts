// The Forge's look conversation, the kit and stat conversations' third
// sibling: the creator says what their spells should LOOK like and each
// answer proposes one spell look per key (src/sim/spell_look.ts), the
// bounded visual vocabulary the renderer draws. Nothing here generates an
// asset and nothing is downloaded: a look is data on the ability, so it
// costs a model call and no provider, travels with the definition to
// every client and into replays, and the creator can keep asking for
// another until it reads right.
//
// Why it exists: the authored VFX catalog is code keyed by champion id,
// so a forged champion can never appear in it and every forged spell
// falls back to one of six school colors. The look is the only art a
// champion invented after the client shipped can wear.
// Metered on the 'agent' quota: one player message, one unit, however
// many internal retries.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AbilityDef, CastSpec } from '../src/sim/combat/casting';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { validateForged } from '../src/sim/forge/validate';
import {
  LOOK_BODIES,
  LOOK_BOUNDS,
  LOOK_BURSTS,
  LOOK_EDGES,
  LOOK_FLOORS,
  LOOK_MARKS,
  LOOK_TRAILS,
  LOOK_WINDUPS,
  LOOK_ZONE_MOTIONS,
  type SpellLook,
  spellLookErrors,
} from '../src/sim/spell_look';
import type { AbilityKey } from '../src/sim/types';
import type { ForgeOutcome } from './forge';
import {
  type ApiMessage,
  askModel,
  CHAT_RAW_TEXT_MAX,
  imageMediaType,
  SUGGEST_ATTEMPTS,
  type SuggestDeps,
  type SuggestRequest,
  threadError,
} from './suggest';

const KIT_KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];

// The vocabulary, printed from the sim's own lists so the prompt can
// never drift from what the validator accepts.
function vocabulary(): string {
  return [
    'A look is: { "palette"?: { "main": int, "glow": int }, "projectile"?: { "body": Body, ' +
      '"trail"?: Trail, "spin"?: n, "scale"?: n }, "cast"?: Burst, "impact"?: Burst, ' +
      '"zone"?: { "floor": Floor, "edge"?: Edge, "motion"?: Motion }, "detonate"?: Burst, ' +
      '"windup"?: { "motion": Windup } }.',
    'Burst is { "shape": Shape, "scale"?: n, "density"?: 0..1, "smoke"?: bool, "shake"?: n, ' +
      '"mark"?: Mark }.',
    `Body: ${LOOK_BODIES.join(', ')} ("bolt" keeps the plain tracer).`,
    `Trail: ${LOOK_TRAILS.join(', ')}.`,
    `Shape: ${LOOK_BURSTS.join(', ')}.`,
    `Floor: ${LOOK_FLOORS.join(', ')}. Edge: ${LOOK_EDGES.join(', ')}. ` +
      `Motion: ${LOOK_ZONE_MOTIONS.join(', ')}.`,
    `Windup: ${LOOK_WINDUPS.join(', ')}. Mark (the stain left on the ground): ` +
      `${LOOK_MARKS.join(', ')}.`,
    `Numeric rails: scale ${LOOK_BOUNDS.scale.min}..${LOOK_BOUNDS.scale.max}, density ` +
      `${LOOK_BOUNDS.density.min}..${LOOK_BOUNDS.density.max}, spin (turns per second) ` +
      `${LOOK_BOUNDS.spin.min}..${LOOK_BOUNDS.spin.max}, shake (camera trauma) ` +
      `${LOOK_BOUNDS.shake.min}..${LOOK_BOUNDS.shake.max}.`,
    'Colors are 24-bit RGB integers (write them in decimal or as 0x hex, both parse). ' +
      'Leave "palette" out to keep the color the game derives from the spell effects ' +
      '(burning spells read orange, healing green, crowd control gold, movement cyan, ' +
      'weapon damage bronze, everything else violet); set it when the champion has a color ' +
      'of its own that derivation would miss.',
  ].join('\n');
}

// Which parts of a look this delivery can actually show. A skillshot has
// a bolt in flight and a point of impact; a zone has a floor; an instant
// spell has only the flash at the caster. Telling the model what will be
// drawn is what keeps it from writing a projectile for a spell that has
// none.
function surfacesOf(a: AbilityDef): string[] {
  const spec = a.spec as CastSpec & { detonateDelay?: number };
  const parts: string[] = [];
  switch (spec.kind) {
    case 'skillshot':
      parts.push('projectile', 'impact');
      break;
    case 'zone':
      parts.push('zone');
      if (typeof spec.detonateDelay === 'number' && spec.detonateDelay > 0) {
        parts.push('detonate');
      }
      break;
    default:
      parts.push('cast');
      break;
  }
  if (typeof a.windup === 'number' && a.windup > 0) parts.push('windup');
  return parts;
}

// The kit as the look conversation needs to see it: what each spell does
// and what its delivery will put on screen.
function kitSummary(def: ForgedChampionDef): string {
  return KIT_KEYS.map((k) => {
    const a = def.abilities[k];
    const flavor = a.flavor ? ` flavor "${a.flavor}"` : '';
    return (
      `${k} ${a.name} (${a.spec.kind}${k === 'R' ? ', the ultimate' : ''}):${flavor} ` +
      `shows ${surfacesOf(a).join(' and ')}`
    );
  }).join('\n');
}

function preamble(def: ForgedChampionDef): string {
  const intro =
    'You art-direct the spell effects of a champion in a small top-down MOBA, in ' +
    "conversation with the champion's creator. The image is their chosen splash art: read " +
    'its theme (element, weapon, palette, mood) and give each of the four spells a look that ' +
    'reads as THIS champion at a glance, then rework your latest proposal as they ask.';
  const craft =
    'Craft rules: a spell must be readable in a fight before it is pretty, so keep shapes ' +
    'distinct between the four keys (do not give every spell the same burst), keep density ' +
    'low on spells that are cast often and spend the big shapes, smoke and shake on the ' +
    'ultimate. Only fill the parts a spell actually shows; anything you leave out keeps the ' +
    "game's own default, which is a fine answer for a plain spell.";
  const task =
    'Every answer is ONLY a JSON object, no prose around it: { "comment": string, "looks": ' +
    '{ "Q": Look, "W": Look, "E": Look, "R": Look } }. "comment" is one or two plain ' +
    'sentences to the creator about what you gave them or changed, in their own language. ' +
    'Compact JSON: no indentation, no line breaks.';
  return [
    intro,
    vocabulary(),
    craft,
    `The champion: ${JSON.stringify({ name: def.name, title: def.title, role: def.role })}.`,
    task,
  ].join('\n\n');
}

// The form as it stands, restated every turn: the creator may have
// reworked the kit since the conversation began, and a look follows what
// its spell became.
function formState(def: ForgedChampionDef): string {
  const looks = Object.fromEntries(KIT_KEYS.map((k) => [k, def.abilities[k].look ?? null]));
  return [
    `The kit on the form right now:\n${kitSummary(def)}`,
    `The looks on the form right now (null means the spell has none yet): ${JSON.stringify(looks)}`,
  ].join('\n\n');
}

interface LookSuggestion {
  comment: string;
  looks: Partial<Record<AbilityKey, SpellLook>>;
}

function parseLookSuggestion(text: string): LookSuggestion | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Partial<LookSuggestion>;
    if (typeof raw !== 'object' || raw === null) return null;
    if (typeof raw.looks !== 'object' || raw.looks === null) return null;
    const comment = typeof raw.comment === 'string' ? raw.comment.slice(0, 400) : '';
    return { comment, looks: raw.looks };
  } catch {
    return null;
  }
}

// The thread as the model sees it: the preamble and the splash ride the
// FIRST turn, the live form state the LAST.
function toApiMessages(
  turns: SuggestRequest['messages'],
  intro: string,
  state: string,
  image: Buffer | null,
  mediaType: string,
): ApiMessage[] {
  return turns.map((t, i) => {
    if (t.role === 'assistant') return { role: 'assistant', content: t.text };
    let text = i === 0 ? `${intro}\n\nThe creator says: ${t.text}` : t.text;
    if (i === turns.length - 1) text = `${text}\n\n${state}`;
    if (i > 0 || !image) return { role: 'user', content: text };
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

export interface LookProposal {
  comment: string;
  // One look per key; a key the model left out keeps what the form had.
  looks: Record<AbilityKey, SpellLook | null>;
  raw: string;
}

// The looks folded onto the def, so validateForged judges exactly what
// the editor would be applying.
function withLooks(
  def: ForgedChampionDef,
  looks: Partial<Record<AbilityKey, SpellLook>>,
): ForgedChampionDef {
  const abilities = { ...def.abilities };
  for (const k of KIT_KEYS) {
    const look = looks[k];
    if (look === undefined) continue;
    abilities[k] = look === null ? { ...abilities[k], look: undefined } : { ...abilities[k], look };
  }
  return { ...def, abilities };
}

export async function suggestLook(
  deps: SuggestDeps,
  accountId: number,
  req: SuggestRequest,
): Promise<ForgeOutcome<LookProposal>> {
  if (!deps.apiKey) {
    return { ok: false, error: 'suggestions are not configured on this server yet' };
  }
  const row = deps.store.getForged(req.id);
  if (!row || row.accountId !== accountId) {
    return { ok: false, error: 'no such champion on this account' };
  }
  // A look is pure presentation, but it rides the def and only the draft
  // save path carries it, so the seal closes this conversation like the
  // others. Repainting a finalized champion is a Reforge slice
  // (server/reforge.ts), not this route.
  if (row.status === 'finalized') {
    return { ok: false, error: 'the spells are sealed; looks are proposed on drafts only' };
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
  // The splash is the theme; without one the spells still get looks, read
  // from the kit alone.
  let image: Buffer | null = null;
  let mediaType = 'image/png';
  const splash = deps.store.chosenArt(req.id, 'splash');
  if (splash) {
    const read = deps.readImage ?? ((p: string) => readFileSync(p));
    try {
      image = read(path.join(deps.assetsDir, splash.path));
      mediaType = imageMediaType(image);
    } catch {
      image = null;
    }
  }

  const apiMessages = toApiMessages(
    req.messages,
    preamble(base),
    formState(base),
    image,
    mediaType,
  );
  let lastErrors: readonly string[] = [];
  const progress = req.onProgress ?? (() => {});
  let stage = 'Reading the kit and painting the spells';
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
    progress({ kind: 'stage', text: 'Checking the looks against the vocabulary' });
    const retry = (feedback: string, next: string): void => {
      apiMessages.push({ role: 'assistant', content: text }, { role: 'user', content: feedback });
      stage = next;
    };
    const suggestion = parseLookSuggestion(text);
    if (!suggestion) {
      lastErrors = ['the answer was not the requested JSON object'];
      retry(
        'That was not the requested JSON object; answer with ONLY the JSON.',
        'The answer was not a set of looks, asking again',
      );
      continue;
    }
    // The vocabulary check first, because its errors name the exact word
    // that was invented; the full gate after, so a look can never ride in
    // on a definition that would not validate.
    const wordErrors: string[] = [];
    for (const k of KIT_KEYS) {
      const look = suggestion.looks[k];
      if (look === undefined || look === null) continue;
      wordErrors.push(...spellLookErrors(look, `${k}.look`));
    }
    const candidate = withLooks(base, suggestion.looks);
    const v = validateForged(candidate);
    const errors = wordErrors.length > 0 ? wordErrors : v.ok ? [] : v.errors;
    if (errors.length > 0) {
      lastErrors = errors;
      retry(
        `These looks are not in the vocabulary, fix them precisely: ${errors.join('; ')}`,
        'A look used a word the game does not know, asking for a fix',
      );
      continue;
    }
    return {
      ok: true,
      comment: suggestion.comment,
      looks: Object.fromEntries(
        KIT_KEYS.map((k) => [k, candidate.abilities[k].look ?? null]),
      ) as Record<AbilityKey, SpellLook | null>,
      raw: text.slice(0, CHAT_RAW_TEXT_MAX),
    };
  }
  return {
    ok: false,
    error: `the looks did not clear the vocabulary: ${lastErrors.slice(0, 3).join('; ')}`,
  };
}
