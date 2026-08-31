// The Forge editor, phase 4's playable slice, reworked as a guided studio
// (the Tripo-style flow, in the game's theme): three tabs in creation
// order. Design first (the splash art the whole champion derives from,
// with examples and the visible splash-to-model pipeline), then Spells
// (kit editing plus per-spell icon generation), then Tuning (stats and
// growth against the power budget). The right rail keeps the budget meter
// and the actions in creation order; a finalize that lands opens the 3D
// workshop on the fresh model.

import { registerForgedAssets } from '../game/forged_visuals';
import type { ChampionBaseStats, ChampionGrowth, ChampionRole } from '../sim/content/champions';
import { ABILITY_BOUNDS, BASE_STAT_BOUNDS, GROWTH_BOUNDS } from '../sim/forge/bounds';
import { budgetOf, POWER_BUDGET } from '../sim/forge/budget';
import type { ForgedDisplay } from '../sim/forge/display';
import type { ForgedChampionDef } from '../sim/forge/forged_def';
import { PASSIVE_TEMPLATE_LIST, PASSIVE_TEMPLATES } from '../sim/forge/passive_templates';
import { FORGED_ROLES, validateForged } from '../sim/forge/validate';
import type { AbilityKey } from '../sim/types';
import { buildCastEditor, defaultCast, type KitHooks, numField } from './forge_kit';
import { startMenuBackdrop } from './menu_backdrop';
import { openWorkshop } from './workshop';

