// Minimal playtest HUD: the ability bar with cooldowns and mana gating, plus
// the local champion's hp and mana. Reads the world through IWorld only. The
// full HUD (shop, scoreboard, minimap) lands in phase 8.

import type { AbilityKey } from '../sim/types';
import type { IWorld } from '../world_api';

const KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];

const CSS = `
.hud {
  position: absolute;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
  font-family: system-ui, sans-serif;
  user-select: none;
  pointer-events: none;
}
.hud-bars {
  width: 240px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.hud-bar {
  position: relative;
  height: 12px;
  border-radius: 3px;
  background: #10160c;
  overflow: hidden;
}
.hud-bar-fill {
  position: absolute;
  inset: 0;
  transform-origin: left;
}
.hud-bar-text {
  position: absolute;
  inset: 0;
  text-align: center;
  font-size: 9px;
  line-height: 12px;
  color: #fff;
  text-shadow: 0 1px 2px #000;
}
.hud-slots {
  display: flex;
  gap: 6px;
}
.hud-slot {
  position: relative;
  width: 46px;
  height: 46px;
  border-radius: 6px;
  background: #1d2a14;
  border: 1px solid #466030;
  color: #d8e6c0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 19px;
  font-weight: 700;
}
.hud-slot.nomana {
  border-color: #27436e;
  color: #6f8cb8;
}
.hud-slot-cd {
  position: absolute;
  inset: 0;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 600;
}
.hud-slot-name {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -14px;
  font-size: 8px;
  font-weight: 400;
  text-align: center;
  color: #93a87c;
  white-space: nowrap;
}
`;

export class Hud {
  private readonly world: IWorld;
  private readonly selfId: number;
  private readonly hpFill: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly manaFill: HTMLElement;
  private readonly manaText: HTMLElement;
  private readonly slots = new Map<AbilityKey, { root: HTMLElement; cd: HTMLElement }>();

  constructor(container: HTMLElement, world: IWorld, selfId: number) {
    this.world = world;
    this.selfId = selfId;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.className = 'hud';

    const bars = document.createElement('div');
    bars.className = 'hud-bars';
    const mkBar = (color: string): { bar: HTMLElement; fill: HTMLElement; text: HTMLElement } => {
      const bar = document.createElement('div');
      bar.className = 'hud-bar';
      const fill = document.createElement('div');
      fill.className = 'hud-bar-fill';
      fill.style.background = color;
      const text = document.createElement('div');
      text.className = 'hud-bar-text';
      bar.append(fill, text);
      bars.appendChild(bar);
      return { bar, fill, text };
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

    root.append(bars, slots);
    container.appendChild(root);
  }

  // Called once per sim tick.
  update(): void {
    const u = this.world.units.get(this.selfId);
    if (!u) return;
    this.hpFill.style.transform = `scaleX(${Math.max(0, u.hp / u.maxHp)})`;
    this.hpText.textContent = `${Math.ceil(u.hp)} / ${u.maxHp}`;
    this.manaFill.style.transform = `scaleX(${Math.max(0, u.mana / u.maxMana)})`;
    this.manaText.textContent = `${Math.floor(u.mana)} / ${u.maxMana}`;

    const def = u.championId ? this.world.championDef(u.championId) : null;
    for (const key of KEYS) {
      const slot = this.slots.get(key);
      if (!slot) continue;
      const remaining = (u.cooldowns[key] ?? 0) - this.world.time;
      if (remaining > 0) {
        slot.cd.style.display = 'flex';
        slot.cd.textContent = remaining >= 1 ? String(Math.ceil(remaining)) : remaining.toFixed(1);
      } else {
        slot.cd.style.display = 'none';
      }
      const cost = def ? def.abilities[key].manaCost : 0;
      slot.root.classList.toggle('nomana', u.mana < cost);
    }
  }
}
