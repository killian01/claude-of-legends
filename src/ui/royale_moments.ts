// The battle royale's loud moments (CONTEXT.md: Clamor, Ablaze): what the
// HUD calls out, decided without the DOM. Pure: the deaths and the mode's
// notes of a snapshot, the viewer and the clocks in; the calls out, each a
// line, a sound and how loud, and the small judgments the screen, the
// camera and the score read every tick (who the feed keeps, how the music
// rides the match, how deep the champion stands in the Dusk, how loud a
// Clamor is from here). The HUD plays what it is given
// (src/ui/royale_hud_moments.ts).
//
// Only recorded lines are spoken (public/voice): First blood, Double kill
// and Triple kill. Everything else ships as words and a synthesized sound
// until its recording exists; "rampage" is never reused (ADR 0004).

import type { VoiceLineId } from '../game/voice_lines';
import type { RoyaleNote } from '../net/royale_client';
import type {
  RoyaleVariant,
  SnapClamor,
  SnapDusk,
  SnapMark,
  SnapSeedfall,
  WirePoint,
} from '../net/royale_wire';
import { SEEDFALL_IMPACT_M, SEEDFALL_WARN_S } from '../sim/content/royale_events';
import { CLAMOR_S } from '../sim/royale/types';
import { MultikillLadder, multikillLook, ROYALE_MULTIKILL_LEASH } from './multikill';

// The synthesized sounds a call may carry (src/game/sfx.ts).
export type MomentSfx =
  | 'chest'
  | 'tick'
  | 'crack'
  | 'completed'
  | 'toll'
  | 'land'
  | 'whoosh'
  | 'clash'
  | 'chime'
  | 'gong'
  | 'boom'
  | 'lastlight'
  | 'multikill';

// One call: what to show, what to play, and how big.
export interface MomentCall {
  text: string;
  color: string;
  // Its own spotlight, larger and held longer, instead of the one-line
  // announcement every event shares.
  spotlight?: boolean;
  // The spotlight's top size (Wildfire).
  top?: boolean;
  holdMs?: number;
  // A recorded line (src/game/voice_lines.ts), never a synthesized voice.
  voice?: VoiceLineId;
  sfx?: MomentSfx;
  // The sound's gain, 1 the authored level.
  gain?: number;
  // The music dips under the call for this long.
  duckMs?: number;
  // The announcement holds its line for its whole moment (holdMs), and
  // what is announced meanwhile waits its turn (ui/hud.ts announce).
  keep?: boolean;
  // One quiet line of the kill feed instead of a banner (news from afar,
  // newsCall): no spotlight, no sound.
  feed?: boolean;
}

// The news of a mark (the Lodestar, an Ablaze run, a slayer, a run snuffed
// out) is a centered banner only when it names the viewer or its champion
// stands within NEWS_NEAR_M of them; the rest is one quiet line in the
// feed. A playtest's banners were mostly about strangers on the far side
// of the planet, said over the viewer's own fight.
export const NEWS_NEAR_M = 40;

// Whether a champion is near enough for its news to be a banner: unknown
// where it stands is far; an unknown viewer (no body yet) hears it all as
// before.
export function newsNear(viewer: Point | null, champion: Point | null): boolean {
  if (!viewer) return true;
  if (!champion) return false;
  return arcDistance(viewer, champion) <= NEWS_NEAR_M;
}

// A call as the news reaches the viewer: itself when near, else one quiet
// line of the feed with its words and color and nothing else.
export function newsCall(call: MomentCall, near: boolean): MomentCall {
  return near ? call : { text: call.text, color: call.color, feed: true };
}

// The point a champion's latest mark was shown at (SnapRoyale mk), the
// best guess the mirror has for a champion out of sight; null for none.
export function lastMarkPoint(
  mk: readonly SnapMark[] | undefined,
  unitId: number,
): { x: number; y: number; z: number } | null {
  let best: SnapMark | null = null;
  for (const m of mk ?? []) if (m[0] === unitId && (!best || m[5] > best[5])) best = m;
  return best ? { x: best[2], y: best[3], z: best[4] } : null;
}

// A run of takedowns without dying, by variant: the rung that shows the
// champion Ablaze and the one that calls it Wildfire.
export const RUN_LADDER: Readonly<Record<RoyaleVariant, { ablaze: number; wildfire: number }>> = {
  one_life: { ablaze: 3, wildfire: 5 },
  respawn: { ablaze: 5, wildfire: 8 },
};

