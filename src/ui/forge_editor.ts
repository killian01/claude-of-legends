// The Forge editor, phase 4's playable slice, reworked as a guided studio
// (the Tripo-style flow, in the game's theme): three tabs in creation
// order, and every generation step the player's own. Design leads with
// the splash art hero, then the model reference (the single-view image
// the 3D literally builds from) iterated the same way, then the visible
// pipeline whose 3D step is a button, not a side effect: one build that
// comes back rigged (so the weapon hangs on a hand in the workshop right
// after it lands), then the animations. Sealing is not a step of the
// pipeline at all: it lives with the champion's other actions in the
// right rail. Candidates open
// in a lightbox (view large, pick, iterate from that exact image), a
// generation in flight shows as a live skeleton card, and the Spells tab
// is a slot bar (passive plus Q W E R) with the selected spell's icon
// generation and parameters below it.

import { attackSoundOf, castSoundOf } from '../game/champion_sounds';
import { forgedClipFileUrls, registerForgedAssets } from '../game/forged_visuals';
import { playCastSfx, playSfx, preloadSfx } from '../game/sfx';
import { RANGED_THRESHOLD } from '../sim/combat/auto_attack';
import type { ChampionBaseStats, ChampionGrowth, ChampionRole } from '../sim/content/champions';
import {
  ATTACK_SOUND_GROUPS,
  type AttackSoundId,
  CAST_SOUND_GROUPS,
  type CastSoundId,
} from '../sim/content/sounds';
import { ABILITY_BOUNDS, BASE_STAT_BOUNDS, FLAVOR_MAX, GROWTH_BOUNDS } from '../sim/forge/bounds';
import { budgetOf } from '../sim/forge/budget';
import { burstCapOf, burstOf } from '../sim/forge/burst';
import type { ForgedDisplay } from '../sim/forge/display';
import { ENVELOPES, envelopeSpend } from '../sim/forge/envelopes';
import type { ForgedChampionDef } from '../sim/forge/forged_def';
import { freshDraftDef } from '../sim/forge/fresh_draft';
import { PASSIVE_TEMPLATE_LIST, PASSIVE_TEMPLATES } from '../sim/forge/passive_templates';
import { grantSpellPower, POWER_DIAL_MAX, POWER_DIAL_MIN } from '../sim/forge/spell_power';
import { FORGED_ROLES, validateForged } from '../sim/forge/validate';
import type { SpellLook } from '../sim/spell_look';
import type { AbilityKey } from '../sim/types';
import { type AnimPreview, createAnimPreview } from './anim_preview';
import { BALANCE_CSS, balanceTag, format } from './balances';
import { describeAbility } from './describe';
import { describeLook } from './describe_look';
import {
  BUDGET_VIEW_CSS,
  dialStopHint,
  dialStopLabel,
  envelopeStrip,
  kitOverview,
  type LiveView,
} from './forge_budget_view';
import { chatPanel, chatStream, commentSoFar, newChatState, type SavedChats } from './forge_chat';
import { buildCastEditor, type KitHooks, numField } from './forge_kit';
import { startMenuBackdrop } from './menu_backdrop';
import { setRichLine } from './rich_text';
import { grantStat, MELEE_REACH, RANGED_MIN } from './stat_budget';
import { type PolyAxis, statPolygon } from './stat_polygon';
import { openWorkshop } from './workshop';

// The polygon's base-stat axes, in reading order; reach joins as a tenth
// axis only while the champion is ranged, and ap (pinned at zero) and
// radius (free) stay off it.
const BASE_AXES: readonly { key: keyof ChampionBaseStats; label: string }[] = [
  { key: 'hp', label: 'HP' },
  { key: 'mana', label: 'Mana' },
  { key: 'ad', label: 'Attack' },
  { key: 'armor', label: 'Armor' },
  { key: 'mr', label: 'MR' },
  { key: 'attackSpeed', label: 'Atk speed' },
  { key: 'moveSpeed', label: 'Speed' },
  { key: 'hpRegen', label: 'HP regen' },
  { key: 'manaRegen', label: 'MP regen' },
];
const GROWTH_LABELS: Record<string, string> = {
  hp: 'HP',
  mana: 'Mana',
  ad: 'Attack',
  armor: 'Armor',
  mr: 'MR',
};

