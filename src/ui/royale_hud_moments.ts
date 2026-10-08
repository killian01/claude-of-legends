// The battle royale HUD's loud moments (ADR 0031, ui/royale_moments.ts
// decides them): mounted by the royale layer (ui/royale_hud.ts) beside its
// top line and its notices. It plays the calls (a spotlight or the
// announcement line, a recorded voice, a synthesized sound, the music
// dipping), keeps the kill feed with what matters to the viewer and folds
// the rest into "+N elsewhere", runs the cache's ritual (rising ticks, the
// chest, the piece flying into its bag slot, the crack), tolls the Dusk
// with a red pulse and blows its wind outside the light, hears the
// Clamors by bearing, rides the music on the match and the viewer's
// health, and points at the Seedfalls from the screen's edge. The world's
// side of a moment (the camera's punch, a chest's burst) goes to the
// renderer as a cue (render/royale_cues.ts).

import { announceVoice } from '../game/announcer';
import { setDuskWind, stopDuskWind } from '../game/dusk_sound';
import { rectOnStage, stageSizeOf } from '../game/match_stage';
import { duckMusic, setHeartbeat, setMusicIntensity } from '../game/music';
import { playSfx } from '../game/sfx';
import type { RoyaleNote } from '../net/royale_client';
import type { SnapCache, SnapClamor, SnapDusk, SnapRoyale } from '../net/royale_wire';
import { royaleProjector, sendRoyaleCue } from '../render/royale_cues';
import { ITEMS } from '../sim/content/items';
import type { RoyaleVariant } from '../sim/royale/types';
import type { TeamId } from '../sim/types';
import type { IWorld } from '../world_api';
import { itemIconUrl } from './icons';
import { BURR_COLOR, burrTarget } from './royale_burr';
import {
  compactRing,
  EdgeChimes,
  type EdgeRect,
  type EdgeTarget,
  type EdgeView,
  edgeArrows,
  layoutArrows,
  seedfallPointed,
} from './royale_edges';
import { huntedCalls, huntedTargets, RisingWatch, risenCalls } from './royale_hunted';
import {
  COMPACT_DONE_MAX_W_PX,
  COMPACT_NOTE_MAX_W_PX,
  SPOT_FADE_MS,
  spotCoverMs,
  THUMBS_NOTES_BOTTOM_PX,
  THUMBS_NOTES_LEFT_PCT,
} from './royale_layout';
import {
  arcDistance,
  ClamorBell,
  ClamorEar,
  duskDepth,
  duskTickOnly,
  duskTolls,
  elsewhereText,
  FEED_MS,
  type FeedTier,
  FoldCount,
  feedLife,
  feedOverflow,
  feedTier,
  foldsOut,
  frostLevel,
  heartbeat,
  impactGain,
  impactShake,
  lastMarkPoint,
  type MomentCall,
  type MomentKill,
  musicIntensity,
  newsNear,
  OpeningRitual,
  panOf,
  RoyaleMoments,
  SeedfallRush,
  wirePoint,
} from './royale_moments';
import { BUILD_COMPLETE, buildComplete, lootNotice, openingFraction } from './royale_text';

// How long a spotlight stays up, milliseconds (the feed's lines and its
// fold keep ui/royale_moments.ts feedLife).
const SPOT_MS = 2800;
// How often the obstacles are measured (an arrow's own room is
// ui/royale_edges.ts arrowBox).
const OBSTACLES_MS = 500;
// How high above its ground an arrow aims at a column.
const ARROW_LIFT_M = 2;
// The piece's flight into its bag slot, milliseconds.
const FLIGHT_MS = 650;

