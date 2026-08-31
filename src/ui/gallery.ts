// The gallery (plan-forge phase 7): the public browse space over every
// finalized forged champion. A grid on the left, the selected champion's
// full kit and its social controls (like, report, test drive, the
// creator's switches) in a rail on the right. Pure DOM over /api/gallery;
// Escape or Back closes it to whatever screen opened it.

import { registerForgedAssets } from '../game/forged_visuals';
import type { ChampionRole } from '../sim/content/champions';
import type { ForgedDisplay } from '../sim/forge/display';
import type { ForgedChampionDef } from '../sim/forge/forged_def';
import { resolveForgedChampion } from '../sim/forge/resolve';
import type { AbilityKey } from '../sim/types';
import { ROLE_COLORS } from './champion_art';
import { describeAbility } from './describe';
import { startMenuBackdrop } from './menu_backdrop';
import { setRichLine } from './rich_text';
import { openWorkshop } from './workshop';

// The wire shape of one gallery card (server/gallery.ts).
export interface GalleryEntry {
  id: string;
  def: ForgedChampionDef;
  creator: string;
  likes: number;
  likedByMe: boolean;
  mine: boolean;
  listed: boolean;
  shared: boolean;
  updatedAt: number;
  // Asset paths relative to /api/forge/asset/, when the champion has them;
  // family and display drive the weapon prop and the saved model tuning.
  splash: string | null;
  model: string | null;
  family: string | null;
  weapon: string | null;
  clips: Record<string, string> | null;
  display: ForgedDisplay | null;
}

