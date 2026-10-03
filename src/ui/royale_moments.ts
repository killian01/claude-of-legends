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
import type { RoyaleVariant, SnapClamor, SnapDusk, WirePoint } from '../net/royale_wire';
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
  // and landing.
  onNotes(notes: readonly RoyaleNote[]): MomentCall[] {
    const calls: MomentCall[] = [];
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
        calls.push({ text: 'A Seedfall is coming', color: '#ffe7a0', sfx: 'chime' });
      } else if (n.kind === 'seedfall_land') {
        calls.push({ text: 'A Seedfall has landed', color: '#ffe7a0', sfx: 'whoosh' });
      }
    }
    return calls;
  }
}

// Who the feed keeps (ui/royale_hud_moments.ts): a death involving the
// viewer, a person, a shown mark or a champion in sight. The rest folds
// into "+N elsewhere".
export interface FeedContext {
  selfId: number;
  // A person holds the seat (not a bot).
  person(unitId: number): boolean;
  // Shown to everyone right now (a mark: the Lodestar, an Ablaze run).
  marked(unitId: number): boolean;
  // In the viewer's sight.
  inSight(unitId: number): boolean;
}

export function feedKeeps(k: { unitId: number; killerId: number }, ctx: FeedContext): boolean {
  const ids = [k.unitId];
  if (k.killerId !== 0 && k.killerId !== k.unitId) ids.push(k.killerId);
  return ids.some((id) => id === ctx.selfId || ctx.person(id) || ctx.marked(id) || ctx.inSight(id));
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
