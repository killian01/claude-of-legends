// The own panel (CONTEXT.md: Own panel, ADR 0033), drawn: the top of the
// landing's Play now card, who the visitor is in the game from the first
// page. The mark (the champion last played, else the Wanderseed), the name
// with a way to change it in place, the line under it, the three tiles
// (the ladder, the level and its bar, the best) and the next thing within
// reach. Every word is ui/own_panel.ts's; the answer it draws is the
// landing's one request (src/net/landing.ts). The rename writes
// /api/ladder/name, the route the ladder box on the end screen writes
// (ui/ladder_box.ts), and a refusal is said in the server's own words.
//
// Every class is own-*, and every margin is set here: the card's own rules
// for p and h2 would otherwise reach in.

import { getSettings } from '../game/settings';
import type { LandingOwn } from '../net/landing';
import { setPortrait } from './champion_art';
import { saveName as postName, type SaveOutcome } from './ladder_box';
import { el } from './menu';
import {
  bestTile,
  editValue,
  kept,
  ladderTile,
  levelTile,
  nameShapeError,
  nextLine,
  OWN_CANCEL,
  OWN_CHANGE,
  OWN_CHANGE_LABEL,
  OWN_FIELD_HINT,
  OWN_FIELD_LABEL,
  OWN_HOME,
  OWN_KEEP,
  OWN_SAVE,
  OWN_SAVED,
  type OwnTile,
  ownSub,
} from './own_panel';
import { planetEmblem } from './planet_emblem';
import { NAME_FIELD_MAX } from './points_text';

// How long the word Saved. stays after a rename.
export const OWN_SAVED_MS = 2500;

