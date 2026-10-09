// The in-game HUD: ability and sigil bar with cooldowns, hp/mana/xp, status
// chips, gold and clock, keybind hints, inventory, the shop (P), the
// scoreboard (Tab), kill feed, chat and pings, announcements, death and end
// screens, and the Escape menu. Reads the world through IWorld only; content
// data (items, sigils, champions) is data-as-code it may read directly.

import { announceVoice } from '../game/announcer';
import type { PostMatchAction } from '../game/flow';
import { requestGameFullscreen, toggleGameFullscreen } from '../game/fullscreen';
import { pointOnStage, rectOnStage, stageSizeOf } from '../game/match_stage';
import type { MatchCover } from '../game/practice_clock';
import { type LockAnswer, type ScreenRect, turnWallUp, wallFallback } from '../game/rotated_view';
import { getSettings, updateSettings } from '../game/settings';
import { playSfx } from '../game/sfx';
import type { CastTouch } from '../game/touch';
import { followThumbScale, followUiScale, SETTINGS_EVENT } from '../game/ui_scale';
import type { PointsReason } from '../net/protocol';
import { ownGraceFloor, type RoyaleNote } from '../net/royale_client';
import type { RoyaleResult } from '../net/royale_wire';
import { trackStep } from '../net/stats';
import { aspectColor, WRATH_COLOR } from '../render/aspect_colors';
import { championPortraitUrl } from '../render/portraits';
import type { Status } from '../sim/combat/status';
import { CAMPS } from '../sim/content/camps';
import {
  CONSUMABLE_LIST,
  DRAUGHT_CARRY,
  effectiveItemCost,
  ITEM_LIST,
  ITEMS,
  mayCarryDraught,
} from '../sim/content/items';
import { ASPECT_IDS, ASPECTS, type AspectId, CREATURES } from '../sim/content/rings';
import { SIGILS } from '../sim/content/sigils';
import { draughtLeft } from '../sim/draught';
import type { FavorStacks } from '../sim/favors';
import { withinFountain } from '../sim/fountain';
import type { RingClock } from '../sim/rings';
import type { RoyaleVariant } from '../sim/royale/types';
import {
  BASIC_MAX_RANK,
  effectiveRank,
  MAX_LEVEL,
  ULT_MAX_RANK,
  ULT_RANK_LEVELS,
  xpForNext,
} from '../sim/stats';
import { BOON_DAMAGE_PER_STACK } from '../sim/team_buffs';
import { otherTeam } from '../sim/teams';
import type { AbilityKey, TeamId, Vec2 } from '../sim/types';
import type { Unit } from '../sim/unit';
import type { IWorld } from '../world_api';
import { abilityIconUrl, passiveIconUrl, sigilIconUrl } from './ability_icons';
import { accountOffer, OFFER_CALL } from './account_offer';
import {
  AuraWatch,
  boonChipFace,
  type ChipFace,
  favorChipFace,
  graceWaitChip,
  statusChip,
  statusKey,
  wrathChipFace,
} from './chip_text';
import { COMPACT_ROW_GAP, COMPACT_SCALE, compactTapsCss } from './compact_taps';
import { setText } from './dom_write';
import {
  buildFeedbackBox,
  FEEDBACK_ASK,
  type FeedbackBox,
  type FeedbackWhere,
  NUDGE_START,
  type NudgeState,
  nudgeCall,
  nudgeVisible,
  stepNudge,
} from './feedback_box';
import {
  hideSteps,
  STEPS_HIDE,
  STEPS_TITLE,
  type StepsInput,
  type StepsState,
  type StepsView,
  stepLine,
  stepSteps,
  stepsFinished,
  stepsStart,
} from './first_steps';
import { HINTS_START, type HintsClock, hintsHold, stepHints } from './hints_fade';
import { buildLadderBox, type LadderBox } from './ladder_box';
import {
  closeLaneCard,
  type GuideMode,
  LANE_CARD_START,
  type LaneCardState,
  type LaneGuide,
  laneCall,
  laneCardAhead,
  laneCardVisible,
  stepGuide,
  stepLaneCard,
} from './lane_guide';
import { thumbClusterCss } from './thumb_cluster';

interface ChipLook {
  border: string;
  color: string;
  background: string;
}

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
import {
  creatureName,
  favorChips,
  favorClaimText,
  objectiveLine,
  wrathChipText,
} from './objective_line';
import { firstPointsText, pointsWord, popText } from './points_text';
import { BURR_COLOR, burrWashLine } from './royale_burr';
import { GoalTrack } from './royale_goal';
import { RoyaleHud, type RoyaleKill } from './royale_hud';
import {
  ANNOUNCE_TOP_PX,
  ANNOUNCE_Z,
  announceMaxWidthCss,
  STEPS_CLEAR_MIDDLE_PX,
  STEPS_LEFT_PX,
  STEPS_MAX_W_PX,
  STEPS_TOP_PX,
} from './royale_layout';
import { RoyaleLife, SeenChampions } from './royale_life';
import { respawnTally, royaleSting } from './royale_result';
import {
  RETURN_WASH_LINE_VW,
  RETURN_WASH_PHONE_BOTTOM_PX,
  RETURN_WASH_RIGHT_VW,
  returnGlobeOn,
  returnHint,
} from './royale_return';
import {
  hideRoyaleSteps,
  type RoyaleStepsState,
  royaleStepLine,
  royaleStepsFinished,
  royaleStepsStart,
  stepRoyaleSteps,
} from './royale_steps';
import { LOOT_EMPTY, LOOT_LABEL, royaleHints, royaleRecap } from './royale_text';
import { renderScoreboardTeam } from './scoreboard_table';
import { buildSettingsPanel } from './settings_panel';
import { shopSections } from './shop_sections';
import { suggestedItem } from './shop_suggestion';
import { rankable } from './slot_tap';
import { teamLook } from './team_look';
import { TeamScore } from './team_score';
import { attachTooltip, hideTooltip, LONG_PRESS_MS } from './tooltips';
import { TURN_ASK, TURN_LOCK_LINE } from './turn_ask';

const KEY_TINTS: Readonly<Record<string, [string, string]>> = {
  Q: ['#7a2f1f', '#c96a3a'],
  W: ['#1f4a7a', '#3a8ac9'],
  E: ['#2f6a2a', '#5aa53a'],
  R: ['#5a2a7a', '#9a5ac9'],
  D: ['#6a5a1f', '#c9a53a'],
  F: ['#6a5a1f', '#c9a53a'],
};

const KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];
// The recall key's mark: a plain house, drawn here.
function recallMark(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M12 3 2.5 11.5H5.5V21H10.5V15H13.5V21H18.5V11.5H21.5Z');
  svg.appendChild(path);
  return svg;
}

const TEAM_TEXT_COLORS = ['#9dbcf5', '#f5a3a3'];
// How near an enemy minion or champion stands for the first steps to speak
// of it (ui/first_steps.ts): the lane's reach, a little more than a spell's.
const STEPS_MINION_NEAR_M = 14;
const STEPS_CHAMPION_NEAR_M = 11;
const TEAM_PORTRAIT_COLORS = [0x4a7dd6, 0xd65c5c];

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
.hud-statuses { display: flex; gap: 4px; min-height: 24px; justify-content: center; flex-wrap: wrap; }
/* A chip: a short word ("Stun", "Boost", "Airborne"), the whole seconds
   or the number under it (ui/chip_text.ts), as wide as its word. */
.hud-chip {
  position: relative; min-width: 26px; height: 24px; padding: 0 5px; border-radius: 5px; flex: none;
  background: #3d3312; border: 1px solid #8a6d2c; color: #f0dfae;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  font-size: 9.5px; font-weight: 800; line-height: 1; pointer-events: auto; cursor: default;
  white-space: nowrap;
}
.hud-chip-sub { font-size: 8px; font-weight: 700; opacity: 0.9; margin-top: 1px; }
/* A phone draws the bottom block scaled down: the words keep a size to
   read there. */
.hud.compact .hud-chip { height: 30px; font-size: 13px; padding: 0 6px; }
.hud.compact .hud-chip-sub { font-size: 10.5px; }
.hud-chip-tip {
  display: none; position: absolute; bottom: 30px; left: 50%; transform: translateX(-50%);
  white-space: nowrap; background: #14190d; border: 1px solid #6e5a24; color: #e8dfb4;
  font-size: 11px; font-weight: 600; padding: 4px 8px; border-radius: 4px;
  pointer-events: none; z-index: 20;
}
.hud-chip:hover .hud-chip-tip, .hud-chip.vhover .hud-chip-tip { display: block; }
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
/* The recall's key (desktop): a house on a slot like the spells', gold
   while a first step names it. */
