// The in-game HUD: ability and sigil bar with cooldowns, hp/mana/xp, status
// chips, gold and clock, keybind hints, inventory, the shop (P), the
// scoreboard (Tab), kill feed, chat and pings, announcements, death and end
// screens, and the Escape menu. Reads the world through IWorld only; content
// data (items, sigils, champions) is data-as-code it may read directly.

import { announceVoice } from '../game/announcer';
import type { PostMatchAction } from '../game/flow';
import { requestGameFullscreen, toggleGameFullscreen } from '../game/fullscreen';
import { playSfx } from '../game/sfx';
import { championPortraitUrl } from '../render/portraits';
import type { Status } from '../sim/combat/status';
import { effectiveItemCost, ITEM_LIST, ITEMS } from '../sim/content/items';
import { SIGILS } from '../sim/content/sigils';
import { withinFountain } from '../sim/fountain';
import {
  BASIC_MAX_RANK,
  effectiveRank,
  MAX_LEVEL,
  ULT_MAX_RANK,
  ULT_RANK_LEVELS,
  xpForNext,
} from '../sim/stats';
import { BOON_DAMAGE_PER_STACK } from '../sim/team_buffs';
import type { AbilityKey, TeamId } from '../sim/types';
import type { IWorld } from '../world_api';
import { abilityIconUrl, passiveIconUrl, sigilIconUrl } from './ability_icons';
import {
  describeAbility,
  describeItem,
  describeSigil,
  escapeAuthored,
  statLabel,
} from './describe';
import { iconDataUrl, itemIconUrl } from './icons';
import { DISCORD } from './links';
import { MultikillLadder, type MultikillLook, multikillLook } from './multikill';
import { renderScoreboardTeam } from './scoreboard_table';
import { buildSettingsPanel } from './settings_panel';
import { TeamScore } from './team_score';
import { attachTooltip, hideTooltip, LONG_PRESS_MS } from './tooltips';

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
const TEAM_PORTRAIT_COLORS = [0x4a7dd6, 0xd65c5c];