const CSS = `
.own { display: flex; flex-direction: column; margin: 0 0 14px; text-align: left; min-width: 0; }
.own-who { display: flex; align-items: flex-start; gap: 12px; margin: 0; min-width: 0; }
.own-mark { position: relative; flex: none; width: 56px; height: 56px; border-radius: 50%;
  overflow: hidden; border: 1px solid #8a7433; background: #0a1120;
  box-shadow: 0 0 16px rgba(232, 196, 108, 0.18); }
.own-mark img.own-face { position: absolute; inset: 0; width: 100%; height: 100%; display: block;
  object-fit: cover; object-position: 50% 18%; }
.own-mark .planet-emblem { --planet: 100%; position: absolute; inset: 0; width: 100%;
  height: 100%; box-shadow: none; }
.own-id { display: flex; flex-direction: column; flex: 1; min-width: 0; margin: 0; }
.own-line { display: flex; align-items: center; gap: 10px; min-width: 0; margin: 0;
  min-height: 32px; }
.pg.land .own h2.own-name { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; font-family: Cinzel, Georgia, serif; font-size: 24px; font-weight: 700;
  line-height: 1.2; letter-spacing: 0.6px; text-transform: none; color: #f0dca0; }
.own-change { flex: none; margin: 0; min-height: 32px; padding: 0 12px; border-radius: 999px;
  border: 1px solid #2b3f60; background: rgba(10, 16, 30, 0.72); color: #c9a84a; cursor: pointer;
  font: inherit; font-size: 11.5px; font-weight: 800; letter-spacing: 1.2px;
  text-transform: uppercase; transition: border-color 0.15s ease, color 0.15s ease; }
.own-change:hover, .own-change:focus-visible { border-color: #c9a84a; color: #f0dca0;
  outline: none; }
.own-change[hidden], .own-line[hidden], .own-edit[hidden], .own-keep[hidden] { display: none; }
.own-edit { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin: 0; }
.pg .own-edit .menu-input.own-field { flex: 1 1 96px; width: auto; min-width: 0; margin: 0;
  height: 36px; padding: 0 10px; font-size: 16px; border-color: #8a7433; }
.pg .own-edit .menu-input.own-field:focus { border-color: #e8c46c; }
.pg.land .pg-card .own-edit .menu-btn.own-save { flex: none; width: auto; margin: 0;
  min-height: 36px; padding: 0 16px; font-size: 13px; }
.own-cancel { flex: none; margin: 0; min-height: 36px; padding: 0 4px; border: 0;
  background: none; color: #9db2cf; font: inherit; font-size: 12.5px; cursor: pointer;
  text-decoration: underline; }
.own-cancel:hover { color: #dceaff; }
.pg.land .own p.own-hint { flex-basis: 100%; margin: 0; font-size: 11px; line-height: 1.35;
  color: #8ba1c0; }
.pg.land .own p.own-sub { margin: 2px 0 0; font-size: 12px; line-height: 1.4; color: #9db2cf;
  min-width: 0; }
/* The sub line steps aside while the name is edited, so a refusal reads
   right under the field; specific enough to beat the sideways flex. */
.pg.land .own p.own-sub[hidden] { display: none; }
.own-keep { margin: 0; padding: 0; border: 0; background: none; font: inherit;
  font-weight: 700; color: #e8c46c; text-decoration: underline; cursor: pointer;
  white-space: nowrap; }
.own-keep:hover, .own-keep:focus-visible { color: #fff1b8; outline: none; }
.pg.land .own p.own-status { margin: 2px 0 0; font-size: 12px; line-height: 1.35;
  color: #9db2cf; }
.pg.land .own p.own-status:empty { display: none; }
.pg.land .own p.own-status.ok { color: #8fe0a6; }
.pg.land .own p.own-status.bad { color: #f5a3a3; }
.own-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px;
  margin: 12px 0 0; }
.own-tile { display: flex; flex-direction: column; gap: 2px; min-width: 0; margin: 0;
  padding: 8px 10px; border-radius: 10px; border: 1px solid #2b3f60;
  background: rgba(10, 16, 30, 0.72); }
.own-tile small { font-size: 10px; font-weight: 800; letter-spacing: 1.4px;
  text-transform: uppercase; color: #c9a84a; line-height: 1.2; }
.own-tile b { font-family: Cinzel, Georgia, serif; font-size: 22px; font-weight: 700;
  line-height: 1.1; color: #f0dca0; font-variant-numeric: tabular-nums; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.own-tile span { font-size: 11.5px; line-height: 1.3; color: #b9cbe4; }
.own-bar { position: relative; display: block; height: 6px; margin: 2px 0 1px; border-radius: 3px;
  overflow: hidden; background: #1b2740; }
.own-bar > i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px;
  background: linear-gradient(90deg, #f0d27a, #fff1b8);
  box-shadow: 0 0 8px rgba(255, 220, 120, 0.5); }
.pg.land .own p.own-next { margin: 10px 0 12px; font-size: 13px; font-weight: 700;
  line-height: 1.4; color: #f3e6bd; }
.pg.land .own p.own-next:last-child { margin-bottom: 0; }

/* A phone held sideways: one row of three compact chips, the name smaller,
   the line under it on one line, so the gold button keeps the first screen. */
@media (max-height: 560px) {
  .own-who { gap: 10px; align-items: center; }
  .own-mark { width: 40px; height: 40px; }
  .own-line { min-height: 32px; gap: 8px; }
  .pg.land .own h2.own-name { font-size: 18px; }
  .pg.land .own p.own-sub { margin-top: 0; font-size: 11px; display: flex; min-width: 0;
    white-space: nowrap; }
  .own-sub-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .own-keep { flex: none; margin-left: 5px; }
  .own-tiles { gap: 6px; margin-top: 8px; }
  .own-tile { display: grid; grid-template-columns: auto auto; justify-content: start;
    align-items: baseline; column-gap: 6px; row-gap: 2px; padding: 5px 8px; }
  .own-tile small { font-size: 9.5px; letter-spacing: 1px; }
  .own-tile b { font-size: 15px; }
  .own-tile span { display: none; }
  .own-bar { grid-column: 2; width: 48px; height: 3px; margin: 0; }
  .pg.land .own p.own-next { margin: 6px 0 8px; font-size: 12px; }
}
/* A phone held upright: three narrow tiles, their lines on up to two. */
@media (max-width: 560px) {
  .own-who { gap: 10px; }
  .own-mark { width: 48px; height: 48px; }
  .own-line { gap: 8px; }
  .pg.land .own h2.own-name { font-size: 20px; letter-spacing: 0.3px; }
  .own-change { padding: 0 10px; font-size: 11px; letter-spacing: 0.8px; }
  .own-tiles { gap: 6px; }
  .own-tile { padding: 7px 6px 7px 8px; }
  .own-tile b { font-size: 18px; }
  .own-tile span { font-size: 10.5px; display: -webkit-box; -webkit-line-clamp: 2;
    -webkit-box-orient: vertical; overflow: hidden; }
  .pg.land .own p.own-next { font-size: 12.5px; }
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

export interface OwnPanelOpts {
  // The account offered as keeping what the Guest holds, the name the
  // Guest stands under handed to the register form.
  onKeep(name: string): void;
  // A rename the server took: the ladder's own row and the account card
  // read it.
  onRenamed(name: string): void;
  // An account's way on, to the home.
  onHome(): void;
  // The rename's request, for a test or a script; /api/ladder/name if not.
  saveName?: (name: string) => Promise<SaveOutcome>;
}

export interface OwnPanel {
  // The panel's answer as it stands now, a rename included.
  own(): LandingOwn;
  // A rename made elsewhere on the page (the invitation's name field,
  // ui/invite_card.ts): the panel reads the new name.
  renamed(name: string): void;
}

// A pointer that is a finger: the keyboard rises over the lower half.
function touchFirst(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  } catch {
    return false;
  }
}

function tileView(tile: OwnTile, share: number | null): HTMLElement {
  const box = el('div', 'own-tile');
  box.append(el('small', '', tile.label), el('b', '', tile.value));
  if (share !== null) {
    const bar = el('i', 'own-bar');
    const fill = el('i', '');
    fill.style.width = `${(Math.max(0, Math.min(1, share)) * 100).toFixed(1)}%`;
    bar.appendChild(fill);
    box.appendChild(bar);
  }
  box.appendChild(el('span', '', tile.line));
  return box;
}

// The mark: the champion last played in the battle royale's quick pick,
// else the Wanderseed, so the panel has a face from the first page.
function markView(): HTMLElement {
  const mark = el('span', 'own-mark');
  mark.setAttribute('aria-hidden', 'true');
  const last = getSettings().royalePick?.championId;
  if (last) {
    const img = el('img', 'own-face');
    img.alt = '';
    img.decoding = 'async';
    setPortrait(img, last, 0x6b5a2e);
    mark.appendChild(img);
  } else {
    mark.appendChild(planetEmblem('respawn'));
  }
  return mark;
}

export function mountOwnPanel(host: HTMLElement, first: LandingOwn, opts: OwnPanelOpts): OwnPanel {
  ensureCss();
  let own = first;
  host.textContent = '';
  host.classList.add('own');

  const name = el('h2', 'own-name');
  const change = el('button', 'own-change', OWN_CHANGE);
  change.type = 'button';
  change.setAttribute('aria-label', OWN_CHANGE_LABEL);
  const line = el('div', 'own-line');
  line.append(name, change);

  const form = el('form', 'own-edit');
  form.hidden = true;
  form.noValidate = true;
  const field = el('input', 'menu-input own-field');
  field.type = 'text';
  field.maxLength = NAME_FIELD_MAX;
  field.autocomplete = 'off';
  field.setAttribute('autocapitalize', 'off');
  field.spellcheck = false;
  field.enterKeyHint = 'done';
  field.setAttribute('aria-label', OWN_FIELD_LABEL);
  const save = el('button', 'menu-btn primary own-save', OWN_SAVE);
  save.type = 'submit';
  const cancel = el('button', 'own-cancel', OWN_CANCEL);
  cancel.type = 'button';
  const hint = el('p', 'own-hint', OWN_FIELD_HINT);
  form.append(field, save, cancel, hint);

  const sub = el('p', 'own-sub');
  const subText = el('span', 'own-sub-text');
  const keep = el('button', 'own-keep');
  keep.type = 'button';
  sub.append(subText, ' ', keep);
  const status = el('p', 'own-status');
  status.setAttribute('role', 'status');

  const id = el('div', 'own-id');
  id.append(line, form, sub, status);
  const who = el('div', 'own-who');
  who.append(markView(), id);

  const tiles = el('div', 'own-tiles');
  const next = el('p', 'own-next');
  host.append(who, tiles, next);

  // Everything the answer decides, drawn again after a rename.
  const draw = (): void => {
    name.textContent = own.name;
    change.hidden = own.account;
    subText.textContent = ownSub(own);
    keep.hidden = !(own.account || kept(own));
    keep.textContent = own.account ? OWN_HOME : OWN_KEEP;
    const level = levelTile(own);
    tiles.replaceChildren(
      tileView(ladderTile(own), null),
      tileView(level, level.share),
      tileView(bestTile(own), null),
    );
    next.textContent = nextLine(own);
  };
  draw();

  let statusTimer = 0;
  const say = (text: string, tone: '' | 'ok' | 'bad'): void => {
    window.clearTimeout(statusTimer);
    status.textContent = text;
    status.className = `own-status${tone ? ` ${tone}` : ''}`;
  };

  const open = (): void => {
    say('', '');
    field.value = editValue(own);
    line.hidden = true;
    sub.hidden = true;
    form.hidden = false;
    field.focus();
    field.select();
    if (touchFirst()) form.scrollIntoView({ block: 'center' });
  };
  const close = (): void => {
    form.hidden = true;
    line.hidden = false;
    sub.hidden = false;
  };

  let busy = false;
  const submit = (): void => {
    if (busy) return;
    const typed = field.value.trim();
    if (typed === own.name) {
      close();
      say('', '');
      return;
    }
    const wrong = nameShapeError(typed);
    if (wrong) {
      say(wrong, 'bad');
      field.focus();
      return;
    }
    busy = true;
    save.disabled = true;
    say('', '');
    void (opts.saveName ?? postName)(typed).then((out) => {
      busy = false;
      save.disabled = false;
      if (!out.ok) {
        say(out.error, 'bad');
        field.focus();
        return;
      }
      own = { ...own, name: out.name, named: true };
      draw();
      close();
      say(OWN_SAVED, 'ok');
      statusTimer = window.setTimeout(() => say('', ''), OWN_SAVED_MS);
      opts.onRenamed(out.name);
    });
  };

  change.addEventListener('click', open);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  cancel.addEventListener('click', () => {
    close();
    say('', '');
  });
  field.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
    say('', '');
    change.focus();
  });
  keep.addEventListener('click', () => {
    if (own.account) opts.onHome();
    else opts.onKeep(editValue(own));
  });

  return {
    own: () => own,
    renamed: (renamedTo: string): void => {
      own = { ...own, name: renamedTo, named: true };
      draw();
    },
  };
}
