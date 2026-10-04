// The Risings and the hunted as the screen shows them (CONTEXT.md: Rising,
// Wrath, Lodestar, Ablaze), decided without the DOM: what the planet's
// columns stand for them, what the edge arrows point at, the minimap's
// crown and icons, the aura a marked champion wears, when a Rising has
// just come up or fallen, and the calls the mode's notes make. Pure: the
// mode's block as the last snapshot told it (SnapRoyale's ri and mk) and
// the clock in; the renderer and the HUD draw what this answers
// (render/planet_marks.ts, render/planet_minimap.ts, render/renderer.ts,
// ui/royale_hud_moments.ts).
//
// Only recorded lines are spoken (public/voice): the Warden's rise reuses
// "The Warden has awoken!"; everything else is words and a sound.

import type { RoyaleNote } from '../net/royale_client';
import type { SnapMark, SnapRising, SnapRoyale } from '../net/royale_wire';
import { RISING_WARN_S } from '../sim/content/royale_events';
import type { Vec3 } from '../sim/geo';
import { MARK_SHOWN_S, type MarkKind, type RisingKind } from '../sim/royale/types';
import type { MomentCall } from './royale_moments';

// Each Rising's color: the Pyrefang's ember, the Voidmaul's violet, the
// Warden's white-violet (the Wrath's own, which its last hit carries).
export const RISING_COLORS: Readonly<Record<RisingKind, { hex: number; css: string }>> = {
  pyrefang: { hex: 0xff7a2e, css: '#ff9a52' },
  voidmaul: { hex: 0x8a52ff, css: '#b48cff' },
  warden: { hex: 0xe6dcff, css: '#efe8ff' },
};

// Each mark's color: the Lodestar's gold, the Wrath's white-violet, an
// Ablaze run's ember, a slayer's flame.
export const MARK_COLORS: Readonly<Record<MarkKind, { hex: number; css: string }>> = {
  lodestar: { hex: 0xffd24a, css: '#ffd86a' },
  wrath: { hex: 0xf3ecff, css: '#f3ecff' },
  ablaze: { hex: 0xff8a3c, css: '#ffa860' },
  slayer: { hex: 0xffb04a, css: '#ffc070' },
};

export const RISING_NAMES: Readonly<Record<RisingKind, string>> = {
  pyrefang: 'the Pyrefang',
  voidmaul: 'the Voidmaul',
  warden: 'the Warden',
};

