// Minimal playtest HUD: ability bar with cooldowns and mana gating, the
// local champion's hp/mana/gold/level, the shop panel (P or B), the death
// timer, and the end screen. Reads the world through IWorld only; item data
// is data-as-code it may read directly. The full HUD (scoreboard, minimap)
// lands in phase 8.

import { ITEM_LIST, ITEMS, type ItemStats } from '../sim/content/items';
import { SIGILS } from '../sim/content/sigils';
import { type AbilityKey, type TeamId, ULT_LEVEL } from '../sim/types';
import type { IWorld } from '../world_api';

const KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];

const CSS = `
.hud, .hud * { box-sizing: border-box; }
.hud {
  position: absolute;
  inset: 0;
  font-family: system-ui, sans-serif;
  user-select: none;
  pointer-events: none;
  color: #d8e6c0;
}
.hud-bottom {
  position: absolute;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
}
.hud-meta {
  font-size: 12px;
  text-shadow: 0 1px 2px #000;
}
.hud-bars { width: 240px; display: flex; flex-direction: column; gap: 3px; }
.hud-bar { position: relative; height: 12px; border-radius: 3px; background: #10160c; overflow: hidden; }
.hud-bar-fill { position: absolute; inset: 0; transform-origin: left; }
.hud-bar-text { position: absolute; inset: 0; text-align: center; font-size: 9px; line-height: 12px; color: #fff; text-shadow: 0 1px 2px #000; }
.hud-slots { display: flex; gap: 6px; }
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
  position: absolute; left: 0; right: 0; bottom: -14px;
  font-size: 8px; font-weight: 400; text-align: center; color: #93a87c; white-space: nowrap;
}
.hud-shop {
  position: absolute; right: 12px; top: 12px; bottom: 12px; width: 300px;
  background: rgba(14, 20, 9, 0.94); border: 1px solid #466030; border-radius: 8px;
  padding: 10px; overflow-y: auto; pointer-events: auto; display: none;
}
.hud-shop.open { display: block; }
.hud-shop h3 { margin: 0 0 4px; font-size: 14px; }
.hud-shop-status { font-size: 11px; color: #93a87c; margin-bottom: 8px; }
.hud-shop-inv { font-size: 11px; color: #c9d8ae; margin-bottom: 8px; min-height: 14px; }
.hud-item {
  display: flex; justify-content: space-between; gap: 8px; width: 100%;
  background: #1d2a14; border: 1px solid #3a4f28; border-radius: 5px;
  color: #d8e6c0; padding: 5px 8px; margin-bottom: 4px; cursor: pointer;
  font-size: 12px; text-align: left;
}
.hud-item:hover { border-color: #7ca050; }
.hud-item.cant { opacity: 0.45; cursor: default; }
.hud-item-stats { color: #93a87c; font-size: 10px; }
.hud-item-cost { color: #e8c56a; white-space: nowrap; }
.hud-overlay {
  position: absolute; inset: 0; display: none;
  align-items: center; justify-content: center; flex-direction: column;
  background: rgba(0, 0, 0, 0.45); text-shadow: 0 2px 8px #000;
}
.hud-overlay.open { display: flex; }
.hud-overlay-title { font-size: 52px; font-weight: 800; letter-spacing: 2px; }
.hud-overlay-sub { font-size: 16px; margin-top: 6px; }
`;

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

export class Hud {
  private readonly world: IWorld;
  private readonly selfId: number;
  private readonly selfTeam: TeamId;
  private readonly metaText: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly manaFill: HTMLElement;
  private readonly manaText: HTMLElement;
  private readonly slots = new Map<AbilityKey, { root: HTMLElement; cd: HTMLElement }>();
  private readonly sigilSlots: { root: HTMLElement; cd: HTMLElement; label: HTMLElement }[] = [];
  private readonly shop: HTMLElement;
  private readonly shopStatus: HTMLElement;
  private readonly shopInv: HTMLElement;
  private readonly itemButtons = new Map<string, HTMLButtonElement>();
  private readonly deathOverlay: HTMLElement;
  private readonly deathSub: HTMLElement;
  private readonly endOverlay: HTMLElement;
  private readonly endTitle: HTMLElement;

