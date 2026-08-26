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
.hud-bars { width: 240px; display: flex; flex-direction: column; gap: 3px; }
.hud-bar { position: relative; height: 12px; border-radius: 3px; background: #10160c; overflow: hidden; }
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
  position: absolute; right: 190px; top: 12px; bottom: 12px; width: 300px;
  background: rgba(14, 20, 9, 0.94); border: 1px solid #466030; border-radius: 8px;
  padding: 10px; overflow-y: auto; pointer-events: auto; display: none; z-index: 8;
}
.hud-shop.open { display: block; }
.hud-shop h3 { margin: 0 0 4px; font-size: 14px; }
.hud-shop-status { font-size: 11px; color: #93a87c; margin-bottom: 8px; }
.hud-item {
  display: flex; justify-content: space-between; gap: 8px; width: 100%;
  background: #1d2a14; border: 1px solid #3a4f28; border-radius: 5px;
  color: #d8e6c0; padding: 5px 8px; margin-bottom: 4px; cursor: pointer;
  font-size: 12px; text-align: left;
}
.hud-item:hover { border-color: #7ca050; }
.hud-item.cant { opacity: 0.45; }
.hud-item-stats { color: #93a87c; font-size: 10px; }
.hud-item-cost { color: #e8c56a; white-space: nowrap; }
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
  width: 440px; max-width: 92vw; background: rgba(14, 20, 9, 0.95);
  border: 1px solid #466030; border-radius: 10px; padding: 12px 16px; display: none; z-index: 9;
}
.hud-score.open { display: block; }
.hud-score h3 { margin: 0 0 8px; font-size: 14px; text-align: center; }
.hud-score-teams { display: flex; gap: 16px; }
.hud-score-team { flex: 1; }
.hud-score-team h4 { margin: 0 0 4px; font-size: 12px; }
.hud-score-team.blue h4 { color: #9dbcf5; }
.hud-score-team.red h4 { color: #f5a3a3; }
.hud-score-row { display: flex; justify-content: space-between; font-size: 12px; padding: 2px 0; }
.hud-score-row.self { color: #e8f5c8; font-weight: 700; }
.hud-score-kda { color: #93a87c; white-space: nowrap; margin-left: 8px; }
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
  private readonly shop: HTMLElement;
  private readonly shopStatus: HTMLElement;
  private readonly itemButtons = new Map<string, HTMLButtonElement>();
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
    const mkBar = (color: string): { fill: HTMLElement; text: HTMLElement } => {
      const bar = el('div', 'hud-bar');
      const fill = el('div', 'hud-bar-fill');
      fill.style.background = color;
      const text = el('div', 'hud-bar-text');
      bar.append(fill, text);
      bars.appendChild(bar);
      return { fill, text };
    };
    const hp = mkBar('#3f9b45');
    const mana = mkBar('#3763b8');
    const xp = mkBar('#8a5fc9');
    this.hpFill = hp.fill;
    this.hpText = hp.text;
    this.manaFill = mana.fill;
    this.manaText = mana.text;
    this.xpFill = xp.fill;
    this.xpText = xp.text;

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
      const slot = el('div', 'hud-slot', key);
      tintSlot(slot, key);
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
      const slot = el('div', 'hud-slot', keyLabel);
      slot.style.borderColor = '#6b5a2e';
      tintSlot(slot, keyLabel);
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

    bottom.append(this.statusRow, this.metaText, bars, slots, inv);

    const hints = el('div', 'hud-hints');
    hints.textContent =
      'Right-click: move / attack. A: attack-move. B: recall. Q W E R: abilities. ' +
      'D F: sigils. P: shop. Tab: scoreboard. Enter: chat. G: ping. Esc: menu. ' +
      'Level up: click + above an ability.';

    this.shop = el('div', 'hud-shop');
    this.shop.append(el('h3', '', 'Shop (P to close)'));
    this.shopStatus = el('div', 'hud-shop-status');
    this.shop.appendChild(this.shopStatus);
    for (const item of ITEM_LIST) {
      const btn = el('button', 'hud-item') as HTMLButtonElement;
      btn.type = 'button';
      const icon = document.createElement('img');
      icon.src = itemIconUrl(item);
      icon.width = 26;
      icon.height = 26;
      icon.style.borderRadius = '4px';
      const left = el('div', '');
      left.append(el('div', '', item.name), el('div', 'hud-item-stats', statLabel(item.stats)));
      const cost = el('div', 'hud-item-cost', `${item.cost}g`);
      btn.append(icon, left, cost);
      attachTooltip(btn, () => describeItem(item, statLabel(item.stats)));
      btn.addEventListener('click', () => this.tryBuy(item.id));
      this.shop.appendChild(btn);
      this.itemButtons.set(item.id, btn);
    }

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
      this.toast('You must be at your fountain to buy.');
      return;
    }
    const cost = effectiveItemCost(itemId, u.items);
    if (u.gold < cost) {
      this.toast(`Not enough gold: ${cost}g needed.`);
      return;
    }
    this.world.buyItem(this.selfId, itemId);
    this.update();
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
    this.metaText.textContent = `${clock} · Lv ${u.level} · ${Math.floor(u.gold)}g`;
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
        ? 'At fountain: click to buy. Components discount upgrades.'
        : 'Return to your fountain to buy.';
      for (const item of ITEM_LIST) {
        const btn = this.itemButtons.get(item.id);
        if (btn) {
          const cost = effectiveItemCost(item.id, u.items);
          btn.classList.toggle('cant', !shopOk || u.gold < cost);
        }
      }
    }

    if (this.score.classList.contains('open')) {
      const rows = this.world.scoreboard();
      for (const team of [0, 1] as const) {
        const box = this.scoreTeams[team];
        box.textContent = '';
        for (const r of rows.filter((x) => x.team === team)) {
          const row = document.createElement('div');
          row.className = r.unitId === this.selfId ? 'hud-score-row self' : 'hud-score-row';
          const name = document.createElement('span');
          name.textContent = `${r.name} (Lv ${r.level})`;
          const kda = document.createElement('span');
          kda.className = 'hud-score-kda';
          kda.textContent = `${r.kills} / ${r.deaths}`;
          row.append(name, kda);
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
          kda.textContent = `Lv ${row.level} · ${row.kills}/${row.deaths}`;
          line.append(name, kda);
          box.appendChild(line);
        }
        this.endStats.appendChild(box);
      }
    }
  }
}