// How long the music dips under a run's call.
export const RUN_DUCK_MS = 1200;

const EMBER = '#ffb64a';
const FIRE = '#ff8a3c';

// A death as the moments read it: who, by whom, and whether each side is a
// champion (a camp or a creature dies too, and none of that is loud).
export interface MomentKill {
  unitId: number;
  killerId: number;
  victimChampion: boolean;
  killerChampion: boolean;
}

// A takedown: a champion's death credited to another champion.
export function isTakedown(k: MomentKill): boolean {
  return k.victimChampion && k.killerChampion && k.killerId !== k.unitId && k.killerId !== 0;
}

// What the viewer's screen calls out over a match. One per viewer and
// match: First blood is once a match, the ladders count from the start.
export class RoyaleMoments {
  private readonly ladder = new MultikillLadder(ROYALE_MULTIKILL_LEASH);
  private firstBlood = false;
  private sawDrop = false;
  // The viewer's own run: takedowns since they last fell.
  private run = 0;
  // The champion that last took the viewer down, for Payback.
  private lastKiller: number | null = null;

  constructor(
    readonly variant: RoyaleVariant,
    readonly selfId: number,
  ) {}

  // The viewer's run of takedowns without dying.
  get streak(): number {
    return this.run;
  }

  // The stage as the last snapshot told it: First blood is the match's
  // first takedown, which a viewer who came in after the drop cannot know
  // was the first, so only one who saw the drop hears it.
  seeStage(stage: string): void {
    if (stage === 'drop') this.sawDrop = true;
  }

  // One death, at sim time `time`, in the order the snapshot lists them.
  onKill(k: MomentKill, time: number): MomentCall[] {
    if (!k.victimChampion) return [];
    const calls: MomentCall[] = [];
    const takedown = isTakedown(k);
    if (takedown && !this.firstBlood) {
      this.firstBlood = true;
      if (this.sawDrop) calls.push({ text: 'First blood', color: '#ff7a5a', voice: 'first_blood' });
    }
    // Every champion death feeds the ladder (a victim's chain ends with
    // it), and only the viewer's own rungs are called: private, as the
    // 5v5's double and triple are.
    const rung = this.ladder.record(k.unitId, takedown ? k.killerId : null, time);
    if (k.unitId === this.selfId) {
      this.run = 0;
      this.lastKiller = takedown ? k.killerId : null;
      return calls;
    }
    if (!takedown || k.killerId !== this.selfId) return calls;
    this.run += 1;
    if (this.lastKiller !== null && this.lastKiller === k.unitId) {
      this.lastKiller = null;
      calls.push({ text: 'Payback', color: '#7ee0ff', sfx: 'chime', gain: 0.9 });
    }
    const look = rung ? multikillLook(rung.tier) : null;
    if (look) calls.push({ text: look.text, color: look.color, voice: look.voice });
    const runCall = this.runCall(this.run);
    if (runCall) calls.push(runCall);
    return calls;
  }

  // The run's rungs, on the viewer's own streak.
  private runCall(run: number): MomentCall | null {
    const ladder = RUN_LADDER[this.variant];
    if (run === ladder.ablaze) {
      return {
        text: 'ABLAZE',
        color: EMBER,
        spotlight: true,
        holdMs: 3000,
        sfx: 'multikill',
        gain: 0.7,
        duckMs: RUN_DUCK_MS,
      };
    }
    if (run === ladder.wildfire) {
      return {
        text: 'WILDFIRE',
        color: FIRE,
        spotlight: true,
        top: true,
        holdMs: 3800,
        sfx: 'multikill',
        gain: 1,
        duckMs: RUN_DUCK_MS,
      };
    }
    return null;
  }

