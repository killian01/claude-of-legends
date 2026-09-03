// The Forge's kit form builders: generic editors for effect lists, cast
// specs, and predicates, driven by the same bounds tables the validator
// enforces (src/sim/forge/bounds.ts), so every input is born clamped to
// what the engine accepts. The editor mutates the working def in place
// and calls `refresh` so the budget meter answers every keystroke; the
// deterministic validator stays the sole authority, this UI only makes
// its rules visible early.

import type { CastSpec } from '../sim/combat/casting';
import type { EffectPredicate, EffectSpec } from '../sim/combat/effects';
import {
  type Bound,
  CAST_BOUNDS,
  EFFECT_BOUNDS,
  EFFECT_LIST_MAX,
  PREDICATE_BOUNDS,
} from '../sim/forge/bounds';

// Light refresh: numbers changed, recost the kit. Structural changes
// (kind swaps, list edits) rebuild their section through `rebuild`.
export interface KitHooks {
  refresh(): void;
  rebuild(): void;
}

// The editor keeps recursion shallower than the validator's cap: what it
// builds always fits.
const EDITOR_DEPTH_MAX = 3;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function clamp(v: number, bound: Bound): number {
  const c = Math.min(bound.max, Math.max(bound.min, v));
  return bound.integer ? Math.round(c) : c;
}

// A bound-clamped numeric field writing straight into `obj[key]`.
export function numField(
  label: string,
  obj: Record<string, unknown>,
  key: string,
  bound: Bound,
  hooks: KitHooks,
): HTMLElement {
  const wrap = el('label', 'fe-field');
  wrap.append(el('span', 'fe-field-label', label));
  const input = el('input', 'fe-num') as HTMLInputElement;
  input.type = 'number';
  input.min = String(bound.min);
  input.max = String(bound.max);
  input.step = bound.integer ? '1' : 'any';
  const initial = typeof obj[key] === 'number' ? (obj[key] as number) : clamp(0, bound);
  obj[key] = clamp(initial, bound);
  input.value = String(obj[key]);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    if (Number.isFinite(v)) {
      obj[key] = clamp(v, bound);
      hooks.refresh();
    }
  });
  input.addEventListener('blur', () => {
    input.value = String(obj[key]);
  });
  wrap.append(input);
  return wrap;
}

function selectField(
  label: string,
  options: readonly string[],
  value: string,
  onChange: (v: string) => void,
): HTMLElement {
  const wrap = el('label', 'fe-field');
  wrap.append(el('span', 'fe-field-label', label));
  const select = el('select', 'fe-select') as HTMLSelectElement;
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = o;
    select.append(opt);
  }
  select.value = value;
  select.addEventListener('change', () => onChange(select.value));
  wrap.append(select);
  return wrap;
}

function boolField(
  label: string,
  obj: Record<string, unknown>,
  key: string,
  hooks: KitHooks,
): HTMLElement {
  const wrap = el('label', 'fe-field fe-check');
  const input = el('input', '') as HTMLInputElement;
  input.type = 'checkbox';
  input.checked = obj[key] === true;
  input.addEventListener('change', () => {
    if (input.checked) obj[key] = true;
    else delete obj[key];
    hooks.refresh();
  });
  wrap.append(input, el('span', 'fe-field-label', label));
  return wrap;
}

// --- effects -------------------------------------------------------------

