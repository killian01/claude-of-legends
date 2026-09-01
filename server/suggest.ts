// The Forge's kit suggestion surface (plan phase 4's agent seam,
// reshaped by the playtest ask): from the champion's own chosen splash
// art, propose a themed kit (passive plus Q W E R) the creator reviews
// in the editor. The model writes JSON against the same declarative
// grammar the sim executes, and NOTHING lands unchecked: the patched
// def must clear validateForged (structure, bounds, telegraphs, power
// budget), with one retry carrying the validator's errors back. Nothing
// is stored here: the suggestion returns to the editor as draft
// content, and the player saves it like any hand edit. Metered on the
// 'agent' quota that has waited for this surface.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AbilityDef } from '../src/sim/combat/casting';
import { ABILITY_BOUNDS } from '../src/sim/forge/bounds';
import type { ForgedChampionDef, ForgedPassiveRef } from '../src/sim/forge/forged_def';
import { PASSIVE_TEMPLATE_LIST } from '../src/sim/forge/passive_templates';
import { validateForged } from '../src/sim/forge/validate';
import type { ForgeOutcome } from './forge';
import type { ForgeStore } from './forge_store';

export interface SuggestDeps {
  store: ForgeStore;
  // Absent key: the surface answers honestly instead of pretending.
  apiKey: string | null;
  assetsDir: string;
  model?: string;
  // Injectable for tests; production uses global fetch.
  fetchFn?: typeof fetch;
  readImage?: (absPath: string) => Buffer;
}

export const SUGGEST_MODEL_DEFAULT = 'claude-sonnet-5';

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
ultimate: bigger, longer cooldown. The whole kit must fit a power
budget: modest numbers on three spells buy one signature spell.
`;

function templateCatalog(): string {
  return PASSIVE_TEMPLATE_LIST.map(
    (t) =>
      `${t.id}: ${t.summary} params: ${t.params
        .map((p) => `${p.key} ${p.min}..${p.max}${p.integer ? ' int' : ''}`)
        .join(', ')}`,
  ).join('\n');
}

function prompt(def: ForgedChampionDef, errors: readonly string[] | null): string {
  const intro =
    'You design a champion kit for a small deterministic MOBA. The image is the ' +
    "champion's splash art, the creator's own visual anchor: read its theme " +
    '(weapon, element, silhouette, mood) and propose a kit that matches it.';
  const task =
    'Answer with ONLY a JSON object, no prose: { "passive": { "template": id, ' +
    '"params": {..}, "name": string }, "abilities": { "Q": Ability, "W": Ability, ' +
    '"E": Ability, "R": Ability } }. Spell names must be original English, no ' +
    'borrowed game IP.';
  const bounds = `Numeric bounds per ability field: ${JSON.stringify(ABILITY_BOUNDS)} (cooldown uses basicCooldown for Q W E and ultCooldown for R).`;
  const current = `The champion today (name, role, stats stay as they are; you rework passive and abilities): ${JSON.stringify(
    {
      name: def.name,
      title: def.title,
      role: def.role,
      base: def.base,
      abilities: def.abilities,
      passive: def.passive,
    },
  )}`;
  const fix = errors
    ? `Your previous answer failed validation with these errors, fix them precisely: ${errors.join('; ')}`
    : '';
  return [
    intro,
    GRAMMAR,
    `Passive templates (pick ONE):\n${templateCatalog()}`,
    bounds,
    current,
    task,
    fix,
  ]
    .filter((s) => s !== '')
    .join('\n\n');
}

interface Suggestion {
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
    return raw as Suggestion;
  } catch {
    return null;
  }
}

async function askModel(deps: SuggestDeps, text: string, image: Buffer, mediaType: string) {
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
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: image.toString('base64') },
            },
            { type: 'text', text },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`suggestion service answered ${res.status}`);
  const body = (await res.json()) as { content?: { type: string; text?: string }[] };
  return body.content?.find((c) => c.type === 'text')?.text ?? '';
}

export async function suggestKit(
  deps: SuggestDeps,
  accountId: number,
  id: string,
): Promise<ForgeOutcome<{ passive: ForgedPassiveRef; abilities: Suggestion['abilities'] }>> {
  if (!deps.apiKey) {
    return { ok: false, error: 'suggestions are not configured on this server yet' };
  }
  const row = deps.store.getForged(id);
  if (!row || row.accountId !== accountId) {
    return { ok: false, error: 'no such champion on this account' };
  }
  if (row.status === 'finalized') {
    return { ok: false, error: 'the kit is sealed; suggestions rework drafts only' };
  }
  const splash = deps.store.chosenArt(id, 'splash');
  if (!splash) {
    return { ok: false, error: 'make and pick the splash art first: the kit derives from it' };
  }
  const read = deps.readImage ?? ((p: string) => readFileSync(p));
  let image: Buffer;
  try {
    image = read(path.join(deps.assetsDir, splash.path));
  } catch {
    return { ok: false, error: 'the chosen splash file is missing on this server' };
  }
  const mediaType = splash.path.toLowerCase().endsWith('.jpg') ? 'image/jpeg' : 'image/png';

  let errors: readonly string[] | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let text: string;
    try {
      text = await askModel(deps, prompt(row.def, errors), image, mediaType);
    } catch (err) {
      return { ok: false, error: `the suggestion call failed: ${(err as Error).message}` };
    }
    const suggestion = parseSuggestion(text);
    if (!suggestion) {
      errors = ['the answer was not the requested JSON object'];
      continue;
    }
    const candidate: ForgedChampionDef = {
      ...row.def,
      passive: suggestion.passive,
      abilities: suggestion.abilities,
    };
    const v = validateForged(candidate);
    if (v.ok) return { ok: true, passive: suggestion.passive, abilities: suggestion.abilities };
    errors = v.errors;
  }
  return {
    ok: false,
    error: `the suggestion did not clear validation: ${(errors ?? []).slice(0, 3).join('; ')}`,
  };
}