function at(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

// Whether a mark is on the globe at `time`: from its show for MARK_SHOWN_S.
export function markShownNow(m: SnapMark, time: number): boolean {
  return time - m[5] >= -0.5 && time - m[5] <= MARK_SHOWN_S;
}

// A column on the planet (render/planet_pillars.ts Pillar, with its own
// color): each Rising called (counting down to its rise) or standing (lit),
// and each mark while its show lasts, where it was shown.
export interface HuntedPillar {
  kind: 'rising' | 'wrath' | 'lodestar' | 'ablaze';
  at: Vec3;
  until?: number;
  lit?: boolean;
  color: number;
}

export function huntedPillars(
  r: Pick<SnapRoyale, 'st' | 'ri' | 'mk'> | null,
  time: number,
): HuntedPillar[] {
  const out: HuntedPillar[] = [];
  if (r?.st !== 'play') return out;
  for (const x of r.ri ?? []) {
    out.push({
      kind: 'rising',
      at: at(x[1], x[2], x[3]),
      until: x[4],
      lit: x[5] === 1,
      color: RISING_COLORS[x[0]].hex,
    });
  }
  for (const m of r.mk ?? []) {
    if (!markShownNow(m, time)) continue;
    const kind = m[1] === 'slayer' ? 'rising' : m[1];
    out.push({ kind, at: at(m[2], m[3], m[4]), lit: true, color: MARK_COLORS[m[1]].hex });
  }
  return out;
}

// What an edge arrow points at for the Risings and the hunted: every Rising
// called (with the seconds to its rise) and the first RISING_POINTED_S of
// its standing (then its column alone: a body nobody takes would hold an
// arrow all match), and every other champion's mark while its show lasts
// (a slayer's is the Rising's own news).
export interface HuntedTarget {
  key: string;
  kind: 'rising' | 'wrath' | 'lodestar' | 'ablaze';
  at: Vec3;
  secondsLeft?: number;
}

export const RISING_POINTED_S = 30;

export function huntedTargets(
  r: Pick<SnapRoyale, 'st' | 'ri' | 'mk'> | null,
  time: number,
  selfId: number,
): HuntedTarget[] {
  const out: HuntedTarget[] = [];
  if (r?.st !== 'play') return out;
  for (const x of r.ri ?? []) {
    if (x[5] === 1 && time - x[4] > RISING_POINTED_S) continue;
    out.push({
      key: `ri-${x[0]}`,
      kind: 'rising',
      at: at(x[1], x[2], x[3]),
      ...(x[5] === 1 ? {} : { secondsLeft: Math.max(0, x[4] - time) }),
    });
  }
  for (const m of r.mk ?? []) {
    if (m[0] === selfId || m[1] === 'slayer' || !markShownNow(m, time)) continue;
    out.push({ key: `mk-${m[0]}-${m[1]}`, kind: m[1], at: at(m[2], m[3], m[4]) });
  }
  return out;
}

// The minimap's icons: a crown where the Lodestar was last shown (bright
// while shown), the Wrath's diamond where its holder was, each Rising's
// dot in its color.
export interface MinimapIcon {
  icon: 'crown' | 'diamond' | 'rising';
  at: Vec3;
  color: string;
  shown: boolean;
}

export function minimapIcons(
  r: Pick<SnapRoyale, 'st' | 'ri' | 'mk'> | null,
  time: number,
): MinimapIcon[] {
  const out: MinimapIcon[] = [];
  if (r?.st !== 'play') return out;
  for (const x of r.ri ?? []) {
    out.push({
      icon: 'rising',
      at: at(x[1], x[2], x[3]),
      color: RISING_COLORS[x[0]].css,
      shown: x[5] === 1,
    });
  }
  for (const m of r.mk ?? []) {
    if (m[1] !== 'lodestar' && m[1] !== 'wrath') continue;
    out.push({
      icon: m[1] === 'lodestar' ? 'crown' : 'diamond',
      at: at(m[2], m[3], m[4]),
      color: MARK_COLORS[m[1]].css,
      shown: markShownNow(m, time),
    });
  }
  return out;
}

// The aura each marked champion wears, by unit id: the Wrath first, then
// the Lodestar, then an Ablaze run (a slayer wears none).
const AURA_ORDER: readonly MarkKind[] = ['wrath', 'lodestar', 'ablaze'];

export function markAuras(r: Pick<SnapRoyale, 'st' | 'mk'> | null): Map<number, MarkKind> {
  const out = new Map<number, MarkKind>();
  if (r?.st !== 'play') return out;
  for (const kind of AURA_ORDER) {
    for (const m of r.mk ?? []) {
      if (m[1] === kind && !out.has(m[0])) out.set(m[0], kind);
    }
  }
  return out;
}

// The Risings that came up and fell between two ri lists: a Rising listed
// up now that was called (or absent) before has risen; one up before and
// gone now has fallen. One watcher per viewer and match; the first list it
// sees only sets what it knows.
export class RisingWatch {
  private last: Map<RisingKind, boolean> | null = null;

  step(list: readonly SnapRising[] | undefined): { risen: RisingKind[]; fallen: RisingKind[] } {
    const now = new Map<RisingKind, boolean>((list ?? []).map((x) => [x[0], x[5] === 1]));
    const before = this.last;
    this.last = now;
    const risen: RisingKind[] = [];
    const fallen: RisingKind[] = [];
    if (!before) return { risen, fallen };
    for (const [kind, up] of now) if (up && before.get(kind) !== true) risen.push(kind);
    for (const [kind, up] of before) if (up && !now.has(kind)) fallen.push(kind);
    return { risen, fallen };
  }
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// The heads-up of the Risings called in one batch: "The Pyrefang and the
// Voidmaul rise in 0:30", the Warden "in the light".
export function risingCallText(kinds: readonly RisingKind[], seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const names = kinds.map((k) => RISING_NAMES[k]);
  const who =
    names.length <= 1
      ? (names[0] ?? 'a Rising')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const verb = kinds.length > 1 ? 'rise' : 'rises';
  const where = kinds.length === 1 && kinds[0] === 'warden' ? ' in the light' : '';
  return `${capital(who)} ${verb}${where} in ${clock}`;
}

// The calls a Rising's rise makes: the Warden's in the recorded voice.
export function risenCalls(kinds: readonly RisingKind[]): MomentCall[] {
  return kinds.map((k) =>
    k === 'warden'
      ? { text: 'The Warden has awoken', color: RISING_COLORS.warden.css, voice: 'warden_awoken' }
      : { text: `${capital(RISING_NAMES[k])} has risen`, color: RISING_COLORS[k].css, sfx: 'boom' },
  );
}

// The calls of the mode's notes for the Risings and the hunted: the
// heads-up of each batch of Risings (one call), a new mark (the Lodestar, a
// Wrath taken, an Ablaze run of someone else's, a slayer), the Wrath
// passing, and a run someone else snuffed out. `nameOf` reads a champion's
// name (the notes carry the server's, which win); the viewer is "You".
export function huntedCalls(
  notes: readonly RoyaleNote[],
  selfId: number,
  time: number,
  nameOf: (unitId: number) => string,
): MomentCall[] {
  const calls: MomentCall[] = [];
  const called: RisingKind[] = [];
  let risesAt = Number.POSITIVE_INFINITY;
  const who = (id: number, name?: string): string =>
    id === selfId ? 'You' : name && name.length > 0 ? name : nameOf(id);
  for (const n of notes) {
    if (n.kind === 'rising') {
      called.push(n.rising);
      risesAt = Math.min(risesAt, n.risesAt);
    } else if (n.kind === 'mark') {
      const self = n.unitId === selfId;
      const name = who(n.unitId, n.name);
      const color = MARK_COLORS[n.mark].css;
      if (n.mark === 'lodestar') {
        calls.push(
          self
            ? {
                text: 'You are the Lodestar: every globe shows you',
                color,
                sfx: 'gong',
                keep: true,
              }
            : { text: `${name} is the Lodestar`, color, sfx: 'chime' },
        );
      } else if (n.mark === 'wrath') {
        calls.push(
          self
            ? { text: 'You hold the Wrath', color, spotlight: true, holdMs: 2800, sfx: 'gong' }
            : { text: `${name} holds the Wrath`, color, sfx: 'gong' },
        );
      } else if (n.mark === 'ablaze' && !self) {
        calls.push({ text: `${name} is Ablaze`, color });
      } else if (n.mark === 'slayer') {
        calls.push({
          text: self ? 'You took the Rising: every globe shows you' : `${name} took the Rising`,
          color,
          sfx: 'chime',
        });
      }
    } else if (n.kind === 'wrath_passed') {
      const color = MARK_COLORS.wrath.css;
      if (n.to === null) calls.push({ text: 'The Wrath is lost', color });
      else if (n.to === selfId) {
        calls.push({
          text: 'The Wrath is yours',
          color,
          spotlight: true,
          holdMs: 2800,
          sfx: 'gong',
        });
      } else
        calls.push({ text: `The Wrath has passed to ${who(n.to, n.name)}`, color, sfx: 'gong' });
    } else if (n.kind === 'snuffed' && n.killerId !== selfId && n.unitId !== selfId) {
      calls.push({
        text: `${who(n.killerId, n.killerName)} snuffed out ${who(n.unitId, n.name)}`,
        color: '#9fe8ff',
      });
    }
  }
  if (called.length > 0) {
    const seconds = Number.isFinite(risesAt) ? risesAt - time : RISING_WARN_S;
    calls.unshift({
      text: risingCallText(called, seconds),
      color: RISING_COLORS[called[0]!].css,
      sfx: 'gong',
      keep: true,
      holdMs: 4000,
    });
  }
  return calls;
}