// Mid-of-the-road starting values so a freshly added effect is legal and
// visibly does something.
export function defaultEffect(kind: EffectSpec['kind']): EffectSpec {
  switch (kind) {
    case 'damage':
      return { kind, base: 60, adRatio: 0, apRatio: 0.5, dtype: 'magic' };
    case 'heal':
      return { kind, base: 40, apRatio: 0.3 };
    case 'slow':
      return { kind, pct: 0.25, duration: 1.5 };
    case 'root':
      return { kind, duration: 1 };
    case 'stun':
      return { kind, duration: 0.75 };
    case 'taunt':
      return { kind, duration: 1 };
    case 'stealth':
      return { kind, duration: 1.5 };
    case 'blind':
      return { kind, duration: 1, factor: 0.4 };
    case 'knockback':
      return { kind, distance: 1.5 };
    case 'pull':
      return { kind, distance: 3 };
    case 'knockup':
      return { kind, duration: 0.75 };
    case 'untargetable':
      return { kind, duration: 0.5 };
    case 'shield':
      return { kind, base: 80, apRatio: 0.4, duration: 2.5 };
    case 'dot':
      return { kind, duration: 2.5, perSecond: 15, dtype: 'magic' };
    case 'grievous':
      return { kind, duration: 1.5, factor: 0.3 };
    case 'buff':
      return { kind, duration: 2.5, msPct: 0.2, asPct: 0, armor: 0, mr: 0 };
    case 'mark':
      return {
        kind,
        duration: 4,
        stacksToTrigger: 3,
        onTrigger: [{ kind: 'damage', base: 60, apRatio: 0.4, dtype: 'magic' }],
      };
    case 'conditional':
      return {
        kind,
        when: { kind: 'targetSlowed' },
        effects: [{ kind: 'damage', base: 40, apRatio: 0.3, dtype: 'magic' }],
      };
    case 'cooldownRefund':
      return { kind, key: 'Q', pctOfRemaining: 0.5 };
    case 'empower':
      return {
        kind,
        duration: 3,
        bonus: [{ kind: 'damage', base: 40, adRatio: 0.3, dtype: 'magic' }],
        splashRadius: 0,
        splash: [],
      };
  }
}

const EFFECT_KINDS = Object.keys(EFFECT_BOUNDS) as EffectSpec['kind'][];
const DTYPES = ['physical', 'magic'] as const;

function predicateEditor(holder: { when: EffectPredicate }, hooks: KitHooks): HTMLElement {
  const box = el('div', 'fe-pred');
  const kinds = Object.keys(PREDICATE_BOUNDS);
  box.append(
    selectField('when', kinds, holder.when.kind, (v) => {
      const bounds = PREDICATE_BOUNDS[v] ?? {};
      const next: Record<string, unknown> = { kind: v };
      for (const [key, bound] of Object.entries(bounds)) next[key] = clamp(0, bound);
      holder.when = next as unknown as EffectPredicate;
      hooks.rebuild();
    }),
  );
  const bounds = PREDICATE_BOUNDS[holder.when.kind] ?? {};
  for (const [key, bound] of Object.entries(bounds)) {
    box.append(numField(key, holder.when as unknown as Record<string, unknown>, key, bound, hooks));
  }
  return box;
}

function effectRow(list: EffectSpec[], index: number, depth: number, hooks: KitHooks): HTMLElement {
  const fx = list[index] as EffectSpec & Record<string, unknown>;
  const row = el('div', 'fe-effect');
  const head = el('div', 'fe-effect-head');
  head.append(
    selectField('', EFFECT_KINDS, fx.kind, (v) => {
      list[index] = defaultEffect(v as EffectSpec['kind']);
      hooks.rebuild();
    }),
  );
  const remove = el('button', 'fe-mini', 'x');
  remove.title = 'Remove this effect';
  remove.addEventListener('click', () => {
    list.splice(index, 1);
    hooks.rebuild();
  });
  head.append(remove);
  row.append(head);

  const fields = el('div', 'fe-fields');
  for (const [key, bound] of Object.entries(EFFECT_BOUNDS[fx.kind] ?? {})) {
    fields.append(numField(key, fx, key, bound, hooks));
  }
  if (fx.kind === 'damage' || fx.kind === 'dot') {
    fields.append(
      selectField('dtype', DTYPES, String(fx.dtype), (v) => {
        fx.dtype = v as 'physical' | 'magic';
        hooks.refresh();
      }),
    );
  }
  if (fx.kind === 'knockback') {
    fields.append(
      selectField(
        'direction',
        ['away', 'aside', 'toCenter'],
        String(fx.direction ?? 'away'),
        (v) => {
          fx.direction = v as 'away' | 'aside' | 'toCenter';
          hooks.refresh();
        },
      ),
    );
  }
  if (fx.kind === 'cooldownRefund') {
    fields.append(
      selectField('key', ['Q', 'W', 'E', 'R'], String(fx.key), (v) => {
        fx.key = v as 'Q' | 'W' | 'E' | 'R';
        hooks.refresh();
      }),
    );
  }
  row.append(fields);

  if (depth < EDITOR_DEPTH_MAX) {
    if (fx.kind === 'mark') {
      row.append(nestedList('on trigger', fx, 'onTrigger', depth + 1, hooks));
    }
    if (fx.kind === 'conditional') {
      row.append(predicateEditor(fx as { when: EffectPredicate }, hooks));
      row.append(nestedList('then', fx, 'effects', depth + 1, hooks));
      row.append(nestedList('otherwise', fx, 'otherwise', depth + 1, hooks));
    }
    if (fx.kind === 'empower') {
      row.append(nestedList('attack bonus', fx, 'bonus', depth + 1, hooks));
      row.append(nestedList('splash', fx, 'splash', depth + 1, hooks));
    }
  }
  return row;
}