const CSS = `
.gal, .gal * { box-sizing: border-box; }
.gal {
  position: absolute; inset: 0; z-index: 30; display: flex; flex-direction: column;
  background: radial-gradient(ellipse at center, #241c4a 0%, #0a0d20 75%);
  font-family: system-ui, sans-serif; color: #c9d9ee;
}
.gal-head {
  position: relative; z-index: 1; display: flex; align-items: center; gap: 12px;
  padding: 20px 32px 14px; flex-wrap: wrap;
}
.gal-title { font-size: 30px; font-weight: 800; letter-spacing: 1px; margin: 0; }
.gal-sub { font-size: 13px; color: #7e93b2; }
.gal-search {
  width: 220px; padding: 8px 10px; border-radius: 6px; border: 1px solid #2e4468;
  background: #0b1220; color: #c9d9ee; font-size: 13px; outline: none;
}
.gal-search:focus { border-color: #5b84c9; }
.gal-btn {
  padding: 8px 16px; border-radius: 6px; border: 1px solid #2e4468;
  background: #142038; color: #c9d9ee; font-size: 13px; font-weight: 600; cursor: pointer;
  transition: border-color 0.15s ease;
}
.gal-btn:hover { border-color: #5b84c9; }
.gal-btn.on { border-color: #d8b45a; color: #e8dfae; background: #2c2410; }
.gal-back { margin-left: auto; }
.gal-layout {
  position: relative; z-index: 1; flex: 1; min-height: 0;
  display: flex; gap: 24px; padding: 0 32px 26px;
}
.gal-grid {
  flex: 1; min-width: 0; overflow-y: auto; align-content: start;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 14px;
  padding-right: 4px;
}
.gal-empty { color: #7e93b2; font-size: 14px; padding: 24px 4px; }
.gal-card {
  padding: 0; border-radius: 10px; border: 1px solid #28405e; background: #0f1930;
  color: #c9d9ee; text-align: left; cursor: pointer;
  position: relative; aspect-ratio: 3 / 4; overflow: hidden; display: block;
  transition: transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease;
}
.gal-card:hover {
  border-color: #5b84c9; transform: translateY(-3px);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.5);
}
.gal-card.picked {
  border-color: #6aa8e8;
  box-shadow: 0 0 0 2px rgba(106, 168, 232, 0.45), 0 10px 24px rgba(0, 0, 0, 0.5);
}
.gal-mono {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  padding-bottom: 30px; font-size: 46px; font-weight: 800;
  background: radial-gradient(circle at 50% 38%, #3a2d63 0%, #0a1120 90%);
  color: #b9a8e8; text-shadow: 0 2px 10px rgba(0, 0, 0, 0.6);
}
.gal-splash { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.gal-card-body {
  position: absolute; left: 0; right: 0; bottom: 0; padding: 30px 12px 10px; min-width: 0;
  background: linear-gradient(180deg, rgba(3, 6, 14, 0) 0%, rgba(3, 6, 14, 0.92) 62%);
}
.gal-card-name { font-weight: 800; font-size: 15px; letter-spacing: 0.3px; }
.gal-card-meta { font-size: 10.5px; color: #7e93b2; margin-top: 2px; }
.gal-likes {
  position: absolute; top: 8px; right: 8px; padding: 3px 9px; border-radius: 20px;
  background: rgba(3, 6, 14, 0.75); border: 1px solid #2e4468;
  font-size: 11px; font-weight: 700; color: #e8dfae;
}
.gal-detail {
  width: 430px; flex: none; overflow-y: auto;
  background: rgba(9, 14, 26, 0.92); border: 1px solid #2e4468; border-radius: 12px;
  padding: 20px 22px;
}
.gal-detail-name { font-size: 22px; font-weight: 800; margin: 0; }
.gal-detail-role { font-size: 13px; font-weight: 700; margin: 2px 0 2px; }
.gal-detail-creator { font-size: 12px; color: #7e93b2; margin: 0 0 8px; }
.gal-detail-blurb { font-size: 13px; color: #aac2dd; line-height: 1.5; margin: 0 0 12px; }
.gal-actions { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 8px; }
.gal-report-row { display: flex; gap: 8px; margin: 8px 0; }
.gal-report-row input { flex: 1; }
.gal-note { font-size: 12px; color: #93a87c; min-height: 16px; margin: 4px 0 8px; }
.gal-ability {
  border-top: 1px solid #1d2f4a; padding: 10px 0; font-size: 13px; line-height: 1.5;
  color: #aac2dd;
}
.gal-ability b { color: #e8dfae; font-weight: 700; }
@media (max-width: 980px) {
  .gal-layout { flex-direction: column; overflow-y: auto; }
  .gal-grid { overflow-y: visible; flex: none; }
  .gal-detail { width: 100%; overflow-y: visible; }
}
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

const ABILITY_KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];

async function api(path: string, body?: unknown): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(path, {
      credentials: 'same-origin',
      ...(body !== undefined
        ? {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {}),
    });
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function openGallery(container: HTMLElement): void {
  ensureCss();
  const root = el('div', 'gal');
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

  let sort: 'recent' | 'popular' = 'recent';
  let entries: GalleryEntry[] = [];
  let pickedId: string | null = null;

  const head = el('div', 'gal-head');
  const search = el('input', 'gal-search') as HTMLInputElement;
  search.placeholder = 'Search name or creator';
  const recentBtn = el('button', 'gal-btn on', 'Recent');
  const popularBtn = el('button', 'gal-btn', 'Popular');
  const back = el('button', 'gal-btn gal-back', 'Back');
  back.addEventListener('click', close);
  head.append(
    el('h1', 'gal-title', 'The gallery'),
    el('span', 'gal-sub', 'Every finalized champion, from every creator'),
    search,
    recentBtn,
    popularBtn,
    back,
  );

  const grid = el('div', 'gal-grid');
  const detail = el('div', 'gal-detail');
  const cards = new Map<string, HTMLButtonElement>();

  const renderDetail = (entry: GalleryEntry): void => {
    pickedId = entry.id;
    for (const [id, b] of cards) b.classList.toggle('picked', id === entry.id);
    detail.textContent = '';
    const def = entry.def;
    detail.appendChild(el('h2', 'gal-detail-name', `${def.name}, ${def.title}`));
    const role = el('div', 'gal-detail-role', def.role);
    role.style.color = ROLE_COLORS[def.role as ChampionRole] ?? '#c9d8ae';
    detail.appendChild(role);
    detail.appendChild(el('p', 'gal-detail-creator', `Forged by ${entry.creator}`));
    detail.appendChild(el('p', 'gal-detail-blurb', def.tagline));

    const note = el('div', 'gal-note', '');
    const actions = el('div', 'gal-actions');
    const like = el(
      'button',
      `gal-btn${entry.likedByMe ? ' on' : ''}`,
      `${entry.likedByMe ? 'Liked' : 'Like'} (${entry.likes})`,
    );
    like.addEventListener('click', () => {
      void api('/api/gallery/like', { id: entry.id, on: !entry.likedByMe }).then((r) => {
        if (!r?.ok) return;
        entry.likedByMe = !entry.likedByMe;
        entry.likes = typeof r.likes === 'number' ? r.likes : entry.likes;
        renderDetail(entry);
        renderGrid();
      });
    });
    const test = el('button', 'gal-btn', 'Test drive vs bots');
    test.addEventListener('click', () => {
      // The home screen owns the flow: it resolves into an offline
      // practice match with this definition (the Forge editor's path).
      close();
      window.dispatchEvent(new CustomEvent('loc:forge-test', { detail: def }));
    });
    actions.append(like, test);
    if (entry.model) {
      const workshop = el('button', 'gal-btn', 'Workshop view');
      workshop.addEventListener('click', () => {
        openWorkshop(container, {
          id: entry.id,
          name: def.name,
          title: def.title,
          modelUrl: `/api/forge/asset/${entry.model}`,
          splashUrl: entry.splash ? `/api/forge/asset/${entry.splash}` : null,
          family: entry.family,
          clips: entry.clips,
          weaponUrl: entry.weapon ? `/api/forge/asset/${entry.weapon}` : null,
          display: entry.display,
          // Only the owner can tune and save; visitors just look around.
          editable: entry.mine,
          onSaved: (display) => {
            entry.display = display;
            registerForgedAssets(entry.id, entry);
          },
        });
      });
      actions.append(workshop);
    }
    if (entry.mine) {
      const listedBtn = el('button', 'gal-btn', entry.listed ? 'Listed' : 'Unlisted');
      listedBtn.addEventListener('click', () => {
        void api('/api/gallery/visibility', { id: entry.id, listed: !entry.listed }).then((r) => {
          if (!r?.ok) return;
          entry.listed = !entry.listed;
          renderDetail(entry);
        });
      });
      const sharedBtn = el('button', 'gal-btn', entry.shared ? 'Others may play it' : 'Only you');
      sharedBtn.addEventListener('click', () => {
        void api('/api/gallery/visibility', { id: entry.id, shared: !entry.shared }).then((r) => {
          if (!r?.ok) return;
          entry.shared = !entry.shared;
          renderDetail(entry);
        });
      });
      actions.append(listedBtn, sharedBtn);
    }
    detail.appendChild(actions);

    if (!entry.mine) {
      const row = el('div', 'gal-report-row');
      const reason = el('input', 'gal-search') as HTMLInputElement;
      reason.placeholder = 'Report: say what is wrong';
      const send = el('button', 'gal-btn', 'Report');
      send.addEventListener('click', () => {
        void api('/api/gallery/report', { id: entry.id, reason: reason.value }).then((r) => {
          note.textContent = r?.ok
            ? r.takenDown === true
              ? 'Reported; this champion is now down pending review.'
              : 'Reported. Thank you.'
            : String(r?.error ?? 'Could not send the report.');
          if (r?.ok) reason.value = '';
        });
      });
      row.append(reason, send);
      detail.appendChild(row);
    }
    detail.appendChild(note);

    const resolved = resolveForgedChampion(def);
    const passive = el('div', 'gal-ability');
    passive.append(
      el('b', '', `Passive, ${resolved.passive.name}.`),
      ` ${resolved.passive.description}`,
    );
    detail.appendChild(passive);
    for (const k of ABILITY_KEYS) {
      const lines = describeAbility(k, resolved.abilities[k]);
      const box = el('div', 'gal-ability');
      const body = document.createElement('span');
      setRichLine(body, ` ${lines.slice(1).join(' ')}`);
      box.append(el('b', '', lines[0] ?? ''), body);
      detail.appendChild(box);
    }
  };

  const renderGrid = (): void => {
    grid.textContent = '';
    cards.clear();
    if (entries.length === 0) {
      grid.appendChild(
        el('div', 'gal-empty', 'Nothing here yet: finalized champions land in the gallery.'),
      );
      return;
    }
    for (const entry of entries) {
      const card = el('button', 'gal-card') as HTMLButtonElement;
      if (entry.splash) {
        const img = document.createElement('img');
        img.className = 'gal-splash';
        img.src = `/api/forge/asset/${entry.splash}`;
        img.alt = '';
        card.appendChild(img);
      } else {
        card.appendChild(el('div', 'gal-mono', (entry.def.name[0] ?? '?').toUpperCase()));
      }
      card.appendChild(el('div', 'gal-likes', `${entry.likes}`));
      const body = el('div', 'gal-card-body');
      body.appendChild(el('div', 'gal-card-name', entry.def.name));
      body.appendChild(el('div', 'gal-card-meta', `${entry.def.role}, forged by ${entry.creator}`));
      card.appendChild(body);
      card.addEventListener('click', () => renderDetail(entry));
      cards.set(entry.id, card);
      grid.appendChild(card);
    }
    const picked = entries.find((e) => e.id === pickedId) ?? entries[0];
    if (picked) renderDetail(picked);
  };

  const refresh = (): void => {
    const q = encodeURIComponent(search.value.trim());
    void api(`/api/gallery?sort=${sort}&q=${q}`).then((r) => {
      entries = r?.ok && Array.isArray(r.entries) ? (r.entries as GalleryEntry[]) : [];
      // Announce every model to the render registry, so a test drive from
      // here plays the generated model, not the procedural figure.
      for (const e of entries) registerForgedAssets(e.id, e);
      renderGrid();
    });
  };
  recentBtn.addEventListener('click', () => {
    sort = 'recent';
    recentBtn.classList.add('on');
    popularBtn.classList.remove('on');
    refresh();
  });
  popularBtn.addEventListener('click', () => {
    sort = 'popular';
    popularBtn.classList.add('on');
    recentBtn.classList.remove('on');
    refresh();
  });
  let debounce = 0;
  search.addEventListener('input', () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(refresh, 250);
  });

  const layout = el('div', 'gal-layout');
  layout.append(grid, detail);
  root.append(head, layout);
  container.appendChild(root);
  refresh();
}
