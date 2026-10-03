// The battle royale's layer of the HUD (ADR 0031), drawn inside the HUD's
// own root (ui/hud.ts) so it scales and turns with it: the Dusk line and
// the count at the top center, the score leader's badge under them, the
// warning while the champion stands in the Dusk, the drop's banner, the
// kill feed at the top right with a bot mark on every bot, the ring of the
// cache being opened, the loot and level notices, and the end screen built
// from the result the server sends. What any of it says is decided in
// ui/royale_text.ts and ui/royale_result.ts; this module only draws.

import type { PostMatchAction } from '../game/flow';
import { requestGameFullscreen } from '../game/fullscreen';
import type { RoyaleNote } from '../net/royale_client';
import type { RoyaleResult, SnapDusk, SnapRoyale } from '../net/royale_wire';
import { CAMPS } from '../sim/content/camps';
import { CHAMPIONS } from '../sim/content/champions';
import { ITEMS } from '../sim/content/items';
import { CREATURES } from '../sim/content/rings';
import { ROYALE_SEATS, type RoyaleVariant } from '../sim/royale/types';
import { effectiveRank } from '../sim/stats';
import type { TeamId } from '../sim/types';
import type { Unit } from '../sim/unit';
import type { IWorld } from '../world_api';
import { setPortrait } from './champion_art';
import { itemIconUrl } from './icons';
import { royaleMode } from './royale_modes';
import { type MomentCall, momentCalls } from './royale_moments';
import { type RoyaleEndModel, royaleEnd } from './royale_result';
import type { RoyaleStepsView } from './royale_steps';
import {
  countLine,
  dropBanner,
  duskLine,
  duskTurn,
  isBot,
  leaderBadge,
  levelText,
  lootText,
  openingFraction,
  outsideLight,
  placeText,
  seatName,
} from './royale_text';

// An enemy champion this close counts as near, for the takedown step.
const ENEMY_NEAR_M = 11;
// How long a feed line and a notice stay up, milliseconds.
const FEED_MS = 6500;
const NOTICE_MS = 3000;
const NOTICE_FADE_MS = 400;
const FEED_MAX = 5;

