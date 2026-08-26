// The in-game HUD: ability and sigil bar with cooldowns, hp/mana/xp, status
// chips, gold and clock, keybind hints, inventory, the shop (P), the
// scoreboard (Tab), kill feed, chat and pings, announcements, death and end
// screens, and the Escape menu. Reads the world through IWorld only; content
// data (items, sigils, champions) is data-as-code it may read directly.

import { playSfx } from '../game/sfx';
import type { Status } from '../sim/combat/status';
import { effectiveItemCost, ITEM_LIST, ITEMS, type ItemStats } from '../sim/content/items';
import { SIGILS } from '../sim/content/sigils';
import {
  BASIC_MAX_RANK,
  effectiveRank,
  MAX_LEVEL,
  ULT_MAX_RANK,
  ULT_RANK_LEVELS,
  xpForNext,
} from '../sim/stats';
import type { AbilityKey, TeamId } from '../sim/types';
import type { IWorld } from '../world_api';
import { abilityIconUrl, sigilIconUrl } from './ability_icons';
import { describeAbility, describeItem, describeSigil } from './describe';
import { iconDataUrl, itemIconUrl } from './icons';
import { attachTooltip } from './tooltips';

const KEY_TINTS: Readonly<Record<string, [string, string]>> = {
  Q: ['#7a2f1f', '#c96a3a'],
  W: ['#1f4a7a', '#3a8ac9'],
  E: ['#2f6a2a', '#5aa53a'],
  R: ['#5a2a7a', '#9a5ac9'],
  D: ['#6a5a1f', '#c9a53a'],
  F: ['#6a5a1f', '#c9a53a'],
};

const KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];
const TEAM_TEXT_COLORS = ['#9dbcf5', '#f5a3a3'];

function statusLabel(s: Status, time: number): string {
  const left = Math.max(0, s.until - time);
  switch (s.kind) {
    case 'stun':
      return `STUN ${left.toFixed(1)}`;
    case 'root':
      return `ROOT ${left.toFixed(1)}`;
    case 'recall':
      return `RECALL ${left.toFixed(1)}`;
    case 'slow':
      return `SLOW ${Math.round(s.pct * 100)}%`;
    case 'shield':
      return `SHIELD ${Math.round(s.remaining)}`;
    case 'mark':
      return `MARK x${s.stacks}`;
    case 'dot':
      return 'BURNING';
    case 'grievous':
      return 'GRIEVOUS';
    case 'stealth':
      return 'HIDDEN';
    case 'taunt':
      return 'TAUNTED';
    case 'buff':
      return 'BOOSTED';
    default:
      return '';
  }
}

function statLabel(s: ItemStats): string {
  const parts: string[] = [];
  if (s.ad) parts.push(`+${s.ad} AD`);
  if (s.ap) parts.push(`+${s.ap} AP`);
  if (s.hp) parts.push(`+${s.hp} HP`);
  if (s.mana) parts.push(`+${s.mana} MP`);
  if (s.armor) parts.push(`+${s.armor} ARM`);
  if (s.mr) parts.push(`+${s.mr} MR`);
  if (s.attackSpeedPct) parts.push(`+${Math.round(s.attackSpeedPct * 100)}% AS`);
  if (s.moveSpeed) parts.push(`+${s.moveSpeed} MS`);
  return parts.join(' ');
}

function itemInitials(id: string): string {
  return id
    .split('_')
    .map((w) => (w[0] ?? '').toUpperCase())
    .join('');
}