function statusLabel(s: Status, time: number): string {
  const left = Math.max(0, s.until - time);
  switch (s.kind) {
    case 'stun':
      return `STUN ${left.toFixed(1)}`;
    case 'airborne':
      return `AIRBORNE ${left.toFixed(1)}`;
    case 'untargetable':
      return 'UNTOUCHABLE';
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
.hud-bar-shield { position: absolute; top: 0; bottom: 0; background: rgba(223, 233, 242, 0.88); }
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
/* A two-step touch cast is armed on this slot: tap the ground to fire. */
.hud-slot.armed { border-color: #5fb8e8; box-shadow: 0 0 10px rgba(95, 184, 232, 0.75); }
/* The passive: smaller and rounder than the castable keys, aligned to the
   bottom of the row, so it reads as innate rather than as a sixth button. */
.hud-slot.passive {
  width: 34px; height: 34px; border-radius: 50%; align-self: flex-end;
  border-color: #8a6d2c;
}
.hud-slot-key {
  position: absolute; right: 3px; top: 1px;
  font-size: 11px; font-weight: 800; color: #f2f6e4; text-shadow: 0 1px 3px #000;
}
.hud-slot-cd {
  position: absolute; inset: 0; border-radius: 6px; background: rgba(0,0,0,0.72);
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-size: 15px; font-weight: 600;
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
/* The shop reads as a carved war-chest lid: a bronze outer frame, a moss-dark
   field inside it, and gold reserved for what costs or grants gold. Tier is
   carried by the card frame itself so a glance sorts components from
   legendaries without reading a word. */
.hud-shop {
  position: absolute; left: 50%; top: 4vh; transform: translateX(-50%);
  width: min(1180px, calc(100vw - 220px)); min-width: 700px; max-height: 88vh;
  background:
    linear-gradient(180deg, rgba(34, 47, 22, 0.98) 0%, rgba(14, 20, 9, 0.985) 130px),
    radial-gradient(120% 80% at 50% 0%, rgba(110, 143, 74, 0.16), transparent 60%),
    rgba(11, 16, 7, 0.985);
  border: 2px solid #6e5a24; border-radius: 12px;
  box-shadow:
    0 0 0 1px rgba(184, 155, 62, 0.5),
    inset 0 0 0 1px rgba(184, 155, 62, 0.22),
    inset 0 1px 0 rgba(232, 200, 98, 0.28),
    inset 0 0 70px rgba(0, 0, 0, 0.75),
    0 22px 60px rgba(0, 0, 0, 0.72);
  display: none; flex-direction: column; pointer-events: auto; z-index: 12;
  overflow: hidden;
}
.hud-shop.open { display: flex; }
/* Corner studs, the cheapest way to make a panel read as forged metal. */
.hud-shop::before, .hud-shop::after {
  content: ''; position: absolute; top: 7px; width: 7px; height: 7px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #f0dfae, #6e5a24 80%);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
}
.hud-shop::before { left: 8px; }
.hud-shop::after { right: 8px; }
.hud-shop-head {
  flex: none; display: flex; align-items: center; gap: 16px;
  padding: 12px 22px 11px;
  background: linear-gradient(180deg, rgba(59, 78, 34, 0.55), rgba(20, 28, 12, 0));
  border-bottom: 2px solid #3a4f28;
  box-shadow: 0 1px 0 rgba(184, 155, 62, 0.35), 0 6px 16px rgba(0, 0, 0, 0.45);
}
.hud-shop-head h3 {
  margin: 0; font-size: 19px; font-weight: 800; letter-spacing: 3px;
  text-transform: uppercase; color: #f0dfae; text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
}
.hud-shop-head .hud-gold { font-size: 18px; }
.hud-shop-status { font-size: 11.5px; color: #93a87c; flex: 1; }
.hud-shop-close {
  pointer-events: auto; border: 1px solid #6e5a24; color: #e8dfb4;
  background: linear-gradient(180deg, #33401f, #1a2410);
  border-radius: 6px; font-size: 12px; font-weight: 700; padding: 6px 14px; cursor: pointer;
  letter-spacing: 0.5px;
}
.hud-shop-close:hover { border-color: #e8c862; color: #fff3cf; }
.hud-shop-body { display: flex; min-height: 0; }
.hud-shop-grid { flex: 1; overflow-y: auto; padding: 12px 18px 18px; }
/* Section headings stay pinned while the list scrolls: the grid is twice the
   pane tall, so the tier you are looking at should always name itself. */
.hud-shop-grid h4 {
  position: sticky; top: -12px; z-index: 2;
  display: flex; align-items: center; gap: 10px;
  margin: 18px -18px 10px; padding: 10px 18px 8px;
  background: linear-gradient(180deg, #131c0b 0, #131c0b 82%, rgba(19, 28, 11, 0));
  font-size: 11.5px; letter-spacing: 2px;
  color: #b6cc92; text-transform: uppercase; font-weight: 700;
}
.hud-shop-grid h4:first-child { margin-top: -10px; }
.hud-shop-grid h4::before {
  content: ''; width: 7px; height: 7px; flex: none; transform: rotate(45deg);
  background: #b89b3e; box-shadow: 0 0 6px rgba(232, 200, 98, 0.5);
}
.hud-shop-grid h4::after {
  content: ''; flex: 1; height: 1px;
  background: linear-gradient(90deg, rgba(184, 155, 62, 0.55), rgba(184, 155, 62, 0));
}
/* Scrollbars in the game's tones, both panes. Chrome ignores the
   ::-webkit-scrollbar rules on any element that also sets scrollbar-width,
   so the standard properties are kept for Firefox only. */
@supports not selector(::-webkit-scrollbar) {
  .hud-shop-grid, .hud-shop-detail { scrollbar-width: thin; scrollbar-color: #6e5a24 #10160c; }
}
.hud-shop-grid::-webkit-scrollbar, .hud-shop-detail::-webkit-scrollbar { width: 12px; }
.hud-shop-grid::-webkit-scrollbar-track, .hud-shop-detail::-webkit-scrollbar-track {
  background: #10160c; border-left: 1px solid #2c3d1e;
}
.hud-shop-grid::-webkit-scrollbar-thumb, .hud-shop-detail::-webkit-scrollbar-thumb {
  border-radius: 6px; border: 2px solid #10160c;
  background: linear-gradient(180deg, #7d6a2c, #46592c);
}
.hud-shop-grid::-webkit-scrollbar-thumb:hover, .hud-shop-detail::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, #e8c862, #6e8f4a);
}
.hud-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(146px, 1fr)); gap: 10px; }
.hud-card {
  position: relative; display: flex; flex-direction: column; align-items: center; gap: 5px;
  background: linear-gradient(180deg, #26341a, #151f0d);
  border: 1px solid #3a4f28; border-radius: 8px;
  box-shadow: inset 0 1px 0 rgba(216, 230, 192, 0.12), 0 2px 6px rgba(0, 0, 0, 0.5);
  color: #d8e6c0; padding: 10px 6px 8px; cursor: pointer; font-size: 12px; text-align: center;
  transition: transform 0.09s ease, border-color 0.12s ease, box-shadow 0.12s ease;
}
/* Tier frames: stone, silver, gold. */
.hud-card.tier1 { border-color: #4a5c34; }
.hud-card.tier2 { border-color: #5f7b8c; }
.hud-card.tier3 { border-color: #8d7530; background: linear-gradient(180deg, #33361a, #1a1c0c); }
.hud-card:hover {
  transform: translateY(-2px); border-color: #a8c078;
  box-shadow: inset 0 1px 0 rgba(216, 230, 192, 0.18), 0 6px 14px rgba(0, 0, 0, 0.6);
}
.hud-card.sel {
  border-color: #e8c862;
  box-shadow: 0 0 0 1px #e8c862, 0 0 16px rgba(232, 200, 98, 0.45), inset 0 1px 0 rgba(255, 243, 207, 0.25);
}
.hud-card.cant { opacity: 0.42; }
.hud-card img { border-radius: 5px; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.6); }
.hud-card-name { line-height: 1.25; font-weight: 600; color: #e4f0cc; }
.hud-card-cost {
  color: #ffd94a; font-weight: 800; font-size: 12.5px; letter-spacing: 0.5px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
}
.hud-card-own {
  position: absolute; top: 4px; right: 4px; background: #2f6a2a; color: #e8f5c8;
  border: 1px solid #58d84e; border-radius: 4px; font-size: 9px; font-weight: 800; padding: 0 4px;
}
.hud-card-recipe {
  display: flex; gap: 4px; justify-content: center; min-height: 22px; align-items: center;
}
.hud-card-recipe img { width: 20px; height: 20px; border-radius: 4px; opacity: 0.92; }
.hud-shop-detail {
  flex: none; width: 340px; border-left: 2px solid #3a4f28;
  background: linear-gradient(180deg, rgba(30, 41, 19, 0.75), rgba(10, 15, 6, 0.75));
  box-shadow: inset 1px 0 0 rgba(184, 155, 62, 0.28);
  padding: 16px; overflow-y: auto; font-size: 12.5px;
}
.hud-detail-head {
  display: flex; align-items: center; gap: 12px; margin-bottom: 10px;
  padding-bottom: 10px; border-bottom: 1px solid #2c3d1e;
}
.hud-detail-head img { border-radius: 7px; box-shadow: 0 3px 10px rgba(0, 0, 0, 0.7); }
.hud-detail-name { font-size: 17px; font-weight: 800; color: #f2ffd9; letter-spacing: 0.3px; }
.hud-detail-tier { font-size: 10px; color: #93a87c; letter-spacing: 1.5px; text-transform: uppercase; }
.hud-detail-stats { color: #c3dba0; margin-bottom: 12px; line-height: 1.6; }
.hud-build-label {
  font-size: 10px; color: #b6cc92; margin: 12px 0 6px;
  text-transform: uppercase; letter-spacing: 1.6px; font-weight: 700;
}
.hud-build-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.hud-build-row .op { color: #93a87c; font-weight: 700; }
.hud-build-icon { position: relative; width: 44px; height: 44px; cursor: pointer; }
.hud-build-icon img { width: 44px; height: 44px; border-radius: 5px; border: 2px solid #3a4f28; display: block; }
.hud-build-icon.owned img { border-color: #58d84e; }
.hud-build-icon .tick {
  position: absolute; right: -3px; bottom: -3px; width: 12px; height: 12px;
  border-radius: 50%; background: #2f6a2a; color: #e8f5c8; font-size: 9px;
  line-height: 12px; text-align: center; font-weight: 800;
}
.hud-detail-cost {
  margin: 14px 0 4px; padding-top: 12px; border-top: 1px solid #2c3d1e;
}
.hud-detail-cost .pay {
  color: #ffd94a; font-weight: 800; font-size: 17px; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
}
.hud-detail-cost .full { color: #93a87c; font-size: 11px; }
.hud-buy {
  pointer-events: auto; width: 100%; margin-top: 10px; padding: 11px 0; border-radius: 7px;
  border: 1px solid #b89b3e; color: #f7ecc4;
  background: linear-gradient(180deg, #6a5a20, #3a3010);
  box-shadow: inset 0 1px 0 rgba(255, 243, 207, 0.3), 0 3px 10px rgba(0, 0, 0, 0.55);
  font-size: 14px; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase;
  cursor: pointer;
}
.hud-buy:hover:not(:disabled) {
  background: linear-gradient(180deg, #8a7529, #4b3e14); border-color: #e8c862;
}
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
  position: absolute; top: 106px; left: 50%; transform: translateX(-50%);
  font-size: 26px; font-weight: 800; letter-spacing: 1px; color: #f2ffd9;
  text-shadow: 0 2px 8px #000; opacity: 0; transition: opacity 0.3s;
}
/* The multikill spotlight: bigger than an announcement because it is the
   rarest thing the game says. Scales in from just under full size, and the
   pentakill takes the room the quadrakill does not. */
.hud-spot {
  position: absolute; top: 148px; left: 50%; transform: translateX(-50%) scale(0.82);
  font-size: 54px; font-weight: 900; letter-spacing: 4px; white-space: nowrap;
  text-shadow: 0 3px 18px #000, 0 0 32px currentColor;
  opacity: 0; transition: opacity 0.22s ease-out, transform 0.22s ease-out;
}
.hud-spot.on { opacity: 1; transform: translateX(-50%) scale(1); }
.hud-spot.top { font-size: 74px; letter-spacing: 7px; }
.hud-toast {
  position: absolute; bottom: 150px; left: 50%; transform: translateX(-50%);
  background: rgba(61, 23, 16, 0.95); border: 1px solid #a05040; border-radius: 6px;
  color: #f5c9c0; font-size: 12px; padding: 6px 12px; opacity: 0; transition: opacity 0.25s;
}
/* The scoreboard answers three questions at a glance: who is behind the
   champion, how the lane is going, and what they have built. The two teams
   stack so every row is one full-width table line with room for the build. */
.hud-score {
  position: absolute; top: 36px; left: 50%; transform: translateX(-50%);
  width: min(1020px, 96vw); max-height: 86vh; overflow-y: auto;
  background:
    linear-gradient(180deg, rgba(34, 47, 22, 0.98) 0%, rgba(14, 20, 9, 0.985) 110px),
    rgba(11, 16, 7, 0.985);
  border: 2px solid #6e5a24; border-radius: 12px; padding: 0 0 16px;
  box-shadow:
    0 0 0 1px rgba(184, 155, 62, 0.5),
    inset 0 1px 0 rgba(232, 200, 98, 0.28),
    0 22px 60px rgba(0, 0, 0, 0.72);
  display: none; z-index: 9;
  scrollbar-width: thin; scrollbar-color: #6e5a24 #10160c;
}
.hud-score.open { display: block; }
.hud-score h3 {
  margin: 0 0 4px; padding: 12px 0 11px; font-size: 17px; font-weight: 800;
  letter-spacing: 3px; text-transform: uppercase; text-align: center; color: #f0dfae;
  background: linear-gradient(180deg, rgba(59, 78, 34, 0.55), rgba(20, 28, 12, 0));
  border-bottom: 2px solid #3a4f28; box-shadow: 0 1px 0 rgba(184, 155, 62, 0.35);
}
.hud-score-teams { display: flex; flex-direction: column; gap: 14px; padding: 10px 20px 0; }
.hud-score-team h4 {
  display: flex; align-items: center; gap: 10px;
  margin: 0 0 6px; font-size: 12px; letter-spacing: 2px; text-transform: uppercase;
}
.hud-score-team h4::after {
  content: ''; flex: 1; height: 1px; background: currentColor; opacity: 0.35;
}
.hud-score-team.blue h4 { color: #9dbcf5; }
.hud-score-team.red h4 { color: #f5a3a3; }
.hud-score-row {
  display: grid; grid-template-columns: 1.15fr 1fr 96px 54px 212px; gap: 10px;
  font-size: 13px; padding: 5px 8px; align-items: center; border-radius: 6px;
}
.hud-score-row + .hud-score-row { border-top: 1px solid rgba(58, 79, 40, 0.55); }
.hud-score-row.head {
  color: #93a87c; font-size: 10px; text-transform: uppercase; letter-spacing: 1.4px;
  border-top: 0; padding-bottom: 2px;
}
.hud-score-row.self {
  color: #f2ffd9; font-weight: 700;
  background: rgba(184, 155, 62, 0.12); box-shadow: inset 0 0 0 1px rgba(184, 155, 62, 0.4);
}
.hud-score-player { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hud-score-champ { color: #b6cc92; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hud-score-champ .lv { color: #93a87c; font-size: 11px; }
.hud-score-row.self .hud-score-champ { color: #e4f0cc; }
.hud-score-kda { color: #d8e6c0; white-space: nowrap; text-align: right; font-variant-numeric: tabular-nums; }
.hud-score-cs { color: #93a87c; text-align: right; font-variant-numeric: tabular-nums; }
.hud-score-row.self .hud-score-cs { color: #e8f5c8; }
.hud-score-build { display: flex; gap: 4px; justify-content: flex-end; }
.hud-score-build img {
  width: 30px; height: 30px; border-radius: 5px; border: 1px solid #4a5c34; display: block;
}
.hud-score-build .slot {
  width: 30px; height: 30px; border-radius: 5px; border: 1px dashed #2c3d1e; box-sizing: border-box;
}
/* The top of the screen, in order: team kills, then the target frame, then
   announcements. The score is the only one of the three that is always up,
   so it takes the very top and the other two moved down to clear it. */
.hud-teamscore {
  position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 12px;
  background: rgba(14, 20, 9, 0.85); border: 1px solid #3a4f28; border-radius: 6px;
  padding: 3px 14px; text-shadow: 0 1px 2px #000;
}
.hud-teamscore-n {
  font-size: 20px; font-weight: 800; min-width: 24px; text-align: center;
  font-variant-numeric: tabular-nums;
}
.hud-teamscore-n.mine { text-shadow: 0 0 10px rgba(184, 155, 62, 0.55), 0 1px 2px #000; }
.hud-teamscore-label {
  font-size: 9px; font-weight: 700; letter-spacing: 2px; color: #93a87c;
}
.hud-teamscore-clock {
  font-size: 13px; font-weight: 700; color: #d8e6c0; min-width: 42px; text-align: right;
  font-variant-numeric: tabular-nums; padding-left: 10px; border-left: 1px solid #3a4f28;
}
.hud-target {
  position: absolute; top: 46px; left: 50%; transform: translateX(-50%);
  display: none; align-items: center; gap: 9px; min-width: 200px;
  background: rgba(14, 20, 9, 0.9); border: 1px solid #466030; border-radius: 8px;
  padding: 6px 10px;
}
.hud-target.open { display: flex; }
.hud-target img { width: 38px; height: 38px; border-radius: 6px; border: 1px solid #3a4f28; }
.hud-target-body { flex: 1; }
.hud-target-name { font-size: 12px; font-weight: 700; margin-bottom: 3px; }
.hud-target-bar {
  position: relative; height: 10px; border-radius: 3px;
  background: #10160c; overflow: hidden;
}
.hud-target-bar .hud-bar-text { line-height: 10px; }
.hud-kda {
  position: absolute; top: 12px; right: 12px; text-align: right;
  background: rgba(14, 20, 9, 0.85); border: 1px solid #3a4f28; border-radius: 6px;
  padding: 5px 12px; font-size: 15px; font-weight: 800; color: #e8f5c8;
  text-shadow: 0 1px 2px #000; pointer-events: auto;
}
.hud-kda .cs { display: block; font-size: 11px; font-weight: 600; color: #93a87c; }
/* Informational wash: it must never swallow clicks meant for the shop,
   which stays usable while dead. Its own buttons opt back in. */
.hud-overlay {
  position: absolute; inset: 0; display: none; pointer-events: none;
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
/* The end card holds the scoreboard table itself, so it takes the panel's
   width and stacks the two teams the same way the Tab panel does. */
.hud-end-card {
  margin-top: 14px; padding: 14px 20px; border-radius: 10px;
  background: rgba(14, 20, 9, 0.92); border: 1px solid #466030;
  width: min(1020px, 96vw); max-height: 58vh; overflow-y: auto;
  display: flex; flex-direction: column; gap: 14px; pointer-events: auto;
  text-shadow: none;
  scrollbar-width: thin; scrollbar-color: #6e5a24 #10160c;
}
.hud-end-btns { display: flex; gap: 12px; }
/* The moment right after a match is the one moment a player is most likely
   to want the next one, so this is where the server is offered. Muted, so
   it never competes with Play again. */
.hud-end-join { pointer-events: auto; margin-top: 12px; font-size: 13px; color: #9fb089; }
.hud-end-join a { color: #cbd9b4; }
.hud-end-rating { font-size: 15px; font-weight: 700; margin-top: 4px; min-height: 18px; }
/* Compact mode (touchscreens): the desktop sizes swallow a phone screen, so
   the whole bottom block scales down, the chat goes (there is no way to type
   in a match on a phone anyway; pings still flash on the map), and the hints
   shrink and fade out once read. */
.hud.compact .hud-bottom {
  bottom: 4px; gap: 3px;
  transform: translateX(-50%) scale(0.72); transform-origin: bottom center;
}
/* Post-scale the + is finger-sized again. */
.hud.compact .hud-slot-up { width: 26px; height: 24px; top: -26px; font-size: 17px; line-height: 22px; }
.hud.compact .hud-chat { display: none; }
.hud.compact .hud-announce { font-size: 20px; top: 62px; }
.hud.compact .hud-spot { font-size: 32px; top: 96px; letter-spacing: 2px; }
.hud.compact .hud-spot.top { font-size: 44px; letter-spacing: 3px; }
.hud.compact .hud-feed { font-size: 11px; }
.hud.compact .hud-hints {
  font-size: 9px; max-width: 170px; line-height: 1.45;
  animation: hud-hints-fade 1s 25s forwards;
}
@keyframes hud-hints-fade { to { opacity: 0; visibility: hidden; } }
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
  private readonly teamScore: TeamScore;
  private readonly statusRow: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpShield: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly manaFill: HTMLElement;
  private readonly manaText: HTMLElement;
  private readonly xpFill: HTMLElement;
  private readonly xpText: HTMLElement;
  private readonly slots = new Map<
    AbilityKey,
    { root: HTMLElement; cd: HTMLElement; pips: HTMLElement; up: HTMLElement }
  >();
  private readonly sigilSlots: { root: HTMLElement; cd: HTMLElement }[] = [];
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
  // Every champion's run of kills, counted in sim seconds off the deaths
  // this client already receives (src/ui/multikill.ts).
  private readonly multikill = new MultikillLadder();
  private lastWardenUp: boolean | null = null;
  // Latest Boon expiries seen per side: a grant is "until moved forward",
  // which is how the claim announcement knows WHOSE it was.
  private lastBoonMineUntil = 0;
  private lastBoonEnemyUntil = 0;
  private deathRecap = '';
  private readonly deathOverlay: HTMLElement;
  private readonly deathSub: HTMLElement;
  private readonly endOverlay: HTMLElement;
  private readonly endTitle: HTMLElement;
  private readonly endSub: HTMLElement;
  private readonly endRating: HTMLElement;
  private readonly endStats: HTMLElement;
  private readonly escapeOverlay: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly chatLog: HTMLElement;
  private readonly chatInput: HTMLInputElement;
  private readonly announceEl: HTMLElement;
  private readonly spotEl: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly score: HTMLElement;
  private readonly scoreTeams: [HTMLElement, HTMLElement];
  private readonly kdaText: HTMLElement;
  private readonly kdaCs: HTMLElement;
  private readonly targetFrame: HTMLElement;
  private readonly targetPortrait: HTMLImageElement;
  private readonly targetName: HTMLElement;
  private readonly targetHpFill: HTMLElement;
  private readonly targetHpText: HTMLElement;
  private targetId: number | null = null;
  private targetKey = '';
  private netHooks: NetHooks = {};
  // Touch two-step casting: a finger tap on an ability or sigil slot arms
  // the cast through these callbacks (wired by boot to game/touch.ts).
  private castTaps: { ability(key: AbilityKey): void; sigil(slot: number): void } | null = null;
  private announceUntil = 0;
  private spotUntil = 0;
  private sawBattleBegin = false;
  private sawFirstBlood = false;
  // The opening buy is the easiest thing in the genre to forget, so the
  // shop is already open when the match starts. Once, and only at the top.
  private openedOpeningShop = false;
  private endPlayed = false;
  private lastTowerCount: number | null = null;
  private readonly rootEl: HTMLElement;
  private readonly styleEl: HTMLStyleElement;

  constructor(
    container: HTMLElement,
    world: IWorld,
    selfId: number,
    selfTeam: TeamId,
    // Where the end screen and the escape menu exits go: main.ts decides
    // what 'menu' and 'again' mean for the mode this match ran in.
    onExit: (action: PostMatchAction) => void,
  ) {
    this.world = world;
    this.selfId = selfId;
    this.selfTeam = selfTeam;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.styleEl = style;

    const root = document.createElement('div');
    // Compact mode on touchscreens: a phone needs the middle of the screen
    // for the game, so the fixed desktop sizes shrink (see the .compact CSS).
    const coarsePointer =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    root.className = coarsePointer ? 'hud compact' : 'hud';
    this.rootEl = root;
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
    this.teamScore = new TeamScore(TEAM_TEXT_COLORS, selfTeam);

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
    // The shield overlay continues the health fill in pale grey, exactly
    // like the world-space bars, so a shielded champion reads shielded in
    // both places at once.
    this.hpShield = el('div', 'hud-bar-shield');
    hp.bar.insertBefore(this.hpShield, hp.text);
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
    // The passive, visible in-game at last: a small round emblem ahead of
    // Q whose tooltip carries the passive's name and what it does.
    if (def) {
      const passive = el('div', 'hud-slot passive');
      passive.style.backgroundImage = `url(${passiveIconUrl(def.id)})`;
      passive.style.backgroundSize = 'cover';
      passive.appendChild(el('span', 'hud-slot-key', 'P'));
      // Authored text (a forged passive's name and flavor) rides these
      // lines as HTML: escaped like every other authored string.
      attachTooltip(passive, () => [
        `${escapeAuthored(def.passive.name)} (passive)`,
        escapeAuthored(def.passive.description),
      ]);
      slots.appendChild(passive);
    }
    for (const key of KEYS) {
      const slot = el('div', 'hud-slot');
      if (def) {
        // A painted icon derived from the ability record itself; the hotkey
        // moves to a corner badge so the art stays readable.
        slot.style.backgroundImage = `url(${abilityIconUrl(key, def.abilities[key], def.id)})`;
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
      // Names live in the tooltip only; labels under the bar collided with
      // the inventory row below.
      if (def) attachTooltip(slot, () => describeAbility(key, def.abilities[key]));
      // Touch has no keyboard: a QUICK tap on the slot arms the two-step
      // cast (game/touch.ts). A press held past LONG_PRESS_MS is a read,
      // the tooltip shows while the finger rests (tooltips.ts), and must
      // not arm on release. Mouse pointers keep the hover-only slot.
      let downAt = 0;
      slot.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'touch') return;
        if (e.target === up) return;
        e.preventDefault();
        downAt = performance.now();
      });
      slot.addEventListener('pointerup', (e) => {
        if (e.pointerType !== 'touch') return;
        if (e.target === up) return;
        if (performance.now() - downAt >= LONG_PRESS_MS) return;
        this.castTaps?.ability(key);
      });
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
      attachTooltip(slot, () => {
        const u = this.world.units.get(this.selfId);
        const sigil = u?.sigils[i] ? SIGILS[u.sigils[i]!] : undefined;
        return sigil ? describeSigil(sigil) : [];
      });
      let sigilDownAt = 0;
      slot.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'touch') return;
        e.preventDefault();
        sigilDownAt = performance.now();
      });
      slot.addEventListener('pointerup', (e) => {
        if (e.pointerType !== 'touch') return;
        if (performance.now() - sigilDownAt >= LONG_PRESS_MS) return;
        this.castTaps?.sigil(i);
      });
      slots.appendChild(slot);
      this.sigilSlots.push({ root: slot, cd });
    }

    const inv = el('div', 'hud-inv');
    for (let i = 0; i < 6; i++) {
      const slot = el('div', 'hud-inv-slot');
      attachTooltip(slot, () => {
        const u = this.world.units.get(this.selfId);
        const itemId = u?.items[i];
        const itemDef = itemId ? ITEMS[itemId] : undefined;
        return itemDef
          ? [
              ...describeItem(itemDef, statLabel(itemDef.stats)),
              'Right-click to sell (70 percent back, at fountain).',
            ]
          : [];
      });
      // Right-click sells at the fountain for 70 percent of the price.
      slot.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const u = this.world.units.get(this.selfId);
        const itemId = u?.items[i];
        if (!u || itemId === undefined) return;
        if (!this.canShop()) {
          playSfx('deny');
          this.toast('You can only sell at your fountain.');
          return;
        }
        const def = ITEMS[itemId];
        if (this.world.sellItem(this.selfId, i)) {
          playSfx('buy');
          if (def) this.toast(`Sold ${def.name} for ${Math.floor(def.cost * 0.7)}g.`);
          this.update();
        }
      });
      inv.appendChild(slot);
      this.invSlots.push(slot);
    }

    bottom.append(this.statusRow, this.metaText, mainRow, slots, inv);

    const hints = el('div', 'hud-hints');
    hints.textContent = coarsePointer
      ? 'Tap: move / attack. Tap a spell, then tap the ground to cast it (tap the spell ' +
        'again to cancel). Drag pans the camera, pinch zooms, Center snaps back to your ' +
        'champion. Level up: tap the +.'
      : 'Right-click: move / attack. A: attack-move. S: stop and hold. B: recall. ' +
        'Q W E R: hold to aim, release to cast (right-click cancels). D F: sigils. P: shop. ' +
        'Tab: scoreboard. Enter: chat. G: ping. Esc: menu. Screen edges pan the camera; ' +
        'Space recenters; left-click the minimap to look. Level up: Alt+key or click +.';

    // The always-visible personal score: K / D / A plus creep
    // score, top right.
    const kda = el('div', 'hud-kda');
    this.kdaText = el('div', '', '0 / 0 / 0');
    this.kdaCs = el('span', 'cs', 'CS 0');
    kda.append(this.kdaText, this.kdaCs);
    attachTooltip(kda, () => ['Kills / Deaths / Assists', 'CS: minions last-hit.']);

    // The attacked target's frame: portrait, name, and health at
    // the top of the screen while an attack order stands.
    this.targetFrame = el('div', 'hud-target');
    this.targetPortrait = document.createElement('img');
    const targetBody = el('div', 'hud-target-body');
    this.targetName = el('div', 'hud-target-name');
    const targetBar = el('div', 'hud-target-bar');
    this.targetHpFill = el('div', 'hud-bar-fill');
    this.targetHpFill.style.background = '#e0574a';
    this.targetHpText = el('div', 'hud-bar-text');
    targetBar.append(this.targetHpFill, this.targetHpText);
    targetBody.append(this.targetName, targetBar);
    this.targetFrame.append(this.targetPortrait, targetBody);

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
      // The tier class paints the card frame: stone, silver, gold.
      const btn = el('button', `hud-card tier${item.tier}`) as HTMLButtonElement;
      btn.type = 'button';
      const own = el('span', 'hud-card-own');
      own.style.display = 'none';
      const icon = document.createElement('img');
      icon.src = itemIconUrl(item);
      icon.width = 64;
      icon.height = 64;
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
        el('div', 'hud-card-name', item.name),
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
    addSection(
      'Legendary upgrades, built from a finished item',
      ITEM_LIST.filter((i) => i.tier === 3),
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
    this.spotEl = el('div', 'hud-spot');
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
    this.endRating = el('div', 'hud-end-rating');
    this.endStats = el('div', 'hud-end-card');
    const endAgain = el('button', 'hud-menu-btn', 'Play again');
    endAgain.addEventListener('click', () => {
      // The rematch may reuse the last pick and skip the lock-in click, so
      // this click is the gesture that takes the next match fullscreen.
      requestGameFullscreen();
      onExit('again');
    });
    const endReturn = el('button', 'hud-menu-btn', 'Return to menu');
    endReturn.addEventListener('click', () => onExit('menu'));
    const endBtns = el('div', 'hud-end-btns');
    endBtns.append(endAgain, endReturn);
    const endJoin = el('div', 'hud-end-join');
    const joinLink = document.createElement('a');
    joinLink.href = DISCORD;
    joinLink.target = '_blank';
    joinLink.rel = 'noreferrer';
    joinLink.textContent = 'the Discord';
    endJoin.append('Looking for a team, or something to report? Join ', joinLink, '.');
    this.endOverlay.append(
      this.endTitle,
      this.endSub,
      this.endRating,
      this.endStats,
      endBtns,
      endJoin,
    );

    this.escapeOverlay = el('div', 'hud-overlay');
    const resume = el('button', 'hud-menu-btn', 'Resume (Esc)');
    resume.addEventListener('click', () => this.toggleEscapeMenu());
    const fullscreenBtn = el('button', 'hud-menu-btn', 'Toggle fullscreen');
    fullscreenBtn.addEventListener('click', () => toggleGameFullscreen());
    const quit = el('button', 'hud-menu-btn', 'Leave match');
    quit.addEventListener('click', () => onExit('menu'));
    this.escapeOverlay.append(
      el('div', 'hud-overlay-title', 'Paused view'),
      resume,
      buildSettingsPanel(),
      fullscreenBtn,
      quit,
    );

    root.append(
      bottom,
      hints,
      kda,
      this.teamScore.el,
      this.targetFrame,
      this.shop,
      this.feed,
      chat,
      this.announceEl,
      this.spotEl,
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

  // The server's verdict on this player's rating, shown on the end screen
  // (it arrives right after the winning snapshot). The Forge queue names
  // its own ladder so the number is never mistaken for the classic one.
  setMatchResult(
    rated: boolean,
    delta: number,
    rating: number,
    queue?: 'forge',
    way?: 'bot',
  ): void {
    if (!rated) {
      this.endRating.textContent =
        'Not rated: rating needs a public queue match with humans on both sides.';
      this.endRating.style.color = '#93a87c';
      this.endRating.style.fontSize = '12px';
      return;
    }
    const label = way === 'bot' ? 'bot rating' : queue === 'forge' ? 'Forge rating' : 'rating';
    this.endRating.textContent = `${delta >= 0 ? '+' : ''}${delta} ${label} (now ${rating})`;
    this.endRating.style.color = delta >= 0 ? '#8fd06a' : '#d06a6a';
  }

  // Same-page teardown: the HUD tree and its stylesheet go; a floating
  // tooltip attached to a removed element must not be left hanging.
  dispose(): void {
    hideTooltip();
    this.rootEl.remove();
    this.styleEl.remove();
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

  // Wires the touch two-step cast: slot taps call these (boot provides them).
  setCastTaps(taps: { ability(key: AbilityKey): void; sigil(slot: number): void }): void {
    this.castTaps = taps;
  }

  // Highlights the slot whose cast is armed; null clears every highlight.
  setArmedSlot(label: AbilityKey | 'D' | 'F' | null): void {
    for (const [key, s] of this.slots) s.root.classList.toggle('armed', key === label);
    for (const [i, s] of this.sigilSlots.entries()) {
      s.root.classList.toggle('armed', (i === 0 ? 'D' : 'F') === label);
    }
  }

  // The unit the player is attacking, mirrored into the target frame.
  setTarget(unitId: number | null): void {
    this.targetId = unitId;
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

  announce(text: string, color = '#f2ffd9'): void {
    this.announceEl.textContent = text;
    this.announceEl.style.color = color;
    this.announceEl.style.opacity = '1';
    this.announceUntil = performance.now() + 2600;
  }

  // The two top rungs of the multikill ladder get a moment of their own
  // instead of the one-line announcement every event shares: it grows into
  // place, holds longer, and the pentakill is larger than the quadrakill,
  // so the eye climbs with the voice. Re-entrant: a second call restarts
  // the entrance rather than leaving a rung frozen on screen.
  private spotlight(look: MultikillLook): void {
    this.spotEl.textContent = look.text;
    this.spotEl.style.color = look.color;
    this.spotEl.classList.toggle('top', look.intensity >= 2);
    this.spotEl.classList.remove('on');
    // Reading the layout flushes the removal, so the transition replays.
    void this.spotEl.offsetWidth;
    this.spotEl.classList.add('on');
    this.spotUntil = performance.now() + look.holdMs;
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.style.opacity = '1';
    window.setTimeout(() => {
      this.toastEl.style.opacity = '0';
    }, 1800);
  }

  // Where the shop is usable: on your fountain as the sim sees it (on the
  // Star Orchard the whole spawn terrace; src/sim/fountain.ts), or dead and
  // waiting for it (the sim waives the range check for a corpse, so death
  // is shopping time instead of dead time).
  private canShop(): boolean {
    const u = this.world.units.get(this.selfId);
    if (!u) return false;
    if (u.dead) return true;
    return withinFountain(this.world.map, u.team, u.pos);
  }

  private tryBuy(itemId: string): void {
    const u = this.world.units.get(this.selfId);
    if (!u) return;
    if (!this.canShop()) {
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
            'Finished items combine two components; owning a component discounts the upgrade. ' +
            'Attack Damage powers basic attacks and physical abilities; Ability Power boosts ' +
            'ability scaling; Armor cuts physical damage taken and Magic Resist cuts magic.',
        ),
      );
      return;
    }

    const head = mk('hud-detail-head');
    const bigIcon = document.createElement('img');
    bigIcon.src = itemIconUrl(def);
    bigIcon.width = 72;
    bigIcon.height = 72;
    const title = mk('');
    title.append(
      mk('hud-detail-name', def.name),
      mk(
        'hud-detail-tier',
        def.tier === 1 ? 'Component' : def.tier === 2 ? 'Finished item' : 'Legendary upgrade',
      ),
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

    const shopOk = this.canShop();
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
    // Who a line is about: the person when a person holds the seat, the
    // champion otherwise.
    const who = (r: { player: string | null; name: string }) => r.player ?? r.name;
    for (const k of kills) {
      const victimRow = rowOf(k.unitId);
      if (!victimRow) continue;
      if (!this.sawFirstBlood) {
        this.sawFirstBlood = true;
        this.announce('First blood');
        announceVoice('first_blood', true);
      }
      // Every champion death feeds the ladder, not only your own kills:
      // champion deaths reach both teams (server/snapshot.ts), so an
      // enemy's quadrakill is counted and called on your screen too. A
      // killer with no scoreboard row is a tower or a wave, which holds no
      // chain of its own.
      const call = this.multikill.record(
        k.unitId,
        rowOf(k.killerId) ? k.killerId : null,
        this.world.time,
      );
      const look = call ? multikillLook(call.tier) : null;
      // A rung you can hear: your own at any height, or one loud enough
      // that the whole lobby is told.
      const shout = look && (call?.killerId === this.selfId || look.everyone) ? look : null;

      if (k.unitId === this.selfId) {
        playSfx('death');
        if (!shout) announceVoice('self_slain', true, true);
        // Death recap: who did it, and who helped inside the assist window
        // (recentDamagers is live offline; online it may be empty).
        const killerRow2 = rowOf(k.killerId);
        const killerUnit2 = this.world.units.get(k.killerId);
        let recap = killerRow2
          ? `Killed by ${who(killerRow2)}`
          : killerUnit2?.kind === 'tower'
            ? 'Killed by a tower'
            : killerUnit2?.kind === 'warden'
              ? 'Killed by the Warden'
              : 'Killed by minions';
        const me = this.world.units.get(this.selfId);
        if (me) {
          const helpers = me.recentDamagers
            .filter((r) => r.id !== k.killerId && this.world.time - r.at <= 10)
            .map((r) => {
              const hit = rowOf(r.id);
              return hit ? who(hit) : undefined;
            })
            .filter((n): n is string => n !== undefined);
          if (helpers.length > 0) recap += ` (with ${helpers.join(', ')})`;
        }
        this.deathRecap = recap;
      } else if (k.killerId === this.selfId) {
        playSfx('kill');
        if (!shout) {
          // Kill confirmation, center screen in gold. The voice never names
          // the champion (playtest round 3: a roster of ten invented names
          // read aloud is noise, and the line runs long enough to still be
          // talking over the next fight). Side and outcome is all it calls;
          // the kill feed and the center text carry the name.
          this.announce(`You killed ${victimRow.name}`, '#ffd94a');
          announceVoice('self_kill', true, true);
        }
      } else if (!shout) {
        if (victimRow.team !== this.selfTeam) {
          // An enemy vanishing off the screen is ambiguous: dead, or escaped
          // into the fog? The voice settles it even when the takedown was a
          // teammate's, which is the whole point of calling it.
          announceVoice('enemy_slain', false, true);
        } else {
          announceVoice('ally_slain', false, true);
        }
      }
      // The ladder speaks last and alone: a rung REPLACES the ordinary call
      // rather than talking over it, so nobody hears half of "You have been
      // slain" cut short by a quadrakill.
      if (shout) {
        if (shout.spotlight) this.spotlight(shout);
        else this.announce(shout.text, shout.color);
        announceVoice(shout.voice, true, true, shout.intensity);
      }
      const killerRow = rowOf(k.killerId);
      let killerName = killerRow ? who(killerRow) : 'The lane';
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
      victim.textContent = who(victimRow);
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

    if (!this.openedOpeningShop) {
      this.openedOpeningShop = true;
      // Only at the top of a live match: a rejoin or a replay opens to the
      // game, not to a shop nobody asked for.
      if (this.world.time < 5 && this.world.winner === null) this.shop.classList.add('open');
    }

    if (this.spotUntil !== 0 && performance.now() > this.spotUntil) {
      this.spotUntil = 0;
      this.spotEl.classList.remove('on');
    }
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
        announceVoice('minions_spawned');
      }
    }
    const towerCount = [...this.world.units.values()].filter((x) => x.kind === 'tower').length;
    if (this.lastTowerCount !== null && towerCount < this.lastTowerCount) {
      this.announce('A tower has fallen');
      playSfx('tower');
      announceVoice('tower_fallen');
    }
    this.lastTowerCount = towerCount;

    const total = Math.max(0, Math.floor(this.world.time));
    const clock = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    // Elapsed time at the top of the screen, on the team score box.
    this.teamScore.setClock(clock);
    // The Warden clock rides the meta line; state edges drive announcements
    // (works identically offline and online, no extra wire events).
    const objAt = this.world.objectiveSpawnAt();
    const wardenUp = objAt === null;
    if (wardenUp) {
      this.metaText.textContent = `${clock} · Warden LIVE`;
    } else {
      const left = Math.max(0, Math.ceil(objAt - this.world.time));
      this.metaText.textContent = `${clock} · Warden ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    }
    const mineBoon = this.world.teamBuff(this.selfTeam);
    const enemyBoon = this.world.teamBuff((1 - this.selfTeam) as TeamId);
    if (this.lastWardenUp !== null && wardenUp !== this.lastWardenUp) {
      if (wardenUp) {
        this.announce('The Warden has awoken', '#d8a6f5');
        playSfx('tower');
        announceVoice('warden_awoken', true);
      } else if (mineBoon && mineBoon.until > this.lastBoonMineUntil) {
        // Whoever's expiry jumped forward this frame made the kill; the old
        // heuristic (mine still long-lived) misread a refreshed own Boon as
        // OUR claim when the enemy took the pit.
        this.announce("Your team claims the Warden's Boon", '#ffd94a');
        playSfx('levelup');
        announceVoice('boon_ours', true);
      } else {
        this.announce("The enemy claims the Warden's Boon", '#f5a3a3');
        playSfx('deny');
        announceVoice('boon_theirs', true);
      }
    }
    this.lastWardenUp = wardenUp;
    if (mineBoon) this.lastBoonMineUntil = Math.max(this.lastBoonMineUntil, mineBoon.until);
    if (enemyBoon) this.lastBoonEnemyUntil = Math.max(this.lastBoonEnemyUntil, enemyBoon.until);
    this.levelBadge.textContent = String(u.level);
    this.goldText.textContent = `${Math.floor(u.gold)}g`;
    if (this.lastLevel !== -1 && u.level > this.lastLevel) {
      playSfx('levelup');
      this.levelBadge.classList.remove('pop');
      void this.levelBadge.offsetWidth;
      this.levelBadge.classList.add('pop');
    }
    this.lastLevel = u.level;
    const hpFrac = Math.max(0, Math.min(1, u.hp / u.maxHp));
    this.hpFill.style.transform = `scaleX(${hpFrac})`;
    // Shields continue the fill in grey and print their total next to the
    // health, so a shielded bar never reads as plain missing health.
    const shield = u.statuses.reduce(
      (acc, s) => acc + (s.kind === 'shield' && s.until > this.world.time ? s.remaining : 0),
      0,
    );
    const shieldFrac = Math.max(0, Math.min(1, hpFrac + shield / u.maxHp) - hpFrac);
    this.hpShield.style.left = `${hpFrac * 100}%`;
    this.hpShield.style.width = `${shieldFrac * 100}%`;
    this.hpText.textContent =
      shield > 0
        ? `${Math.ceil(u.hp)} (+${Math.round(shield)}) / ${Math.round(u.maxHp)}`
        : `${Math.ceil(u.hp)} / ${Math.round(u.maxHp)}`;
    this.manaFill.style.transform = `scaleX(${Math.max(0, u.mana / u.maxMana)})`;
    this.manaText.textContent = `${Math.floor(u.mana)} / ${Math.round(u.maxMana)}`;
    const xpFrac = u.level >= MAX_LEVEL ? 1 : Math.min(1, u.xp / xpForNext(u.level));
    this.xpFill.style.transform = `scaleX(${xpFrac})`;
    this.xpText.textContent =
      u.level >= MAX_LEVEL ? 'max level' : `XP ${Math.floor(u.xp)} / ${xpForNext(u.level)}`;

    this.statusRow.textContent = '';
    // The Warden's Boon is a team buff, not a Status: its chips are built
    // here, and they SAY what the buff does. The enemy's shows too: a team
    // hitting 8 or 16 percent harder is a fact a player must see to respect.
    if (mineBoon) {
      const chip = document.createElement('span');
      chip.className = 'hud-chip';
      chip.style.borderColor = '#a06ae8';
      chip.style.color = '#e6c8ff';
      chip.style.background = '#2c1a3d';
      const pct = Math.round(BOON_DAMAGE_PER_STACK * mineBoon.stacks * 100);
      chip.textContent = `BOON +${pct}% DMG ${Math.ceil(mineBoon.until - this.world.time)}s`;
      this.statusRow.appendChild(chip);
    }
    if (enemyBoon) {
      const chip = document.createElement('span');
      chip.className = 'hud-chip';
      chip.style.borderColor = '#e86a7a';
      chip.style.color = '#ffc8ce';
      chip.style.background = '#3d1a20';
      const pct = Math.round(BOON_DAMAGE_PER_STACK * enemyBoon.stacks * 100);
      chip.textContent = `ENEMY BOON +${pct}% DMG ${Math.ceil(enemyBoon.until - this.world.time)}s`;
      this.statusRow.appendChild(chip);
    }
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
        // R waits on champion level; basics wait on a skill point.
        slot.cd.textContent =
          key === 'R' && u.level < ULT_RANK_LEVELS[0]! ? `Lv${ULT_RANK_LEVELS[0]}` : '+';
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
      const shopOk = this.canShop();
      this.shopStatus.textContent = u.dead
        ? 'Dead, so spend the wait: buying works from here.'
        : shopOk
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

    // The attacked target's frame: identity refreshed on target change,
    // health every tick; hidden when the target dies or leaves sight.
    const target = this.targetId !== null ? this.world.units.get(this.targetId) : undefined;
    const showTarget =
      target !== undefined && !target.dead && this.world.isVisible(this.selfTeam, target.id);
    this.targetFrame.classList.toggle('open', showTarget);
    if (showTarget && target) {
      const key = `${target.id}|${target.level}`;
      if (this.targetKey !== key) {
        this.targetKey = key;
        const tint = TEAM_PORTRAIT_COLORS[target.team] ?? 0xd65c5c;
        if (target.kind === 'champion' && target.championId) {
          this.targetPortrait.src = championPortraitUrl(target.championId, target.skin, tint);
          const row = this.world.scoreboard().find((r) => r.unitId === target.id);
          this.targetName.textContent = `${row?.name ?? target.championId} (Lv ${target.level})`;
        } else {
          const label =
            target.kind === 'tower'
              ? 'Tower'
              : target.kind === 'sanctum'
                ? 'Sanctum'
                : target.kind === 'warden'
                  ? 'Warden'
                  : target.kind === 'camp'
                    ? 'Jungle Beast'
                    : 'Minion';
          this.targetPortrait.src =
            target.kind === 'warden'
              ? iconDataUrl('W', '#3d2a5a', '#a06ae8')
              : iconDataUrl(label[0] ?? '?', '#5a1f1f', '#a04040');
          this.targetName.textContent = label;
        }
        this.targetName.style.color =
          target.kind === 'warden' ? '#d8a6f5' : (TEAM_TEXT_COLORS[target.team] ?? '#f5a3a3');
      }
      this.targetHpFill.style.transform = `scaleX(${Math.max(0, target.hp / target.maxHp)})`;
      this.targetHpText.textContent = `${Math.ceil(target.hp)} / ${Math.round(target.maxHp)}`;
    } else {
      this.targetKey = '';
    }

    // The always-on score widgets: the team totals at the top, the personal
    // line at the right. One scoreboard read feeds both.
    const scoreRows = this.world.scoreboard();
    this.teamScore.update(scoreRows);
    const selfRow = scoreRows.find((r) => r.unitId === this.selfId);
    if (selfRow) {
      // Defensive ?? 0: an older server may send rows without these fields.
      this.kdaText.textContent = `${selfRow.kills} / ${selfRow.deaths} / ${selfRow.assists ?? 0}`;
      this.kdaCs.textContent = `CS ${selfRow.cs ?? 0}`;
    }

    if (this.score.classList.contains('open')) {
      for (const team of [0, 1] as const) {
        renderScoreboardTeam(this.scoreTeams[team], scoreRows, team, this.selfId);
      }
    }

    this.deathOverlay.classList.toggle('open', u.dead);
    if (u.dead) {
      const respawn = `Respawn in ${Math.max(0, u.respawnAt - this.world.time).toFixed(1)}s`;
      this.deathSub.textContent = this.deathRecap ? `${this.deathRecap} · ${respawn}` : respawn;
    }

    const winner = this.world.winner;
    this.endOverlay.classList.toggle('open', winner !== null);
    if (winner !== null && !this.endPlayed) {
      this.endPlayed = true;
      playSfx(winner === this.selfTeam ? 'victory' : 'defeat');
      announceVoice(winner === this.selfTeam ? 'victory' : 'defeat', true);
      this.endTitle.textContent = winner === this.selfTeam ? 'VICTORY' : 'DEFEAT';
      this.endTitle.style.color = winner === this.selfTeam ? '#8fd06a' : '#d06a6a';
      const total = Math.max(0, Math.floor(this.world.time));
      this.endSub.textContent = `Match time ${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
      // The same scoreboard the match was played with: same columns, same
      // builds, same layout, so the summary is the table you already know
      // rather than a thinner second one.
      this.endStats.textContent = '';
      const rows = this.world.scoreboard();
      for (const t of [0, 1] as const) {
        const box = document.createElement('div');
        box.className = `hud-score-team ${t === 0 ? 'blue' : 'red'}`;
        const h = document.createElement('h4');
        h.textContent = t === winner ? `Team ${t + 1} (winner)` : `Team ${t + 1}`;
        box.appendChild(h);
        const body = document.createElement('div');
        renderScoreboardTeam(body, rows, t, this.selfId);
        box.appendChild(body);
        this.endStats.appendChild(box);
      }
    }
  }
}