const CSS = `
.br { position: absolute; inset: 0; pointer-events: none; }
.br [hidden] { display: none !important; }
/* The top center: the Dusk line, the count under it, then the leader's
   badge and the Dusk's warning. The 5v5's team score and clock stood
   here; the battle royale has neither. */
.br-top { position: absolute; top: calc(8px + var(--safe-top, env(safe-area-inset-top, 0px)));
  left: 50%; transform: translateX(-50%); display: flex; flex-direction: column;
  align-items: center; gap: 4px; text-shadow: 0 1px 3px #000; }
.br-head { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.br-dusk { display: flex; align-items: center; gap: 9px; padding: 5px 16px 5px 12px;
  border-radius: 9px; border: 1px solid #6b5a2e; background: rgba(6, 10, 20, 0.84);
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.5); white-space: nowrap;
  font-family: Cinzel, Georgia, serif; font-size: 16px; font-weight: 700; letter-spacing: 1.4px;
  color: #f0dca0; font-variant-numeric: tabular-nums; }
.br-dusk i { flex: none; width: 12px; height: 12px; border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #fff4cc, #e8b45a 60%, #8a5a20);
  box-shadow: 0 0 10px rgba(240, 200, 106, 0.7); }
.br-dusk.hold { color: #e6eefc; }
.br-dusk.close { color: #ffb27a; border-color: #8a4a2a; }
.br-dusk.close i { background: radial-gradient(circle at 35% 35%, #ffd2a8, #e86a3a 60%, #6a2014);
  box-shadow: 0 0 12px rgba(232, 106, 58, 0.8); animation: br-ember 1.2s ease-in-out infinite; }
.br-dusk.dark { color: #f5a3a3; border-color: #7a2a34; }
.br-dusk.dark i { background: #3a0e18; box-shadow: 0 0 10px rgba(232, 74, 90, 0.6); }
@keyframes br-ember { 50% { transform: scale(1.25); } }
.br-count { font-size: 12.5px; font-weight: 700; color: #e6dcb8; letter-spacing: 0.3px;
  white-space: nowrap; }
.br-leader { display: flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px;
  border: 1px solid #8a7430; background: rgba(30, 26, 12, 0.88); color: #ffe08a;
  font-size: 12px; font-weight: 800; white-space: nowrap; }
.br-leader.self { background: linear-gradient(180deg, #e8cc74, #b8903c); color: #241a08;
  border-color: #f0deae; text-shadow: none; }
.br-leader.shown { box-shadow: 0 0 0 0 rgba(240, 206, 120, 0.7); animation: br-shown 1.6s ease-out infinite; }
@keyframes br-shown { 100% { box-shadow: 0 0 0 10px rgba(240, 206, 120, 0); } }
.br-crown { width: 13px; height: 9px; flex: none; background: currentColor;
  clip-path: polygon(0 100%, 0 20%, 25% 60%, 50% 0, 75% 60%, 100% 20%, 100% 100%); }
.br-burn { padding: 4px 12px; border-radius: 8px; border: 1px solid #a04040;
  background: rgba(61, 16, 20, 0.92); color: #ffc8c0; font-size: 12.5px; font-weight: 800;
  white-space: nowrap; animation: br-burn 1s ease-in-out infinite alternate; }
@keyframes br-burn { to { border-color: #ff7a6a; } }
/* The drop: the ask over the globe the renderer draws, and the seconds. */
.br-drop { position: absolute; left: 50%; top: calc(96px + var(--safe-top, env(safe-area-inset-top, 0px)));
  transform: translateX(-50%); display: flex; align-items: center; gap: 14px;
  padding: 10px 14px 10px 18px; border-radius: 14px; border: 1px solid #6b5a2e;
  background: rgba(6, 10, 20, 0.86); box-shadow: 0 22px 60px rgba(0, 0, 0, 0.55),
    0 0 34px rgba(232, 196, 108, 0.12); white-space: nowrap; }
.br-drop b { font-family: Cinzel, Georgia, serif; font-size: 19px; font-weight: 700;
  letter-spacing: 1.4px; color: #f0dca0; }
.br-drop span { flex: none; min-width: 52px; padding: 4px 10px; border-radius: 9px; text-align: center;
  background: linear-gradient(180deg, #e8cc74 0%, #c9a84a 55%, #a07830 100%); color: #241a08;
  font-size: 18px; font-weight: 900; font-variant-numeric: tabular-nums; }
/* The kill feed, top right under the K/D/A box. */
.br-feed { position: absolute; right: calc(12px + var(--safe-right, env(safe-area-inset-right, 0px)));
  top: calc(62px + var(--safe-top, env(safe-area-inset-top, 0px)));
  display: flex; flex-direction: column; align-items: flex-end; gap: 4px; font-size: 12.5px; }
.br-feed-line { display: flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 6px;
  background: rgba(6, 10, 20, 0.82); border: 1px solid #3a3420; color: #e6dcb8;
  text-shadow: 0 1px 2px #000; white-space: nowrap; animation: br-in 0.25s ease-out; }
.br-feed-line.mine { border-color: #b8963f; }
.br-feed-line .me { color: #ffd94a; font-weight: 800; }
.br-feed-line .gt { color: #c9a84a; font-weight: 800; }
.br-who { display: inline-flex; align-items: center; gap: 4px; }
.br-dusk-name { color: #ffb27a; font-weight: 700; }
@keyframes br-in { from { transform: translateX(10px); } }
.br-bot { display: inline-block; padding: 0 4px; border-radius: 3px; border: 1px solid #5b84c9;
  background: #1d3a63; color: #cfe3ff; font-size: 8.5px; font-weight: 800; letter-spacing: 0.8px;
  line-height: 13px; text-shadow: none; vertical-align: 1px; }
/* The cache being opened: a ring that fills over the opening time, above
   the bar. */
.br-open { position: absolute; left: 50%; bottom: 196px; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 4px; }
.br-ring { --f: 0; width: 46px; height: 46px; border-radius: 50%; position: relative;
  background: conic-gradient(#f0dca0 calc(var(--f) * 1turn), rgba(240, 220, 160, 0.16) 0);
  box-shadow: 0 0 16px rgba(240, 200, 106, 0.45); }
.br-ring::after { content: ''; position: absolute; inset: 6px; border-radius: 50%;
  background: radial-gradient(circle at 40% 35%, #3a2e14, #0b0d16 75%); }
.br-open b { font-size: 12px; font-weight: 800; color: #f0dca0; letter-spacing: 0.6px;
  text-shadow: 0 1px 3px #000; }
/* The notices: the loot as it lands, the levels. */
.br-notes { position: absolute; left: 50%; bottom: 262px; transform: translateX(-50%);
  display: flex; flex-direction: column-reverse; align-items: center; gap: 6px; }
.br-note { display: flex; align-items: center; gap: 8px; padding: 5px 14px 5px 6px;
  border-radius: 10px; border: 1px solid #8a7430; background: rgba(30, 26, 12, 0.9);
  color: #ffe08a; font-size: 15px; font-weight: 800; white-space: nowrap;
  text-shadow: 0 1px 3px #000; animation: br-note-in 0.3s ease-out;
  transition: opacity 0.4s ease, transform 0.4s ease; }
.br-note.fading { opacity: 0; transform: translateY(-8px); }
.br-note img { width: 28px; height: 28px; border-radius: 6px; border: 1px solid #6b5a2e; }
.br-note.level { color: #e6c8ff; border-color: #7a5ab0; background: rgba(30, 20, 44, 0.9);
  padding-left: 14px; }
/* Seen from its first frame, whatever the frame rate: a slow phone must
   not spend the notice's life on a fade in. It leaves on the HUD's own
   clock (update), not a keyframe's. */
@keyframes br-note-in { from { transform: translateY(8px) scale(0.94); } }
/* The drop hides what has no use yet: the bar, the slots, the corner. */
.hud.br-dropping .hud-bottom, .hud.br-dropping .hud-slots, .hud.br-dropping .hud-kda,
.hud.br-dropping .hud-hints, .hud.br-dropping .hud-statuses { visibility: hidden; }
.hud.br-dropping ~ .touchbar { display: none; }

/* The end screen: the landing's card over the match, which plays on
   behind it in One life. */
.br-end { position: absolute; inset: 0; z-index: 41; display: flex; align-items: center;
  justify-content: center; flex-direction: column; pointer-events: auto; overflow-y: auto;
  padding: 24px 16px; background: rgba(2, 4, 10, 0.62); }
.br-end-card { width: min(620px, 94%); padding: 22px 26px 20px; border-radius: 14px;
  border: 1px solid #6b5a2e; background: rgba(6, 10, 20, 0.9); color: #e6dcb8;
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.55), 0 0 34px rgba(232, 196, 108, 0.1);
  text-align: center; text-shadow: none; animation: br-card 0.45s ease-out; }
@keyframes br-card { from { opacity: 0; transform: translateY(14px); } }
.br-end-kicker { font-size: 11px; font-weight: 800; letter-spacing: 1.8px; text-transform: uppercase;
  color: #c9a84a; }
.br-end h2 { margin: 6px 0 4px; font-family: Cinzel, Georgia, serif; font-size: 30px;
  font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #f0dca0;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.7); }
.br-end-card.won h2 { color: #ffe08a; text-shadow: 0 0 24px rgba(240, 206, 120, 0.55); }
.br-end-line { margin: 2px 0 0; font-size: 14px; color: #c9bd93; }
.br-end-line:first-of-type { color: #f2e6c0; font-weight: 700; font-size: 15px; }
.br-end-rank { margin: 14px 0 4px; text-align: left; }
.br-end-rank h3 { display: flex; align-items: center; gap: 10px; margin: 0 0 6px; font-size: 11px;
  font-weight: 800; letter-spacing: 1.8px; text-transform: uppercase; color: #c9a84a; }
.br-end-rank h3::after { content: ''; flex: 1; height: 1px; background: rgba(201, 168, 74, 0.35); }
.br-end-row { display: grid; grid-template-columns: 30px 30px minmax(0, 1fr) auto; gap: 10px;
  align-items: center; padding: 4px 8px; border-radius: 8px; font-size: 13.5px; }
.br-end-row:nth-child(odd) { background: rgba(255, 255, 255, 0.03); }
.br-end-row.self { background: rgba(232, 196, 108, 0.14); box-shadow: inset 0 0 0 1px rgba(232, 196, 108, 0.45); }
.br-end-row .place { font-weight: 800; color: #c9a84a; font-variant-numeric: tabular-nums; }
.br-end-row img { width: 30px; height: 30px; border-radius: 6px; object-fit: cover;
  border: 1px solid #4a3f22; background: #0d1220; }
.br-end-row .who { display: flex; align-items: center; gap: 6px; min-width: 0; }
.br-end-row .who b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #f6ecd0; }
.br-end-row .who small { color: #8f8f9e; font-size: 11px; white-space: nowrap; }
.br-end-row .score { font-weight: 800; color: #ffe08a; font-variant-numeric: tabular-nums; }
.br-end-btns { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
.br-end-btns button { flex: 1 1 0; min-width: 120px; min-height: 44px; padding: 10px 14px;
  border-radius: 8px; cursor: pointer; font: inherit; font-size: 14px; font-weight: 700;
  border: 1px solid #6b5a2e; background: rgba(14, 18, 28, 0.9); color: #e6dcb8;
  transition: border-color 0.15s ease, transform 0.15s ease; }
.br-end-btns button:hover { border-color: #c9a84a; color: #fff3cf; transform: translateY(-1px); }
.br-end-btns button.primary { flex-grow: 1.4; font-weight: 800; letter-spacing: 0.6px; color: #241a08;
  border-color: #f0deae; background: linear-gradient(180deg, #e8cc74 0%, #c9a84a 55%, #a07830 100%);
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.25); }
.br-end-extras { display: flex; flex-direction: column; align-items: center; gap: 4px;
  margin-top: 6px; width: min(620px, 94%); }
.br-end-extras > * { margin-left: auto; margin-right: auto; }
.br-end-extras .hud-end-offer { width: 100%; }

/* A phone: the top is one row, the 5v5's team score's height, so the
   announcements and the first steps keep their places; the feed keeps
   clear of the map in the corner and of the touch bar; the notices and
   the ring keep off the middle, where the champion stands; the end card
   starts at the top and scrolls. */
.hud.compact .br-head { flex-direction: row; gap: 8px; }
.hud.compact .br-dusk { font-size: 13px; padding: 3px 12px 3px 9px; gap: 7px; }
.hud.compact .br-dusk i { width: 10px; height: 10px; }
.hud.compact .br-count { font-size: 11px; }
.hud.compact .br-leader { font-size: 10.5px; padding: 2px 8px; }
.hud.compact .br-burn { font-size: 11px; padding: 3px 10px; }
.hud.compact .br-drop { top: calc(66px + var(--safe-top, env(safe-area-inset-top, 0px)));
  padding: 6px 8px 6px 12px; gap: 10px; }
.hud.compact .br-drop b { font-size: 14px; letter-spacing: 0.8px; }
.hud.compact .br-drop span { font-size: 14px; min-width: 40px; padding: 3px 8px; }
.hud.compact .br-feed { font-size: 10.5px; gap: 3px;
  top: calc(40% + 58px); right: calc(12px + var(--safe-right, env(safe-area-inset-right, 0px))); }
.hud.compact.thumbs .br-feed { right: calc(12px + var(--safe-right, env(safe-area-inset-right, 0px)));
  top: calc(178px + var(--safe-top, env(safe-area-inset-top, 0px))); }
.hud.compact .br-feed-line { padding: 2px 7px; }
.hud.compact .br-feed-line:nth-child(n + 3) { display: none; }
.hud.compact .br-open { left: calc(50% + 175px); bottom: 24px; }
.hud.compact.thumbs .br-open { left: calc(40% + 132px); bottom: 18px; }
.hud.compact .br-ring { width: 36px; height: 36px; }
.hud.compact .br-ring::after { inset: 5px; }
.hud.compact .br-notes { bottom: 112px; }
.hud.compact.thumbs .br-notes { left: 40%; bottom: 64px; }
.hud.compact .br-note:nth-last-child(n + 3) { display: none; }
.hud.compact .br-note { font-size: 12.5px; padding: 3px 10px 3px 4px; }
.hud.compact .br-note img { width: 22px; height: 22px; }
.hud.compact .br-note.level { padding-left: 10px; }
.hud.compact .br-end { justify-content: flex-start; padding: 8px 10px 14px; }
/* The buttons climb over the ranking: a phone held sideways shows the
   title, the lines and the three buttons on its first screen, and the
   ranking scrolls under them. */
.hud.compact .br-end-card { padding: 12px 14px 12px; display: flex; flex-direction: column; flex: none; }
.hud.compact .br-end-btns { order: 1; margin-top: 8px; }
.hud.compact .br-end-rank { order: 2; }
.hud.compact .br-end h2 { font-size: 21px; margin: 2px 0 2px; letter-spacing: 1.2px; }
.hud.compact .br-end-line { font-size: 12px; }
.hud.compact .br-end-line:first-of-type { font-size: 12.5px; }
.hud.compact .br-end-rank { margin-top: 8px; }
.hud.compact .br-end-row { font-size: 12px; padding: 2px 6px; grid-template-columns: 24px 24px minmax(0, 1fr) auto; }
.hud.compact .br-end-row img { width: 24px; height: 24px; }
.hud.compact .br-end-btns button { min-height: 44px; padding: 6px 10px; font-size: 13px; min-width: 100px; }
`;