function nestedList(
  label: string,
  holder: Record<string, unknown>,
  key: string,
  depth: number,
  hooks: KitHooks,
): HTMLElement {
  if (!Array.isArray(holder[key])) holder[key] = [];
  return buildEffectListEditor(label, holder[key] as EffectSpec[], depth, hooks);
}

export function buildEffectListEditor(
  label: string,
  list: EffectSpec[],
  depth: number,
  hooks: KitHooks,
): HTMLElement {
  const box = el('div', 'fe-list');
  const head = el('div', 'fe-list-head');
  head.append(el('span', 'fe-list-label', label));
  const add = el('button', 'fe-mini', '+ effect');
  add.addEventListener('click', () => {
    if (list.length >= EFFECT_LIST_MAX) return;
    list.push(defaultEffect('damage'));
    hooks.rebuild();
  });
  head.append(add);
  box.append(head);
  for (let i = 0; i < list.length; i++) box.append(effectRow(list, i, depth, hooks));
  return box;
}

// --- cast specs ----------------------------------------------------------

export function defaultCast(kind: CastSpec['kind']): CastSpec {
  switch (kind) {
    case 'skillshot':
      return {
        kind,
        speed: 22,
        radius: 0.7,
        range: 9,
        onHit: [{ kind: 'damage', base: 70, apRatio: 0.8, dtype: 'magic' }],
      };
    case 'zone':
      return {
        kind,
        radius: 3,
        duration: 3,
        tickEvery: 0.5,
        onEnter: [],
        onTick: [{ kind: 'damage', base: 15, apRatio: 0.2, dtype: 'magic' }],
        allyOnTick: [],
      };
    case 'cone':
      return {
        kind,
        range: 4.5,
        halfAngle: Math.PI / 5,
        onHit: [{ kind: 'damage', base: 70, adRatio: 0.8, dtype: 'physical' }],
      };
    case 'burst':
      return {
        kind,
        radius: 3,
        effects: [{ kind: 'damage', base: 70, apRatio: 0.6, dtype: 'magic' }],
        selfEffects: [],
      };
    case 'self_or_ally':
      return { kind, searchRadius: 2.5, effects: [{ kind: 'shield', base: 80, duration: 2.5 }] };
    case 'enemy_target':
      return {
        kind,
        searchRadius: 2.5,
        effects: [{ kind: 'damage', base: 70, apRatio: 0.6, dtype: 'magic' }],
        selfEffects: [],
      };
    case 'dash':
      return {
        kind,
        range: 4.5,
        speed: 16,
        landRadius: 0,
        onLand: [],
        selfEffects: [],
        passThrough: [],
      };
    case 'wall':
      return { kind, length: 4, duration: 4 };
  }
}

const CAST_KINDS = Object.keys(CAST_BOUNDS) as CastSpec['kind'][];