const CSS = `
.br-spot { position: absolute; left: 50%; top: 30%; transform: translateX(-50%) scale(0.82);
  font-family: Cinzel, Georgia, serif; font-size: 50px; font-weight: 900; letter-spacing: 5px;
  white-space: nowrap; text-shadow: 0 3px 18px #000, 0 0 32px currentColor; opacity: 0;
  transition: opacity ${SPOT_FADE_MS}ms ease-out, transform ${SPOT_FADE_MS}ms ease-out;
  pointer-events: none; }
.br-spot.on { opacity: 1; transform: translateX(-50%) scale(1); }
.br-spot.top { font-size: 66px; letter-spacing: 8px; }
.br-feed-line.fold { color: #a9a48c; border-color: #2a2618; font-style: italic; }
/* News from afar (ui/royale_moments.ts newsCall): a line of the feed in
   the mark's own color, cut short like a name rather than wrapped. */
.br-feed-line.news { font-weight: 700; }
.br-feed-line.news span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.br-note.done { color: #fff1b8; border-color: #f0c860; box-shadow: 0 0 18px rgba(240, 200, 96, 0.55); }
.br-note.whole { color: #241a08; border-color: #f0deae; padding-left: 14px;
  background: linear-gradient(180deg, #e8cc74 0%, #c9a84a 55%, #a07830 100%); text-shadow: none; }
.br-open.cracked .br-ring { background: conic-gradient(#ff4a3a 1turn, transparent 0);
  box-shadow: 0 0 22px rgba(255, 60, 40, 0.9); }
.br-open.cracked b { color: #ff9a8a; }
.br-pulse { position: absolute; inset: 0; pointer-events: none; opacity: 0;
  background: radial-gradient(ellipse at center, transparent 40%, rgba(200, 20, 30, 0.55) 100%); }
.br-pulse.on { animation: br-pulse 1s ease-out; }
@keyframes br-pulse { 0% { opacity: 0; } 18% { opacity: 1; } 100% { opacity: 0; } }
.br-edges { position: absolute; inset: 0; pointer-events: none; z-index: 6; overflow: hidden; }
.br-edge { position: absolute; width: 0; height: 0; }
.br-edge i { position: absolute; left: -13px; top: -13px; width: 26px; height: 26px;
  border-radius: 50%; background: radial-gradient(circle at 40% 40%, #fff6cf, #e8c060 60%, #8a6420);
  box-shadow: 0 0 14px rgba(255, 220, 120, 0.85); }
.br-edge i::after { content: ''; position: absolute; left: 21px; top: 6px; width: 0; height: 0;
  border-top: 7px solid transparent; border-bottom: 7px solid transparent;
  border-left: 11px solid #ffe7a0; filter: drop-shadow(0 0 3px rgba(0, 0, 0, 0.8)); }
/* The distance under the dial, slid in from the screen's side when the
   arrow stands at it (ui/royale_edges.ts labelShift). */
.br-edge b { position: absolute; left: 0; top: 15px; white-space: nowrap; text-align: center;
  transform: translateX(-50%); font: 800 11.5px system-ui, sans-serif; color: #ffe7a0;
  text-shadow: 0 1px 3px #000; font-variant-numeric: tabular-nums; }
/* The Risings and the hunted keep the dial's shape in their own colors
   (ui/royale_hunted.ts). */
.br-edge[data-kind='rising'] i { background: radial-gradient(circle at 40% 40%, #ffe2c8, #ff8a3c 60%, #7a2a08);
  box-shadow: 0 0 14px rgba(255, 140, 60, 0.85); }
.br-edge[data-kind='rising'] b { color: #ffc89a; }
.br-edge[data-kind='wrath'] i { background: radial-gradient(circle at 40% 40%, #ffffff, #d8ccff 60%, #4a3a80);
  box-shadow: 0 0 14px rgba(230, 220, 255, 0.9); }
.br-edge[data-kind='wrath'] b { color: #efe8ff; }
.br-edge[data-kind='lodestar'] i { background: radial-gradient(circle at 40% 40%, #fffbe0, #ffd24a 60%, #8a6a10);
  box-shadow: 0 0 14px rgba(255, 214, 80, 0.9); }
.br-edge[data-kind='ablaze'] i { background: radial-gradient(circle at 40% 40%, #ffe0c0, #ff7a2a 60%, #6a1a04);
  box-shadow: 0 0 14px rgba(255, 120, 40, 0.85); }
.br-edge[data-kind='ablaze'] b { color: #ffb070; }
/* The own Burr's carrier (ui/royale_burr.ts): a thorn's red. */
.br-edge[data-kind='burr'] i { background: radial-gradient(circle at 40% 40%, #ffe0e8, ${BURR_COLOR} 60%, #6a0a24);
  box-shadow: 0 0 14px rgba(255, 90, 130, 0.9); }
.br-edge[data-kind='burr'] b { color: ${BURR_COLOR}; }
.br-flight { position: absolute; width: 34px; height: 34px; border-radius: 7px; pointer-events: none;
  border: 1px solid #f0c860; box-shadow: 0 0 16px rgba(240, 200, 96, 0.9); z-index: 7; }
/* A phone: a loot line that says what the piece adds runs long, so it
   wraps in a column between the thumb stick and the ability buttons, and
   sits clear above the bar. */
.hud.compact .br-note { white-space: normal; max-width: ${COMPACT_NOTE_MAX_W_PX}px; line-height: 1.25; }
/* A finished item and the whole build hold one line (it wrapped to
   "Completed: Doombrand ·" over "Deathmark"): every such line fits
   (ui/royale_layout.ts compactNoteWidth), and one that did not would be
   cut short rather than wrap. */
.hud.compact .br-note.done, .hud.compact .br-note.whole { white-space: nowrap;
  max-width: ${COMPACT_DONE_MAX_W_PX}px; box-sizing: border-box; }
.hud.compact .br-note.done span, .hud.compact .br-note.whole span { min-width: 0;
  overflow: hidden; text-overflow: ellipsis; }
.hud.compact.thumbs .br-notes { left: ${THUMBS_NOTES_LEFT_PCT}%;
  bottom: ${THUMBS_NOTES_BOTTOM_PX}px; }
.hud.compact .br-spot { font-size: 26px; letter-spacing: 3px;
  top: calc(98px + var(--safe-top, env(safe-area-inset-top, 0px))); }
.hud.compact .br-spot.top { font-size: 34px; letter-spacing: 4px; }
/* There it stands in the first steps' band: the card steps aside while it
   shows, from the spotlight's first frame (no fade: "WILDFIRE" was drawn
   across the card while it faded) to the end of its fade out
   (ui/royale_layout.ts spotCoverMs). */
.hud.compact.br-spotting .hud-steps { visibility: hidden; opacity: 0; transition: none; }
`;