// A death as the feed reads it: who and by whom, and in a battle royale
// the names and bot marks the server sends with it (the victim's n and
// vb, the killer's kn and kb), since the feed names champions this screen
// has never seen.
export interface RoyaleKill {
  unitId: number;
  killerId: number;
  n?: string;
  kn?: string;
  vb?: boolean;
  kb?: boolean;
}

export interface RoyaleHudHost {
  // The HUD's root: this layer is drawn in it, and marks it during the drop.
  root: HTMLElement;
  world: IWorld;
  selfId: number;
  selfTeam: TeamId;
  variant: RoyaleVariant;
  touch: boolean;
  onExit: (action: PostMatchAction) => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export class RoyaleHud {
  private readonly host: RoyaleHudHost;
  private readonly style: HTMLStyleElement;
  private readonly layer: HTMLElement;
  private readonly duskEl: HTMLElement;
  private readonly duskText: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly leaderEl: HTMLElement;
  private readonly leaderText: HTMLElement;
  private readonly burnEl: HTMLElement;
  private readonly dropEl: HTMLElement;
  private readonly dropText: HTMLElement;
  private readonly dropLeft: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly openEl: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly notes: HTMLElement;
  private endEl: HTMLElement | null = null;
  private lastDusk: SnapDusk | null = null;
  private lastLevel = -1;
  // What this champion did this match, for the first steps.
  private openedCache = false;
  private padUsed = false;
  // Announcements go through the HUD's own line (ui/hud.ts announce).
  private announce: (text: string, color: string) => void = () => undefined;

  constructor(host: RoyaleHudHost) {
    this.host = host;
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.layer = el('div', 'br');
    const top = el('div', 'br-top');
    this.duskEl = el('div', 'br-dusk calm');
    this.duskText = el('span', '');
    this.duskEl.append(el('i', ''), this.duskText);
    this.countEl = el('div', 'br-count');
    this.leaderEl = el('div', 'br-leader');
    this.leaderText = el('span', '');
    this.leaderEl.append(el('i', 'br-crown'), this.leaderText);
    this.leaderEl.hidden = true;
    this.burnEl = el('div', 'br-burn');
    this.burnEl.hidden = true;
    const head = el('div', 'br-head');
    head.append(this.duskEl, this.countEl, this.leaderEl);
    top.append(head, this.burnEl);
    this.dropEl = el('div', 'br-drop');
    this.dropText = el('b', '');
    this.dropLeft = el('span', '');
    this.dropEl.append(this.dropText, this.dropLeft);
    this.dropEl.hidden = true;
    this.feed = el('div', 'br-feed');
    this.openEl = el('div', 'br-open');
    this.ring = el('div', 'br-ring');
    this.openEl.append(this.ring, el('b', '', 'Opening'));
    this.openEl.hidden = true;
    this.notes = el('div', 'br-notes');
    this.layer.append(top, this.dropEl, this.feed, this.openEl, this.notes);
    host.root.appendChild(this.layer);
  }

  setAnnounce(announce: (text: string, color: string) => void): void {
    this.announce = announce;
  }

  private state(): (SnapRoyale & { caches: unknown[] }) | null {
    return this.host.world.royaleView?.() ?? null;
  }

  // Once per world tick.
  update(): void {
    const r = this.state();
    const { world, selfId, root, touch } = this.host;
    this.stepNotices();
    this.layer.hidden = r === null;
    root.classList.toggle('br-dropping', r?.st === 'drop');
    if (!r) return;
    const time = world.time;
    const line = duskLine(r, time);
    if (this.duskText.textContent !== line.text) this.duskText.textContent = line.text;
    this.duskEl.className = `br-dusk ${line.tone}`;
    const count = countLine(r);
    if (this.countEl.textContent !== count) this.countEl.textContent = count;
    // The Dusk's turns, said once each as they come.
    const turn = duskTurn(this.lastDusk, r.dusk);
    if (turn) this.announce(turn, r.dusk.p >= 6 ? '#f5a3a3' : '#ffb27a');
    this.lastDusk = r.dusk;

    const badge = leaderBadge(r, selfId, (id) => this.nameOf(id));
    this.leaderEl.hidden = badge === null;
    if (badge) {
      if (this.leaderText.textContent !== badge.text) this.leaderText.textContent = badge.text;
      this.leaderEl.classList.toggle('self', badge.self);
      this.leaderEl.classList.toggle('shown', badge.shown);
    }

    const me = world.units.get(selfId);
    const outside = me && !me.dead && r.st === 'play' ? outsideLight(me.pos, r.dusk) : null;
    this.burnEl.hidden = outside !== true;
    if (outside === true) {
      const pct = Math.max(1, Math.round(r.dusk.b * 100));
      this.burnEl.textContent = `Outside the light: the Dusk burns ${pct} percent a second`;
    }

    const drop = dropBanner(r, time, touch);
    this.dropEl.hidden = drop === null;
    if (drop) {
      if (this.dropText.textContent !== drop.text) this.dropText.textContent = drop.text;
      if (this.dropLeft.textContent !== drop.left) this.dropLeft.textContent = drop.left;
    }

    const f = openingFraction(r, time);
    this.openEl.hidden = f === null;
    if (f !== null) this.ring.style.setProperty('--f', f.toFixed(3));

    if (me) {
      if (this.lastLevel !== -1 && me.level > this.lastLevel) {
        this.notice(levelText(me.level), null, 'level');
      }
      this.lastLevel = me.level;
    }
  }

  // Who a unit is on the screen: the seat's name, else what it is.
  private nameOf(unitId: number): string {
    const seat = this.host.world.seat?.(unitId);
    if (seat) return seat.name;
    const row = this.host.world.scoreboard().find((x) => x.unitId === unitId);
    if (row) return seatName(row);
    const u = this.host.world.units.get(unitId);
    if (u?.kind === 'camp' && u.campKind) return `The ${CAMPS[u.campKind].name}`;
    if (u?.kind === 'creature' && u.creatureId) return `The ${CREATURES[u.creatureId].name}`;
    if (u?.kind === 'warden') return 'The Warden';
    if (u?.kind === 'champion' && u.championId) {
      return CHAMPIONS[u.championId]?.name.split(',')[0] ?? 'A champion';
    }
    return 'The Dusk';
  }

  private botOf(unitId: number): boolean {
    const seat = this.host.world.seat?.(unitId);
    if (seat) return seat.bot;
    const row = this.host.world.scoreboard().find((x) => x.unitId === unitId);
    return isBot(row) || isBot(this.host.world.units.get(unitId));
  }

  // The names a death carries, else the seats', else what the unit is.
  victimName(k: RoyaleKill): string {
    return k.n ?? this.nameOf(k.unitId);
  }

  killerName(k: RoyaleKill): string {
    if (k.killerId === k.unitId || k.killerId === 0) return 'The Dusk';
    return k.kn ?? this.nameOf(k.killerId);
  }

  // One line of the kill feed: "Name > Name", the own name in gold, a bot
  // mark beside every bot.
  pushKill(k: RoyaleKill): void {
    const { selfId } = this.host;
    const line = el('div', 'br-feed-line');
    if (k.killerId === selfId || k.unitId === selfId) line.classList.add('mine');
    const dusk = k.killerId === k.unitId || k.killerId === 0;
    const who = (id: number, name: string, bot: boolean): HTMLElement => {
      const wrap = el('span', 'br-who');
      wrap.appendChild(el('span', id === selfId ? 'me' : '', id === selfId ? 'You' : name));
      if (id !== selfId && bot) wrap.appendChild(el('span', 'br-bot', 'BOT'));
      return wrap;
    };
    const killer = dusk
      ? el('span', 'br-dusk-name', 'The Dusk')
      : who(k.killerId, this.killerName(k), k.kb ?? this.botOf(k.killerId));
    line.append(
      killer,
      el('span', 'gt', '>'),
      who(k.unitId, this.victimName(k), k.vb ?? this.botOf(k.unitId)),
    );
    this.feed.prepend(line);
    while (this.feed.children.length > FEED_MAX) this.feed.lastElementChild?.remove();
    window.setTimeout(() => line.remove(), FEED_MS);
  }

  // The mode's events: the loot that lands on the own champion, and what
  // the first steps count.
  onNotes(notes: readonly RoyaleNote[]): void {
    const { selfId } = this.host;
    for (const n of notes) {
      if (n.kind === 'loot' && n.unitId === selfId) {
        const item = ITEMS[n.itemId];
        this.notice(lootText(item?.name ?? n.itemId), item ? itemIconUrl(item) : null, 'loot');
        if (n.source === 'cache') this.openedCache = true;
      } else if (n.kind === 'cache' && n.unitId === selfId) {
        this.openedCache = true;
      } else if (n.kind === 'pad' && n.unitId === selfId) {
        this.padUsed = true;
      }
    }
    this.playMoments(momentCalls(notes, selfId));
  }

  // The loud moments a snapshot's notes make (ui/royale_moments.ts).
  private playMoments(_calls: readonly MomentCall[]): void {}

  private notice(text: string, icon: string | null, kind: 'loot' | 'level'): void {
    const note = el('div', `br-note ${kind}`);
    if (icon) {
      const img = el('img', '');
      img.src = icon;
      img.alt = '';
      note.appendChild(img);
    }
    note.appendChild(el('span', '', text));
    note.dataset.until = String(performance.now() + NOTICE_MS);
    this.notes.appendChild(note);
    while (this.notes.children.length > 4) this.notes.firstElementChild?.remove();
  }

  // The notices' clock: each fades for its last moment, then leaves.
  private stepNotices(): void {
    const now = performance.now();
    for (const child of [...this.notes.children]) {
      const until = Number((child as HTMLElement).dataset.until ?? 0);
      if (now >= until) child.remove();
      else if (now >= until - NOTICE_FADE_MS) child.classList.add('fading');
    }
  }

  // What the first steps read of the match (ui/royale_steps.ts).
  stepsView(u: Readonly<Unit>, covered: boolean): RoyaleStepsView {
    const { world, selfId, selfTeam } = this.host;
    const r = this.state();
    const time = world.time;
    const landed = r !== null && r.st !== 'drop';
    let enemyNear = false;
    for (const o of world.units.values()) {
      if (o.id === selfId || o.dead || o.kind !== 'champion' || o.team === selfTeam) continue;
      if (!world.isVisible(selfTeam, o.id)) continue;
      const p = o.pos as { x: number; z: number; y?: number };
      const q = u.pos as { x: number; z: number; y?: number };
      const dy = typeof p.y === 'number' && typeof q.y === 'number' ? p.y - q.y : 0;
      if (Math.hypot(p.x - q.x, dy, p.z - q.z) <= ENEMY_NEAR_M) {
        enemyNear = true;
        break;
      }
    }
    const rCooling = (u.cooldowns.R ?? 0) > time;
    return {
      time,
      covered: covered || this.endEl !== null,
      dead: u.dead,
      sinceLanding: landed && r ? Math.max(0, time - r.de) : null,
      openedCache: this.openedCache,
      padUsed: this.padUsed,
      closing: r !== null && r.dusk.p >= 1,
      outside: r && !u.dead ? outsideLight(u.pos, r.dusk) : null,
      enemyNear,
      takedowns: r?.score ?? u.kills,
      level: u.level,
      ultReady: effectiveRank(u, 'R') > 0 && !rCooling,
      ultCast: rCooling,
    };
  }

  // The wash over a dead champion: Respawn counts the seconds back, One
  // life says the champion is out and where it placed.
  deathWords(u: Readonly<Unit>): { title: string; sub: string } {
    const r = this.state();
    if (this.host.variant === 'one_life') {
      return {
        title: 'OUT',
        sub: r?.place
          ? `You placed ${placeText(r.place, ROYALE_SEATS)}`
          : 'One life, and it is spent',
      };
    }
    return {
      title: 'SLAIN',
      sub: `Back in ${Math.max(0, u.respawnAt - this.host.world.time).toFixed(1)} s, at the edge of the light`,
    };
  }

  resultShown(): boolean {
    return this.endEl !== null;
  }

  // The end screen, from the result the server sent; `extras` are the
  // HUD's own boxes that belong under it (the ladder, the account offer,
  // the feedback box).
  // `next`: the next match is already under way behind the screen, and Play
  // again only closes it.
  showResult(result: RoyaleResult, extras: readonly HTMLElement[] = [], next = false): void {
    this.endEl?.remove();
    const model = royaleEnd(result, next);
    const end = el('div', 'br-end');
    end.appendChild(this.endCard(model, result, next));
    const more = el('div', 'br-end-extras');
    for (const x of extras) more.appendChild(x);
    if (extras.length > 0) end.appendChild(more);
    this.host.root.appendChild(end);
    this.endEl = end;
    this.host.root.classList.add('overlay-open');
  }

  // The end screen leaves, the match behind it stays: Respawn's next one.
  private hideResult(): void {
    this.endEl?.remove();
    this.endEl = null;
    this.host.root.classList.remove('overlay-open');
  }

  private endCard(model: RoyaleEndModel, result: RoyaleResult, next: boolean): HTMLElement {
    const card = el('div', `br-end-card${model.won ? ' won' : ''}`);
    card.append(
      el('div', 'br-end-kicker', `Battle royale · ${royaleMode(result.v).title}`),
      el('h2', '', model.title),
    );
    for (const line of model.lines) card.appendChild(el('p', 'br-end-line', line));
    if (model.rows.length > 0) {
      const rank = el('div', 'br-end-rank');
      rank.appendChild(el('h3', '', model.heading));
      for (const row of model.rows) {
        const line = el('div', `br-end-row${row.self ? ' self' : ''}`);
        const img = el('img', '');
        img.alt = '';
        setPortrait(img, row.championId, 0x6b5a2e);
        const who = el('span', 'who');
        who.appendChild(el('b', '', row.name));
        if (row.bot) who.appendChild(el('span', 'br-bot', 'BOT'));
        const champ = CHAMPIONS[row.championId]?.name.split(',')[0];
        if (champ) who.appendChild(el('small', '', champ));
        line.append(
          el('span', 'place', String(row.place)),
          img,
          who,
          el('span', 'score', String(row.score)),
        );
        rank.appendChild(line);
      }
      card.appendChild(rank);
    }
    const btns = el('div', 'br-end-btns');
    const button = (text: string, action: PostMatchAction, primary = false): HTMLButtonElement => {
      const b = el('button', primary ? 'primary' : '', text);
      b.type = 'button';
      b.dataset.exit = action;
      b.addEventListener('click', () => {
        // The next match may skip every click before it: this is the
        // gesture that takes it fullscreen.
        if (action !== 'menu') requestGameFullscreen();
        if (action === 'again' && next) this.hideResult();
        else this.host.onExit(action);
      });
      return b;
    };
    btns.append(
      button(model.again, 'again', true),
      button(model.other, 'other'),
      button(model.home, 'menu'),
    );
    card.appendChild(btns);
    return card;
  }

  dispose(): void {
    this.layer.remove();
    this.endEl?.remove();
    this.style.remove();
  }
}