.hud-slot.recall { cursor: pointer; border-color: #6e5a24; }
.hud-slot.recall svg { width: 24px; height: 24px; fill: #e8dfb4; }
.hud-slot.recall:hover { border-color: #c9a84a; }
.hud-slot.recall.hint { border-color: #ffd94a;
  animation: hud-recall-hint 0.9s ease-in-out infinite alternate; }
@keyframes hud-recall-hint {
  from { box-shadow: 0 0 0 1px #ffd94a, 0 0 6px rgba(255, 217, 74, 0.3); }
  to { box-shadow: 0 0 0 2px #ffd94a, 0 0 18px rgba(255, 217, 74, 0.75); }
}
.hud-slot-key {
  position: absolute; right: 3px; top: 1px;
  font-size: 11px; font-weight: 800; color: #f2f6e4; text-shadow: 0 1px 3px #000;
}
.hud-slot-cd {
  position: absolute; inset: 0; border-radius: inherit; background: rgba(0,0,0,0.72);
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
.hud-inv-slot.waiting { opacity: 0.45; filter: grayscale(1); }
.hud-hints {
  position: absolute; left: 12px; bottom: 12px; font-size: 10px; color: #93a87c;
  text-shadow: 0 1px 2px #000; max-width: 240px; line-height: 1.6;
}
/* The shop reads as a carved war-chest lid: a bronze outer frame, a moss-dark
   field inside it, and gold reserved for what costs or grants gold. Tier is
   carried by the card frame itself so a glance sorts components from
   legendaries without reading a word. */
.hud-shop {
  position: absolute; left: 50%; top: calc(4 * var(--vh, 1vh)); transform: translateX(-50%);
  width: min(1180px, calc(100 * var(--vw, 1vw) - 220px)); min-width: 700px;
  max-height: calc(88 * var(--vh, 1vh));
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
/* The item that suits the champion (ui/shop_suggestion.ts): it glows under
   a gold tag, affordable or not, so a newcomer knows what to buy or to
   save for. */
.hud-card.suggested { border-color: #ffd94a;
  animation: hud-suggest-glow 1.6s ease-in-out infinite alternate; }
.hud-card.suggested::before {
  content: 'Suggested'; position: absolute; top: -9px; left: 50%; transform: translateX(-50%);
  z-index: 2; padding: 1px 7px; border-radius: 999px; white-space: nowrap;
  background: #ffd94a; color: #241a08; font-size: 9.5px; font-weight: 800;
  letter-spacing: 0.6px; text-transform: uppercase;
}
.hud-card.suggested.cant { opacity: 0.8; }
@keyframes hud-suggest-glow {
  from { box-shadow: 0 0 0 2px #ffd94a, 0 0 8px rgba(255, 217, 74, 0.3); }
  to { box-shadow: 0 0 0 2px #ffd94a, 0 0 24px rgba(255, 217, 74, 0.7); }
}
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
/* The line at the start of a match that says the feedback box exists
   (ui/feedback_box.ts): under the announcements, quiet, and a door, so the
   whole of it opens the menu where the box is. */
/* The lane card (ui/lane_guide.ts; ADR 0026) shares the slot and the look,
   and comes first: the seat's lane in gold, and a tap that walks there.
   Both keep clear of a phone's notch, rounded corners and camera cut-out
   (the safe area; zero on a screen without them). */
.hud-nudge, .hud-lane-card {
  position: absolute; top: calc(150px + env(safe-area-inset-top, 0px));
  left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px; pointer-events: auto; cursor: pointer;
  max-width: min(
    520px, calc(90 * var(--vw, 1vw)),
    calc(100 * var(--vw, 1vw) - 16px - 2 * max(env(safe-area-inset-left, 0px), env(safe-area-inset-right, 0px)))
  );
  padding: 8px 10px 8px 14px; border-radius: 10px;
  border: 1px solid #8a7430; background: rgba(30, 26, 12, 0.9); color: #e6dcb8;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.55); text-shadow: none;
  opacity: 0; visibility: hidden; transition: opacity 0.4s, visibility 0.4s;
}
.hud-nudge.on, .hud-lane-card.on { opacity: 1; visibility: visible; }
.hud-nudge:hover, .hud-lane-card:hover { border-color: #c9a84a; }
.hud-nudge-words b, .hud-lane-words b { display: block; font-size: 13px; color: #f2e6c0; }
.hud-nudge-words span, .hud-lane-words span {
  display: block; margin-top: 1px; font-size: 12px; color: #c9bd93;
}
.hud-lane-words b { color: #ffd94a; letter-spacing: 0.6px; text-transform: uppercase; }
.hud-lane-card.still { cursor: default; }
.hud-nudge-close, .hud-lane-close {
  flex: none; width: 26px; height: 26px; border-radius: 50%; cursor: pointer;
  border: 1px solid #6e5a24; background: transparent; color: #c9bd93;
  font-size: 15px; line-height: 1; padding: 0;
}
.hud-nudge-close:hover, .hud-lane-close:hover { color: #fff3cf; border-color: #c9a84a; }
.hud.compact .hud-nudge, .hud.compact .hud-lane-card {
  top: calc(96px + env(safe-area-inset-top, 0px)); padding: 6px 8px 6px 12px;
}
.hud.compact .hud-nudge-words b, .hud.compact .hud-lane-words b { font-size: 12px; }
.hud.compact .hud-nudge-words span, .hud.compact .hud-lane-words span { font-size: 11px; }
/* The first steps (ui/first_steps.ts): one line for a newcomer in the slot
   of the lane card and the feedback line, under them while one is up, gold
   edged on the left like a margin note, and the button that hides it. */
.hud-steps {
  position: absolute; top: calc(150px + env(safe-area-inset-top, 0px));
  left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 12px; pointer-events: auto;
  max-width: min(
    560px, calc(92 * var(--vw, 1vw)),
    calc(100 * var(--vw, 1vw) - 16px - 2 * max(env(safe-area-inset-left, 0px), env(safe-area-inset-right, 0px)))
  );
  padding: 9px 10px 9px 14px; border-radius: 10px;
  border: 1px solid #8a7430; border-left: 4px solid #e8c46c;
  background: rgba(12, 16, 26, 0.93); color: #e6dcb8;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.55); text-shadow: none;
  opacity: 0; visibility: hidden; transition: opacity 0.4s, visibility 0.4s, top 0.3s;
}
.hud-steps.on { opacity: 1; visibility: visible; }
.hud-steps.below { top: calc(206px + env(safe-area-inset-top, 0px)); }
.hud-steps-words b { display: block; font-size: 10.5px; font-weight: 800; letter-spacing: 1.4px;
  text-transform: uppercase; color: #c9a84a; }
.hud-steps-words span { display: block; margin-top: 2px; font-size: 14px; font-weight: 600;
  line-height: 1.35; color: #f2e6c0; }
.hud-steps-hide {
  flex: none; padding: 5px 10px; border-radius: 999px; cursor: pointer; white-space: nowrap;
  border: 1px solid #6e5a24; background: transparent; color: #c9bd93;
  font-size: 11px; font-weight: 700;
}
.hud-steps-hide:hover { color: #fff3cf; border-color: #c9a84a; }
.hud.compact .hud-steps { top: calc(96px + env(safe-area-inset-top, 0px));
  padding: 6px 8px 6px 11px; gap: 8px; }
.hud.compact .hud-steps.below { top: calc(146px + env(safe-area-inset-top, 0px)); }
.hud.compact .hud-steps-words span { font-size: 12px; }
.hud.overlay-open .hud-steps { visibility: hidden; }
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
  width: min(1020px, calc(96 * var(--vw, 1vw))); max-height: calc(86 * var(--vh, 1vh));
  overflow-y: auto;
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
  position: absolute; top: calc(8px + var(--safe-top, env(safe-area-inset-top, 0px)));
  left: 50%; transform: translateX(-50%);
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
  position: absolute; top: calc(12px + var(--safe-top, env(safe-area-inset-top, 0px)));
  right: calc(12px + var(--safe-right, env(safe-area-inset-right, 0px))); text-align: right;
  background: rgba(14, 20, 9, 0.85); border: 1px solid #3a4f28; border-radius: 6px;
  padding: 5px 12px; font-size: 15px; font-weight: 800; color: #e8f5c8;
  text-shadow: 0 1px 2px #000; pointer-events: auto;
}
.hud-kda .cs { display: block; font-size: 11px; font-weight: 600; color: #93a87c; }
/* The player's points on the ladder of every human (ADR 0027): inside the
   K/D/A box and hung off its left edge, so the two share the corner
   whatever the K/D/A reads. The total banked, and under it a pop as points
   land. Only in a match that scores, from its first points. It takes no
   pointer, so the corner's tooltip stays the K/D/A's. */
.hud-points {
  position: absolute; top: -1px; right: calc(100% + 8px); display: none;
  padding: 5px 12px; border-radius: 6px; border: 1px solid #8a7430;
  background: rgba(30, 26, 12, 0.88); color: #ffe08a; white-space: nowrap;
  pointer-events: none; font-variant-numeric: tabular-nums;
}
.hud-points.on { display: block; }
.hud-points .label { display: block; font-size: 11px; font-weight: 600; color: #c9ad62; }
.hud-points-pop {
  position: absolute; top: calc(100% + 5px); right: 0; font-size: 14px; font-weight: 800;
  color: #ffd94a; text-shadow: 0 1px 3px #000, 0 0 10px rgba(255, 200, 80, 0.45);
  opacity: 0; white-space: nowrap;
}
.hud-points-pop.on { animation: hud-points-pop 1.6s ease-out forwards; }
@keyframes hud-points-pop {
  0% { opacity: 0; transform: translateY(6px); }
  12% { opacity: 1; transform: translateY(0); }
  70% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-4px); }
}
.hud.compact .hud-points { padding: 4px 9px; }
/* A phone's minimap stands right under the corner (the thumb controls'
   layout), so there the pop comes out to the left of the box. */
.hud.compact .hud-points-pop { top: 11px; right: calc(100% + 6px); font-size: 12.5px; }
/* Informational wash: it must never swallow clicks meant for the shop,
   which stays usable while dead. Its own buttons opt back in. */
.hud-overlay {
  position: absolute; inset: 0; display: none; pointer-events: none;
  align-items: center; justify-content: center; flex-direction: column;
  background: rgba(0, 0, 0, 0.45); text-shadow: 0 2px 8px #000; z-index: 10;
}
.hud-overlay.open { display: flex; }
/* The pause menu and the end screen stand over everything in the HUD,
   the shop and the turn wall included: Back on a phone held upright opens
   the pause menu, and it used to open under the wall, out of reach. And
   they take every click, unlike the wash: the settings in the pause menu
   took none, and a click on one fell through to the match and walked the
   champion there (the maintainer, 2026-10-02, ticking the first steps). */
.hud-overlay.modal { z-index: 41; pointer-events: auto; }
.hud-overlay-title { font-size: 52px; font-weight: 800; letter-spacing: 2px; }
.hud-overlay-sub { font-size: 16px; margin-top: 6px; }
/* A Respawn death's life line, under the subtitle (ui/royale_life.ts). */
.hud-overlay-life { font-size: 14px; margin-top: 6px; color: #e6dcb8;
  font-variant-numeric: tabular-nums; }
/* Who carries the Burr of a Respawn death, under the life line
   (ui/royale_burr.ts): a thorn's red, the next life's target. */
.hud-overlay-burr { font-size: 15px; font-weight: 700; margin-top: 8px; color: ${BURR_COLOR};
  text-shadow: 0 1px 4px #000; }
/* The Respawn wait's globe (ui/royale_return.ts): the wash's lines move
   left of the middle, clear of the globe the camera sets on the right
   (render/planet_drop.ts RETURN_GLOBE_RIGHT) and of the Graft cards over
   the top, the shade thins toward the globe, and its line says what a tap
   or a click on it does. */
.hud-overlay.returning { padding-right: ${RETURN_WASH_RIGHT_VW}vw;
  background: linear-gradient(90deg, rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.32) 45%,
    rgba(0, 0, 0, 0.06) 70%); }
.hud-overlay.returning > * { max-width: ${RETURN_WASH_LINE_VW}vw; text-align: center;
  text-wrap: balance; }
.hud-overlay-hint { font-size: 15px; font-weight: 700; margin-top: 8px; color: #ffe3a0; }
/* The thumb controls stand down meanwhile: their box under the right thumb
   took the tap meant for the globe, and a dead champion casts nothing. */
.hud.thumbs.wait-globe .hud-slots { visibility: hidden; }
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
  width: min(1020px, calc(96 * var(--vw, 1vw))); max-height: calc(58 * var(--vh, 1vh));
  overflow-y: auto;
  display: flex; flex-direction: column; gap: 14px; pointer-events: auto;
  text-shadow: none;
  scrollbar-width: thin; scrollbar-color: #6e5a24 #10160c;
}
.hud-end-btns { display: flex; gap: 12px; }
/* The moment right after a match is the one moment a player is most likely
   to want the next one, so this is where the server is offered. Muted, so
   it never competes with Play again. */
.hud-end-join { pointer-events: auto; margin-top: 12px; font-size: 13px; color: #9fb089; }
/* A phone is 390 tall in the landscape the game puts it in, and the end
   screen carries a title, a result, the account offer, the whole
   scoreboard, two buttons and the feedback box. It never fitted; adding
   the box made it obvious, with the field and its button hanging off the
   bottom edge where no finger could reach them. So on a touchscreen the
   two modal overlays start at the top and scroll, everything in them
   comes down a size, and the touch bar on the edge stands down while one
   is up, the way it does for the shop. */
.hud.compact .hud-overlay.modal {
  justify-content: flex-start; overflow-y: auto; pointer-events: auto;
  padding: 8px 10px 14px; gap: 2px;
}
/* A scrolling column must not squeeze what it holds: without this the
   scoreboard, which is a flex child that may shrink, was crushed to its
   first heading while the overlay reported nothing to scroll. */
.hud.compact .hud-overlay.modal > * { flex: none; }
.hud.compact .hud-end-card { max-height: none; margin-top: 8px; padding: 8px 10px; gap: 8px; }
.hud.compact .hud-overlay-title { font-size: 26px; letter-spacing: 1px; }
.hud.compact .hud-overlay-sub { font-size: 12.5px; margin-top: 2px; }
.hud.compact .hud-overlay-life { font-size: 11.5px; margin-top: 3px; }
/* A phone: the Burr's line in two short lines, clear of the feed at the
   right, and the wash raised by their height, clear of the notices under
   it (ui/royale_layout.ts compactNotesBox). */
.hud.compact .hud-overlay-burr { font-size: 11.5px; margin-top: 4px; max-width: 250px;
  line-height: 1.2; text-wrap: balance; }
.hud.compact .hud-overlay:not(.returning):has(> .hud-overlay-burr:not([hidden])) { padding-bottom: 36px; }
.hud.compact .hud-overlay-hint { font-size: 12.5px; margin-top: 3px; }
.hud.compact .hud-overlay.returning { justify-content: flex-end;
  padding-bottom: ${RETURN_WASH_PHONE_BOTTOM_PX}px; }
.hud.compact .hud-overlay.returning .hud-overlay-title { font-size: 20px; }
.hud.compact .hud-end-rating { font-size: 13px; margin-top: 2px; min-height: 0; }
.hud.compact .hud-end-join { margin-top: 8px; font-size: 11.5px; }
.hud.compact .hud-menu-btn { margin-top: 6px; padding: 8px 18px; font-size: 13px; }
.hud.compact .hud-end-offer { padding: 8px 10px; gap: 8px; }
.hud.compact .hud-end-offer b { font-size: 13px; }
.hud.compact .hud-end-offer span { font-size: 11.5px; }
.hud.overlay-open ~ .touchbar { display: none; }

/* The feedback box (ui/feedback_box.ts), on the end screen and in the
   pause menu: the two moments a player is about to stop. It reads as a
   person asking, not as a form, so it is one line of words, one field and
   one button, and leaving it alone costs nothing. */
.hud-feedback {
  pointer-events: auto; margin-top: 14px; width: min(520px, calc(86 * var(--vw, 1vw)));
  border: 1px solid #4a5c34; border-radius: 10px; padding: 12px 14px;
  background: rgba(20, 30, 12, 0.72); text-align: left;
}
.hud-feedback-words b { display: block; font-size: 14px; color: #e8f0d4; }
.hud-feedback-words span { display: block; margin-top: 2px; font-size: 13px; color: #a8bd88; }
.hud-feedback-row { display: flex; gap: 8px; align-items: stretch; margin-top: 10px; }
/* An author rule for display beats the browser's own [hidden], so the row
   says it again: without this the field stayed on screen under the thank
   you once the line had been sent. */
.hud-feedback-row[hidden], .hud-feedback-words[hidden], .hud-feedback-thanks[hidden] {
  display: none;
}
.hud-feedback-field {
  flex: 1; min-width: 0; resize: none; border-radius: 7px;
  border: 1px solid #466030; background: #10160c; color: #e4f0cc;
  font: inherit; font-size: 13px; line-height: 1.4; padding: 8px 10px;
}
.hud-feedback-field:focus { outline: none; border-color: #7ca050; }
.hud-feedback-field::placeholder { color: #6f8456; }
.hud-feedback-row .hud-menu-btn { margin: 0; flex: none; align-self: stretch; }
.hud-feedback-thanks { font-size: 13px; color: #b6cc92; }
/* On a phone it is the last thing on a screen that is already full, so it
   takes as little of it as it can and still be typed into. */
.hud.compact .hud-feedback {
  margin-top: 8px; padding: 8px 10px; width: min(520px, calc(94 * var(--vw, 1vw)));
}
.hud.compact .hud-feedback-words b { font-size: 12.5px; }
.hud.compact .hud-feedback-words span { font-size: 11.5px; }
.hud.compact .hud-feedback-row { margin-top: 6px; gap: 6px; }
.hud.compact .hud-feedback-field { font-size: 12px; padding: 6px 8px; line-height: 1.35; }
.hud.compact .hud-feedback-row .hud-menu-btn { margin-top: 0; padding: 8px 14px; font-size: 12.5px; }
.hud.compact .hud-feedback-thanks { font-size: 12px; }
.hud-end-join a { color: #cbd9b4; }
.hud-end-rating { font-size: 15px; font-weight: 700; margin-top: 4px; min-height: 18px; }
/* The ladder box (ui/ladder_box.ts), on the end screen and in the pause
   menu of a match that scores: where the player stands on the ladder of
   every human, in gold like the account offer, and a Guest's name. */
.hud-ladder {
  pointer-events: auto; margin: 12px 0 8px; width: min(520px, 90vw); box-sizing: border-box;
  padding: 10px 14px; border-radius: 10px; border: 1px solid #8a7430;
  background: rgba(30, 26, 12, 0.92); text-align: left; text-shadow: none; color: #e6dcb8;
}
.hud-ladder[hidden], .hud-ladder-row[hidden] { display: none; }
.hud-ladder-line { display: block; font-size: 15px; color: #ffe08a; }
.hud-ladder-earned { margin-left: 8px; color: #8fd06a; white-space: nowrap; }
.hud-ladder-hint { display: block; margin-top: 2px; font-size: 12.5px; color: #c9bd93; }
.hud-ladder-row { display: flex; gap: 8px; margin-top: 8px; align-items: stretch; }
.hud-ladder-field {
  flex: 1; min-width: 0; border-radius: 7px; border: 1px solid #8a7430; background: #16120a;
  color: #f2e6c0; font: inherit; font-size: 13px; padding: 7px 10px;
}
.hud-ladder-field:focus { outline: none; border-color: #c9a84a; }
.hud-ladder-row .hud-menu-btn {
  margin: 0; flex: none; border-color: #8a7430; background: #3a3014; color: #f2e6c0;
}
.hud-ladder-row .hud-menu-btn:hover { border-color: #c9a84a; }
.hud-ladder-status { font-size: 12.5px; }
.hud-ladder-status.ok, .hud-ladder-status.bad { margin-top: 6px; }
.hud-ladder-status.ok { color: #8fd06a; }
.hud-ladder-status.bad { color: #f0a090; }
.hud.compact .hud-ladder { margin-top: 8px; padding: 8px 10px; width: min(520px, 94vw); }
.hud.compact .hud-ladder-line { font-size: 13px; }
.hud.compact .hud-ladder-hint { font-size: 11.5px; }
.hud.compact .hud-ladder-row { margin-top: 6px; gap: 6px; }
.hud.compact .hud-ladder-field { font-size: 12px; padding: 6px 8px; }
.hud.compact .hud-ladder-row .hud-menu-btn { padding: 7px 14px; font-size: 12.5px; }
/* The account offer (ui/account_offer.ts), above the table and in gold:
   the one thing on this screen that asks for a decision, made in the
   visitor's own numbers. Absent for an account. */
.hud-end-offer {
  pointer-events: auto; margin-top: 12px; padding: 10px 16px; border-radius: 8px;
  border: 1px solid #8a7430; background: rgba(30, 26, 12, 0.92); text-shadow: none;
  display: none; align-items: center; gap: 16px;
  width: min(1020px, calc(96 * var(--vw, 1vw)));
  box-sizing: border-box; color: #e6dcb8;
}
.hud-end-offer.open { display: flex; }
.hud-end-offer-words { flex: 1; min-width: 0; }
.hud-end-offer b { display: block; font-size: 15px; color: #f2e6c0; }
.hud-end-offer span { display: block; margin-top: 2px; font-size: 12.5px; line-height: 1.35; color: #c9bd93; }
.hud-end-offer .hud-menu-btn {
  margin: 0; border-color: #8a7430; background: #3a3014; color: #f2e6c0; white-space: nowrap;
}
.hud-end-offer .hud-menu-btn:hover { border-color: #c9a84a; }
/* The battle royale (ADR 0031, ui/royale_hud.ts) has no gold, no shop,
   no recall, no lanes, no towers and no teams: what would say so stands
   down, and its own layer takes the top of the screen. */
.hud.royale .hud-teamscore, .hud.royale .hud-meta, .hud.royale .hud-lane-card,
.hud.royale .hud-kda .cs, .hud.royale .hud-feed, .hud.royale .hud-shop, .hud.royale .hud-score,
.hud.royale .hud-gold, .hud.royale .hud-slot.recall {
  display: none; }
/* The bag as loot: a gold word ahead of it, the empty places drawn as
   places to fill, and the pieces held edged in gold. */
.hud-inv-label { align-self: center; margin-right: 4px; font-size: 9.5px; font-weight: 800;
  letter-spacing: 1.4px; text-transform: uppercase; color: #c9a84a; text-shadow: 0 1px 2px #000; }
.hud.royale .hud-inv-slot { background: rgba(10, 12, 20, 0.55); border: 1px dashed #5a4c28; }
.hud.royale .hud-inv-slot.full { border: 1px solid #b8963f; background-color: #17140a;
  box-shadow: 0 0 6px rgba(232, 196, 108, 0.25); }
.hud.royale.br-dropping .hud-nudge, .hud.royale.br-dropping .hud-steps { visibility: hidden; }
/* On a desktop the first steps stand small at the top left, out of the
   middle where the first fight is read (the card covered it at 960x540);
   on a phone they keep their band and fold while a fight is on
   (ui/royale_steps.ts foldForFight). */
.hud.royale:not(.compact) .hud-steps, .hud.royale:not(.compact) .hud-steps.below {
  left: calc(${STEPS_LEFT_PX}px + var(--safe-left, env(safe-area-inset-left, 0px)));
  top: calc(${STEPS_TOP_PX}px + env(safe-area-inset-top, 0px)); transform: none;
  max-width: min(${STEPS_MAX_W_PX}px, calc(50% - ${STEPS_CLEAR_MIDDLE_PX}px));
  flex-direction: column; align-items: flex-start; gap: 6px; padding: 7px 10px 8px 12px; }
.hud.royale:not(.compact) .hud-steps-words span { font-size: 13px; }
/* The points' pop comes out to the left of the box, as on a phone: under
   it stands the battle royale's feed, and "+5 assist" fell under its
   first line, "+1 cache" on its fold. */
.hud.royale .hud-points-pop { top: 11px; right: calc(100% + 6px); }
/* The battle royale's announcement stands over the wash of a death (SLAIN
   dimmed "Two Seedfalls have landed"), under the modal screens; on a
   desktop it keeps between the first steps' card and the feed, wrapping
   rather than running under the feed (ui/royale_layout.ts announceBox:
   at 960x540 "You took down Rushlantern" was cut to "Rushlanterr"). */
.hud.royale .hud-announce { top: ${ANNOUNCE_TOP_PX}px; z-index: ${ANNOUNCE_Z}; }
.hud.royale:not(.compact) .hud-announce { width: max-content; max-width: ${announceMaxWidthCss()};
  text-align: center; text-wrap: balance; line-height: 1.2; }
.hud.compact.royale .hud-announce { top: 70px; }
/* Compact mode (touchscreens): the desktop sizes swallow a phone screen, so
   the whole bottom block scales down, the chat goes (there is no way to type
   in a match on a phone anyway; pings still flash on the map), and the hints
   shrink and fade out once read. */
.hud.compact .hud-bottom {
  bottom: calc(4px + env(safe-area-inset-bottom, 0px)); gap: ${COMPACT_ROW_GAP}px;
  transform: translateX(-50%) scale(${COMPACT_SCALE}); transform-origin: bottom center;
}
/* The tap to walk's slots, level-up marks and close buttons stay their
   size to look at and are tapped through areas a finger wide once the
   block is scaled: numbers in src/ui/compact_taps.ts, where a test keeps
   the areas clear of each other. */
${compactTapsCss()}
.hud.compact .hud-chat { display: none; }
.hud.compact .hud-announce { font-size: 20px; top: 62px; }
.hud.compact .hud-spot { font-size: 32px; top: 96px; letter-spacing: 2px; }
.hud.compact .hud-spot.top { font-size: 44px; letter-spacing: 3px; }
/* A coach seat's bar (ui/coach_bar.ts) holds the top left on a phone and
   leaves on the stage where the feed reads clear of it. */
.hud.compact .hud-feed {
  font-size: 11px; left: calc(12px + var(--safe-left, env(safe-area-inset-left, 0px)));
  top: var(--coach-feed-top, 12px);
}
/* With the thumbs the touch bar (ui/touch_bar.ts) holds the left edge, and
   the feed ran down over its Menu and Shop buttons: it starts past the
   column, where the coach bar starts too. */
.hud.thumbs .hud-feed { left: calc(84px + var(--safe-left, env(safe-area-inset-left, 0px))); }
.hud.compact .hud-hints {
  font-size: 9px; max-width: 170px; line-height: 1.45;
  left: calc(12px + env(safe-area-inset-left, 0px));
  bottom: calc(12px + env(safe-area-inset-bottom, 0px));
}
/* Faded once read, and read only while nothing covered it: the clock is
   ui/hints_fade.ts, not a delay here, since a delay counted the seconds
   the opening shop and the turn wall stood over it. */
.hud-hints.faded { animation: hud-hints-fade 1s forwards; }
@keyframes hud-hints-fade { to { opacity: 0; visibility: hidden; } }
/* The thumb controls (CONTEXT.md: Thumb stick), the whole bottom of a
   phone's screen. The cluster: the attack button at the corner, Q W E R
   on one arc round it from the left to straight above (an ellipse, wider
   than tall, so the ultimate at the top stays in the lower half of the
   screen), the two sigils further left at the arc's foot; round,
   finger-sized, each placed by its key, nothing else in the corner. The
   level-up mark sits on the slot's shoulder rather than floating over
   it. The whole cluster scales with the phone's height (--thumb-scale,
   ui_scale.ts) from its bottom right corner; the minimap moves to the
   top for it. The bar with the bars and the items slides left of the
   middle so the two never meet on a narrow phone. The sizes and places
   are numbers in src/ui/thumb_cluster.ts, where a test keeps every
   circle clear of every other and a finger wide; only the look is
   written here. The corner is the safe area's (a phone's notch and
   rounded corners and the home bar; zero on a screen without them). */
.hud.thumbs .hud-slots {
  position: absolute; display: block;
  right: var(--safe-right, env(safe-area-inset-right, 0px));
  bottom: var(--safe-bottom, env(safe-area-inset-bottom, 0px));
  transform: scale(var(--thumb-scale, 1)); transform-origin: 100% 100%;
}
.hud.thumbs .hud-slot {
  position: absolute; border-radius: 50%;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.55); font-size: 15px;
  /* A slide on a slot is an aim; without this the browser takes the
     moving finger for a scroll and cancels the pointer under it. */
  touch-action: none;
}
.hud.thumbs .hud-slot-key { font-size: 9px; }
.hud.thumbs .hud-slot-up { font-size: 17px; line-height: 20px; border-radius: 50%; }
.hud.thumbs .hud-attack {
  position: absolute; border-radius: 50%;
  border: 2px solid #c9a84a; background: rgba(60, 40, 12, 0.85); color: #f0d890;
  display: flex; align-items: center; justify-content: center; letter-spacing: 1px;
  font-size: 14px; font-weight: 800; pointer-events: auto; touch-action: none;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.55);
}
.hud.thumbs .hud-attack:active { background: rgba(120, 80, 20, 0.95); }
${thumbClusterCss()}
.hud.thumbs .hud-bottom {
  left: 40%; bottom: calc(2px + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%) scale(0.62);
}
.hud.thumbs .hud-meta {
  max-width: 420px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.hud.thumbs .hud-hints {
  max-width: 150px; left: calc(84px + var(--safe-left, env(safe-area-inset-left, 0px)));
  bottom: auto;
  top: 44px; font-size: 10px;
}
/* A phone held upright: the stick and the bar need the width. The match
   turns inside the page for it (the rotated view, game/rotated_view.ts);
   with that turned off, it waits behind the wall until the phone turns (a
   practice match holds its clock meanwhile, game/practice_clock.ts). An
   iPhone never turns the screen for the page, and with its rotation lock
   on it never turns at all: the wall says where the lock is, and has a
   way out. */
.hud-turn {
  display: none; position: absolute; inset: 0; z-index: 40; pointer-events: auto;
  flex-direction: column; gap: 12px;
  align-items: center; justify-content: center; text-align: center; padding: 24px;
  background: rgba(4, 8, 16, 0.92); font-size: 18px; font-weight: 700; letter-spacing: 0.3px;
}
.hud-turn-line {
  max-width: 300px; font-size: 14px; font-weight: 500; line-height: 1.45; color: #b8c7a0;
  letter-spacing: 0;
}
.hud-turn .hud-menu-btn { margin-top: 8px; min-height: 44px; }
/* Under the pause menu or the end screen the wall keeps its dark ground
   and lets go of its words, so the two never read through each other. */
.hud.overlay-open .hud-turn > * { visibility: hidden; }
/* The shop on a touchscreen: the same chest, sized for the screen it is
   on. It stood 700 px wide (its desktop minimum) on an 844 px phone, with
   a 95 by 28 close button, covering three quarters of the screen the
   moment a match opened: the first thing a visitor on a phone met, and
   the last thing several of them saw. It now fills the phone with a
   margin, its cards and its detail column shrink with it, and the close
   button is the one part that grows to a thumb. Narrower than 560 the
   detail column lies under the grid instead of beside it. */
.hud.compact .hud-shop {
  left: 6px; right: 6px; top: 6px; bottom: 6px;
  width: auto; min-width: 0; max-height: none; transform: none; border-radius: 10px;
}
.hud.compact .hud-shop-head { padding: 7px 10px; gap: 8px; }
.hud.compact .hud-shop-head h3 { font-size: 14px; letter-spacing: 1.5px; }
.hud.compact .hud-shop-head .hud-gold { font-size: 15px; }
/* The one line of prose in the head; the cards say the same thing. It
   was the head's spacer as well, so the close button takes over pushing
   itself to the corner where a thumb goes looking for it. */
.hud.compact .hud-shop-status { display: none; }
.hud.compact .hud-shop-close {
  margin-left: auto; font-size: 13px; padding: 10px 16px; min-height: 40px;
}
.hud.compact .hud-shop-grid { padding: 8px 10px 12px; }
.hud.compact .hud-shop-grid h4 { top: -8px; font-size: 11px; }
.hud.compact .hud-cards { grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 7px; }
.hud.compact .hud-card { padding: 7px 4px 6px; font-size: 11px; gap: 3px; }
.hud.compact .hud-card img { width: 40px; height: 40px; }
.hud.compact .hud-card-recipe { min-height: 0; }
.hud.compact .hud-card-recipe img { width: 14px; height: 14px; }
.hud.compact .hud-card-cost { font-size: 11.5px; }
.hud.compact .hud-shop-detail { width: 176px; padding: 10px; font-size: 11px; }
.hud.compact .hud-detail-name { font-size: 13px; }
.hud.compact .hud-detail-head { gap: 8px; margin-bottom: 8px; padding-bottom: 8px; }
.hud.compact .hud-detail-head img { width: 38px; height: 38px; }
.hud.compact .hud-build-icon, .hud.compact .hud-build-icon img { width: 34px; height: 34px; }
/* The touch bar (ui/touch_bar.ts) rides the screen edge above the HUD's
   own layer, so it floated over the first column of items. It stands
   down while the shop is up; its Shop button is what opened it, and the
   shop's own Close is what ends it. */
.hud.shop-open ~ .touchbar { display: none; }
/* Narrow is the match stage's width, not the page's: a phone held upright
   and turned (game/match_stage.ts) is as wide as the phone is tall, and
   there the stage answers container queries. */
@media (max-width: 560px) {
  .match-stage:not(.turned) .hud.compact .hud-shop-body { flex-direction: column; }
  .match-stage:not(.turned) .hud.compact .hud-shop-detail {
    width: auto; max-height: 40%; border-left: none; border-top: 2px solid #3a4f28;
  }
}
@container (max-width: 560px) {
  .hud.compact .hud-shop-body { flex-direction: column; }
  .hud.compact .hud-shop-detail {
    width: auto; max-height: 40%; border-left: none; border-top: 2px solid #3a4f28;
  }
}
/* Only where the browser would not turn the screen itself
   (game/orientation.ts) and the player turned the rotated view off
   (game/rotated_view.ts): with the lock granted there is nothing to ask,
   and a turned stage is landscape already. */
@media (orientation: portrait) {
  .match-stage:not(.turned) .hud.compact.turn-needed .hud-turn { display: flex; }
  /* The touch bar rides above the HUD's layer; behind the wall its
     buttons would float over it with nothing to act on. The wall's own
     button is the way out, Back the way to the pause menu. */
  .match-stage:not(.turned) .hud.compact.turn-needed ~ .touchbar { display: none; }
}
`;

export interface NetHooks {
  sendChat?: (text: string) => void;
  sendPing?: (x: number, z: number) => void;
  // A first step done, or 'off' for the guide hidden, for the seat report
  // (ui/first_steps.ts, server/seat_report.ts).
  sendStep?: (id: string) => void;
}

export class Hud {
  private readonly world: IWorld;
  private readonly selfId: number;
  private readonly selfTeam: TeamId;
  private readonly metaText: HTMLElement;
  private readonly teamScore: TeamScore;
  private readonly statusRow: HTMLElement;
  private readonly auraWatch = new AuraWatch();
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
  // The rings as last seen: whether each creature stood, and the aspect
  // it carried, so a rise and a claim are announced on the edge.
  private readonly lastRingUp = new Map<string, boolean>();
  private readonly lastRingAspect = new Map<string, AspectId>();
  private readonly lastRingAscendant = new Map<string, boolean>();
  // Latest Wrath expiries seen per side, read like the Boon's.
  private lastWrathMineUntil = 0;
  private lastWrathEnemyUntil = 0;
  // Stacks held per side at the last frame: a claim is "mine grew".
  private lastFavorSum: [number, number] = [0, 0];
  private deathRecap = '';
  private readonly deathOverlay: HTMLElement;
  private readonly deathTitle: HTMLElement;
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
  // The points on the ladder beside it (ADR 0027), and whether this match
  // has banked any: only one that scores shows the box and the ladder box.
  private readonly pointsBox: HTMLElement;
  private readonly pointsTotal: HTMLElement;
  private readonly pointsPop: HTMLElement;
  private readonly pointsLabel: HTMLElement;
  private pointsSeen = false;
  // What this match has banked so far, for the ladder boxes.
  private pointsEarned = 0;
  private readonly endLadder: LadderBox;
  private readonly pauseLadder: LadderBox;
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
  // The thumb controls' slots (game/touch.ts): pointer events forwarded raw.
  private castTouch: CastTouch | null = null;
  // A mouse's click on a spell's slot (wired by boot): what it does to a
  // spell not learned yet (ui/slot_tap.ts).
  private slotClick: ((key: AbilityKey) => void) | null = null;
  private announceUntil = 0;
  // A line that holds its slot (announce's `keep`), and what waits for it.
  private announceKept = false;
  private readonly announceNext: { text: string; color: string; holdMs: number }[] = [];
  private spotUntil = 0;
  private sawBattleBegin = false;
  private sawFirstBlood = false;
  // The opening buy is the easiest thing in the genre to forget, so the
  // shop is already open when the match starts. Once, and only at the top.
  private openedOpeningShop = false;
  // That opening shop is still up: from the moment it opens by itself to
  // the first time it closes. A practice match holds its clock meanwhile
  // (game/practice_clock.ts); the shop opened again later does not.
  private openingShopUp = false;
  // The controls hint and its fade clock (ui/hints_fade.ts): seconds of
  // uncovered screen, null hold on a mouse where it stays.
  private readonly hintsEl: HTMLElement;
  private hintsClock: HintsClock = HINTS_START;
  private readonly hintsHold: number | null;
  // What the browser answered the landscape ask (setLandscapeLocked), and
  // whether the phone is upright: with the setting for the rotated view
  // (game/rotated_view.ts), what decides whether the turn wall stands.
  private landscapeLock: LockAnswer = 'asking';
  private readonly portrait: MediaQueryList | null;
  private readonly onSettings: () => void;
  private endPlayed = false;
  // No account behind this match (ui/account_offer.ts).
  private readonly guest: boolean;
  // The two feedback boxes (ui/feedback_box.ts) and whether this match has
  // already had its line: one is asked for, not one per place it is asked.
  private readonly endFeedback: FeedbackBox;
  private readonly pauseFeedback: FeedbackBox;
  private feedbackSent = false;
  // The line at the start of a match that points at the box.
  private readonly nudgeEl: HTMLElement;
  private nudge: NudgeState = NUDGE_START;
  // Which mode this match runs in, for the line's context. The HUD is
  // handed it because only the host knows (game/boot.ts).
  private readonly mode: 'practice' | 'online';
  // The lane guidance (ui/lane_guide.ts; ADR 0026): who is in front of
  // the screen, the seat's lane and whether the player got there, and the
  // card that tells it, in the nudge's slot and ahead of it.
  private readonly guideMode: GuideMode;
  private guide: LaneGuide | null = null;
  private laneCard: LaneCardState = LANE_CARD_START;
  private readonly laneCardEl: HTMLElement;
  private readonly laneTitleEl: HTMLElement;
  private readonly laneLineEl: HTMLElement;
  // The card's walk: one ordinary move order, handed in by the host so it
  // goes the way a right-click's does (game/boot.ts).
  private laneWalk: ((p: Vec2) => void) | null = null;
  // The first steps (ui/first_steps.ts): where the newcomer stands, the
  // card that says the step, and how the player plays, for its words.
  private steps: StepsState;
  private readonly stepsEl: HTMLElement;
  private readonly stepsLineEl: HTMLElement;
  private readonly stepsInput: StepsInput;
  // The shop picked the suggested item itself (ui/shop_suggestion.ts): it
  // follows the suggestion as it moves, until the player picks their own.
  private shopPickedSuggestion = false;
  // The recall's key on the bar (a mouse only; a phone's touch bar has its
  // own), and what pressing it does, handed in by the host (game/boot.ts).
  private recallSlot: HTMLElement | null = null;
  private recallPress: (() => void) | null = null;
  private readonly endOffer: HTMLElement;
  private readonly endOfferLine: HTMLElement;
  private readonly endOfferReason: HTMLElement;
  private lastTowerCount: number | null = null;
  private readonly rootEl: HTMLElement;
  // A touchscreen: the compact layout, and the one that may need the
  // phone turned (game/orientation.ts).
  private readonly coarsePointer: boolean;
  private readonly stopScale: () => void;
  private readonly stopThumbScale: () => void;
  private readonly styleEl: HTMLStyleElement;
  // The battle royale's layer (ui/royale_hud.ts) and its first steps
  // (ui/royale_steps.ts), in a match on the Wanderseed; null in a 5v5.
  private readonly royale: RoyaleHud | null;
  private royaleSteps: RoyaleStepsState | null = null;
  // Respawn's wash (ui/royale_life.ts): the life that just ended, under
  // the subtitle, and the champions last seen, for the killer's recap.
  private readonly royaleVariant: RoyaleVariant | null;
  private readonly royaleLife = new RoyaleLife();
  private readonly royaleSeen = new SeenChampions();
  private readonly deathLife: HTMLElement;
  // Who carries the Burr of a Respawn death (ui/royale_burr.ts).
  private readonly deathBurr: HTMLElement;
  // The Respawn wait's globe line (ui/royale_return.ts returnHint).
  private readonly deathHint: HTMLElement;
  // The best Respawn tally this browser kept before this match's card,
  // read once (game/settings.ts royaleBest).
  private royaleBestBefore: number | null = null;
  // The points this browser's battle royale seats earned before this match
  // and since, for the end card's goal (ui/royale_goal.ts); null in a 5v5.
  private readonly royaleGoal: GoalTrack | null;

  constructor(
    container: HTMLElement,
    world: IWorld,
    selfId: number,
    selfTeam: TeamId,
    // Where the end screen and the escape menu exits go: main.ts decides
    // what 'menu' and 'again' mean for the mode this match ran in.
    onExit: (action: PostMatchAction) => void,
    guest = false,
    mode: 'practice' | 'online' = 'practice',
    // Who is in front of the screen, for the lane guidance: a person on
    // the seat, a coach whose bot plays it, or a replay viewer.
    guide: GuideMode = 'play',
    // The battle royale's rule set when this match is one (ADR 0031).
    royale: RoyaleVariant | null = null,
  ) {
    this.world = world;
    this.selfId = selfId;
    this.selfTeam = selfTeam;
    this.guest = guest;
    this.mode = mode;
    this.guideMode = guide;
    this.royaleVariant = royale;
    this.royaleGoal = royale
      ? new GoalTrack(
          () => getSettings().royaleGoal,
          (total) => updateSettings({ royaleGoal: total }),
        )
      : null;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.styleEl = style;

    const root = document.createElement('div');
    // Compact mode on touchscreens: a phone needs the middle of the screen
    // for the game, so the fixed desktop sizes shrink (see the .compact CSS).
    const coarsePointer =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    // The thumb controls (CONTEXT.md: Thumb stick): the casting slots leave
    // the bottom bar for a cluster under the right thumb, with the attack
    // button at the corner, and a press on a slot aims by sliding.
    const thumbs = coarsePointer && getSettings().touchScheme === 'thumbs';
    // turn-needed until the browser answers (setLandscapeLocked): a phone
    // that refuses gets the rotated view instead, and keeps the line
    // asking for a turn only when the player turned that off.
    this.coarsePointer = coarsePointer;
    this.portrait =
      typeof window.matchMedia === 'function' ? window.matchMedia('(orientation: portrait)') : null;
    this.hintsHold = hintsHold(coarsePointer, thumbs);
    // The first steps, for a person on the seat: what this browser has
    // done, unless the player hid the guide. A coach or a replay viewer
    // meets none, and that is not remembered as hidden.
    const settingsNow = getSettings();
    // The battle royale has its own list (ui/royale_steps.ts), under the
    // same Hide guide; the 5v5's stands finished there.
    const guideOff = settingsNow.stepsOff || guide !== 'play';
    this.steps = stepsStart(guideOff || royale !== null, settingsNow.stepsDone);
    if (royale) this.royaleSteps = royaleStepsStart(guideOff, settingsNow.royaleStepsDone);
    // No shop opens itself, no minions spawn: a battle royale starts on
    // the drop (ADR 0031).
    if (royale) {
      this.openedOpeningShop = true;
      this.sawBattleBegin = true;
    }
    this.stepsInput = !coarsePointer ? 'mouse' : thumbs ? 'thumbs' : 'tap';
    root.className = coarsePointer ? `hud compact${thumbs ? ' thumbs' : ''} turn-needed` : 'hud';
    if (royale) root.classList.add('royale');
    this.rootEl = root;
    // The interface size (src/game/ui_scale.ts): the screen's, or the
    // player's choice, followed live while the match is on. The screen is
    // the match stage's (game/match_stage.ts), whose height on a phone
    // held upright and turned is the phone's width.
    const stageHeight = (): number => stageSizeOf(container).height;
    this.stopScale = followUiScale(root, () => getSettings().uiScale, stageHeight);
    // The thumb controls' size, from the height of the phone (ui_scale.ts).
    this.stopThumbScale = thumbs ? followThumbScale(root, stageHeight) : (): void => undefined;
    // The setting for the rotated view changes from the pause menu: the
    // wall follows it at once, as the stage does.
    this.onSettings = (): void => this.syncTurnNeeded();
    window.addEventListener(SETTINGS_EVENT, this.onSettings);
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
    // No gold in a battle royale: loot is the build (ADR 0031).
    if (royale) mainRow.append(this.levelBadge, bars);
    else mainRow.append(this.levelBadge, bars, goldBox);

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
    // Q whose tooltip carries the passive's name and what it does. The
    // thumb cluster has no room for a button that casts nothing.
    // Not in a battle royale: a gold disc marked P ahead of Q read as the
    // shop's button there, where there is no shop (ADR 0031).
    if (def && !thumbs && !royale) {
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
      slot.dataset.key = key;
      // Names live in the tooltip only; labels under the bar collided with
      // the inventory row below. Under the thumb a held slot is an aim,
      // not a read: no tooltip there.
      if (def && !thumbs) attachTooltip(slot, () => describeAbility(key, def.abilities[key]));
      // Touch has no keyboard: a QUICK tap on the slot arms the two-step
      // cast (game/touch.ts). A press held past LONG_PRESS_MS is a read,
      // the tooltip shows while the finger rests (tooltips.ts), and must
      // not arm on release. A mouse casts by the keys and reads the slot by
      // hovering it; its click goes to setSlotClick, where only a spell not
      // learned yet answers it. With the thumb controls every pointer event
      // goes raw to the cast touch, captured so a slide off the slot still
      // ends on it.
      let downAt = 0;
      let clickDown = false;
      slot.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'touch') {
          clickDown = e.button === 0 && e.target !== up;
          return;
        }
        if (e.target === up) return;
        e.preventDefault();
        downAt = performance.now();
        if (thumbs) {
          slot.setPointerCapture(e.pointerId);
          const p = pointOnStage(slot, e.clientX, e.clientY);
          this.castTouch?.abilityDown(key, p.x, p.y);
        }
      });
      slot.addEventListener('pointermove', (e) => {
        if (thumbs && e.pointerType === 'touch') {
          const p = pointOnStage(slot, e.clientX, e.clientY);
          this.castTouch?.abilityMove(key, p.x, p.y);
        }
      });
      slot.addEventListener('pointerup', (e) => {
        if (e.pointerType !== 'touch') {
          if (clickDown && e.button === 0 && e.target !== up) this.slotClick?.(key);
          clickDown = false;
          return;
        }
        if (e.target === up) return;
        if (thumbs) {
          const p = pointOnStage(slot, e.clientX, e.clientY);
          this.castTouch?.abilityUp(key, p.x, p.y);
          return;
        }
        if (performance.now() - downAt >= LONG_PRESS_MS) return;
        this.castTaps?.ability(key);
      });
      slot.addEventListener('pointercancel', (e) => {
        if (thumbs && e.pointerType === 'touch') this.castTouch?.abilityCancel(key);
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
      slot.dataset.key = keyLabel;
      if (!thumbs) {
        attachTooltip(slot, () => {
          const u = this.world.units.get(this.selfId);
          const sigil = u?.sigils[i] ? SIGILS[u.sigils[i]!] : undefined;
          return sigil ? describeSigil(sigil) : [];
        });
      }
      let sigilDownAt = 0;
      slot.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'touch') return;
        e.preventDefault();
        sigilDownAt = performance.now();
        if (thumbs) {
          slot.setPointerCapture(e.pointerId);
          const p = pointOnStage(slot, e.clientX, e.clientY);
          this.castTouch?.sigilDown(i, p.x, p.y);
        }
      });
      slot.addEventListener('pointermove', (e) => {
        if (thumbs && e.pointerType === 'touch') {
          const p = pointOnStage(slot, e.clientX, e.clientY);
          this.castTouch?.sigilMove(i, p.x, p.y);
        }
      });
      slot.addEventListener('pointerup', (e) => {
        if (e.pointerType !== 'touch') return;
        if (thumbs) {
          const p = pointOnStage(slot, e.clientX, e.clientY);
          this.castTouch?.sigilUp(i, p.x, p.y);
          return;
        }
        if (performance.now() - sigilDownAt >= LONG_PRESS_MS) return;
        this.castTaps?.sigil(i);
      });
      slot.addEventListener('pointercancel', (e) => {
        if (thumbs && e.pointerType === 'touch') this.castTouch?.sigilCancel(i);
      });
      slots.appendChild(slot);
      this.sigilSlots.push({ root: slot, cd });
    }

    // The recall, a key on the bar beside the spells: B was a key nobody
    // knew (the maintainer, 2026-10-02). A phone has its own Recall on the
    // touch bar, and the thumb cluster no room for one more button.
    // No recall in a battle royale (ADR 0031).
    if (!coarsePointer && !royale) {
      const recall = el('div', 'hud-slot recall');
      recall.append(recallMark(), el('span', 'hud-slot-key', 'B'));
      attachTooltip(recall, () => [
        'Recall (B)',
        'Stand still a few seconds: you go home, heal, and can shop.',
      ]);
      recall.addEventListener('click', () => this.recallPress?.());
      slots.appendChild(recall);
      this.recallSlot = recall;
    }

    const inv = el('div', 'hud-inv');
    // In a battle royale the bag is the loot the champion holds, named as
    // such, so its empty places never read as a shop's (ADR 0031).
    if (royale) inv.appendChild(el('span', 'hud-inv-label', LOOT_LABEL));
    for (let i = 0; i < 6; i++) {
      const slot = el('div', 'hud-inv-slot');
      attachTooltip(slot, () => {
        const u = this.world.units.get(this.selfId);
        const itemId = u?.items[i];
        const itemDef = itemId ? ITEMS[itemId] : undefined;
        if (!itemDef) return royale ? [...LOOT_EMPTY] : [];
        const lines = describeItem(itemDef, statLabel(itemDef.stats));
        // Nothing to sell it for in a battle royale: no gold, no fountain.
        if (royale) return lines;
        if (itemDef.drink) lines.push(`Click or press ${i + 1} to drink it.`);
        return [...lines, 'Right-click to sell (70 percent back, at fountain).'];
      });
      // A click on a Sapdraught drinks it, anywhere.
      slot.addEventListener('click', () => this.drinkSlot(i));
      // Right-click sells at the fountain for 70 percent of the price.
      slot.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (this.royale) return;
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

    if (thumbs) {
      // The cluster: the slots around the attack button, under the right
      // thumb, placed by the .hud.thumbs rules; the bar keeps the rest.
      const attack = el('div', 'hud-attack', 'ATK');
      attack.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch') e.preventDefault();
      });
      attack.addEventListener('pointerup', (e) => {
        if (e.pointerType === 'touch') this.castTouch?.attack();
      });
      slots.appendChild(attack);
      root.appendChild(slots);
      bottom.append(this.statusRow, this.metaText, mainRow, inv);
    } else {
      bottom.append(this.statusRow, this.metaText, mainRow, slots, inv);
    }

    const hints = el('div', 'hud-hints');
    this.hintsEl = hints;
    hints.textContent = royale
      ? royaleHints(this.stepsInput, getSettings().leftClickMoves)
      : coarsePointer
        ? getSettings().touchScheme === 'thumbs'
          ? 'Left thumb: the stick walks. Right thumb: tap a spell to cast it, slide it to ' +
            'aim. ATK attacks. Tap the + to level up.'
          : 'Tap: move / attack. Tap a spell, then tap the ground to cast it (tap the spell ' +
            'again to cancel). Drag pans the camera, pinch zooms, Center snaps back to your ' +
            'champion. Level up: tap the +.'
        : stepsFinished(this.steps)
          ? `${getSettings().leftClickMoves ? 'Click' : 'Right-click'}: move / attack. ` +
            'A: attack-move. S: stop and hold. B: recall. ' +
            'Q W E R: hold to aim, release to cast (right-click cancels). D F: sigils. P: shop. ' +
            'Tab: scoreboard. Enter: chat. G: ping. Esc: menu. Screen edges pan the camera; ' +
            'Space recenters; left-click the minimap to look. Level up: Alt+key or click +.'
          : // While the first steps lead a newcomer, the keys they need and no
            // more: the steps say the rest when it comes up.
            `${getSettings().leftClickMoves ? 'Click' : 'Right-click'}: move / attack. ` +
            'Q W E R: spells. B: recall. P: shop. Esc: menu.';

    // The always-visible personal score: K / D / A plus creep
    // score, top right.
    const kda = el('div', 'hud-kda');
    this.kdaText = el('div', '', '0 / 0 / 0');
    this.kdaCs = el('span', 'cs', 'CS 0');
    // The points on the ladder (ADR 0027), hung off the box's left edge
    // and shown from the first points of a match that scores.
    this.pointsBox = el('div', 'hud-points');
    this.pointsTotal = el('div', '', '0');
    this.pointsPop = el('div', 'hud-points-pop');
    this.pointsLabel = el('span', 'label', 'points');
    this.pointsBox.append(this.pointsTotal, this.pointsLabel, this.pointsPop);
    kda.append(this.kdaText, this.kdaCs, this.pointsBox);
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
    // the genre expects. Components and drinks on top (ui/shop_sections.ts),
    // finished items below with their recipes visible on the card, and a
    // detail pane showing the full build
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
    for (const section of shopSections()) addSection(section.title, section.items);
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

    this.nudgeEl = el('div', 'hud-nudge');
    const nudgeWords = el('div', 'hud-nudge-words');
    nudgeWords.append(el('b', '', FEEDBACK_ASK), el('span', '', nudgeCall(coarsePointer)));
    const nudgeClose = el('button', 'hud-nudge-close', '\u00d7');
    nudgeClose.setAttribute('aria-label', 'Close');
    nudgeClose.addEventListener('click', (e) => {
      e.stopPropagation();
      this.endNudge();
    });
    this.nudgeEl.append(nudgeWords, nudgeClose);
    this.nudgeEl.addEventListener('click', () => {
      this.endNudge();
      if (!this.escapeOverlay.classList.contains('open')) this.toggleEscapeMenu();
      this.pauseFeedback.reveal(!coarsePointer);
    });

    // The first steps' card: one line, under the lane card or the feedback
    // line when one of them is up, and a button that hides the guide for
    // good (the settings panel brings it back).
    this.stepsEl = el('div', 'hud-steps');
    const stepsWords = el('div', 'hud-steps-words');
    this.stepsLineEl = el('span', '');
    stepsWords.append(el('b', '', STEPS_TITLE), this.stepsLineEl);
    const stepsHide = el('button', 'hud-steps-hide', STEPS_HIDE);
    stepsHide.type = 'button';
    stepsHide.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hideFirstSteps();
    });
    this.stepsEl.append(stepsWords, stepsHide);

    // The lane card: the seat's lane, and a tap that walks the champion
    // there while it has not arrived; the close button only closes.
    this.laneCardEl = el('div', 'hud-lane-card');
    const laneWords = el('div', 'hud-lane-words');
    this.laneTitleEl = el('b', '');
    this.laneLineEl = el('span', '');
    laneWords.append(this.laneTitleEl, this.laneLineEl);
    const laneClose = el('button', 'hud-lane-close', '\u00d7');
    laneClose.setAttribute('aria-label', 'Close');
    laneClose.addEventListener('click', (e) => {
      e.stopPropagation();
      this.endLaneCard();
    });
    this.laneCardEl.append(laneWords, laneClose);
    this.laneCardEl.addEventListener('click', () => {
      const target = this.guide?.target;
      if (this.laneCardWalks() && target) {
        if (this.laneWalk) this.laneWalk(target);
        else this.world.orderMove(this.selfId, target.x, target.z);
      }
      this.endLaneCard();
    });

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
    this.deathTitle = el('div', 'hud-overlay-title', 'SLAIN');
    this.deathLife = el('div', 'hud-overlay-life');
    this.deathLife.hidden = true;
    this.deathHint = el('div', 'hud-overlay-hint');
    this.deathHint.hidden = true;
    this.deathBurr = el('div', 'hud-overlay-burr');
    this.deathBurr.hidden = true;
    // In reading order: who, this life, the Burr, then the globe's line.
    this.deathOverlay.append(
      this.deathTitle,
      this.deathSub,
      this.deathLife,
      this.deathBurr,
      this.deathHint,
    );

    this.endOverlay = el('div', 'hud-overlay modal');
    this.endTitle = el('div', 'hud-overlay-title');
    this.endSub = el('div', 'hud-overlay-sub');
    this.endRating = el('div', 'hud-end-rating');
    this.endStats = el('div', 'hud-end-card');
    // The account offer (ui/account_offer.ts): filled at the end of a
    // visitor's practice match, never opened for an account.
    this.endOffer = el('div', 'hud-end-offer');
    const offerWords = el('div', 'hud-end-offer-words');
    this.endOfferLine = el('b', '');
    this.endOfferReason = el('span', '');
    offerWords.append(this.endOfferLine, this.endOfferReason);
    const offerBtn = el('button', 'hud-menu-btn', OFFER_CALL);
    offerBtn.addEventListener('click', () => {
      // The pace between playing and the form (net/stats.ts).
      trackStep('offer');
      onExit('account');
    });
    this.endOffer.append(offerWords, offerBtn);
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
    // The box that asks what to improve (ui/feedback_box.ts). Here first,
    // since the end screen is where a match is over and there is nothing
    // left to interrupt.
    this.endFeedback = this.buildFeedback('end');
    // Where the player stands on the ladder of every human, and a Guest's
    // name beside the points (ui/ladder_box.ts, ADR 0027): right under the
    // result, since it is the result that stays.
    this.endLadder = buildLadderBox(el);
    this.pauseLadder = buildLadderBox(el);
    this.endOverlay.append(
      this.endTitle,
      this.endSub,
      this.endRating,
      this.endLadder.root,
      this.endOffer,
      this.endStats,
      endBtns,
      this.endFeedback.root,
      endJoin,
    );

    this.escapeOverlay = el('div', 'hud-overlay modal');
    const resume = el('button', 'hud-menu-btn', 'Resume (Esc)');
    resume.addEventListener('click', () => this.toggleEscapeMenu());
    const fullscreenBtn = el('button', 'hud-menu-btn', 'Toggle fullscreen');
    fullscreenBtn.addEventListener('click', () => toggleGameFullscreen());
    const quit = el('button', 'hud-menu-btn', 'Leave match');
    quit.addEventListener('click', () => onExit('menu'));
    // And in the pause menu, which is the other door out: whoever is
    // about to press Leave match is the one with something to say.
    this.pauseFeedback = this.buildFeedback('pause');
    this.escapeOverlay.append(
      el('div', 'hud-overlay-title', 'Paused view'),
      resume,
      this.pauseLadder.root,
      buildSettingsPanel(),
      fullscreenBtn,
      this.pauseFeedback.root,
      quit,
    );

    // The turn wall: the ask, where an iPhone keeps its rotation lock, and
    // the pause menu's own way out, for a phone that will not turn.
    const turnWall = el('div', 'hud-turn');
    const turnLeave = el('button', 'hud-menu-btn', 'Leave match');
    turnLeave.addEventListener('click', () => onExit('menu'));
    // The loading card before the match asked already (ui/turn_ask.ts).
    turnWall.append(
      el('div', '', `${TURN_ASK} to play`),
      el('div', 'hud-turn-line', TURN_LOCK_LINE),
      turnLeave,
    );

    root.append(
      turnWall,
      bottom,
      hints,
      kda,
      this.teamScore.el,
      this.targetFrame,
      this.shop,
      this.feed,
      chat,
      this.announceEl,
      this.laneCardEl,
      this.nudgeEl,
      this.stepsEl,
      this.spotEl,
      this.toastEl,
      this.score,
      this.deathOverlay,
      this.endOverlay,
      this.escapeOverlay,
    );
    container.appendChild(root);
    this.royale = royale
      ? new RoyaleHud({
          root,
          world,
          selfId,
          selfTeam,
          variant: royale,
          touch: coarsePointer,
          onExit,
        })
      : null;
    this.royale?.setAnnounce((text, color, holdMs, keep) =>
      this.announce(text, color, holdMs, keep),
    );
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

  // Points banked on this player's line of the ladder (ADR 0027): the
  // total beside the K/D/A and a pop with the reason. A Guest's first
  // points say plainly, once per browser, that the match is on a ladder.
  showPoints(delta: number, total: number, reason: PointsReason): void {
    this.pointsSeen = true;
    this.pointsEarned += delta;
    this.royaleGoal?.earn(delta);
    this.endLadder.setEarned(this.pointsEarned);
    this.pauseLadder.setEarned(this.pointsEarned);
    this.pointsBox.classList.add('on');
    this.pointsTotal.textContent = total.toLocaleString('en-US');
    this.pointsLabel.textContent = pointsWord(total);
    this.pointsPop.textContent = popText(delta, reason);
    this.pointsPop.classList.remove('on');
    // Reading the layout flushes the removal, so the pop plays again.
    void this.pointsPop.offsetWidth;
    this.pointsPop.classList.add('on');
    if (this.guest && !getSettings().ladderTold) {
      updateSettings({ ladderTold: true });
      this.announce(firstPointsText(delta), '#ffd94a', 4200, true);
    }
  }

  // The battle royale's events off a world tick (net/royale_client.ts): the
  // loot that lands, and what the first steps count.
  onRoyaleNotes(notes: readonly RoyaleNote[]): void {
    if (notes.length > 0) this.royale?.onNotes(notes);
  }

  // The battle royale's end screen, when the server says this person is
  // out for good or the match is over (RoyaleResult). The ladder box, the
  // account offer and the feedback box move under it from the 5v5's end
  // screen, which a battle royale never opens.
  showRoyaleResult(result: RoyaleResult): void {
    if (!this.royale) return;
    if (this.escapeOverlay.classList.contains('open')) this.toggleEscapeMenu();
    const extras: HTMLElement[] = [];
    if (this.scores()) {
      this.endLadder.refresh();
      extras.push(this.endLadder.root);
    }
    const won = result.place === 1;
    const own = this.world.scoreboard().find((r) => r.unitId === this.selfId);
    const me = this.world.units.get(this.selfId);
    const def = me?.championId ? this.world.championDef(me.championId) : null;
    const offer = accountOffer({
      guest: this.guest,
      scored: this.scores(),
      won,
      kills: own?.kills ?? result.score,
      deaths: own?.deaths ?? 0,
      assists: own?.assists ?? 0,
      champion: def?.name ?? null,
    });
    if (offer) {
      this.endOfferLine.textContent = offer.line;
      this.endOfferReason.textContent = offer.reason;
      this.endOffer.classList.add('open');
      extras.push(this.endOffer);
    }
    extras.push(this.endFeedback.root);
    // Respawn's best (game/settings.ts royaleBest): the one kept before
    // this match goes on the card, and this seat's tally is kept after it
    // when higher. Read once, so a card drawn again says the same.
    const respawn = result.v === 'respawn';
    if (this.royaleBestBefore === null) this.royaleBestBefore = getSettings().royaleBest;
    const best = this.royaleBestBefore;
    this.royale.showResult(result, extras, {
      assists: own?.assists ?? 0,
      best: respawn ? best : 0,
      goal: this.scores() ? (this.royaleGoal?.model() ?? null) : null,
    });
    if (respawn && respawnTally(result) > getSettings().royaleBest) {
      updateSettings({ royaleBest: respawnTally(result) });
    }
    this.deathOverlay.classList.remove('open');
    // Heard once, when it came: Respawn's middle of the field hears
    // nothing (ui/royale_result.ts royaleSting).
    if (!this.endPlayed) {
      this.endPlayed = true;
      const sting = royaleSting(result);
      if (sting) {
        playSfx(sting);
        announceVoice(sting, true);
      }
    }
    this.syncOverlay();
  }

  // Same-page teardown: the HUD tree and its stylesheet go; a floating
  // tooltip attached to a removed element must not be left hanging.
  dispose(): void {
    hideTooltip();
    this.royale?.dispose();
    this.stopScale();
    this.stopThumbScale();
    window.removeEventListener(SETTINGS_EVENT, this.onSettings);
    this.rootEl.remove();
    this.styleEl.remove();
  }

  // The browser's answer to the landscape ask for this match
  // (game/orientation.ts): with the lock there is nothing left to ask, and
  // a refusal is the rotated view's to answer (game/rotated_view.ts)
  // unless the player turned it off. Called again whenever the request is
  // retried.
  setLandscapeLocked(locked: boolean): void {
    this.landscapeLock = locked ? 'granted' : 'refused';
    this.syncTurnNeeded();
  }

  private syncTurnNeeded(): void {
    this.rootEl.classList.toggle(
      'turn-needed',
      wallFallback(this.coarsePointer, this.landscapeLock, getSettings().rotatedView),
    );
  }

  // The turn wall stands right now (the stylesheet's own conditions).
  private turnWallUp(): boolean {
    return turnWallUp(
      this.coarsePointer,
      this.landscapeLock,
      getSettings().rotatedView,
      this.portrait?.matches ?? false,
    );
  }

  // What stands over the match right now, for the practice clock
  // (game/practice_clock.ts); read every frame, so it reads classes only.
  covers(): MatchCover {
    return {
      turnWall: this.turnWallUp(),
      pauseMenu: this.escapeOverlay.classList.contains('open'),
      openingShop: this.openingShopUp && this.shop.classList.contains('open'),
    };
  }

  // One feedback box, wired to this match: what it sends is read when
  // Send is pressed, and a line sent in one place thanks the player in
  // both (ui/feedback_box.ts).
  private buildFeedback(where: FeedbackWhere): FeedbackBox {
    return buildFeedbackBox(
      <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
        const e = document.createElement(tag);
        e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
      },
      {
        where,
        context: () => ({
          mode: this.mode,
          minutes: this.world.time / 60,
          finished: this.world.winner !== null,
          signedIn: !this.guest,
        }),
        onSent: () => {
          if (this.feedbackSent) return;
          this.feedbackSent = true;
          this.endFeedback?.markSent();
          this.pauseFeedback?.markSent();
        },
      },
    );
  }

  // The one place the shop opens or closes: the HUD's root says so too,
  // so what lives outside the HUD (the touch bar) can stand down.
  private setShopOpen(open: boolean): void {
    this.shop.classList.toggle('open', open);
    this.rootEl.classList.toggle('shop-open', open);
    if (!open) this.openingShopUp = false;
  }

  toggleShop(): void {
    // No shop in a battle royale: loot is the build (ADR 0031).
    if (this.royale) return;
    this.setShopOpen(!this.shop.classList.contains('open'));
    this.update();
  }

  toggleScoreboard(): void {
    // The two teams' table has nothing to say of fifty champions.
    if (this.royale) return;
    this.score.classList.toggle('open');
    this.update();
  }

  // A modal overlay is up (the pause menu or the end screen): what lives
  // outside the HUD stands down, like it does for the shop.
  private syncOverlay(): void {
    this.rootEl.classList.toggle(
      'overlay-open',
      this.escapeOverlay.classList.contains('open') ||
        this.endOverlay.classList.contains('open') ||
        this.royale?.resultShown() === true,
    );
  }

  // Something covers the HUD: the shop, the pause menu, the end screen or
  // the turn wall. The lane card, the feedback line and the controls hint
  // wait for it to lift, and their clocks with them.
  private nudgeBlocked(): boolean {
    return (
      this.shop.classList.contains('open') ||
      this.escapeOverlay.classList.contains('open') ||
      this.endOverlay.classList.contains('open') ||
      this.royale?.resultShown() === true ||
      this.turnWallUp()
    );
  }

  private stepHints(): void {
    if (this.hintsClock.faded || this.hintsHold === null) return;
    this.hintsClock = stepHints(
      this.hintsClock,
      this.world.time,
      this.nudgeBlocked(),
      this.hintsHold,
    );
    if (this.hintsClock.faded) this.hintsEl.classList.add('faded');
  }

  private stepNudge(): void {
    if (this.nudge.done && !this.nudgeEl.classList.contains('on')) return;
    // After the lane card, never beside it: one card in the slot at a time.
    const blocked =
      this.nudgeBlocked() || laneCardAhead(this.laneCard, this.guideMode, this.world.time);
    this.nudge = stepNudge(this.nudge, this.world.time, blocked);
    this.nudgeEl.classList.toggle('on', nudgeVisible(this.nudge, blocked));
  }

  // The seat's lane read again (a re-deal or a seat changing hands moves
  // it: the guide starts over and the card comes back), whether the
  // player got there, and the card's words and life. Nothing in a replay.
  private stepLaneGuide(self: { lane: LaneGuide['lane']; pos: Vec2; dead: boolean }): void {
    if (this.guideMode === 'watch' || this.royale) return;
    const prev = this.guide;
    this.guide = stepGuide(
      prev,
      this.world.map,
      this.selfTeam,
      self.lane,
      self.dead ? null : self.pos,
      this.world.units.values(),
    );
    if (prev !== null && prev.lane !== self.lane) this.laneCard = LANE_CARD_START;
    const blocked = this.nudgeBlocked();
    this.laneCard = stepLaneCard(this.laneCard, this.world.time, blocked, this.guide.arrived);
    const visible = laneCardVisible(this.laneCard, blocked);
    if (visible) {
      const call = laneCall(this.guide.lane, this.guideMode, {
        touch: this.coarsePointer,
        time: this.world.time,
        arrived: this.guide.arrived,
      });
      if (this.laneTitleEl.textContent !== call.title) this.laneTitleEl.textContent = call.title;
      if (this.laneLineEl.textContent !== call.line) this.laneLineEl.textContent = call.line;
      this.laneCardEl.classList.toggle('still', !this.laneCardWalks());
    }
    this.laneCardEl.classList.toggle('on', visible);
  }

  // Whether a tap on the card walks: a person's seat, not there yet, with
  // somewhere to go.
  private laneCardWalks(): boolean {
    return (
      this.guideMode === 'play' &&
      this.guide !== null &&
      !this.guide.arrived &&
      this.guide.target !== null
    );
  }

  private endLaneCard(): void {
    this.laneCard = closeLaneCard(this.laneCard, this.world.time);
    this.laneCardEl.classList.remove('on');
  }

  // The guidance as it stands, for the minimap's stroke and the arrow
  // (game/boot.ts); null in a replay, and before the first update.
  laneGuide(): LaneGuide | null {
    return this.guideMode === 'watch' ? null : this.guide;
  }

  // Where the lane card stands while it is up, for the arrow to keep
  // clear of, in the match stage's pixels like the arrow; null while it
  // is not.
  laneCardRect(): ScreenRect | null {
    return this.laneCardEl.classList.contains('on')
      ? rectOnStage(this.laneCardEl, this.laneCardEl.getBoundingClientRect())
      : null;
  }

  // The card's walk, as the host orders a move (game/boot.ts).
  setLaneWalk(walk: (p: Vec2) => void): void {
    this.laneWalk = walk;
  }

  // The recall key's press: the host's recall, the way B gives it.
  setRecall(press: () => void): void {
    this.recallPress = press;
  }

  private endNudge(): void {
    this.nudge = { ...this.nudge, done: true };
    this.nudgeEl.classList.remove('on');
  }

  // The first steps, one update (ui/first_steps.ts): what got done is
  // remembered by the browser and told to the seat report, and the step
  // up is drawn under the lane card or the feedback line when one is up.
  private stepFirstSteps(u: Readonly<Unit>): void {
    if (this.royale) {
      this.stepRoyaleFirstSteps(u, this.royale);
      return;
    }
    if (stepsFinished(this.steps) && !this.stepsEl.classList.contains('on')) return;
    const view = this.stepsView(u);
    const prev = this.steps;
    this.steps = stepSteps(prev, view);
    const fresh = this.steps.done.filter((id) => !prev.done.includes(id));
    if (fresh.length > 0) {
      updateSettings({ stepsDone: [...new Set([...getSettings().stepsDone, ...fresh])] });
      for (const id of fresh) this.netHooks.sendStep?.(id);
    }
    const id = this.steps.current;
    const visible = id !== null && !view.covered && !view.dead;
    if (id !== null && visible) {
      const line = stepLine(id, this.stepsInput);
      if (this.stepsLineEl.textContent !== line) this.stepsLineEl.textContent = line;
      this.stepsEl.classList.toggle(
        'below',
        this.laneCardEl.classList.contains('on') || this.nudgeEl.classList.contains('on'),
      );
    }
    this.stepsEl.classList.toggle('on', visible);
    // A step that says B lights the key it names.
    this.recallSlot?.classList.toggle(
      'hint',
      visible && (id === 'recall' || id === 'go_shop' || id === 'low_health'),
    );
  }

  // The battle royale's first steps (ui/royale_steps.ts), in the same card
  // and under the same rules as the 5v5's: remembered by the browser on a
  // list of their own.
  private stepRoyaleFirstSteps(u: Readonly<Unit>, royale: RoyaleHud): void {
    const prev = this.royaleSteps;
    if (!prev) return;
    if (royaleStepsFinished(prev) && !this.stepsEl.classList.contains('on')) return;
    const view = royale.stepsView(u, this.nudgeBlocked());
    const next = stepRoyaleSteps(prev, view);
    this.royaleSteps = next;
    const fresh = next.done.filter((id) => !prev.done.includes(id));
    if (fresh.length > 0) {
      updateSettings({
        royaleStepsDone: [...new Set([...getSettings().royaleStepsDone, ...fresh])],
      });
      for (const id of fresh) this.netHooks.sendStep?.(id);
    }
    const id = next.current;
    const visible = id !== null && !view.covered && !view.dead;
    if (id !== null && visible) {
      const line = royaleStepLine(id, this.stepsInput, getSettings().leftClickMoves);
      if (this.stepsLineEl.textContent !== line) this.stepsLineEl.textContent = line;
      this.stepsEl.classList.toggle('below', this.nudgeEl.classList.contains('on'));
    }
    this.stepsEl.classList.toggle('on', visible);
  }

  // What the first steps read of the match: the champion, what is near
  // it, and what covers the screen. Everything here is in the viewer's
  // sight already.
  private stepsView(u: Readonly<Unit>): StepsView {
    const time = this.world.time;
    const dist = (o: { pos: Vec2 }, p: Vec2): number => Math.hypot(o.pos.x - p.x, o.pos.z - p.z);
    let enemyMinionNear = false;
    let enemyChampionNear = false;
    const allyMinions: Readonly<Unit>[] = [];
    const enemyTowers: Readonly<Unit>[] = [];
    for (const o of this.world.units.values()) {
      if (o.dead || o.id === u.id) continue;
      if (o.kind === 'minion') {
        if (o.team === this.selfTeam) allyMinions.push(o);
        else if (dist(o, u.pos) <= STEPS_MINION_NEAR_M) enemyMinionNear = true;
      } else if (o.kind === 'champion') {
        if (o.team !== this.selfTeam && dist(o, u.pos) <= STEPS_CHAMPION_NEAR_M) {
          enemyChampionNear = true;
        }
      } else if (o.kind === 'tower' && o.team !== this.selfTeam && !o.neutral) {
        enemyTowers.push(o);
      }
    }
    // The tower's own rule for its reach (src/sim/tower_ai.ts).
    const towerAlone = enemyTowers.some((t) => {
      const reaches = (o: Readonly<Unit>): boolean =>
        dist(o, t.pos) - t.radius - o.radius <= t.stats.attackRange;
      return reaches(u) && !allyMinions.some(reaches);
    });
    const suggestion = suggestedItem(u.championId, u.items);
    return {
      time,
      covered: this.nudgeBlocked(),
      dead: u.dead,
      level: u.level,
      skillPoints: u.skillPoints,
      learned: (['Q', 'W', 'E'] as const).some((k) => effectiveRank(u, k) > 0),
      cast: (['Q', 'W', 'E', 'R'] as const).some((k) => (u.cooldowns[k] ?? 0) > time),
      cs: u.cs,
      enemyMinionNear,
      enemyChampionNear,
      hpFrac: u.maxHp > 0 ? u.hp / u.maxHp : 1,
      towerAlone,
      atFountain: withinFountain(this.world.map, this.selfTeam, u.pos),
      canAffordSuggestion: suggestion !== null && u.gold >= effectiveItemCost(suggestion, u.items),
      recalling: u.statuses.some((st) => st.kind === 'recall' && st.until > time),
    };
  }

  // The player hid the guide: for good, until the settings bring it back.
  private hideFirstSteps(): void {
    this.steps = hideSteps(this.steps);
    if (this.royaleSteps) this.royaleSteps = hideRoyaleSteps(this.royaleSteps);
    this.stepsEl.classList.remove('on');
    updateSettings({ stepsOff: true });
    this.netHooks.sendStep?.('off');
  }

  toggleEscapeMenu(): void {
    this.escapeOverlay.classList.toggle('open');
    this.syncOverlay();
    // Opened in a match that scores: the place as it stands now.
    if (this.scores() && this.escapeOverlay.classList.contains('open')) {
      this.pauseLadder.refresh();
    }
  }

  // Whether this match scores on the ladder (ADR 0027), as far as the HUD
  // can tell: it has banked points, or a Guest plays it online, since the
  // public queue is the only match a Guest can be in.
  private scores(): boolean {
    return this.pointsSeen || (this.guest && this.mode === 'online');
  }

  isChatOpen(): boolean {
    return this.chatInput.style.display === 'block';
  }

  // A battle royale Graft card picked by its key (game/input.ts, 1 to 3):
  // true when an offer was open to take it.
  pickGraft(card: number): boolean {
    return this.royale?.pickGraft(card) ?? false;
  }

  // Wires the touch two-step cast: slot taps call these (boot provides them).
  setCastTaps(taps: { ability(key: AbilityKey): void; sigil(slot: number): void }): void {
    this.castTaps = taps;
  }

  setCastTouch(touch: CastTouch): void {
    this.castTouch = touch;
  }

  setSlotClick(click: (key: AbilityKey) => void): void {
    this.slotClick = click;
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
      this.endOverlay.classList.contains('open') ||
      this.royale?.resultShown() === true
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

  // The look a team wears on this screen (src/ui/team_look.ts): the 5v5's
  // sides, or the viewer's team against everyone else.
  private look(team: TeamId): TeamId {
    return teamLook(team, this.selfTeam, this.world.teamCount);
  }

  pushChat(from: string, team: TeamId, text: string): void {
    const line = document.createElement('div');
    line.className = 'hud-chat-line';
    const name = document.createElement('span');
    name.textContent = `${from}: `;
    name.style.color = TEAM_TEXT_COLORS[this.look(team)] ?? '#c9d8ae';
    const body = document.createElement('span');
    body.textContent = text;
    line.append(name, body);
    this.chatLog.appendChild(line);
    while (this.chatLog.children.length > 6) this.chatLog.firstChild?.remove();
    window.setTimeout(() => line.remove(), 12000);
  }

  // The rings' edges: a creature rose, or fell to a team. Whose favor it
  // became is read off the stacks, the way the Boon's claim is read off
  // its expiry: the side whose total grew this frame made the kill; a
  // creature that fell to nobody's champion is nobody's claim.
  private announceRings(rings: readonly RingClock[], mine: FavorStacks, enemy: FavorStacks): void {
    // A favor is a team's claim: a battle royale has no teams to give one
    // to (ADR 0031), and its creatures say nothing of the kind.
    if (this.royale) return;
    const sum = (f: FavorStacks): number => ASPECT_IDS.reduce((n, a) => n + f[a], 0);
    const mineSum = sum(mine);
    const enemySum = sum(enemy);
    const mineWrath = this.world.teamWrath(this.selfTeam) ?? 0;
    const enemyWrath = this.world.teamWrath(otherTeam(this.selfTeam)) ?? 0;
    for (const clock of rings) {
      const up = clock.unitId !== null;
      const was = this.lastRingUp.get(clock.ring);
      const name = creatureName(clock.creature, clock.ascendant);
      if (was !== undefined && up !== was) {
        if (up) {
          this.announce(`The ${name} has risen`, aspectColor(clock.aspect, clock.ascendant).css);
          playSfx('tower');
          announceVoice(
            clock.ascendant ? `${clock.creature}_ascendant_risen` : `${clock.creature}_risen`,
            true,
          );
        } else if (this.lastRingAscendant.get(clock.ring)) {
          // An Ascendant fell: whose Wrath moved forward this frame holds it.
          if (mineWrath > this.lastWrathMineUntil) {
            this.announce('Your team holds the Wrath', WRATH_COLOR.css);
            playSfx('levelup');
            announceVoice('wrath_ours', true);
          } else if (enemyWrath > this.lastWrathEnemyUntil) {
            this.announce('The enemy holds the Wrath', '#f5a3a3');
            playSfx('deny');
            announceVoice('wrath_theirs', true);
          }
        } else {
          const aspect = this.lastRingAspect.get(clock.ring) ?? clock.aspect ?? 'might';
          if (mineSum > this.lastFavorSum[0]) {
            this.announce(
              `Your team claims the ${favorClaimText(clock.creature, aspect)}`,
              '#ffd94a',
            );
            playSfx('levelup');
            announceVoice('favor_ours', true);
          } else if (enemySum > this.lastFavorSum[1]) {
            this.announce(
              `The enemy claims the ${favorClaimText(clock.creature, aspect)}`,
              '#f5a3a3',
            );
            playSfx('deny');
            announceVoice('favor_theirs', true);
          }
        }
      }
      this.lastRingUp.set(clock.ring, up);
      if (up) {
        this.lastRingAscendant.set(clock.ring, clock.ascendant);
        if (clock.aspect) this.lastRingAspect.set(clock.ring, clock.aspect);
      }
    }
    this.lastFavorSum = [mineSum, enemySum];
    this.lastWrathMineUntil = Math.max(this.lastWrathMineUntil, mineWrath);
    this.lastWrathEnemyUntil = Math.max(this.lastWrathEnemyUntil, enemyWrath);
  }

  // `keep`: the line holds its slot for its whole moment, and what is
  // announced meanwhile waits its turn. A Guest's first points say they are
  // on the ladder this way (showPoints), since they land with the very
  // things that announce themselves: a tower, a creature taken.
  announce(text: string, color = '#f2ffd9', holdMs = 2600, keep = false): void {
    if (this.announceKept && !keep && performance.now() < this.announceUntil) {
      if (this.announceNext.length < 3) this.announceNext.push({ text, color, holdMs });
      return;
    }
    this.announceKept = keep;
    this.announceEl.textContent = text;
    this.announceEl.style.color = color;
    this.announceEl.style.opacity = '1';
    this.announceUntil = performance.now() + holdMs;
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
    if (ITEMS[itemId]?.drink && !mayCarryDraught(u.items)) {
      playSfx('deny');
      this.toast(`You carry ${DRAUGHT_CARRY} drinks already.`);
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

  // Drinks the Sapdraught in bag slot `slot` (a click on it, its number
  // key, the touch bar's Drink); a slot holding anything else does nothing.
  drinkSlot(slot: number): void {
    if (this.royale) return;
    const u = this.world.units.get(this.selfId);
    const itemId = u?.items[slot];
    if (!u || u.dead || !itemId || !ITEMS[itemId]?.drink) return;
    if (this.world.drinkItem(this.selfId, slot)) this.update();
    else this.toast('A drink is already working.');
  }

  // A bright pulse on the mana bar so "why did my key do nothing" has a
  // visible answer next to the number that explains it.
  flashMana(): void {
    this.manaBar.classList.remove('flash');
    void (this.manaBar as HTMLElement).offsetWidth;
    this.manaBar.classList.add('flash');
  }

  private selectShopItem(itemId: string): void {
    this.shopPickedSuggestion = false;
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
        def.drink
          ? 'Drink'
          : def.tier === 1
            ? 'Component'
            : def.tier === 2
              ? 'Finished item'
              : 'Legendary upgrade',
      ),
    );
    head.append(bigIcon, title);
    d.appendChild(head);
    d.appendChild(
      mk(
        'hud-detail-stats',
        def.drink
          ? `${def.drink.heal} health over ${def.drink.seconds} s. Click it in your bag, ` +
              'or press its number, to drink it anywhere.'
          : statLabel(def.stats),
      ),
    );

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
    const full = def.drink !== undefined && !mayCarryDraught(u.items);
    buy.disabled = !shopOk || u.gold < eff || full;
    buy.addEventListener('click', () => this.tryBuy(def.id));
    d.appendChild(buy);
    if (!shopOk) d.appendChild(mk('hud-buy-why', 'Return to your fountain to buy.'));
    else if (full) d.appendChild(mk('hud-buy-why', `You carry ${DRAUGHT_CARRY} already.`));
    else if (u.gold < eff)
      d.appendChild(mk('hud-buy-why', `You need ${Math.ceil(eff - u.gold)} more gold.`));
  }

  // One feed line per champion death, team-colored.
  pushKills(kills: readonly RoyaleKill[]): void {
    if (kills.length === 0) return;
    // The battle royale's deaths take their own path (royaleKills): every
    // champion for themself, named by the death itself.
    if (this.royale) {
      this.royaleKills(kills, this.royale);
      return;
    }
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
              : killerUnit2?.kind === 'creature' && killerUnit2.creatureId
                ? `Killed by the ${CREATURES[killerUnit2.creatureId].name}`
                : killerUnit2?.kind === 'camp' && killerUnit2.campKind
                  ? `Killed by the ${CAMPS[killerUnit2.campKind].name}`
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
      let killerColor = killerRow ? TEAM_TEXT_COLORS[this.look(killerRow.team)] : '#c9d8ae';
      if (!killerRow) {
        const killerUnit = this.world.units.get(k.killerId);
        if (killerUnit?.kind === 'tower') killerName = 'A tower';
        else if (killerUnit?.kind === 'minion') killerName = 'Minions';
        if (killerUnit) killerColor = TEAM_TEXT_COLORS[this.look(killerUnit.team)];
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
      victim.style.color = TEAM_TEXT_COLORS[this.look(victimRow.team)] ?? '#c9d8ae';
      entry.append(killer, middle, victim);
      this.feed.appendChild(entry);
      window.setTimeout(() => entry.remove(), 6000);
    }
  }

  // The battle royale's deaths: the own death and the own takedown said
  // and heard, the recap under SLAIN, every champion's death a line of the
  // feed with its bot marks or one more folded "elsewhere", and the loud
  // moments it calls (ui/royale_hud_moments.ts): First blood, the double
  // and the triple, a run Ablaze, Payback. A call that speaks replaces the
  // ordinary line's voice rather than talking over it. A camp or a
  // creature dying is no takedown and says nothing. Names come with the
  // death on the wire, since the feed names champions this screen never
  // saw.
  private royaleKills(kills: readonly RoyaleKill[], royale: RoyaleHud): void {
    for (const k of kills) {
      const { calls, champion } = royale.kill(k);
      const spoken = calls.some((c) => c.voice !== undefined);
      if (k.unitId === this.selfId) {
        playSfx('death');
        if (!spoken) announceVoice('self_slain', true, true);
        this.deathRecap =
          k.killerId === k.unitId || k.killerId === 0
            ? 'Burned by the Dusk'
            : this.royaleVariant === 'respawn'
              ? this.respawnRecap(k, royale)
              : `Taken down by ${royale.killerName(k)}`;
      } else if (k.killerId === this.selfId && champion) {
        this.royaleLife.tookDown();
        playSfx('kill');
        this.announce(`You took down ${royale.victimName(k)}`, '#ffd94a');
        if (!spoken) announceVoice('self_kill', true, true);
      }
      royale.play(calls);
    }
  }

  // Respawn's recap: who, and how close it was. The killer's body is read
  // as last seen (ui/royale_life.ts SeenChampions), the death having taken
  // the sight that showed it, and frozen in the line.
  private respawnRecap(k: RoyaleKill, royale: RoyaleHud): string {
    const time = this.world.time;
    const body = this.royaleSeen.body(k.killerId, this.world.units.get(k.killerId), time);
    const def = body ? this.world.championDef(body.championId) : null;
    return royaleRecap(
      royale.killerName(k),
      body && def
        ? {
            champion: def.name,
            level: body.level,
            hpShare: body.maxHp > 0 ? body.hp / body.maxHp : 0,
          }
        : null,
    );
  }

  // Called once per world tick.
  // The status row's chips, one element a key, kept across frames: a new
  // key gets an element, a kept one has its number and its tip refreshed,
  // a gone one leaves. Rebuilding the row every frame destroyed the chip
  // under the mouse before its tooltip could show.
  private reconcileChips(wanted: { key: string; face: ChipFace; look: ChipLook | null }[]): void {
    const alive = new Set(wanted.map((w) => w.key));
    for (const child of [...this.statusRow.children]) {
      if (!alive.has((child as HTMLElement).dataset.key ?? '')) child.remove();
    }
    let cursor = 0;
    for (const w of wanted) {
      let box = [...this.statusRow.children].find(
        (c) => (c as HTMLElement).dataset.key === w.key,
      ) as HTMLElement | undefined;
      if (!box) {
        box = document.createElement('span');
        box.className = 'hud-chip';
        box.dataset.key = w.key;
        const glyph = document.createElement('span');
        glyph.className = 'hud-chip-glyph';
        const sub = document.createElement('span');
        sub.className = 'hud-chip-sub';
        const tip = document.createElement('span');
        tip.className = 'hud-chip-tip';
        box.append(glyph, sub, tip);
      }
      if (w.look) {
        box.style.borderColor = w.look.border;
        box.style.color = w.look.color;
        box.style.background = w.look.background;
      }
      const [glyph, sub, tip] = box.children as unknown as [HTMLElement, HTMLElement, HTMLElement];
      if (glyph.textContent !== w.face.glyph) glyph.textContent = w.face.glyph;
      if (sub.textContent !== w.face.sub) sub.textContent = w.face.sub;
      sub.style.display = w.face.sub ? '' : 'none';
      if (tip.textContent !== w.face.tip) tip.textContent = w.face.tip;
      const at = this.statusRow.children[cursor];
      if (at !== box) this.statusRow.insertBefore(box, at ?? null);
      cursor += 1;
    }
  }

  update(): void {
    const u = this.world.units.get(this.selfId);
    if (!u) return;

    if (!this.openedOpeningShop) {
      this.openedOpeningShop = true;
      // Only at the top of a live match: a rejoin or a replay opens to the
      // game, not to a shop nobody asked for.
      if (this.world.time < 5 && this.world.winner === null) {
        this.setShopOpen(true);
        this.openingShopUp = true;
      } else {
        // The feedback line likewise: the start of a match only.
        this.nudge = { ...this.nudge, done: true };
      }
    }
    // The lane card is not held to the top of the match: a slow load, a
    // rejoin and a newcomer dropped into a seat are all told their lane.
    this.stepLaneGuide(u);
    this.stepNudge();
    this.stepFirstSteps(u);
    this.stepHints();

    if (this.spotUntil !== 0 && performance.now() > this.spotUntil) {
      this.spotUntil = 0;
      this.spotEl.classList.remove('on');
    }
    if (this.announceUntil !== 0 && performance.now() > this.announceUntil) {
      this.announceKept = false;
      const next = this.announceNext.shift();
      if (next) {
        this.announce(next.text, next.color, next.holdMs);
      } else {
        this.announceEl.style.opacity = '0';
        this.announceUntil = 0;
      }
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
    if (!this.royale && this.lastTowerCount !== null && towerCount < this.lastTowerCount) {
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
    // (works identically offline and online, no extra wire events). The
    // Boon is a team's claim: a battle royale never announces its edges
    // (ADR 0031), and hides the line.
    if (this.royale) this.lastWardenUp = null;
    const objAt = this.world.objectiveSpawnAt();
    const wardenUp = objAt === null;
    const rings = this.world.ringClocks();
    const pit = this.world.wardenPit() ?? undefined;
    setText(this.metaText, `${clock} · ${objectiveLine(rings, objAt, this.world.time, pit)}`);
    const mineBoon = this.world.teamBuff(this.selfTeam);
    const enemyBoon = this.world.teamBuff(otherTeam(this.selfTeam));
    if (this.lastWardenUp !== null && wardenUp !== this.lastWardenUp) {
      if (wardenUp) {
        this.announce(
          pit ? `The Warden has awoken at the ${pit.name}` : 'The Warden has awoken',
          '#d8a6f5',
        );
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
    const mineFavors = this.world.teamFavors(this.selfTeam);
    const enemyFavors = this.world.teamFavors(otherTeam(this.selfTeam));
    this.announceRings(rings, mineFavors, enemyFavors);
    setText(this.levelBadge, String(u.level));
    setText(this.goldText, `${Math.floor(u.gold)}g`);
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
    setText(
      this.hpText,
      shield > 0
        ? `${Math.ceil(u.hp)} (+${Math.round(shield)}) / ${Math.round(u.maxHp)}`
        : `${Math.ceil(u.hp)} / ${Math.round(u.maxHp)}`,
    );
    this.manaFill.style.transform = `scaleX(${Math.max(0, u.mana / u.maxMana)})`;
    setText(this.manaText, `${Math.floor(u.mana)} / ${Math.round(u.maxMana)}`);
    const xpFrac = u.level >= MAX_LEVEL ? 1 : Math.min(1, u.xp / xpForNext(u.level));
    this.xpFill.style.transform = `scaleX(${xpFrac})`;
    setText(
      this.xpText,
      u.level >= MAX_LEVEL ? 'max level' : `XP ${Math.floor(u.xp)} / ${xpForNext(u.level)}`,
    );

    // Every chip is an icon (chip_text.ts): a glyph, a small number, and
    // the whole fact in a tooltip on hover; the row of full sentences took
    // too much of the screen (the maintainer, after the forest round). The
    // chips are gathered here and reconciled by key below, so an element
    // survives from frame to frame and the hover holds on it.
    const wanted: { key: string; face: ChipFace; look: ChipLook | null }[] = [];
    const chip = (key: string, face: ChipFace, look: ChipLook | null): void => {
      wanted.push({ key, face, look });
    };
    const enemyLook = { border: '#e86a7a', color: '#ffc8ce', background: '#3d1a20' };
    // The Warden's Boon is a team buff, not a Status: its chips are built
    // here, and they SAY what the buff does. The enemy's shows too: a team
    // hitting 8 or 16 percent harder is a fact a player must see to respect.
    if (mineBoon) {
      const pct = Math.round(BOON_DAMAGE_PER_STACK * mineBoon.stacks * 100);
      chip('boon', boonChipFace(pct, mineBoon.until - this.world.time, false), {
        border: '#a06ae8',
        color: '#e6c8ff',
        background: '#2c1a3d',
      });
    }
    if (enemyBoon) {
      const pct = Math.round(BOON_DAMAGE_PER_STACK * enemyBoon.stacks * 100);
      chip('boon-enemy', boonChipFace(pct, enemyBoon.until - this.world.time, true), enemyLook);
    }
    // The Wrath (CONTEXT.md) is a team fact like the Boon: a chip that says
    // what it does, the enemy's too, since an execute line is a fact a
    // player must see to respect.
    for (const [enemy, until] of [
      [false, this.world.teamWrath(this.selfTeam)],
      [true, this.world.teamWrath(otherTeam(this.selfTeam))],
    ] as const) {
      if (until === null) continue;
      chip(
        enemy ? 'wrath-enemy' : 'wrath',
        wrathChipFace(wrathChipText(until, this.world.time), until - this.world.time, enemy),
        enemy
          ? enemyLook
          : { border: WRATH_COLOR.css, color: WRATH_COLOR.css, background: WRATH_COLOR.dark },
      );
    }
    // The favors (CONTEXT.md: Favor) are team facts like the Boon: a chip
    // each, saying what it does, the enemy's too.
    for (const [enemy, stacks] of [
      [false, mineFavors],
      [true, enemyFavors],
    ] as const) {
      for (const favor of favorChips(stacks)) {
        const look = aspectColor(favor.aspect);
        chip(
          `favor-${enemy ? 'enemy-' : ''}${favor.aspect}`,
          favorChipFace(favor.aspect, favor.stacks, favor.text, enemy),
          enemy ? enemyLook : { border: look.css, color: look.css, background: look.dark },
        );
      }
    }
    // A status an aura keeps renewing shows without a countdown
    // (chip_text.ts AuraWatch: Torv's own Bulwark read "Boost 1s" all match).
    const seen = new Map<string, number>();
    const standing = new Map<string, number>();
    const shown: [Status, string, number][] = [];
    for (const s of u.statuses) {
      if (s.until <= this.world.time) continue;
      const n = (seen.get(s.kind) ?? 0) + 1;
      seen.set(s.kind, n);
      const key = statusKey(s, n);
      standing.set(key, s.until - this.world.time);
      shown.push([s, key, n]);
    }
    this.auraWatch.step(standing);
    // A Respawn Arrival's Grace counts to its floor, then waits on a move.
    const graceFrom = this.royale ? ownGraceFloor(this.world.royaleView?.(), this.selfId) : null;
    for (const [s, key, n] of shown) {
      const face =
        s.kind === 'untargetable' && graceFrom !== null
          ? graceWaitChip(graceFrom, this.world.time)
          : statusChip(s, this.world.time, this.auraWatch.held(key));
      chip(`status-${s.kind}-${n}`, face, null);
    }
    this.reconcileChips(wanted);

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
        setText(
          slot.cd,
          key === 'R' && u.level < ULT_RANK_LEVELS[0]! ? `Lv${ULT_RANK_LEVELS[0]}` : '+',
        );
      } else if (remaining > 0) {
        slot.cd.style.display = 'flex';
        setText(slot.cd, remaining >= 1 ? String(Math.ceil(remaining)) : remaining.toFixed(1));
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
      // The sim's rule for a skill point (ui/slot_tap.ts).
      slot.up.style.display = rankable(u, key) ? 'block' : 'none';
      const cost = def ? def.abilities[key].manaCost : 0;
      slot.root.classList.toggle('nomana', u.mana < cost);
    }

    for (let i = 0; i < this.sigilSlots.length; i++) {
      const slot = this.sigilSlots[i]!;
      const remaining = (u.sigilCooldowns[i] ?? 0) - this.world.time;
      if (remaining > 0) {
        slot.cd.style.display = 'flex';
        setText(slot.cd, String(Math.ceil(remaining)));
      } else {
        slot.cd.style.display = 'none';
      }
    }

    const drinking = draughtLeft(u, this.world.time) > 0;
    for (let i = 0; i < this.invSlots.length; i++) {
      const itemId = u.items[i];
      const slot = this.invSlots[i]!;
      const def = itemId ? ITEMS[itemId] : undefined;
      slot.classList.toggle('full', itemId !== undefined);
      // A Sapdraught waits greyed while another is being drunk.
      slot.classList.toggle('waiting', def?.drink !== undefined && drinking);
      if (def) {
        setText(slot, '');
        slot.style.backgroundImage = `url(${itemIconUrl(def)})`;
        slot.style.backgroundSize = 'cover';
      } else {
        setText(slot, itemId ? itemInitials(itemId) : '');
        slot.style.backgroundImage = '';
      }
    }

    if (this.shop.classList.contains('open')) {
      const shopOk = this.canShop();
      // The next item of the build a house bot of this champion follows
      // (ui/shop_suggestion.ts), lit, and shown in the detail pane with
      // its Buy button until the player picks something of their own.
      const suggestion = suggestedItem(u.championId, u.items);
      if (
        suggestion !== null &&
        (this.shopSelected === null ||
          (this.shopPickedSuggestion && this.shopSelected !== suggestion))
      ) {
        this.shopSelected = suggestion;
        this.shopPickedSuggestion = true;
        this.lastDetailSig = '';
      }
      this.shopStatus.textContent = u.dead
        ? 'Dead, so spend the wait: buying works from here.'
        : shopOk
          ? suggestion !== null
            ? 'The glowing item suits your champion: Buy, or double-click an item.'
            : 'Click an item to inspect it; Buy or double-click to purchase.'
          : 'Browse anywhere; buying needs your fountain.';
      this.shopGoldText.textContent = `${Math.floor(u.gold)}g`;
      for (const item of [...ITEM_LIST, ...CONSUMABLE_LIST]) {
        const btn = this.itemButtons.get(item.id);
        if (btn) {
          const cost = effectiveItemCost(item.id, u.items);
          const full = item.drink !== undefined && !mayCarryDraught(u.items);
          btn.classList.toggle('cant', !shopOk || u.gold < cost || full);
          btn.classList.toggle('sel', item.id === this.shopSelected);
          btn.classList.toggle('suggested', item.id === suggestion);
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
        const tint = TEAM_PORTRAIT_COLORS[this.look(target.team)] ?? 0xd65c5c;
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
                  : target.kind === 'creature' && target.creatureId
                    ? CREATURES[target.creatureId].name
                    : target.kind === 'camp'
                      ? CAMPS[target.campKind ?? 'spinecrest'].name
                      : 'Minion';
          const look = aspectColor(target.aspect);
          this.targetPortrait.src =
            target.kind === 'warden'
              ? iconDataUrl('W', '#3d2a5a', '#a06ae8')
              : target.kind === 'creature'
                ? iconDataUrl(label[0] ?? '?', look.dark, look.css)
                : iconDataUrl(label[0] ?? '?', '#5a1f1f', '#a04040');
          this.targetName.textContent =
            target.kind === 'creature' && target.aspect
              ? `${label} (${ASPECTS[target.aspect].name})`
              : label;
        }
        this.targetName.style.color =
          target.kind === 'warden'
            ? '#d8a6f5'
            : target.kind === 'creature'
              ? aspectColor(target.aspect).css
              : (TEAM_TEXT_COLORS[this.look(target.team)] ?? '#f5a3a3');
      }
      this.targetHpFill.style.transform = `scaleX(${Math.max(0, target.hp / target.maxHp)})`;
      setText(this.targetHpText, `${Math.ceil(target.hp)} / ${Math.round(target.maxHp)}`);
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
      setText(this.kdaText, `${selfRow.kills} / ${selfRow.deaths} / ${selfRow.assists ?? 0}`);
      setText(this.kdaCs, `CS ${selfRow.cs ?? 0}`);
    }

    if (this.score.classList.contains('open')) {
      for (const team of [0, 1] as const) {
        renderScoreboardTeam(this.scoreTeams[team], scoreRows, team, this.selfId);
      }
    }

    if (this.royale) {
      // The battle royale's own wash (ui/royale_hud.ts), gone once its end
      // screen stands; and its own end screen, from the server's result.
      this.royale.update();
      const time = this.world.time;
      const inPlay = this.world.royaleView?.()?.st === 'play';
      // A life begun: the last death's recap is done with, or the next
      // wash would open on it until its own note comes.
      if (this.royaleLife.step(time, inPlay, u.dead, selfRow)) this.deathRecap = '';
      this.royaleSeen.note(this.world.units.values(), this.selfId, time);
      const dead = u.dead && !this.royale.resultShown();
      this.deathOverlay.classList.toggle('open', dead);
      if (dead) {
        const words = this.royale.deathWords(u);
        if (this.deathTitle.textContent !== words.title) this.deathTitle.textContent = words.title;
        setText(this.deathSub, this.deathRecap ? `${this.deathRecap} · ${words.sub}` : words.sub);
      }
      // Respawn only: what the life that just ended held.
      const life = dead && this.royaleVariant === 'respawn' ? this.royaleLife.line(selfRow) : null;
      if (life !== null) setText(this.deathLife, life);
      if (this.deathLife.hidden !== (life === null)) this.deathLife.hidden = life === null;
      const view = this.world.royaleView?.() ?? null;
      // And who carries the Burr of it: the next life's target.
      const burr = dead
        ? burrWashLine(view, time, (id) => this.world.seat?.(id)?.name ?? null)
        : null;
      if (burr !== null) setText(this.deathBurr, burr);
      if (this.deathBurr.hidden !== (burr === null)) this.deathBurr.hidden = burr === null;
      // The wait's globe: the lines up top, and what a tap on it does.
      const globe = dead && view !== null && returnGlobeOn(view, u, time);
      this.deathOverlay.classList.toggle('returning', globe);
      this.rootEl.classList.toggle('wait-globe', globe);
      const hint = globe ? returnHint(this.coarsePointer, view?.bk !== undefined) : null;
      if (hint !== null) setText(this.deathHint, hint);
      if (this.deathHint.hidden !== (hint === null)) this.deathHint.hidden = hint === null;
      this.syncOverlay();
      return;
    }
    this.deathOverlay.classList.toggle('open', u.dead);
    if (u.dead) {
      const respawn = `Respawn in ${Math.max(0, u.respawnAt - this.world.time).toFixed(1)}s`;
      this.deathSub.textContent = this.deathRecap ? `${this.deathRecap} · ${respawn}` : respawn;
    }

    const winner = this.world.winner;
    this.endOverlay.classList.toggle('open', winner !== null);
    this.syncOverlay();
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
      const own = rows.find((r) => r.unitId === this.selfId);
      const def = u.championId ? this.world.championDef(u.championId) : null;
      // The place the match left the player on the ladder, when it scored.
      if (this.scores()) this.endLadder.refresh();
      const offer = accountOffer({
        guest: this.guest,
        scored: this.scores(),
        won: winner === this.selfTeam,
        kills: own?.kills ?? 0,
        deaths: own?.deaths ?? 0,
        assists: own?.assists ?? 0,
        champion: def?.name ?? null,
      });
      if (offer) {
        this.endOfferLine.textContent = offer.line;
        this.endOfferReason.textContent = offer.reason;
        this.endOffer.classList.add('open');
      }
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
