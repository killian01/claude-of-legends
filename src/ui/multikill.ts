// The multikill ladder: what a run of kills by one champion is worth, and
// how loudly the game says so. Pure and DOM-free, so the HUD only draws
// what this decides and a test can walk a whole teamfight.
//
// The numbers were measured before they were picked, over 240 bot matches
// (15191 champion kills), and two things came out of it. The flat ten
// second window this replaces fired "Double kill" 7.3 times a match, which
// is wallpaper rather than an event. And no window short enough to fix
// that leaves a pentakill reachable, because five enemies do not die inside
// six seconds: at a flat six the top of the ladder went silent for 240
// matches running. So the leash is not one number. The first link is tight
// and every link after it is longer, which is the shape a fight actually
// has: the opening trade is fast, the wipe that follows takes twenty
// seconds.

import type { VoiceLineId } from '../game/voice_lines';

// Seconds allowed between kills, per link: to reach the double, the triple,
// the quadra, the penta. Sim seconds, never the wall clock, so a throttled
// tab and a stuttering client count the same fight the same way.
//
// Seven is the floor on the first link: from seven up a pentakill lands
// once in 48 matches, at six it falls to once in 60, and the doubles bought
// by going lower are not worth a rarer top rung. Thirty on the last link is
// the one that matters, and it is not extravagant: the five pentakills in
// the sample spanned 7, 12, 17, 19 and 29 seconds.
export const MULTIKILL_LEASH: readonly number[] = [7, 10, 10, 30];

// The pentakill is the top of the ladder. There is no word above it, and a
// chain that kept counting would spend the rarest moment in the game on a
// number the voice cannot say.
export const MULTIKILL_TOP = MULTIKILL_LEASH.length + 1;

// The rung a killer just reached, when it is worth calling.
export interface MultikillCall {
  killerId: number;
  // 2 to MULTIKILL_TOP.
  tier: number;
}

// How a rung is presented. The lower two ride the ordinary announcement and
// stay private to the killer; seven doubles a match shouted at ten people
// would be unbearable. From the quadra up the call is a moment of its own
// and reaches every client, because a pentakill nobody else hears is half a
// pentakill. The lines never name anyone, so one clip serves both sides.
export interface MultikillLook {
  text: string;
  color: string;
  // Its own element, larger and held longer, rather than the one-line
  // announcement every event shares.
  spotlight: boolean;
  holdMs: number;
  // Announced to every client, not only to the killer.
  everyone: boolean;
  // Where the voice sits on the ladder: 0 ordinary, 1 louder, 2 loudest.
  intensity: 0 | 1 | 2;
  voice: VoiceLineId;
}

// Quadra and penta speak through `rampage` until their own clips land
// (docs/design/sound.md, the announcer): the table in voice_lines.ts may
// not carry a line without a recording on disk, and the two recordings are
// rendered from the same table. The screen already says the right word.
const LOOKS: Readonly<Record<number, MultikillLook>> = {
  2: {
    text: 'DOUBLE KILL',
    color: '#ffd94a',
    spotlight: false,
    holdMs: 2600,
    everyone: false,
    intensity: 0,
    voice: 'double_kill',
  },
  3: {
    text: 'TRIPLE KILL',
    color: '#ffd94a',
    spotlight: false,
    holdMs: 2600,
    everyone: false,
    intensity: 0,
    voice: 'triple_kill',
  },
  4: {
    text: 'QUADRAKILL',
    color: '#ffb64a',
    spotlight: true,
    holdMs: 3400,
    everyone: true,
    intensity: 1,
    voice: 'rampage',
  },
  5: {
    text: 'PENTAKILL',
    color: '#ff8a3c',
    spotlight: true,
    holdMs: 4200,
    everyone: true,
    intensity: 2,
    voice: 'rampage',
  },
};

export function multikillLook(tier: number): MultikillLook | null {
  return LOOKS[tier] ?? null;
}

// Counts every champion's chain from the deaths the client already sees.
// Champion deaths travel to both teams (server/snapshot.ts), so this reads
// the same for all ten seats and an enemy's quadra is called on your screen
// at the moment it happens.
export class MultikillLadder {
  private readonly chain = new Map<number, number>();
  private readonly last = new Map<number, number>();

  // One champion death at sim time `now`, in seconds. `killerId` is null
  // when nothing that can hold a chain did it (a tower, a wave of minions).
  // Returns the rung the killer just reached, or null when the kill is
  // worth no call of its own.
  record(victimId: number, killerId: number | null, now: number): MultikillCall | null {
    // A chain dies with its owner: nobody carries a spree out of the
    // fountain. It costs almost nothing to be right about this (the rule
    // changed the calls in 1 of the 240 measured matches) and it saves the
    // absurd case.
    this.chain.delete(victimId);
    this.last.delete(victimId);
    if (killerId === null || killerId === victimId) return null;

    const at = this.chain.get(killerId) ?? 0;
    const since = this.last.get(killerId);
    const leash = MULTIKILL_LEASH[Math.min(at, MULTIKILL_LEASH.length) - 1] ?? 0;
    const tier = at >= 1 && since !== undefined && now - since <= leash ? at + 1 : 1;

    if (tier >= MULTIKILL_TOP) {
      // The slate is clean after the top rung, so the next fight can
      // escalate again from the bottom.
      this.chain.delete(killerId);
      this.last.delete(killerId);
    } else {
      this.chain.set(killerId, tier);
      this.last.set(killerId, now);
    }
    return tier >= 2 ? { killerId, tier } : null;
  }

  // What `killerId` is currently on, for a test or a readout. Zero once the
  // top rung has been called.
  chainOf(killerId: number): number {
    return this.chain.get(killerId) ?? 0;
  }
}