const CSS = `
.fe, .fe * { box-sizing: border-box; }
.fe {
  position: absolute; inset: 0; z-index: 30; overflow: hidden;
  display: flex; flex-direction: column;
  background: radial-gradient(ellipse at center, #241c10 0%, #0f0a04 80%);
  font-family: system-ui, sans-serif; color: #d8cdb0; font-size: 12px;
}
.fe *::-webkit-scrollbar { width: 10px; height: 10px; }
.fe *::-webkit-scrollbar-track { background: #120d06; }
.fe *::-webkit-scrollbar-thumb { background: #4a3a1c; border-radius: 5px; }
.fe *::-webkit-scrollbar-thumb:hover { background: #a08030; }
.fe * { scrollbar-width: thin; scrollbar-color: #4a3a1c #120d06; }
.fe-head {
  position: relative; z-index: 1; display: flex; align-items: baseline; gap: 14px;
  padding: 14px 22px 10px; border-bottom: 1px solid #4a3a1c;
}
.fe-title { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: 1px; color: #e8cc74; }
.fe-sub { color: #97854f; font-size: 12px; }
.fe-back {
  margin-left: auto; padding: 6px 16px; border-radius: 6px; border: 1px solid #6b5a2e;
  background: #241c10; color: #d8cdb0; font-size: 13px; font-weight: 700; cursor: pointer;
}
.fe-back:hover { border-color: #d8b45a; }
.fe-tabs {
  position: relative; z-index: 1; display: flex; gap: 8px; padding: 10px 22px 0;
}
.fe-tab {
  padding: 9px 20px; border-radius: 8px 8px 0 0; border: 1px solid #4a3a1c;
  border-bottom: none; background: #16100a; color: #97854f;
  font-size: 13px; font-weight: 700; cursor: pointer; letter-spacing: 0.3px;
}
.fe-tab:hover { color: #d8cdb0; }
.fe-tab.on { background: #2c2210; color: #e8cc74; border-color: #6b5a2e; }
.fe-body { position: relative; z-index: 1; flex: 1; display: flex; gap: 14px; padding: 12px 22px; min-height: 0; }
.fe-rail { width: 210px; flex: none; overflow-y: auto; }
.fe-main { flex: 1; min-width: 0; overflow-y: auto; padding-right: 6px; }
.fe-side { width: 270px; flex: none; overflow-y: auto; }
.fe-panel {
  background: rgba(14, 10, 4, 0.85); border: 1px solid #4a3a1c; border-radius: 10px;
  padding: 12px 14px; margin-bottom: 10px;
}
.fe-panel h3 { margin: 0 0 8px; font-size: 12px; color: #c9a84a; letter-spacing: 0.6px; text-transform: uppercase; }
.fe-lead { color: #b0a37e; font-size: 12.5px; line-height: 1.5; margin: 0 0 10px; }
.fe-draft {
  display: block; width: 100%; text-align: left; margin-bottom: 6px; padding: 7px 9px;
  border-radius: 6px; border: 1px solid #4a3a1c; background: #1a130a; color: #d8cdb0;
  font-size: 12px; cursor: pointer;
}
.fe-draft:hover { border-color: #a08030; }
.fe-draft.picked { border-color: #d8b45a; background: #2c2210; }
.fe-draft small { display: block; color: #97854f; font-size: 10px; }
.fe-btn {
  display: block; width: 100%; margin-top: 8px; padding: 9px; border-radius: 6px;
  border: 1px solid #6b5a2e; background: #241c10; color: #e0d5b8;
  font-size: 13px; font-weight: 700; cursor: pointer;
}
.fe-btn:hover:not(:disabled) { border-color: #d8b45a; }
.fe-btn:disabled { opacity: 0.4; cursor: default; }
.fe-btn.primary { background: linear-gradient(180deg, #e8cc74 0%, #c9a84a 55%, #a07830 100%); color: #241a08; border-color: #f0deae; }
.fe-btn.danger { border-color: #7a3a2e; color: #e0a898; }
.fe-input {
  width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid #4a3a1c;
  background: #120d06; color: #e0d5b8; font-size: 13px; outline: none; margin-bottom: 6px;
}
.fe-input:focus { border-color: #d8b45a; }
.fe-hero { display: flex; gap: 10px; align-items: stretch; }
.fe-hero-input {
  flex: 1; padding: 12px 14px; border-radius: 8px; border: 1px solid #6b5a2e;
  background: #120d06; color: #e0d5b8; font-size: 14px; outline: none;
}
.fe-hero-input:focus { border-color: #d8b45a; }
.fe-gen {
  flex: none; padding: 12px 22px; border-radius: 8px; border: 1px solid #f0deae;
  background: linear-gradient(180deg, #e8cc74 0%, #c9a84a 55%, #a07830 100%);
  color: #241a08; font-size: 14px; font-weight: 800; cursor: pointer; letter-spacing: 0.3px;
}
.fe-gen:hover:not(:disabled) { filter: brightness(1.08); }
.fe-gen:disabled { opacity: 0.5; cursor: default; }
.fe-gen.small { padding: 8px 14px; font-size: 12px; }
.fe-heromess { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.fe-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; align-items: center; }
.fe-chip {
  padding: 4px 11px; border-radius: 999px; border: 1px solid #4a3a1c; background: #1a130a;
  color: #b0a37e; font-size: 11px; cursor: pointer;
}
.fe-chip:hover { border-color: #a08030; color: #d8cdb0; }
.fe-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.fe-step { border: 1px solid #33270f; border-radius: 8px; background: rgba(26, 19, 10, 0.6); padding: 8px; }
.fe-step-num { color: #c9a84a; font-weight: 800; font-size: 10.5px; letter-spacing: 0.6px; text-transform: uppercase; }
.fe-step-thumb {
  height: 92px; display: flex; align-items: center; justify-content: center;
  margin: 6px 0; border-radius: 6px; background: #120d06; overflow: hidden;
  color: #6b5a2e; font-size: 22px; font-weight: 800;
}
.fe-step-thumb img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
.fe-step-text { color: #97854f; font-size: 10.5px; line-height: 1.45; }
.fe-field { display: inline-flex; align-items: center; gap: 5px; margin: 2px 8px 2px 0; }
.fe-field-label { color: #97854f; font-size: 11px; }
.fe-num { width: 74px; padding: 4px 6px; border-radius: 5px; border: 1px solid #4a3a1c; background: #120d06; color: #e0d5b8; font-size: 12px; }
.fe-select { padding: 4px 6px; border-radius: 5px; border: 1px solid #4a3a1c; background: #120d06; color: #e0d5b8; font-size: 12px; }
.fe-check input { accent-color: #c9a84a; }
.fe-fields { margin: 4px 0; }
.fe-list { border-left: 2px solid #4a3a1c; margin: 8px 0 8px 2px; padding-left: 10px; }
.fe-list-head { display: flex; align-items: center; gap: 8px; }
.fe-list-label { color: #c9a84a; font-size: 11px; font-weight: 700; }
.fe-mini {
  padding: 2px 8px; border-radius: 5px; border: 1px solid #4a3a1c; background: #1a130a;
  color: #d8cdb0; font-size: 11px; cursor: pointer;
}
.fe-mini:hover { border-color: #a08030; }
.fe-effect { margin: 6px 0; padding: 6px 8px; border: 1px solid #33270f; border-radius: 8px; background: rgba(26, 19, 10, 0.6); }
.fe-effect-head { display: flex; align-items: center; gap: 8px; }
.fe-pred { margin: 4px 0; padding-left: 6px; }
.fe-cast { margin-top: 6px; }
.fe-ability { margin-bottom: 12px; }
.fe-ability-head { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; }
.fe-key {
  width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: 6px; background: #2c2210; border: 1px solid #6b5a2e; color: #e8cc74; font-weight: 800;
}
.fe-meter-bar { height: 14px; border-radius: 7px; background: #1a130a; border: 1px solid #4a3a1c; overflow: hidden; margin: 6px 0; }
.fe-meter-fill { height: 100%; background: linear-gradient(90deg, #7ca050, #c9a84a); transition: width 0.15s ease; }
.fe-meter-fill.over { background: linear-gradient(90deg, #c9a84a, #d06a6a); }
.fe-cost-line { display: flex; justify-content: space-between; padding: 1px 0; color: #b0a37e; }
.fe-cost-line span:last-child { color: #d8cdb0; }
.fe-errors { color: #d06a6a; font-size: 11px; margin-top: 8px; line-height: 1.5; max-height: 30vh; overflow-y: auto; }
.fe-ok { color: #8fd06a; font-weight: 700; margin-top: 8px; }
.fe-status { min-height: 16px; color: #aac2dd; margin-top: 8px; font-size: 11px; }
.fe-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; }
.fe-desc { color: #97854f; font-style: italic; margin-top: 4px; line-height: 1.4; }
.fe-strip { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.fe-cand {
  padding: 0; border: 2px solid #4a3a1c; border-radius: 8px; background: #120d06;
  cursor: pointer; overflow: hidden; line-height: 0; position: relative;
}
.fe-cand:hover { border-color: #a08030; }
.fe-cand.chosen { border-color: #d8b45a; box-shadow: 0 0 8px rgba(216, 180, 90, 0.45); }
.fe-cand.chosen::after {
  content: 'PICKED'; position: absolute; left: 0; right: 0; bottom: 0;
  background: rgba(216, 180, 90, 0.9); color: #241a08; font-size: 9px; font-weight: 800;
  text-align: center; padding: 2px 0; letter-spacing: 1px; line-height: 1.2;
}
.fe-cand img { display: block; object-fit: cover; }
.fe-cand.splash img { width: 104px; height: 138px; }
.fe-cand.icon img { width: 44px; height: 44px; }
.fe-artrow { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.fe-artrow .fe-mini { flex: none; }
.fe-iconblock {
  display: flex; align-items: center; gap: 10px; margin-top: 8px; padding: 8px 10px;
  border: 1px dashed #4a3a1c; border-radius: 8px;
}
.fe-icon-preview { display: flex; align-items: center; gap: 6px; }
.fe-icon-preview img { border-radius: 4px; border: 1px solid #4a3a1c; }
.fe-quota { color: #97854f; font-size: 11px; margin-left: auto; }
.fe-model-cta { display: flex; gap: 12px; align-items: center; }
.fe-model-cta img { width: 96px; height: 72px; object-fit: cover; border-radius: 6px; border: 1px solid #4a3a1c; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

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

interface DraftRow {
  id: string;
  def: ForgedChampionDef;
  status: 'draft' | 'finalized';
  updatedAt: number;
  // Relative asset paths the server enriches the row with; the splash on
  // any row that has one, model, sheet, family and display once finalized.
  splash?: string | null;
  model?: string | null;
  sheet?: string | null;
  family?: string | null;
  display?: ForgedDisplay | null;
}

// One 2D candidate (splash or spell icon) as the art routes answer it.
interface ArtCandidate {
  cid: number;
  kind: string;
  path: string;
  chosen: boolean;
  at: number;
}

// Example splash lines, clickable chips beside the prompt: they show the
// shape of a line that works (silhouette, weapon, mood, one accent color).
const EXAMPLE_LINES = [
  'A moss-covered forest witch with a crooked wooden staff, calm and ancient, deep green',
  'A brass clockwork duelist with one oversized gauntlet, proud, copper and teal',
  'A storm-called spear fighter wrapped in torn sails, lean and quick, pale lightning blue',
] as const;

// Identity rides the session cookie (ADR 0006), never a token in the URL.
async function api<T>(url: string, body?: unknown): Promise<T | null> {
  try {
    const res = await fetch(
      url,
      body === undefined
        ? { credentials: 'same-origin' }
        : {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
    );
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// A fresh draft: legal out of the box, middle of the road everywhere, so
// the first minutes are spent shaping, not fixing.
export function newDraft(): ForgedChampionDef {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const suffix = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return {
    id: `forged_${suffix}`,
    name: 'New Champion',
    title: '',
    tagline: '',
    role: 'Fighter',
    creator: '',
    passive: { template: 'kit_inscribed', params: {}, name: 'Unwritten' },
    base: {
      hp: 580,
      mana: 350,
      ad: 55,
      ap: 0,
      armor: 25,
      mr: 30,
      attackRange: 5.5,
      attackSpeed: 0.65,
      moveSpeed: 3.7,
      hpRegen: 1.5,
      manaRegen: 1.4,
      radius: 0.65,
    },
    growth: { hp: 90, mana: 35, ad: 4, armor: 2.5, mr: 1.5 },
    abilities: {
      Q: {
        name: 'First Strike',
        manaCost: 40,
        cooldown: 6,
        castRange: 9,
        spec: defaultCast('skillshot'),
      },
      W: {
        name: 'Second Wind',
        manaCost: 50,
        cooldown: 10,
        castRange: 7,
        spec: defaultCast('zone'),
      },
      E: {
        name: 'Third Step',
        manaCost: 35,
        cooldown: 9,
        castRange: 4.5,
        spec: defaultCast('dash'),
      },
      R: {
        name: 'The Answer',
        manaCost: 85,
        cooldown: 70,
        castRange: 8,
        spec: {
          kind: 'zone',
          radius: 3.5,
          duration: 1.5,
          detonateDelay: 1.2,
          onEnter: [],
          onTick: [],
          allyOnTick: [],
          onDetonate: [
            { kind: 'damage', base: 180, apRatio: 1, dtype: 'magic' },
            { kind: 'stun', duration: 0.9 },
          ],
        },
      },
    },
  };
}

type EditorTab = 'design' | 'spells' | 'tuning';

export function openForgeEditor(container: HTMLElement): void {
  ensureCss();
  const root = el('div', 'fe');
  const stopBackdrop = startMenuBackdrop(root);
  const close = (): void => {
    window.removeEventListener('keydown', onKey);
    stopBackdrop();
    root.remove();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  window.addEventListener('keydown', onKey);

  const head = el('div', 'fe-head');
  const back = el('button', 'fe-back', 'Back');
  back.addEventListener('click', close);
  head.append(
    el('h1', 'fe-title', 'The Forge'),
    el('span', 'fe-sub', 'Design the art, shape the kit, tune the numbers'),
    back,
  );

  // The three tabs, in creation order.
  let tab: EditorTab = 'design';
  const tabs = el('div', 'fe-tabs');
  const tabButtons = new Map<EditorTab, HTMLButtonElement>();
  const TAB_DEFS: readonly { key: EditorTab; label: string }[] = [
    { key: 'design', label: '1. Design' },
    { key: 'spells', label: '2. Spells' },
    { key: 'tuning', label: '3. Tuning' },
  ];
  for (const { key, label } of TAB_DEFS) {
    const btn = el('button', 'fe-tab', label) as HTMLButtonElement;
    btn.addEventListener('click', () => {
      tab = key;
      for (const [k, b] of tabButtons) b.classList.toggle('on', k === tab);
      renderMain();
    });
    tabButtons.set(key, btn);
    tabs.append(btn);
  }
  tabButtons.get('design')?.classList.add('on');

  const body = el('div', 'fe-body');
  const rail = el('div', 'fe-rail');
  const main = el('div', 'fe-main');
  const side = el('div', 'fe-side');
  body.append(rail, main, side);
  root.append(head, tabs, body);
  container.appendChild(root);

  let drafts: DraftRow[] = [];
  let current: ForgedChampionDef = newDraft();
  const status = el('div', 'fe-status', '');

  // --- 2D art state (plan-forge phase 4): candidates and the gen2d meter --

  let artCandidates: ArtCandidate[] = [];
  let artQuota = { used: 0, limit: 0 };
  // The champion line typed per art kind, kept across rerenders.
  const artLines: Record<string, string> = {};

  const loadArt = async (): Promise<void> => {
    const r = await api<{
      ok: boolean;
      candidates?: ArtCandidate[];
      quota?: { used: number; limit: number };
    }>(`/api/forge/art?id=${encodeURIComponent(current.id)}`);
    artCandidates = r?.ok && r.candidates ? r.candidates : [];
    artQuota = r?.ok && r.quota ? r.quota : { used: 0, limit: 0 };
  };

  const currentRow = (): DraftRow | undefined => drafts.find((d) => d.id === current.id);
  const isSealed = (): boolean => currentRow()?.status === 'finalized';

  // Save what is on screen (art hangs off a stored draft), generate, then
  // reload the strip. The request is held open for the image: one 2D
  // generation is seconds, not a finalize chain.
  const generateArtKind = (kind: string, line: string): void => {
    status.textContent = 'Generating the image...';
    void api<{ ok: boolean; error?: string }>('/api/forge/draft', { def: current })
      .then((saved) => {
        if (!saved?.ok) throw new Error(saved?.error ?? 'save failed');
        return api<{
          ok: boolean;
          error?: string;
          quota?: { used: number; limit: number };
        }>('/api/forge/art/generate', { id: current.id, kind, line });
      })
      .then((out) => {
        if (!out?.ok) {
          status.textContent = out?.error ?? 'generation failed';
          return;
        }
        status.textContent = out.quota
          ? `Generated. ${out.quota.used}/${out.quota.limit} images today.`
          : 'Generated.';
        void loadDrafts();
        return loadArt().then(() => {
          renderMain();
        });
      })
      .catch((err: unknown) => {
        status.textContent = err instanceof Error ? err.message : 'generation failed';
      });
  };

  const pickArt = (cid: number): void => {
    void api<{ ok: boolean; error?: string }>('/api/forge/art/pick', {
      id: current.id,
      cid,
    }).then((r) => {
      if (!r?.ok) {
        status.textContent = r?.error ?? 'pick failed';
        return;
      }
      return loadArt().then(() => {
        renderMain();
      });
    });
  };

  const artStrip = (kind: string, big: boolean): HTMLElement => {
    const sealed = isSealed();
    const strip = el('div', 'fe-strip');
    for (const c of artCandidates.filter((x) => x.kind === kind)) {
      const btn = el('button', `fe-cand ${big ? 'splash' : 'icon'}`) as HTMLButtonElement;
      btn.classList.toggle('chosen', c.chosen);
      const img = document.createElement('img');
      img.src = `/api/forge/asset/${c.path}`;
      img.alt = '';
      btn.appendChild(img);
      btn.title = sealed ? 'Sealed at finalization' : c.chosen ? 'The pick' : 'Use this one';
      if (!sealed) btn.addEventListener('click', () => pickArt(c.cid));
      strip.appendChild(btn);
    }
    return strip;
  };

  const chosenSplashUrl = (): string | null => {
    const c = artCandidates.find((x) => x.kind === 'splash' && x.chosen);
    return c ? `/api/forge/asset/${c.path}` : null;
  };

  // The workshop over the current champion's model; only exists finalized.
  const openWorkshopHere = (): void => {
    const row = currentRow();
    if (!row?.model) return;
    openWorkshop(container, {
      id: current.id,
      name: current.name,
      title: current.title,
      modelUrl: `/api/forge/asset/${row.model}`,
      splashUrl: row.splash ? `/api/forge/asset/${row.splash}` : null,
      sheetUrl: row.sheet ? `/api/forge/asset/${row.sheet}` : null,
      family: row.family ?? null,
      display: row.display ?? null,
      editable: true,
      onSaved: (display) => {
        row.display = display;
        registerForgedAssets(row.id, row);
      },
    });
  };

  // --- right rail: the budget meter, verdict, and actions ---------------

  const meterFill = el('div', 'fe-meter-fill');
  const meterLine = el('div', 'fe-cost-line');
  const costBox = el('div', '');
  const verdict = el('div', 'fe-errors');
  const testBtn = el('button', 'fe-btn', 'Test drive (practice)') as HTMLButtonElement;
  const saveBtn = el('button', 'fe-btn primary', 'Save draft') as HTMLButtonElement;
  const finalizeBtn = el('button', 'fe-btn', 'Finalize (spends a creation)') as HTMLButtonElement;
  const deleteBtn = el('button', 'fe-btn danger', 'Delete draft') as HTMLButtonElement;

  const refresh = (): void => {
    const v = validateForged(current);
    const cost = v.cost ?? (v.ok ? v.cost : null);
    const bill = cost ?? budgetOf(current);
    const pct = Math.min(100, (100 * bill.total) / POWER_BUDGET);
    meterFill.style.width = `${pct}%`;
    meterFill.classList.toggle('over', bill.total > POWER_BUDGET);
    meterLine.textContent = '';
    meterLine.append(
      el('span', '', 'Power budget'),
      el('span', '', `${Math.round(bill.total)} / ${POWER_BUDGET}`),
    );
    costBox.textContent = '';
    const rows: [string, number][] = [
      ['Stats', bill.stats],
      ['Growth', bill.growth],
      ['Q', bill.abilities.Q],
      ['W', bill.abilities.W],
      ['E', bill.abilities.E],
      ['R', bill.abilities.R],
      ['Passive', bill.passive],
    ];
    for (const [label, value] of rows) {
      const line = el('div', 'fe-cost-line');
      line.append(el('span', '', label), el('span', '', String(Math.round(value))));
      costBox.append(line);
    }
    verdict.className = v.ok ? 'fe-ok' : 'fe-errors';
    verdict.textContent = v.ok
      ? 'Fits the budget: playable as is.'
      : v.errors.slice(0, 8).join('\n');
    testBtn.disabled = !v.ok;
    testBtn.title = v.ok ? '' : 'The kit must fully validate before a test drive';
    finalizeBtn.disabled = !v.ok;
    finalizeBtn.title = v.ok ? '' : 'Finalize needs a fully valid champion';
    // style.display, not the hidden attribute: .fe-btn sets display and
    // author CSS beats the attribute's user-agent rule.
    workshopBtn.style.display = currentRow()?.model ? '' : 'none';
  };

  const hooks: KitHooks = {
    refresh,
    rebuild: () => {
      renderMain();
      refresh();
    },
  };

  saveBtn.addEventListener('click', () => {
    status.textContent = 'Saving...';
    void api<{ ok: boolean; error?: string }>('/api/forge/draft', { def: current }).then((r) => {
      status.textContent = r?.ok ? 'Draft saved.' : (r?.error ?? 'save failed');
      if (r?.ok) void loadDrafts();
    });
  });
  deleteBtn.addEventListener('click', () => {
    void api<{ ok: boolean; error?: string }>('/api/forge/draft/delete', { id: current.id }).then(
      (r) => {
        status.textContent = r?.ok ? 'Draft deleted.' : (r?.error ?? 'delete failed');
        if (r?.ok) {
          current = newDraft();
          artCandidates = [];
          void loadDrafts();
          renderMain();
          refresh();
        }
      },
    );
  });
  testBtn.addEventListener('click', () => {
    const def = JSON.parse(JSON.stringify(current)) as ForgedChampionDef;
    close();
    window.dispatchEvent(new CustomEvent('loc:forge-test', { detail: def }));
  });

  // Finalize: save what is on screen, then start the generation job and
  // follow it. The pipeline (ADR 0006) derives the model sheet, generates
  // and rigs the model, applies the clip set, and seals the champion; a
  // failure of any kind refunds the creation. Success opens the workshop
  // on the fresh model: the 3D reveal IS the payoff of the chain.
  finalizeBtn.addEventListener('click', () => {
    status.textContent = 'Saving, then finalizing...';
    void api<{ ok: boolean; error?: string }>('/api/forge/draft', { def: current })
      .then((saved) => {
        if (!saved?.ok) throw new Error(saved?.error ?? 'save failed');
        return api<{ ok: boolean; jobId?: number; error?: string }>('/api/forge/finalize', {
          id: current.id,
        });
      })
      .then((started) => {
        if (!started?.ok || started.jobId === undefined) {
          status.textContent = started?.error ?? 'finalize failed';
          return;
        }
        const poll = (): void => {
          void api<{ ok: boolean; status?: string; stage?: string; error?: string }>(
            `/api/forge/job?id=${started.jobId}`,
          ).then((job) => {
            if (!job?.ok) {
              status.textContent = 'the job vanished; check your creations';
              return;
            }
            if (job.status === 'success') {
              status.textContent = 'Finalized: the champion is sealed.';
              // The seal changes what the panels offer; once the fresh
              // rows land, the workshop opens on the new model.
              void loadDrafts().then(() => {
                renderMain();
                openWorkshopHere();
              });
              return;
            }
            if (job.status === 'failed') {
              status.textContent = `Finalize failed (${job.error ?? 'unknown'}); the creation was refunded.`;
              return;
            }
            status.textContent = `Finalizing: ${job.stage ?? '...'}`;
            window.setTimeout(poll, 2000);
          });
        };
        poll();
      })
      .catch((err: unknown) => {
        status.textContent = err instanceof Error ? err.message : 'finalize failed';
      });
  });

  // The workshop door: only a finalized champion has a model to turn.
  const workshopBtn = el('button', 'fe-btn', 'Workshop (3D view)') as HTMLButtonElement;
  workshopBtn.addEventListener('click', openWorkshopHere);

  const meterPanel = el('div', 'fe-panel');
  meterPanel.append(el('h3', '', 'Power budget'));
  const meterBar = el('div', 'fe-meter-bar');
  meterBar.append(meterFill);
  meterPanel.append(meterLine, meterBar, costBox, verdict);
  // Creation order: save the work, seal it, inspect the model, play it.
  // Delete stays last, away from the flow.
  const actions = el('div', 'fe-panel');
  actions.append(
    el('h3', '', 'Actions'),
    saveBtn,
    finalizeBtn,
    workshopBtn,
    testBtn,
    deleteBtn,
    status,
  );
  side.append(meterPanel, actions);

  // --- left rail: drafts -------------------------------------------------

  const renderRail = (): void => {
    rail.textContent = '';
    const panel = el('div', 'fe-panel');
    panel.append(el('h3', '', 'Your drafts'));
    for (const row of drafts) {
      const btn = el('button', 'fe-draft');
      btn.classList.toggle('picked', row.id === current.id);
      btn.append(document.createTextNode(row.def.name));
      const sub = el(
        'small',
        '',
        row.status === 'finalized' ? 'finalized' : row.def.tagline || row.id,
      );
      btn.append(sub);
      btn.addEventListener('click', () => {
        current = JSON.parse(JSON.stringify(row.def)) as ForgedChampionDef;
        renderRail();
        renderMain();
        refresh();
        void loadArt().then(() => {
          renderMain();
        });
      });
      panel.append(btn);
    }
    if (drafts.length === 0) panel.append(el('div', 'fe-sub', 'Nothing yet. Forge the first.'));
    const fresh = el('button', 'fe-btn', 'New draft');
    fresh.addEventListener('click', () => {
      current = newDraft();
      artCandidates = [];
      renderRail();
      renderMain();
      refresh();
    });
    panel.append(fresh);
    rail.append(panel);
  };

  const loadDrafts = async (): Promise<void> => {
    const r = await api<{ ok: boolean; drafts?: DraftRow[] }>(`/api/forge/drafts`);
    drafts = r?.ok && r.drafts ? r.drafts : [];
    // Finalized champions announce their models to the render registry, so
    // a test drive straight from here plays the generated model.
    for (const d of drafts) registerForgedAssets(d.id, d);
    renderRail();
    // Statuses may have moved (a finalize landing): the workshop door and
    // the seal-aware panels follow the fresh rows.
    refresh();
  };

  // --- center: the tabs --------------------------------------------------

  function textInput(
    placeholder: string,
    get: () => string,
    set: (v: string) => void,
    maxLength: number,
  ): HTMLInputElement {
    const input = el('input', 'fe-input') as HTMLInputElement;
    input.placeholder = placeholder;
    input.maxLength = maxLength;
    input.value = get();
    input.addEventListener('input', () => {
      set(input.value);
      refresh();
    });
    return input;
  }

  // Tab 1, Design: the splash art hero (the champion derives from it), the
  // visible splash-to-model pipeline, and the card identity.
  function renderDesign(): void {
    const sealed = isSealed();
    const row = currentRow();

    const splash = el('div', 'fe-panel');
    splash.append(el('h3', '', 'Splash art'));
    if (sealed) {
      splash.append(
        el('div', 'fe-lead', 'This champion is sealed: its art is final. Admire it below.'),
      );
    } else {
      splash.append(
        el(
          'p',
          'fe-lead',
          'Describe your champion in one line and generate the splash art. Everything derives from it: the 3D model is built from this exact picture, so make it the champion you want to play.',
        ),
      );
      const hero = el('div', 'fe-hero');
      const line = el('input', 'fe-hero-input') as HTMLInputElement;
      line.placeholder = 'Silhouette, weapon, mood, one accent color...';
      line.maxLength = 400;
      line.value = artLines.splash ?? '';
      line.addEventListener('input', () => {
        artLines.splash = line.value;
      });
      const genBtn = el('button', 'fe-gen', 'Generate splash art') as HTMLButtonElement;
      genBtn.addEventListener('click', () => generateArtKind('splash', line.value));
      hero.append(line, genBtn);
      const mess = el('div', 'fe-heromess');
      const prefill = el('button', 'fe-mini', 'Use my card text');
      prefill.addEventListener('click', () => {
        const identity = [current.name, current.title].filter((s) => s.trim() !== '').join(', ');
        line.value = current.tagline.trim() === '' ? identity : `${identity}: ${current.tagline}`;
        artLines.splash = line.value;
      });
      const quota = el(
        'span',
        'fe-quota',
        artQuota.limit > 0 ? `${artQuota.used}/${artQuota.limit} images today` : '',
      );
      mess.append(prefill, quota);
      const chips = el('div', 'fe-chips');
      chips.append(el('span', 'fe-field-label', 'Try an example:'));
      for (const ex of EXAMPLE_LINES) {
        const chip = el('button', 'fe-chip', `${ex.slice(0, 46)}...`);
        chip.title = ex;
        chip.addEventListener('click', () => {
          line.value = ex;
          artLines.splash = ex;
        });
        chips.append(chip);
      }
      splash.append(hero, mess, chips);
      if (artCandidates.filter((c) => c.kind === 'splash').length === 0) {
        splash.append(
          el('div', 'fe-desc', 'No splash yet. Generate a few and pick the one that feels right.'),
        );
      }
    }
    splash.append(artStrip('splash', true));
    main.append(splash);

    // The pipeline, visible: what happens between the splash and the
    // playable model, with the champion's own images once they exist.
    const pipe = el('div', 'fe-panel');
    pipe.append(el('h3', '', 'From splash to champion'));
    const steps = el('div', 'fe-steps');
    const step = (
      num: string,
      text: string,
      thumb: string | null,
      placeholder: string,
    ): HTMLElement => {
      const box = el('div', 'fe-step');
      box.append(el('div', 'fe-step-num', num));
      const t = el('div', 'fe-step-thumb');
      if (thumb) {
        const img = document.createElement('img');
        img.src = thumb;
        img.alt = '';
        t.append(img);
      } else {
        t.textContent = placeholder;
      }
      box.append(t, el('div', 'fe-step-text', text));
      return box;
    };
    const splashUrl = row?.splash ? `/api/forge/asset/${row.splash}` : chosenSplashUrl();
    steps.append(
      step('1. Splash art', 'Your one-line prompt paints it. Pick your favorite.', splashUrl, '?'),
    );
    steps.append(
      step(
        '2. Model sheet',
        'Derived automatically at finalize: the same character, three views, empty hands, white background. This is what the 3D builder reads.',
        row?.sheet ? `/api/forge/asset/${row.sheet}` : null,
        '2D',
      ),
    );
    const modelStep = el('div', 'fe-step');
    modelStep.append(el('div', 'fe-step-num', '3. 3D model'));
    const modelThumb = el('div', 'fe-step-thumb', '3D');
    modelStep.append(modelThumb);
    if (row?.model) {
      const open = el('button', 'fe-gen small', 'Open the workshop');
      open.addEventListener('click', openWorkshopHere);
      modelStep.append(open);
    } else {
      modelStep.append(
        el('div', 'fe-step-text', 'Built from the sheet, textured, then rigged on a biped.'),
      );
    }
    steps.append(modelStep);
    steps.append(
      step(
        '4. Animations',
        'Five clips land on the rig: idle, run, attack, cast, death. See them in the workshop.',
        null,
        '5 clips',
      ),
    );
    pipe.append(steps);
    pipe.append(
      el(
        'div',
        'fe-desc',
        sealed
          ? 'This champion went through the whole chain; the workshop shows the result.'
          : 'Finalize (right rail) runs steps 2 to 4 on your chosen splash and spends a creation.',
      ),
    );
    main.append(pipe);

    // The model card: once finalized, the 3D result is one click away.
    if (row?.model) {
      const modelPanel = el('div', 'fe-panel');
      modelPanel.append(el('h3', '', 'The model'));
      const cta = el('div', 'fe-model-cta');
      if (row.sheet) {
        const img = document.createElement('img');
        img.src = `/api/forge/asset/${row.sheet}`;
        img.alt = '';
        cta.append(img);
      }
      const right = el('div', '');
      right.append(
        el(
          'div',
          'fe-lead',
          'Your generated model is ready: turn it around, play its animations, attach and adjust the weapon, then save the tuning. Matches use exactly what you save.',
        ),
      );
      const open = el('button', 'fe-gen small', 'Open the 3D workshop');
      open.addEventListener('click', openWorkshopHere);
      right.append(open);
      cta.append(right);
      modelPanel.append(cta);
      main.append(modelPanel);
    }

    const card = el('div', 'fe-panel');
    card.append(el('h3', '', 'Identity'));
    card.append(
      textInput(
        'Name',
        () => current.name,
        (v) => {
          current.name = v;
        },
        40,
      ),
    );
    card.append(
      textInput(
        'Title (after the name)',
        () => current.title,
        (v) => {
          current.title = v;
        },
        40,
      ),
    );
    card.append(
      textInput(
        'Tagline: the one line that tells four allies what this kit does',
        () => current.tagline,
        (v) => {
          current.tagline = v;
        },
        90,
      ),
    );
    const roleSelect = el('select', 'fe-select') as HTMLSelectElement;
    for (const r of FORGED_ROLES) {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      roleSelect.append(opt);
    }
    roleSelect.value = current.role;
    roleSelect.addEventListener('change', () => {
      current.role = roleSelect.value as ChampionRole;
      refresh();
    });
    const roleField = el('label', 'fe-field');
    roleField.append(el('span', 'fe-field-label', 'role'), roleSelect);
    card.append(roleField);
    main.append(card);
  }

  // Tab 2, Spells: the passive and the four abilities, each with its own
  // generated icon front and center.
  function renderSpells(): void {
    const sealed = isSealed();

    const passive = el('div', 'fe-panel');
    passive.append(el('h3', '', 'Passive (a template the engine owns; you set the numbers)'));
    const tplSelect = el('select', 'fe-select') as HTMLSelectElement;
    for (const tpl of PASSIVE_TEMPLATE_LIST) {
      const opt = document.createElement('option');
      opt.value = tpl.id;
      opt.textContent = `${tpl.id}: ${tpl.summary}`;
      tplSelect.append(opt);
    }
    tplSelect.value = current.passive.template;
    tplSelect.addEventListener('change', () => {
      const tpl = PASSIVE_TEMPLATES[tplSelect.value];
      if (!tpl) return;
      const params: Record<string, number> = {};
      for (const p of tpl.params) params[p.key] = p.min + (p.max - p.min) / 2;
      for (const p of tpl.params) if (p.integer) params[p.key] = Math.round(params[p.key] ?? p.min);
      current.passive = { template: tpl.id, params, name: current.passive.name };
      hooks.rebuild();
    });
    passive.append(tplSelect);
    passive.append(
      textInput(
        'Passive name',
        () => current.passive.name,
        (v) => {
          current.passive.name = v;
        },
        40,
      ),
    );
    const tpl = PASSIVE_TEMPLATES[current.passive.template];
    if (tpl) {
      const paramRow = el('div', '');
      for (const p of tpl.params) {
        paramRow.append(
          numField(
            p.key,
            current.passive.params,
            p.key,
            { min: p.min, max: p.max, ...(p.integer ? { integer: true } : {}) },
            hooks,
          ),
        );
      }
      passive.append(paramRow);
      const desc = el('div', 'fe-desc', tpl.describe(current.passive.params));
      passive.append(desc);
      paramRow.addEventListener('input', () => {
        desc.textContent = tpl.describe(current.passive.params);
      });
    }
    main.append(passive);

    for (const key of ['Q', 'W', 'E', 'R'] as AbilityKey[]) {
      const ability = current.abilities[key] as unknown as Record<string, unknown>;
      const panel = el('div', 'fe-panel fe-ability');
      const headRow = el('div', 'fe-ability-head');
      headRow.append(el('span', 'fe-key', key));
      const nameInput = el('input', 'fe-input') as HTMLInputElement;
      nameInput.style.marginBottom = '0';
      nameInput.maxLength = 40;
      nameInput.value = String(ability.name ?? '');
      nameInput.addEventListener('input', () => {
        ability.name = nameInput.value;
        refresh();
      });
      headRow.append(nameInput);
      panel.append(headRow);
      const costs = el('div', 'fe-fields');
      costs.append(numField('mana', ability, 'manaCost', ABILITY_BOUNDS.manaCost, hooks));
      costs.append(
        numField(
          'cooldown',
          ability,
          'cooldown',
          key === 'R' ? ABILITY_BOUNDS.ultCooldown : ABILITY_BOUNDS.basicCooldown,
          hooks,
        ),
      );
      costs.append(numField('cast range', ability, 'castRange', ABILITY_BOUNDS.castRange, hooks));
      costs.append(numField('windup', ability, 'windup', ABILITY_BOUNDS.windup, hooks));
      panel.append(costs);
      panel.append(buildCastEditor(current.abilities[key], hooks));
      // The spell icon block (ADR 0010): the flat generated icon on the 2D
      // quota, in-match sizes previewed; the procedural icon stays the
      // fallback when none is generated.
      const iconBlock = el('div', 'fe-iconblock');
      const chosenIcon = artCandidates.find((c) => c.kind === `icon_${key}` && c.chosen);
      if (chosenIcon) {
        const preview = el('div', 'fe-icon-preview');
        for (const size of [56, 24]) {
          const img = document.createElement('img');
          img.src = `/api/forge/asset/${chosenIcon.path}`;
          img.width = size;
          img.height = size;
          img.alt = '';
          preview.append(img);
        }
        iconBlock.append(preview);
      }
      const iconText = el(
        'div',
        'fe-step-text',
        chosenIcon
          ? 'The icon, at full size and at in-match size.'
          : 'No generated icon yet: the procedural one plays until you make one.',
      );
      iconBlock.append(iconText);
      if (!sealed) {
        const iconGen = el('button', 'fe-gen small', 'Generate icon') as HTMLButtonElement;
        iconGen.title = 'A flat spell icon in the game style, derived from this spell';
        iconGen.style.marginLeft = 'auto';
        iconGen.addEventListener('click', () => generateArtKind(`icon_${key}`, ''));
        iconBlock.append(iconGen);
      }
      panel.append(iconBlock, artStrip(`icon_${key}`, false));
      main.append(panel);
    }
  }

  // Tab 3, Tuning: the numbers against the power budget.
  function renderTuning(): void {
    const stats = el('div', 'fe-panel');
    stats.append(el('h3', '', 'Stats (every point above the floor costs budget)'));
    const statsGrid = el('div', 'fe-grid');
    const base = current.base as unknown as Record<string, unknown>;
    for (const key of Object.keys(BASE_STAT_BOUNDS) as (keyof ChampionBaseStats)[]) {
      if (key === 'ap') continue;
      statsGrid.append(numField(key, base, key, BASE_STAT_BOUNDS[key], hooks));
    }
    stats.append(statsGrid, el('h3', '', 'Growth per level'));
    const growthGrid = el('div', 'fe-grid');
    const growth = current.growth as unknown as Record<string, unknown>;
    for (const key of Object.keys(GROWTH_BOUNDS) as (keyof ChampionGrowth)[]) {
      growthGrid.append(numField(key, growth, key, GROWTH_BOUNDS[key], hooks));
    }
    stats.append(growthGrid);
    main.append(stats);
  }

  function renderMain(): void {
    main.textContent = '';
    if (tab === 'design') renderDesign();
    else if (tab === 'spells') renderSpells();
    else renderTuning();
  }

  renderMain();
  refresh();
  void loadDrafts();
}