const CSS = `
.hud, .hud * { box-sizing: border-box; }
.hud {
  position: absolute; inset: 0; font-family: system-ui, sans-serif;
  user-select: none; pointer-events: none; color: #d8e6c0; z-index: 6;
}
.hud-bottom {
  position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%);
  display: flex; flex-direction: column; gap: 6px; align-items: center;
}
.hud-statuses { display: flex; gap: 4px; min-height: 18px; justify-content: center; flex-wrap: wrap; }
.hud-chip {
  background: #3d3312; border: 1px solid #8a6d2c; border-radius: 4px;
  color: #f0dfae; font-size: 10px; font-weight: 700; padding: 2px 6px;
}
.hud-meta { font-size: 12px; text-shadow: 0 1px 2px #000; }
.hud-main { display: flex; align-items: center; gap: 10px; }
.hud-level {
  width: 46px; height: 46px; border-radius: 50%; flex: none;
  background: radial-gradient(circle at 35% 30%, #2c3d1e, #131c0c 75%);
  border: 2px solid #b89b3e; color: #f2e6b8;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; font-weight: 800; text-shadow: 0 1px 3px #000;
  pointer-events: auto;
}
.hud-level.pop { animation: hud-level-pop 0.7s ease-out; }
@keyframes hud-level-pop {
  0% { transform: scale(1); box-shadow: 0 0 0 rgba(232, 200, 98, 0); }
  35% { transform: scale(1.35); box-shadow: 0 0 22px rgba(232, 200, 98, 0.9); }
  100% { transform: scale(1); box-shadow: 0 0 0 rgba(232, 200, 98, 0); }
}
.hud-gold {
  display: flex; align-items: center; gap: 6px; flex: none; min-width: 72px;
  font-size: 16px; font-weight: 800; color: #ffd94a; text-shadow: 0 1px 3px #000;
  pointer-events: auto;
}
.hud-coin {
  width: 14px; height: 14px; border-radius: 50%; flex: none;
  background: radial-gradient(circle at 35% 30%, #ffe9a0, #b8860b 80%);
  border: 1px solid #7a5a10;
}
.hud-bars { width: 240px; display: flex; flex-direction: column; gap: 3px; }
.hud-bar { position: relative; height: 12px; border-radius: 3px; background: #10160c; overflow: hidden; }
.hud-bar.flash { animation: hud-mana-flash 0.4s ease-out 2; }
@keyframes hud-mana-flash {
  0% { filter: brightness(1); }
  40% { filter: brightness(2.1); box-shadow: inset 0 0 12px rgba(150, 195, 255, 0.9); }
  100% { filter: brightness(1); }
}
.hud-bar-fill { position: absolute; inset: 0; transform-origin: left; }
.hud-bar-text { position: absolute; inset: 0; text-align: center; font-size: 9px; line-height: 12px; color: #fff; text-shadow: 0 1px 2px #000; }
.hud-slots { display: flex; gap: 6px; pointer-events: auto; }
.hud-slot {
  position: relative; width: 46px; height: 46px; border-radius: 6px;
  background: #1d2a14; border: 1px solid #466030; color: #d8e6c0;
  display: flex; align-items: center; justify-content: center;
  font-size: 19px; font-weight: 700;
}
.hud-slot.nomana { border-color: #27436e; color: #6f8cb8; }
.hud-slot.nomana { filter: saturate(0.35) brightness(0.75); }
.hud-slot-key {
  position: absolute; right: 3px; top: 1px;
  font-size: 11px; font-weight: 800; color: #f2f6e4; text-shadow: 0 1px 3px #000;
}
.hud-slot-cd {
  position: absolute; inset: 0; border-radius: 6px; background: rgba(0,0,0,0.72);
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-size: 15px; font-weight: 600;
}
.hud-slot-name {
  position: absolute; left: 0; right: 0; bottom: -13px;
  font-size: 8px; font-weight: 400; text-align: center; color: #93a87c; white-space: nowrap;
}
.hud-slot-pips {
  position: absolute; left: 3px; right: 3px; bottom: 2px;
  display: flex; gap: 2px; justify-content: center;
}
.hud-slot-pip {
  width: 5px; height: 5px; border-radius: 1px;
  background: #2c3d1e; border: 1px solid #466030;
}
.hud-slot-pip.on { background: #e8c862; border-color: #b89b3e; }
.hud-slot-up {
  position: absolute; left: 50%; top: -20px; transform: translateX(-50%);
  width: 18px; height: 18px; border-radius: 4px; cursor: pointer;
  background: #b89b3e; color: #14200c; border: 1px solid #e8c862;
  font-size: 14px; font-weight: 800; line-height: 16px; text-align: center;
  animation: hud-up-pulse 1s ease-in-out infinite alternate;
}
@keyframes hud-up-pulse { from { filter: brightness(0.85); } to { filter: brightness(1.25); } }
.hud-inv { display: flex; gap: 4px; pointer-events: auto; }
.hud-inv-slot {
  width: 30px; height: 30px; border-radius: 4px; background: #17210f;
  border: 1px solid #3a4f28; color: #c9d8ae; font-size: 10px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.hud-hints {
  position: absolute; left: 12px; bottom: 12px; font-size: 10px; color: #93a87c;
  text-shadow: 0 1px 2px #000; max-width: 240px; line-height: 1.6;
}
.hud-shop {
  position: absolute; left: 50%; top: 5vh; transform: translateX(-50%);
  width: min(880px, calc(100vw - 400px)); min-width: 620px; max-height: 82vh;
  background: rgba(12, 17, 8, 0.97); border: 1px solid #6e8f4a; border-radius: 10px;
  box-shadow: 0 14px 44px rgba(0, 0, 0, 0.65);
  display: none; flex-direction: column; pointer-events: auto; z-index: 8;
}
.hud-shop.open { display: flex; }
.hud-shop-head {
  flex: none; display: flex; align-items: center; gap: 14px;
  padding: 10px 14px; border-bottom: 1px solid #3a4f28;
}
.hud-shop-head h3 { margin: 0; font-size: 16px; }
.hud-shop-status { font-size: 11px; color: #93a87c; flex: 1; }
.hud-shop-close {
  pointer-events: auto; border: 1px solid #466030; background: #1d2a14; color: #d8e6c0;
  border-radius: 5px; font-size: 12px; padding: 4px 10px; cursor: pointer;
}
.hud-shop-close:hover { border-color: #7ca050; }
.hud-shop-body { display: flex; min-height: 0; }
.hud-shop-grid { flex: 1; overflow-y: auto; padding: 8px 12px 12px; }
.hud-shop-grid h4 {
  margin: 10px 0 6px; font-size: 11px; letter-spacing: 1px;
  color: #93a87c; text-transform: uppercase;
}
.hud-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 6px; }
.hud-card {
  position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px;
  background: #1d2a14; border: 1px solid #3a4f28; border-radius: 6px;
  color: #d8e6c0; padding: 7px 4px 5px; cursor: pointer; font-size: 11px; text-align: center;
}
.hud-card:hover { border-color: #7ca050; }
.hud-card.sel { border-color: #e8c862; box-shadow: 0 0 8px rgba(232, 200, 98, 0.35); }
.hud-card.cant { opacity: 0.45; }
.hud-card img { border-radius: 4px; }
.hud-card-cost { color: #ffd94a; font-weight: 700; font-size: 11px; }
.hud-card-own {
  position: absolute; top: 2px; right: 3px; background: #2f6a2a; color: #e8f5c8;
  border-radius: 3px; font-size: 9px; font-weight: 800; padding: 0 4px;
}
.hud-card-recipe { display: flex; gap: 2px; justify-content: center; min-height: 14px; }
.hud-card-recipe img { width: 13px; height: 13px; border-radius: 2px; opacity: 0.9; }
.hud-shop-detail {
  flex: none; width: 300px; border-left: 1px solid #3a4f28;
  padding: 12px; overflow-y: auto; font-size: 12px;
}
.hud-detail-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.hud-detail-head img { border-radius: 6px; }
.hud-detail-name { font-size: 15px; font-weight: 700; color: #f2ffd9; }
.hud-detail-tier { font-size: 10px; color: #93a87c; }
.hud-detail-stats { color: #b7cf96; margin-bottom: 10px; line-height: 1.5; }
.hud-build-label { font-size: 10px; color: #93a87c; margin: 8px 0 4px; text-transform: uppercase; letter-spacing: 1px; }
.hud-build-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.hud-build-row .op { color: #93a87c; font-weight: 700; }
.hud-build-icon { position: relative; width: 34px; height: 34px; cursor: pointer; }
.hud-build-icon img { width: 34px; height: 34px; border-radius: 5px; border: 2px solid #3a4f28; display: block; }
.hud-build-icon.owned img { border-color: #58d84e; }
.hud-build-icon .tick {
  position: absolute; right: -3px; bottom: -3px; width: 12px; height: 12px;
  border-radius: 50%; background: #2f6a2a; color: #e8f5c8; font-size: 9px;
  line-height: 12px; text-align: center; font-weight: 800;
}
.hud-detail-cost { margin: 10px 0 4px; }
.hud-detail-cost .pay { color: #ffd94a; font-weight: 800; font-size: 14px; }
.hud-detail-cost .full { color: #93a87c; font-size: 11px; }
.hud-buy {
  pointer-events: auto; width: 100%; margin-top: 8px; padding: 8px 0; border-radius: 6px;
  border: 1px solid #b89b3e; background: #3d3312; color: #f0dfae;
  font-size: 13px; font-weight: 700; cursor: pointer;
}
.hud-buy:hover:not(:disabled) { background: #55491d; }
.hud-buy:disabled { opacity: 0.45; cursor: default; }
.hud-buy-why { font-size: 10px; color: #c9a08e; margin-top: 4px; text-align: center; }
.hud-detail-empty { color: #93a87c; font-size: 12px; line-height: 1.5; }
.hud-feed {
  position: absolute; top: 12px; left: 12px; display: flex; flex-direction: column;
  gap: 4px; font-size: 12px; text-shadow: 0 1px 2px #000;
}
.hud-feed-entry {
  background: rgba(14, 20, 9, 0.8); border: 1px solid #3a4f28; border-radius: 4px;
  padding: 3px 8px;
}
.hud-chat {
  position: absolute; left: 12px; bottom: 90px; width: 300px; font-size: 12px;
  display: flex; flex-direction: column; gap: 2px;
}
.hud-chat-line { text-shadow: 0 1px 2px #000; background: rgba(10,14,6,0.55); border-radius: 3px; padding: 1px 6px; }
.hud-chat-input {
  pointer-events: auto; width: 100%; padding: 5px 8px; border-radius: 4px;
  border: 1px solid #466030; background: rgba(16, 22, 12, 0.95); color: #d8e6c0;
  font-size: 12px; outline: none; display: none;
}
.hud-announce {
  position: absolute; top: 64px; left: 50%; transform: translateX(-50%);
  font-size: 26px; font-weight: 800; letter-spacing: 1px; color: #f2ffd9;
  text-shadow: 0 2px 8px #000; opacity: 0; transition: opacity 0.3s;
}
.hud-toast {
  position: absolute; bottom: 150px; left: 50%; transform: translateX(-50%);
  background: rgba(61, 23, 16, 0.95); border: 1px solid #a05040; border-radius: 6px;
  color: #f5c9c0; font-size: 12px; padding: 6px 12px; opacity: 0; transition: opacity 0.25s;
}
.hud-score {
  position: absolute; top: 40px; left: 50%; transform: translateX(-50%);
  width: 640px; max-width: 94vw; background: rgba(14, 20, 9, 0.95);
  border: 1px solid #466030; border-radius: 10px; padding: 12px 16px; display: none; z-index: 9;
}
.hud-score.open { display: block; }
.hud-score h3 { margin: 0 0 8px; font-size: 14px; text-align: center; }
.hud-score-teams { display: flex; gap: 20px; }
.hud-score-team { flex: 1; }
.hud-score-team h4 { margin: 0 0 4px; font-size: 12px; }
.hud-score-team.blue h4 { color: #9dbcf5; }
.hud-score-team.red h4 { color: #f5a3a3; }
.hud-score-row {
  display: grid; grid-template-columns: 1fr 74px 40px; gap: 6px;
  font-size: 12px; padding: 2px 0; align-items: baseline;
}
.hud-score-row.head { color: #93a87c; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; }
.hud-score-row.self { color: #e8f5c8; font-weight: 700; }
.hud-score-kda { color: #93a87c; white-space: nowrap; text-align: right; }
.hud-score-row.self .hud-score-kda { color: #e8f5c8; }
.hud-score-cs { color: #93a87c; text-align: right; }
.hud-kda {
  position: absolute; top: 12px; right: 12px; text-align: right;
  background: rgba(14, 20, 9, 0.85); border: 1px solid #3a4f28; border-radius: 6px;
  padding: 5px 12px; font-size: 15px; font-weight: 800; color: #e8f5c8;
  text-shadow: 0 1px 2px #000; pointer-events: auto;
}
.hud-kda .cs { display: block; font-size: 11px; font-weight: 600; color: #93a87c; }
.hud-overlay {
  position: absolute; inset: 0; display: none;
  align-items: center; justify-content: center; flex-direction: column;
  background: rgba(0, 0, 0, 0.45); text-shadow: 0 2px 8px #000; z-index: 10;
}
.hud-overlay.open { display: flex; }
.hud-overlay-title { font-size: 52px; font-weight: 800; letter-spacing: 2px; }
.hud-overlay-sub { font-size: 16px; margin-top: 6px; }
.hud-menu-btn {
  pointer-events: auto; margin-top: 10px; padding: 10px 26px; border-radius: 6px;
  border: 1px solid #466030; background: #1d2a14; color: #d8e6c0;
  font-size: 14px; font-weight: 600; cursor: pointer;
}
.hud-menu-btn:hover { border-color: #7ca050; }
.hud-end-card {
  margin-top: 14px; padding: 14px 18px; border-radius: 10px;
  background: rgba(14, 20, 9, 0.92); border: 1px solid #466030;
  display: flex; gap: 26px; pointer-events: auto;
}
.hud-end-team { min-width: 170px; }
.hud-end-team h4 { margin: 0 0 6px; font-size: 13px; }
.hud-end-team.blue h4 { color: #9dbcf5; }
.hud-end-team.red h4 { color: #f5a3a3; }
.hud-end-row { display: flex; justify-content: space-between; font-size: 12px; padding: 2px 0; }
.hud-end-row span:last-child { color: #93a87c; margin-left: 12px; white-space: nowrap; }
`;

