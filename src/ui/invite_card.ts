// The invitation, drawn (ADR 0036): a band under the landing's bar, before
// the hero, for someone who followed an invite link to a private lobby. Not
// a layer: it sits in the page and Not now puts it away. It holds its
// height from the first frame with the plain invitation in it, and is
// filled from the landing's answer (src/net/landing.ts): the host's name
// and how many are in, a full lobby, a closed one, or a connection that has
// tried too many wrong codes. Every word is ui/landing_invite.ts's.
//
// The name field offers the own panel's editable form of the Guest's name
// (ui/own_panel.ts editValue). A different name is saved through the route
// the own panel writes (/api/ladder/name), after the landing has answered
// (the Guest's cookie rides that answer), and awaited before Join: a
// refusal is said in the server's words and the visitor stays.
//
// Every class is pg-invite-*, and every margin is set here.

import type { LandingOwn, LandingPage } from '../net/landing';
import { tileArtUrl } from './home_tiles';
import { saveName as postName, type SaveOutcome } from './ladder_box';
import {
  breathes,
  INVITE_CALL,
  INVITE_FIELD_LABEL,
  INVITE_NOT_NOW,
  INVITE_OPEN_OWN,
  INVITE_REGISTER,
  INVITE_SIGN_IN,
  type InviteState,
  type InviteWords,
  inviteWords,
  nameStep,
} from './landing_invite';
import { el } from './menu';
import { editValue } from './own_panel';
import { NAME_FIELD_MAX } from './points_text';