  // The mode's notes: the run the viewer snuffed out, the Seedfalls called
  // and landing, Respawn's Last light beginning. A batch's Seedfalls make one call (Respawn's two seeds
  // land together): the call kept on its line with the seconds to the
  // landing, `time` the match's clock, and the landing's line without a
  // sound, since the impact's boom is played by distance
  // (ui/royale_hud_moments.ts).
  onNotes(notes: readonly RoyaleNote[], time?: number): MomentCall[] {
    const calls: MomentCall[] = [];
    let called = 0;
    let landsAt = Number.POSITIVE_INFINITY;
    let landed = 0;
    for (const n of notes) {
      if (n.kind === 'snuffed' && n.killerId === this.selfId && n.unitId !== this.selfId) {
        calls.push({
          text: 'SNUFFED OUT',
          color: '#9fe8ff',
          spotlight: true,
          holdMs: 2600,
          sfx: 'multikill',
          gain: 0.6,
        });
      } else if (n.kind === 'seedfall') {
        called += 1;
        landsAt = Math.min(landsAt, n.landsAt);
      } else if (n.kind === 'seedfall_land') {
        landed += 1;
      } else if (n.kind === 'last_light' && this.variant === 'respawn') {
        calls.push(...LAST_LIGHT_CALLS);
      }
    }
    if (called > 0) {
      const secs =
        time !== undefined && Number.isFinite(landsAt)
          ? Math.max(1, Math.round(landsAt - time))
          : SEEDFALL_WARN_S;
      calls.push({
        text: seedfallCallText(called, secs),
        color: '#ffe7a0',
        sfx: 'gong',
        keep: true,
        holdMs: 4000,
      });
    }
    if (landed > 0) {
      calls.push({
        text: landed === 1 ? 'A Seedfall has landed' : `${countWord(landed)} Seedfalls have landed`,
        color: '#ffe7a0',
      });
    }
    return calls;
  }
}

// Respawn's Last light beginning (src/sim/royale/last_light.ts): its name
// in the spotlight with its call, then what it changes, kept on its line.
export const LAST_LIGHT_COLOR = '#ffd36b';
export const LAST_LIGHT_CALLS: readonly MomentCall[] = [
  {
    text: 'LAST LIGHT',
    color: LAST_LIGHT_COLOR,
    spotlight: true,
    holdMs: 3000,
    sfx: 'lastlight',
    duckMs: RUN_DUCK_MS,
  },
  {
    text: 'Takedowns count double until the light goes out',
    color: LAST_LIGHT_COLOR,
    keep: true,
    holdMs: 4200,
  },
];

function countWord(n: number): string {
  return n === 2 ? 'Two' : n === 3 ? 'Three' : String(n);
}

// The call of a Seedfall: how many and how long until they land.
export function seedfallCallText(count: number, seconds: number): string {
  return count === 1
    ? `A Seedfall in ${seconds} s`
    : `${countWord(count)} Seedfalls in ${seconds} s`;
}

// A seed's rush through the sky leads into its landing: the whoosh rises
// for this long before the impact so its low thud falls on it.
export const WHOOSH_LEAD_S = 0.7;

// The seeds falling now, each rushed once: the Seedfall block's ids whose
// landing is under WHOOSH_LEAD_S away (one already down is not rushed).
export class SeedfallRush {
  private readonly rushed = new Set<number>();

  step(list: readonly SnapSeedfall[] | undefined, time: number): number[] {
    const out: number[] = [];
    const now = new Set<number>();
    for (const s of list ?? []) {
      now.add(s[0]);
      if (s[5] === 1 || this.rushed.has(s[0])) continue;
      const left = s[4] - time;
      if (left > WHOOSH_LEAD_S + 1e-9 || left < -0.5) continue;
      this.rushed.add(s[0]);
      out.push(s[0]);
    }
    for (const id of this.rushed) if (!now.has(id)) this.rushed.delete(id);
    return out;
  }
}

// The impact's boom by distance along the ground: full within
// IMPACT_FULL_M, falling to IMPACT_FLOOR at IMPACT_FAR_M and held there,
// since a seed landing anywhere is news.
export const IMPACT_FULL_M = 20;
export const IMPACT_FAR_M = 160;
export const IMPACT_FLOOR = 0.3;
export function impactGain(distance: number): number {
  if (distance <= IMPACT_FULL_M) return 1;
  if (distance >= IMPACT_FAR_M) return IMPACT_FLOOR;
  const k = (distance - IMPACT_FULL_M) / (IMPACT_FAR_M - IMPACT_FULL_M);
  return 1 - (1 - IMPACT_FLOOR) * k;
}

// The camera's shake at the impact: full inside its reach (the champion
// was thrown up), nothing past IMPACT_SHAKE_M.
export const IMPACT_SHAKE = 0.6;
export const IMPACT_SHAKE_M = 40;
export function impactShake(distance: number): number {
  if (distance <= SEEDFALL_IMPACT_M) return IMPACT_SHAKE;
  if (distance >= IMPACT_SHAKE_M) return 0;
  return IMPACT_SHAKE * (1 - (distance - SEEDFALL_IMPACT_M) / (IMPACT_SHAKE_M - SEEDFALL_IMPACT_M));
}

