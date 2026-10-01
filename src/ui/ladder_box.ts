// The ladder box, on the end screen and in the pause menu of a match that
// scores (ADR 0027): where the player stands on the ladder of every human,
// "You are #N on the ladder with P points", and for a Guest the name
// beside those points, with a field to change it. An account has no field:
// its name there is its account's. Reads /api/public/ladder (the reader's
// own place rides on it) and writes /api/ladder/name; a refusal is shown
// in the server's own words. The words are pure (ui/points_text.ts); this
// is the drawing, built with the caller's element maker so the HUD's
// classes stay in the HUD.

import {
  earnedText,
  type LadderPlace,
  NAME_SAVE,
  NAME_SAVED,
  nameHint,
  placeText,
} from './points_text';

export const LADDER_ROUTE = '/api/public/ladder';
export const NAME_ROUTE = '/api/ladder/name';
// The account name rules' ceiling (server/account_name.ts).
export const NAME_FIELD_MAX = 16;

export type SaveOutcome = { ok: true; name: string } | { ok: false; error: string };

function asPlace(raw: unknown): LadderPlace | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.points !== 'number' || typeof r.name !== 'string') return null;
  return {
    rank: typeof r.rank === 'number' ? r.rank : null,
    points: r.points,
    name: r.name,
    guest: r.guest === true,
    named: r.named === true,
  };
}

// The reader's own place, or null when the server does not know them (or
// does not answer).
export async function fetchPlace(
  get: typeof fetch = (input, init) => fetch(input, init),
): Promise<LadderPlace | null> {
  try {
    const res = await get(LADDER_ROUTE, { credentials: 'same-origin' });
    if (!res.ok) return null;
    return asPlace(((await res.json()) as { me?: unknown }).me);
  } catch {
    return null;
  }
}

export async function saveName(
  name: string,
  post: typeof fetch = (input, init) => fetch(input, init),
): Promise<SaveOutcome> {
  try {
    const res = await post(NAME_ROUTE, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const body = (await res.json()) as { name?: unknown; error?: unknown };
    if (res.ok && typeof body.name === 'string') return { ok: true, name: body.name };
    return {
      ok: false,
      error: typeof body.error === 'string' ? body.error : 'The name could not be saved.',
    };
  } catch {
    return { ok: false, error: 'The server did not answer. Try again in a moment.' };
  }
}

export interface LadderBox {
  root: HTMLElement;
  // Asks for the place again: the end screen and the pause menu call it
  // each time they open, so the numbers are the ones banked by then.
  refresh(): void;
  // The points this match has banked so far, said after the place. The
  // HUD calls it as points land, so the victory's, which can arrive with
  // the end screen already open, join the count there.
  setEarned(earned: number): void;
}

export interface LadderBoxOptions {
  fetchPlace?: () => Promise<LadderPlace | null>;
  saveName?: (name: string) => Promise<SaveOutcome>;
}

export function buildLadderBox(
  el: <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls: string,
    text?: string,
  ) => HTMLElementTagNameMap[K],
  opts: LadderBoxOptions = {},
): LadderBox {
  const root = el('div', 'hud-ladder');
  root.hidden = true;
  const line = el('b', 'hud-ladder-line');
  const place = el('span', '');
  const earned = el('span', 'hud-ladder-earned');
  line.append(place, earned);
  const hint = el('span', 'hud-ladder-hint');
  const field = el('input', 'hud-ladder-field');
  field.type = 'text';
  field.maxLength = NAME_FIELD_MAX;
  field.autocomplete = 'off';
  field.spellcheck = false;
  field.setAttribute('aria-label', 'Your name on the ladder');
  const save = el('button', 'hud-menu-btn', NAME_SAVE);
  const row = el('div', 'hud-ladder-row');
  row.append(field, save);
  const status = el('div', 'hud-ladder-status');
  root.append(line, hint, row, status);

  const show = (at: LadderPlace): void => {
    place.textContent = placeText(at);
    hint.textContent = nameHint(at);
    row.hidden = !at.guest;
    // Never under the fingers of someone typing.
    if (at.guest && document.activeElement !== field) field.value = at.name;
    root.hidden = false;
  };
  const refresh = (): void => {
    void (opts.fetchPlace ?? fetchPlace)().then((place) => {
      if (place) show(place);
    });
  };
  let busy = false;
  const submit = (): void => {
    if (busy) return;
    busy = true;
    save.disabled = true;
    status.textContent = '';
    status.className = 'hud-ladder-status';
    void (opts.saveName ?? saveName)(field.value.trim()).then((out) => {
      busy = false;
      save.disabled = false;
      if (out.ok) {
        field.value = out.name;
        status.textContent = NAME_SAVED;
        status.className = 'hud-ladder-status ok';
        refresh();
      } else {
        status.textContent = out.error;
        status.className = 'hud-ladder-status bad';
      }
    });
  };
  save.addEventListener('click', submit);
  // A field inside the match must not fire the game's keys; Enter saves.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    field.addEventListener(type, (e) => {
      e.stopPropagation();
      if (type === 'keydown' && (e as KeyboardEvent).key === 'Enter') submit();
    });
  }
  const setEarned = (points: number): void => {
    earned.textContent = earnedText(points);
  };
  return { root, refresh, setEarned };
}
