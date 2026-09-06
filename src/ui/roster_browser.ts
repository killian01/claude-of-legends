// The champion browser: a full-page roster reachable from the home menu.
// A grid of splash cards fills the left, and the selected champion's full
// kit reads in a rail on the right. Pure DOM, self-contained CSS; Escape or
// the back button closes it back to whatever screen opened it.

import { CHAMPION_LIST, type ChampionDef } from '../sim/content/champions';
import type { AbilityKey } from '../sim/types';
import { BALANCE_CSS, balanceTag, format } from './balances';
import { ROLE_COLORS, setPortrait } from './champion_art';
import {
  affordable,
  type CollectionState,
  loadCollection,
  matchesAway,
  priceOf,
  recruit,
  standingLine,
  standingOf,
} from './collection';
import { describeAbility } from './describe';
import { startMenuBackdrop } from './menu_backdrop';
import { setRichLine } from './rich_text';

const CSS = `${BALANCE_CSS}
.rb, .rb * { box-sizing: border-box; }
.rb {
  position: absolute; inset: 0; z-index: 30; display: flex; flex-direction: column;
  background: radial-gradient(ellipse at center, #1c2c4a 0%, #0a1120 75%);
  font-family: system-ui, sans-serif; color: #c9d9ee;
}
.rb-head {
  position: relative; z-index: 1; display: flex; align-items: baseline; gap: 14px;
  padding: 20px 32px 14px;
}
.rb-title { font-size: 30px; font-weight: 800; letter-spacing: 1px; margin: 0; }
.rb-sub { font-size: 13px; color: #7e93b2; }
.rb-back {
  margin-left: auto; padding: 9px 20px; border-radius: 6px; border: 1px solid #2e4468;
  background: #142038; color: #c9d9ee; font-size: 14px; font-weight: 600; cursor: pointer;
  transition: border-color 0.15s ease;
}
.rb-back:hover { border-color: #5b84c9; }
.rb-layout {
  position: relative; z-index: 1; flex: 1; min-height: 0;
  display: flex; gap: 24px; padding: 0 32px 26px;
}
.rb-grid {
  flex: 1; min-width: 0; overflow-y: auto; align-content: start;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 14px;
  padding-right: 4px;
}
.rb-card {
  padding: 0; border-radius: 10px; border: 1px solid #28405e; background: #0f1930;
  color: #c9d9ee; text-align: left; cursor: pointer;
  /* The card's height is its width and a third again, written as padding
     rather than aspect-ratio: in an auto-sized grid row the ratio resolves
     against the column's MINIMUM track (210px here) while the column
     itself stretches to 1fr, so the row came out shorter than the cards
     and every row overlapped the one above it. Padding has no such cycle:
     it is a percentage of the real width. Every child is positioned
     absolutely, so a zero content height costs nothing. */
  position: relative; height: 0; padding-top: 133.33%; overflow: hidden; display: block;
  transition: transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease;
}
.rb-card:hover {
  border-color: #5b84c9; transform: translateY(-3px);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.5);
}
.rb-card.picked {
  border-color: #6aa8e8;
  box-shadow: 0 0 0 2px rgba(106, 168, 232, 0.45), 0 10px 24px rgba(0, 0, 0, 0.5);
}
.rb-portrait {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
  background: radial-gradient(circle at 50% 38%, #1d3a63 0%, #0a1120 90%);
}
.rb-card-body {
  position: absolute; left: 0; right: 0; bottom: 0; padding: 34px 12px 10px; min-width: 0;
  background: linear-gradient(180deg, rgba(3, 6, 14, 0) 0%, rgba(3, 6, 14, 0.92) 62%);
}
.rb-card-name { font-weight: 800; font-size: 16px; letter-spacing: 0.3px; }
.rb-card-role { font-size: 11px; font-weight: 700; margin-top: 2px; }
/* The shop (ADR 0018). A locked champion is dimmed and never hidden: it
   is what the page is selling, and its price is on its face. */
.rb-card.locked .rb-portrait { filter: grayscale(0.85) brightness(0.55); }
.rb-card.locked { border-color: #23324a; }
.rb-standing {
  font-size: 11px; font-weight: 800; letter-spacing: 0.4px; margin-top: 3px; color: #e8cc74;
}
.rb-standing.free { color: #8fd0a8; }
.rb-standing.owned { color: #6f86a6; }
.rb-balance { font-size: 13px; font-weight: 700; color: #e8cc74; margin-left: 4px; }
.rb-buy {
  width: 100%; margin: 10px 0 2px; padding: 10px 16px; border-radius: 6px;
  border: 1px solid #7a6428; background: #2c2513; color: #f0dfa0;
  font-size: 14px; font-weight: 700; cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.rb-buy:hover:not(:disabled) { border-color: #e8cc74; background: #3a3018; }
.rb-buy:disabled { opacity: 0.55; cursor: not-allowed; }
.rb-note { font-size: 12px; color: #7e93b2; margin: 2px 0 6px; line-height: 1.4; }
.rb-note.bad { color: #e8a0a0; }
.rb-detail {
  width: 430px; flex: none; overflow-y: auto;
  background: rgba(9, 14, 26, 0.92); border: 1px solid #2e4468; border-radius: 12px;
  padding: 20px 22px;
}
.rb-detail-portrait {
  width: 100%; aspect-ratio: 4 / 3; object-fit: cover; object-position: 50% 25%;
  border-radius: 10px; border: 1px solid #21344e; display: block;
  background: radial-gradient(circle at 50% 38%, #1d3a63 0%, #0a1120 90%);
}
.rb-detail-name { font-size: 22px; font-weight: 800; margin: 14px 0 0; }
.rb-detail-role { font-size: 13px; font-weight: 700; margin: 2px 0 8px; }
.rb-detail-blurb { font-size: 13px; color: #7e93b2; line-height: 1.5; margin: 0 0 12px; }
.rb-ability {
  border-top: 1px solid #1d2f4a; padding: 10px 0; font-size: 13px; line-height: 1.5;
  color: #aac2dd;
}
.rb-ability b { color: #e8dfae; font-weight: 700; }
@media (max-width: 980px) {
  .rb-layout { flex-direction: column; overflow-y: auto; }
  .rb-grid { overflow-y: visible; flex: none; }
  .rb-detail { width: 100%; overflow-y: visible; }
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

export function openRosterBrowser(container: HTMLElement): () => void {
  ensureCss();
  const root = el('div', 'rb');
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

  const head = el('div', 'rb-head');
  const back = el('button', 'rb-back', 'Back');
  back.addEventListener('click', close);
  // The balance belongs where the spending happens, and says nothing at
  // all until the account has answered (ADR 0018).
  const balance = el('span', 'rb-balance');
  head.append(
    el('h1', 'rb-title', 'The champions'),
    el('span', 'rb-sub', 'Pick a card to read the full kit'),
    balance,
    back,
  );

  const grid = el('div', 'rb-grid');
  const detail = el('div', 'rb-detail');
  const cards = new Map<string, HTMLButtonElement>();
  const standings = new Map<string, HTMLElement>();
  // Null until the account answers, and null forever for a signed-out
  // reader: no wall is drawn either way, because a lock nobody can lift
  // or explain is worse than none.
  let state: CollectionState | null = null;
  let shown: ChampionDef | null = null;

  const renderBalance = (): void => {
    balance.replaceChildren();
    if (state) balance.appendChild(balanceTag('laurels', state.laurels));
  };

  const renderStandings = (): void => {
    for (const [id, line] of standings) {
      const standing = standingOf(state, id);
      const text = state && standing === 'owned' ? '' : standingLine(state, id);
      // A price wears the mark; "Yours", "Free this week" and "Locked"
      // are words and stay words.
      line.replaceChildren();
      if (standing === 'locked' && priceOf(state, id) !== null) {
        line.appendChild(balanceTag('laurels', priceOf(state, id) ?? 0, 12));
      } else if (text) {
        line.textContent = text;
      }
      line.className = `rb-standing${standing === 'rotation' ? ' free' : ''}${
        standing === 'owned' ? ' owned' : ''
      }`;
      cards.get(id)?.classList.toggle('locked', standing === 'locked');
    }
  };

  const renderDetail = (c: ChampionDef): void => {
    shown = c;
    for (const [id, b] of cards) b.classList.toggle('picked', id === c.id);
    detail.textContent = '';
    const portrait = document.createElement('img');
    portrait.className = 'rb-detail-portrait';
    setPortrait(portrait, c.id, 0x4a7dd6);
    portrait.alt = '';
    detail.appendChild(portrait);
    detail.appendChild(el('h2', 'rb-detail-name', c.name));
    const role = el('div', 'rb-detail-role', c.role);
    role.style.color = ROLE_COLORS[c.role] ?? '#c9d8ae';
    detail.appendChild(role);
    detail.appendChild(el('p', 'rb-detail-blurb', c.blurb));
    const passive = el('div', 'rb-ability');
    const passiveHead = el('b', '', `Passive, ${c.passive.name}.`);
    passive.append(passiveHead, ` ${c.passive.description}`);
    detail.appendChild(passive);
    for (const k of ABILITY_KEYS) {
      const lines = describeAbility(k, c.abilities[k]);
      const box = el('div', 'rb-ability');
      const body = document.createElement('span');
      // Generated rich text from the data records (ui/describe.ts).
      setRichLine(body, ` ${lines.slice(1).join(' ')}`);
      box.append(el('b', '', lines[0] ?? ''), body);
      detail.appendChild(box);
    }
    detail.appendChild(buyControl(c));
  };

  // What the rail offers under a champion's kit: nothing for one the
  // account holds, the price for one it does not, and how far off it is
  // when the laurels are short. A refusal that names its number is the
  // whole point (ADR 0017's rule, kept).
  const buyControl = (c: ChampionDef): HTMLElement => {
    const box = el('div', '');
    const standing = standingOf(state, c.id);
    if (!state || standing === 'owned') return box;
    const price = priceOf(state, c.id);
    if (price === null) return box;
    if (standing === 'rotation') {
      box.appendChild(el('div', 'rb-note', 'Free this week for everyone. Recruit it to keep it.'));
    }
    // "Recruit for" and the mark: the noun is in the mark, and the button
    // is the one place on this screen where the number is the decision.
    const buyLabel = (): void => {
      btn.replaceChildren(document.createTextNode('Recruit for '), balanceTag('laurels', price));
    };
    const btn = el('button', 'rb-buy', '') as HTMLButtonElement;
    buyLabel();
    const note = el('div', 'rb-note', '');
    if (!affordable(state, c.id)) {
      btn.disabled = true;
      const away = matchesAway(state, c.id);
      // Digits only here: the mark on the button above has already said
      // which unit this is, and a sentence with two marks in it reads as
      // a receipt.
      note.textContent = `${format(state.laurels)} of ${format(price)}: about ${away} more won match${
        away > 1 ? 'es' : ''
      }.`;
    }
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = 'Recruiting...';
      void recruit(c.id).then((out) => {
        if (!out.ok) {
          buyLabel();
          btn.disabled = false;
          note.className = 'rb-note bad';
          note.textContent = out.error;
          return;
        }
        if (state) {
          state = { ...state, laurels: out.laurels, collection: out.collection };
        }
        renderBalance();
        renderStandings();
        renderDetail(c);
      });
    });
    box.append(btn, note);
    return box;
  };

  for (const c of CHAMPION_LIST) {
    const card = el('button', 'rb-card') as HTMLButtonElement;
    const portrait = document.createElement('img');
    portrait.className = 'rb-portrait';
    setPortrait(portrait, c.id, 0x4a7dd6);
    portrait.alt = '';
    card.appendChild(portrait);
    const body = el('div', 'rb-card-body');
    body.appendChild(el('div', 'rb-card-name', c.name));
    const role = el('div', 'rb-card-role', c.role);
    role.style.color = ROLE_COLORS[c.role] ?? '#c9d8ae';
    body.appendChild(role);
    const standing = el('div', 'rb-standing');
    body.appendChild(standing);
    standings.set(c.id, standing);
    card.appendChild(body);
    card.addEventListener('click', () => renderDetail(c));
    cards.set(c.id, card);
    grid.appendChild(card);
  }

  const first = CHAMPION_LIST[0];
  if (first) renderDetail(first);
  renderStandings();

  // The wall arrives a moment after the page, and redraws it in place
  // rather than holding the roster back on a fetch.
  void loadCollection().then((loaded) => {
    state = loaded;
    renderBalance();
    renderStandings();
    if (shown) renderDetail(shown);
  });

  const layout = el('div', 'rb-layout');
  layout.append(grid, detail);
  root.append(head, layout);
  container.appendChild(root);
  return close;
}