export interface NetHooks {
  sendChat?: (text: string) => void;
  sendPing?: (x: number, z: number) => void;
}

export class Hud {
  private readonly world: IWorld;
  private readonly selfId: number;
  private readonly selfTeam: TeamId;
  private readonly metaText: HTMLElement;
  private readonly statusRow: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly manaFill: HTMLElement;
  private readonly manaText: HTMLElement;
  private readonly xpFill: HTMLElement;
  private readonly xpText: HTMLElement;
  private readonly slots = new Map<
    AbilityKey,
    { root: HTMLElement; cd: HTMLElement; pips: HTMLElement; up: HTMLElement }
  >();
  private readonly sigilSlots: { root: HTMLElement; cd: HTMLElement; label: HTMLElement }[] = [];
  private readonly invSlots: HTMLElement[] = [];
  private readonly levelBadge: HTMLElement;
  private readonly goldText: HTMLElement;
  private readonly manaBar: HTMLElement;
  private readonly shop: HTMLElement;
  private readonly shopStatus: HTMLElement;
  private readonly shopGoldText: HTMLElement;
  private readonly shopDetail: HTMLElement;
  private readonly itemButtons = new Map<string, HTMLButtonElement>();
  private readonly ownBadges = new Map<string, HTMLElement>();
  private shopSelected: string | null = null;
  private lastDetailSig = '';
  private lastLevel = -1;
  private readonly deathOverlay: HTMLElement;
  private readonly deathSub: HTMLElement;
  private readonly endOverlay: HTMLElement;
  private readonly endTitle: HTMLElement;
  private readonly endSub: HTMLElement;
  private readonly endStats: HTMLElement;
  private readonly escapeOverlay: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly chatLog: HTMLElement;
  private readonly chatInput: HTMLInputElement;
  private readonly announceEl: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly score: HTMLElement;
  private readonly scoreTeams: [HTMLElement, HTMLElement];
  private readonly kdaText: HTMLElement;
  private readonly kdaCs: HTMLElement;
  private netHooks: NetHooks = {};
  private announceUntil = 0;
  private sawBattleBegin = false;
  private sawFirstBlood = false;
  private endPlayed = false;
  private lastTowerCount: number | null = null;