// Who the feed keeps (ui/royale_hud_moments.ts), and for how long. A
// death involving the viewer or the score leader is the feed's own line
// and stays its full time; one involving another person, a shown mark or
// a champion in sight stays a shorter while, at most FEED_NEAR_MAX of
// them at once (late in Respawn the feed stood five rows deep of bots
// taking bots down); the rest folds into "+N elsewhere" at once.
export interface FeedContext {
  selfId: number;
  // A person holds the seat (not a bot).
  person(unitId: number): boolean;
  // Shown to everyone right now (a mark: the Lodestar, an Ablaze run).
  marked(unitId: number): boolean;
  // In the viewer's sight.
  inSight(unitId: number): boolean;
  // The score leader (Respawn's badge); absent where there is none.
  leader?(unitId: number): boolean;
}

// 'news' is a mark's news from afar (newsCall): a line of the near rows
// that is no death.
export type FeedTier = 'own' | 'lead' | 'near' | 'news' | 'fold';

export function feedTier(k: { unitId: number; killerId: number }, ctx: FeedContext): FeedTier {
  const ids = [k.unitId];
  if (k.killerId !== 0 && k.killerId !== k.unitId) ids.push(k.killerId);
  if (ids.includes(ctx.selfId)) return 'own';
  if (ctx.leader && ids.some((id) => ctx.leader?.(id) === true)) return 'lead';
  if (ids.some((id) => ctx.person(id) || ctx.marked(id) || ctx.inSight(id))) return 'near';
  return 'fold';
}

export function feedKeeps(k: { unitId: number; killerId: number }, ctx: FeedContext): boolean {
  return feedTier(k, ctx) !== 'fold';
}

// How long a line stays, milliseconds, by its tier; how many lines stand
// at once, and how many of them the near tier may hold.
export const FEED_MS = 6500;
export const FEED_NEAR_MS = 3500;
export const FEED_MAX = 4;
export const FEED_NEAR_MAX = 2;

export function feedLife(tier: FeedTier): number {
  return tier === 'own' || tier === 'lead' ? FEED_MS : FEED_NEAR_MS;
}

// The lines a new one pushes out, by index into `tiers` (newest first, the
// new one included): the oldest near lines (deaths or news) past
// FEED_NEAR_MAX, then the oldest lines past FEED_MAX, a near one before
// the viewer's or the leader's. A near death pushed out joins the fold
// (foldsOut); a news line just goes.
export function feedOverflow(tiers: readonly FeedTier[]): number[] {
  const out = new Set<number>();
  const isNear = (i: number): boolean => tiers[i] === 'near' || tiers[i] === 'news';
  const standing = (): number[] => tiers.map((_, i) => i).filter((i) => !out.has(i));
  const near = standing().filter(isNear);
  for (const i of near.slice(FEED_NEAR_MAX)) out.add(i);
  while (standing().length > FEED_MAX) {
    const rest = standing();
    const oldestNear = rest.filter(isNear).pop();
    out.add(oldestNear ?? (rest[rest.length - 1] as number));
  }
  return [...out].sort((a, b) => a - b);
}

// Whether a line pushed out of the feed counts in "+N elsewhere": a near
// death does; news is no death, and the own and the leader's lines are
// the feed's to keep.
export function foldsOut(tier: FeedTier): boolean {
  return tier === 'near';
}

// How many deaths the feed folded within its last `windowMs` (wall clock,
// as the feed's lines live): a busy planet says "+7 elsewhere", not a
// count that only climbs while anyone anywhere is fighting.
export class FoldCount {
  private readonly at: number[] = [];

  constructor(readonly windowMs: number) {}

  add(nowMs: number): void {
    this.at.push(nowMs);
  }

  count(nowMs: number): number {
    while (this.at.length > 0 && nowMs - (this.at[0] ?? 0) >= this.windowMs) this.at.shift();
    return this.at.length;
  }
}

// The words of the folded line.
export function elsewhereText(n: number): string {
  return `+${n} elsewhere`;
}

// The score's weight, 0 to 3, as music.ts setMusicIntensity reads it: 0
// the calm (and the drop), 1 the first two closings, 2 the third and the
// fourth or the viewer fighting in the last 4 s, 3 the last closing and
// the dark.
export const COMBAT_MUSIC_S = 4;
export function musicIntensity(
  stage: string,
  phase: number,
  sinceOwnCombat: number | null,
): 0 | 1 | 2 | 3 {
  if (stage === 'drop') return 0;
  if (phase >= 5) return 3;
  const fighting = sinceOwnCombat !== null && sinceOwnCombat < COMBAT_MUSIC_S;
  if (phase >= 3 || fighting) return 2;
  return phase >= 1 ? 1 : 0;
}