// A death as the HUD gets it (ui/royale_hud.ts RoyaleKill).
export interface MomentDeath {
  unitId: number;
  killerId: number;
  n?: string;
  kn?: string;
  vb?: boolean;
  kb?: boolean;
}

export interface MomentsHost {
  root: HTMLElement;
  world: IWorld;
  selfId: number;
  selfTeam: TeamId;
  variant: RoyaleVariant;
  // The royale layer's feed column and notices (ui/royale_hud.ts).
  feed: HTMLElement;
  notice(text: string, icon: string | null, kind: 'loot' | 'level' | 'done' | 'whole'): void;
  // A kept announcement holds its line for `holdMs` (ui/hud.ts announce).
  announce(text: string, color: string, holdMs?: number, keep?: boolean): void;
  // The names a feed line shows, and whether a seat is a bot.
  victimName(k: MomentDeath): string;
  killerName(k: MomentDeath): string;
  botOf(unitId: number): boolean;
  // The opening's ring turns red for a moment (a broken opening).
  crackRing(): void;
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

type View = SnapRoyale & { caches: SnapCache[] };

export class RoyaleHudMoments {
  private readonly moments: RoyaleMoments;
  private readonly ritual = new OpeningRitual();
  private readonly ear = new ClamorEar();
  private readonly bell = new ClamorBell();
  // The Clamors of a tick wait one tick: the tick's deaths are read after
  // its state, and a takedown the viewer made or saw rings nothing.
  private clamorsDue: SnapClamor[] = [];
  private readonly rush = new SeedfallRush();
  // The Risings that came up since the last tick (ui/royale_hunted.ts).
  private readonly risings = new RisingWatch();
  private readonly chimes = new EdgeChimes();
  private readonly style: HTMLStyleElement;
  private readonly spot: HTMLElement;
  private readonly pulse: HTMLElement;
  private readonly edges: HTMLElement;
  private readonly arrows = new Map<string, HTMLElement>();
  private spotTimer = 0;
  private fold: HTMLElement | null = null;
  private readonly folded = new FoldCount(FEED_MS);
  private lastDusk: SnapDusk | null = null;
  // The viewer's health over the last two ticks, for a takedown's heal.
  private hpNow = -1;
  private hpBefore = -1;
  private lastCombat = Number.NEGATIVE_INFINITY;
  // When the viewer last took a hit (the Dusk's burn aside), sim time.
  private lastHit = Number.NEGATIVE_INFINITY;
  // The cache the viewer last opened, where its piece flies from.
  private openedCache: number | null = null;
  private wasWhole = false;
  // Caches by id as last listed, for where an opened one stood.
  private readonly cachesAt = new Map<number, [number, number, number]>();
  private obstacles: EdgeRect[] = [];
  private obstaclesAt = 0;
  // The open Graft cards' box, which no arrow's line stands on, and
  // whether they were open at the last look (opened or closed, the boxes
  // are measured again at once).
  private covers: EdgeRect[] = [];
  private cardsOpen = false;
  // The phone's safe-area insets, pixels, measured with the obstacles.
  private insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private raf = 0;
  private disposed = false;