// Which effect lists each delivery carries in the v1 editor (signature
// nests like chain, aftershock, and shield bursts wait for a later pass).
const CAST_LISTS: Record<CastSpec['kind'], readonly { key: string; label: string }[]> = {
  skillshot: [{ key: 'onHit', label: 'on hit' }],
  zone: [
    { key: 'onEnter', label: 'on enter' },
    { key: 'onTick', label: 'each tick (enemies)' },
    { key: 'allyOnTick', label: 'each tick (allies)' },
    { key: 'onDetonate', label: 'on detonate' },
  ],
  cone: [{ key: 'onHit', label: 'on hit' }],
  burst: [
    { key: 'effects', label: 'on enemies around' },
    { key: 'selfEffects', label: 'on self' },
  ],
  self_or_ally: [{ key: 'effects', label: 'on self or the nearest ally' }],
  enemy_target: [
    { key: 'effects', label: 'on the target' },
    { key: 'selfEffects', label: 'on self' },
  ],
  dash: [
    { key: 'onLand', label: 'on landing (radius below)' },
    { key: 'passThrough', label: 'on enemies crossed' },
    { key: 'selfEffects', label: 'on self' },
  ],
  wall: [],
};

export function buildCastEditor(holder: { spec: CastSpec }, hooks: KitHooks): HTMLElement {
  const box = el('div', 'fe-cast');
  const spec = holder.spec as CastSpec & Record<string, unknown>;
  box.append(
    selectField('delivery', CAST_KINDS, spec.kind, (v) => {
      holder.spec = defaultCast(v as CastSpec['kind']);
      hooks.rebuild();
    }),
  );
  const fields = el('div', 'fe-fields');
  for (const [key, bound] of Object.entries(CAST_BOUNDS[spec.kind] ?? {})) {
    // A dash without speed is an instant blink; the checkbox below owns it.
    if (spec.kind === 'dash' && key === 'speed' && spec.speed === undefined) continue;
    if (spec.kind === 'zone' && key === 'detonateDelay') continue;
    fields.append(numField(key, spec, key, bound, hooks));
  }
  if (spec.kind === 'skillshot') fields.append(boolField('pierces through', spec, 'pierce', hooks));
  if (spec.kind === 'zone') {
    fields.append(boolField('reveals its area', spec, 'reveal', hooks));
    const hasDetonate = spec.detonateDelay !== undefined;
    const toggle = el('label', 'fe-field fe-check');
    const input = el('input', '') as HTMLInputElement;
    input.type = 'checkbox';
    input.checked = hasDetonate;
    input.addEventListener('change', () => {
      if (input.checked) spec.detonateDelay = 1.2;
      else {
        delete spec.detonateDelay;
        spec.onDetonate = [];
      }
      hooks.rebuild();
    });
    toggle.append(input, el('span', 'fe-field-label', 'detonates after a fuse'));
    fields.append(toggle);
    if (hasDetonate) {
      const bound = CAST_BOUNDS.zone?.detonateDelay;
      if (bound) fields.append(numField('detonateDelay', spec, 'detonateDelay', bound, hooks));
    }
  }
  if (spec.kind === 'dash') {
    const toggle = el('label', 'fe-field fe-check');
    const input = el('input', '') as HTMLInputElement;
    input.type = 'checkbox';
    input.checked = spec.speed === undefined;
    input.addEventListener('change', () => {
      if (input.checked) delete spec.speed;
      else spec.speed = 16;
      hooks.rebuild();
    });
    toggle.append(input, el('span', 'fe-field-label', 'instant blink (no travel)'));
    fields.append(toggle);
  }
  box.append(fields);
  for (const entry of CAST_LISTS[spec.kind]) {
    if (spec.kind === 'zone' && entry.key === 'onDetonate' && spec.detonateDelay === undefined) {
      continue;
    }
    if (!Array.isArray(spec[entry.key])) spec[entry.key] = [];
    box.append(buildEffectListEditor(entry.label, spec[entry.key] as EffectSpec[], 1, hooks));
  }
  return box;
}