  constructor(container: HTMLElement, world: IWorld, selfId: number, selfTeam: TeamId) {
    this.world = world;
    this.selfId = selfId;
    this.selfTeam = selfTeam;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.className = 'hud';

    const bottom = document.createElement('div');
    bottom.className = 'hud-bottom';

    this.metaText = document.createElement('div');
    this.metaText.className = 'hud-meta';

    const bars = document.createElement('div');
    bars.className = 'hud-bars';
    const mkBar = (color: string): { fill: HTMLElement; text: HTMLElement } => {
      const bar = document.createElement('div');
      bar.className = 'hud-bar';
      const fill = document.createElement('div');
      fill.className = 'hud-bar-fill';
      fill.style.background = color;
      const text = document.createElement('div');
      text.className = 'hud-bar-text';
      bar.append(fill, text);
      bars.appendChild(bar);
      return { fill, text };
    };
    const hp = mkBar('#3f9b45');
    const mana = mkBar('#3763b8');
    this.hpFill = hp.fill;
    this.hpText = hp.text;
    this.manaFill = mana.fill;
    this.manaText = mana.text;

    const slots = document.createElement('div');
    slots.className = 'hud-slots';
    const self = world.units.get(selfId);
    const def = self?.championId ? world.championDef(self.championId) : null;
    for (const key of KEYS) {
      const slot = document.createElement('div');
      slot.className = 'hud-slot';
      slot.textContent = key;
      const cd = document.createElement('div');
      cd.className = 'hud-slot-cd';
      cd.style.display = 'none';
      slot.appendChild(cd);
      if (def) {
        const name = document.createElement('div');
        name.className = 'hud-slot-name';
        name.textContent = def.abilities[key].name;
        slot.appendChild(name);
      }
      slots.appendChild(slot);
      this.slots.set(key, { root: slot, cd });
    }
    for (const keyLabel of ['D', 'F']) {
      const slot = document.createElement('div');
      slot.className = 'hud-slot';
      slot.style.borderColor = '#6b5a2e';
      slot.textContent = keyLabel;
      const cd = document.createElement('div');
      cd.className = 'hud-slot-cd';
      cd.style.display = 'none';
      slot.appendChild(cd);
      const label = document.createElement('div');
      label.className = 'hud-slot-name';
      slot.appendChild(label);
      slots.appendChild(slot);
      this.sigilSlots.push({ root: slot, cd, label });
    }

    bottom.append(this.metaText, bars, slots);

    this.shop = document.createElement('div');
    this.shop.className = 'hud-shop';
    const title = document.createElement('h3');
    title.textContent = 'Shop (P to close)';
    this.shopStatus = document.createElement('div');
    this.shopStatus.className = 'hud-shop-status';
    this.shopInv = document.createElement('div');
    this.shopInv.className = 'hud-shop-inv';
    this.shop.append(title, this.shopStatus, this.shopInv);
    for (const item of ITEM_LIST) {
      const btn = document.createElement('button');
      btn.className = 'hud-item';
      btn.type = 'button';
      const left = document.createElement('div');
      const name = document.createElement('div');
      name.textContent = item.name;
      const stats = document.createElement('div');
      stats.className = 'hud-item-stats';
      stats.textContent =
        statLabel(item.stats) +
        (item.buildsFrom
          ? ` (${item.buildsFrom.map((c) => ITEMS[c]?.name ?? c).join(' + ')})`
          : '');
      left.append(name, stats);
      const cost = document.createElement('div');
      cost.className = 'hud-item-cost';
      cost.textContent = `${item.cost}g`;
      btn.append(left, cost);
      btn.addEventListener('click', () => {
        this.world.buyItem(this.selfId, item.id);
        this.update();
      });
      this.shop.appendChild(btn);
      this.itemButtons.set(item.id, btn);
    }

    this.deathOverlay = document.createElement('div');
    this.deathOverlay.className = 'hud-overlay';
    const deathTitle = document.createElement('div');
    deathTitle.className = 'hud-overlay-title';
    deathTitle.textContent = 'SLAIN';
    this.deathSub = document.createElement('div');
    this.deathSub.className = 'hud-overlay-sub';
    this.deathOverlay.append(deathTitle, this.deathSub);

    this.endOverlay = document.createElement('div');
    this.endOverlay.className = 'hud-overlay';
    this.endTitle = document.createElement('div');
    this.endTitle.className = 'hud-overlay-title';
    this.endOverlay.append(this.endTitle);

    root.append(bottom, this.shop, this.deathOverlay, this.endOverlay);
    container.appendChild(root);
  }