const CSS = `${BALANCE_CSS}
/* The Forge's calls to action are filled gold, which is the one ground
   the ember mark was not drawn for: its own orange on that gold is a
   smudge. So it keeps being a flame and darkens to a deep ember instead,
   with a brighter centre, which is the same fire read against a bright
   ground rather than a dark one. */
.fe-gen .bal-embers { color: #8a2f05; --bal-hot: #e07d10; }
.fe-gen:disabled .bal-embers { color: #4a2b10; --bal-hot: #8a5a1c; }
.fe, .fe * { box-sizing: border-box; }
.fe {
  position: absolute; inset: 0; z-index: 30; overflow: hidden;
  display: flex; flex-direction: column;
  background: radial-gradient(ellipse at center, #241c10 0%, #0f0a04 80%);
  font-family: system-ui, sans-serif; color: #d8cdb0; font-size: 12px;
}
.fe *::-webkit-scrollbar { width: 10px; height: 10px; }
.fe *::-webkit-scrollbar-track { background: #120d06; }
.fe *::-webkit-scrollbar-thumb { background: #4a3a1c; border-radius: 5px; }
.fe *::-webkit-scrollbar-thumb:hover { background: #a08030; }
.fe * { scrollbar-width: thin; scrollbar-color: #4a3a1c #120d06; }
.fe-head {
  position: relative; z-index: 1; display: flex; align-items: baseline; gap: 14px;
  padding: 14px 22px 10px; border-bottom: 1px solid #4a3a1c;
}
.fe-title { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: 1px; color: #e8cc74; }
.fe-sub { color: #97854f; font-size: 12px; }
.fe-embers {
  margin-left: auto; padding: 5px 12px; border-radius: 999px;
  border: 1px solid #6b5a2e; background: #241c10;
  color: #e8cc74; font-size: 13px; font-weight: 800; letter-spacing: 0.5px;
}
.fe-embers:empty { display: none; }
.fe-back {
  padding: 6px 16px; border-radius: 6px; border: 1px solid #6b5a2e;
  background: #241c10; color: #d8cdb0; font-size: 13px; font-weight: 700; cursor: pointer;
}
.fe-back:hover { border-color: #d8b45a; }
.fe-tabs {
  position: relative; z-index: 1; display: flex; gap: 8px; padding: 10px 22px 0;
}
.fe-tab {
  padding: 9px 20px; border-radius: 8px 8px 0 0; border: 1px solid #4a3a1c;
  border-bottom: none; background: #16100a; color: #97854f;
  font-size: 13px; font-weight: 700; cursor: pointer; letter-spacing: 0.3px;
}
.fe-tab:hover { color: #d8cdb0; }
.fe-tab.on { background: #2c2210; color: #e8cc74; border-color: #6b5a2e; }
.fe-body { position: relative; z-index: 1; flex: 1; display: flex; gap: 14px; padding: 12px 22px; min-height: 0; }
.fe-rail { width: 210px; flex: none; overflow-y: auto; }
.fe-main { flex: 1; min-width: 0; overflow-y: auto; padding-right: 6px; }
.fe-side { width: 270px; flex: none; overflow-y: auto; }
.fe-panel {
  background: rgba(14, 10, 4, 0.85); border: 1px solid #4a3a1c; border-radius: 10px;
  padding: 12px 14px; margin-bottom: 10px;
}
.fe-panel h3 { margin: 0 0 8px; font-size: 12px; color: #c9a84a; letter-spacing: 0.6px; text-transform: uppercase; }
.fe-lead { color: #b0a37e; font-size: 12.5px; line-height: 1.5; margin: 0 0 10px; }
.fe-draft {
  display: block; width: 100%; text-align: left; margin-bottom: 6px; padding: 7px 9px;
  border-radius: 6px; border: 1px solid #4a3a1c; background: #1a130a; color: #d8cdb0;
  font-size: 12px; cursor: pointer;
}
.fe-draft:hover { border-color: #a08030; }
.fe-draft.picked { border-color: #d8b45a; background: #2c2210; }
.fe-draft small { display: block; color: #97854f; font-size: 10px; }
.fe-btn {
  display: block; width: 100%; margin-top: 8px; padding: 9px; border-radius: 6px;
  border: 1px solid #6b5a2e; background: #241c10; color: #e0d5b8;
  font-size: 13px; font-weight: 700; cursor: pointer;
}
.fe-btn:hover:not(:disabled) { border-color: #d8b45a; }
.fe-btn:disabled { opacity: 0.4; cursor: default; }
.fe-btn.primary { background: linear-gradient(180deg, #e8cc74 0%, #c9a84a 55%, #a07830 100%); color: #241a08; border-color: #f0deae; }
.fe-btn.danger { border-color: #7a3a2e; color: #e0a898; }
.fe-input {
  width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid #4a3a1c;
  background: #120d06; color: #e0d5b8; font-size: 13px; outline: none; margin-bottom: 6px;
}
.fe-input:focus { border-color: #d8b45a; }
.fe-hero { display: flex; gap: 10px; align-items: stretch; }
.fe-hero-input {
  flex: 1; padding: 12px 14px; border-radius: 8px; border: 1px solid #6b5a2e;
  background: #120d06; color: #e0d5b8; font-size: 14px; outline: none;
}
.fe-hero-input:focus { border-color: #d8b45a; }
.fe-gen {
  flex: none; padding: 12px 22px; border-radius: 8px; border: 1px solid #f0deae;
  background: linear-gradient(180deg, #e8cc74 0%, #c9a84a 55%, #a07830 100%);
  color: #241a08; font-size: 14px; font-weight: 800; cursor: pointer; letter-spacing: 0.3px;
}
.fe-gen:hover:not(:disabled) { filter: brightness(1.08); }
.fe-gen:disabled { opacity: 0.5; cursor: default; }
.fe-gen.small { padding: 8px 14px; font-size: 12px; }
.fe-heromess { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.fe-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; align-items: center; }
.fe-chip {
  padding: 4px 11px; border-radius: 999px; border: 1px solid #4a3a1c; background: #1a130a;
  color: #b0a37e; font-size: 11px; cursor: pointer;
}
.fe-chip:hover { border-color: #a08030; color: #d8cdb0; }
.fe-refine {
  display: inline-flex; align-items: center; gap: 8px; margin-top: 8px; padding: 4px 10px 4px 4px;
  border: 1px solid #d8b45a; border-radius: 999px; background: #2c2210; color: #e8cc74;
  font-size: 11px; font-weight: 700;
}
.fe-refine img { width: 26px; height: 26px; object-fit: cover; border-radius: 999px; display: block; }
.fe-refine button {
  border: none; background: none; color: #e8cc74; font-weight: 800; cursor: pointer; font-size: 13px;
  padding: 0 2px;
}
.fe-step-text { color: #97854f; font-size: 10.5px; line-height: 1.45; }
.fe-field { display: inline-flex; align-items: center; gap: 5px; margin: 2px 8px 2px 0; }
.fe-field-label { color: #97854f; font-size: 11px; }
.fe-num { width: 74px; padding: 4px 6px; border-radius: 5px; border: 1px solid #4a3a1c; background: #120d06; color: #e0d5b8; font-size: 12px; }
.fe-select { padding: 4px 6px; border-radius: 5px; border: 1px solid #4a3a1c; background: #120d06; color: #e0d5b8; font-size: 12px; }
.fe-check input { accent-color: #c9a84a; }
.fe-fields { margin: 4px 0; }
.fe-list { border-left: 2px solid #4a3a1c; margin: 8px 0 8px 2px; padding-left: 10px; }
.fe-list-head { display: flex; align-items: center; gap: 8px; }
.fe-list-label { color: #c9a84a; font-size: 11px; font-weight: 700; }
.fe-mini {
  padding: 2px 8px; border-radius: 5px; border: 1px solid #4a3a1c; background: #1a130a;
  color: #d8cdb0; font-size: 11px; cursor: pointer;
}
.fe-mini:hover { border-color: #a08030; }
.fe-effect { margin: 6px 0; padding: 6px 8px; border: 1px solid #33270f; border-radius: 8px; background: rgba(26, 19, 10, 0.6); }
.fe-effect-head { display: flex; align-items: center; gap: 8px; }
.fe-pred { margin: 4px 0; padding-left: 6px; }
.fe-cast { margin-top: 6px; }
.fe-ability-head { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; }
.fe-key {
  width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: 6px; background: #2c2210; border: 1px solid #6b5a2e; color: #e8cc74; font-weight: 800;
}
.fe-slots { display: flex; gap: 10px; }
.fe-slot {
  width: 66px; padding: 0; border-radius: 10px; border: 2px solid #4a3a1c; background: #120d06;
  cursor: pointer; overflow: hidden;
}
.fe-slot:hover { border-color: #a08030; }
.fe-slot.on { border-color: #d8b45a; box-shadow: 0 0 8px rgba(216, 180, 90, 0.35); }
.fe-slot-img {
  width: 100%; height: 58px; display: flex; align-items: center; justify-content: center;
  color: #6b5a2e; font-weight: 800; font-size: 22px; overflow: hidden;
}
.fe-slot-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.fe-slot-key {
  font-size: 10px; color: #97854f; padding: 3px 2px 5px; font-weight: 700;
  letter-spacing: 0.4px; text-align: center; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis;
}
.fe-meter-bar { height: 14px; border-radius: 7px; background: #1a130a; border: 1px solid #4a3a1c; overflow: hidden; margin: 6px 0; }
.fe-meter-fill { height: 100%; background: linear-gradient(90deg, #7ca050, #c9a84a); transition: width 0.15s ease; }
.fe-meter-fill.over { background: linear-gradient(90deg, #c9a84a, #d06a6a); }
.fe-cost-line { display: flex; justify-content: space-between; padding: 1px 0; color: #b0a37e; }
.fe-cost-line span:last-child { color: #d8cdb0; }
.fe-errors { color: #d06a6a; font-size: 11px; margin-top: 8px; line-height: 1.5; max-height: 30vh; overflow-y: auto; }
.fe-ok { color: #8fd06a; font-weight: 700; margin-top: 8px; }
.fe-status { min-height: 16px; color: #aac2dd; margin-top: 8px; font-size: 11px; }
.fe-savestate { min-height: 14px; color: #97854f; margin-top: 4px; font-size: 11px; }
.fe-savestate.err { color: #d06a6a; }
.fe-flavor { color: #c9bfa3; font-style: italic; }
.fe-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; }
.fe-desc { color: #97854f; font-style: italic; margin-top: 4px; line-height: 1.4; }
.fe-chatlog { display: flex; flex-direction: column; gap: 6px; max-height: 240px; overflow-y: auto; margin: 4px 0 8px; }
.fe-bubble { max-width: 85%; padding: 6px 10px; border-radius: 10px; font-size: 12.5px; line-height: 1.45; white-space: pre-wrap; }
.fe-bubble.user { align-self: flex-end; background: #2c2210; border: 1px solid #6b5a2e; color: #e0d5b8; }
.fe-bubble.ai { align-self: flex-start; background: #1a130a; border: 1px solid #4a3a1c; color: #b0a37e; }
.fe-chatrow { display: flex; gap: 8px; align-items: center; }
.fe-chatrow .fe-input { margin-bottom: 0; }
.fe-prop-spell { margin: 6px 0; }
.fe-prop-spell strong { color: #d8cdb0; font-size: 12.5px; }
.fe-poly { display: block; touch-action: none; user-select: none; max-width: 100%; }
.fe-poly [data-axis] { cursor: grab; }
.fe-poly.off [data-axis] { cursor: default; }
.fe-polyrow { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; align-items: flex-start; margin: 8px 0; }
.fe-polywrap { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.fe-mini.on { border-color: #d8b45a; color: #e8cc74; background: #2c2210; }
.fe-dial { flex: 1; min-width: 120px; accent-color: #c9a84a; }
.fe-advanced { margin-top: 8px; }
.fe-advanced summary { cursor: pointer; color: #97854f; font-size: 11px; }
.fe-advanced summary:hover { color: #d8cdb0; }
.fe-strip { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.fe-cand {
  padding: 0; border: 2px solid #4a3a1c; border-radius: 8px; background: #120d06;
  cursor: zoom-in; overflow: hidden; line-height: 0; position: relative;
}
.fe-cand:hover { border-color: #a08030; }
.fe-cand.chosen { border-color: #d8b45a; box-shadow: 0 0 8px rgba(216, 180, 90, 0.45); }
.fe-cand.chosen::after {
  content: 'PICKED'; position: absolute; left: 0; right: 0; bottom: 0;
  background: rgba(216, 180, 90, 0.9); color: #241a08; font-size: 9px; font-weight: 800;
  text-align: center; padding: 2px 0; letter-spacing: 1px; line-height: 1.2;
}
.fe-cand img { display: block; object-fit: cover; }
.fe-cand.splash img { width: 104px; height: 138px; }
.fe-cand.icon img { width: 44px; height: 44px; }
.fe-skel {
  border: 2px dashed #6b5a2e; border-radius: 8px; background: #1a130a;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  color: #97854f; font-size: 10px;
}
.fe-skel.splash { width: 108px; height: 142px; }
.fe-skel.icon { width: 48px; height: 48px; }
.fe-spin {
  width: 22px; height: 22px; border-radius: 50%;
  border: 3px solid #4a3a1c; border-top-color: #e8cc74;
  animation: fe-spin 0.9s linear infinite;
}
.fe-spin.small { width: 14px; height: 14px; border-width: 2px; }
@keyframes fe-spin { to { transform: rotate(360deg); } }
.fe-stagerow { display: flex; align-items: center; gap: 8px; margin-top: 6px; color: #e8cc74; font-size: 11px; font-weight: 700; }
.fe-stock { margin-top: 8px; color: #e8cc74; font-size: 12px; font-weight: 700; }
.fe-forgebar {
  height: 6px; border-radius: 3px; margin: 10px 0 2px; background: #1a130a;
  border: 1px solid #33270f; overflow: hidden;
}
.fe-forgebar div {
  height: 100%; width: 38%; border-radius: 3px;
  background: linear-gradient(90deg, transparent, #e8cc74 35%, #ff9a3d 65%, transparent);
  animation: fe-forge 1.6s linear infinite;
}
@keyframes fe-forge { from { transform: translateX(-110%); } to { transform: translateX(380%); } }
.fe-bstages { margin-top: 10px; display: flex; flex-direction: column; gap: 7px; }
.fe-bstage { display: flex; align-items: center; gap: 10px; color: #6b5a2e; font-size: 12px; transition: color 0.3s; }
.fe-bstage .dot {
  width: 13px; height: 13px; border-radius: 50%; border: 2px solid #4a3a1c; flex: none;
  transition: background 0.3s, border-color 0.3s;
}
.fe-bstage.active { color: #e8cc74; font-weight: 700; }
.fe-bstage.active .dot { border-color: #e8cc74; animation: fe-ember 1.1s ease-in-out infinite; }
.fe-bstage.done { color: #97854f; }
.fe-bstage.done .dot { background: #c9a84a; border-color: #c9a84a; }
@keyframes fe-ember {
  0%, 100% { box-shadow: 0 0 10px rgba(255, 154, 61, 0.9); }
  50% { box-shadow: 0 0 2px rgba(255, 154, 61, 0.2); }
}
.fe-lightbox {
  position: fixed; inset: 0; z-index: 60; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 14px;
  background: rgba(5, 3, 1, 0.88);
}
.fe-lightbox img {
  max-width: 72vw; max-height: 74vh; border-radius: 10px; border: 1px solid #6b5a2e;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.7); display: block;
}
.fe-lightbox-bar { display: flex; gap: 10px; }
.fe-artrow { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.fe-mini {
  flex: none; width: auto; display: inline-block; margin: 0; padding: 4px 12px;
  border-radius: 6px; border: 1px solid #6b5a2e; background: #241c10; color: #e0d5b8;
  font-size: 11px; font-weight: 700; cursor: pointer;
}
.fe-mini:hover:not(:disabled) { border-color: #d8b45a; }
.fe-mini:disabled { opacity: 0.4; cursor: default; }
.fe-mini.gold {
  background: linear-gradient(180deg, #e8cc74 0%, #c9a84a 55%, #a07830 100%);
  color: #241a08; border-color: #f0deae;
}
.fe-anim-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
.fe-slotcol { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.fe-slot-gen { padding: 2px 10px; font-size: 10px; }
.fe-slot-img .fe-spin { width: 22px; height: 22px; }
.fe-keytabs { display: inline-flex; gap: 4px; flex: none; }
.fe-keytab { cursor: pointer; opacity: 0.5; font-size: 12px; }
.fe-keytab:hover { opacity: 1; border-color: #a08030; }
.fe-keytab.on { opacity: 1; border-color: #d8b45a; box-shadow: 0 0 6px rgba(216, 180, 90, 0.35); }
.fe-alert {
  margin: 8px 0 0; padding: 8px 12px; border-radius: 8px; border: 1px solid #b04a3a;
  background: rgba(120, 30, 20, 0.4); color: #f0c8bc; font-size: 12px; font-weight: 600;
}
.fe-iconrow {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px;
  padding-top: 8px; border-top: 1px dashed #4a3a1c;
}
.fe-iconrow > img { border-radius: 4px; border: 1px solid #4a3a1c; }
.fe-iconrow .fe-strip { margin-top: 0; }
.fe-deltas { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; justify-content: center; }
.fe-delta {
  font-size: 11px; padding: 2px 8px; border-radius: 10px; border: 1px solid #4a3a1c;
  background: #1a130a; color: #b0a37e;
}
.fe-delta.up { border-color: #7ca050; color: #a8d080; }
.fe-delta.down { border-color: #a06a4a; color: #d0a080; }
.fe-quota { color: #97854f; font-size: 11px; margin-left: auto; }
.fe-model-cta { display: flex; gap: 12px; align-items: center; }
.fe-model-cta img {
  width: 104px; height: 138px; object-fit: contain; background: #120d06;
  border-radius: 6px; border: 1px solid #4a3a1c;
}
${BUDGET_VIEW_CSS}
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

// The sound palette as grouped options (src/sim/content/sounds.ts), the
// select's first option (Auto) already in place.
function appendSoundGroups(
  select: HTMLSelectElement,
  groups: ReadonlyArray<{
    readonly group: string;
    readonly sounds: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  }>,
): void {
  for (const g of groups) {
    const og = document.createElement('optgroup');
    og.label = g.group;
    for (const s of g.sounds) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.label;
      og.append(opt);
    }
    select.append(og);
  }
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

interface DraftRow {
  id: string;
  def: ForgedChampionDef;
  status: 'draft' | 'finalized';
  updatedAt: number;
  // False when the stored definition no longer clears the validator (a
  // seal from before a rule tightening): the owner unseals and retunes.
  valid?: boolean;
  // Relative asset paths the server enriches the row with; the splash on
  // any row that has one, model, sheet, family and display once finalized.
  splash?: string | null;
  model?: string | null;
  // Whether the model carries a skeleton yet (the rig step, Step 5): what
  // the weapon hangs on in the workshop and what every clip plays.
  rigged?: boolean;
  sheet?: string | null;
  family?: string | null;
  weapon?: string | null;
  clips?: Record<string, string> | null;
  clipFiles?: Record<string, string> | null;
  display?: ForgedDisplay | null;
  // The chosen spell icon per slot, relative asset paths: the HUD of a
  // test drive wears them.
  icons?: Record<string, string> | null;
  // The editor's saved conversations (kit, stats), restored on open.
  chats?: SavedChats | null;
}

// One 2D candidate (splash, model reference, or spell icon) as the art
// routes answer it.
interface ArtCandidate {
  cid: number;
  kind: string;
  path: string;
  chosen: boolean;
  at: number;
}

// Example splash lines, clickable chips beside the prompt: full lines
// with the level of detail that actually pays off (silhouette, materials,
// mood, one accent color, a couple of memorable specifics).
const EXAMPLE_LINES = [
  'A moss-covered forest witch, ancient and calm, a crooked living-wood staff taller than ' +
    'she is, robes of layered lichen and bark, deep green glowing runes, fireflies drifting ' +
    'around her hood',
  'A brass clockwork duelist with one oversized steam-driven gauntlet, proud fencing ' +
    'stance, cracked porcelain mask, copper filigree armor with teal enamel inlays, gears ' +
    'visible at every joint',
  'A storm-called spear fighter wrapped in torn gray sails, lean and quick, braided rope ' +
    'belt hung with fishing hooks, pale lightning-blue eyes, spear tip crackling with static',
] as const;

// What one line of intent sounds like: a fantasy and a way of playing,
// not a spec. These are what the brief (Step 0) reads, so they say a
// role and a trade rather than describing a picture.
const BRIEF_EXAMPLES = [
  'A siege engineer who plants turrets and never moves twice in the same fight',
  'A blind swordsman who reads footsteps: he hits harder the longer he stands still',
  'A tide priestess who heals allies by pulling water out of her own health',
] as const;

// The brief's own line limit, mirrored from the server (forge_brief.ts)
// so the input stops where the route would refuse.
const BRIEF_LINE_MAX = 600;

// The editor's ear for calls that fail as a whole: the server not
// answering, or answering that the session is gone. The open editor sets
// it; the message goes on a banner above everything, not on the small
// status line, because a playtest met a dead session as icons that
// vanished and a Save that "did nothing", which read as lost work.
let apiTrouble: ((message: string | null) => void) | null = null;
export const API_TROUBLE = {
  session:
    'Your session has ended: reload the page and sign in again. Your drafts, icons and ' +
    'conversations are kept on the server.',
  network: 'The server did not answer. Check that it is running, then reload the page.',
} as const;

// Identity rides the session cookie (ADR 0006), never a token in the URL.
async function api<T>(url: string, body?: unknown): Promise<T | null> {
  try {
    const res = await fetch(
      url,
      body === undefined
        ? { credentials: 'same-origin' }
        : {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
    );
    apiTrouble?.(res.status === 401 ? API_TROUBLE.session : null);
    return (await res.json()) as T;
  } catch {
    apiTrouble?.(API_TROUBLE.network);
    return null;
  }
}

// A fresh draft: legal out of the box, middle of the road everywhere, so
// the first minutes are spent shaping, not fixing. The def itself is sim
// data (fresh_draft.ts); only the id is minted here.
export function newDraft(): ForgedChampionDef {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const suffix = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return freshDraftDef(`forged_${suffix}`);
}

type EditorTab = 'design' | 'spells' | 'tuning';
type SpellSlot = 'P' | AbilityKey;

export function openForgeEditor(container: HTMLElement): () => void {
  ensureCss();
  // The sound palette's Play buttons play recordings: decode them now.
  preloadSfx();
  const root = el('div', 'fe');
  const stopBackdrop = startMenuBackdrop(root);
  const close = (): void => {
    window.removeEventListener('keydown', onKey);
    stopBackdrop();
    apiTrouble = null;
    root.remove();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  window.addEventListener('keydown', onKey);

  const head = el('div', 'fe-head');
  const back = el('button', 'fe-back', 'Back');
  back.addEventListener('click', close);
  // The balance sits in the header, not in the panel that happens to
  // spend it (ADR 0017): every act on every tab costs embers, so the
  // number is on screen the whole time rather than at step four of one of
  // them, which is how a creator came to read a daily meter as a stock.
  const emberTag = el('span', 'fe-embers', '');
  const paintEmbers = (): void => {
    // The mark, not the noun (ui/balances.ts): this pill is on screen for
    // the whole session and said "embers" every second of it.
    emberTag.replaceChildren();
    if (embers >= 0) emberTag.appendChild(balanceTag('embers', embers, 13));
    emberTag.title =
      embers >= 0
        ? 'What this account holds. The grant refills weekly and unspent embers roll over.'
        : '';
  };
  head.append(
    el('h1', 'fe-title', 'The Forge'),
    el('span', 'fe-sub', 'Design the art, shape the kit, tune the numbers'),
    emberTag,
    back,
  );

  // The three tabs, in creation order.
  let tab: EditorTab = 'design';
  const tabs = el('div', 'fe-tabs');
  const tabButtons = new Map<EditorTab, HTMLButtonElement>();
  const TAB_DEFS: readonly { key: EditorTab; label: string }[] = [
    { key: 'design', label: '1. Design' },
    { key: 'spells', label: '2. Spells' },
    { key: 'tuning', label: '3. Tuning' },
  ];
  for (const { key, label } of TAB_DEFS) {
    const btn = el('button', 'fe-tab', label) as HTMLButtonElement;
    btn.addEventListener('click', () => {
      tab = key;
      for (const [k, b] of tabButtons) b.classList.toggle('on', k === tab);
      renderMain();
    });
    tabButtons.set(key, btn);
    tabs.append(btn);
  }
  tabButtons.get('design')?.classList.add('on');

  const body = el('div', 'fe-body');
  const rail = el('div', 'fe-rail');
  const main = el('div', 'fe-main');
  const side = el('div', 'fe-side');
  body.append(rail, main, side);
  // Calls that fail as a whole (server gone, session ended) say so here,
  // above the tabs' content, while the lists below keep what they showed.
  const trouble = el('div', 'fe-alert', '');
  trouble.hidden = true;
  apiTrouble = (message) => {
    trouble.textContent = message ?? '';
    trouble.hidden = message === null;
  };
  root.append(head, tabs, trouble, body);
  container.appendChild(root);

  let drafts: DraftRow[] = [];
  let current: ForgedChampionDef = newDraft();
  const status = el('div', 'fe-status', '');
  // Autosave's word: saving, saved, or why not.
  const saveState = el('div', 'fe-savestate', '');

  // --- 2D art state (plan-forge phase 4): candidates and the gen2d meter --

  let artCandidates: ArtCandidate[] = [];
  // The champion line typed per art kind, kept across rerenders.
  const artLines: Record<string, string> = {};
  // The art kind whose generation is in flight (skeleton card, disabled
  // buttons), and per-kind iteration sources picked in the lightbox.
  let generating: string | null = null;
  const refineFrom: Record<string, ArtCandidate | undefined> = {};
  // The Spells tab's selected slot.
  let spellSlot: SpellSlot = 'Q';
  // True while the model build runs; Step 4 renders the stage checklist
  // and the poll advances it through these rows when they are on screen.
  let finalizing = false;
  // True while the animate chain runs (Step 5).
  let animating = false;
  // True while a weapon-only build runs (the claim).
  let weaponForging = false;
  // The three conversations, session-lived (forge_chat.ts): the kit's and
  // the looks' on the Spells tab, the stats' on the Tuning tab.
  const kitChat = newChatState();
  const statChat = newChatState();
  const lookChat = newChatState();
  // The brief (Step 0): one line in, a whole champion out. The line the
  // creator typed, whether a call is in flight, the stage and the
  // model's comment as it streams, and the proposal awaiting Apply.
  let briefLine = '';
  let briefBusy = false;
  let briefStage = '';
  // The model's answer as it streams, and the comment read out of it
  // while the JSON is still half written.
  let briefRaw = '';
  let briefComment = '';
  // The live area of the brief panel, repainted without a rerender so
  // the creator's line keeps its focus while the answer streams.
  let briefStageEl: HTMLElement | null = null;
  let briefCommentEl: HTMLElement | null = null;
  const paintBrief = (): void => {
    if (briefStageEl?.isConnected) briefStageEl.textContent = briefStage;
    if (briefCommentEl?.isConnected) briefCommentEl.textContent = briefComment;
  };
  let briefProposal: {
    comment: string;
    name: string;
    title: string;
    tagline: string;
    role: ChampionRole;
    splash: string;
    passive: ForgedChampionDef['passive'];
    abilities: ForgedChampionDef['abilities'];
    base: ChampionBaseStats;
    growth: ChampionGrowth;
    budget: {
      kit: { spend: number; cap: number };
      stats: { spend: number; cap: number };
      growth: { spend: number; cap: number };
    };
    fit: { kit: number; stats: number; growth: number };
    held: readonly string[];
  } | null = null;
  // The latest validated kit proposal, awaiting the creator's Apply.
  let proposal: {
    passive: ForgedChampionDef['passive'];
    abilities: ForgedChampionDef['abilities'];
    budget: { total: number; cap: number };
    // The shared factor the server's fit applied to the model's amounts.
    fit: number;
    // The spells a burst cap held while the others took the room.
    held: string[];
  } | null = null;
  // The latest validated stat proposal, likewise: it lands on the
  // polygons only when applied, and stays the creator's to pull after.
  let statProposal: {
    base: ChampionBaseStats;
    growth: ChampionGrowth;
    budget: { stats: { spend: number; cap: number }; growth: { spend: number; cap: number } };
    fit: { stats: number; growth: number };
  } | null = null;
  // The latest validated set of spell looks, awaiting Apply: pure
  // presentation, so unlike the kit and the stats a seal does not close
  // it (a finalized champion may still be repainted).
  let lookProposal: Record<string, SpellLook | null> | null = null;
  let currentStage = '';
  let stageRows: Map<string, HTMLElement> | null = null;
  // The account's embers and what each act costs, from the routes that
  // spend them; -1 is "not asked yet" and shows no number rather than a
  // wrong one (ADR 0017).
  let embers = -1;
  let prices: Record<string, number> = {};
  const priceOf = (act: string): number => prices[act] ?? 0;
  // A control that costs says so on its face, before it is pressed
  // (ADR 0017): the creator should never learn a price by being refused.
  const pricedBtn = (cls: string, label: string, act: string, times = 1): HTMLButtonElement => {
    const btn = el('button', cls, label) as HTMLButtonElement;
    const n = priceOf(act) * times;
    if (n > 0) {
      btn.appendChild(document.createTextNode(' '));
      btn.appendChild(balanceTag('embers', n, 12));
    }
    return btn;
  };
  // What one build costs from here: the model and its rig always, plus
  // the weapon when a chosen weapon image is still waiting for its 3D.
  // The same reading the server's own price makes (buildEmbers), so the
  // button and the ledger cannot disagree.
  const buildPrice = (): number => {
    const row = currentRow();
    const weaponComing = !row?.weapon && chosenOf('weapon') !== undefined;
    return priceOf('model') + priceOf('rig') + (weaponComing ? priceOf('weapon') : 0);
  };

  // The balance, wherever embers are about to be spent. It is the number
  // the creator watches move, so it is repeated beside the acts that move
  // it rather than kept in one corner of one panel.
  // The stock line under the meter: the balance wears the mark, the rule
  // beside it stays a sentence, because a rule is not a price.
  const stockLine = (): HTMLElement => {
    const div = el('div', 'fe-stock', '');
    if (embers < 0) {
      div.textContent = 'The grant is weekly; unspent embers roll over.';
      return div;
    }
    div.appendChild(balanceTag('embers', embers, 12));
    div.append(
      document.createTextNode(' left. The grant refills weekly and unspent ones roll over.'),
    );
    return div;
  };

  const emberNote = (): HTMLElement => {
    const span = el('span', 'fe-quota', '');
    if (embers < 0) return span;
    span.appendChild(balanceTag('embers', embers, 12));
    span.appendChild(document.createTextNode(' left'));
    return span;
  };

  // The chains' stages in order, worded for the player; the keys are the
  // job stages the server records (generation/pipeline.ts). The build is
  // the first half only: animation is ALWAYS the last step, its own
  // click, never a side effect of the model build.
  const BUILD_STAGES: readonly { key: string; label: string }[] = [
    { key: 'reference', label: 'Sending your chosen reference' },
    { key: 'classify', label: 'Checking the image' },
    { key: 'model', label: 'Sculpting the 3D model' },
    { key: 'rig', label: 'Rigging the skeleton' },
    { key: 'weapon', label: 'Forging the weapon' },
    { key: 'download', label: 'Bringing the model home' },
  ];
  const ANIM_STAGES: readonly { key: string; label: string }[] = [
    { key: 'rig', label: 'Rigging the skeleton' },
    { key: 'animate', label: 'Applying your animations' },
    { key: 'download', label: 'Bringing the clips home' },
  ];
  const WEAPON_STAGES: readonly { key: string; label: string }[] = [
    { key: 'weapon', label: 'Forging the weapon' },
    { key: 'download', label: 'Bringing the weapon home' },
  ];
  // Whichever chain is on screen owns the checklist.
  let stageList: readonly { key: string; label: string }[] = BUILD_STAGES;
  // The style quick-pick: prefills the five selects below, nothing more.
  let animFamily = 'slashing';
  const FAMILY_CHOICES: readonly { value: string; label: string }[] = [
    { value: 'slashing', label: 'Blade strikes (sword, axe, spear)' },
    { value: 'blunt', label: 'Heavy crushing blows (maul, hammer)' },
    { value: 'bow', label: 'Bow shots' },
    { value: 'staff', label: 'Staff casting' },
    { value: 'unarmed', label: 'Bare fists' },
  ];
  // The pickable animation catalog (GET /api/forge/animations): every
  // choice per clip role, plus each style's suggested set. The player
  // picks ANIMATION BY ANIMATION; the style only prefills.
  interface AnimCatalog {
    roles: Record<string, { id: string; label: string }[]>;
    defaults: Record<string, Record<string, string>>;
  }
  let animCatalog: AnimCatalog | null = null;
  // The mannequin preview stage, created lazily on the first Step 5
  // render and reattached across renders.
  let animPreview: AnimPreview | null = null;
  // The pick per clip role, sent with the bake.
  let animPicks: Record<string, string> = {};
  // Which champion the picks were seeded for (sealed picks or defaults);
  // switching drafts reseeds.
  let animSeededFor: string | null = null;
  const ROLE_LABELS: readonly { role: string; label: string }[] = [
    { role: 'idle', label: 'Idle' },
    { role: 'run', label: 'Run' },
    { role: 'attack', label: 'Attack' },
    { role: 'cast', label: 'Cast' },
    { role: 'death', label: 'Death' },
  ];
  const applyFamilyDefaults = (): void => {
    const d = animCatalog?.defaults[animFamily];
    if (d) animPicks = { ...d };
  };
  const loadAnimations = async (): Promise<void> => {
    const r = await api<{ ok: boolean } & AnimCatalog>('/api/forge/animations');
    if (r?.ok && r.roles) {
      animCatalog = { roles: r.roles, defaults: r.defaults };
      if (Object.keys(animPicks).length === 0) applyFamilyDefaults();
    }
  };
  const applyStageState = (): void => {
    if (!stageRows) return;
    const at = stageList.findIndex((s) => s.key === currentStage);
    stageList.forEach((s, i) => {
      const row = stageRows?.get(s.key);
      if (!row) return;
      row.classList.toggle('done', at > i || currentStage === 'done');
      row.classList.toggle('active', at === i);
    });
  };
  // One ember bar plus checklist, shared by the three chains.
  const stageChecklist = (stages: readonly { key: string; label: string }[]): HTMLElement[] => {
    stageList = stages;
    const bar = el('div', 'fe-forgebar');
    bar.append(el('div', ''));
    const list = el('div', 'fe-bstages');
    stageRows = new Map();
    for (const s of stages) {
      const rowEl = el('div', 'fe-bstage');
      rowEl.append(el('span', 'dot'), el('span', '', s.label));
      stageRows.set(s.key, rowEl);
      list.append(rowEl);
    }
    applyStageState();
    return [bar, list];
  };

  const loadArt = async (): Promise<void> => {
    const r = await api<{
      ok: boolean;
      candidates?: ArtCandidate[];
      price?: number;
      embers?: number;
    }>(`/api/forge/art?id=${encodeURIComponent(current.id)}`);
    // A failed call is not an empty gallery: what is shown stays shown,
    // and the banner says why nothing fresh came.
    if (!r?.ok) return;
    artCandidates = r.candidates ?? [];
    if (typeof r.embers === 'number') embers = r.embers;
    if (typeof r.price === 'number') prices.image = r.price;
    paintEmbers();
  };

  const currentRow = (): DraftRow | undefined => drafts.find((d) => d.id === current.id);
  const isSealed = (): boolean => currentRow()?.status === 'finalized';
  const chosenOf = (kind: string): ArtCandidate | undefined =>
    artCandidates.find((c) => c.kind === kind && c.chosen);
  const assetUrl = (rel: string): string => `/api/forge/asset/${rel}`;

  // Autosave: the form as last stored, compared by value after every
  // refresh; a difference schedules a save, so nothing is lost to a
  // reload or a rebuild. Fresh and freshly loaded drafts start as saved
  // (a pristine new draft makes no row until it is touched or talked
  // to). One save in flight at a time; a change during it saves again.
  const snapshot = (): string => JSON.stringify(current);
  let lastSaved = snapshot();
  let lastSaveError: string | null = null;
  let saveTimer: number | null = null;
  let saving: Promise<boolean> | null = null;
  let saveAgain = false;
  const setSaveState = (text: string, err = false): void => {
    saveState.textContent = text;
    saveState.className = `fe-savestate${err ? ' err' : ''}`;
  };
  const saveNow = (): Promise<boolean> => {
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (isSealed()) return Promise.resolve(true);
    if (saving) {
      saveAgain = true;
      return saving;
    }
    const snap = snapshot();
    setSaveState('Saving...');
    saving = api<{ ok: boolean; error?: string }>('/api/forge/draft', { def: current }).then(
      (r) => {
        saving = null;
        if (r?.ok) {
          lastSaved = snap;
          lastSaveError = null;
          setSaveState('All changes saved');
          void loadDrafts();
        } else {
          lastSaveError = r?.error ?? 'save failed';
          setSaveState(`Not saved: ${lastSaveError}`, true);
        }
        if (saveAgain) {
          saveAgain = false;
          return saveNow();
        }
        return r?.ok === true;
      },
    );
    return saving;
  };
  const scheduleSave = (): void => {
    if (isSealed()) return;
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    setSaveState('Unsaved changes...');
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      void saveNow();
    }, 1200);
  };
  // True once the row exists and holds the form as it stands: what the
  // art flow and the conversations need before they can run.
  const ensureSaved = (): Promise<boolean> => {
    const stored = drafts.some((d) => d.id === current.id);
    if (stored && snapshot() === lastSaved && !saving) return Promise.resolve(true);
    return saveNow();
  };

  // The conversations travel with the draft (server/forge_chats.ts):
  // each accepted answer and each start-over lands the thread and its
  // latest proposal beside the def; opening a draft brings them back.
  const persistChat = (kind: 'kit' | 'stats' | 'looks'): void => {
    const state = kind === 'kit' ? kitChat : kind === 'stats' ? statChat : lookChat;
    const prop = kind === 'kit' ? proposal : kind === 'stats' ? statProposal : lookProposal;
    void ensureSaved().then((ok) => {
      if (!ok) return;
      return api<{ ok: boolean; error?: string }>('/api/forge/chat', {
        id: current.id,
        kind,
        turns: state.turns,
        proposal: prop,
      }).then((r) => {
        if (!r?.ok) status.textContent = r?.error ?? 'the conversation could not be saved';
      });
    });
  };
  const restoreChats = (row: DraftRow | undefined): void => {
    const kit = row?.chats?.kit;
    kitChat.turns = kit ? [...kit.turns] : [];
    kitChat.draft = '';
    const kp = kit?.proposal as Partial<NonNullable<typeof proposal>> | null | undefined;
    proposal =
      kp?.passive && kp.abilities
        ? {
            passive: kp.passive,
            abilities: kp.abilities,
            budget: kp.budget ?? { total: 0, cap: 0 },
            fit: kp.fit ?? 1,
            held: kp.held ?? [],
          }
        : null;
    const st = row?.chats?.stats;
    statChat.turns = st ? [...st.turns] : [];
    statChat.draft = '';
    const sp = st?.proposal as Partial<NonNullable<typeof statProposal>> | null | undefined;
    statProposal =
      sp?.base && sp.growth
        ? {
            base: sp.base,
            growth: sp.growth,
            budget: sp.budget ?? {
              stats: { spend: 0, cap: ENVELOPES.stats },
              growth: { spend: 0, cap: ENVELOPES.growth },
            },
            fit: sp.fit ?? { stats: 1, growth: 1 },
          }
        : null;
    const lk = row?.chats?.looks;
    lookChat.turns = lk ? [...lk.turns] : [];
    lookChat.draft = '';
    const lp = lk?.proposal as Record<string, SpellLook | null> | null | undefined;
    lookProposal = lp && typeof lp === 'object' ? lp : null;
  };

  // Save what is on screen (art hangs off a stored draft), generate, then
  // reload the strip. The request is held open for the image: one 2D
  // generation is seconds, not a finalize chain. While it runs the strip
  // shows a live skeleton card so nobody thinks the button was dead.
  // Several kinds in one go run one after the other (the four spell
  // icons at once), each landing on screen as it arrives; the first
  // failure stops the run and says why.
  const generateArtKinds = (jobs: readonly { kind: string; line: string }[]): void => {
    if (generating !== null || jobs.length === 0) return;
    generating = jobs[0]?.kind ?? null;
    renderMain();
    status.textContent = 'Generating the image...';
    let quotaNote = '';
    const runOne = async (job: { kind: string; line: string }): Promise<void> => {
      const from = refineFrom[job.kind];
      generating = job.kind;
      renderMain();
      const out = await api<{
        ok: boolean;
        error?: string;
        quota?: { used: number; limit: number };
      }>('/api/forge/art/generate', {
        id: current.id,
        kind: job.kind,
        line: job.line,
        ...(from ? { fromCid: from.cid } : {}),
      });
      if (!out?.ok) throw new Error(out?.error ?? 'generation failed');
      delete refineFrom[job.kind];
      quotaNote = out.quota ? ` ${out.quota.used}/${out.quota.limit} images today.` : '';
      await loadArt();
      renderMain();
    };
    // A sealed champion cannot be re-saved as a draft (ensureSaved says
    // yes at once); its one open art kind generates against the row.
    void ensureSaved()
      .then(async (saved) => {
        if (!saved) throw new Error(lastSaveError ?? 'save failed');
        for (const job of jobs) await runOne(job);
      })
      .then(() => {
        generating = null;
        status.textContent = `Generated.${quotaNote}`;
        void loadDrafts();
        renderMain();
        refresh();
      })
      .catch((err: unknown) => {
        generating = null;
        status.textContent = err instanceof Error ? err.message : 'generation failed';
        void loadArt().then(() => renderMain());
      });
  };
  const generateArtKind = (kind: string, line: string): void => generateArtKinds([{ kind, line }]);

  const pickArt = (cid: number): void => {
    void api<{ ok: boolean; error?: string }>('/api/forge/art/pick', {
      id: current.id,
      cid,
    }).then((r) => {
      if (!r?.ok) {
        status.textContent = r?.error ?? 'pick failed';
        return;
      }
      return loadArt().then(() => {
        renderMain();
        refresh();
      });
    });
  };

  // The lightbox: view a candidate large, pick it, or iterate from it.
  // Its Escape closes only itself (capture beats the editor's handler).
  const openLightbox = (c: ArtCandidate): void => {
    const sealed = isSealed();
    const overlay = el('div', 'fe-lightbox');
    const img = document.createElement('img');
    img.src = assetUrl(c.path);
    img.alt = '';
    const bar = el('div', 'fe-lightbox-bar');
    const closeBox = (): void => {
      window.removeEventListener('keydown', onBoxKey, true);
      overlay.remove();
    };
    const onBoxKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      closeBox();
    };
    window.addEventListener('keydown', onBoxKey, true);
    if (!sealed && !c.chosen) {
      const use = el('button', 'fe-gen small', 'Use this one');
      use.addEventListener('click', () => {
        closeBox();
        pickArt(c.cid);
      });
      bar.append(use);
    }
    if (!sealed) {
      const iterate = el('button', 'fe-btn', 'Iterate from this image');
      iterate.style.width = 'auto';
      iterate.style.marginTop = '0';
      iterate.title = 'The next generation starts from this exact image plus your notes';
      iterate.addEventListener('click', () => {
        refineFrom[c.kind] = c;
        closeBox();
        renderMain();
      });
      bar.append(iterate);
    }
    const done = el('button', 'fe-btn', 'Close');
    done.style.width = 'auto';
    done.style.marginTop = '0';
    done.addEventListener('click', closeBox);
    bar.append(done);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeBox();
    });
    overlay.append(img, bar);
    root.append(overlay);
  };

  // The candidate strip of one kind, plus the in-flight skeleton card.
  // Clicking a candidate opens the lightbox; the pick happens there, with
  // the image seen large first.
  const artStrip = (kind: string, big: boolean): HTMLElement => {
    const strip = el('div', 'fe-strip');
    for (const c of artCandidates.filter((x) => x.kind === kind)) {
      const btn = el('button', `fe-cand ${big ? 'splash' : 'icon'}`) as HTMLButtonElement;
      btn.classList.toggle('chosen', c.chosen);
      const img = document.createElement('img');
      img.src = assetUrl(c.path);
      img.alt = '';
      btn.appendChild(img);
      btn.title = 'View large';
      btn.addEventListener('click', () => openLightbox(c));
      strip.appendChild(btn);
    }
    if (generating === kind) {
      const skel = el('div', `fe-skel ${big ? 'splash' : 'icon'}`);
      skel.append(el('div', 'fe-spin'));
      if (big) skel.append(el('span', '', 'generating...'));
      strip.appendChild(skel);
    }
    return strip;
  };

  // The refine badge: shows which image the next generation starts from.
  const refineBadge = (kind: string): HTMLElement | null => {
    const from = refineFrom[kind];
    if (!from) return null;
    const badge = el('span', 'fe-refine');
    const img = document.createElement('img');
    img.src = assetUrl(from.path);
    img.alt = '';
    const clear = el('button', '', 'x');
    clear.title = 'Back to a fresh generation';
    clear.addEventListener('click', () => {
      delete refineFrom[kind];
      renderMain();
    });
    badge.append(img, document.createTextNode('iterating from this image'), clear);
    return badge;
  };

  // The workshop over the current champion's model; only exists finalized.
  const openWorkshopHere = (): void => {
    const row = currentRow();
    if (!row?.model) return;
    openWorkshop(container, {
      id: current.id,
      name: current.name,
      title: current.title,
      modelUrl: assetUrl(row.model),
      splashUrl: row.splash ? assetUrl(row.splash) : null,
      sheetUrl: row.sheet ? assetUrl(row.sheet) : null,
      family: row.family ?? null,
      clips: row.clips ?? null,
      clipFiles: forgedClipFileUrls(row.clipFiles),
      weaponUrl: row.weapon ? assetUrl(row.weapon) : null,
      display: row.display ?? null,
      editable: true,
      onSaved: (display) => {
        row.display = display;
        registerForgedAssets(row.id, row);
      },
    });
  };

  // --- right rail: the three envelopes, the bill, verdict, and actions ---

  const strip = envelopeStrip();
  // The kit overview at the head of the Spells tab, when that tab is up:
  // fed by the same refresh so a dial drag moves it live.
  let kitView: LiveView<ForgedChampionDef> | null = null;
  const costBox = el('div', '');
  const verdict = el('div', 'fe-errors');
  const testBtn = el('button', 'fe-btn', 'Test drive (practice)') as HTMLButtonElement;
  const saveBtn = el('button', 'fe-btn primary', 'Save now') as HTMLButtonElement;
  const finalizeBtn = el('button', 'fe-btn', 'Build the 3D') as HTMLButtonElement;
  // The seal is an act on the whole champion, not a corner of the
  // animations panel it used to sit in (playtest: the lock of a champion
  // read as a setting of its clips). It stands with the other champion
  // actions, reachable from every tab, and says in plain words what it
  // locks and what it still leaves open.
  const sealBtn = el('button', 'fe-btn', 'Seal the champion') as HTMLButtonElement;
  const sealNote = el('div', 'fe-desc', '');
  const deleteBtn = el('button', 'fe-btn danger', 'Delete draft') as HTMLButtonElement;

  // Everything the 3D build needs, mirrored client-side so the buttons
  // can say WHY they are disabled (the server gates stay authoritative).
  const forgeBlocker = (): string | null => {
    if (isSealed()) return 'already finalized';
    if (!validateForged(current).ok) return 'the kit must fully validate first';
    if (!chosenOf('splash')) return 'generate and pick a splash first';
    if (!chosenOf('sheet')) return 'generate and pick a model reference first';
    if (finalizing || animating || weaponForging) return 'another build is running';
    return null;
  };

  const refresh = (): void => {
    if (!isSealed() && snapshot() !== lastSaved) scheduleSave();
    const v = validateForged(current);
    const cost = v.cost ?? (v.ok ? v.cost : null);
    const bill = cost ?? budgetOf(current);
    strip.update(bill);
    if (kitView?.el.isConnected) kitView.update(current);
    costBox.textContent = '';
    const rows: [string, number][] = [
      ['Stats', bill.stats],
      ['Growth', bill.growth],
      ['Q', bill.abilities.Q],
      ['W', bill.abilities.W],
      ['E', bill.abilities.E],
      ['R', bill.abilities.R],
      ['Passive', bill.passive],
    ];
    for (const [label, value] of rows) {
      const line = el('div', 'fe-cost-line');
      line.append(el('span', '', label), el('span', '', String(Math.round(value))));
      costBox.append(line);
    }
    verdict.className = v.ok ? 'fe-ok' : 'fe-errors';
    verdict.textContent = v.ok
      ? 'Inside every envelope and under the burst caps: playable as is.'
      : v.errors.slice(0, 8).join('\n');
    testBtn.disabled = !v.ok;
    testBtn.title = v.ok ? '' : 'The kit must fully validate before a test drive';
    const blocker = forgeBlocker();
    finalizeBtn.disabled = blocker !== null;
    finalizeBtn.title = blocker ?? '';
    // style.display, not the hidden attribute: .fe-btn sets display and
    // author CSS beats the attribute's user-agent rule.
    workshopBtn.style.display = currentRow()?.model ? '' : 'none';
    paintSeal();
  };

  // The seal's face: what it does, or the step still missing before it
  // can. Said on the panel and not only in a hover title, because a
  // grayed button with no visible reason reads as broken (playtest).
  const paintSeal = (): void => {
    const row = currentRow();
    const sealed = isSealed();
    const busy = generating !== null || finalizing || animating || weaponForging;
    sealBtn.textContent = sealed ? 'Unseal (edit the kit again)' : 'Seal the champion';
    const missing = sealed
      ? null
      : !row?.model
        ? 'Build the 3D model first (Step 4)'
        : row.clips === null || row.clips === undefined
          ? 'Give it its animations first (Step 5)'
          : null;
    sealBtn.disabled = busy || missing !== null;
    sealBtn.title = sealed
      ? 'Returns the champion to a draft; it leaves the gallery until resealed'
      : (missing ?? 'Locks the kit, the art and the model; free, and reversible');
    sealNote.textContent = sealed
      ? 'Sealed: the kit, the art and the model are locked and the champion is in the gallery. Its animations stay yours to change.'
      : (missing ??
        'Sealing locks the kit, the art and the model (the animations stay editable) and lets the champion into the gallery. Free, and you can unseal any time.');
  };

  const hooks: KitHooks = {
    refresh,
    rebuild: () => {
      renderMain();
      refresh();
    },
  };

  saveBtn.title = 'Every change saves on its own; this saves this instant';
  saveBtn.addEventListener('click', () => {
    void saveNow().then((ok) => {
      status.textContent = ok ? 'Draft saved.' : (lastSaveError ?? 'save failed');
    });
  });
  deleteBtn.addEventListener('click', () => {
    void api<{ ok: boolean; error?: string }>('/api/forge/draft/delete', { id: current.id }).then(
      (r) => {
        status.textContent = r?.ok ? 'Draft deleted.' : (r?.error ?? 'delete failed');
        if (r?.ok) {
          current = newDraft();
          artCandidates = [];
          lastSaved = snapshot();
          setSaveState('');
          restoreChats(undefined);
          void loadDrafts();
          renderMain();
          refresh();
        }
      },
    );
  });
  // Sealing and unsealing: the same door either way, free, and never a
  // side effect of another act (playtest: animating used to seal, and a
  // creator found their champion locked without ever choosing it).
  sealBtn.addEventListener('click', () => {
    const sealing = !isSealed();
    const route = sealing ? '/api/forge/seal' : '/api/forge/unseal';
    status.textContent = sealing ? 'Sealing...' : 'Unsealing...';
    void api<{ ok: boolean; error?: string }>(route, { id: current.id }).then((r) => {
      status.textContent = r?.ok
        ? sealing
          ? 'Sealed: the kit, art and model are locked; animations stay editable.'
          : 'Unsealed: the kit is editable again; the champion leaves the gallery until resealed.'
        : (r?.error ?? 'that did not work');
      if (r?.ok) {
        void loadDrafts().then(() => {
          renderMain();
          refresh();
        });
      }
    });
  });
  testBtn.addEventListener('click', () => {
    const def = JSON.parse(JSON.stringify(current)) as ForgedChampionDef;
    // The icons as chosen on screen, picked since the rail last loaded
    // included: the test drive's HUD wears exactly what the Spells tab
    // shows.
    const icons: Record<string, string> = {};
    for (const key of ['Q', 'W', 'E', 'R']) {
      const pick = chosenOf(`icon_${key}`);
      if (pick) icons[key] = pick.path;
    }
    registerForgedAssets(current.id, { icons });
    close();
    window.dispatchEvent(new CustomEvent('loc:forge-test', { detail: def }));
  });

  // The model build, the FIRST half only: save what is on screen, then
  // start the chain and follow it. It runs on the CHOSEN model reference,
  // the exact image approved in the Design tab (ADR 0006); a failure of
  // any kind refunds every ember. Success opens the workshop on the
  // fresh static model, for the player to validate BEFORE animating.
  const runForge = (): void => {
    const blocker = forgeBlocker();
    if (blocker !== null) {
      status.textContent = blocker;
      return;
    }
    finalizing = true;
    currentStage = '';
    renderMain();
    refresh();
    status.textContent = 'Saving, then starting the 3D build...';
    const settle = (message: string): void => {
      finalizing = false;
      status.textContent = message;
      renderMain();
      refresh();
    };
    void api<{ ok: boolean; error?: string }>('/api/forge/draft', { def: current })
      .then((saved) => {
        if (!saved?.ok) throw new Error(saved?.error ?? 'save failed');
        return api<{ ok: boolean; jobId?: number; error?: string }>('/api/forge/build', {
          id: current.id,
        });
      })
      .then((started) => {
        if (!started?.ok || started.jobId === undefined) {
          settle(started?.error ?? 'the build could not start');
          return;
        }
        const poll = (): void => {
          void api<{ ok: boolean; status?: string; stage?: string; error?: string }>(
            `/api/forge/job?id=${started.jobId}`,
          ).then((job) => {
            if (!job?.ok) {
              settle('the job vanished; check your embers');
              return;
            }
            if (job.status === 'success') {
              finalizing = false;
              status.textContent =
                'Built and rigged: check it in the workshop, hang its weapon, then give it its animations (Step 5).';
              // Once the fresh rows land, the workshop opens on the new
              // static model: validating it is exactly the point.
              void loadDrafts().then(() => {
                renderMain();
                openWorkshopHere();
              });
              return;
            }
            if (job.status === 'failed') {
              settle(`The build failed (${job.error ?? 'unknown'}); your embers came back.`);
              return;
            }
            currentStage = job.stage ?? '';
            const named = stageList.find((s) => s.key === currentStage);
            status.textContent = `Building: ${named?.label.toLowerCase() ?? currentStage}...`;
            applyStageState();
            window.setTimeout(poll, 2000);
          });
        };
        poll();
      })
      .catch((err: unknown) => {
        settle(err instanceof Error ? err.message : 'the build could not start');
      });
  };
  finalizeBtn.addEventListener('click', runForge);

  // The animate step, always LAST and always the player's own click:
  // bake the picked clips onto the skeleton the build already made.
  // Priced by how many clips it bakes (plus the rig itself, for a model
  // built before the build rigged); a failure refunds every ember and
  // the bake can simply run again.
  // `picks` names only the roles this click bakes: a per-row button sends
  // its one role, the full-set button sends all five; the server keeps
  // whatever is already baked for the rest.
  const runAnimate = (picks: Record<string, string>): void => {
    if (animating || finalizing || weaponForging) return;
    animating = true;
    currentStage = 'animate';
    renderMain();
    status.textContent = 'Applying the animations...';
    const settle = (message: string): void => {
      animating = false;
      status.textContent = message;
      renderMain();
    };
    void api<{ ok: boolean; jobId?: number; error?: string }>('/api/forge/animate', {
      id: current.id,
      family: animFamily,
      ...(Object.keys(picks).length > 0 ? { clips: picks } : {}),
    }).then((started) => {
      if (!started?.ok || started.jobId === undefined) {
        settle(started?.error ?? 'the animations could not start');
        return;
      }
      const poll = (): void => {
        void api<{ ok: boolean; status?: string; stage?: string; error?: string }>(
          `/api/forge/job?id=${started.jobId}`,
        ).then((job) => {
          if (!job?.ok) {
            settle('the job vanished; reload and check your champion');
            return;
          }
          if (job.status === 'success') {
            animating = false;
            status.textContent = 'Done: the animations are on your champion.';
            // The picks now on the row are the source of truth again.
            animSeededFor = null;
            void loadDrafts().then(() => {
              renderMain();
              openWorkshopHere();
            });
            return;
          }
          if (job.status === 'failed') {
            settle(
              `The animations failed (${job.error ?? 'unknown'}); nothing was spent, try again.`,
            );
            return;
          }
          currentStage = job.stage ?? currentStage;
          const named = stageList.find((s) => s.key === currentStage);
          status.textContent = `Animating: ${named?.label.toLowerCase() ?? currentStage}...`;
          applyStageState();
          window.setTimeout(poll, 2000);
        });
      };
      poll();
    });
  };

  // The weapon-only build on a sealed champion that has none: the
  // priced on its own now; a failure refunds it, and a failure spends
  // nothing either.
  const forgeWeaponNow = (): void => {
    if (weaponForging) return;
    weaponForging = true;
    currentStage = 'weapon';
    renderMain();
    status.textContent = 'Forging the weapon...';
    void api<{ ok: boolean; jobId?: number; error?: string }>('/api/forge/weapon', {
      id: current.id,
    }).then((started) => {
      if (!started?.ok || started.jobId === undefined) {
        weaponForging = false;
        status.textContent = started?.error ?? 'the weapon build could not start';
        renderMain();
        return;
      }
      const poll = (): void => {
        void api<{ ok: boolean; status?: string; stage?: string; error?: string }>(
          `/api/forge/job?id=${started.jobId}`,
        ).then((job) => {
          if (!job?.ok) {
            weaponForging = false;
            status.textContent = 'the job vanished; reload and check your champion';
            renderMain();
            return;
          }
          if (job.status === 'success') {
            weaponForging = false;
            status.textContent = 'The weapon is forged: attach it in the workshop.';
            void loadDrafts().then(() => renderMain());
            return;
          }
          if (job.status === 'failed') {
            weaponForging = false;
            status.textContent = `The weapon build failed (${job.error ?? 'unknown'}); nothing was spent.`;
            renderMain();
            return;
          }
          currentStage = job.stage ?? currentStage;
          const named = WEAPON_STAGES.find((s) => s.key === currentStage);
          status.textContent = `Forging: ${named?.label.toLowerCase() ?? currentStage}...`;
          applyStageState();
          window.setTimeout(poll, 2000);
        });
      };
      poll();
    });
  };

  // The brief: the Forge's first door. One line goes up, a whole legal
  // champion comes back (identity, kit, body, and the line the splash
  // starts from), fitted to the envelopes and validated server-side.
  // Nothing lands on the form until the creator takes it: what comes
  // back is a proposal like the conversations', only wider.
  const runBrief = (): void => {
    if (briefBusy || isSealed()) return;
    const line = briefLine.trim();
    if (line === '') {
      status.textContent = 'Say what the champion is, in one line.';
      return;
    }
    briefBusy = true;
    briefStage = 'Sending your line...';
    briefRaw = '';
    briefComment = '';
    briefProposal = null;
    renderMain();
    void ensureSaved()
      .then((saved) => {
        if (!saved) throw new Error(lastSaveError ?? 'the draft could not be saved');
        return chatStream<{
          ok: boolean;
          error?: string;
          comment?: string;
          name?: string;
          title?: string;
          tagline?: string;
          role?: ChampionRole;
          splash?: string;
          passive?: ForgedChampionDef['passive'];
          abilities?: ForgedChampionDef['abilities'];
          base?: ChampionBaseStats;
          growth?: ChampionGrowth;
          budget?: NonNullable<typeof briefProposal>['budget'];
          fit?: NonNullable<typeof briefProposal>['fit'];
          held?: readonly string[];
        }>('/api/forge/brief', { id: current.id, line }, (out) => {
          // The stage between calls, and the comment as the model writes
          // it: a minute of silence reads as a hang (playtest).
          if (out.progress === 'stage') briefStage = out.text ?? '';
          else if (out.progress === 'text') {
            briefRaw += out.text ?? '';
            briefComment = commentSoFar(briefRaw);
          }
          paintBrief();
        });
      })
      .then((r) => {
        briefBusy = false;
        if (!r?.ok || !r.passive || !r.abilities || !r.base || !r.growth) {
          status.textContent = r?.error ?? 'the brief did not come back; try again';
          renderMain();
          return;
        }
        briefProposal = {
          comment: r.comment ?? '',
          name: r.name ?? '',
          title: r.title ?? '',
          tagline: r.tagline ?? '',
          role: r.role ?? current.role,
          splash: r.splash ?? '',
          passive: r.passive,
          abilities: r.abilities,
          base: r.base,
          growth: r.growth,
          budget: r.budget ?? {
            kit: { spend: 0, cap: 0 },
            stats: { spend: 0, cap: 0 },
            growth: { spend: 0, cap: 0 },
          },
          fit: r.fit ?? { kit: 1, stats: 1, growth: 1 },
          held: r.held ?? [],
        };
        status.textContent = 'Your champion is proposed: read it, then take it or ask again.';
        void loadDrafts().then(() => {
          renderMain();
          refresh();
        });
      })
      .catch((err: unknown) => {
        briefBusy = false;
        status.textContent = err instanceof Error ? err.message : 'the brief failed';
        renderMain();
      });
  };

  // Everything the brief proposal writes onto the form in one go:
  // identity, role, kit and body, plus the splash line Step 1 starts
  // from. The art, the model and the sounds are never touched.
  const takeBrief = (): void => {
    const p = briefProposal;
    if (!p || isSealed()) return;
    current.name = p.name || current.name;
    current.title = p.title;
    current.tagline = p.tagline;
    current.role = p.role;
    current.passive = structuredClone(p.passive);
    const kept = current.abilities;
    current.abilities = structuredClone(p.abilities);
    for (const key of ['Q', 'W', 'E', 'R'] as const) {
      const sound = kept[key]?.sound;
      if (sound !== undefined && current.abilities[key].sound === undefined) {
        current.abilities[key].sound = sound;
      }
    }
    current.base = { ...p.base };
    current.growth = { ...p.growth };
    if (p.splash.trim() !== '') artLines.splash = p.splash;
    briefProposal = null;
    status.textContent =
      'On the form. Change anything you like, then generate the splash art (Step 1).';
    renderMain();
    refresh();
  };

  // The workshop door: only a finalized champion has a model to turn.
  const workshopBtn = el('button', 'fe-btn', 'Workshop (3D view)') as HTMLButtonElement;
  workshopBtn.addEventListener('click', openWorkshopHere);

  const meterPanel = el('div', 'fe-panel');
  meterPanel.append(el('h3', '', 'Power budget'));
  meterPanel.append(strip.el, costBox, verdict);
  // Creation order: save the work, build the model, inspect it, play it,
  // then seal it. Delete stays last, away from the flow.
  const actions = el('div', 'fe-panel');
  actions.append(
    el('h3', '', 'Actions'),
    saveBtn,
    finalizeBtn,
    workshopBtn,
    testBtn,
    sealBtn,
    sealNote,
    deleteBtn,
    status,
    saveState,
  );
  side.append(meterPanel, actions);

  // --- left rail: drafts -------------------------------------------------

  const renderRail = (): void => {
    rail.textContent = '';
    const panel = el('div', 'fe-panel');
    panel.append(el('h3', '', 'Your drafts'));
    for (const row of drafts) {
      const btn = el('button', 'fe-draft');
      btn.classList.toggle('picked', row.id === current.id);
      btn.append(document.createTextNode(row.def.name));
      // The tagline or the status; never the internal id, which reads as
      // a bug to anyone who did not write the store.
      const sub = el(
        'small',
        '',
        row.status === 'finalized'
          ? row.valid === false
            ? 'finalized, needs a reforge: unseal, retune, seal again'
            : 'finalized'
          : row.def.tagline || 'draft',
      );
      if (row.status === 'finalized' && row.valid === false) sub.style.color = '#d06a6a';
      btn.append(sub);
      btn.addEventListener('click', () => {
        // Another draft's art must not linger while this one's loads;
        // the same draft keeps its icons up through a failed reload.
        if (row.id !== current.id) artCandidates = [];
        current = JSON.parse(JSON.stringify(row.def)) as ForgedChampionDef;
        lastSaved = snapshot();
        setSaveState('');
        restoreChats(row);
        renderRail();
        renderMain();
        refresh();
        void loadArt().then(() => {
          renderMain();
          refresh();
        });
      });
      panel.append(btn);
    }
    if (drafts.length === 0) panel.append(el('div', 'fe-sub', 'Nothing yet. Forge the first.'));
    const fresh = el('button', 'fe-btn', 'New draft');
    fresh.addEventListener('click', () => {
      current = newDraft();
      artCandidates = [];
      lastSaved = snapshot();
      setSaveState('');
      restoreChats(undefined);
      renderRail();
      renderMain();
      refresh();
    });
    panel.append(fresh);
    rail.append(panel);
  };

  const loadDrafts = async (): Promise<void> => {
    const r = await api<{
      ok: boolean;
      drafts?: DraftRow[];
      embers?: number;
      prices?: Record<string, number>;
    }>(`/api/forge/drafts`);
    // A failed call is not an empty rail: the rows already shown stay.
    if (!r?.ok) return;
    drafts = r.drafts ?? [];
    if (typeof r.embers === 'number') embers = r.embers;
    if (r.prices) prices = { ...prices, ...r.prices };
    // The header number moves the moment the ledger does: watching it go
    // down is half of what a single currency is for.
    paintEmbers();
    // Finalized champions announce their models to the render registry, so
    // a test drive straight from here plays the generated model.
    for (const d of drafts) registerForgedAssets(d.id, d);
    renderRail();
    // Statuses may have moved (a finalize landing): the workshop door and
    // the seal-aware panels follow the fresh rows.
    refresh();
  };

  // --- center: the tabs --------------------------------------------------

  // The flavor line's field (CONTEXT.md): the one authored text on a
  // spell or the passive, the story above the derived mechanics. Empty
  // means none; the word filter reads it at save like every card text.
  function flavorInput(
    get: () => string | undefined,
    set: (v: string | undefined) => void,
  ): HTMLInputElement {
    const input = el('input', 'fe-input fe-flavor') as HTMLInputElement;
    input.maxLength = FLAVOR_MAX;
    input.placeholder = 'One line of story (optional): the image of the spell, not its numbers';
    input.value = get() ?? '';
    input.addEventListener('input', () => {
      const v = input.value;
      set(v.trim() === '' ? undefined : v);
      refresh();
    });
    return input;
  }

  function textInput(
    placeholder: string,
    get: () => string,
    set: (v: string) => void,
    maxLength: number,
  ): HTMLInputElement {
    const input = el('input', 'fe-input') as HTMLInputElement;
    input.placeholder = placeholder;
    input.maxLength = maxLength;
    input.value = get();
    input.addEventListener('input', () => {
      set(input.value);
      refresh();
    });
    return input;
  }

  // Tab 1, Design: the step panels in creation order (splash art, model
  // reference, the weapon, the rigged 3D build, the animations), then the
  // card identity. Sealing is not among them: it is a champion action, in
  // the right rail.
  function renderDesign(): void {
    const sealed = isSealed();
    const row = currentRow();
    const busy = generating !== null;

    // Step 0, the door the Forge opens on: one line, and the whole
    // champion comes back written. A creator arriving with an idea
    // should spend their time CHANGING a champion, not authoring one
    // field at a time from a blank form; the steps below are then edits
    // on something that already exists and already plays.
    if (!sealed) {
      const brief = el('div', 'fe-panel');
      // "Started" means art or a model actually exists: a row carries
      // null, not undefined, for a model it has not built.
      const started = chosenOf('splash') !== undefined || Boolean(row?.model);
      brief.append(el('h3', '', 'Start here: your champion in one line'));
      brief.append(
        el(
          'p',
          'fe-lead',
          started
            ? 'Say it again differently and the whole champion is rewritten: name, role, the ' +
                'five spells, the stats, and the line the splash starts from. Your art and ' +
                'your 3D are never touched, and nothing lands until you take it.'
            : 'Say what your champion is, the way you would say it to a friend. You get a ' +
                'complete, legal champion back: name, role, passive plus four spells, stats, ' +
                'and the line the splash art starts from. Then change whatever you like in ' +
                'the steps below. Nothing lands on the form until you take it.',
        ),
      );
      const heroRow = el('div', 'fe-hero');
      const input = el('input', 'fe-hero-input') as HTMLInputElement;
      input.placeholder =
        'A storm dancer who trades her own health for speed, and ends fights with a thunder leap...';
      input.maxLength = BRIEF_LINE_MAX;
      input.value = briefLine;
      input.disabled = briefBusy;
      input.addEventListener('input', () => {
        briefLine = input.value;
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !briefBusy) runBrief();
      });
      const go = pricedBtn(
        'fe-gen',
        started ? 'Rewrite the champion' : 'Write my champion',
        'kitTurn',
      );
      go.disabled = briefBusy;
      go.title = 'One answer: identity, the five spells and the stats, all inside the rules';
      go.addEventListener('click', runBrief);
      heroRow.append(input, go);
      brief.append(heroRow);
      const chips = el('div', 'fe-chips');
      chips.append(el('span', 'fe-field-label', 'Try one:'));
      for (const ex of BRIEF_EXAMPLES) {
        const chip = el('button', 'fe-chip', `${ex.slice(0, 44)}...`);
        chip.title = ex;
        chip.addEventListener('click', () => {
          briefLine = ex;
          input.value = ex;
        });
        chips.append(chip);
      }
      brief.append(chips);
      if (briefBusy) {
        const stageLine = el('div', 'fe-step-text', briefStage);
        const commentLine = el('p', 'fe-desc', briefComment);
        briefStageEl = stageLine;
        briefCommentEl = commentLine;
        brief.append(stageLine, commentLine);
      }
      main.append(brief);

      // The proposal, whole: what the creator is about to accept, in the
      // same derived words the roster shows, with every envelope's bill.
      if (briefProposal !== null) {
        const p = briefProposal;
        const prop = el('div', 'fe-panel');
        prop.append(el('h3', '', 'Proposed champion'));
        if (p.comment) prop.append(el('p', 'fe-lead', p.comment));
        const head = el('div', 'fe-prop-spell');
        head.append(el('strong', '', `${p.name}${p.title ? `, ${p.title}` : ''} (${p.role})`));
        if (p.tagline) head.append(el('p', 'fe-desc fe-flavor', p.tagline));
        prop.append(head);
        const tpl = PASSIVE_TEMPLATES[p.passive.template];
        const pass = el('div', 'fe-prop-spell');
        pass.append(el('strong', '', `Passive: ${p.passive.name || 'Passive'}`));
        if (p.passive.flavor) pass.append(el('p', 'fe-desc fe-flavor', p.passive.flavor));
        if (tpl) pass.append(el('p', 'fe-desc', tpl.describe(p.passive.params)));
        prop.append(pass);
        for (const key of ['Q', 'W', 'E', 'R'] as const) {
          const a = p.abilities[key];
          const block = el('div', 'fe-prop-spell');
          block.append(el('strong', '', `${key}: ${a.name}`));
          const line = el('p', 'fe-desc');
          setRichLine(line, describeAbility(key, a).join(' '));
          block.append(line);
          prop.append(block);
        }
        prop.append(
          el(
            'p',
            'fe-lead',
            `Kit ${p.budget.kit.spend} / ${p.budget.kit.cap}, stats ${p.budget.stats.spend} / ` +
              `${p.budget.stats.cap}, growth ${p.budget.growth.spend} / ${p.budget.growth.cap}: ` +
              'inside every envelope, playable as it stands.',
          ),
        );
        if (p.held.length > 0) {
          prop.append(
            el(
              'p',
              'fe-desc',
              `${p.held.join(', ')} held by the burst cap while the other spells took the room.`,
            ),
          );
        }
        const take = el('button', 'fe-gen', 'Take this champion (free)') as HTMLButtonElement;
        take.title =
          'Fills the identity, the kit and the stats, and prefills the splash line; your art ' +
          'and your 3D stay as they are';
        take.addEventListener('click', takeBrief);
        const again = el('button', 'fe-mini', 'Ask again') as HTMLButtonElement;
        again.disabled = briefBusy;
        again.title = 'Another champion from the same line, at the same price';
        again.addEventListener('click', runBrief);
        const row2 = el('div', 'fe-anim-actions');
        row2.append(take, again);
        prop.append(row2);
        main.append(prop);
      }
    }

    const splash = el('div', 'fe-panel');
    splash.append(el('h3', '', 'Step 1: splash art'));
    if (sealed) {
      splash.append(
        el('div', 'fe-lead', 'This champion is sealed: its art is final. Admire it below.'),
      );
    } else {
      splash.append(
        el(
          'p',
          'fe-lead',
          'Describe your champion and generate the splash art. It is the creative anchor: the card, the model reference, and from it the 3D all derive from this picture. Click any result to see it large, pick it, or iterate on it.',
        ),
      );
      const hero = el('div', 'fe-hero');
      const line = el('input', 'fe-hero-input') as HTMLInputElement;
      // Iterating keeps the character: the input then asks for the change
      // only, and the server appends it to the source image's prompt.
      line.placeholder = refineFrom.splash
        ? 'What should change? The character stays the same...'
        : 'Silhouette, materials, mood, one accent color, memorable details...';
      line.maxLength = 400;
      line.value = artLines.splash ?? '';
      line.addEventListener('input', () => {
        artLines.splash = line.value;
      });
      const genBtn = pricedBtn('fe-gen', 'Generate splash art', 'image');
      genBtn.disabled = busy;
      genBtn.addEventListener('click', () => generateArtKind('splash', line.value));
      hero.append(line, genBtn);
      const mess = el('div', 'fe-heromess');
      const prefill = el('button', 'fe-mini', 'Use my card text');
      prefill.addEventListener('click', () => {
        const identity = [current.name, current.title].filter((s) => s.trim() !== '').join(', ');
        line.value = current.tagline.trim() === '' ? identity : `${identity}: ${current.tagline}`;
        artLines.splash = line.value;
      });
      mess.append(prefill, emberNote());
      splash.append(hero, mess);
      const badge = refineBadge('splash');
      if (badge) splash.append(badge);
      const chips = el('div', 'fe-chips');
      chips.append(el('span', 'fe-field-label', 'Try an example:'));
      for (const ex of EXAMPLE_LINES) {
        const chip = el('button', 'fe-chip', `${ex.slice(0, 42)}...`);
        chip.title = ex;
        chip.addEventListener('click', () => {
          line.value = ex;
          artLines.splash = ex;
        });
        chips.append(chip);
      }
      splash.append(chips);
      if (
        artCandidates.filter((c) => c.kind === 'splash').length === 0 &&
        generating !== 'splash'
      ) {
        splash.append(
          el('div', 'fe-desc', 'No splash yet. Generate a few and pick the one that feels right.'),
        );
      }
    }
    splash.append(artStrip('splash', true));
    main.append(splash);

    // Step 2: the model reference, the player's own generation. One
    // figure, one view: this exact image is what the 3D builder reads.
    const refPanel = el('div', 'fe-panel');
    refPanel.append(el('h3', '', 'Step 2: model reference (what the 3D is built from)'));
    if (sealed) {
      refPanel.append(el('div', 'fe-lead', 'Sealed with the champion.'));
    } else if (!chosenOf('splash')) {
      refPanel.append(
        el(
          'div',
          'fe-lead',
          'Pick a splash first: the reference derives from it. Then generate the reference here, check it, and iterate until it shows exactly ONE character, full body, facing you, on a plain background.',
        ),
      );
    } else {
      refPanel.append(
        el(
          'p',
          'fe-lead',
          'Derived from your chosen splash: one character, full body, front view, plain background. The 3D builder reads this exact image, so check it before building: one single figure, no split views. Iterate with notes until it is right.',
        ),
      );
      const heroRow = el('div', 'fe-hero');
      const notes = el('input', 'fe-hero-input') as HTMLInputElement;
      notes.placeholder = refineFrom.sheet
        ? 'What should change? The character stays the same...'
        : 'Optional notes: fix the pose, the colors, the outfit...';
      notes.maxLength = 400;
      notes.value = artLines.sheet ?? '';
      notes.addEventListener('input', () => {
        artLines.sheet = notes.value;
      });
      const genRef = el('button', 'fe-gen', 'Generate the reference') as HTMLButtonElement;
      genRef.disabled = busy;
      genRef.addEventListener('click', () => generateArtKind('sheet', notes.value));
      heroRow.append(notes, genRef);
      refPanel.append(heroRow);
      const badge = refineBadge('sheet');
      if (badge) refPanel.append(badge);
    }
    refPanel.append(artStrip('sheet', true));
    main.append(refPanel);

    // Step 3: the champion's own weapon, its own generation zone. The
    // reference deliberately shows empty hands (a fused weapon becomes
    // fused geometry); the weapon gets its own image and its own 3D.
    const weaponPanel = el('div', 'fe-panel');
    weaponPanel.append(el('h3', '', 'Step 3: weapon (optional)'));
    // A champion sealed WITHOUT a weapon keeps this zone open: the
    // weapon can still be claimed here, at its own price.
    if (sealed && row?.weapon) {
      weaponPanel.append(el('div', 'fe-lead', 'Sealed with the champion.'));
    } else if (!chosenOf('splash')) {
      weaponPanel.append(
        el(
          'div',
          'fe-lead',
          'Pick a splash first: the weapon is extracted from it. The reference keeps empty ' +
            'hands on purpose; the weapon becomes its own 3D piece, attached in the workshop.',
        ),
      );
    } else {
      weaponPanel.append(
        el(
          'p',
          'fe-lead',
          sealed
            ? 'Your champion sealed without a weapon: you can still generate ' +
                'the weapon image below, pick it, then forge it in Step 4. It attaches to a ' +
                'hand in the workshop.'
            : 'Your weapon, alone on a plain background, extracted from the splash. Iterate ' +
                'until it is right: the 3D weapon builds from this exact image during the ' +
                'champion build, then attaches to a hand in the workshop. Skip it to fight ' +
                'bare-handed or wear a weapon from the house armory.',
        ),
      );
      const weaponRow = el('div', 'fe-hero');
      const wNotes = el('input', 'fe-hero-input') as HTMLInputElement;
      wNotes.placeholder = refineFrom.weapon
        ? 'What should change? The weapon stays the same...'
        : 'Optional notes: which weapon, what to fix...';
      wNotes.maxLength = 400;
      wNotes.value = artLines.weapon ?? '';
      wNotes.addEventListener('input', () => {
        artLines.weapon = wNotes.value;
      });
      const genWeapon = el('button', 'fe-gen', 'Generate the weapon image') as HTMLButtonElement;
      genWeapon.disabled = busy;
      genWeapon.addEventListener('click', () => generateArtKind('weapon', wNotes.value));
      weaponRow.append(wNotes, genWeapon);
      weaponPanel.append(weaponRow);
      const wBadge = refineBadge('weapon');
      if (wBadge) weaponPanel.append(wBadge);
    }
    weaponPanel.append(artStrip('weapon', true));
    main.append(weaponPanel);

    // Step 4: the model build, which comes back RIGGED (playtest: a
    // creator who has just built their 3D wants to place the weapon that
    // moment, and a weapon hangs on a hand bone). Animation is still its
    // own later click, in Step 5. The weapon-only forge (the claim) lives
    // here too, with the same staged checklist as the build itself.
    const buildPanel = el('div', 'fe-panel');
    buildPanel.append(el('h3', '', 'Step 4: build the 3D model'));
    stageRows = null;
    if (finalizing) {
      buildPanel.append(
        el(
          'p',
          'fe-lead',
          'The forge is working. A few minutes; stay and watch, or come back: the build keeps going.',
        ),
      );
      buildPanel.append(...stageChecklist(BUILD_STAGES));
    } else if (row?.model) {
      const cta = el('div', 'fe-model-cta');
      if (row.sheet) {
        const img = document.createElement('img');
        img.src = assetUrl(row.sheet);
        img.alt = '';
        cta.append(img);
      }
      const right = el('div', '');
      right.append(
        el(
          'div',
          'fe-lead',
          sealed
            ? 'Your model is built and sealed: turn it around, attach and adjust the weapon, then save the tuning. Matches use exactly what you save.'
            : 'Your model is built and rigged: inspect it in the workshop and hang its ' +
                'weapon on a hand there. Happy with it? Give it its animations in Step 5. ' +
                'Not happy? Iterate the reference in Step 2 and rebuild, which costs its ' +
                'embers again.',
        ),
      );
      const open = el('button', 'fe-gen', 'Open the 3D workshop');
      open.addEventListener('click', openWorkshopHere);
      right.append(open);
      if (!sealed) {
        const rebuild = el('button', 'fe-gen', 'Rebuild the 3D model') as HTMLButtonElement;
        const blocker = forgeBlocker();
        rebuild.disabled = blocker !== null;
        rebuild.title =
          blocker ??
          `Replaces the model from your chosen reference and rigs it again; costs ${format(
            buildPrice(),
          )} embers`;
        rebuild.addEventListener('click', runForge);
        right.append(rebuild);
      }
      cta.append(right);
      buildPanel.append(cta);
      if (!row.weapon) {
        // The unclaimed weapon forges from here, exactly like the build:
        // same panel, same ember bar, same staged checklist.
        buildPanel.append(
          el(
            'div',
            'fe-lead',
            'Your champion can still have a weapon: pick its image in Step 3, then forge it here.',
          ),
        );
        if (weaponForging) {
          buildPanel.append(...stageChecklist(WEAPON_STAGES));
        } else {
          const claim = pricedBtn('fe-gen', 'Forge the 3D weapon', 'weapon');
          claim.disabled = busy || finalizing || animating || !chosenOf('weapon');
          claim.title = chosenOf('weapon')
            ? `Builds the 3D weapon from your chosen image; costs ${format(priceOf('weapon'))} embers`
            : 'Generate and pick a weapon image first (Step 3)';
          claim.addEventListener('click', forgeWeaponNow);
          buildPanel.append(claim);
        }
      }
    } else {
      buildPanel.append(
        el(
          'p',
          'fe-lead',
          'Builds the 3D model from your chosen reference image (the exact one you picked), ' +
            'rigs it so it has the bones a weapon hangs on, and forges your weapon if you ' +
            'made one. You inspect the result in the workshop and place the weapon there; ' +
            'the animations come AFTER, in Step 5. Any failure refunds every ember it took.',
        ),
      );
      // One button, one price, and the price is the whole run: the model,
      // its rig, and the weapon when one is waiting to be forged with it
      // (ADR 0017: a control that costs says so on its face).
      const build = el('button', 'fe-gen', 'Build the 3D model') as HTMLButtonElement;
      build.append(document.createTextNode(' '), balanceTag('embers', buildPrice(), 12));
      const blocker = forgeBlocker();
      build.disabled = blocker !== null;
      build.title =
        blocker ?? 'Runs on your chosen reference, rigs it; a failure refunds every ember';
      build.addEventListener('click', runForge);
      buildPanel.append(build);
      // The balance stands beside the dearest act on the page, because a
      // creator should read what they hold before pressing, never after
      // being stopped (ADR 0017).
      buildPanel.append(stockLine());
      if (blocker) buildPanel.append(el('div', 'fe-desc', blocker));
    }
    main.append(buildPanel);

    // Step 5: the animations, ALWAYS the last step of the pipeline and
    // the player's own click once the built model is validated. Sealing
    // is not a step here at all: it is one of the champion's actions, in
    // the right rail (playtest: the lock of a whole champion read as a
    // setting of its clips when it sat in this panel).
    const animPanel = el('div', 'fe-panel');
    animPanel.append(el('h3', '', 'Step 5: animations'));
    if (animating) {
      animPanel.append(
        el(
          'p',
          'fe-lead',
          'Animating. A few minutes; stay and watch, or come back: it keeps going.',
        ),
      );
      animPanel.append(...stageChecklist(ANIM_STAGES));
    } else {
      // The picks start from what the champion carries: its baked clips
      // when sealed, the style defaults otherwise; switching drafts
      // reseeds.
      if (animSeededFor !== current.id && row) {
        if (row.clips) {
          animPicks = { ...row.clips };
          if (FAMILY_CHOICES.some((c) => c.value === row.family)) {
            animFamily = row.family as string;
          }
          animSeededFor = current.id;
        } else if (animCatalog) {
          applyFamilyDefaults();
          animSeededFor = current.id;
        }
      }
      animPanel.append(
        el(
          'p',
          'fe-lead',
          sealed
            ? 'The seal locks the kit, the art and the model, NEVER the animations: change ' +
                'any animation below and apply JUST that one, paying only for the clips that ' +
                'actually change.'
            : 'Once the model is built and you are happy with it, pick each of the five ' +
                'animations from the catalog (every death for death, every strike for ' +
                'attack). Each pick plays on the gray mannequin the moment you choose it. ' +
                'The bake charges a base plus a rate for every clip, which the button below ' +
                'prices, so changing one animation later is cheap.',
        ),
      );
      // The preview stage: any preset plays on the neutral mannequin the
      // moment it is picked, before anything bakes. One three.js stage,
      // created lazily and reattached across renders.
      if (!animPreview) animPreview = createAnimPreview();
      animPanel.append(animPreview.el);
      const famRow = el('div', 'fe-artrow');
      famRow.append(el('span', 'fe-field-label', 'Style prefill:'));
      const famSelect = el('select', 'fe-select') as HTMLSelectElement;
      for (const c of FAMILY_CHOICES) {
        const opt = document.createElement('option');
        opt.value = c.value;
        opt.textContent = c.label;
        famSelect.append(opt);
      }
      famSelect.value = animFamily;
      famSelect.addEventListener('change', () => {
        animFamily = famSelect.value;
        applyFamilyDefaults();
        renderMain();
      });
      famRow.append(famSelect);
      animPanel.append(famRow);
      // One row per clip role: the whole catalog for that role, the
      // player's own pick (playtest: not a bundle), its baked state, and
      // its OWN bake button the moment the pick differs from what is
      // baked (playtest round 9: validate each animation, never five at
      // a time).
      const bakedNow = row?.clips ?? null;
      const changedRoles: string[] = [];
      if (animCatalog) {
        for (const { role, label } of ROLE_LABELS) {
          const choices = animCatalog.roles[role] ?? [];
          const rowEl = el('div', 'fe-artrow');
          rowEl.append(el('span', 'fe-field-label', `${label}:`));
          const sel = el('select', 'fe-select') as HTMLSelectElement;
          for (const c of choices) {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.label;
            opt.title = c.id;
            sel.append(opt);
          }
          const picked = animPicks[role];
          if (picked !== undefined && choices.some((c) => c.id === picked)) sel.value = picked;
          sel.addEventListener('change', () => {
            animPicks[role] = sel.value;
            animPreview?.show(sel.value, role);
            renderMain();
          });
          rowEl.append(sel);
          const play = el('button', 'fe-mini', 'Play') as HTMLButtonElement;
          play.title = 'Play this pick on the mannequin';
          play.addEventListener('click', () => animPreview?.show(sel.value, role));
          rowEl.append(play);
          const bakedId = bakedNow?.[role];
          const changed = bakedId !== undefined && sel.value !== bakedId;
          if (changed) changedRoles.push(role);
          if (bakedId !== undefined && !changed) {
            const chip = el('span', 'fe-desc', 'in use');
            chip.title = bakedId;
            rowEl.append(chip);
          } else if (changed) {
            const one = el('button', 'fe-mini gold', 'Apply this one (free)') as HTMLButtonElement;
            one.disabled = busy || finalizing || weaponForging;
            one.title = `Replaces only the ${label.toLowerCase()} animation; spends nothing`;
            one.addEventListener('click', () => {
              const pick = animPicks[role];
              if (pick !== undefined) runAnimate({ [role]: pick });
            });
            rowEl.append(one);
          }
          animPanel.append(rowEl);
        }
      } else {
        animPanel.append(
          el('div', 'fe-desc', 'Loading the animation catalog... if it stays empty, reload.'),
        );
      }
      // The bottom actions, spaced as their own row: the first pass
      // applies all five at once; a sealed champion only gets the group
      // button when several rows changed (one changed row applies from
      // its own button).
      const actions = el('div', 'fe-anim-actions');
      if (!sealed || bakedNow === null) {
        // Two prices, not one, so this cannot go through pricedBtn: a base
        // to open the bake and a rate per clip on top. Both wear the mark.
        const bake = el('button', 'fe-gen', 'Animate the champion') as HTMLButtonElement;
        bake.append(
          document.createTextNode(' '),
          balanceTag('embers', priceOf('bakeBase'), 12),
          document.createTextNode(' plus '),
          balanceTag('embers', priceOf('bakePerClip'), 12),
          document.createTextNode(' a clip'),
        );
        bake.disabled = !row?.model || busy || finalizing || weaponForging;
        bake.title = !row?.model
          ? 'Build the 3D model first (Step 4)'
          : 'Applies your five picks to your rigged model';
        bake.addEventListener('click', () => runAnimate(animPicks));
        actions.append(bake);
        // Said in plain sight, not only in the hover title: a grayed
        // button with no visible reason reads as broken (playtest).
        if (!row?.model) {
          actions.append(
            el(
              'div',
              'fe-desc',
              'Locked until the 3D model is built (Step 4). Until then this champion ' +
                'plays as the plain placeholder figure in a match.',
            ),
          );
        } else if (row.rigged === false) {
          // A model built before the build rigged: this first bake rigs
          // it, and says so rather than surprising the balance.
          actions.append(
            el(
              'div',
              'fe-desc',
              'This model was built before builds rigged, so this first bake also rigs it: ' +
                `${format(priceOf('rig'))} embers on top of the clips.`,
            ),
          );
        }
      } else if (changedRoles.length >= 2) {
        const bake = el(
          'button',
          'fe-gen',
          `Apply the ${changedRoles.length} changed animations (free)`,
        ) as HTMLButtonElement;
        bake.disabled = busy || finalizing || weaponForging;
        bake.title = 'Replaces only the changed animations; spends nothing';
        bake.addEventListener('click', () => {
          const picks: Record<string, string> = {};
          for (const role of changedRoles) {
            const pick = animPicks[role];
            if (pick !== undefined) picks[role] = pick;
          }
          runAnimate(picks);
        });
        actions.append(bake);
      }
      if (sealed) {
        const openAnim = el('button', 'fe-gen', 'See them move');
        openAnim.addEventListener('click', openWorkshopHere);
        actions.append(openAnim);
      }
      if (actions.childElementCount > 0) animPanel.append(actions);
    }
    main.append(animPanel);

    const card = el('div', 'fe-panel');
    card.append(el('h3', '', 'Identity'));
    card.append(
      textInput(
        'Name',
        () => current.name,
        (v) => {
          current.name = v;
        },
        40,
      ),
    );
    card.append(
      textInput(
        'Title (after the name)',
        () => current.title,
        (v) => {
          current.title = v;
        },
        40,
      ),
    );
    card.append(
      textInput(
        'Tagline: the one line that tells four allies what this kit does',
        () => current.tagline,
        (v) => {
          current.tagline = v;
        },
        90,
      ),
    );
    const roleSelect = el('select', 'fe-select') as HTMLSelectElement;
    for (const r of FORGED_ROLES) {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      roleSelect.append(opt);
    }
    roleSelect.value = current.role;
    roleSelect.addEventListener('change', () => {
      current.role = roleSelect.value as ChampionRole;
      refresh();
    });
    const roleField = el('label', 'fe-field');
    roleField.append(el('span', 'fe-field-label', 'role'), roleSelect);
    card.append(roleField);
    main.append(card);
  }

  // Tab 2, Spells: the slot bar (passive plus Q W E R), the selected
  // spell's icon generation front and center, its parameters below.
  function renderSpells(): void {
    const sealed = isSealed();

    // The kit overview first: the whole envelope cut into its parts, and
    // the burst caps, so the creator sees where the room is before
    // touching a spell.
    const overview = el('div', 'fe-panel');
    overview.append(el('h3', '', 'Kit overview'));
    const view = kitOverview();
    view.update(current);
    overview.append(view.el);
    kitView = view;
    main.append(overview);

    // The kit conversation (playtest: iterate before applying). The
    // thread lives in this editor session only; each answer lands as a
    // whole proposed kit in the panel below, validated by the server
    // against the full game rules, and NOTHING touches the form until
    // Apply. Shown on sealed champions too, disabled with its reason in
    // plain sight: an absent control reads as broken.
    const splashChosen = chosenOf('splash') !== undefined;
    main.append(
      chatPanel<{
        ok: boolean;
        comment?: string;
        passive?: ForgedChampionDef['passive'];
        abilities?: ForgedChampionDef['abilities'];
        raw?: string;
        budget?: { total: number; cap: number };
        fit?: number;
        held?: string[];
        error?: string;
      }>(kitChat, {
        title: 'Kit conversation (AI)',
        lead:
          'Reads your chosen splash. Say what you want ("an ice theme", "more mobility ' +
          'on the E", "a darker line of story for the Q"); each answer proposes a full kit ' +
          'below, fitted to the kit envelope line, with a line of story per spell above ' +
          'the derived text. Nothing touches your spells until you apply it.',
        placeholder: 'What should this kit be?',
        locked: sealed
          ? 'This champion is sealed: its kit is locked. Unseal it (Design tab, ' +
            'animations block) to rework the kit.'
          : splashChosen
            ? null
            : 'Locked until a splash art is chosen on the Design tab.',
        parts: ['passive', 'Q', 'W', 'E', 'R'],
        request: (messages, onLine) =>
          ensureSaved().then((ok) =>
            ok
              ? chatStream('/api/forge/suggest', { id: current.id, def: current, messages }, onLine)
              : { ok: false, error: lastSaveError ?? 'the draft could not be saved' },
          ),
        accept: (r) => {
          if (!r?.ok || !r.passive || !r.abilities || typeof r.raw !== 'string') {
            return { error: r?.error ?? 'the suggestion failed' };
          }
          proposal = {
            passive: r.passive,
            abilities: r.abilities,
            budget: r.budget ?? { total: 0, cap: 0 },
            fit: r.fit ?? 1,
            held: r.held ?? [],
          };
          return { raw: r.raw, bubble: r.comment ? r.comment : 'Here is a kit proposal.' };
        },
        report: (message) => {
          status.textContent = message;
        },
        rerender: renderMain,
        changed: () => persistChat('kit'),
      }),
    );

    // The latest proposal, whole-kit: the same derived descriptions the
    // roster shows, the budget bill, one Apply for all of it.
    if (proposal !== null) {
      const p = proposal;
      const prop = el('div', 'fe-panel');
      prop.append(el('h3', '', 'Proposed kit'));
      const tpl = PASSIVE_TEMPLATES[p.passive.template];
      const pass = el('div', 'fe-prop-spell');
      pass.append(el('strong', '', `Passive: ${p.passive.name || 'Passive'}`));
      if (p.passive.flavor) pass.append(el('p', 'fe-desc fe-flavor', p.passive.flavor));
      if (tpl) pass.append(el('p', 'fe-desc', tpl.describe(p.passive.params)));
      prop.append(pass);
      for (const key of ['Q', 'W', 'E', 'R'] as const) {
        const a = p.abilities[key];
        const block = el('div', 'fe-prop-spell');
        block.append(el('strong', '', `${key}: ${a.name}`));
        const line = el('p', 'fe-desc');
        setRichLine(line, describeAbility(key, a).join(' '));
        block.append(line);
        prop.append(block);
      }
      prop.append(
        el(
          'p',
          'fe-lead',
          `This kit uses ${p.budget.total} / ${p.budget.cap} of the kit envelope.`,
        ),
      );
      if (Math.abs(p.fit - 1) >= 0.005) {
        prop.append(
          el(
            'p',
            'fe-desc',
            `Amounts ${p.fit > 1 ? 'raised' : 'trimmed'} to ${p.fit.toFixed(2)} times the ` +
              'answer to sit on the envelope line; the power dials move them again.',
          ),
        );
      }
      if (p.held.length > 0) {
        prop.append(
          el(
            'p',
            'fe-desc',
            `${p.held.join(', ')} held by the burst cap while the other spells took the room.`,
          ),
        );
      }
      if (!sealed) {
        const apply = el('button', 'fe-gen small', 'Apply this kit (free)') as HTMLButtonElement;
        apply.title = 'Fills the form with this kit; nothing is saved until you save';
        apply.addEventListener('click', () => {
          current.passive = structuredClone(p.passive);
          // The kit is the conversation's; the sounds stay the creator's.
          const kept = current.abilities;
          current.abilities = structuredClone(p.abilities);
          for (const key of ['Q', 'W', 'E', 'R'] as const) {
            const sound = kept[key]?.sound;
            if (sound !== undefined && current.abilities[key].sound === undefined) {
              current.abilities[key].sound = sound;
            }
          }
          status.textContent = 'The proposed kit is on the form: review, tweak, then save.';
          renderMain();
          refresh();
        });
        prop.append(apply);
      }
      main.append(prop);
    }

    // The look conversation, the kit's sibling: the spells' EFFECTS as
    // data (src/sim/spell_look.ts). The authored VFX catalog is code keyed
    // by champion id, so a forged champion can never appear in it and its
    // spells would otherwise all wear the same school-derived default;
    // a look is the art it can own. Nothing is generated and nothing is
    // downloaded, so this costs no embers: apply, then see it in a test
    // drive.
    main.append(
      chatPanel<{
        ok: boolean;
        comment?: string;
        looks?: Record<string, SpellLook | null>;
        raw?: string;
        error?: string;
      }>(lookChat, {
        title: 'Spell looks (AI)',
        lead:
          'Reads your splash and your kit, and gives each spell its own effects: the shape ' +
          'of the bolt, what it trails, how it lands, the color. Say what you want ("frost, ' +
          'not fire", "make the R shake the screen", "keep the Q quiet"). Nothing touches ' +
          'your spells until you apply it, and it costs nothing.',
        placeholder: 'What should these spells look like?',
        locked: sealed
          ? 'This champion is sealed: its spells are locked. Unseal it (Design tab, ' +
            'animations block) to repaint them.'
          : null,
        parts: ['Q', 'W', 'E', 'R'],
        request: (messages, onLine) =>
          ensureSaved().then((ok) =>
            ok
              ? chatStream(
                  '/api/forge/suggest-look',
                  { id: current.id, def: current, messages },
                  onLine,
                )
              : { ok: false, error: lastSaveError ?? 'the draft could not be saved' },
          ),
        accept: (r) => {
          if (!r?.ok || !r.looks || typeof r.raw !== 'string') {
            return { error: r?.error ?? 'the suggestion failed' };
          }
          lookProposal = r.looks;
          return { raw: r.raw, bubble: r.comment ? r.comment : 'Here are the spell looks.' };
        },
        report: (message) => {
          status.textContent = message;
        },
        rerender: renderMain,
        changed: () => persistChat('looks'),
      }),
    );

    // The latest looks, one readable line per spell, one Apply for all
    // four: the same shape the kit proposal takes above.
    if (lookProposal !== null) {
      const looks = lookProposal;
      const prop = el('div', 'fe-panel');
      prop.append(el('h3', '', 'Proposed spell looks'));
      for (const key of ['Q', 'W', 'E', 'R'] as const) {
        const block = el('div', 'fe-prop-spell');
        block.append(el('strong', '', `${key}: ${current.abilities[key].name}`));
        block.append(el('p', 'fe-desc', describeLook(looks[key])));
        prop.append(block);
      }
      if (!sealed) {
        const apply = el('button', 'fe-gen small', 'Apply these looks (free)') as HTMLButtonElement;
        apply.title = 'Puts these effects on your spells; nothing is saved until you save';
        apply.addEventListener('click', () => {
          for (const key of ['Q', 'W', 'E', 'R'] as const) {
            const look = looks[key];
            if (look) current.abilities[key].look = structuredClone(look);
            else delete current.abilities[key].look;
          }
          status.textContent =
            'The spell looks are on the form: save, then test drive to see them.';
          renderMain();
          refresh();
        });
        prop.append(apply);
      }
      main.append(prop);
    }

    // The spells themselves, right under the proposal: one slot per key
    // wearing its icon, the icon generation beside each (or all four at
    // once), and the selected slot's candidates. The slot's parameters
    // edit below.
    const slotsPanel = el('div', 'fe-panel');
    slotsPanel.append(el('h3', '', 'Spells'));
    slotsPanel.append(
      el(
        'p',
        'fe-lead',
        'Pick a slot to edit it below. Every spell wears a generated icon in the game ' +
          'style (the procedural one plays until then): make them one at a time, or all ' +
          'four at once.',
      ),
    );
    const slots = el('div', 'fe-slots');
    const slotDefs: readonly { key: SpellSlot; label: string }[] = [
      { key: 'P', label: 'Passive' },
      { key: 'Q', label: 'Q' },
      { key: 'W', label: 'W' },
      { key: 'E', label: 'E' },
      { key: 'R', label: 'R' },
    ];
    for (const { key, label } of slotDefs) {
      const col = el('div', 'fe-slotcol');
      const slot = el('button', 'fe-slot') as HTMLButtonElement;
      slot.classList.toggle('on', spellSlot === key);
      const face = el('div', 'fe-slot-img');
      const chosenIcon = key === 'P' ? undefined : chosenOf(`icon_${key}`);
      if (generating === `icon_${key}`) {
        face.append(el('div', 'fe-spin'));
      } else if (chosenIcon) {
        const img = document.createElement('img');
        img.src = assetUrl(chosenIcon.path);
        img.alt = '';
        face.append(img);
      } else {
        face.textContent = key === 'P' ? 'P' : '+';
      }
      const name =
        key === 'P' ? current.passive.name || 'Passive' : current.abilities[key].name || label;
      slot.append(face, el('div', 'fe-slot-key', `${label === name ? name : `${label} ${name}`}`));
      slot.addEventListener('click', () => {
        spellSlot = key;
        renderMain();
      });
      col.append(slot);
      if (key !== 'P' && !sealed) {
        const gen = el('button', 'fe-mini fe-slot-gen', 'Icon') as HTMLButtonElement;
        gen.disabled = generating !== null;
        gen.title = chosenIcon
          ? 'Generate another icon for this spell'
          : 'Generate the icon of this spell';
        gen.addEventListener('click', () => generateArtKind(`icon_${key}`, ''));
        col.append(gen);
      }
      slots.append(col);
    }
    slotsPanel.append(slots);
    // The basic attack's sound, from the palette (each spell picks its
    // cast sound below, beside its animation): a pick plays at once, so
    // it is heard before it is kept; autosave carries it with the def.
    const atkRow = el('div', 'fe-artrow');
    atkRow.append(el('span', 'fe-desc', 'Basic attack sound'));
    const atkSel = el('select', 'fe-select fe-sound') as HTMLSelectElement;
    const atkAuto = document.createElement('option');
    atkAuto.value = '';
    atkAuto.textContent = 'Auto: a whip of air';
    atkSel.append(atkAuto);
    appendSoundGroups(atkSel, ATTACK_SOUND_GROUPS);
    atkSel.value = current.attackSound ?? '';
    atkSel.disabled = sealed;
    atkSel.addEventListener('change', () => {
      if (atkSel.value === '') current.attackSound = undefined;
      else current.attackSound = atkSel.value as AttackSoundId;
      playSfx(attackSoundOf(current, false));
      refresh();
    });
    const atkHear = el('button', 'fe-mini', 'Play') as HTMLButtonElement;
    atkHear.title = 'Hear the basic attack';
    atkHear.addEventListener('click', () => playSfx(attackSoundOf(current, false)));
    atkRow.append(atkSel, atkHear);
    slotsPanel.append(atkRow);
    if (!sealed) {
      const all = el('div', 'fe-artrow');
      // Four icons at once, so four times the price: passed as a
      // multiplier rather than patched into a finished label, which is
      // what the string surgery here used to do.
      const genAll = pricedBtn('fe-gen small', 'Generate all four icons', 'image', 4);
      genAll.disabled = generating !== null;
      genAll.title = 'One icon per spell, in order, each drawn from what that spell does';
      genAll.addEventListener('click', () =>
        generateArtKinds(
          (['Q', 'W', 'E', 'R'] as const).map((k) => ({ kind: `icon_${k}`, line: '' })),
        ),
      );
      all.append(genAll);
      all.append(emberNote());
      slotsPanel.append(all);
    }
    // The selected spell's icon candidates: view large, pick, iterate.
    if (spellSlot !== 'P') {
      const kind = `icon_${spellSlot}`;
      const chosenIcon = chosenOf(kind);
      const has = artCandidates.some((c) => c.kind === kind) || generating === kind;
      const iconRow = el('div', 'fe-iconrow');
      iconRow.append(el('span', 'fe-field-label', `${spellSlot} icon`));
      if (chosenIcon) {
        const small = document.createElement('img');
        small.src = assetUrl(chosenIcon.path);
        small.width = 24;
        small.height = 24;
        small.alt = '';
        small.title = 'At in-match size';
        iconRow.append(small);
      }
      const badge = refineBadge(kind);
      if (badge) iconRow.append(badge);
      if (has) iconRow.append(artStrip(kind, false));
      iconRow.append(
        el(
          'span',
          'fe-step-text',
          has
            ? 'Click a candidate to view it large, pick it, or iterate from it.'
            : 'No generated icon yet: the procedural one plays until you make one.',
        ),
      );
      slotsPanel.append(iconRow);
    }
    main.append(slotsPanel);

    if (spellSlot === 'P') {
      renderPassiveEditor(sealed);
    } else {
      renderAbilityEditor(spellSlot, sealed);
    }
  }

  // The slot switch beside a panel's title, for the creator deep in the
  // parameters or the animation: the other spells are one click away
  // without the way back up to the slot row (playtest: "no way to switch
  // between the spells for parameters and animation").
  function keyTabs(): HTMLElement {
    const row = el('div', 'fe-keytabs');
    for (const key of ['P', 'Q', 'W', 'E', 'R'] as const) {
      const b = el('button', 'fe-key fe-keytab', key) as HTMLButtonElement;
      b.type = 'button';
      b.classList.toggle('on', spellSlot === key);
      b.title = key === 'P' ? 'Edit the passive' : `Edit ${key}`;
      b.addEventListener('click', () => {
        if (spellSlot === key) return;
        spellSlot = key;
        renderMain();
      });
      row.append(b);
    }
    return row;
  }

  // The passive's parameters, in the same panel shape as a spell's: the
  // key, the name, then the template (one the engine owns) and its
  // numbers, described live. Structure comes from the kit conversation
  // or from the template pick here.
  function renderPassiveEditor(_sealed: boolean): void {
    const panel = el('div', 'fe-panel');
    panel.append(el('h3', '', 'Parameters (P)'));
    const headRow = el('div', 'fe-ability-head');
    headRow.append(keyTabs());
    const nameInput = el('input', 'fe-input') as HTMLInputElement;
    nameInput.style.marginBottom = '0';
    nameInput.maxLength = 40;
    nameInput.placeholder = 'Passive name';
    nameInput.value = current.passive.name;
    nameInput.addEventListener('input', () => {
      current.passive.name = nameInput.value;
      refresh();
    });
    headRow.append(nameInput);
    panel.append(headRow);
    panel.append(
      flavorInput(
        () => current.passive.flavor,
        (v) => {
          if (v === undefined) delete current.passive.flavor;
          else current.passive.flavor = v;
        },
      ),
    );
    const tpl = PASSIVE_TEMPLATES[current.passive.template];
    const desc = el('p', 'fe-desc', tpl ? tpl.describe(current.passive.params) : '');
    panel.append(desc);
    const tplRow = el('label', 'fe-field');
    tplRow.append(el('span', 'fe-field-label', 'template'));
    const tplSelect = el('select', 'fe-select') as HTMLSelectElement;
    for (const t of PASSIVE_TEMPLATE_LIST) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `${t.id}: ${t.summary}`;
      tplSelect.append(opt);
    }
    tplSelect.value = current.passive.template;
    tplSelect.addEventListener('change', () => {
      const next = PASSIVE_TEMPLATES[tplSelect.value];
      if (!next) return;
      const params: Record<string, number> = {};
      for (const p of next.params) params[p.key] = p.min + (p.max - p.min) / 2;
      for (const p of next.params)
        if (p.integer) params[p.key] = Math.round(params[p.key] ?? p.min);
      current.passive = { template: next.id, params, name: current.passive.name };
      hooks.rebuild();
    });
    tplRow.append(tplSelect);
    panel.append(tplRow);
    if (tpl) {
      const paramRow = el('div', 'fe-fields');
      for (const p of tpl.params) {
        paramRow.append(
          numField(
            p.key,
            current.passive.params,
            p.key,
            { min: p.min, max: p.max, ...(p.integer ? { integer: true } : {}) },
            hooks,
          ),
        );
      }
      panel.append(paramRow);
      paramRow.addEventListener('input', () => {
        desc.textContent = tpl.describe(current.passive.params);
      });
    }
    main.append(panel);
  }

  function renderAbilityEditor(key: AbilityKey, sealed: boolean): void {
    const ability = current.abilities[key] as unknown as Record<string, unknown>;

    // The parameters, for this spell alone.
    const panel = el('div', 'fe-panel');
    panel.append(el('h3', '', `Parameters (${key})`));
    const headRow = el('div', 'fe-ability-head');
    headRow.append(keyTabs());
    const nameInput = el('input', 'fe-input') as HTMLInputElement;
    nameInput.style.marginBottom = '0';
    nameInput.maxLength = 40;
    nameInput.value = String(ability.name ?? '');
    nameInput.addEventListener('input', () => {
      ability.name = nameInput.value;
      refresh();
    });
    headRow.append(nameInput);
    panel.append(headRow);
    panel.append(
      flavorInput(
        () => (typeof ability.flavor === 'string' ? ability.flavor : undefined),
        (v) => {
          if (v === undefined) delete ability.flavor;
          else ability.flavor = v;
        },
      ),
    );
    // The spell's full text, derived from its mechanics exactly like
    // every other champion's (describe.ts): what a suggestion or a hand
    // edit actually does, in words, live as the numbers move.
    const desc = el('p', 'fe-desc');
    const syncDesc = (): void => {
      // Rich generated HTML (colored values), not plain text.
      setRichLine(desc, describeAbility(key, current.abilities[key]).join(' '));
    };
    syncDesc();
    panel.append(desc);
    panel.addEventListener('input', syncDesc);
    panel.addEventListener('change', syncDesc);
    // The rhythm, in plain units: when the button is available and what
    // a press costs. These stay typed; they are choices, not amounts.
    const costs = el('div', 'fe-fields');
    costs.append(numField('mana cost', ability, 'manaCost', ABILITY_BOUNDS.manaCost, hooks));
    costs.append(
      numField(
        'cooldown (s)',
        ability,
        'cooldown',
        key === 'R' ? ABILITY_BOUNDS.ultCooldown : ABILITY_BOUNDS.basicCooldown,
        hooks,
      ),
    );
    costs.append(numField('cast range', ability, 'castRange', ABILITY_BOUNDS.castRange, hooks));
    costs.append(numField('windup (s)', ability, 'windup', ABILITY_BOUNDS.windup, hooks));
    panel.append(costs);

    // The power dial: one control scaling every amount (damage, healing,
    // crowd control durations) inside the bounds, stopped by the kit
    // envelope or a burst cap like a Stat polygon vertex, and saying
    // which. Structure comes from the kit conversation, or from the
    // advanced editor below.
    const anchor = structuredClone(current.abilities[key]);
    let advancedStale = true;
    const advBody = el('div', '');
    const rebuildAdvanced = (): void => {
      advBody.textContent = '';
      advBody.append(buildCastEditor(current.abilities[key], hooks));
      advancedStale = false;
    };
    const dialRow = el('div', 'fe-artrow');
    dialRow.append(el('span', 'fe-field-label', 'Power'));
    const dial = el('input', 'fe-dial') as HTMLInputElement;
    dial.type = 'range';
    dial.min = String(Math.round(POWER_DIAL_MIN * 100));
    dial.max = String(Math.round(POWER_DIAL_MAX * 100));
    dial.step = '1';
    dial.value = '100';
    dial.disabled = sealed;
    dial.title = sealed
      ? 'This champion is sealed; unseal it to retune'
      : 'Scales the amounts of this spell; the kit envelope and the burst cap are the walls';
    const stopTag = el('span', 'fe-stop', '');
    const costNote = el('span', 'fe-step-text', '');
    const syncCost = (): void => {
      const bill = budgetOf(current);
      const kit = envelopeSpend(bill).kit;
      const hit = burstOf(current).abilities[key];
      costNote.textContent =
        `costs ${Math.round(bill.abilities[key])} of the kit's ${Math.round(kit)} / ` +
        `${ENVELOPES.kit}; one cast deals ${Math.round(hit)} of ${Math.round(burstCapOf(key))}`;
    };
    syncCost();
    panel.addEventListener('input', syncCost);
    panel.addEventListener('change', syncCost);
    dial.addEventListener('input', () => {
      const live = current.abilities[key];
      // The anchor's rhythm may be stale (typed since render): cost the
      // scale against what is really on the form.
      const anchorNow: typeof anchor = {
        ...anchor,
        manaCost: live.manaCost,
        cooldown: live.cooldown,
        castRange: live.castRange,
        ...(live.windup !== undefined ? { windup: live.windup } : {}),
      };
      const asked = Number(dial.value) / 100;
      const granted = grantSpellPower(current, key, anchorNow, asked);
      // In place, so the rhythm fields above stay bound to the object.
      live.spec = granted.ability.spec;
      if (granted.ability.atRank) live.atRank = granted.ability.atRank;
      dial.value = String(Math.round(granted.factor * 100));
      // The word: which line stopped the dial short, so the creator knows
      // what to lighten. Silent when the ask was granted whole.
      const stopped = granted.stop !== null && granted.factor < asked - 1e-6;
      stopTag.textContent = stopped && granted.stop ? dialStopLabel(granted.stop) : '';
      stopTag.className = `fe-stop${stopped && granted.stop ? ` ${granted.stop}` : ''}`;
      stopTag.title = stopped && granted.stop ? dialStopHint(granted.stop) : '';
      advancedStale = true;
      hooks.refresh();
      syncDesc();
      syncCost();
    });
    dialRow.append(dial, stopTag, costNote);
    panel.append(dialRow);

    // Advanced: the full structural editor, collapsed and rebuilt on
    // open so a dial change never leaves stale fields behind.
    const advanced = document.createElement('details');
    advanced.className = 'fe-advanced';
    const sum = document.createElement('summary');
    sum.textContent = 'Advanced: edit the spell structure by hand';
    advanced.append(sum, advBody);
    advanced.addEventListener('toggle', () => {
      if (advanced.open && advancedStale) rebuildAdvanced();
    });
    dial.addEventListener('change', () => {
      if (advanced.open && advancedStale) rebuildAdvanced();
    });
    panel.append(advanced);
    main.append(panel);
    renderSpellAnimation(key, sealed);
  }

  // The spell's own animation (playtest round 6 ask): each ability key
  // gets a dedicated pick from the cast and strike catalogs, previewed
  // on the mannequin, applied on its own like any clip change. A spell
  // without a pick plays the shared cast animation.
  function renderSpellAnimation(key: AbilityKey, sealed: boolean): void {
    const panel = el('div', 'fe-panel');
    panel.append(el('h3', '', `${key} animation and sound`));
    const row = currentRow();
    const slot = `cast${key}`;
    const bakedPick = row?.clips?.[slot];
    const choices = [...(animCatalog?.roles.cast ?? []), ...(animCatalog?.roles.attack ?? [])];
    const rowEl = el('div', 'fe-artrow');
    const sel = el('select', 'fe-select') as HTMLSelectElement;
    const shared = document.createElement('option');
    shared.value = '';
    shared.textContent = 'Shared cast animation';
    sel.append(shared);
    for (const c of choices) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.label;
      opt.title = c.id;
      sel.append(opt);
    }
    if (bakedPick !== undefined && choices.some((c) => c.id === bakedPick)) sel.value = bakedPick;
    rowEl.append(sel);
    const play = el('button', 'fe-mini', 'Play') as HTMLButtonElement;
    play.title = 'Play this pick on the mannequin';
    play.addEventListener('click', () => {
      if (sel.value !== '') animPreview?.show(sel.value, 'cast');
    });
    rowEl.append(play);
    const apply = el('button', 'fe-mini gold', 'Apply (free)') as HTMLButtonElement;
    const syncApply = (): void => {
      apply.hidden = sel.value === '' || sel.value === bakedPick;
    };
    apply.disabled = !row?.model || animating || finalizing || weaponForging;
    apply.title = !row?.model
      ? 'Build the 3D model first (Step 4)'
      : `Bakes this animation for ${key} alone; spends nothing`;
    apply.addEventListener('click', () => {
      if (sel.value !== '') runAnimate({ [slot]: sel.value });
    });
    rowEl.append(apply);
    const tabsHere = keyTabs();
    tabsHere.style.marginLeft = 'auto';
    rowEl.append(tabsHere);
    sel.addEventListener('change', () => {
      syncApply();
      if (sel.value !== '') animPreview?.show(sel.value, 'cast');
    });
    syncApply();
    panel.append(rowEl);
    panel.append(
      el(
        'p',
        'fe-desc',
        bakedPick === undefined
          ? 'This spell plays the shared cast animation until you give it one of its own.'
          : 'This spell has its own animation; picking another replaces it.',
      ),
    );
    // The cast sound: the school's by default (derived from what the spell
    // does), or one of the palette; a pick plays at once, so it is heard
    // before it is kept. Presentation on the def: autosave carries it.
    const ability = current.abilities[key];
    const soundRow = el('div', 'fe-artrow');
    soundRow.append(el('span', 'fe-desc', 'Sound'));
    const soundSel = el('select', 'fe-select fe-sound') as HTMLSelectElement;
    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = `Auto: the ${castSoundOf({ ...ability, sound: undefined })} school`;
    soundSel.append(auto);
    appendSoundGroups(soundSel, CAST_SOUND_GROUPS);
    soundSel.value = ability.sound ?? '';
    soundSel.disabled = sealed;
    soundSel.addEventListener('change', () => {
      if (soundSel.value === '') ability.sound = undefined;
      else ability.sound = soundSel.value as CastSoundId;
      playCastSfx(castSoundOf(ability));
      refresh();
    });
    const hear = el('button', 'fe-mini', 'Play') as HTMLButtonElement;
    hear.title = 'Hear this cast';
    hear.addEventListener('click', () => playCastSfx(castSoundOf(ability)));
    soundRow.append(soundSel, hear);
    panel.append(soundRow);
    if (!animPreview) animPreview = createAnimPreview();
    panel.append(animPreview.el);
    main.append(panel);
  }

  // The polygons' axes from a stat line: the live polygons and a
  // proposal's read-only twins draw from the same tables. A ranged
  // champion's reach is one more base axis; a melee one's is pinned off.
  const baseAxesOf = (base: ChampionBaseStats): PolyAxis[] => {
    const axes: PolyAxis[] = BASE_AXES.map(({ key, label }) => ({
      key,
      label,
      min: BASE_STAT_BOUNDS[key].min,
      max: BASE_STAT_BOUNDS[key].max,
      value: base[key],
    }));
    if (base.attackRange > RANGED_THRESHOLD) {
      axes.push({
        key: 'attackRange',
        label: 'Reach',
        min: RANGED_MIN,
        max: BASE_STAT_BOUNDS.attackRange.max,
        value: base.attackRange,
      });
    }
    return axes;
  };
  const growthAxesOf = (growth: ChampionGrowth): PolyAxis[] =>
    (Object.keys(GROWTH_BOUNDS) as (keyof ChampionGrowth)[]).map((key) => ({
      key,
      label: GROWTH_LABELS[key] ?? key,
      min: GROWTH_BOUNDS[key].min,
      max: GROWTH_BOUNDS[key].max,
      value: growth[key],
    }));

  // Tab 3, Tuning: the numbers against the power budget.
  function renderTuning(): void {
    // Reforge, first slice: the one number a sealed champion may still
    // move, because melee versus ranged is a feel the creator only
    // discovers in a real match. The server revalidates in full.
    if (isSealed()) {
      const panel = el('div', 'fe-panel');
      panel.append(el('h3', '', 'Reforge: basic attack reach'));
      panel.append(
        el(
          'p',
          'fe-lead',
          'A sealed champion keeps its kit, but its basic attack reach may still move. ' +
            'At 2 or under the champion strikes in melee; above 2 every basic attack ' +
            'fires a bolt. The change must still fit the power budget.',
        ),
      );
      const row = el('div', 'fe-artrow');
      const input = el('input', 'fe-num') as HTMLInputElement;
      input.type = 'number';
      input.min = String(BASE_STAT_BOUNDS.attackRange.min);
      input.max = String(BASE_STAT_BOUNDS.attackRange.max);
      input.step = 'any';
      input.value = String(current.base.attackRange);
      const apply = el('button', 'fe-gen', 'Reforge the reach') as HTMLButtonElement;
      apply.addEventListener('click', () => {
        const v = Number(input.value);
        if (!Number.isFinite(v)) return;
        status.textContent = 'Reforging...';
        void api<{ ok: boolean; melee?: boolean; error?: string }>('/api/forge/reach', {
          id: current.id,
          attackRange: v,
        }).then((r) => {
          if (!r?.ok) {
            status.textContent = r?.error ?? 'reforge failed';
            return;
          }
          current.base.attackRange = v;
          status.textContent = r.melee
            ? 'Reforged: this champion now strikes in melee.'
            : 'Reforged: basic attacks now fire a bolt.';
          void loadDrafts().then(() => renderMain());
        });
      });
      row.append(input, apply);
      panel.append(row);
      main.append(panel);
    }
    const sealed = isSealed();

    // The stat conversation: the kit conversation's sibling. Each answer
    // proposes base stats and growth, fitted to both envelope lines by
    // the server, shown below as read-only polygons next to what moves;
    // nothing touches the live polygons until Apply, and after it the
    // vertices are still the creator's to pull.
    main.append(
      chatPanel<{
        ok: boolean;
        comment?: string;
        base?: ChampionBaseStats;
        growth?: ChampionGrowth;
        raw?: string;
        budget?: { stats: { spend: number; cap: number }; growth: { spend: number; cap: number } };
        fit?: { stats: number; growth: number };
        error?: string;
      }>(statChat, {
        title: 'Stat conversation (AI)',
        lead:
          'Reads your role and kit. Say what body this champion should have ("a tanky ' +
          'frontliner", "faster but frailer", "ranged"); each answer proposes base stats and ' +
          'growth below, fitted to both envelope lines, and nothing touches the polygons ' +
          'until you apply it. Applied stats stay yours to pull.',
        placeholder: 'What body should this champion have?',
        locked: sealed
          ? 'This champion is sealed: its stats are locked. Unseal it (Design tab, ' +
            'animations block) to retune.'
          : null,
        parts: ['base', 'growth'],
        request: (messages, onLine) =>
          ensureSaved().then((ok) =>
            ok
              ? chatStream(
                  '/api/forge/suggest-stats',
                  { id: current.id, def: current, messages },
                  onLine,
                )
              : { ok: false, error: lastSaveError ?? 'the draft could not be saved' },
          ),
        accept: (r) => {
          if (!r?.ok || !r.base || !r.growth || typeof r.raw !== 'string') {
            return { error: r?.error ?? 'the suggestion failed' };
          }
          statProposal = {
            base: r.base,
            growth: r.growth,
            budget: r.budget ?? {
              stats: { spend: 0, cap: ENVELOPES.stats },
              growth: { spend: 0, cap: ENVELOPES.growth },
            },
            fit: r.fit ?? { stats: 1, growth: 1 },
          };
          return { raw: r.raw, bubble: r.comment ? r.comment : 'Here is a stat line.' };
        },
        report: (message) => {
          status.textContent = message;
        },
        rerender: renderMain,
        changed: () => persistChat('stats'),
      }),
    );

    if (statProposal !== null) {
      const p = statProposal;
      const prop = el('div', 'fe-panel');
      prop.append(el('h3', '', 'Proposed stats'));
      const still = { enabled: false, grant: (_key: string, want: number) => want };
      const row = el('div', 'fe-polyrow');
      const baseWrap = el('div', 'fe-polywrap');
      baseWrap.append(
        el(
          'div',
          'fe-step-text',
          `Base stats: ${p.budget.stats.spend} / ${p.budget.stats.cap} of the envelope`,
        ),
      );
      baseWrap.append(statPolygon(baseAxesOf(p.base), { size: 250, ...still }));
      const growthWrap = el('div', 'fe-polywrap');
      growthWrap.append(
        el(
          'div',
          'fe-step-text',
          `Growth per level: ${p.budget.growth.spend} / ${p.budget.growth.cap} of the envelope`,
        ),
      );
      growthWrap.append(statPolygon(growthAxesOf(p.growth), { size: 200, ...still }));
      row.append(baseWrap, growthWrap);
      prop.append(row);
      // What moves, axis by axis, against the polygons as they stand.
      const deltas = el('div', 'fe-deltas');
      const fmt = (v: number): string =>
        Math.abs(v) >= 100 ? String(Math.round(v)) : v.toFixed(2).replace(/\.?0+$/, '');
      const chip = (label: string, from: number, to: number): void => {
        if (Math.abs(to - from) < 0.005) return;
        const c = el('span', `fe-delta ${to > from ? 'up' : 'down'}`);
        c.textContent = `${label} ${fmt(from)} to ${fmt(to)}`;
        deltas.append(c);
      };
      for (const { key, label } of BASE_AXES) chip(label, current.base[key], p.base[key]);
      chip('Reach', current.base.attackRange, p.base.attackRange);
      for (const key of Object.keys(GROWTH_BOUNDS) as (keyof ChampionGrowth)[]) {
        chip(`${GROWTH_LABELS[key] ?? key} per level`, current.growth[key], p.growth[key]);
      }
      if (deltas.childElementCount === 0) {
        deltas.append(el('span', 'fe-step-text', 'Exactly what the polygons already show.'));
      }
      prop.append(deltas);
      prop.append(
        el(
          'p',
          'fe-lead',
          p.base.attackRange > RANGED_THRESHOLD
            ? `Ranged, reach ${fmt(p.base.attackRange)}: basic attacks fire a bolt.`
            : `Melee, reach pinned at ${MELEE_REACH}: strikes up close.`,
        ),
      );
      const fitNotes: string[] = [];
      if (Math.abs(p.fit.stats - 1) >= 0.005) {
        fitNotes.push(
          `base shape ${p.fit.stats > 1 ? 'raised' : 'trimmed'} to ${p.fit.stats.toFixed(2)} ` +
            'times the answer to sit on the stat envelope line',
        );
      }
      if (Math.abs(p.fit.growth - 1) >= 0.005) {
        fitNotes.push(
          `growth ${p.fit.growth > 1 ? 'raised' : 'trimmed'} to ${p.fit.growth.toFixed(2)} ` +
            'times to sit on the growth envelope line',
        );
      }
      if (fitNotes.length > 0) {
        prop.append(el('p', 'fe-desc', `${fitNotes.join('; ')}.`));
      }
      if (!sealed) {
        const apply = el('button', 'fe-gen small', 'Apply these stats (free)') as HTMLButtonElement;
        apply.title = 'Puts these stats on the polygons; nothing is saved until you save';
        apply.addEventListener('click', () => {
          current.base = { ...p.base };
          current.growth = { ...p.growth };
          status.textContent =
            'The proposed stats are on the polygons: pull any vertex to adjust, then save.';
          renderMain();
          refresh();
        });
        prop.append(apply);
      }
      main.append(prop);
    }

    const stats = el('div', 'fe-panel');
    stats.append(el('h3', '', 'Stat polygon'));
    stats.append(
      el(
        'p',
        'fe-lead',
        'Pull a vertex outward to buy a stat, inward to free points. Every point above ' +
          "a floor spends the polygon's own envelope, never the kit's: a vertex stops " +
          'where its envelope runs out, so overspending is impossible and no set of ' +
          'vertices reaches every rail. A proposal from the conversation above lands ' +
          'here whole when you apply it; the vertices stay yours.',
      ),
    );

    // Melee or ranged: an identity choice, not an axis to optimize. A
    // melee champion's reach is pinned off the polygon; a ranged one's
    // reach joins it as one more axis (playtest round 15).
    const ranged = current.base.attackRange > RANGED_THRESHOLD;
    const reachRow = el('div', 'fe-artrow');
    const meleeBtn = el('button', `fe-mini${ranged ? '' : ' on'}`, 'Melee') as HTMLButtonElement;
    const rangedBtn = el('button', `fe-mini${ranged ? ' on' : ''}`, 'Ranged') as HTMLButtonElement;
    meleeBtn.disabled = sealed;
    rangedBtn.disabled = sealed;
    meleeBtn.title = 'Strike up close; reach pinned, off the polygon';
    rangedBtn.title = 'Every basic attack fires a bolt; reach becomes an axis';
    meleeBtn.addEventListener('click', () => {
      if (!ranged) return;
      current.base.attackRange = MELEE_REACH;
      refresh();
      renderMain();
    });
    rangedBtn.addEventListener('click', () => {
      if (ranged) return;
      const granted = grantStat(current, 'base', 'attackRange', 5.5);
      if (granted < RANGED_MIN) {
        status.textContent = 'No budget left for a ranged reach: free some points first.';
        return;
      }
      current.base.attackRange = granted;
      refresh();
      renderMain();
    });
    reachRow.append(
      meleeBtn,
      rangedBtn,
      el(
        'span',
        'fe-step-text',
        ranged
          ? 'Ranged: basic attacks fire a bolt; the reach axis is on the polygon.'
          : `Melee: strikes up close, reach pinned at ${MELEE_REACH}.`,
      ),
    );
    stats.append(reachRow);

    const asNumbers = (obj: unknown): Record<string, number> => obj as Record<string, number>;
    const polyRow = el('div', 'fe-polyrow');
    // Each polygon's caption carries its envelope, live under the drag.
    const caption = (label: string, group: 'stats' | 'growth'): HTMLElement => {
      const cap = el('div', 'fe-step-text', '');
      const sync = (): void => {
        const spend = envelopeSpend(budgetOf(current))[group];
        cap.textContent = `${label}: ${Math.round(spend)} / ${ENVELOPES[group]} of the envelope`;
      };
      sync();
      cap.addEventListener('fe-sync', sync);
      return cap;
    };
    const baseWrap = el('div', 'fe-polywrap');
    const baseCaption = caption('Base stats', 'stats');
    baseWrap.append(baseCaption);
    baseWrap.append(
      statPolygon(baseAxesOf(current.base), {
        enabled: !sealed,
        grant: (key, want) => {
          const g = grantStat(current, 'base', key, want);
          // The reach axis never grants below the ranged floor: better a
          // vertex that refuses to move than a champion silently melee.
          if (key === 'attackRange' && g < RANGED_MIN) return current.base.attackRange;
          asNumbers(current.base)[key] = g;
          hooks.refresh();
          baseCaption.dispatchEvent(new Event('fe-sync'));
          return g;
        },
      }),
    );
    polyRow.append(baseWrap);
    const growthWrap = el('div', 'fe-polywrap');
    const growthCaption = caption('Growth per level', 'growth');
    growthWrap.append(growthCaption);
    growthWrap.append(
      statPolygon(growthAxesOf(current.growth), {
        size: 250,
        enabled: !sealed,
        grant: (key, want) => {
          const g = grantStat(current, 'growth', key, want);
          asNumbers(current.growth)[key] = g;
          hooks.refresh();
          growthCaption.dispatchEvent(new Event('fe-sync'));
          return g;
        },
      }),
    );
    polyRow.append(growthWrap);
    stats.append(polyRow);

    // The one typed field left: body size is free (price zero) and not a
    // power tradeoff, so it stays a plain number.
    const radiusRow = el('div', 'fe-fields');
    radiusRow.append(
      numField(
        'body radius (free)',
        current.base as unknown as Record<string, unknown>,
        'radius',
        BASE_STAT_BOUNDS.radius,
        hooks,
      ),
    );
    stats.append(radiusRow);
    const spend = envelopeSpend(budgetOf(current));
    if (spend.stats > ENVELOPES.stats || spend.growth > ENVELOPES.growth) {
      stats.append(
        el(
          'p',
          'fe-desc',
          `${spend.stats > ENVELOPES.stats ? 'The stat envelope' : 'The growth envelope'} is ` +
            'over its line (a draft from before a tightening): its axes can only come down ' +
            'until it fits.',
        ),
      );
    }
    if (sealed) {
      stats.append(
        el(
          'p',
          'fe-desc',
          'This champion is sealed: the polygon is read-only. Unseal it (Design tab, ' +
            'animations block) to retune; the reach still moves through Reforge above.',
        ),
      );
    }
    main.append(stats);
  }

  function renderMain(): void {
    paintEmbers();
    main.textContent = '';
    stageRows = null;
    if (tab === 'design') renderDesign();
    else if (tab === 'spells') renderSpells();
    else renderTuning();
  }

  renderMain();
  refresh();
  void loadDrafts().then(() =>
    Promise.all([loadArt(), loadAnimations()]).then(() => {
      renderMain();
      refresh();
    }),
  );
  return close;
}