// Under a quarter of its health, the champion's heart is heard.
export const HEARTBEAT_SHARE = 0.25;
export function heartbeat(hp: number, maxHp: number, dead: boolean): boolean {
  return !dead && maxHp > 0 && hp / maxHp < HEARTBEAT_SHARE;
}

// The Dusk tolls on a closing: as the light starts to close, and as the
// last of it goes out.
export function duskTolls(
  prev: Pick<SnapDusk, 'p' | 'sh'> | null,
  next: Pick<SnapDusk, 'p' | 'sh'>,
): boolean {
  if (!prev) return false;
  if (next.p >= 6) return prev.p < 6;
  return next.sh === 1 && (prev.sh === 0 || prev.p !== next.p);
}

type Point = { x: number; y?: number; z: number };

function len3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

// Meters along the ground between two points of the sphere (the arc).
export function arcDistance(a: Point, b: Point): number {
  const ay = a.y ?? 0;
  const by = b.y ?? 0;
  const ra = len3(a.x, ay, a.z);
  const rb = len3(b.x, by, b.z);
  if (ra < 1e-9 || rb < 1e-9) return len3(a.x - b.x, ay - by, a.z - b.z);
  const cos = (a.x * b.x + ay * by + a.z * b.z) / (ra * rb);
  return Math.acos(Math.max(-1, Math.min(1, cos))) * ((ra + rb) / 2);
}

// How deep a point stands past the lit cap's edge, in meters (0 inside it,
// and through the calm); null when the point carries no height.
export function duskDepth(pos: Point, dusk: Pick<SnapDusk, 'c' | 'r' | 'p'>): number | null {
  if (typeof pos.y !== 'number' || !Number.isFinite(pos.y)) return null;
  if (dusk.p === 0) return 0;
  const [cx, cy, cz] = dusk.c;
  return Math.max(0, len3(pos.x - cx, pos.y - cy, pos.z - cz) - dusk.r);
}

// The Dusk's burn takes a sliver of health every tick (maxHp * burn * DT,
// src/sim/royale/mode.ts). A drop no bigger than DUSK_TICK_WINDOW_S of it
// (a frame may carry a few ticks), while the champion stands outside the
// light, is the Dusk alone: no damage floater (the playtest's "-1 -2"
// piled over the head), no hit sound or flash, and no fight. The burn is
// the HUD's pill ("In the Dusk -2%/s").
export const DUSK_TICK_WINDOW_S = 0.3;
export function duskTickOnly(drop: number, maxHp: number, burn: number, outside: boolean): boolean {
  if (!outside || !(burn > 0) || !(drop > 0)) return false;
  return drop <= maxHp * burn * DUSK_TICK_WINDOW_S + 1;
}

// The frost at the screen's edge and the wind's level, 0 to 1, by depth:
// a step past the edge is felt, twelve meters in is the full cold.
export const FROST_FULL_M = 12;
export function frostLevel(depth: number | null): number {
  if (depth === null || depth <= 0) return 0;
  return Math.min(1, 0.25 + (0.75 * depth) / FROST_FULL_M);
}

// A Clamor's loudness by distance: full within CLAMOR_FULL_M, nothing
// past CLAMOR_HEAR_M, a straight line between.
export const CLAMOR_FULL_M = 10;
export const CLAMOR_HEAR_M = 60;
export function clamorGain(distance: number): number {
  if (distance <= CLAMOR_FULL_M) return 1;
  if (distance >= CLAMOR_HEAR_M) return 0;
  return 1 - (distance - CLAMOR_FULL_M) / (CLAMOR_HEAR_M - CLAMOR_FULL_M);
}

// A stereo pan, -1 left to 1 right, from a bearing in radians off the
// camera's forward (positive to the right).
export function panOf(bearing: number): number {
  return Math.max(-1, Math.min(1, Math.sin(bearing)));
}

// The Clamors not yet heard: each heard once, forgotten once it falls
// silent. Keys are the point and the time it rang.
export class ClamorEar {
  private readonly heard = new Map<string, number>();