  toggleShop(): void {
    this.shop.classList.toggle('open');
    this.update();
  }

  private atFountain(): boolean {
    const u = this.world.units.get(this.selfId);
    if (!u) return false;
    const fountain = this.world.map.fountains.find((f) => f.team === u.team);
    if (!fountain) return false;
    return Math.hypot(u.pos.x - fountain.x, u.pos.z - fountain.z) <= fountain.r + 2;
  }

  // Called once per sim tick.
  update(): void {
    const u = this.world.units.get(this.selfId);
    if (!u) return;

    this.metaText.textContent = `Lv ${u.level} · ${Math.floor(u.gold)}g`;
    this.hpFill.style.transform = `scaleX(${Math.max(0, u.hp / u.maxHp)})`;
    this.hpText.textContent = `${Math.ceil(u.hp)} / ${Math.round(u.maxHp)}`;
    this.manaFill.style.transform = `scaleX(${Math.max(0, u.mana / u.maxMana)})`;
    this.manaText.textContent = `${Math.floor(u.mana)} / ${Math.round(u.maxMana)}`;

    const def = u.championId ? this.world.championDef(u.championId) : null;
    for (const key of KEYS) {
      const slot = this.slots.get(key);
      if (!slot) continue;
      const locked = key === 'R' && u.level < ULT_LEVEL;
      const remaining = (u.cooldowns[key] ?? 0) - this.world.time;
      if (locked) {
        slot.cd.style.display = 'flex';
        slot.cd.textContent = `Lv${ULT_LEVEL}`;
      } else if (remaining > 0) {
        slot.cd.style.display = 'flex';
        slot.cd.textContent = remaining >= 1 ? String(Math.ceil(remaining)) : remaining.toFixed(1);
      } else {
        slot.cd.style.display = 'none';
      }
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

    if (this.shop.classList.contains('open')) {
      const shopOk = this.atFountain();
      this.shopStatus.textContent = shopOk
        ? 'At fountain: click to buy.'
        : 'Return to your fountain to buy.';
      this.shopInv.textContent =
        u.items.length > 0
          ? `Owned: ${u.items.map((i) => ITEMS[i]?.name ?? i).join(', ')}`
          : 'Owned: nothing yet.';
      for (const item of ITEM_LIST) {
        const btn = this.itemButtons.get(item.id);
        if (btn) btn.classList.toggle('cant', !shopOk || u.gold < item.cost);
      }
    }

    this.deathOverlay.classList.toggle('open', u.dead);
    if (u.dead) {
      this.deathSub.textContent = `Respawn in ${Math.max(0, u.respawnAt - this.world.time).toFixed(1)}s`;
    }

    const winner = this.world.winner;
    this.endOverlay.classList.toggle('open', winner !== null);
    if (winner !== null) {
      this.endTitle.textContent = winner === this.selfTeam ? 'VICTORY' : 'DEFEAT';
      this.endTitle.style.color = winner === this.selfTeam ? '#8fd06a' : '#d06a6a';
    }
  }
}
