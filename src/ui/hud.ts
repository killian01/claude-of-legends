// Minimal playtest HUD: ability bar with cooldowns and mana gating, the
// local champion's hp/mana/gold/level, the shop panel (P or B), the death
// timer, and the end screen. Reads the world through IWorld only; item data
// is data-as-code it may read directly. The full HUD (scoreboard, minimap)
// lands in phase 8.

import type { Status } from '../sim/combat/status';
import { ITEM_LIST, ITEMS, type ItemStats } from '../sim/content/items';
import { SIGILS } from '../sim/content/sigils';
import { MAX_LEVEL, xpForNext } from '../sim/stats';
import { type AbilityKey, type TeamId, ULT_LEVEL } from '../sim/types';
import type { IWorld } from '../world_api';

const TEAM_TEXT_COLORS = ['#9dbcf5', '#f5a3a3'];

function statusLabel(s: Status, time: number): string {
  const left = Math.max(0, s.until - time);
  switch (s.kind) {
    case 'stun':
      return `STUN ${left.toFixed(1)}`;
    case 'root':
      return `ROOT ${left.toFixed(1)}`;
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
  z-index: 6;
}
.hud-statuses {
  display: flex;
  gap: 4px;
  min-height: 18px;
  justify-content: center;
  flex-wrap: wrap;
}
.hud-chip {
  background: #3d3312;
  border: 1px solid #8a6d2c;
  border-radius: 4px;
  color: #f0dfae;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
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
.hud-feed {
  position: absolute; top: 12px; left: 12px; display: flex; flex-direction: column;
  gap: 4px; font-size: 12px; text-shadow: 0 1px 2px #000;
}
.hud-feed-entry {
  background: rgba(14, 20, 9, 0.8); border: 1px solid #3a4f28; border-radius: 4px;
  padding: 3px 8px;
}
.hud-score {
  position: absolute; top: 40px; left: 50%; transform: translateX(-50%);
  width: 440px; max-width: 92vw; background: rgba(14, 20, 9, 0.95);
  border: 1px solid #466030; border-radius: 10px; padding: 12px 16px; display: none;
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
  private readonly statusRow: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly manaFill: HTMLElement;
  private readonly manaText: HTMLElement;
  private readonly xpFill: HTMLElement;
  private readonly xpText: HTMLElement;
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
  private readonly feed: HTMLElement;
  private readonly score: HTMLElement;
  private readonly scoreTeams: [HTMLElement, HTMLElement];

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
    const xp = mkBar('#8a5fc9');
    this.hpFill = hp.fill;
    this.hpText = hp.text;
    this.manaFill = mana.fill;
    this.manaText = mana.text;
    this.xpFill = xp.fill;
    this.xpText = xp.text;

    this.statusRow = document.createElement('div');
    this.statusRow.className = 'hud-statuses';

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

    bottom.append(this.statusRow, this.metaText, bars, slots);

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

    this.feed = document.createElement('div');
    this.feed.className = 'hud-feed';

    this.score = document.createElement('div');
    this.score.className = 'hud-score';
    const scoreTitle = document.createElement('h3');
    scoreTitle.textContent = 'Scoreboard (Tab)';
    const teamsWrap = document.createElement('div');
    teamsWrap.className = 'hud-score-teams';
    const mkTeam = (cls: string, label: string): HTMLElement => {
      const box = document.createElement('div');
      box.className = `hud-score-team ${cls}`;
      const h = document.createElement('h4');
      h.textContent = label;
      box.appendChild(h);
      const rows = document.createElement('div');
      box.appendChild(rows);
      teamsWrap.appendChild(box);
      return rows;
    };
    this.scoreTeams = [mkTeam('blue', 'Team 1'), mkTeam('red', 'Team 2')];
    this.score.append(scoreTitle, teamsWrap);

    root.append(bottom, this.shop, this.deathOverlay, this.endOverlay, this.feed, this.score);
    container.appendChild(root);
  }

  toggleScoreboard(): void {
    this.score.classList.toggle('open');
    this.update();
  }

  // One feed line per champion death, team-colored; entries fade on their
  // own. Non-champion killers are attributed by kind (tower, minions).
  pushKills(kills: readonly { unitId: number; killerId: number }[]): void {
    if (kills.length === 0) return;
    const rows = this.world.scoreboard();
    const rowOf = (id: number) => rows.find((r) => r.unitId === id);
    for (const k of kills) {
      const victimRow = rowOf(k.unitId);
      if (!victimRow) continue;
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
    if (winner !== null) {
      this.endTitle.textContent = winner === this.selfTeam ? 'VICTORY' : 'DEFEAT';
      this.endTitle.style.color = winner === this.selfTeam ? '#8fd06a' : '#d06a6a';
    }
  }
}