  constructor(private readonly host: MomentsHost) {
    this.moments = new RoyaleMoments(host.variant, host.selfId);
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.spot = el('div', 'br-spot');
    this.pulse = el('div', 'br-pulse');
    host.root.append(this.pulse, this.spot);
    // The arrows stand on the stage, beside the HUD and outside its zoom,
    // so they share the projection's pixels.
    this.edges = el('div', 'br-edges');
    (host.root.parentElement ?? host.root).appendChild(this.edges);
    const frame = (): void => {
      if (this.disposed) return;
      this.placeArrows();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private view(): View | null {
    return this.host.world.royaleView?.() ?? null;
  }

  // Once per world tick, before the tick's deaths and notes are read.
  step(r: View | null): void {
    const { world, selfId } = this.host;
    if (!r) return;
    const time = world.time;
    this.moments.seeStage(r.st);
    if (this.fold) this.showFold();
    for (const c of r.caches) this.cachesAt.set(c[0], [c[1], c[2], c[3]]);
    const me = world.units.get(selfId);

    // The viewer's health, for the heal a takedown gives and the fight: a
    // hit taken, the Dusk's own burn aside.
    if (me) {
      const drop = this.hpNow >= 0 ? this.hpNow - me.hp : 0;
      const out = !me.dead && r.st === 'play' && (duskDepth(me.pos, r.dusk) ?? 0) > 0;
      if (drop > 0.5 && !me.dead && !duskTickOnly(drop, me.maxHp, r.dusk.b, out)) {
        this.lastCombat = time;
        this.lastHit = time;
      }
      this.hpBefore = this.hpNow;
      this.hpNow = me.hp;
    }

    // The cache's ritual.
    const f = openingFraction(r, time);
    for (const beat of this.ritual.step(r.opening?.c ?? null, f)) {
      if (beat.kind === 'tick') playSfx('tick', 0.8, { pitch: beat.pitch });
      else {
        playSfx('crack');
        this.host.crackRing();
        sendRoyaleCue({ kind: 'cache_crack', cacheId: beat.cacheId });
      }
    }

    // The Dusk: a toll and a red pulse on a closing; the wind outside.
    if (duskTolls(this.lastDusk, r.dusk)) {
      playSfx('toll');
      this.pulse.classList.remove('on');
      void this.pulse.offsetWidth;
      this.pulse.classList.add('on');
    }
    this.lastDusk = r.dusk;
    const depth = me && !me.dead && r.st === 'play' ? duskDepth(me.pos, r.dusk) : null;
    setDuskWind(frostLevel(depth));

    // The score: its weight by the match and the fight, the heart under it.
    const since = Number.isFinite(this.lastCombat) ? time - this.lastCombat : null;
    setMusicIntensity(musicIntensity(r.st, r.dusk.p, since));
    setHeartbeat(me ? heartbeat(me.hp, me.maxHp, me.dead) && r.st === 'play' : false);

    // The Clamors: the loudest out of sight, a clash by bearing, quieter
    // with distance, at most one every second and a half.
    const self = me && me.pos.y !== undefined ? me.pos : null;
    const due = this.clamorsDue;
    this.clamorsDue = this.ear.fresh(r.cl, time);
    const clash = self ? this.bell.pick(due, self, time) : null;
    if (clash) {
      const bearing = royaleProjector()?.bearing(clash.at) ?? 0;
      playSfx('clash', 0.9 * clash.gain, { pan: panOf(bearing) });
    }

    // A Rising come up: its call (the Warden's in the recorded voice).
    if (r.st === 'play') this.play(risenCalls(this.risings.step(r.ri).risen));

    // A seed's rush leads into its landing, by distance and bearing.
    for (const id of this.rush.step(r.sf, time)) {
      const s = r.sf?.find((x) => x[0] === id);
      if (!s || !self) continue;
      const at = { x: s[1], y: s[2], z: s[3] };
      const bearing = royaleProjector()?.bearing(at) ?? 0;
      playSfx('whoosh', impactGain(arcDistance(self, at)), { pan: panOf(bearing) });
    }
  }

  // A death of the snapshot: the feed's line or its fold, and the calls it
  // makes. Answers the calls (played by play(), after the HUD's own line)
  // and whether the death was a champion's.
  kill(k: MomentDeath): { calls: MomentCall[]; champion: boolean } {
    const { world, selfId } = this.host;
    const isChampion = (id: number): boolean => world.units.get(id)?.kind === 'champion';
    // A champion's death carries the victim's name on the wire.
    const champion = k.n !== undefined || isChampion(k.unitId);
    if (!champion) return { calls: [], champion };
    const killerChampion =
      k.killerId !== 0 && k.killerId !== k.unitId && (k.kn !== undefined || isChampion(k.killerId));
    const m: MomentKill = {
      unitId: k.unitId,
      killerId: k.killerId,
      victimChampion: true,
      killerChampion,
    };
    const calls = this.moments.onKill(m, world.time);
    // A takedown the viewer made, took or saw is no Clamor from afar.
    const victim = world.units.get(k.unitId);
    const seen =
      k.killerId === selfId || k.unitId === selfId || world.isVisible(this.host.selfTeam, k.unitId);
    if (seen && victim && victim.pos.y !== undefined) this.bell.seen(victim.pos, world.time);
    if (k.killerId === selfId && killerChampion) {
      this.lastCombat = world.time;
      const heal = this.hpBefore >= 0 ? Math.round(this.hpNow - this.hpBefore) : 0;
      sendRoyaleCue({ kind: 'takedown', heal: Math.max(0, heal) });
    }
    this.feedLine(k);
    return { calls, champion };
  }

  // Plays calls: the spotlight or the announcement, the voice, the sound;
  // news from afar as one quiet line of the feed.
  play(calls: readonly MomentCall[]): void {
    for (const c of calls) {
      if (c.feed) {
        this.newsLine(c);
        continue;
      }
      if (c.spotlight) this.spotlight(c);
      else this.host.announce(c.text, c.color, c.holdMs, c.keep);
      if (c.voice) announceVoice(c.voice, true, true);
      if (c.sfx) playSfx(c.sfx, c.gain ?? 1);
      if (c.duckMs) duckMusic(c.duckMs);
    }
  }

  private spotlight(c: MomentCall): void {
    this.spot.textContent = c.text;
    this.spot.style.color = c.color;
    this.spot.classList.toggle('top', c.top === true);
    this.spot.classList.remove('on');
    void this.spot.offsetWidth;
    this.spot.classList.add('on');
    this.host.root.classList.add('br-spotting');
    window.clearTimeout(this.spotTimer);
    const hold = c.holdMs ?? SPOT_MS;
    this.spotTimer = window.setTimeout(() => {
      this.spot.classList.remove('on');
      // The card comes back once the word has faded, not under it.
      this.spotTimer = window.setTimeout(
        () => this.host.root.classList.remove('br-spotting'),
        spotCoverMs(hold) - hold,
      );
    }, hold);
  }

  // One line of the feed, or one more folded away.
  private feedLine(k: MomentDeath): void {
    const { selfId, selfTeam, world } = this.host;
    const r = this.view();
    const marked = new Set((r?.mk ?? []).map((m) => m[0]));
    const leader = r?.v === 'respawn' && r.leader && r.leader.s > 0 ? r.leader.i : null;
    const tier = feedTier(k, {
      selfId,
      person: (id) => {
        if (id === k.unitId && k.vb !== undefined) return !k.vb;
        if (id === k.killerId && k.kb !== undefined) return !k.kb;
        if (world.units.get(id)?.kind !== 'champion') return false;
        return !this.host.botOf(id);
      },
      marked: (id) => marked.has(id),
      inSight: (id) => world.units.get(id)?.kind === 'champion' && world.isVisible(selfTeam, id),
      leader: (id) => id === leader,
    });
    if (tier === 'fold') {
      this.folded.add(performance.now());
      this.showFold();
      return;
    }
    const line = el('div', 'br-feed-line');
    line.dataset.tier = tier;
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
      : who(k.killerId, this.host.killerName(k), k.kb ?? this.host.botOf(k.killerId));
    line.append(
      killer,
      el('span', 'gt', '>'),
      who(k.unitId, this.host.victimName(k), k.vb ?? this.host.botOf(k.unitId)),
    );
    this.pushLine(line, tier);
  }

  // News from afar (a mark, a run snuffed out): one line of the feed in the
  // call's color, kept the near tier's while.
  private newsLine(c: MomentCall): void {
    const line = el('div', 'br-feed-line news');
    line.dataset.tier = 'news';
    line.style.color = c.color;
    line.appendChild(el('span', '', c.text));
    this.pushLine(line, 'news');
  }

  // A line on top of the feed: the ones it pushes out go (a near death
  // joins the fold), and it leaves once its tier's time is up.
  private pushLine(line: HTMLElement, tier: FeedTier): void {
    const { feed } = this.host;
    feed.prepend(line);
    const lines = [...feed.children].filter((c): c is HTMLElement => c !== this.fold);
    const tiers = lines.map((c) => (c.dataset.tier ?? 'near') as FeedTier);
    let folded = false;
    for (const i of feedOverflow(tiers)) {
      if (foldsOut(tiers[i] as FeedTier)) {
        this.folded.add(performance.now());
        folded = true;
      }
      lines[i]?.remove();
    }
    if (folded) this.showFold();
    window.setTimeout(() => line.remove(), feedLife(tier));
  }

  // The folded line: how many deaths elsewhere in the feed's last moments,
  // gone when none is.
  private showFold(): void {
    const n = this.folded.count(performance.now());
    if (n === 0) {
      this.fold?.remove();
      this.fold = null;
      return;
    }
    if (!this.fold?.isConnected) {
      this.fold = el('div', 'br-feed-line fold');
      this.host.feed.append(this.fold);
    }
    const text = elsewhereText(n);
    if (this.fold.textContent !== text) this.fold.textContent = text;
  }

  // The mode's notes: the loot as it lands (what it adds, a finished item,
  // the build whole), the caches opening, the calls of the notes.
  onNotes(notes: readonly RoyaleNote[]): void {
    const { selfId, world } = this.host;
    for (const n of notes) {
      if (n.kind === 'cache') {
        sendRoyaleCue({ kind: 'cache_open', cacheId: n.cacheId });
        if (n.unitId === selfId) {
          this.ritual.open(n.cacheId);
          this.openedCache = n.cacheId;
          playSfx('chest');
        }
      } else if (n.kind === 'loot' && n.unitId === selfId) {
        const item = ITEMS[n.itemId];
        const icon = item ? itemIconUrl(item) : null;
        const line = lootNotice(n.itemId, this.host.root.classList.contains('compact'));
        this.host.notice(line.text, icon, line.completed ? 'done' : 'loot');
        if (line.completed) playSfx('completed');
        if (icon) this.flyToBag(n.itemId, icon, n.source === 'cache' ? this.openedCache : null);
        const me = world.units.get(selfId);
        const whole = me ? buildComplete(me.championId ?? null, me.items) : false;
        if (whole && !this.wasWhole) {
          this.host.notice(BUILD_COMPLETE, null, 'whole');
          playSfx('levelup');
        }
        this.wasWhole = whole;
      }
    }
    this.landings(notes);
    this.play(this.moments.onNotes(notes, world.time));
    // The Risings called, the marks, the Wrath passing, a run snuffed out:
    // another's news a banner only from within reach, a feed line beyond.
    const nameOf = (id: number) => this.host.victimName({ unitId: id, killerId: 0 });
    this.play(huntedCalls(notes, selfId, world.time, nameOf, (id) => this.near(id)));
  }

  // Whether a champion stands within the news' reach of the viewer
  // (ui/royale_moments.ts newsNear): its body where the mirror holds it,
  // else where its latest mark showed it.
  private near(unitId: number): boolean {
    const { world, selfId } = this.host;
    const me = world.units.get(selfId);
    const self = me && me.pos.y !== undefined ? me.pos : null;
    const u = world.units.get(unitId);
    const body = u && !u.dead && u.pos.y !== undefined ? u.pos : null;
    return newsNear(self, body ?? lastMarkPoint(this.view()?.mk, unitId));
  }

  // The seeds that crashed down this batch: each one's shockwave, dust and
  // flash, the camera shaken by how near it fell, and one boom, the
  // nearest's, by distance and bearing.
  private landings(notes: readonly RoyaleNote[]): void {
    const { world, selfId } = this.host;
    const me = world.units.get(selfId);
    const self = me && me.pos.y !== undefined && !me.dead ? me.pos : null;
    let nearest: { at: { x: number; y: number; z: number }; d: number } | null = null;
    for (const n of notes) {
      if (n.kind !== 'seedfall_land') continue;
      const at = wirePoint(n.at);
      const d = self ? arcDistance(self, at) : Number.POSITIVE_INFINITY;
      sendRoyaleCue({ kind: 'seedfall_land', at, shake: self ? impactShake(d) : 0 });
      if (!nearest || d < nearest.d) nearest = { at, d };
    }
    if (!nearest) return;
    const bearing = royaleProjector()?.bearing(nearest.at) ?? 0;
    playSfx('boom', impactGain(nearest.d), { pan: panOf(bearing) });
  }

  // The piece's icon flies from where it came from (the chest, or the
  // champion) into its slot of the bag.
  private flyToBag(itemId: string, icon: string, cacheId: number | null): void {
    const { root, world, selfId } = this.host;
    const me = world.units.get(selfId);
    const stage = root.parentElement;
    if (!me || !stage) return;
    const slot = me.items.indexOf(itemId);
    const slots = root.querySelectorAll<HTMLElement>('.hud-inv-slot');
    const target = slots[slot >= 0 ? slot : slots.length - 1];
    if (!target || typeof target.animate !== 'function') return;
    const to = rectOnStage(target, target.getBoundingClientRect());
    const projector = royaleProjector();
    const cache = cacheId !== null ? this.cachesAt.get(cacheId) : undefined;
    const from =
      (cache && projector?.project(wirePoint(cache), 1)) ||
      (me.pos.y !== undefined ? projector?.project(me.pos as never, 1.5) : null);
    const view = stageSizeOf(stage);
    const fx = from && !from.behind ? from.x : view.width / 2;
    const fy = from && !from.behind ? from.y : view.height / 2;
    const img = el('img', 'br-flight');
    img.src = icon;
    img.alt = '';
    img.style.left = `${fx - 17}px`;
    img.style.top = `${fy - 17}px`;
    stage.appendChild(img);
    const dx = (to.left + to.right) / 2 - fx;
    const dy = (to.top + to.bottom) / 2 - fy;
    const anim = img.animate(
      [
        { transform: 'translate(0, 0) scale(1.5)', opacity: 1 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 60}px) scale(1.2)`, opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.8)`, opacity: 0.4 },
      ],
      { duration: FLIGHT_MS, easing: 'cubic-bezier(0.4, 0, 0.6, 1)' },
    );
    anim.onfinish = () => img.remove();
    window.setTimeout(() => img.remove(), FLIGHT_MS + 200);
  }