  constructor(container: HTMLElement, world: IWorld, selfId: number, selfTeam: TeamId) {
    this.world = world;
    this.selfId = selfId;
    this.selfTeam = selfTeam;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.className = 'hud';
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

    const bottom = el('div', 'hud-bottom');
    this.statusRow = el('div', 'hud-statuses');
    this.metaText = el('div', 'hud-meta');

    const bars = el('div', 'hud-bars');
    const mkBar = (color: string): { bar: HTMLElement; fill: HTMLElement; text: HTMLElement } => {
      const bar = el('div', 'hud-bar');
      const fill = el('div', 'hud-bar-fill');
      fill.style.background = color;
      const text = el('div', 'hud-bar-text');
      bar.append(fill, text);
      bars.appendChild(bar);
      return { bar, fill, text };
    };
    const hp = mkBar('#3f9b45');
    const mana = mkBar('#3763b8');
    const xp = mkBar('#8a5fc9');
    this.hpFill = hp.fill;
    this.hpText = hp.text;
    this.manaBar = mana.bar;
    this.manaFill = mana.fill;
    this.manaText = mana.text;
    this.xpFill = xp.fill;
    this.xpText = xp.text;

    // Level and gold get first-class visual weight: a gold-rimmed level
    // badge and a coin counter flanking the bars, not a line of small text.
    this.levelBadge = el('div', 'hud-level', '1');
    attachTooltip(this.levelBadge, () => {
      const me = this.world.units.get(this.selfId);
      if (!me) return [];
      return me.level >= MAX_LEVEL
        ? [`Level ${me.level}`, 'Maximum level reached.']
        : [`Level ${me.level}`, `XP ${Math.floor(me.xp)} / ${xpForNext(me.level)} to next level.`];
    });
    const goldBox = el('div', 'hud-gold');
    this.goldText = el('span', '', '0g');
    goldBox.append(el('span', 'hud-coin'), this.goldText);
    attachTooltip(goldBox, () => [
      'Gold',
      'Earned from minions, kills, towers, and over time.',
      'Spend it in the shop (P) at your fountain.',
    ]);
    const mainRow = el('div', 'hud-main');
    mainRow.append(this.levelBadge, bars, goldBox);

    const self = world.units.get(selfId);
    const def = self?.championId ? world.championDef(self.championId) : null;

    const tintSlot = (slot: HTMLElement, key: string): void => {
      const tint = KEY_TINTS[key];
      if (!tint) return;
      slot.style.backgroundImage = `url(${iconDataUrl('', tint[0], tint[1])})`;
      slot.style.backgroundSize = 'cover';
      slot.style.textShadow = '0 2px 4px #000';
    };

    const slots = el('div', 'hud-slots');
    for (const key of KEYS) {
      const slot = el('div', 'hud-slot');
      if (def) {
        // A painted icon derived from the ability record itself; the hotkey
        // moves to a corner badge so the art stays readable.
        slot.style.backgroundImage = `url(${abilityIconUrl(key, def.abilities[key])})`;
        slot.style.backgroundSize = 'cover';
        slot.appendChild(el('span', 'hud-slot-key', key));
      } else {
        slot.textContent = key;
        tintSlot(slot, key);
      }
      const cd = el('div', 'hud-slot-cd');
      cd.style.display = 'none';
      slot.appendChild(cd);
      const pips = el('div', 'hud-slot-pips');
      slot.appendChild(pips);
      const up = el('div', 'hud-slot-up', '+');
      up.style.display = 'none';
      up.addEventListener('click', (e) => {
        e.stopPropagation();
        this.world.levelAbility(this.selfId, key);
      });
      slot.appendChild(up);
      if (def) {
        const name = el('div', 'hud-slot-name', def.abilities[key].name);
        slot.appendChild(name);
        attachTooltip(slot, () => describeAbility(key, def.abilities[key]));
      }
      slots.appendChild(slot);
      this.slots.set(key, { root: slot, cd, pips, up });
    }
    for (const [i, keyLabel] of (['D', 'F'] as const).entries()) {
      const slot = el('div', 'hud-slot');
      slot.style.borderColor = '#6b5a2e';
      const sigilId = self?.sigils[i];
      const sigilDef = sigilId ? SIGILS[sigilId] : undefined;
      if (sigilDef) {
        slot.style.backgroundImage = `url(${sigilIconUrl(sigilDef)})`;
        slot.style.backgroundSize = 'cover';
        slot.appendChild(el('span', 'hud-slot-key', keyLabel));
      } else {
        slot.textContent = keyLabel;
        tintSlot(slot, keyLabel);
      }
      const cd = el('div', 'hud-slot-cd');
      cd.style.display = 'none';
      slot.appendChild(cd);
      const label = el('div', 'hud-slot-name');
      slot.appendChild(label);
      attachTooltip(slot, () => {
        const u = this.world.units.get(this.selfId);
        const sigil = u?.sigils[i] ? SIGILS[u.sigils[i]!] : undefined;
        return sigil ? describeSigil(sigil) : [];
      });
      slots.appendChild(slot);
      this.sigilSlots.push({ root: slot, cd, label });
    }

    const inv = el('div', 'hud-inv');
    for (let i = 0; i < 6; i++) {
      const slot = el('div', 'hud-inv-slot');
      attachTooltip(slot, () => {
        const u = this.world.units.get(this.selfId);
        const itemId = u?.items[i];
        const itemDef = itemId ? ITEMS[itemId] : undefined;
        return itemDef ? describeItem(itemDef, statLabel(itemDef.stats)) : [];
      });
      inv.appendChild(slot);
      this.invSlots.push(slot);
    }

    bottom.append(this.statusRow, this.metaText, mainRow, slots, inv);

    const hints = el('div', 'hud-hints');
    hints.textContent =
      'Right-click: move / attack. A: attack-move. B: recall. Q W E R: abilities. ' +
      'D F: sigils. P: shop. Tab: scoreboard. Enter: chat. G: ping. Esc: menu. ' +
      'Screen edges pan the camera; Space recenters; left-click the minimap to look. ' +
      'Level up: click + above an ability.';

    // The always-visible personal score, MOBA style: K / D / A plus creep
    // score, top right.
    const kda = el('div', 'hud-kda');
    this.kdaText = el('div', '', '0 / 0 / 0');
    this.kdaCs = el('span', 'cs', 'CS 0');
    kda.append(this.kdaText, this.kdaCs);
    attachTooltip(kda, () => ['Kills / Deaths / Assists', 'CS: minions last-hit.']);

    // The shop: a large centered window (clear of the minimap) laid out like
    // the genre expects. Components on top, finished items below with their
    // recipes visible on the card, and a detail pane showing the full build
    // path, the discounted price, and a Buy button.
    this.shop = el('div', 'hud-shop');
    const shopHead = el('div', 'hud-shop-head');
    shopHead.appendChild(el('h3', '', 'Shop'));
    const shopGoldBox = el('div', 'hud-gold');
    this.shopGoldText = el('span', '', '0g');
    shopGoldBox.append(el('span', 'hud-coin'), this.shopGoldText);
    this.shopStatus = el('div', 'hud-shop-status');
    const shopClose = el('button', 'hud-shop-close', 'Close (P)') as HTMLButtonElement;
    shopClose.type = 'button';
    shopClose.addEventListener('click', () => this.toggleShop());
    shopHead.append(shopGoldBox, this.shopStatus, shopClose);

    const shopBody = el('div', 'hud-shop-body');
    const shopGrid = el('div', 'hud-shop-grid');
    const makeCard = (item: (typeof ITEM_LIST)[number]): HTMLButtonElement => {
      const btn = el('button', 'hud-card') as HTMLButtonElement;
      btn.type = 'button';
      const own = el('span', 'hud-card-own');
      own.style.display = 'none';
      const icon = document.createElement('img');
      icon.src = itemIconUrl(item);
      icon.width = 30;
      icon.height = 30;
      const recipe = el('div', 'hud-card-recipe');
      for (const compId of item.buildsFrom ?? []) {
        const comp = ITEMS[compId];
        if (!comp) continue;
        const mini = document.createElement('img');
        mini.src = itemIconUrl(comp);
        recipe.appendChild(mini);
      }
      btn.append(
        own,
        icon,
        el('div', '', item.name),
        recipe,
        el('div', 'hud-card-cost', `${item.cost}g`),
      );
      attachTooltip(btn, () => describeItem(item, statLabel(item.stats)));
      btn.addEventListener('click', () => this.selectShopItem(item.id));
      btn.addEventListener('dblclick', () => this.tryBuy(item.id));
      this.itemButtons.set(item.id, btn);
      this.ownBadges.set(item.id, own);
      return btn;
    };
    const addSection = (title: string, items: readonly (typeof ITEM_LIST)[number][]): void => {
      shopGrid.appendChild(el('h4', '', title));
      const cards = el('div', 'hud-cards');
      for (const item of items) cards.appendChild(makeCard(item));
      shopGrid.appendChild(cards);
    };
    addSection(
      'Components',
      ITEM_LIST.filter((i) => i.tier === 1),
    );
    addSection(
      'Finished items, built from two components',
      ITEM_LIST.filter((i) => i.tier === 2),
    );
    this.shopDetail = el('div', 'hud-shop-detail');
    shopBody.append(shopGrid, this.shopDetail);
    this.shop.append(shopHead, shopBody);

    this.feed = el('div', 'hud-feed');

    const chat = el('div', 'hud-chat');
    this.chatLog = el('div', '');
    this.chatInput = el('input', 'hud-chat-input') as HTMLInputElement;
    this.chatInput.maxLength = 200;
    this.chatInput.placeholder = 'Press Enter to send, Esc to cancel';
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.chatInput.value.trim();
        if (text.length > 0) {
          if (this.netHooks.sendChat) this.netHooks.sendChat(text);
          else this.pushChat('You', this.selfTeam, text);
        }
        this.chatInput.value = '';
        this.closeChat();
      } else if (e.key === 'Escape') {
        this.chatInput.value = '';
        this.closeChat();
      }
    });
    chat.append(this.chatLog, this.chatInput);

    this.announceEl = el('div', 'hud-announce');
    this.toastEl = el('div', 'hud-toast');

    this.score = el('div', 'hud-score');
    this.score.append(el('h3', '', 'Scoreboard (Tab)'));
    const teamsWrap = el('div', 'hud-score-teams');
    const mkTeam = (cls: string, label: string): HTMLElement => {
      const box = el('div', `hud-score-team ${cls}`);
      box.appendChild(el('h4', '', label));
      const rows = el('div', '');
      box.appendChild(rows);
      teamsWrap.appendChild(box);
      return rows;
    };
    this.scoreTeams = [mkTeam('blue', 'Team 1'), mkTeam('red', 'Team 2')];
    this.score.appendChild(teamsWrap);

    this.deathOverlay = el('div', 'hud-overlay');
    this.deathSub = el('div', 'hud-overlay-sub');
    this.deathOverlay.append(el('div', 'hud-overlay-title', 'SLAIN'), this.deathSub);

    this.endOverlay = el('div', 'hud-overlay');
    this.endTitle = el('div', 'hud-overlay-title');
    this.endSub = el('div', 'hud-overlay-sub');
    this.endStats = el('div', 'hud-end-card');
    const endReturn = el('button', 'hud-menu-btn', 'Return to menu');
    endReturn.addEventListener('click', () => window.location.reload());
    this.endOverlay.append(this.endTitle, this.endSub, this.endStats, endReturn);

    this.escapeOverlay = el('div', 'hud-overlay');
    const resume = el('button', 'hud-menu-btn', 'Resume (Esc)');
    resume.addEventListener('click', () => this.toggleEscapeMenu());
    const quit = el('button', 'hud-menu-btn', 'Leave match');
    quit.addEventListener('click', () => window.location.reload());
    this.escapeOverlay.append(el('div', 'hud-overlay-title', 'Paused view'), resume, quit);

    root.append(
      bottom,
      hints,
      kda,
      this.shop,
      this.feed,
      chat,
      this.announceEl,
      this.toastEl,
      this.score,
      this.deathOverlay,
      this.endOverlay,
      this.escapeOverlay,
    );
    container.appendChild(root);
  }

  setNetHooks(hooks: NetHooks): void {
    this.netHooks = hooks;
  }

  toggleShop(): void {
    this.shop.classList.toggle('open');
    this.update();
  }

  toggleScoreboard(): void {
    this.score.classList.toggle('open');
    this.update();
  }

  toggleEscapeMenu(): void {
    this.escapeOverlay.classList.toggle('open');
  }

  isChatOpen(): boolean {
    return this.chatInput.style.display === 'block';
  }

  // True while a modal owns the pointer; the camera must not edge-pan then.
  blocksCamera(): boolean {
    return (
      this.shop.classList.contains('open') ||
      this.escapeOverlay.classList.contains('open') ||
      this.endOverlay.classList.contains('open')
    );
  }

  openChat(): void {
    this.chatInput.style.display = 'block';
    this.chatInput.focus();
  }

  private closeChat(): void {
    this.chatInput.style.display = 'none';
    this.chatInput.blur();
  }

  pushChat(from: string, team: TeamId, text: string): void {
    const line = document.createElement('div');
    line.className = 'hud-chat-line';
    const name = document.createElement('span');
    name.textContent = `${from}: `;
    name.style.color = TEAM_TEXT_COLORS[team] ?? '#c9d8ae';
    const body = document.createElement('span');
    body.textContent = text;
    line.append(name, body);
    this.chatLog.appendChild(line);
    while (this.chatLog.children.length > 6) this.chatLog.firstChild?.remove();
    window.setTimeout(() => line.remove(), 12000);
  }

  announce(text: string): void {
    this.announceEl.textContent = text;
    this.announceEl.style.opacity = '1';
    this.announceUntil = performance.now() + 2600;
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.style.opacity = '1';
    window.setTimeout(() => {
      this.toastEl.style.opacity = '0';
    }, 1800);
  }

  private atFountain(): boolean {
    const u = this.world.units.get(this.selfId);
    if (!u) return false;
    const fountain = this.world.map.fountains.find((f) => f.team === u.team);
    if (!fountain) return false;
    return Math.hypot(u.pos.x - fountain.x, u.pos.z - fountain.z) <= fountain.r + 2;
  }

  private tryBuy(itemId: string): void {
    const u = this.world.units.get(this.selfId);
    if (!u) return;
    if (!this.atFountain()) {
      playSfx('deny');
      this.toast('You must be at your fountain to buy.');
      return;
    }
    const cost = effectiveItemCost(itemId, u.items);
    if (u.gold < cost) {
      playSfx('deny');
      this.toast(`Not enough gold: ${cost}g needed.`);
      return;
    }
    if (this.world.buyItem(this.selfId, itemId)) playSfx('buy');
    this.update();
  }

  // A bright pulse on the mana bar so "why did my key do nothing" has a
  // visible answer next to the number that explains it.
  flashMana(): void {
    this.manaBar.classList.remove('flash');
    void (this.manaBar as HTMLElement).offsetWidth;
    this.manaBar.classList.add('flash');
  }

  private selectShopItem(itemId: string): void {
    this.shopSelected = itemId;
    this.lastDetailSig = '';
    this.update();
  }

  // The right-hand pane of the shop: stats, the build path with owned
  // components highlighted, what an item builds into, and the price the
  // player actually pays after component discounts.
  private renderShopDetail(u: Readonly<{ gold: number; items: readonly string[] }>): void {
    const d = this.shopDetail;
    d.textContent = '';
    const mk = (cls: string, text?: string): HTMLElement => {
      const e = document.createElement('div');
      e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    };
    const def = this.shopSelected ? ITEMS[this.shopSelected] : undefined;
    if (!def) {
      d.appendChild(
        mk(
          'hud-detail-empty',
          'Select an item to see its stats, build path, and price. ' +
            'Finished items combine two components; owning a component discounts the upgrade.',
        ),
      );
      return;
    }

    const head = mk('hud-detail-head');
    const bigIcon = document.createElement('img');
    bigIcon.src = itemIconUrl(def);
    bigIcon.width = 44;
    bigIcon.height = 44;
    const title = mk('');
    title.append(
      mk('hud-detail-name', def.name),
      mk('hud-detail-tier', def.tier === 1 ? 'Component' : 'Finished item'),
    );
    head.append(bigIcon, title);
    d.appendChild(head);
    d.appendChild(mk('hud-detail-stats', statLabel(def.stats)));

    const buildIcon = (itemId: string, owned: boolean): HTMLElement => {
      const item = ITEMS[itemId];
      const wrap = mk(owned ? 'hud-build-icon owned' : 'hud-build-icon');
      const img = document.createElement('img');
      if (item) img.src = itemIconUrl(item);
      wrap.appendChild(img);
      if (owned) {
        const tick = document.createElement('span');
        tick.className = 'tick';
        wrap.appendChild(tick);
      }
      if (item) {
        attachTooltip(wrap, () => describeItem(item, statLabel(item.stats)));
        wrap.addEventListener('click', () => this.selectShopItem(itemId));
      }
      return wrap;
    };

    if (def.buildsFrom && def.buildsFrom.length > 0) {
      d.appendChild(mk('hud-build-label', 'Build path'));
      const row = mk('hud-build-row');
      // Greedy match against the inventory so duplicates highlight one each.
      const pool = [...u.items];
      def.buildsFrom.forEach((compId, i) => {
        if (i > 0) row.appendChild(mk('op', '+'));
        const at = pool.indexOf(compId);
        const owned = at !== -1;
        if (owned) pool.splice(at, 1);
        row.appendChild(buildIcon(compId, owned));
      });
      row.appendChild(mk('op', '='));
      row.appendChild(buildIcon(def.id, false));
      d.appendChild(row);
    }

    const into = ITEM_LIST.filter((i) => (i.buildsFrom ?? []).includes(def.id));
    if (into.length > 0) {
      d.appendChild(mk('hud-build-label', 'Builds into'));
      const row = mk('hud-build-row');
      for (const item of into) row.appendChild(buildIcon(item.id, false));
      d.appendChild(row);
    }

    const eff = effectiveItemCost(def.id, u.items);
    const costBox = mk('hud-detail-cost');
    if (eff < def.cost) {
      costBox.append(
        mk('pay', `You pay ${eff}g`),
        mk('full', `Combined cost ${def.cost}g; your components cover the rest.`),
      );
    } else {
      costBox.appendChild(mk('pay', `Price ${def.cost}g`));
    }
    d.appendChild(costBox);

    const shopOk = this.atFountain();
    const buy = document.createElement('button');
    buy.type = 'button';
    buy.className = 'hud-buy';
    buy.textContent = `Buy (${eff}g)`;
    buy.disabled = !shopOk || u.gold < eff;
    buy.addEventListener('click', () => this.tryBuy(def.id));
    d.appendChild(buy);
    if (!shopOk) d.appendChild(mk('hud-buy-why', 'Return to your fountain to buy.'));
    else if (u.gold < eff)
      d.appendChild(mk('hud-buy-why', `You need ${Math.ceil(eff - u.gold)} more gold.`));
  }

  // One feed line per champion death, team-colored.
  pushKills(kills: readonly { unitId: number; killerId: number }[]): void {
    if (kills.length === 0) return;
    const rows = this.world.scoreboard();
    const rowOf = (id: number) => rows.find((r) => r.unitId === id);
    for (const k of kills) {
      const victimRow = rowOf(k.unitId);
      if (!victimRow) continue;
      if (!this.sawFirstBlood) {
        this.sawFirstBlood = true;
        this.announce('First blood');
      }
      if (k.unitId === this.selfId) playSfx('death');
      else if (k.killerId === this.selfId) playSfx('kill');
      const killerRow = rowOf(k.killerId);
      let killerName = killerRow?.name ?? 'The lane';
      let killerColor = killerRow ? TEAM_TEXT_COLORS[killerRow.team] : '#c9d8ae';
      if (!killerRow) {
        const killerUnit = this.world.units.get(k.killerId);
        if (killerUnit?.kind === 'tower') killerName = 'A tower';
        else if (killerUnit?.kind === 'minion') killerName = 'Minions';
        if (killerUnit) killerColor = TEAM_TEXT_COLORS[killerUnit.team];
      }
      const entry = document.createElement('div');
      entry.className = 'hud-feed-entry';
      const killer = document.createElement('span');
      killer.textContent = killerName;
      killer.style.color = killerColor ?? '#c9d8ae';
      const middle = document.createElement('span');
      middle.textContent = ' killed ';
      const victim = document.createElement('span');
      victim.textContent = victimRow.name;
      victim.style.color = TEAM_TEXT_COLORS[victimRow.team] ?? '#c9d8ae';
      entry.append(killer, middle, victim);
      this.feed.appendChild(entry);
      window.setTimeout(() => entry.remove(), 6000);
    }
  }

  // Called once per world tick.
  update(): void {
    const u = this.world.units.get(this.selfId);
    if (!u) return;

    if (this.announceUntil !== 0 && performance.now() > this.announceUntil) {
      this.announceEl.style.opacity = '0';
      this.announceUntil = 0;
    }

    // Opening countdown and match milestones.
    if (!this.sawBattleBegin) {
      if (this.world.time < 10) {
        this.announceEl.textContent = `Minions spawn in ${Math.ceil(10 - this.world.time)}s`;
        this.announceEl.style.opacity = '1';
      } else {
        this.sawBattleBegin = true;
        this.announce('Battle begins');
      }
    }
    const towerCount = [...this.world.units.values()].filter((x) => x.kind === 'tower').length;
    if (this.lastTowerCount !== null && towerCount < this.lastTowerCount) {
      this.announce('A tower has fallen');
      playSfx('tower');
    }
    this.lastTowerCount = towerCount;

    const total = Math.max(0, Math.floor(this.world.time));
    const clock = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    this.metaText.textContent = clock;
    this.levelBadge.textContent = String(u.level);
    this.goldText.textContent = `${Math.floor(u.gold)}g`;
    if (this.lastLevel !== -1 && u.level > this.lastLevel) {
      playSfx('levelup');
      this.levelBadge.classList.remove('pop');
      void this.levelBadge.offsetWidth;
      this.levelBadge.classList.add('pop');
    }
    this.lastLevel = u.level;
    this.hpFill.style.transform = `scaleX(${Math.max(0, u.hp / u.maxHp)})`;
    this.hpText.textContent = `${Math.ceil(u.hp)} / ${Math.round(u.maxHp)}`;
    this.manaFill.style.transform = `scaleX(${Math.max(0, u.mana / u.maxMana)})`;
    this.manaText.textContent = `${Math.floor(u.mana)} / ${Math.round(u.maxMana)}`;
    const xpFrac = u.level >= MAX_LEVEL ? 1 : Math.min(1, u.xp / xpForNext(u.level));
    this.xpFill.style.transform = `scaleX(${xpFrac})`;
    this.xpText.textContent =
      u.level >= MAX_LEVEL ? 'max level' : `XP ${Math.floor(u.xp)} / ${xpForNext(u.level)}`;

    this.statusRow.textContent = '';
    for (const s of u.statuses) {
      if (s.until <= this.world.time) continue;
      const chip = document.createElement('span');
      chip.className = 'hud-chip';
      chip.textContent = statusLabel(s, this.world.time);
      this.statusRow.appendChild(chip);
    }

    const def = u.championId ? this.world.championDef(u.championId) : null;
    for (const key of KEYS) {
      const slot = this.slots.get(key);
      if (!slot) continue;
      const rank = effectiveRank(u, key);
      const maxRank = key === 'R' ? ULT_MAX_RANK : BASIC_MAX_RANK;
      const remaining = (u.cooldowns[key] ?? 0) - this.world.time;
      if (rank <= 0) {
        slot.cd.style.display = 'flex';
        slot.cd.textContent = `Lv${ULT_RANK_LEVELS[0]}`;
      } else if (remaining > 0) {
        slot.cd.style.display = 'flex';
        slot.cd.textContent = remaining >= 1 ? String(Math.ceil(remaining)) : remaining.toFixed(1);
      } else {
        slot.cd.style.display = 'none';
      }
      // Rank pips and the skill-point "+" button.
      if (slot.pips.childElementCount !== maxRank) {
        slot.pips.textContent = '';
        for (let i = 0; i < maxRank; i++) {
          const pip = document.createElement('div');
          pip.className = 'hud-slot-pip';
          slot.pips.appendChild(pip);
        }
      }
      for (let i = 0; i < slot.pips.childElementCount; i++) {
        (slot.pips.children[i] as HTMLElement).classList.toggle('on', i < rank);
      }
      const canRank =
        u.skillPoints > 0 &&
        (key === 'R'
          ? rank < ULT_MAX_RANK && u.level >= (ULT_RANK_LEVELS[rank] ?? Number.POSITIVE_INFINITY)
          : rank < BASIC_MAX_RANK);
      slot.up.style.display = canRank ? 'block' : 'none';
      const cost = def ? def.abilities[key].manaCost : 0;
      slot.root.classList.toggle('nomana', u.mana < cost);
    }

    for (let i = 0; i < this.sigilSlots.length; i++) {
      const slot = this.sigilSlots[i]!;
      const sigil = u.sigils[i] ? SIGILS[u.sigils[i]!] : undefined;
      slot.label.textContent = sigil ? sigil.name : '';
      const remaining = (u.sigilCooldowns[i] ?? 0) - this.world.time;
      if (remaining > 0) {
        slot.cd.style.display = 'flex';
        slot.cd.textContent = String(Math.ceil(remaining));
      } else {
        slot.cd.style.display = 'none';
      }
    }

    for (let i = 0; i < this.invSlots.length; i++) {
      const itemId = u.items[i];
      const slot = this.invSlots[i]!;
      const def = itemId ? ITEMS[itemId] : undefined;
      if (def) {
        slot.textContent = '';
        slot.style.backgroundImage = `url(${itemIconUrl(def)})`;
        slot.style.backgroundSize = 'cover';
      } else {
        slot.textContent = itemId ? itemInitials(itemId) : '';
        slot.style.backgroundImage = '';
      }
    }

    if (this.shop.classList.contains('open')) {
      const shopOk = this.atFountain();
      this.shopStatus.textContent = shopOk
        ? 'Click an item to inspect it; Buy or double-click to purchase.'
        : 'Browse anywhere; buying needs your fountain.';
      this.shopGoldText.textContent = `${Math.floor(u.gold)}g`;
      for (const item of ITEM_LIST) {
        const btn = this.itemButtons.get(item.id);
        if (btn) {
          const cost = effectiveItemCost(item.id, u.items);
          btn.classList.toggle('cant', !shopOk || u.gold < cost);
          btn.classList.toggle('sel', item.id === this.shopSelected);
        }
        const badge = this.ownBadges.get(item.id);
        if (badge) {
          const owned = u.items.filter((x) => x === item.id).length;
          badge.style.display = owned > 0 ? 'block' : 'none';
          badge.textContent = `x${owned}`;
        }
      }
      // The detail pane re-renders only when something it shows changed,
      // so hover and click states are not wiped 20 times a second.
      const sig = [
        this.shopSelected ?? '',
        shopOk ? 1 : 0,
        this.shopSelected ? effectiveItemCost(this.shopSelected, u.items) : 0,
        this.shopSelected && u.gold >= effectiveItemCost(this.shopSelected, u.items) ? 1 : 0,
        u.items.join(','),
      ].join('|');
      if (sig !== this.lastDetailSig) {
        this.lastDetailSig = sig;
        this.renderShopDetail(u);
      }
    }

    // The always-on personal score widget.
    const selfRow = this.world.scoreboard().find((r) => r.unitId === this.selfId);
    if (selfRow) {
      this.kdaText.textContent = `${selfRow.kills} / ${selfRow.deaths} / ${selfRow.assists}`;
      this.kdaCs.textContent = `CS ${selfRow.cs}`;
    }

    if (this.score.classList.contains('open')) {
      const rows = this.world.scoreboard();
      for (const team of [0, 1] as const) {
        const box = this.scoreTeams[team];
        box.textContent = '';
        const head = document.createElement('div');
        head.className = 'hud-score-row head';
        for (const [cls, label] of [
          ['', 'Champion'],
          ['hud-score-kda', 'K / D / A'],
          ['hud-score-cs', 'CS'],
        ] as const) {
          const cell = document.createElement('span');
          cell.className = cls;
          cell.textContent = label;
          head.appendChild(cell);
        }
        box.appendChild(head);
        for (const r of rows.filter((x) => x.team === team)) {
          const row = document.createElement('div');
          row.className = r.unitId === this.selfId ? 'hud-score-row self' : 'hud-score-row';
          const name = document.createElement('span');
          name.textContent = `${r.name} (Lv ${r.level})`;
          const kda = document.createElement('span');
          kda.className = 'hud-score-kda';
          kda.textContent = `${r.kills} / ${r.deaths} / ${r.assists}`;
          const cs = document.createElement('span');
          cs.className = 'hud-score-cs';
          cs.textContent = String(r.cs);
          row.append(name, kda, cs);
          box.appendChild(row);
        }
      }
    }

    this.deathOverlay.classList.toggle('open', u.dead);
    if (u.dead) {
      this.deathSub.textContent = `Respawn in ${Math.max(0, u.respawnAt - this.world.time).toFixed(1)}s`;
    }

    const winner = this.world.winner;
    this.endOverlay.classList.toggle('open', winner !== null);
    if (winner !== null && !this.endPlayed) {
      this.endPlayed = true;
      playSfx(winner === this.selfTeam ? 'victory' : 'defeat');
      this.endTitle.textContent = winner === this.selfTeam ? 'VICTORY' : 'DEFEAT';
      this.endTitle.style.color = winner === this.selfTeam ? '#8fd06a' : '#d06a6a';
      const total = Math.max(0, Math.floor(this.world.time));
      this.endSub.textContent = `Match time ${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
      // Final per-champion stats, built once at match end.
      const mkDiv = (className: string): HTMLElement => {
        const d = document.createElement('div');
        d.className = className;
        return d;
      };
      this.endStats.textContent = '';
      const rows = this.world.scoreboard();
      for (const t of [0, 1] as const) {
        const box = mkDiv(`hud-end-team ${t === 0 ? 'blue' : 'red'}`);
        const title = t === winner ? `Team ${t + 1} (winner)` : `Team ${t + 1}`;
        const h = document.createElement('h4');
        h.textContent = title;
        box.appendChild(h);
        for (const row of rows.filter((r) => r.team === t)) {
          const line = mkDiv('hud-end-row');
          const name = document.createElement('span');
          name.textContent = row.name;
          if (row.unitId === this.selfId) name.style.color = '#e8f5c8';
          const kda = document.createElement('span');
          kda.textContent = `Lv ${row.level} · ${row.kills}/${row.deaths}/${row.assists} · CS ${row.cs}`;
          line.append(name, kda);
          box.appendChild(line);
        }
        this.endStats.appendChild(box);
      }
    }
  }
}