const CSS = `
.pg-invite { position: relative; box-sizing: border-box; display: flex; flex-direction: column;
  gap: 8px; width: 100%; max-width: 1180px; margin: clamp(8px, 1.6vh, 16px) auto 0;
  padding: 14px 18px; border-radius: 14px; border: 1px solid #8a7433; overflow: hidden;
  background: #0a1120; text-align: left; box-shadow: 0 22px 60px rgba(0, 0, 0, 0.55); }
/* An author display rule beats the browser's own [hidden]: Not now. */
.pg-invite[hidden] { display: none; }
/* The home's lobby painting, faded behind the words. */
.pg-invite::before { content: ''; position: absolute; inset: 0;
  background: var(--view) 50% 35% / cover no-repeat; opacity: 0.4; }
.pg-invite::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg,
  rgba(6, 10, 20, 0.5) 0%, rgba(6, 10, 20, 0.88) 45%, rgba(6, 10, 20, 0.94) 100%); }
.pg-invite > * { position: relative; z-index: 1; }
.pg-invite-words { display: flex; flex-direction: column; gap: 3px; min-width: 0; margin: 0; }
.pg.land .pg-invite h2.pg-invite-title { margin: 0; font-family: Cinzel, Georgia, serif;
  font-size: 20px; font-weight: 700; line-height: 1.2; letter-spacing: 1px; color: #f0dca0;
  text-transform: none; }
.pg.land .pg-invite p.pg-invite-line { margin: 0; min-height: 1.4em; font-size: 13px;
  line-height: 1.4; color: #c9d6ea; }
.pg-invite-form { display: flex; flex-direction: column; gap: 4px; margin: 0; min-width: 0; }
.pg-invite-form[hidden], .pg-invite-other[hidden], .pg-invite-name[hidden],
  .pg-invite-links button[hidden] { display: none; }
.pg-invite-name { display: flex; flex-direction: column; gap: 4px; min-width: 0;
  flex: 0 1 280px; }
.pg-invite-label { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: 0.4px;
  color: #9db2cf; }
.pg-invite-row { display: flex; align-items: flex-end; gap: 10px; margin: 0; min-width: 0; }
.pg .pg-invite .menu-input.pg-invite-field { width: 100%; min-width: 0; margin: 0; height: 40px;
  padding: 0 10px; font-size: 16px; border-color: #8a7433; box-sizing: border-box; }
.pg .pg-invite .menu-input.pg-invite-field:focus { border-color: #e8c46c; }
/* Join wears the gold of a call to play, in a class of its own. */
.pg.land .pg-invite .menu-btn.pg-invite-go { position: relative; overflow: hidden; flex: none;
  width: auto; margin: 0; min-height: 40px; padding: 0 22px; font-size: 14px; font-weight: 800;
  letter-spacing: 1px; text-transform: uppercase; color: #2a1d06; border: 1px solid #f3dc9a;
  background: linear-gradient(180deg, #f6e3a6 0%, #e2bf64 55%, #c99a3c 100%);
  box-shadow: 0 0 0 1px rgba(120, 86, 20, 0.6), 0 6px 22px rgba(232, 196, 108, 0.45),
    inset 0 1px 0 rgba(255, 250, 225, 0.8); }
.pg.land .pg-invite .menu-btn.pg-invite-go:hover:not(:disabled) { filter: brightness(1.08); }
.pg.land .pg-invite .menu-btn.pg-invite-go:disabled { filter: grayscale(0.7) brightness(0.7);
  cursor: default; }
.pg-invite-other { display: flex; margin: 0; }
.pg.land .pg-invite .menu-btn.pg-invite-own { width: auto; margin: 0; min-height: 40px;
  padding: 0 20px; font-size: 13.5px; }
.pg.land .pg-invite p.pg-invite-status { margin: 0; font-size: 12px; line-height: 1.35;
  color: #f5a3a3; }
.pg.land .pg-invite p.pg-invite-status:empty { display: none; }
.pg-invite-links { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; margin: 0; }
.pg-invite-links button { margin: 0; padding: 4px 0; border: 0; background: none; font: inherit;
  font-size: 12.5px; color: #9db2cf; text-decoration: underline; cursor: pointer; }
.pg-invite-links button:hover, .pg-invite-links button:focus-visible { color: #f0dca0;
  outline: none; }
/* It rises with the page, before the hero. */
.pg.land .pg-invite { animation: land-rise 0.8s cubic-bezier(0.2, 0.7, 0.2, 1) 0.3s backwards; }
/* While the invitation can be taken, the band breathes the gold halo the
   Play now card wears otherwise: one gold call breathes at a time. */
.pg.land .pg-invite.glow { border-color: #b8963f;
  animation: land-rise 0.8s cubic-bezier(0.2, 0.7, 0.2, 1) 0.3s backwards,
    land-try-halo 3.2s ease-in-out 1.8s infinite; }
@media (max-width: 1120px) {
  .pg-invite { max-width: 620px; }
}
/* A phone held sideways: the title on one line, the count on one, the
   field and Join on one row, the links on one line. */
@media (max-height: 560px) {
  .pg-invite { gap: 6px; padding: 10px 14px; margin-top: 6px; }
  .pg.land .pg-invite h2.pg-invite-title { font-size: 16px; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; }
  .pg.land .pg-invite p.pg-invite-line { font-size: 12px; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; }
  .pg-invite-label { font-size: 10.5px; }
  .pg .pg-invite .menu-input.pg-invite-field { height: 36px; }
  .pg.land .pg-invite .menu-btn.pg-invite-go, .pg.land .pg-invite .menu-btn.pg-invite-own {
    min-height: 36px; }
  .pg-invite-links button { padding: 2px 0; font-size: 12px; }
}
/* A phone held upright: the field over Join, both the whole width. */
@media (max-width: 560px) {
  .pg-invite { padding: 12px 14px; }
  .pg.land .pg-invite h2.pg-invite-title { font-size: 17px; letter-spacing: 0.4px; }
  .pg-invite-row { flex-direction: column; align-items: stretch; }
  .pg-invite-name { flex: none; }
  .pg.land .pg-invite .menu-btn.pg-invite-go { width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .pg.land .pg-invite, .pg.land .pg-invite.glow { animation: none; }
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

export interface InviteCardOpts {
  // Join the lobby by its code, as a Guest, under the name settled.
  onJoin(code: string): void;
  // A lobby of one's own, offered by a full or closed one.
  onOpenOwn(): void;
  // The quiet links: the credential panel on its sign-in tab, or on its
  // register tab with the name in the field. Both keep the code.
  onSignIn(): void;
  onRegister(name: string): void;
  // A rename the server took: the own panel, the ladder's own row and the
  // account card read it.
  onRenamed(name: string): void;
  // Whether the band breathes the gold halo; the Play now card wears it
  // when the band does not.
  onBreathe(on: boolean): void;
  // The rename's request, for a test or a script; /api/ladder/name if not.
  saveName?: (name: string) => Promise<SaveOutcome>;
}

export interface InviteCard {
  // The code a sign-in from this page still owes: the invite's, until the
  // band is left by Join, Open a lobby or Not now.
  pending(): string | null;
  // A rename made by the own panel: the field offers the new name.
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

export function mountInviteCard(
  host: HTMLElement,
  code: string,
  pagePromise: Promise<LandingPage | null>,
  opts: InviteCardOpts,
): InviteCard {
  ensureCss();
  const save = opts.saveName ?? postName;
  let pending: string | null = code;
  let state: InviteState = 'waiting';
  host.textContent = '';
  host.classList.add('pg-invite');
  host.style.setProperty('--view', `url(${tileArtUrl('lobby')})`);

  const title = el('h2', 'pg-invite-title');
  const line = el('p', 'pg-invite-line');
  const words = el('div', 'pg-invite-words');
  words.append(title, line);

  // The name and Join, one row; a form, so Enter in the field joins.
  const form = el('form', 'pg-invite-form');
  form.noValidate = true;
  const field = el('input', 'menu-input pg-invite-field');
  field.id = 'pg-invite-field';
  field.type = 'text';
  field.maxLength = NAME_FIELD_MAX;
  field.autocomplete = 'off';
  field.setAttribute('autocapitalize', 'off');
  field.spellcheck = false;
  field.enterKeyHint = 'go';
  const label = el('label', 'pg-invite-label', INVITE_FIELD_LABEL);
  label.htmlFor = field.id;
  const nameBox = el('div', 'pg-invite-name');
  nameBox.append(label, field);
  const go = el('button', 'menu-btn pg-invite-go', INVITE_CALL);
  go.type = 'submit';
  const row = el('div', 'pg-invite-row');
  row.append(nameBox, go);
  form.appendChild(row);

  // A full or closed lobby offers one of one's own instead.
  const other = el('div', 'pg-invite-other');
  other.hidden = true;
  const own = el('button', 'menu-btn pg-invite-own', INVITE_OPEN_OWN);
  own.type = 'button';
  other.appendChild(own);

  const status = el('p', 'pg-invite-status');
  status.setAttribute('role', 'status');

  const links = el('div', 'pg-invite-links');
  const signIn = el('button', '', INVITE_SIGN_IN);
  signIn.type = 'button';
  const register = el('button', '', INVITE_REGISTER);
  register.type = 'button';
  const notNow = el('button', '', INVITE_NOT_NOW);
  notNow.type = 'button';
  links.append(signIn, register, notNow);

  host.append(words, form, other, status, links);

  // Who the Guest is, once the answer says, a rename included; and the
  // name the field offers: '' until then.
  let current: LandingOwn | null = null;
  let offered = '';
  let touched = false;
  const offer = (who: LandingOwn): void => {
    current = who;
    offered = editValue(who);
    if (!touched) field.value = offered;
  };
  field.addEventListener('input', () => {
    touched = true;
  });
  if (touchFirst()) {
    field.addEventListener('focus', () => form.scrollIntoView({ block: 'center' }));
  }

  const apply = (said: InviteWords): void => {
    state = said.state;
    title.textContent = said.title;
    line.textContent = said.line;
    const joinable = state === 'waiting' || state === 'open' || state === 'limited';
    form.hidden = !joinable;
    other.hidden = joinable;
    signIn.hidden = !joinable;
    register.hidden = !joinable;
    go.disabled = state === 'limited';
    const on = !host.hidden && breathes(state);
    host.classList.toggle('glow', on);
    opts.onBreathe(on);
  };
  apply(inviteWords(undefined));

  void pagePromise.then((page) => {
    if (host.hidden) return;
    const who = page?.own ?? null;
    if (who) {
      offer(who);
      // An account joins under its own name: there is nothing to rename.
      nameBox.hidden = who.account;
    }
    apply(inviteWords(page?.invite));
  });

  let busy = false;
  const join = async (): Promise<void> => {
    if (busy || go.disabled) return;
    busy = true;
    go.disabled = true;
    status.textContent = '';
    // The rename needs the Guest the landing's answer hands out.
    await pagePromise;
    const step = nameStep(field.value, current);
    if (step.kind !== 'keep') {
      const out =
        step.kind === 'wrong' ? { ok: false as const, error: step.error } : await save(step.name);
      if (!out.ok) {
        busy = false;
        go.disabled = state === 'limited';
        status.textContent = out.error;
        return;
      }
      if (current) offer({ ...current, name: out.name, named: true });
      opts.onRenamed(out.name);
    }
    pending = null;
    opts.onJoin(code);
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void join();
  });
  own.addEventListener('click', () => {
    pending = null;
    opts.onOpenOwn();
  });
  signIn.addEventListener('click', () => opts.onSignIn());
  register.addEventListener('click', () => opts.onRegister(field.value.trim() || offered));
  notNow.addEventListener('click', () => {
    pending = null;
    host.hidden = true;
    host.classList.remove('glow');
    opts.onBreathe(false);
  });

  return {
    pending: () => pending,
    renamed: (name: string): void => {
      if (current) offer({ ...current, name, named: true });
    },
  };
}