  // The edge arrows, every frame: the Seedfalls not on the screen (a
  // landed one left unopened past an interval no longer), with their
  // seconds left while they fall, and the own Burr's carrier while the own
  // champion stands, with the Burr's seconds left. On a phone they stand on a ring round the
  // champion, inside the thumbs; on a desktop on the screen's border.
  private placeArrows(): void {
    const r = this.view();
    const projector = royaleProjector();
    const stage = this.edges.parentElement;
    const seen = new Set<string>();
    const hunted = r ? huntedTargets(r, this.host.world.time, this.host.selfId) : [];
    const standing = this.host.world.units.get(this.host.selfId)?.dead === false;
    const burr = standing ? burrTarget(r, this.host.world.time) : null;
    const any = (r?.sf?.length ?? 0) > 0 || hunted.length > 0 || burr !== null;
    if (r && projector && stage && r.st === 'play' && any) {
      const self = projector.self();
      const time = this.host.world.time;
      const targets: EdgeTarget[] = [];
      // The Risings called or standing and the marks while shown, and the
      // own Burr's carrier.
      for (const h of burr ? [...hunted, burr] : hunted) {
        const p = projector.project(h.at, ARROW_LIFT_M);
        if (!p) continue;
        const hidden = p.hidden === true;
        targets.push({
          key: h.key,
          kind: h.kind,
          x: p.x,
          y: p.y,
          behind: p.behind,
          hidden,
          bearing: hidden ? (projector.bearing(h.at) ?? undefined) : undefined,
          distance: self ? arcDistance(self, h.at) : 0,
          ...(h.secondsLeft !== undefined ? { secondsLeft: h.secondsLeft } : {}),
        });
      }
      for (const s of r.sf ?? []) {
        const landed = s[5] === 1;
        if (!seedfallPointed(s[4], landed, time)) continue;
        const at = { x: s[1], y: s[2], z: s[3] };
        const p = projector.project(at, ARROW_LIFT_M);
        if (!p) continue;
        const hidden = p.hidden === true;
        targets.push({
          key: `sf${s[0]}`,
          kind: 'seedfall',
          x: p.x,
          y: p.y,
          behind: p.behind,
          hidden,
          bearing: hidden ? (projector.bearing(at) ?? undefined) : undefined,
          distance: self ? arcDistance(self, at) : 0,
          secondsLeft: landed ? undefined : Math.max(0, s[4] - time),
        });
      }
      const size = projector.view();
      const obstacles = [...this.measureObstacles(stage)];
      const covers = this.covers;
      const inset = this.insets;
      const view: EdgeView = {
        width: size.width,
        height: size.height,
        // Room for the dial on the sides, and for its distance under it,
        // inside a notched phone's safe area.
        top: 14 + inset.top,
        right: 26 + inset.right,
        bottom: 38 + inset.bottom,
        left: 26 + inset.left,
      };
      // A chime for news (a Seedfall, a Rising), not for each show of a mark.
      const news = targets.filter((t) => t.kind === 'seedfall' || t.kind === 'rising');
      for (const c of this.chimes.step(news, view)) playSfx('chime', 0.85, { pan: c.pan });
      const ring = this.host.root.classList.contains('compact') ? compactRing(view) : undefined;
      const arrows = edgeArrows(targets, view, ring);
      // Each line's words first: its width is part of the arrow's room.
      const relabeled: HTMLElement[] = [];
      const nodes = arrows.map((a) => {
        let node = this.arrows.get(a.key);
        if (!node) {
          node = el('div', 'br-edge');
          node.dataset.kind = a.kind;
          node.append(el('i', ''), el('b', ''));
          this.edges.appendChild(node);
          this.arrows.set(a.key, node);
        }
        const label = node.lastElementChild as HTMLElement;
        if (label.textContent !== a.label) {
          label.textContent = a.label;
          relabeled.push(node);
        }
        return node;
      });
      // The new lines measured once all are written: one layout for them
      // all, not one a line.
      for (const node of relabeled) {
        node.dataset.w = String((node.lastElementChild as HTMLElement).offsetWidth);
      }
      // Placed together: each clear of the HUD and of the ones before it.
      const places = layoutArrows(
        arrows,
        nodes.map((n) => Number(n.dataset.w ?? 0)),
        obstacles,
        view,
        ring,
        covers,
      );
      for (const [i, a] of arrows.entries()) {
        const node = nodes[i];
        const at = places[i];
        if (!node || !at) continue;
        node.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`;
        const dial = node.firstElementChild as HTMLElement;
        dial.style.transform = `rotate(${a.angle.toFixed(3)}rad)`;
        const label = node.lastElementChild as HTMLElement;
        label.style.transform = `translateX(calc(-50% + ${at.labelDx.toFixed(1)}px))`;
        // A line that would touch another arrow's goes (ui/royale_edges.ts).
        label.style.visibility = at.labelShown ? '' : 'hidden';
        seen.add(a.key);
      }
    }
    for (const [key, node] of this.arrows) {
      if (seen.has(key)) continue;
      node.remove();
      this.arrows.delete(key);
    }
  }

  // The safe-area insets as the stage has them (a notch, a rounded
  // corner), read off a probe in the arrows' layer.
  private measureInsets(): void {
    const probe = el('div', '');
    probe.style.cssText =
      'position:absolute;visibility:hidden;pointer-events:none;' +
      'top:var(--safe-top, env(safe-area-inset-top, 0px));' +
      'right:var(--safe-right, env(safe-area-inset-right, 0px));' +
      'bottom:var(--safe-bottom, env(safe-area-inset-bottom, 0px));' +
      'left:var(--safe-left, env(safe-area-inset-left, 0px));';
    this.edges.appendChild(probe);
    const cs = getComputedStyle(probe);
    const px = (v: string): number => {
      const n = Number.parseFloat(v);
      return Number.isFinite(n) ? Math.max(0, n) : 0;
    };
    this.insets = {
      top: px(cs.top),
      right: px(cs.right),
      bottom: px(cs.bottom),
      left: px(cs.left),
    };
    probe.remove();
  }

  // What the arrows keep off, in the stage's pixels: the minimap, the
  // thumbs and the bar, the top line and the feed, the Graft chip; and the
  // open Graft cards, which their lines never stand on (ui/royale_edges.ts
  // layoutArrows covers). Measured twice a second, and at once when the
  // cards open or fold.
  private measureObstacles(stage: HTMLElement): EdgeRect[] {
    const now = performance.now();
    const cards = stage.querySelector<HTMLElement>('.br-grafts');
    const cardsOpen = cards !== null && !cards.hidden;
    if (cardsOpen === this.cardsOpen && now - this.obstaclesAt < OBSTACLES_MS) {
      return this.obstacles;
    }
    this.cardsOpen = cardsOpen;
    this.obstaclesAt = now;
    this.measureInsets();
    this.covers = [];
    if (cards && cardsOpen) {
      const b = cards.getBoundingClientRect();
      if (b.width > 0 && b.height > 0) this.covers.push(rectOnStage(cards, b));
    }
    const picks = stage.querySelectorAll<HTMLElement>(
      '.hud-slots, .hud-bottom, .hud-kda, .stick-base, .stick-ghost, .touchbar, .br-top, ' +
        '.br-feed, .br-open, .br-note, .hud-steps, .hud-points, .hud-hints, .br-graft-chip, ' +
        'canvas[style*="right"]',
    );
    const out: EdgeRect[] = [];
    for (const node of picks) {
      const b = node.getBoundingClientRect();
      if (b.width <= 0 || b.height <= 0) continue;
      const cs = getComputedStyle(node);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const r = rectOnStage(node, b);
      // The thumb covers more than the stick's ring.
      const m =
        node.classList.contains('stick-ghost') || node.classList.contains('stick-base') ? 28 : 4;
      out.push({ left: r.left - m, top: r.top - m, right: r.right + m, bottom: r.bottom + m });
    }
    this.obstacles = out;
    return out;
  }

  // Seconds since the viewer last took a hit, the Dusk's burn aside; null
  // before the first.
  sinceHit(time: number): number | null {
    return Number.isFinite(this.lastHit) ? time - this.lastHit : null;
  }

  // How many arrows stand now (for the dev harness's checks).
  get arrowCount(): number {
    return this.arrows.size;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.spotTimer);
    this.host.root.classList.remove('br-spotting');
    this.edges.remove();
    this.spot.remove();
    this.pulse.remove();
    this.style.remove();
    stopDuskWind();
    setHeartbeat(false);
    setMusicIntensity(1);
  }
}