  fresh(list: readonly SnapClamor[] | undefined, time: number): SnapClamor[] {
    for (const [key, at] of this.heard) if (time - at > CLAMOR_S + 1) this.heard.delete(key);
    const out: SnapClamor[] = [];
    for (const c of list ?? []) {
      if (time - c[3] >= CLAMOR_S) continue;
      const key = c.join(',');
      if (this.heard.has(key)) continue;
      this.heard.set(key, c[3]);
      out.push(c);
    }
    return out;
  }
}

// The Clamor heard: of the fresh ones, the loudest, at most one every
// CLAMOR_GAP_S (late in Respawn every takedown on the planet is within
// earshot, and a clash a tick would be a rattle). A takedown the viewer
// made or saw (seen, at the victim's place) is no news from out of sight
// and rings nothing.
export const CLAMOR_GAP_S = 1.5;
const SEEN_M = 3;
const SEEN_S = 1.5;

export class ClamorBell {
  private last = Number.NEGATIVE_INFINITY;
  private seenAt: { at: Point; time: number }[] = [];

  seen(at: Point, time: number): void {
    this.seenAt.push({ at, time });
  }

  pick(
    fresh: readonly SnapClamor[],
    self: Point,
    time: number,
  ): { at: { x: number; y: number; z: number }; gain: number } | null {
    this.seenAt = this.seenAt.filter((s) => time - s.time <= CLAMOR_S + 1);
    let best: { at: { x: number; y: number; z: number }; gain: number } | null = null;
    for (const c of fresh) {
      const at = wirePoint(c);
      const known = this.seenAt.some(
        (s) => Math.abs(s.time - c[3]) <= SEEN_S && arcDistance(s.at, at) <= SEEN_M,
      );
      if (known) continue;
      const gain = clamorGain(arcDistance(self, at));
      if (gain <= 0 || (best && best.gain >= gain)) continue;
      best = { at, gain };
    }
    if (!best || time - this.last < CLAMOR_GAP_S) return null;
    this.last = time;
    return best;
  }
}

// The Clamors still ringing at `time`, for the minimap's flash.
export function ringing(list: readonly SnapClamor[] | undefined, time: number): SnapClamor[] {
  return (list ?? []).filter((c) => time - c[3] >= 0 && time - c[3] < CLAMOR_S);
}

// The opening ritual of the viewer's own cache (CONTEXT.md: Cache): four
// ticks rising in pitch over the opening, then the chest, or a crack when
// the opening ends without the cache opening (a hit broke it, or the
// champion walked off).
export const OPENING_TICKS = 4;
// The pitch of tick i, 1 the authored one.
export function tickPitch(i: number): number {
  return 1 + 0.18 * i;
}

export type OpeningBeat =
  | { kind: 'tick'; index: number; pitch: number }
  | { kind: 'crack'; cacheId: number };

export class OpeningRitual {
  private cacheId: number | null = null;
  private fraction = 0;
  private pendingCrack: number | null = null;
  private opened = new Set<number>();

  // Each tick of the HUD: the fraction opened (null while nothing opens)
  // and the cache. A crack waits one tick, since the snapshot's notes are
  // read after its state.
  step(cacheId: number | null, fraction: number | null): OpeningBeat[] {
    const beats: OpeningBeat[] = [];
    if (this.pendingCrack !== null) {
      if (!this.opened.has(this.pendingCrack)) {
        beats.push({ kind: 'crack', cacheId: this.pendingCrack });
      }
      this.pendingCrack = null;
    }
    if (cacheId === null || fraction === null) {
      if (this.cacheId !== null) this.pendingCrack = this.cacheId;
      this.cacheId = null;
      this.fraction = 0;
      return beats;
    }
    if (cacheId !== this.cacheId) {
      if (this.cacheId !== null) this.pendingCrack = this.cacheId;
      this.cacheId = cacheId;
      this.fraction = -1;
      this.opened.delete(cacheId);
    }
    for (let i = 0; i < OPENING_TICKS; i++) {
      const at = i / OPENING_TICKS;
      if (this.fraction < at && fraction >= at) {
        beats.push({ kind: 'tick', index: i, pitch: tickPitch(i) });
      }
    }
    this.fraction = fraction;
    return beats;
  }

  // The cache did open (a royale_cache note for the viewer).
  open(cacheId: number): void {
    this.opened.add(cacheId);
  }
}

// A point of the wire as a sphere point.
export function wirePoint(w: WirePoint | readonly number[]): { x: number; y: number; z: number } {
  return { x: w[0] ?? 0, y: w[1] ?? 0, z: w[2] ?? 0 };
}
